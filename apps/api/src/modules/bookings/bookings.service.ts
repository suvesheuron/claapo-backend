import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const ONGOING_BOOKING_STATUSES = ['pending', 'accepted', 'locked', 'cancel_requested'] as const;
import { NotificationsService } from '../notifications/notifications.service';
import { ChatService } from '../chat/chat.service';
import {
  QUEUE_BOOKINGS_EXPIRE,
  QUEUE_NOTIFICATIONS,
  JOB_BOOKING_CREATED,
  JOB_EXPIRE_TICK,
} from '../../common/queue/queue.constants';
import { isQueueEnabled } from '../../common/queue/queue.helpers';
import { CreateBookingRequestDto } from './dto/booking-request.dto';
import { LockBookingDto } from './dto/lock-booking.dto';

const EXPIRE_TICK_EVERY_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class BookingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('BookingsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly chat: ChatService,
    @InjectQueue(QUEUE_BOOKINGS_EXPIRE) private readonly expireQueue: Queue,
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationsQueue: Queue,
  ) {}

  /**
   * Schedule the repeatable expiry tick on startup. Same `jobId` every time so
   * re-registering on a restart is idempotent (BullMQ replaces the existing
   * schedule rather than spawning a duplicate). Skipped entirely when the
   * queue feature flag is off — no schedule entry is written to Redis.
   */
  async onApplicationBootstrap() {
    if (!isQueueEnabled()) return;
    try {
      await this.expireQueue.add(
        JOB_EXPIRE_TICK,
        {},
        {
          repeat: { every: EXPIRE_TICK_EVERY_MS },
          jobId: 'bookings-expire-tick',
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );
      this.logger.log(`scheduled ${QUEUE_BOOKINGS_EXPIRE} every ${EXPIRE_TICK_EVERY_MS / 1000}s`);
    } catch (err) {
      this.logger.error(`failed to schedule expire tick: ${(err as Error).message}`);
    }
  }

  private async sendBookingStatusChatMessage(
    senderUserId: string,
    recipientUserId: string,
    projectId: string,
    message: string,
  ) {
    try {
      await this.chat.sendBookingRequestMessage(senderUserId, recipientUserId, projectId, message);
    } catch {
      // Best effort only.
    }
  }

  private async getActorDisplayName(userId: string): Promise<string> {
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        individualProfile: { select: { displayName: true } },
        companyProfile: { select: { companyName: true } },
        vendorProfile: { select: { companyName: true } },
      },
    });
    return (
      actor?.individualProfile?.displayName ??
      actor?.companyProfile?.companyName ??
      actor?.vendorProfile?.companyName ??
      actor?.email ??
      'User'
    );
  }

  /**
   * Resolve the exact list of UTC-normalized dates a booking covers.
   *
   * IMPORTANT: this is the ONLY source of truth for "which days does this
   * booking block". It uses `booking.shootDates` exclusively — never the
   * project's start/end range, never the project's `shootDates`. A booking is
   * for the specific days the company chose for THIS crew/vendor, nothing more.
   *
   * Bookings created via the new API are guaranteed to have at least one
   * shootDate (validated in createRequest). Legacy bookings with empty
   * shootDates intentionally resolve to [] so they cannot retroactively
   * over-block someone's schedule.
   */
  private resolveBookingDates(booking: { shootDates?: Date[] | null }): Date[] {
    if (!booking.shootDates || booking.shootDates.length === 0) {
      return [];
    }
    return booking.shootDates.map((d) => {
      const x = new Date(d);
      return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
    });
  }

  private hasDateOverlap(datesA: Date[], datesB: Date[]): boolean {
    if (datesA.length === 0 || datesB.length === 0) return false;
    const bSet = new Set(datesB.map((d) => d.toISOString().slice(0, 10)));
    return datesA.some((d) => bSet.has(d.toISOString().slice(0, 10)));
  }

  private countEquipmentBookingsPerDate(
    dates: Date[],
    bookings: Array<{ shootDates?: Date[] | null }>,
  ): Map<string, number> {
    const requestedKeys = new Set(dates.map((d) => d.toISOString().slice(0, 10)));
    const perDate = new Map<string, number>();
    for (const b of bookings) {
      const keys = this.resolveBookingDates(b).map((d) => d.toISOString().slice(0, 10));
      for (const key of keys) {
        if (!requestedKeys.has(key)) continue;
        perDate.set(key, (perDate.get(key) ?? 0) + 1);
      }
    }
    return perDate;
  }

  async createRequest(companyUserId: string, dto: CreateBookingRequestDto) {
    const companyCtx = await this.getCompanyAccountContext(companyUserId);
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { roles: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.companyUserId !== companyCtx.accountOwnerId) throw new ForbiddenException('Not your project');
    if (!companyCtx.isMainUser) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: {
          accountUserId: companyCtx.accountOwnerId,
          subUserId: companyUserId,
          projectId: dto.projectId,
        },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
    if (project.status === 'completed' || project.status === 'cancelled') {
      throw new BadRequestException(
        `Cannot send booking requests for a ${project.status} project`,
      );
    }
    const target = await this.prisma.user.findFirst({ where: { id: dto.targetUserId, deletedAt: null } });
    if (!target) throw new NotFoundException('Target user not found');
    if (target.role !== 'individual' && target.role !== 'vendor') {
      throw new BadRequestException('Target must be individual or vendor');
    }
    const targetAccountUserId = target.mainUserId ?? target.id;
    const existingWhere: Record<string, unknown> = {
      projectId: dto.projectId,
      targetUserId: targetAccountUserId,
      status: { in: ['pending', 'accepted', 'locked'] },
    };
    if (target.role === UserRole.vendor && dto.vendorEquipmentId?.trim()) {
      existingWhere.vendorEquipmentId = dto.vendorEquipmentId.trim();
    }
    const existing = await this.prisma.bookingRequest.findFirst({ where: existingWhere as any });
    if (existing) {
      const msg =
        existing.status === 'locked'
          ? 'This crew/vendor is already locked for this project.'
          : existing.status === 'accepted'
            ? 'This crew/vendor has already accepted a request for this project.'
            : 'A pending request already exists for this crew/vendor on this project.';
      throw new BadRequestException(msg);
    }
    let vendorEquipmentId: string | undefined;
    if (dto.vendorEquipmentId?.trim()) {
      const equipment = await this.prisma.vendorEquipment.findFirst({
        where: { id: dto.vendorEquipmentId.trim(), vendorUserId: targetAccountUserId },
      });
      if (!equipment) throw new BadRequestException('Equipment not found or does not belong to this vendor.');
      vendorEquipmentId = equipment.id;
    }

    // Booking is for SPECIFIC dates only — never the full project timeline.
    // Parse, dedupe, validate; reject if empty after sanitization.
    const shootDates = [
      ...new Set((dto.shootDates ?? []).map((s) => s.trim()).filter(Boolean)),
    ]
      .map((s) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (!m) return null;
        const [_, y, mo, d] = m;
        const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
        return Number.isNaN(dt.getTime()) ? null : dt;
      })
      .filter((d): d is Date => d !== null);
    if (shootDates.length === 0) {
      throw new BadRequestException(
        'You must select at least one specific date to hire this crew/vendor for. Bookings only block the chosen dates.',
      );
    }

    // Validate and process shootDateLocations if provided
    let shootDateLocationsData: any = null;
    if (dto.shootDateLocations && dto.shootDateLocations.length > 0) {
      // Validate that each date-location pair has a valid date
      const validatedPairs = dto.shootDateLocations
        .filter((pair) => pair.date && pair.location)
        .map((pair) => {
          const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(pair.date);
          if (!m) return null;
          const [_, y, mo, d] = m;
          const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
          if (Number.isNaN(dt.getTime())) return null;
          return {
            date: pair.date,
            location: pair.location.trim(),
          };
        })
        .filter((pair): pair is { date: string; location: string } => pair !== null);

      if (validatedPairs.length > 0) {
        shootDateLocationsData = validatedPairs;

        // Validate that all dates in shootDateLocations are also in shootDates
        const shootDateStrings = shootDates.map((d) => d.toISOString().slice(0, 10));
        for (const pair of validatedPairs) {
          if (!shootDateStrings.includes(pair.date)) {
            throw new BadRequestException(
              `Date ${pair.date} in shootDateLocations is not in the shootDates array.`,
            );
          }
        }
      }
    }

    // Bookings outside the project window are nonsense — reject them.
    const projStartUtc = Date.UTC(
      project.startDate.getUTCFullYear(),
      project.startDate.getUTCMonth(),
      project.startDate.getUTCDate(),
    );
    const projEndUtc = Date.UTC(
      project.endDate.getUTCFullYear(),
      project.endDate.getUTCMonth(),
      project.endDate.getUTCDate(),
    );
    for (const d of shootDates) {
      const t = d.getTime();
      if (t < projStartUtc || t > projEndUtc) {
        throw new BadRequestException(
          `Selected date ${d.toISOString().slice(0, 10)} is outside the project window (${new Date(projStartUtc).toISOString().slice(0, 10)} – ${new Date(projEndUtc).toISOString().slice(0, 10)}).`,
        );
      }
    }
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const booking = await this.prisma.bookingRequest.create({
      data: {
        projectId: dto.projectId,
        requesterUserId: companyCtx.accountOwnerId,
        targetUserId: targetAccountUserId,
        projectRoleId: dto.projectRoleId,
        vendorEquipmentId,
        rateOffered: dto.rateOffered,
        message: dto.message,
        shootDates,
        shootDateLocations: shootDateLocationsData,
        expiresAt,
      },
      include: { project: true, target: { select: { id: true, email: true, role: true } } },
    });
    // Notification + chat-summary side effects.
    // - When QUEUE_ENABLED=true, enqueue a single `booking-created` job and
    //   return the booking immediately so the caller doesn't wait on Notification
    //   creation + ChatService writes (which together can cost ~150 ms).
    // - Otherwise fall back to the original inline path so behavior is
    //   identical to pre-Phase-4.
    if (isQueueEnabled()) {
      try {
        await this.notificationsQueue.add(
          JOB_BOOKING_CREATED,
          { bookingId: booking.id },
          {
            jobId: `booking-created:${booking.id}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 2_000 },
            removeOnComplete: 100,
            removeOnFail: 50,
          },
        );
      } catch (err) {
        // If enqueue fails, fall back inline so the user-visible flow stays correct.
        this.logger.warn(`enqueue booking-created failed (${(err as Error).message}); running inline`);
        await this.runBookingCreatedSideEffectsInline(booking, companyCtx.accountOwnerId, targetAccountUserId);
      }
    } else {
      await this.runBookingCreatedSideEffectsInline(booking, companyCtx.accountOwnerId, targetAccountUserId);
    }

    return booking;
  }

  /** Legacy inline path — kept verbatim from the pre-Phase-4 implementation. */
  private async runBookingCreatedSideEffectsInline(
    booking: { id: string; projectId: string; rateOffered: number | null; message: string | null; shootDates: Date[]; project: { title: string } },
    requesterUserId: string,
    targetUserId: string,
  ) {
    await this.notifications.createForUser(
      targetUserId,
      'booking_request',
      'New booking request',
      `You have a new booking request for project: ${booking.project.title}`,
      { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
    );
    try {
      const rateStr = booking.rateOffered
        ? ` · Offered rate: ₹${(booking.rateOffered / 100).toLocaleString('en-IN')}/day`
        : '';
      const datesStr = `\n\n📅 You are being booked specifically for: ${booking.shootDates
        .map((d) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))
        .join(', ')}\n(Only these date${booking.shootDates.length > 1 ? 's' : ''} will be marked unavailable on your calendar.)`;
      const customMsg = booking.message?.trim() ? `\n\nMessage: "${booking.message.trim()}"` : '';
      const chatContent = `Booking Request — ${booking.project.title}${rateStr}${datesStr}${customMsg}\n\nPlease accept or decline from your Bookings page.`;
      await this.chat.sendBookingRequestMessage(
        requesterUserId,
        targetUserId,
        booking.projectId,
        chatContent,
      );
    } catch {
      // Non-fatal: booking is created; chat message is best-effort
    }
  }

  async listIncoming(userId: string, role: UserRole) {
    if (role !== 'individual' && role !== 'vendor') {
      throw new ForbiddenException('Only individuals and vendors have incoming requests');
    }
    const incomingCtx = role === UserRole.vendor ? await this.getVendorAccountContext(userId) : null;
    const targetUid = incomingCtx ? incomingCtx.accountOwnerId : userId;
    const raw = await this.prisma.bookingRequest.findMany({
      where: {
        targetUserId: targetUid,
        status: { in: [...ONGOING_BOOKING_STATUSES, 'cancelled'] },
      },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            companyUserId: true,
            startDate: true,
            endDate: true,
            status: true,
            locationCity: true,
            shootDates: true,
            shootLocations: true,
          },
        },
        requester: { select: { id: true, email: true, companyProfile: true } },
        projectRole: true,
        vendorEquipment: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const itemsFiltered = raw.filter((b) => b.project.status !== 'cancelled');

    // For vendors: flag when requested equipment is already committed to another project
    const withWarnings = await this.attachEquipmentAlreadyBookedFor(targetUid, itemsFiltered);
    const withCancelMeta = await Promise.all(
      withWarnings.map(async (b) => {
        if ((b as any).status !== 'cancel_requested') return b;
        const requestedByTarget = await this.isCancellationRequestedByTarget(b as any);
        return {
          ...b,
          cancelRequestedBySide: requestedByTarget ? 'crew_or_vendor' : 'company',
        };
      }),
    );
    return { items: withCancelMeta };
  }

  /** For each booking that has vendorEquipmentId, attach equipmentAlreadyBookedFor if that equipment is committed to another project */
  private async attachEquipmentAlreadyBookedFor(
    targetUserId: string,
    items: Array<{ id: string; projectId: string; vendorEquipmentId: string | null; vendorEquipment?: { id: string; name: string } | null; project: { id: string; title: string; startDate: Date; endDate: Date }; [k: string]: unknown }>,
  ) {
    const withEquipment = items.filter((b) => b.vendorEquipmentId);
    if (withEquipment.length === 0) return items;

    const equipmentIds = [...new Set(withEquipment.map((b) => b.vendorEquipmentId!))];
    const otherBookings = await this.prisma.bookingRequest.findMany({
      where: {
        vendorEquipmentId: { in: equipmentIds },
        status: { in: ['accepted', 'locked'] },
        targetUserId: targetUserId,
      },
      select: {
        id: true,
        projectId: true,
        vendorEquipmentId: true,
        shootDates: true,
        project: { select: { title: true, startDate: true, endDate: true } },
      },
    });
    const equipmentRows = (await this.prisma.vendorEquipment.findMany({
      where: { id: { in: equipmentIds } },
      select: { id: true, ...({ quantityTotal: true } as any) },
    })) as unknown as Array<{ id: string; quantityTotal?: number }>;
    const quantityByEquipment: Map<string, number> = new Map<string, number>(
      equipmentRows.map((eq) => [eq.id, Math.max(1, eq.quantityTotal || 1)]),
    );

    const byEquipment: Record<string, Array<{ projectId: string; projectTitle: string; startDate: Date; endDate: Date; shootDates: Date[] }>> = {};
    for (const ob of otherBookings) {
      if (!ob.vendorEquipmentId) continue;
      if (!byEquipment[ob.vendorEquipmentId]) byEquipment[ob.vendorEquipmentId] = [];
      byEquipment[ob.vendorEquipmentId].push({
        projectId: ob.projectId,
        projectTitle: ob.project.title,
        startDate: ob.project.startDate,
        endDate: ob.project.endDate,
        shootDates: ob.shootDates ?? [],
      });
    }

    return items.map((b) => {
      const base = { ...b };
      if (!b.vendorEquipmentId) return base;
      const thisDates = this.resolveBookingDates(b as any);
      const others = (byEquipment[b.vendorEquipmentId] ?? []).filter((o) => {
        if (o.projectId === b.projectId) return false;
        const otherDates = this.resolveBookingDates({ shootDates: o.shootDates });
        return this.hasDateOverlap(thisDates, otherDates);
      });
      const capacity = quantityByEquipment.get(b.vendorEquipmentId) ?? 1;
      const usageByDate = this.countEquipmentBookingsPerDate(
        thisDates,
        others.map((o) => ({ shootDates: o.shootDates })),
      );
      const fullyBookedDates = Array.from(usageByDate.entries())
        .filter(([, count]) => count >= capacity)
        .map(([date]) => date);
      const other = fullyBookedDates.length > 0 ? others[0] : null;
      (base as any).equipmentAlreadyBookedFor = other
        ? { projectTitle: other.projectTitle, startDate: other.startDate, endDate: other.endDate }
        : null;
      return base;
    });
  }

  /** Past projects: bookings where user was crew/vendor and project is completed */
  async listPastBookings(userId: string, role: UserRole) {
    if (role !== 'individual' && role !== 'vendor') {
      throw new ForbiddenException('Only individuals and vendors have past bookings');
    }
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContext(userId) : null;
    const targetUserId = vendorCtx ? vendorCtx.accountOwnerId : userId;
    const items = await this.prisma.bookingRequest.findMany({
      where: {
        targetUserId,
        status: { in: ['accepted', 'locked'] },
        project: {
          status: 'completed',
        },
      },
      include: {
        project: { select: { id: true, title: true, startDate: true, endDate: true, status: true, locationCity: true, shootDates: true, shootLocations: true } },
        requester: { select: { id: true, email: true, companyProfile: { select: { companyName: true } } } },
        projectRole: { select: { id: true, roleName: true } },
        vendorEquipment: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  /** List cancel-requested bookings for company to respond to */
  async listCancelRequests(companyUserId: string) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    const raw = await this.prisma.bookingRequest.findMany({
      where: {
        requesterUserId: ctx.accountOwnerId,
        status: 'cancel_requested' as any,
      },
      include: {
        project: { select: { id: true, title: true, startDate: true, endDate: true } },
        target: {
          select: {
            id: true, email: true,
            individualProfile: { select: { displayName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
        projectRole: { select: { id: true, roleName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const items: typeof raw = [];
    for (const booking of raw) {
      if (await this.isCancellationRequestedByTarget(booking as any)) {
        items.push(booking);
      }
    }
    return { items };
  }

  async listOutgoing(companyUserId: string) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    const items = await this.prisma.bookingRequest.findMany({
      where: {
        requesterUserId: ctx.accountOwnerId,
        ...(ctx.isMainUser
          ? {}
          : {
              project: {
                subUserAssignments: {
                  some: { accountUserId: ctx.accountOwnerId, subUserId: companyUserId },
                },
              },
            }),
      },
      include: {
        project: true,
        target: { select: { id: true, email: true, role: true, individualProfile: true, vendorProfile: true } },
        projectRole: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  // Counter offer feature removed as per Task 27 (2nd April)
  // async counterOffer(bookingId: string, userId: string, role: UserRole, counterRate: number, counterMessage?: string) {
  //   const booking = await this.prisma.bookingRequest.findUnique({
  //     where: { id: bookingId },
  //     include: { project: true },
  //   });
  //   if (!booking) throw new NotFoundException('Booking not found');
  //   if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only crew/vendor can counter-offer');
  //   if (role === UserRole.vendor) {
  //     const vendorCtx = await this.getVendorAccountContext(userId);
  //     if (booking.targetUserId !== vendorCtx.accountOwnerId) throw new ForbiddenException('Not your booking');
  //   } else if (booking.targetUserId !== userId) {
  //     throw new ForbiddenException('Not your booking');
  //   }
  //   if (booking.status !== 'pending') throw new BadRequestException('Booking is not pending');
  //   if (counterRate <= 0) throw new BadRequestException('Counter rate must be positive');

  //   const updated = await this.prisma.bookingRequest.update({
  //     where: { id: bookingId },
  //     data: {
  //       counterRate,
  //       counterMessage: counterMessage?.trim() ?? null,
  //       counterAt: new Date(),
  //     },
  //     include: { project: true },
  //   });

  //   await this.notifications.createForUser(
  //     booking.requesterUserId,
  //     'booking_counter_offer',
  //     'Counter offer received',
  //     `A counter offer of ₹${(counterRate / 100).toLocaleString('en-IN')}/day was made for project "${booking.project.title}".`,
  //     { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
  //   );

  //   return updated;
  // }

  async accept(bookingId: string, userId: string, role: UserRole) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only crew/vendor can accept');
    if (role === UserRole.vendor) {
      const vendorCtx = await this.getVendorAccountContext(userId);
      if (booking.targetUserId !== vendorCtx.accountOwnerId) throw new ForbiddenException('Not your booking');
    } else if (booking.targetUserId !== userId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== 'pending') throw new BadRequestException('Booking is not pending');
    if (booking.expiresAt && booking.expiresAt < new Date()) {
      await this.prisma.bookingRequest.update({ where: { id: bookingId }, data: { status: 'expired' } });
      throw new BadRequestException('Request has expired');
    }

    // The booking blocks ONLY the specific dates the company chose for this crew.
    // No project-range fallback — see resolveBookingDates() for the rationale.
    const datesToCheck: Date[] = this.resolveBookingDates(booking as any);
    if (datesToCheck.length === 0) {
      throw new BadRequestException(
        'This booking has no shoot dates set. Ask the company to cancel and re-send the request with specific dates.',
      );
    }

    if (role === UserRole.vendor) {
      // Vendors should be blocked equipment-wise, not profile-wise.
      if (booking.vendorEquipmentId) {
        const equipment = await this.prisma.vendorEquipment.findUnique({
          where: { id: booking.vendorEquipmentId },
          select: { ...({ quantityTotal: true } as any) },
        });
        const quantityTotal = Math.max(1, (equipment as any)?.quantityTotal ?? 1);
        const conflictingBookings = await this.prisma.bookingRequest.findMany({
          where: {
            targetUserId: booking.targetUserId,
            vendorEquipmentId: booking.vendorEquipmentId,
            status: { in: ['accepted', 'locked'] },
            id: { not: bookingId },
          },
          include: {
            project: { select: { title: true } },
          },
        });
        const overlappingBookings = conflictingBookings.filter((b) =>
          this.hasDateOverlap(datesToCheck, this.resolveBookingDates(b)),
        );
        const usageByDate = this.countEquipmentBookingsPerDate(datesToCheck, overlappingBookings);
        const fullyBookedDates = datesToCheck
          .map((d) => d.toISOString().slice(0, 10))
          .filter((dateKey) => (usageByDate.get(dateKey) ?? 0) >= quantityTotal);
        if (fullyBookedDates.length > 0) {
          const conflictingProjects = overlappingBookings.filter((b) =>
            this.hasDateOverlap(
              datesToCheck.filter((d) => fullyBookedDates.includes(d.toISOString().slice(0, 10))),
              this.resolveBookingDates(b),
            ),
          );
          throw new BadRequestException(
            `This equipment is already booked for these dates on project(s): ${conflictingProjects.map((p) => p.project.title).join(', ')}`,
          );
        }
      }
    } else {
      // Individual crew remain profile-blocked via availability slots.
      const existingBookings = await this.prisma.availabilitySlot.findMany({
        where: {
          userId: booking.targetUserId,
          date: { in: datesToCheck },
          status: { in: ['booked', 'blocked'] },
        },
      });

      if (existingBookings.length > 0) {
        // Find which other project(s) conflict using exact booking dates.
        const conflictingBookings = await this.prisma.bookingRequest.findMany({
          where: {
            targetUserId: booking.targetUserId,
            status: { in: ['accepted', 'locked'] },
            id: { not: bookingId },
          },
          include: {
            project: { select: { title: true, startDate: true, endDate: true, shootDates: true } },
          },
        });

        const conflictingProjects = conflictingBookings.filter((b) =>
          this.hasDateOverlap(datesToCheck, this.resolveBookingDates(b as any)),
        );

        if (conflictingProjects.length > 0) {
          throw new BadRequestException(
            `You are already booked for these dates on project(s): ${conflictingProjects.map((p) => p.project.title).join(', ')}`,
          );
        }
      }

      // Block the dates for individual crew booking.
      for (const dateKey of datesToCheck) {
        await this.prisma.availabilitySlot.upsert({
          where: { userId_date: { userId: booking.targetUserId, date: dateKey } },
          create: { userId: booking.targetUserId, date: dateKey, status: 'booked' },
          update: { status: 'booked' },
        });
      }
    }
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: { status: 'accepted', respondedAt: new Date() },
      include: { project: true },
    });
    await this.notifications.createForUser(
      booking.requesterUserId,
      'booking_accepted',
      'Booking accepted',
      `Your booking request for project "${booking.project.title}" was accepted.`,
      { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
    );
    await this.sendBookingStatusChatMessage(
      booking.targetUserId,
      booking.requesterUserId,
      booking.projectId,
      `Booking request has been accepted`,
    );
    return updated;
  }

  async decline(bookingId: string, userId: string, role: UserRole) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role !== 'individual' && role !== 'vendor') throw new ForbiddenException('Only crew/vendor can decline');
    if (role === UserRole.vendor) {
      const vendorCtx = await this.getVendorAccountContext(userId);
      if (booking.targetUserId !== vendorCtx.accountOwnerId) throw new ForbiddenException('Not your booking');
    } else if (booking.targetUserId !== userId) {
      throw new ForbiddenException('Not your booking');
    }
    if (booking.status !== 'pending') throw new BadRequestException('Booking is not pending');
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: { status: 'declined', respondedAt: new Date() },
    });
    await this.notifications.createForUser(
      booking.requesterUserId,
      'booking_declined',
      'Booking declined',
      `Your booking request for project "${booking.project.title}" was declined.`,
      { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
    );
    await this.sendBookingStatusChatMessage(
      booking.targetUserId,
      booking.requesterUserId,
      booking.projectId,
      `Booking request has been declined`,
    );
    return updated;
  }

  async lock(bookingId: string, companyUserId: string, dto?: LockBookingDto) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.requesterUserId !== ctx.accountOwnerId) throw new ForbiddenException('Only the company can lock');
    if (!ctx.isMainUser) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: { accountUserId: ctx.accountOwnerId, subUserId: companyUserId, projectId: booking.projectId },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
    if (booking.status !== 'accepted') throw new BadRequestException('Only accepted bookings can be locked');
    // CRITICAL: preserve the booking's per-person shootDates that were set at
    // creation time. NEVER fall back to project.shootDates here — that would
    // expand the booking from "hire this person for Apr 15" to "hire this
    // person for every day the project shoots", silently over-blocking their
    // calendar. Lock only changes status; date scope is locked in at creation.
    const overrideShootDates = dto?.shootDates?.length
      ? dto.shootDates.map((d) => new Date(d)).filter((d) => !isNaN(d.getTime()))
      : null;
    const overrideShootLocations = dto?.shootLocations?.length
      ? dto.shootLocations.map((s) => s.trim()).filter(Boolean)
      : null;
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: {
        status: 'locked',
        lockedAt: new Date(),
        ...(overrideShootDates ? { shootDates: overrideShootDates } : {}),
        ...(overrideShootLocations ? { shootLocations: overrideShootLocations } : {}),
      },
      include: { project: true, target: { select: { id: true, email: true } } },
    });

    // Non-fatal: booking lock is authoritative; notification should not block it.
    try {
      await this.notifications.createForUser(
        booking.targetUserId,
        'booking_locked',
        'Booking locked',
        `Your booking for project "${updated.project.title}" has been locked by the company.`,
        {
          bookingId: updated.id,
          projectId: updated.projectId,
          projectTitle: updated.project.title,
        },
      );
    } catch {
      // Best effort notification.
    }

    return updated;
  }

  /** Request cancellation of an accepted/locked booking — needs approval from the opposite side */
  async requestCancellation(bookingId: string, userId: string, role: UserRole, reason?: string) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const companyCtx = await this.getCompanyAccountContextOrNull(userId);
    const vendorCtx = await this.getVendorAccountContextOrNull(userId);
    const actorId = companyCtx?.accountOwnerId ?? vendorCtx?.accountOwnerId ?? userId;
    const isRequester = booking.requesterUserId === actorId;
    const isTarget = booking.targetUserId === actorId || booking.targetUserId === userId;
    if (!isRequester && !isTarget) {
      throw new ForbiddenException('Not your booking');
    }
    if (isRequester && role !== UserRole.company) {
      throw new ForbiddenException('Only company can request cancellation from this side');
    }
    if (isTarget && role === UserRole.company) {
      throw new ForbiddenException('Company cannot act as booking target');
    }
    if (companyCtx && !companyCtx.isMainUser && isRequester) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: { accountUserId: companyCtx.accountOwnerId, subUserId: userId, projectId: booking.projectId },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
    if (booking.status !== 'accepted' && booking.status !== 'locked') {
      throw new BadRequestException('Only accepted or locked bookings can request cancellation');
    }
    if ((booking.status as string) === 'cancel_requested') {
      throw new BadRequestException('Cancellation request is already pending');
    }
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: {
        status: 'cancel_requested' as any,
        ...(({ cancelRequestReason: reason, cancelRequestedAt: new Date() } as any)),
        cancelledByUserId: userId,
      },
    });
    if (isRequester) {
      await this.notifications.createForUser(
        booking.targetUserId,
        'cancel_requested_by_company',
        'Cancellation Approval Needed',
        `The production company has requested to cancel your booking for project "${booking.project.title}". Please approve or deny this request.${reason ? ` Reason: ${reason}` : ''}`,
        {
          bookingId: booking.id,
          projectId: booking.projectId,
          projectTitle: booking.project.title,
          cancelRequestReason: reason ?? null,
          requestedBy: 'company',
        },
      );
    } else {
      await this.notifications.createForUser(
        booking.requesterUserId,
        'cancel_requested',
        'Cancellation Request',
        `A crew member/vendor has requested to cancel their booking for project "${booking.project.title}".${reason ? ` Reason: ${reason}` : ''}`,
        {
          bookingId: booking.id,
          projectId: booking.projectId,
          projectTitle: booking.project.title,
          cancelRequestReason: reason ?? null,
          requestedBy: 'crew_or_vendor',
        },
      );
    }
    return updated;
  }

  /** Company accepts or denies a cancellation request */
  async respondToCancellation(bookingId: string, companyUserId: string, accept: boolean) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.requesterUserId !== ctx.accountOwnerId) throw new ForbiddenException('Not your booking');
    if ((booking.status as string) !== 'cancel_requested') {
      throw new BadRequestException('Booking is not in cancel_requested state');
    }
    if (!(await this.isCancellationRequestedByTarget(booking))) {
      throw new BadRequestException('This cancellation request must be responded by the crew/vendor');
    }
    const actorName = await this.getActorDisplayName(ctx.accountOwnerId);
    if (accept) {
      // Free availability slots using the same date set that accept() locked.
      const datesToFree: Date[] = this.resolveBookingDates(booking as any);
      for (const dateKey of datesToFree) {
        await this.prisma.availabilitySlot.updateMany({
          where: { userId: booking.targetUserId, date: dateKey },
          data: { status: 'available' },
        });
      }
      const updated = await this.prisma.bookingRequest.update({
        where: { id: bookingId },
        data: { status: 'cancelled', cancelledByUserId: companyUserId, cancelledAt: new Date() },
      });
      await this.notifications.createForUser(
        booking.targetUserId,
        'cancel_accepted',
        'Cancellation Accepted',
        `Your cancellation request for project "${booking.project.title}" has been approved.`,
        { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
      );
      await this.sendBookingStatusChatMessage(
        ctx.accountOwnerId,
        booking.targetUserId,
        booking.projectId,
        `Cancellation request has been accepted by ${actorName}`,
      );
      return updated;
    } else {
      const updated = await this.prisma.bookingRequest.update({
        where: { id: bookingId },
        data: {
          status: booking.lockedAt ? 'locked' : 'accepted',
          ...(({ cancelRequestReason: null, cancelRequestedAt: null } as any)),
          cancelledByUserId: null,
        },
      });
      await this.notifications.createForUser(
        booking.targetUserId,
        'cancel_denied',
        'Cancellation Denied',
        `Your cancellation request for project "${booking.project.title}" was not approved. You remain booked.`,
        { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
      );
      await this.sendBookingStatusChatMessage(
        ctx.accountOwnerId,
        booking.targetUserId,
        booking.projectId,
        `Cancellation request has been declined by ${actorName}`,
      );
      return updated;
    }
  }

  /** Crew/vendor accepts or denies a company-initiated cancellation request */
  async respondToCompanyCancellation(bookingId: string, userId: string, role: UserRole, accept: boolean) {
    if (role !== UserRole.individual && role !== UserRole.vendor) {
      throw new ForbiddenException('Only crew/vendor can respond to company cancellation requests');
    }
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if ((booking.status as string) !== 'cancel_requested') {
      throw new BadRequestException('Booking is not in cancel_requested state');
    }
    const vendorCtx = role === UserRole.vendor ? await this.getVendorAccountContextOrNull(userId) : null;
    const targetActorId = vendorCtx?.accountOwnerId ?? userId;
    const actorName = await this.getActorDisplayName(targetActorId);
    const isTarget = booking.targetUserId === targetActorId || booking.targetUserId === userId;
    if (!isTarget) throw new ForbiddenException('Not your booking');
    if (await this.isCancellationRequestedByTarget(booking)) {
      throw new BadRequestException('This cancellation request must be responded by the company');
    }
    if (accept) {
      const datesToFree: Date[] = this.resolveBookingDates(booking as any);
      for (const dateKey of datesToFree) {
        await this.prisma.availabilitySlot.updateMany({
          where: { userId: booking.targetUserId, date: dateKey },
          data: { status: 'available' },
        });
      }
      const updated = await this.prisma.bookingRequest.update({
        where: { id: bookingId },
        data: { status: 'cancelled', cancelledByUserId: userId, cancelledAt: new Date() },
      });
      await this.notifications.createForUser(
        booking.requesterUserId,
        'cancel_accepted_by_target',
        'Cancellation Accepted',
        `Your cancellation request for "${booking.project.title}" has been approved by the crew/vendor.`,
        { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
      );
      await this.sendBookingStatusChatMessage(
        targetActorId,
        booking.requesterUserId,
        booking.projectId,
        `Cancellation request has been accepted by ${actorName}`,
      );
      return updated;
    }
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: {
        status: booking.lockedAt ? 'locked' : 'accepted',
        ...(({ cancelRequestReason: null, cancelRequestedAt: null } as any)),
        cancelledByUserId: null,
      },
    });
    await this.notifications.createForUser(
      booking.requesterUserId,
      'cancel_denied_by_target',
      'Cancellation Denied',
      `Your cancellation request for "${booking.project.title}" was not approved by the crew/vendor.`,
      { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
    );
    await this.sendBookingStatusChatMessage(
      targetActorId,
      booking.requesterUserId,
      booking.projectId,
      `Cancellation request has been declined by ${actorName}`,
    );
    return updated;
  }

  async cancel(bookingId: string, userId: string, reason?: string) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const requesterCtx = await this.getCompanyAccountContextOrNull(userId);
    const targetVendorCtx = await this.getVendorAccountContextOrNull(userId);
    const isRequester = booking.requesterUserId === (requesterCtx?.accountOwnerId ?? userId);
    const isTarget = booking.targetUserId === (targetVendorCtx?.accountOwnerId ?? userId) || booking.targetUserId === userId;
    if (!isRequester && !isTarget) throw new ForbiddenException('Not your booking');
    if (requesterCtx && !requesterCtx.isMainUser && isRequester) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: { accountUserId: requesterCtx.accountOwnerId, subUserId: userId, projectId: booking.projectId },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
    if (booking.status === 'accepted' || booking.status === 'locked') {
      throw new BadRequestException('Accepted/locked bookings require cancellation approval from the other side');
    }
    if (booking.status !== 'pending') {
      throw new BadRequestException('Booking cannot be cancelled');
    }
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: {
        status: 'cancelled',
        cancelReason: reason,
        cancelledByUserId: userId,
        cancelledAt: new Date(),
      },
    });
    const notifyUserId = isRequester ? booking.targetUserId : booking.requesterUserId;
    const cancelledBySide = isRequester ? 'company' : 'crew_or_vendor';
    const reasonLine = reason?.trim() ? ` Reason: ${reason.trim()}` : '';
    await this.notifications.createForUser(
      notifyUserId,
      'booking_cancelled',
      'Booking request withdrawn/cancelled',
      `A booking request for project "${booking.project.title}" was cancelled.${reasonLine}`,
      {
        bookingId: booking.id,
        projectId: booking.projectId,
        cancelledByUserId: userId,
        cancelledBySide,
        cancelReason: reason ?? null,
        projectTitle: booking.project.title,
      },
    );
    await this.sendBookingStatusChatMessage(
      userId,
      notifyUserId,
      booking.projectId,
      `Booking update: request for "${booking.project.title}" was cancelled${reason?.trim() ? ` (${reason.trim()})` : ''}.`,
    );
    return updated;
  }

  private async isCancellationRequestedByTarget(booking: { targetUserId: string; cancelledByUserId: string | null }) {
    if (!booking.cancelledByUserId) return false;
    if (booking.cancelledByUserId === booking.targetUserId) return true;
    const requesterUser = await this.prisma.user.findUnique({
      where: { id: booking.cancelledByUserId },
      select: { mainUserId: true },
    });
    return requesterUser?.mainUserId === booking.targetUserId;
  }

  /** Lock all accepted bookings for a project at once */
  async lockAllProjectBookings(projectId: string, companyUserId: string, dto?: LockBookingDto) {
    const ctx = await this.getCompanyAccountContext(companyUserId);
    
    // Verify project exists and belongs to this company
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { roles: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (project.companyUserId !== ctx.accountOwnerId) throw new ForbiddenException('Not your project');
    if (!ctx.isMainUser) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: { accountUserId: ctx.accountOwnerId, subUserId: companyUserId, projectId },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }

    // Get all accepted bookings for this project
    const bookings = await this.prisma.bookingRequest.findMany({
      where: {
        projectId,
        status: 'accepted',
      },
      include: {
        target: { select: { id: true, email: true } },
        project: true,
      },
    });

    if (bookings.length === 0) {
      throw new BadRequestException('No accepted bookings to lock for this project');
    }

    // CRITICAL: each booking keeps its OWN shootDates (the per-person hire
    // window the company picked at creation time). Only when the lock DTO
    // explicitly passes a new list do we override — and even then we apply the
    // same list to every booking, which is rare but supported (e.g., re-syncing
    // a project's whole shoot plan). Falling back to project.shootDates here
    // would silently over-block every crew member to the entire project shoot
    // calendar — see lock() above for the same reasoning.
    const overrideShootDates = dto?.shootDates?.length
      ? dto.shootDates.map((d) => new Date(d)).filter((d) => !isNaN(d.getTime()))
      : null;
    const overrideShootLocations = dto?.shootLocations?.length
      ? dto.shootLocations.map((s) => s.trim()).filter(Boolean)
      : null;

    const updatedBookings = await Promise.all(
      bookings.map((booking) =>
        this.prisma.bookingRequest.update({
          where: { id: booking.id },
          data: {
            status: 'locked',
            lockedAt: new Date(),
            ...(overrideShootDates ? { shootDates: overrideShootDates } : {}),
            ...(overrideShootLocations ? { shootLocations: overrideShootLocations } : {}),
          },
          include: { project: true, target: { select: { id: true, email: true } } },
        }),
      ),
    );

    // Send notifications (non-blocking)
    try {
      await Promise.all(
        updatedBookings.map((updated) =>
          this.notifications.createForUser(
            updated.targetUserId,
            'booking_locked',
            'Booking locked',
            `Your booking for project "${updated.project.title}" has been locked by the company.`,
            {
              bookingId: updated.id,
              projectId: updated.projectId,
              projectTitle: updated.project.title,
            },
          ),
        ),
      );
    } catch {
      // Best effort notification.
    }

    return {
      lockedCount: updatedBookings.length,
      bookings: updatedBookings,
    };
  }

  private async getCompanyAccountContext(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.company) {
      throw new ForbiddenException('Only company users can perform this action');
    }
    const accountOwnerId = user.mainUserId ?? user.id;
    return { accountOwnerId, isMainUser: !user.mainUserId };
  }

  private async getCompanyAccountContextOrNull(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.company) return null;
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
  }

  private async getVendorAccountContext(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.vendor) {
      throw new ForbiddenException('Only vendor users can perform this action');
    }
    const accountOwnerId = user.mainUserId ?? user.id;
    return { accountOwnerId, isMainUser: !user.mainUserId };
  }

  private async getVendorAccountContextOrNull(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!user || user.role !== UserRole.vendor) return null;
    return { accountOwnerId: user.mainUserId ?? user.id, isMainUser: !user.mainUserId };
  }
}

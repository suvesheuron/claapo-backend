import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

const ONGOING_BOOKING_STATUSES = ['pending', 'accepted', 'locked', 'cancel_requested'] as const;
import { NotificationsService } from '../notifications/notifications.service';
import { ChatService } from '../chat/chat.service';
import { CreateBookingRequestDto } from './dto/booking-request.dto';
import { LockBookingDto } from './dto/lock-booking.dto';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly chat: ChatService,
  ) {}

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
    const existing = await this.prisma.bookingRequest.findFirst({
      where: {
        projectId: dto.projectId,
        targetUserId: targetAccountUserId,
        status: { in: ['pending', 'accepted', 'locked'] },
      },
    });
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
    await this.notifications.createForUser(
      targetAccountUserId,
      'booking_request',
      'New booking request',
      `You have a new booking request for project: ${booking.project.title}`,
      { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
    );

    // Auto-create conversation and send booking request as a chat message
    try {
      const rateStr = booking.rateOffered
        ? ` · Offered rate: ₹${(booking.rateOffered / 100).toLocaleString('en-IN')}/day`
        : '';
      const datesStr = `\n\n📅 You are being booked specifically for: ${shootDates
        .map((d) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))
        .join(', ')}\n(Only these date${shootDates.length > 1 ? 's' : ''} will be marked unavailable on your calendar.)`;
      const customMsg = dto.message?.trim() ? `\n\nMessage: "${dto.message.trim()}"` : '';
      const chatContent = `Booking Request — ${booking.project.title}${rateStr}${datesStr}${customMsg}\n\nPlease accept or decline from your Bookings page.`;
      await this.chat.sendBookingRequestMessage(
        companyCtx.accountOwnerId,
        targetAccountUserId,
        booking.projectId,
        chatContent,
      );
    } catch {
      // Non-fatal: booking is created; chat message is best-effort
    }

    return booking;
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
        status: { in: [...ONGOING_BOOKING_STATUSES] },
        ...(incomingCtx && !incomingCtx.isMainUser
          ? {
              project: {
                subUserAssignments: {
                  some: { accountUserId: incomingCtx.accountOwnerId, subUserId: userId },
                },
              },
            }
          : {}),
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
    return { items: withWarnings };
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
        project: { select: { title: true, startDate: true, endDate: true } },
      },
    });

    const byEquipment: Record<string, Array<{ projectId: string; projectTitle: string; startDate: Date; endDate: Date }>> = {};
    for (const ob of otherBookings) {
      if (!ob.vendorEquipmentId) continue;
      if (!byEquipment[ob.vendorEquipmentId]) byEquipment[ob.vendorEquipmentId] = [];
      byEquipment[ob.vendorEquipmentId].push({
        projectId: ob.projectId,
        projectTitle: ob.project.title,
        startDate: ob.project.startDate,
        endDate: ob.project.endDate,
      });
    }

    return items.map((b) => {
      const base = { ...b };
      if (!b.vendorEquipmentId) return base;
      const others = byEquipment[b.vendorEquipmentId]?.filter((o) => o.projectId !== b.projectId) ?? [];
      const other = others[0];
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
          ...(vendorCtx && !vendorCtx.isMainUser
            ? {
                subUserAssignments: {
                  some: { accountUserId: vendorCtx.accountOwnerId, subUserId: userId },
                },
              }
            : {}),
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
    const items = await this.prisma.bookingRequest.findMany({
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
      if (!vendorCtx.isMainUser) {
        const assigned = await this.prisma.subUserProjectAssignment.findFirst({
          where: { accountUserId: vendorCtx.accountOwnerId, subUserId: userId, projectId: booking.projectId },
        });
        if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
      }
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

    // Check if crew member already has booked/blocked slots for overlapping dates
    const existingBookings = await this.prisma.availabilitySlot.findMany({
      where: {
        userId: booking.targetUserId,
        date: { in: datesToCheck },
        status: { in: ['booked', 'blocked'] },
      },
    });

    if (existingBookings.length > 0) {
      // Find which other project(s) conflict — resolve each conflicting booking's
      // exact dates via the same helper (booking.shootDates > project.shootDates > range).
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

      const conflictingProjects = conflictingBookings.filter((b) => {
        const otherDates = this.resolveBookingDates(b as any).map((d) => d.toDateString());
        return datesToCheck.some((d) => otherDates.includes(d.toDateString()));
      });

      if (conflictingProjects.length > 0) {
        throw new BadRequestException(
          `You are already booked for these dates on project(s): ${conflictingProjects.map((p) => p.project.title).join(', ')}`,
        );
      }
    }

    // Block the dates for this booking
    const datesToBlock: Date[] = datesToCheck;
    for (const dateKey of datesToBlock) {
      await this.prisma.availabilitySlot.upsert({
        where: { userId_date: { userId: booking.targetUserId, date: dateKey } },
        create: { userId: booking.targetUserId, date: dateKey, status: 'booked' },
        update: { status: 'booked' },
      });
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
      if (!vendorCtx.isMainUser) {
        const assigned = await this.prisma.subUserProjectAssignment.findFirst({
          where: { accountUserId: vendorCtx.accountOwnerId, subUserId: userId, projectId: booking.projectId },
        });
        if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
      }
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

  /** Crew/vendor requests cancellation of an accepted/locked booking — needs company approval */
  async requestCancellation(bookingId: string, userId: string, reason?: string) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const vendorCtx = await this.getVendorAccountContextOrNull(userId);
    const isTarget =
      booking.targetUserId === (vendorCtx?.accountOwnerId ?? userId) ||
      booking.targetUserId === userId;
    if (!isTarget) throw new ForbiddenException('Only the assigned crew/vendor can request cancellation');
    if (booking.status !== 'accepted' && booking.status !== 'locked') {
      throw new BadRequestException('Only accepted or locked bookings can request cancellation');
    }
    const updated = await this.prisma.bookingRequest.update({
      where: { id: bookingId },
      data: {
        status: 'cancel_requested' as any,
        ...(({ cancelRequestReason: reason, cancelRequestedAt: new Date() } as any)),
      },
    });
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
      },
    );
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
      return updated;
    } else {
      const updated = await this.prisma.bookingRequest.update({
        where: { id: bookingId },
        data: {
          status: 'accepted',
          ...(({ cancelRequestReason: null, cancelRequestedAt: null } as any)),
        },
      });
      await this.notifications.createForUser(
        booking.targetUserId,
        'cancel_denied',
        'Cancellation Denied',
        `Your cancellation request for project "${booking.project.title}" was not approved. You remain booked.`,
        { bookingId: booking.id, projectId: booking.projectId, projectTitle: booking.project.title },
      );
      return updated;
    }
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
    if (targetVendorCtx && !targetVendorCtx.isMainUser && isTarget) {
      const assigned = await this.prisma.subUserProjectAssignment.findFirst({
        where: { accountUserId: targetVendorCtx.accountOwnerId, subUserId: userId, projectId: booking.projectId },
      });
      if (!assigned) throw new ForbiddenException('This project is not assigned to your Sub-User ID');
    }
    if (booking.status === 'locked') throw new BadRequestException('Locked bookings cannot be cancelled here');
    if (booking.status !== 'pending' && booking.status !== 'accepted') {
      throw new BadRequestException('Booking cannot be cancelled');
    }
    if (booking.status === 'accepted') {
      // Free the exact dates this booking had locked.
      const datesToFree: Date[] = this.resolveBookingDates(booking as any);
      for (const dateKey of datesToFree) {
        await this.prisma.availabilitySlot.updateMany({
          where: { userId: booking.targetUserId, date: dateKey },
          data: { status: 'available' },
        });
      }
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
    return updated;
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

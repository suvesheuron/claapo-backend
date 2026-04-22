import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SlotInputDto } from './dto/bulk-availability.dto';

/** Only individual/vendor can set these via API. booked and past_work are system-managed. */
const USER_SETTABLE_STATUSES = ['available', 'blocked'] as const;

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  private toUtcDateKey(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Parse YYYY-MM-DD as a stable UTC day (prevents timezone drift).
   */
  private parseDateOnlyAsUtc(dateOnly: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
    if (!m) {
      throw new BadRequestException(`Invalid date format "${dateOnly}". Expected YYYY-MM-DD.`);
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
      parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() !== month - 1
      || parsed.getUTCDate() !== day
    ) {
      throw new BadRequestException(`Invalid calendar date "${dateOnly}".`);
    }
    return parsed;
  }

  /**
   * Get booking details for a specific date (for booked/past_work slots).
   * Includes project, company, role, invoice, and conversation info.
   */
  private async getBookingForDate(userId: string, date: Date): Promise<any | null> {
    const startOfDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const endOfDay = new Date(startOfDay);
    endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

    // Find booking requests that include this date in their shoot dates
    const bookings = await this.prisma.bookingRequest.findMany({
      where: {
        OR: [
          { requesterUserId: userId },
          { targetUserId: userId },
        ],
        status: { in: ['accepted', 'locked', 'cancel_requested'] },
      },
      include: {
        project: {
          select: {
            id: true,
            title: true,
            companyUserId: true,
            startDate: true,
            endDate: true,
            shootDates: true,
            shootLocations: true,
          },
        },
        requester: {
          select: {
            id: true,
            email: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
        target: {
          select: {
            id: true,
            email: true,
            individualProfile: { select: { displayName: true } },
            companyProfile: { select: { companyName: true } },
            vendorProfile: { select: { companyName: true } },
          },
        },
        projectRole: {
          select: {
            roleName: true,
          },
        },
      },
    });

    // A booking matches a calendar date ONLY when that exact day is listed in
    // BookingRequest.shootDates. We never use project.shootDates or the project
    // date range as a fallback — a crew is only "booked" for the days the
    // company explicitly hired them for.
    const targetKey = this.toUtcDateKey(date);
    const matchingBooking = bookings.find((b) => {
      if (!b.shootDates || b.shootDates.length === 0) return false;
      const bookingDates = b.shootDates.map((d: Date) => this.toUtcDateKey(new Date(d)));
      return bookingDates.includes(targetKey);
    });

    if (!matchingBooking) {
      return null;
    }

    // Determine company (requester) and target (crew/vendor)
    // The company is always the requester, and the crew/vendor is always the target
    const companyUser = matchingBooking.requester;
    const targetUser = matchingBooking.target;

    // Get company name
    const companyName = companyUser.companyProfile?.companyName 
      ?? companyUser.vendorProfile?.companyName 
      ?? companyUser.individualProfile?.displayName 
      ?? companyUser.email;

    // Get target display name
    const targetDisplayName = targetUser.individualProfile?.displayName 
      ?? targetUser.companyProfile?.companyName 
      ?? targetUser.vendorProfile?.companyName 
      ?? targetUser.email;

    // Check for invoice related to this booking
    const invoice = await this.prisma.invoice.findFirst({
      where: {
        projectId: matchingBooking.projectId,
        OR: [
          { issuerUserId: matchingBooking.targetUserId },
          { recipientUserId: matchingBooking.requesterUserId },
        ],
      },
      select: {
        id: true,
        status: true,
      },
    });

    // Check for conversation between users
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        projectId: matchingBooking.projectId,
        OR: [
          { participantA: matchingBooking.requesterUserId, participantB: matchingBooking.targetUserId },
          { participantA: matchingBooking.targetUserId, participantB: matchingBooking.requesterUserId },
        ],
      },
      select: {
        id: true,
      },
    });

    return {
      id: matchingBooking.id,
      projectTitle: matchingBooking.project.title,
      projectId: matchingBooking.projectId,
      companyUserId: companyUser.id,
      companyName,
      targetUserId: targetUser.id,
      targetDisplayName,
      roleName: matchingBooking.projectRole?.roleName,
      rateOffered: matchingBooking.rateOffered,
      status: matchingBooking.status,
      shootDates: matchingBooking.shootDates.map((d: Date) => this.toUtcDateKey(new Date(d))),
      shootLocations: matchingBooking.shootLocations,
      shootDateLocations: matchingBooking.shootDateLocations ?? null,
      message: matchingBooking.message,
      invoiceId: invoice?.id,
      invoiceStatus: invoice?.status,
      conversationId: conversation?.id,
    };
  }

  /**
   * Compute the set of YYYY-MM-DD date keys (within [windowStart, windowEnd))
   * on which `userId` is the *target* of an accepted/locked booking.
   *
   * Honors ONLY `BookingRequest.shootDates` — the exact days the company chose
   * for this crew. No project-range fallback: a booking must never be allowed
   * to over-block someone's calendar beyond the dates they were actually hired
   * for. Bookings with empty shootDates resolve to nothing.
   */
  private async getBookedDateKeysForUser(
    userId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<Set<string>> {
    const bookings = await this.prisma.bookingRequest.findMany({
      where: {
        targetUserId: userId,
        status: { in: ['accepted', 'locked'] },
      },
      select: { shootDates: true },
    });

    const out = new Set<string>();
    const startMs = windowStart.getTime();
    const endMs = windowEnd.getTime();

    for (const b of bookings) {
      if (!b.shootDates || b.shootDates.length === 0) continue;
      for (const raw of b.shootDates) {
        const d = new Date(raw);
        const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        const t = utc.getTime();
        if (t >= startMs && t < endMs) {
          out.add(this.toUtcDateKey(utc));
        }
      }
    }

    return out;
  }

  /** Get own calendar for a month. Returns slots and slotNotes keyed by date (YYYY-MM-DD) for mobile/UI. */
  async getMyCalendar(userId: string, year: number, month: number) {
    const start = new Date(Date.UTC(year, month, 1));
    const endExclusive = new Date(Date.UTC(year, month + 1, 1));
    const slots = await this.prisma.availabilitySlot.findMany({
      where: {
        userId,
        date: { gte: start, lt: endExclusive },
      },
      orderBy: { date: 'asc' },
    });
    const byDate: Record<string, string> = {};
    const slotNotes: Record<string, string | null> = {};
    const bookingDetails: Record<string, any> = {};

    // Authoritative set of dates this user is genuinely "booked" for in this
    // month, derived from BookingRequest.shootDates. Any 'booked' slot row
    // outside this set is stale (from old buggy lock() runs or test/seed data)
    // and must be downgraded — otherwise the calendar shows the entire project
    // window even when the company hired the person for one specific day.
    const trueBookedKeys = await this.getBookedDateKeysForUser(userId, start, endExclusive);

    // Stale slot rows we'll write back so the DB converges to the truth.
    const slotsToHeal: Date[] = [];

    for (const s of slots) {
      const key = this.toUtcDateKey(s.date);
      slotNotes[key] = s.notes ?? null;

      if (s.status === 'booked' && !trueBookedKeys.has(key)) {
        // Orphan booked slot — no backing BookingRequest covers this date.
        byDate[key] = 'available';
        slotsToHeal.push(s.date);
        continue;
      }

      byDate[key] = s.status;

      // Resolve booking details for legitimately booked / past_work slots.
      if (s.status === 'booked' || s.status === 'past_work') {
        const booking = await this.getBookingForDate(userId, s.date);
        if (booking) {
          bookingDetails[key] = booking;
        }
      }
    }

    // Forward fill: any booking-covered date that has no slot row yet (or had
    // an 'available' row) becomes 'booked' in the response. Never overrides
    // user-set 'blocked' or system-set 'past_work'.
    for (const key of trueBookedKeys) {
      const existing = byDate[key];
      if (!existing || existing === 'available') {
        byDate[key] = 'booked';
        if (!bookingDetails[key]) {
          const [yy, mm, dd] = key.split('-').map(Number);
          const dayDate = new Date(Date.UTC(yy, mm - 1, dd));
          const booking = await this.getBookingForDate(userId, dayDate);
          if (booking) bookingDetails[key] = booking;
        }
      }
    }

    // Best-effort write-back of stale 'booked' rows so the next read is clean.
    // Done after the response is computed so a write failure can't break GETs.
    if (slotsToHeal.length > 0) {
      try {
        await this.prisma.availabilitySlot.updateMany({
          where: { userId, date: { in: slotsToHeal }, status: 'booked' },
          data: { status: 'available' },
        });
      } catch {
        // Non-fatal: the response is already correct; convergence will retry on next read.
      }
    }

    return { year, month, slots: byDate, slotNotes, bookingDetails };
  }

  /** Bulk set availability (individual/vendor). Only available/blocked; booked and past_work are system-managed. */
  async bulkSet(userId: string, role: UserRole, slots: SlotInputDto[]) {
    if (role !== 'individual' && role !== 'vendor') {
      throw new ForbiddenException('Only individuals and vendors can set availability');
    }
    if (!slots.length) {
      return { message: 'Availability updated', count: 0 };
    }
    const dates = slots.map((s) => {
      return this.parseDateOnlyAsUtc(s.date);
    });
    const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    for (const slot of slots) {
      if (!USER_SETTABLE_STATUSES.includes(slot.status as (typeof USER_SETTABLE_STATUSES)[number])) {
        throw new BadRequestException(
          `Only "available" or "blocked" can be set manually. "${slot.status}" is managed by bookings.`,
        );
      }
    }
    const existing = await this.prisma.availabilitySlot.findMany({
      where: {
        userId,
        date: { gte: minDate, lte: maxDate },
        status: { in: ['booked', 'past_work'] },
      },
      select: { date: true },
    });
    const systemManagedDates = new Set(existing.map((s) => this.toUtcDateKey(s.date)));
    let updated = 0;
    for (const slot of slots) {
      const date = this.parseDateOnlyAsUtc(slot.date);
      const key = this.toUtcDateKey(date);
      if (systemManagedDates.has(key)) {
        continue;
      }
      await this.prisma.availabilitySlot.upsert({
        where: {
          userId_date: { userId, date },
        },
        create: {
          userId,
          date,
          status: slot.status as 'available' | 'blocked',
          notes: slot.notes,
        },
        update: { status: slot.status as 'available' | 'blocked', notes: slot.notes },
      });
      updated++;
    }
    return { message: 'Availability updated', count: updated };
  }

  /**
   * Company views another user's calendar (slot + notes visible).
   * Booking details are included only when the viewing company is party to that booking (same shape as getMyCalendar).
   */
  async getOtherUserCalendar(viewerId: string, viewerRole: UserRole, targetUserId: string, year: number, month: number) {
    if (viewerRole !== 'company') {
      throw new ForbiddenException('Only companies can view another user calendar');
    }
    const viewer = await this.prisma.user.findFirst({
      where: { id: viewerId, deletedAt: null, isActive: true },
      select: { id: true, role: true, mainUserId: true },
    });
    if (!viewer || viewer.role !== UserRole.company) {
      throw new ForbiddenException('Only company users can view another user calendar');
    }
    const viewerAccountOwnerId = viewer.mainUserId ?? viewer.id;
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null, isActive: true },
    });
    if (!target) throw new NotFoundException('User not found');
    const start = new Date(Date.UTC(year, month, 1));
    const endExclusive = new Date(Date.UTC(year, month + 1, 1));
    const slots = await this.prisma.availabilitySlot.findMany({
      where: { userId: targetUserId, date: { gte: start, lt: endExclusive } },
      orderBy: { date: 'asc' },
      select: { date: true, status: true, notes: true },
    });
    const byDate: Record<string, string> = {};
    const slotNotes: Record<string, string | null> = {};
    const bookingDetails: Record<string, unknown> = {};
    const resolveBookingDetailsIfAllowed = async (date: Date, key: string) => {
      const booking = await this.getBookingForDate(targetUserId, date);
      if (!booking?.id) return;
      const row = await this.prisma.bookingRequest.findFirst({
        where: { id: booking.id as string },
        select: {
          requesterUserId: true,
          project: { select: { companyUserId: true } },
        },
      });
      const allowed =
        row &&
        (
          row.requesterUserId === viewerAccountOwnerId ||
          row.project.companyUserId === viewerAccountOwnerId
        );
      if (allowed) {
        bookingDetails[key] = booking;
      }
    };

    // Authoritative booked-date set, same as in getMyCalendar — used to
    // downgrade orphan 'booked' slot rows that don't actually correspond to
    // any active booking's per-person shootDates.
    const trueBookedKeys = await this.getBookedDateKeysForUser(targetUserId, start, endExclusive);
    const slotsToHeal: Date[] = [];

    for (const s of slots) {
      const key = this.toUtcDateKey(s.date);
      slotNotes[key] = s.notes ?? null;

      if (s.status === 'booked' && !trueBookedKeys.has(key)) {
        // Stale 'booked' row — no backing booking covers this date.
        byDate[key] = 'available';
        slotsToHeal.push(s.date);
        continue;
      }

      byDate[key] = s.status;
      if (s.status === 'booked' || s.status === 'past_work') {
        await resolveBookingDetailsIfAllowed(s.date, key);
      }
    }

    // Forward fill: real booking dates with no slot row → mark booked.
    // Never overrides 'blocked' or 'past_work'.
    for (const key of trueBookedKeys) {
      const existing = byDate[key];
      if (!existing || existing === 'available') {
        byDate[key] = 'booked';
        const [yy, mm, dd] = key.split('-').map(Number);
        const dayDate = new Date(Date.UTC(yy, mm - 1, dd));
        await resolveBookingDetailsIfAllowed(dayDate, key);
      }
    }

    // Best-effort write-back so the row converges to the truth.
    if (slotsToHeal.length > 0) {
      try {
        await this.prisma.availabilitySlot.updateMany({
          where: { userId: targetUserId, date: { in: slotsToHeal }, status: 'booked' },
          data: { status: 'available' },
        });
      } catch {
        // Non-fatal — response is already correct.
      }
    }

    return { userId: targetUserId, year, month, slots: byDate, slotNotes, bookingDetails };
  }

  /** Individual/vendor sets work/equipment notes for a booked or past_work date. */
  async setSlotNote(userId: string, role: UserRole, dateOnly: string, notes: string) {
    if (role !== 'individual' && role !== 'vendor') {
      throw new ForbiddenException('Only individuals and vendors can set work notes');
    }
    const startOfDayUtc = this.parseDateOnlyAsUtc(dateOnly);
    const endOfDayUtc = new Date(startOfDayUtc);
    endOfDayUtc.setUTCDate(endOfDayUtc.getUTCDate() + 1);
    const slot = await this.prisma.availabilitySlot.findFirst({
      where: {
        userId,
        status: { in: ['booked', 'past_work'] },
        date: { gte: startOfDayUtc, lt: endOfDayUtc },
      },
    });
    if (!slot) {
      throw new BadRequestException(`No hired slot found for ${dateOnly}. That date must be part of an accepted booking.`);
    }
    await this.prisma.availabilitySlot.update({
      where: { id: slot.id },
      data: { notes: notes.trim() || null },
    });
    return { message: 'Notes updated' };
  }
}

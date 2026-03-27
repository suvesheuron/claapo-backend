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

    // Filter bookings that have this date in their shoot dates or project shoot dates
    const matchingBooking = bookings.find((b) => {
      // Check booking shoot dates
      if (b.shootDates && b.shootDates.length > 0) {
        const bookingDates = b.shootDates.map((d: Date) => this.toUtcDateKey(new Date(d)));
        if (bookingDates.includes(this.toUtcDateKey(date))) {
          return true;
        }
      }
      // Check project shoot dates
      if (b.project.shootDates && b.project.shootDates.length > 0) {
        const projectDates = b.project.shootDates.map((d: Date) => this.toUtcDateKey(new Date(d)));
        if (projectDates.includes(this.toUtcDateKey(date))) {
          return true;
        }
      }
      // Check project date range
      const projectStart = b.project.startDate ? this.toUtcDateKey(new Date(b.project.startDate)) : null;
      const projectEnd = b.project.endDate ? this.toUtcDateKey(new Date(b.project.endDate)) : null;
      if (projectStart && projectEnd) {
        const dateKey = this.toUtcDateKey(date);
        if (dateKey >= projectStart && dateKey <= projectEnd) {
          return true;
        }
      }
      return false;
    });

    if (!matchingBooking) {
      return null;
    }

    // Determine company and target user
    const isRequester = matchingBooking.requesterUserId === userId;
    const companyUser = isRequester ? matchingBooking.requester : matchingBooking.target;
    const targetUser = isRequester ? matchingBooking.target : matchingBooking.requester;

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
      message: matchingBooking.message,
      invoiceId: invoice?.id,
      invoiceStatus: invoice?.status,
      conversationId: conversation?.id,
    };
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
    
    for (const s of slots) {
      const key = this.toUtcDateKey(s.date);
      byDate[key] = s.status;
      slotNotes[key] = s.notes ?? null;
      
      // Get booking details for booked/past_work slots
      if (s.status === 'booked' || s.status === 'past_work') {
        const booking = await this.getBookingForDate(userId, s.date);
        if (booking) {
          bookingDetails[key] = booking;
        }
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
    for (const s of slots) {
      const key = this.toUtcDateKey(s.date);
      byDate[key] = s.status;
      slotNotes[key] = s.notes ?? null;
      if (s.status === 'booked' || s.status === 'past_work') {
        const booking = await this.getBookingForDate(targetUserId, s.date);
        if (booking?.id) {
          const row = await this.prisma.bookingRequest.findFirst({
            where: { id: booking.id as string },
            select: {
              requesterUserId: true,
              project: { select: { companyUserId: true } },
            },
          });
          const allowed =
            row &&
            (row.requesterUserId === viewerId || row.project.companyUserId === viewerId);
          if (allowed) {
            bookingDetails[key] = booking;
          }
        }
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

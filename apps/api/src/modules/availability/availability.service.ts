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
    for (const s of slots) {
      const key = this.toUtcDateKey(s.date);
      byDate[key] = s.status;
      slotNotes[key] = s.notes ?? null;
    }
    return { year, month, slots: byDate, slotNotes };
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

  /** Company views another user's calendar (masked: only available/booked/blocked, no project details). Includes notes for booked/past_work. */
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
    for (const s of slots) {
      const key = this.toUtcDateKey(s.date);
      byDate[key] = s.status;
      slotNotes[key] = s.notes ?? null;
    }
    return { userId: targetUserId, year, month, slots: byDate, slotNotes };
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

import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SlotInputDto } from './dto/bulk-availability.dto';

/** Only individual/vendor can set these via API. booked and past_work are system-managed. */
const USER_SETTABLE_STATUSES = ['available', 'blocked'] as const;

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get own calendar for a month. Returns slots keyed by date (YYYY-MM-DD) for mobile/UI. */
  async getMyCalendar(userId: string, year: number, month: number) {
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    const slots = await this.prisma.availabilitySlot.findMany({
      where: {
        userId,
        date: { gte: start, lte: end },
      },
      orderBy: { date: 'asc' },
    });
    const byDate: Record<string, string> = {};
    for (const s of slots) {
      const key = s.date.toISOString().slice(0, 10);
      byDate[key] = s.status;
    }
    return { year, month, slots: byDate };
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
      const d = new Date(s.date);
      d.setHours(0, 0, 0, 0);
      return d;
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
    const systemManagedDates = new Set(existing.map((s) => s.date.toISOString().slice(0, 10)));
    let updated = 0;
    for (const slot of slots) {
      const date = new Date(slot.date);
      date.setHours(0, 0, 0, 0);
      const key = date.toISOString().slice(0, 10);
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

  /** Company views another user's calendar (masked: only available/booked/blocked, no project details). */
  async getOtherUserCalendar(viewerId: string, viewerRole: UserRole, targetUserId: string, year: number, month: number) {
    if (viewerRole !== 'company') {
      throw new ForbiddenException('Only companies can view another user calendar');
    }
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null, isActive: true },
    });
    if (!target) throw new NotFoundException('User not found');
    const start = new Date(year, month, 1);
    const end = new Date(year, month + 1, 0);
    const slots = await this.prisma.availabilitySlot.findMany({
      where: { userId: targetUserId, date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
      select: { date: true, status: true },
    });
    const byDate: Record<string, string> = {};
    for (const s of slots) {
      byDate[s.date.toISOString().slice(0, 10)] = s.status;
    }
    return { userId: targetUserId, year, month, slots: byDate };
  }
}

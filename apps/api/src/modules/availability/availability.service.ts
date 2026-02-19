import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SlotInputDto } from './dto/bulk-availability.dto';

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

  /** Bulk set availability (individual/vendor). Replaces or creates slots for given dates. */
  async bulkSet(userId: string, role: UserRole, slots: SlotInputDto[]) {
    if (role !== 'individual' && role !== 'vendor') {
      throw new ForbiddenException('Only individuals and vendors can set availability');
    }
    for (const slot of slots) {
      const date = new Date(slot.date);
      date.setHours(0, 0, 0, 0);
      await this.prisma.availabilitySlot.upsert({
        where: {
          userId_date: { userId, date },
        },
        create: {
          userId,
          date,
          status: slot.status,
          notes: slot.notes,
        },
        update: { status: slot.status, notes: slot.notes },
      });
    }
    return { message: 'Availability updated', count: slots.length };
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

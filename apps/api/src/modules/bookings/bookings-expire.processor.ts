import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUEUE_BOOKINGS_EXPIRE } from '../../common/queue/queue.constants';
import { isQueueEnabled } from '../../common/queue/queue.helpers';

/**
 * Periodic worker that flips `pending` bookings whose `expires_at` is in the
 * past to `expired`, then notifies the requesting company so they can re-book
 * if needed.
 *
 * Runs as a BullMQ repeatable job — see BookingsService.onApplicationBootstrap
 * for scheduling. Idempotent: a re-run finds no pending+overdue rows and exits.
 */
@Processor(QUEUE_BOOKINGS_EXPIRE)
export class BookingsExpireProcessor extends WorkerHost {
  private readonly logger = new Logger('BookingsExpire');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(_job: Job<unknown, unknown, string>): Promise<{ expired: number }> {
    if (!isQueueEnabled()) {
      // Defense in depth — if a stale repeatable tick fires while the flag is
      // off, do nothing. The producer also won't have scheduled new ticks.
      return { expired: 0 };
    }

    // Capture the rows we expire so we can fan out notifications afterwards
    // without a follow-up query.
    const candidates = await this.prisma.bookingRequest.findMany({
      where: { status: 'pending', expiresAt: { lt: new Date() } },
      select: {
        id: true,
        requesterUserId: true,
        targetUserId: true,
        project: { select: { title: true } },
      },
    });

    if (candidates.length === 0) return { expired: 0 };

    const ids = candidates.map((c) => c.id);
    const result = await this.prisma.bookingRequest.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data: { status: 'expired' },
    });

    // Notify the company that requested the booking. Best-effort — a failed
    // notification shouldn't roll back the status change.
    await Promise.allSettled(
      candidates.map((c) =>
        this.notifications.createForUser(
          c.requesterUserId,
          'booking_expired',
          'Booking request expired',
          `Your booking request for "${c.project.title}" was not responded to in 48 hours and has expired.`,
          { bookingId: c.id, projectTitle: c.project.title },
        ),
      ),
    );

    this.logger.log(`expired ${result.count} pending booking(s)`);
    return { expired: result.count };
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from './notifications.service';
import { ChatService } from '../chat/chat.service';
import {
  QUEUE_NOTIFICATIONS,
  JOB_BOOKING_CREATED,
} from '../../common/queue/queue.constants';

export interface BookingCreatedJobData {
  bookingId: string;
}

/**
 * Consumer for `notifications.send`. Each job name corresponds to a domain
 * event ("booking-created"); the handler hydrates whatever data it needs from
 * the DB so we keep job payloads tiny (just an id) and resilient to producer
 * version skew.
 */
@Processor(QUEUE_NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger('NotificationsProcessor');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly chat: ChatService,
  ) {
    super();
  }

  async process(job: Job<unknown, unknown, string>): Promise<unknown> {
    switch (job.name) {
      case JOB_BOOKING_CREATED:
        return this.handleBookingCreated(job.data as BookingCreatedJobData);
      default:
        this.logger.warn(`unknown job name: ${job.name}`);
        return null;
    }
  }

  /**
   * Side effects of a new booking request:
   *   1. Create an in-app Notification for the target.
   *   2. Open/find the conversation and post a chat summary message.
   *
   * Both are best-effort — a failure on (2) doesn't roll back (1). The producer
   * has already committed the BookingRequest; this consumer just amplifies it.
   */
  private async handleBookingCreated({ bookingId }: BookingCreatedJobData): Promise<{ ok: true }> {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: { select: { id: true, title: true } } },
    });
    if (!booking) {
      this.logger.warn(`booking ${bookingId} not found — skipping side effects`);
      return { ok: true };
    }

    await this.notifications.createForUser(
      booking.targetUserId,
      'booking_request',
      'New booking request',
      `You have a new booking request for project: ${booking.project.title}`,
      {
        bookingId: booking.id,
        projectId: booking.projectId,
        projectTitle: booking.project.title,
      },
    );

    try {
      const rateStr = booking.rateOffered
        ? ` · Offered rate: ₹${(booking.rateOffered / 100).toLocaleString('en-IN')}/day`
        : '';
      const datesStr = `\n\n📅 You are being booked specifically for: ${booking.shootDates
        .map((d) =>
          d.toLocaleDateString('en-IN', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          }),
        )
        .join(', ')}\n(Only these date${booking.shootDates.length > 1 ? 's' : ''} will be marked unavailable on your calendar.)`;
      const customMsg = booking.message?.trim() ? `\n\nMessage: "${booking.message.trim()}"` : '';
      const chatContent = `Booking Request — ${booking.project.title}${rateStr}${datesStr}${customMsg}\n\nPlease accept or decline from your Bookings page.`;

      await this.chat.sendBookingRequestMessage(
        booking.requesterUserId,
        booking.targetUserId,
        booking.projectId,
        chatContent,
      );
    } catch (err) {
      this.logger.warn(`chat summary failed for booking ${bookingId}: ${(err as Error).message}`);
    }

    return { ok: true };
  }
}

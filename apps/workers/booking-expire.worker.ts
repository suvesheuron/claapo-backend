import { Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { createRedisConnection } from './redis';
import { QUEUE_BOOKING_EXPIRE, type BookingExpireJobPayload } from './shared';

const connection = createRedisConnection();
const prisma = new PrismaClient();

const worker = new Worker<BookingExpireJobPayload>(
  QUEUE_BOOKING_EXPIRE,
  async (job) => {
    if (job.name !== 'expire') return;
    const { bookingId } = job.data;

    const booking = await prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { project: true },
    });
    if (!booking || booking.status !== 'pending') return;

    await prisma.$transaction([
      prisma.bookingRequest.update({
        where: { id: bookingId },
        data: { status: 'expired' },
      }),
      prisma.notification.create({
        data: {
          userId: booking.requesterUserId,
          type: 'booking_expired',
          title: 'Booking request expired',
          body: `Your booking request for project "${booking.project.title}" expired without response.`,
          data: { bookingId, projectId: booking.projectId },
        },
      }),
    ]);
  },
  {
    connection: connection as any,
    concurrency: 5,
  },
);

worker.on('completed', (job) => console.log(`[BookingExpire] Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`[BookingExpire] Job ${job?.id} failed:`, err.message));

async function close() {
  await worker.close();
  connection.disconnect();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);

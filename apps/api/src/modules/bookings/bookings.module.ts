import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { BookingsExpireProcessor } from './bookings-expire.processor';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatModule } from '../chat/chat.module';
import {
  QUEUE_BOOKINGS_EXPIRE,
  QUEUE_NOTIFICATIONS,
} from '../../common/queue/queue.constants';

@Module({
  imports: [
    NotificationsModule,
    ChatModule,
    // Queues this module either produces to or consumes from. Registered
    // unconditionally — the QUEUE_ENABLED flag is checked by the producer at
    // enqueue time and by the processor's body.
    BullModule.registerQueue(
      { name: QUEUE_BOOKINGS_EXPIRE },
      { name: QUEUE_NOTIFICATIONS },
    ),
  ],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsExpireProcessor],
  exports: [BookingsService],
})
export class BookingsModule {}

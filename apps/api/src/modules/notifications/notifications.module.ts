import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsController } from './notifications.controller';
import { DevicesController } from './devices.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';
import { ChatModule } from '../chat/chat.module';
import { QUEUE_NOTIFICATIONS } from '../../common/queue/queue.constants';

@Module({
  imports: [
    // The processor needs ChatService for the booking-created chat summary.
    // forwardRef breaks the BookingsModule ↔ NotificationsModule cycle that
    // would otherwise form (Bookings imports Notifications; the notifications
    // processor reaches into chat which is independent — no actual cycle here,
    // but using forwardRef defensively in case Chat ever imports back.)
    forwardRef(() => ChatModule),
    BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS }),
  ],
  controllers: [NotificationsController, DevicesController],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}

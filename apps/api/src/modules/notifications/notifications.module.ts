import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { DevicesController } from './devices.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController, DevicesController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

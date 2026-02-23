import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { SearchModule } from './modules/search/search.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { ChatModule } from './modules/chat/chat.module';
import { QueueModule } from './queue/queue.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    QueueModule,
    AuthModule,
    ProfilesModule,
    AvailabilityModule,
    ProjectsModule,
    BookingsModule,
    SearchModule,
    InvoicesModule,
    WebhooksModule,
    NotificationsModule,
    AdminModule,
    ChatModule,
  ],
  controllers: [AppController],
})
export class AppModule {}

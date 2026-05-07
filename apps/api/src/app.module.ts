import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import { BullModule } from '@nestjs/bullmq';
import { APP_GUARD } from '@nestjs/core';
import type Redis from 'ioredis';
import configuration from './config/configuration';
import { RedisModule } from './common/redis/redis.module';
import { REDIS_CLIENT } from './common/redis/redis.constants';
import { AppCacheModule } from './common/cache/cache.module';
import { ConditionalThrottlerGuard } from './common/throttler/conditional-throttler.guard';
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
import { EquipmentModule } from './modules/equipment/equipment.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    RedisModule,
    AppCacheModule,
    ThrottlerModule.forRootAsync({
      // One global tier (200 req/min/IP). Tighter limits live at the route level
      // via @Throttle({ default: { limit: N, ttl: M } }). In @nestjs/throttler v6
      // every throttler named in forRoot runs globally on every route — so we
      // only register the most permissive one here, and per-route decorators
      // override it where needed.
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (_config: ConfigService, redis: Redis) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 200 }],
        storage: new ThrottlerStorageRedisService(redis),
      }),
    }),
    // BullMQ uses its own ioredis connection (separate from REDIS_CLIENT) because
    // BullMQ requires `maxRetriesPerRequest: null` and a dedicated subscriber.
    // Wired regardless of QUEUE_ENABLED — the flag is checked by producers at
    // enqueue time. If the flag is off, queues sit idle and consume no work.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host') ?? 'localhost',
          port: config.get<number>('redis.port') ?? 6379,
          password: config.get<string | undefined>('redis.password'),
          db: config.get<number>('redis.db') ?? 0,
        },
      }),
    }),
    DatabaseModule,
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
    EquipmentModule,
    ReviewsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ConditionalThrottlerGuard,
    },
  ],
})
export class AppModule {}

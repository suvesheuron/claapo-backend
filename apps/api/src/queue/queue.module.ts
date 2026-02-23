import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import {
  QUEUE_SMS,
  QUEUE_EMAIL,
  QUEUE_PUSH,
  QUEUE_PDF,
  QUEUE_BOOKING_EXPIRE,
} from './queue.constants';

function parseRedisUrl(url: string): { host: string; port: number; password?: string; db?: number } {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '6379', 10),
      password: u.password ? decodeURIComponent(u.password) : undefined,
      db: u.pathname && u.pathname.length > 1 ? parseInt(u.pathname.slice(1), 10) : undefined,
    };
  } catch {
    return { host: 'localhost', port: 6379 };
  }
}

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('redis.url') ?? 'redis://localhost:6379';
        const conn = parseRedisUrl(url);
        return {
          connection: {
            host: conn.host,
            port: conn.port,
            password: conn.password,
            db: conn.db,
            maxRetriesPerRequest: null,
          },
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: QUEUE_SMS },
      { name: QUEUE_EMAIL },
      { name: QUEUE_PUSH },
      { name: QUEUE_PDF },
      { name: QUEUE_BOOKING_EXPIRE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}

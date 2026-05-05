import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

const logger = new Logger('Redis');

function buildClient(config: ConfigService): Redis {
  const host = config.get<string>('redis.host') ?? 'localhost';
  const port = config.get<number>('redis.port') ?? 6379;
  const password = config.get<string | undefined>('redis.password');
  const db = config.get<number>('redis.db') ?? 0;

  const client = new Redis({
    host,
    port,
    password,
    db,
    lazyConnect: false,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  client.on('connect', () => logger.log(`connected ${host}:${port} db=${db}`));
  client.on('ready', () => logger.log('ready'));
  client.on('reconnecting', (delay: number) => logger.warn(`reconnecting in ${delay}ms`));
  client.on('error', (err: Error) => logger.error(`error: ${err.message}`));
  client.on('end', () => logger.warn('connection closed'));

  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildClient(config),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch (err) {
      logger.warn(`quit failed: ${(err as Error).message}`);
    }
  }
}

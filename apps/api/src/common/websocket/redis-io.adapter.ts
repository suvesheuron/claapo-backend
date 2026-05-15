import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { INestApplication } from '@nestjs/common';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * Socket.IO adapter backed by Redis pub/sub.
 *
 * Why this exists: the default in-memory IoAdapter keeps room membership and
 * broadcasts inside the single Node process. As soon as the API runs more
 * than one instance behind a load balancer, sockets connected to instance A
 * stop seeing messages emitted by instance B — new_message, typing_start,
 * read_ack, notification_created etc. silently fail to fan out.
 *
 * The Redis adapter (`@socket.io/redis-adapter`) uses pub/sub channels to
 * forward every `server.to(room).emit(...)` and `client.join(room)` across
 * all instances. The gateway code is unchanged — the adapter is transparent.
 *
 * Two Redis connections are required: one for PUBLISH (reuses the existing
 * REDIS_CLIENT, since pub-only ops don't conflict with the cache reads
 * elsewhere) and one dedicated SUBSCRIBE connection (duplicated from the
 * pub client). A connection in subscribe mode cannot service other commands,
 * so the duplicate is required by the Redis protocol.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger('RedisIoAdapter');
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;

  constructor(private readonly app: INestApplication) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const pubClient = this.app.get<Redis>(REDIS_CLIENT);
    const subClient = pubClient.duplicate();
    subClient.on('error', (err) =>
      this.logger.error(`sub client error: ${err.message}`),
    );
    subClient.on('reconnecting', (delay: number) =>
      this.logger.warn(`sub client reconnecting in ${delay}ms`),
    );
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Socket.IO Redis adapter ready');
  }

  override createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    if (!this.adapterConstructor) {
      this.logger.warn(
        'createIOServer called before connectToRedis — falling back to in-memory adapter',
      );
      return server;
    }
    server.adapter(this.adapterConstructor);
    return server;
  }
}

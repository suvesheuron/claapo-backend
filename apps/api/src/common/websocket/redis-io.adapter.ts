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

    // Force both clients to actually open a connection and complete a
    // round-trip before we hand them to Socket.IO. ioredis is "lazy" — the
    // socket isn't opened until a command runs, so passing the clients to
    // createAdapter() without a ping can cause Socket.IO to hang at boot
    // (subscribe queued behind an unopened TLS+AUTH handshake).
    // 60s budget covers slow first-time TLS handshake to ElastiCache.
    const pingWithTimeout = async (c: Redis, name: string) => {
      const ping = c.ping();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${name} ping timed out after 60s`)), 60_000),
      );
      await Promise.race([ping, timeout]);
      this.logger.log(`${name} ping OK`);
    };

    await Promise.all([
      pingWithTimeout(pubClient, 'pubClient'),
      pingWithTimeout(subClient, 'subClient'),
    ]);

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

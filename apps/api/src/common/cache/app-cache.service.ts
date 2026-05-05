import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * Thin Redis-backed cache. Built directly on ioredis (which we already have via
 * RedisModule) instead of cache-manager + a store adapter — fewer abstraction
 * layers, no version-compat issues, and the API surface we need is tiny.
 *
 * Honors the CACHE_ENABLED env flag. When disabled, every method becomes a
 * loader-only no-op so the surrounding code path is identical to "no cache".
 */
@Injectable()
export class AppCacheService {
  private readonly logger = new Logger('Cache');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private get enabled(): boolean {
    return process.env.CACHE_ENABLED === 'true';
  }

  /**
   * Cache-aside read. On miss, runs `loader`, stores the result, and returns it.
   * `null` is cacheable (so a confirmed-absent record doesn't re-hit the DB).
   * `undefined` is NOT cached (surfaces as a miss next time).
   * Cache failures are logged and degraded to a direct loader call.
   */
  async wrap<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    if (!this.enabled) return loader();
    try {
      const raw = await this.redis.get(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`GET ${key} failed: ${(err as Error).message}`);
    }
    const value = await loader();
    if (value !== undefined) {
      try {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      } catch (err) {
        this.logger.warn(`SETEX ${key} failed: ${(err as Error).message}`);
      }
    }
    return value;
  }

  /** Delete one or more cache keys. No-op when caching is disabled. */
  async del(...keys: string[]): Promise<void> {
    if (!this.enabled || keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(`DEL [${keys.join(', ')}] failed: ${(err as Error).message}`);
    }
  }
}

import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

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

export function createRedisConnection(): Redis {
  const conn = parseRedisUrl(REDIS_URL);
  return new Redis({
    host: conn.host,
    port: conn.port,
    password: conn.password,
    db: conn.db,
    maxRetriesPerRequest: null,
  });
}

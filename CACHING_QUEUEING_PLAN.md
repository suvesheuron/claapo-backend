# CrewCall — Caching, Queueing & Rate-Limiting Plan (Simplified)

**Goal:** Add Redis-backed rate limiting, caching, and BullMQ queueing to `crewcall-backend` (and the small frontend follow-ups) **without breaking the running app**.

**Out of scope (intentional — defer to a later effort):**
- Multi-pod WebSocket scaling (Socket.IO Redis adapter)
- DeviceToken / multi-device FCM push
- Search index optimization (GIN, trigram)
- Sentry / Prometheus metrics / audit log
- Frontend Socket.IO migration

These are listed in `PRODUCTION_READINESS.md` and remain valuable, but they are not what this plan delivers.

**Plan date:** 2026-05-04

---

## Ground rules

1. **One phase = one PR.** Each phase is independently shippable and revertible.
2. **One feature flag per phase** (`THROTTLER_ENABLED`, `CACHE_ENABLED`, `QUEUE_ENABLED`). Default OFF until verified locally, then flipped ON.
3. **Workers run inside the API process for now.** BullMQ consumers are `@Processor` classes registered in the same Nest app. No separate `apps/workers` project. We can split it out later if/when load demands it.
4. **Use off-the-shelf packages.** No custom Lua scripts, no custom storage adapters.
5. **Don't break behavior.** Every change is additive or flag-gated.

---

## Phase 1 — Foundations (½–1 day)

**What:** Stand up Redis, install packages, add env validation, harden the bootstrap.

**Why first:** Every later phase needs the Redis client + a sane bootstrap.

### 1.1 Redis container

Add to `docker-compose.yml`:

```yaml
  redis:
    image: redis:7-alpine
    container_name: claapo-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--maxmemory", "256mb", "--maxmemory-policy", "allkeys-lru"]
    ports: ["${REDIS_PORT:-6379}:6379"]
    volumes: [claapo_redisdata:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Add `claapo_redisdata` to the `volumes:` block.

### 1.2 Env additions (`.env.example` + `.env`)

```
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

THROTTLER_ENABLED=false
CACHE_ENABLED=false
QUEUE_ENABLED=false
```

### 1.3 Packages

```bash
npm i ioredis \
      @nestjs/throttler @nestjs/throttler-storage-redis \
      @nestjs/cache-manager cache-manager cache-manager-ioredis-yet \
      @nestjs/bullmq bullmq \
      @nestjs/schedule
```

(Notable: `@nestjs/throttler-storage-redis` is the official Redis storage — no custom code needed.)

### 1.4 Config + validation

- Add `redis: { host, port, password, db }` and feature-flag booleans to `apps/api/src/config/configuration.ts`.
- Drop the `'dev-secret-change-in-production'` fallback for `JWT_SECRET` and `JWT_REFRESH_SECRET` — these must be set.
- Skip Joi for now. Just add a tiny boot-time check at the top of `main.ts`:
  ```ts
  if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
    throw new Error('JWT_SECRET and JWT_REFRESH_SECRET are required');
  }
  ```

### 1.5 Redis module

Create `apps/api/src/common/redis/redis.module.ts`:
- `@Global()` module
- One `ioredis` `Redis` instance, exported as token `REDIS_CLIENT`
- Logs `connect`, `error`, `reconnecting`

That's it. No pub/sub clients yet (we don't need them — no Socket.IO adapter in this plan).

Import `RedisModule` in `AppModule`.

### 1.6 Verification

- `docker compose up -d redis` → `redis-cli ping` returns `PONG`.
- API boots with Redis healthy.
- API refuses to boot if `JWT_SECRET` is absent.
- Frontend login still works (no behavior change).

### 1.7 Rollback

Revert the PR. No migrations, no code paths depend on Redis yet.

---

## Phase 2 — Rate limiting (1 day)

**What:** Add `@nestjs/throttler` with Redis storage. Two tiers: a global default and a tighter one for auth. Frontend handles 429 with one retry.

### 2.1 Throttler wiring


In `AppModule`:

```ts
ThrottlerModule.forRootAsync({
  imports: [RedisModule],
  inject: [REDIS_CLIENT, ConfigService],
  useFactory: (redis, config) => ({
    throttlers: [
      { name: 'default', ttl: 60_000, limit: 200 },
      { name: 'auth',    ttl: 60_000, limit: 10 },
    ],
    storage: new ThrottlerStorageRedisService(redis),
  }),
}),
```

Add a global guard via `APP_GUARD`, but wrap it: when `THROTTLER_ENABLED=false`, the guard short-circuits to `true`.

### 2.2 Per-route overrides

- `@Throttle({ auth: { limit: 10, ttl: 60_000 } })` on:
  - `POST /auth/login`
  - `POST /auth/register/*`
  - `POST /auth/refresh`
  - `POST /auth/otp/send`
  - `POST /auth/password/reset/request`
  - `POST /auth/password/reset/confirm`
- `@SkipThrottle()` on:
  - the webhooks controller (Razorpay needs uncapped access)
  - `/health/*` (when we add it)

Skip the per-phone OTP keying for now. The IP-based 10/min limit is enough as a v1; if abuse shows up in logs, add the custom guard later.

### 2.3 Frontend — 429 handling

In `crewcall-frontend/src/services/api.ts`:
- On `429`, read `Retry-After` (seconds). If ≤ 5, wait + 250 ms jitter, retry **once**. Otherwise propagate.
- That's it. Skip request dedup for now — premature optimization without data.

Bump `Chat.tsx` poll interval `4000` → `8000` so it can't trip the global limit during a long-running session.

### 2.4 Verification

- `THROTTLER_ENABLED=false`: no behavior change.
- `THROTTLER_ENABLED=true`:
  - 11th rapid `/auth/login` returns 429.
  - 201st rapid request from one IP in 60 s returns 429.
  - Webhooks unaffected.
- Normal user flow (login → dashboard → search → chat) never trips a 429.

### 2.5 Rollback

Set `THROTTLER_ENABLED=false`.

---

## Phase 3 — Caching (1–2 days)

**What:** Wire `@nestjs/cache-manager` against Redis. Cache only the three highest-leverage reads. Add the cheap `unread-count` endpoint that the frontend can adopt.

### 3.1 Cache module

Create `apps/api/src/common/cache/cache.module.ts` — registers `CacheModule` with `cache-manager-ioredis-yet` using the existing Redis client. `@Global()`.

Create `apps/api/src/common/cache/cache.helpers.ts` — one helper:

```ts
async function cached<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>
```

When `CACHE_ENABLED=false`, `cached()` skips Redis and just calls `loader()`. Keep the API the same so flipping the flag is safe.

### 3.2 The three caches

| # | What | Where | TTL | Invalidation |
|---|---|---|---|---|
| C1 | `mainUserId` lookup | Collapse the 6 call sites in `chat.service.ts` (lines 24, 162, 272, 410, 514, 561) into one helper using `cached('user:${id}:mainUserId', 3600, ...)` | 1h | On `users.update` (auth/profile services call `cache.del`) |
| C2 | Signed avatar/cover URLs | `profiles.service.ts` and `storage.service.ts` where `getSignedUrl` is called per request | 25m | On avatar/cover replace |
| C3 | Unread notification count | New method `notifications.service.getUnreadCount(userId)` | 30s, plus `cache.del` on message send / mark-as-read / notification create | (write-through) |

Three is enough to demonstrate value and prove invalidation hygiene. We can add more later, driven by hit-rate data, not guesses.

### 3.3 New endpoint

`GET /notifications/unread-count` → `{ count: number }`. Cached per C3 above.

### 3.4 Frontend adoption

`crewcall-frontend/src/contexts/ChatUnreadContext.tsx` — switch the 20s poll from `GET /conversations?limit=100` to `GET /notifications/unread-count`. Same interval. Massive payload reduction.

Leave `NavBadgesContext` alone in this phase.

### 3.5 Verification

- `CACHE_ENABLED=true`: hit `/profile/me` twice; `redis-cli MONITOR` shows a GET hit on the second call.
- Update profile → next read returns fresh data.
- Send a message → recipient's `/notifications/unread-count` increments within 30 s.
- `redis-cli INFO memory` stays under 50 MB during normal browsing.

### 3.6 Rollback

`CACHE_ENABLED=false`. Helpers fall through to direct DB reads.

---

## Phase 4 — Queueing (2–3 days)

**What:** Add BullMQ. Two queues, both running as `@Processor` inside the API process. The first fixes a missing feature (booking auto-expiry). The second moves notification creation off the request path.

### 4.1 BullMQ wiring

In `AppModule`:

```ts
BullModule.forRootAsync({
  imports: [RedisModule],
  inject: [ConfigService],
  useFactory: (config) => ({
    connection: {
      host: config.get('redis.host'),
      port: config.get('redis.port'),
      password: config.get('redis.password') || undefined,
      db: config.get('redis.db'),
    },
  }),
}),
```

Create `apps/api/src/common/queue/queue.constants.ts`:

```ts
export const QUEUE_BOOKINGS_EXPIRE = 'bookings.expire';
export const QUEUE_NOTIFICATIONS   = 'notifications.send';
```

Register both via `BullModule.registerQueue` in their respective feature modules.

Wrap `queue.add(...)` calls in a tiny producer helper that no-ops when `QUEUE_ENABLED=false` (falls back to the inline path so behavior is unchanged).

### 4.2 Queue 1 — `bookings.expire` (fixes a real bug)

This is the most valuable single change in the plan: today, expired bookings just sit in `pending` forever.

- Add Prisma index `@@index([status, expiresAt])` on `BookingRequest`. Generate migration.
- In `BookingsModule`, on `OnApplicationBootstrap`, register a repeatable job:
  ```ts
  await this.expireQueue.add(
    'tick',
    {},
    { repeat: { every: 5 * 60_000 }, jobId: 'bookings-expire-tick' }
  );
  ```
  `jobId` is fixed, so re-registering is idempotent.
- Create `apps/api/src/modules/bookings/bookings-expire.processor.ts` (`@Processor('bookings.expire')`):
  ```sql
  UPDATE booking_requests
     SET status = 'expired', updated_at = NOW()
   WHERE status = 'pending' AND expires_at < NOW()
   RETURNING id, requester_user_id, target_user_id;
  ```
  For each row, write a Notification (and later, when push is wired, enqueue a push job).
- Concurrency 1, exponential backoff, 5 attempts.

### 4.3 Queue 2 — `notifications.send` (moves work off the request path)

Today, `bookings.service.ts:240-263` does:
```
await prisma.bookingRequest.create(...);
await notifications.createForUser(...);   // sync
await chat.sendBookingRequestMessage(...); // sync
return result;
```

After:
```
await prisma.bookingRequest.create(...);
if (QUEUE_ENABLED) await notificationsQueue.add('booking-created', { bookingId });
else { /* legacy inline path */ }
return result;
```

- Create `apps/api/src/modules/notifications/notifications.processor.ts` (`@Processor('notifications.send')`).
- Job handlers: `booking-created`, `booking-accepted`, `booking-cancelled`. Each loads the booking, writes Notification rows, posts the chat summary message.
- This is the **only** producer migration in this phase. Other side effects (PDF, Razorpay webhook async, admin broadcast) stay on the table for later — they each have their own complications and aren't blocking us today.

### 4.4 Frontend

No changes needed. The user-facing behavior is identical, just faster on the request path.

### 4.5 Verification

- `QUEUE_ENABLED=false`: behavior identical to before this PR.
- `QUEUE_ENABLED=true`:
  - Insert a `BookingRequest` with `expiresAt = NOW() - 1 minute`. Within 5 minutes the worker flips it to `expired`.
  - `redis-cli` shows the repeatable job.
  - `POST /bookings/request` returns measurably faster (no inline notification wait).
  - Recipient sees the notification within 5–10 s.
  - Killing the API and restarting → no duplicate jobs (idempotent `jobId`); pending jobs resume.
  - Forcing an exception in the processor → BullMQ retries with backoff; eventually lands in `failed` set.

### 4.6 Rollback

`QUEUE_ENABLED=false`. Producers no-op the enqueue and the legacy inline path runs. Repeatable job stays in Redis but does nothing harmful.

---

## Cross-cutting checklist

Every phase, before merging:

- [ ] `npm run build` passes.
- [ ] `npm run lint` passes.
- [ ] Both flag states (ON / OFF) tested locally.
- [ ] One real flow exercised end-to-end via the frontend.
- [ ] No new ESLint warnings.

---

## Phase summary

| Phase | Scope | Days | Risk | Visible to user |
|---|---|---|---|---|
| 1 | Redis container + packages + RedisModule + env check | ½–1 | Low | No |
| 2 | Throttler (default + auth) + frontend 429 retry | 1 | Low–Med | Negligible if tuned |
| 3 | Cache layer + 3 caches + `unread-count` endpoint | 1–2 | Low | Faster reads, smaller polls |
| 4 | BullMQ + `bookings.expire` + `notifications.send` | 2–3 | Med | New: bookings auto-expire |

**Total: ~5–7 working days** for one engineer. About a third of the original plan.

---

## What this plan does NOT deliver (and that's OK)

These remain in `PRODUCTION_READINESS.md` for a future effort:

- Multi-pod chat (Socket.IO Redis adapter, `fetchSockets` removal, per-socket WS rate limit)
- Multi-device push (DeviceToken table + FCM consumer)
- PDF generation worker (Puppeteer + S3)
- Razorpay async webhook + idempotency table
- Admin broadcast in batches
- Cleanup crons (refresh tokens, OTP sessions, soft-deleted messages)
- DB index work (GIN, trigram, covering indexes)
- Frontend Socket.IO migration (drop the chat poll entirely)
- Helmet / compression / Pino / Terminus health / shutdown hooks
- Audit log / Sentry / Prometheus

If/when one of these becomes urgent, lift it out of `PRODUCTION_READINESS.md` into its own focused plan. Don't bolt them onto this one.

---

## Tracking

Tick the boxes inline as work lands. When a phase ships, append:

> _Completed: YYYY-MM-DD — PR #NNN_

# CrewCall Backend — Production Readiness Plan

**Target:** Handle **5,000 concurrent users** (web + mobile + WebSocket chat) with sub-300ms p95 API latency, no data loss, horizontal scalability.

**Audit date:** 2026-05-03
**Scope:** `crewcall-backend/` (NestJS 10 + Prisma 5 + PostgreSQL + Socket.IO 4)

---

## 0. Verdict: NOT Production-Grade

The codebase is well-structured for an MVP and the domain logic is solid, but it is **not ready for 5,000 concurrent users**. There are **4 critical blockers** that will cause outages, data loss, or security incidents under load, and ~25 high/medium issues that will severely degrade UX.

### The 4 Critical Blockers

| # | Blocker | Impact at 5k CCU |
|---|---------|------------------|
| 1 | **No Socket.IO Redis adapter** + `server.in().fetchSockets()` in `chat.gateway.ts:123` | Cannot scale beyond a single Node process. Messages sent on node A never reach clients on node B. WebSocket is single-point-of-failure. |
| 2 | **Bcrypt rounds = 12** (`auth.service.ts:18`) blocking the event loop | 250ms per hash × 5k concurrent logins = event-loop starvation. All non-auth requests hang. |
| 3 | **JWT_SECRET silently falls back** to `'dev-secret-change-in-production'` (`config/configuration.ts:11`) | If the env var is missing in prod, attackers can forge any access token. No fail-loud check. |
| 4 | **No queue / background worker** (BullMQ stubbed but empty) — PDF generation, FCM/SMS push, 48h booking expiry, broadcast notifications all run synchronously or never run | API requests block on external I/O; expired bookings accumulate; users miss push notifications; admin broadcasts time out. |

**Until these are fixed, do not load-test beyond ~200 concurrent users.**

---

## 1. What's Missing at the Infrastructure Layer

Inspecting `package.json`, `main.ts`, and `app.module.ts`, the following production essentials are **not installed**:

| Concern | Missing | What to add |
|---|---|---|
| Rate limiting | `@nestjs/throttler` | Global guard + per-route overrides (auth, chat, search) |
| HTTP security headers | `helmet` | `app.use(helmet())` in `main.ts` |
| Response compression | `compression` | `app.use(compression())` |
| Health checks | `@nestjs/terminus` | `/health/live`, `/health/ready` (DB + Redis) |
| Structured logging | `nestjs-pino` (Pino) | Replace `quietLogger` in `main.ts` — current logger silently drops Nest internals, no JSON, no request IDs |
| Cache layer | `@nestjs/cache-manager` + `ioredis` | Redis client + cache decorator for hot reads |
| Queue / workers | `bullmq` + `@nestjs/bullmq` | Background jobs (FCM, PDF, expiry cron, broadcasts) |
| WebSocket scaling | `@socket.io/redis-adapter` | Multi-node fan-out (currently single-process only) |
| Observability | `@sentry/node` + `@opentelemetry/sdk-node` | Error tracking + distributed traces + metrics |
| Schema validation | env validation via `joi` or `zod` | Fail-loud on missing `JWT_SECRET`, `DATABASE_URL`, `RAZORPAY_*`, `SUPABASE_*` at boot |
| Process manager | none (single process) | Run under PM2 cluster mode (4 workers/box) or Kubernetes Deployment with HPA |

Other infra issues spotted:

- **`main.ts:47`** — CORS reflects any origin when `*` is in the list **with `credentials: true`**. This is dangerous; use a strict allowlist in prod.
- **`main.ts:73`** — Swagger UI exposed at `/docs` unconditionally. Gate behind `NODE_ENV !== 'production'` or basic auth.
- **`main.ts:19-33`** — Custom `quietLogger` swallows `InstanceLoader`, `RoutesResolver`, etc. and uses `console.log`. Replace with Pino + request-ID middleware so logs are JSON, sampled, and shippable to Datadog/Loki.
- **`prisma.service.ts:8`** — Prisma client logs only `error`/`warn`. Add `event: 'query'` log with duration threshold (>200ms) for slow-query alerts. Tune `connection_limit` in `DATABASE_URL` (default ~10 is too low for 5k CCU; aim for `pool_size = (instances × concurrent_per_instance)`).
- **No graceful shutdown** — `app.enableShutdownHooks()` not called. SIGTERM during deploy will drop in-flight WebSocket frames and HTTP requests.

---

## 2. Target Architecture for 5,000 Concurrent Users

```
                   ┌───────────────────┐
                   │  Cloudflare/ALB   │  (sticky sessions for /chat namespace)
                   └────────┬──────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   ┌─────────┐         ┌─────────┐         ┌─────────┐
   │ API #1  │   ...   │ API #N  │  (4–8 NestJS pods, 2 vCPU / 2 GB each)
   └────┬────┘         └────┬────┘         └────┬────┘
        │                   │                   │
        └────────┬──────────┴──────────┬────────┘
                 │                     │
        ┌────────▼────────┐   ┌────────▼────────┐
        │ Postgres 15     │   │ Redis 7         │
        │ - primary +     │   │ - cache         │
        │   read replica  │   │ - rate limit    │
        │ - pgbouncer     │   │ - socket.io     │
        │ - pg_trgm/FTS   │   │   adapter       │
        └─────────────────┘   │ - BullMQ queue  │
                              └─────────────────┘
                                       │
                              ┌────────▼────────┐
                              │ Worker pods     │
                              │ - FCM push      │
                              │ - PDF render    │
                              │ - Booking expiry│
                              │ - Broadcasts    │
                              └─────────────────┘

Object storage: S3 or Supabase (NOT local disk).
```

### Capacity sizing (5k CCU baseline)

| Resource | Target | Reasoning |
|---|---|---|
| API pods | 4–8 | ~700–1200 CCU per pod (Node single-thread + bcrypt offload) |
| WebSocket connections | 5k peak | Sticky LB; each pod holds ~700 sockets, ~30 MB |
| Postgres connections | ≤200 | PgBouncer transaction pooling; per-pod Prisma pool ≤25 |
| Redis | 1 GB | Cache + adapter pub/sub + queue + rate-limit counters |
| Workers | 2 pods × 4 concurrency | PDF + FCM are I/O bound |
| Outbound RPS | ~300–600 | API reads + write mix |
| Inbound msg rate | ~50 msg/sec at peak | Chat + typing + read receipts |

---

## 3. Per-Module Findings (Detailed)

### 3.1 Chat (`modules/chat/`) — The biggest scaling risk

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| C1 | `server.in(room).fetchSockets()` only sees sockets on **the current process** | `chat.gateway.ts:123-135` | **Critical** | Add `@socket.io/redis-adapter`; replace loop with `server.to(room).emit(...)`; compute `isSameAccount` per recipient in a small post-publish hook or stop personalising and let clients flip side via cached `mainUserId`. |
| C2 | `mainUserId` lookup repeated 6+ times per user via `user.findUnique` | `chat.service.ts:24,162,272,410,514,561` | High | Cache `user:{id}:mainUserId` in Redis (TTL 1h, invalidate on user update). Already cached in `socket.data` for WebSocket — reuse there too. |
| C3 | `canAccessConversation` runs subuser-assignment lookup on every call inside a 100-row loop in `findMostRecentAccessibleConversationWithUser` | `chat.service.ts:567-585` | High | Lower `take` to 10 with early exit; cache `conv:{id}:access:{userId}` boolean for 5 min. |
| C4 | Message search uses `contains` (ILIKE), no index | `chat.service.ts:725` | Medium | Add Postgres `pg_trgm` GIN index on `messages.content`; or push search to Meilisearch. |
| C5 | No rate limit on `send_message`, `typing_start` | `chat.gateway.ts:106,142` | High | Per-socket Redis token bucket (e.g., 5 messages/sec, 20 typing/sec). Disconnect on persistent abuse. |
| C6 | `markAsRead` not in transaction with conversation update | `chat.service.ts:457` | Medium | Wrap in `prisma.$transaction`. Denormalise `unreadCount` onto `Conversation` to avoid in-memory `.filter()` per request. |
| C7 | No TTL/archive policy — `messages` table grows unbounded | schema.prisma `Message` | Medium | Nightly job: hard-delete soft-deleted messages older than 90 days; archive `messages` older than 12 months to cold partition. |
| C8 | `isSameAccount` logic duplicated in 3 places (service, gateway, frontend) | `chat.service.ts:312`, `chat.gateway.ts:130`, `Chat.tsx` | Low | Extract `IsSameAccountUtil` in shared helper; also add unit tests since this is the most subtle business rule. |
| C9 | Missing index `(conversationId, deletedAt, createdAt)` on `Message` | schema.prisma:543 | Medium | Add `@@index([conversationId, deletedAt, createdAt])`. |

### 3.2 Auth (`modules/auth/`) — Security & event-loop hot spot

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| A1 | Bcrypt 12 rounds blocks event loop | `auth.service.ts:18,43,60` | **Critical** | Drop to 10 rounds (~80ms) **and** offload to `worker_threads` via `argon2` or `bcrypt`'s async API on a small worker pool. |
| A2 | `JWT_SECRET` falls back to a hardcoded dev string | `config/configuration.ts:11,17` | **Critical** | Add boot-time env validation (`joi`/`zod`); throw if `NODE_ENV=production` and any of `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, `RAZORPAY_WEBHOOK_SECRET` is missing. |
| A3 | OTP send has no per-phone/per-IP throttle | `auth.service.ts:132-153` | High | Rate-limit `POST /auth/otp/send` to 3/min per phone, 10/min per IP via `@nestjs/throttler` with Redis store. Reject duplicate active OTPs (reuse existing unexpired session). |
| A4 | Refresh-token rotation not atomic (find → revoke → issue across separate queries) | `auth.service.ts:250-268` | Medium | Wrap in `$transaction`. On detected re-use of a revoked token, **revoke the entire family** (already modeled via `family` column) and force re-login. |
| A5 | Token cleanup cron missing | `RefreshToken`, `OtpSession` tables | Medium | Hourly job: `DELETE FROM refresh_tokens WHERE expiresAt < NOW() OR revoked = true; DELETE FROM otp_sessions WHERE expiresAt < NOW() - INTERVAL '1 day'`. |
| A6 | `EXPOSE_OTP_IN_API=true` would leak OTPs in prod | `config/configuration.ts:5` | Medium | Hard-fail boot if `NODE_ENV=production && exposeOtpInApi`. |

### 3.3 Bookings (`modules/bookings/`)

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| B1 | No scheduler enforces 48h auto-expiry | `bookings.service.ts:224` | **Critical** | BullMQ repeatable job every 5 min: `UPDATE booking_requests SET status='expired' WHERE status='pending' AND expiresAt < NOW()`. Send notifications in batch. Add `@@index([status, expiresAt])`. |
| B2 | `accept` upserts `AvailabilitySlot` outside the same transaction as the status change → double-booking race | `bookings.service.ts:575-616` | High | Single `$transaction([ slot.upsert, booking.update ])`. Then re-check conflicts; on violation, raise `ConflictException` and let the client retry. |
| B3 | `lockAllProjectBookings` loads all `accepted` rows into memory, `Promise.all` over them | `bookings.service.ts:1029-1071` | Medium | Batched UPDATE in raw SQL (`LIMIT 200`) in a loop; or queue per-booking jobs. |
| B4 | `createRequest` awaits notification + chat-summary writes in the request path | `bookings.service.ts:240-263` | High | Move both to BullMQ `bookings.created` consumer. Return 201 to caller as soon as the booking row is committed. |
| B5 | List endpoints use `include` with deeply-nested relations | `bookings.service.ts:277-301,446-465` | Medium | Switch to explicit `select`; paginate with cursor; add covering indexes. |

### 3.4 Invoices (`modules/invoices/`)

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| I1 | PDF generation is a TODO — `getPdfUrl` returns `pdfUrl: null` forever | `invoices.service.ts:1049-1057` | **Critical** | BullMQ worker using `puppeteer-core` + Chromium image, render on `invoice.send`, store under S3 `invoices/{id}.pdf`, set `pdfKey`. Idempotent on retry. |
| I2 | Razorpay `orders.create` is awaited inline, no timeout | `invoices.service.ts:1217` | High | Initialise SDK with `timeout: 5000`; circuit-break with `opossum`; persist `razorpayOrderId` upfront so retries don't double-create. |
| I3 | Webhook handler is sync; Razorpay retries on slow ack | `webhooks/razorpay.controller.ts:27` | Medium | Verify signature, enqueue, return 200 immediately. Add `webhook_events(provider, event_id PK)` for idempotency. |
| I4 | GST math uses float `subtotal * (rate / 100)` | `invoices.service.ts:79-82` | Medium | Always integer math: `Math.round((subtotal * rate) / 100)`. Document round-half-up policy (GST CGST/SGST rules). |
| I5 | `serialNumber` race on concurrent invoice creates (3-retry loop) | `invoices.service.ts:156-195` | Medium | Use Postgres `SEQUENCE` per issuer, or `INSERT ... RETURNING serial_number` with a DB-level trigger. |
| I6 | Attachment pre-signed URL has no MIME or size limit | `invoices.service.ts:1094-1096` | Medium | MIME allow-list (PDF, JPEG, PNG, DOCX); max 25 MB; validate again at registration step. |

### 3.5 Notifications (`modules/notifications/`)

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| N1 | `User.fcmToken` is a single string — multi-device push impossible | `schema.prisma:44`, `devices.controller.ts` | High | Promote to `DeviceToken` table: `(userId, token PK, platform, lastSeenAt)`. Push fans out across all tokens; prune on `Unregistered`/`InvalidArgument` FCM responses. |
| N2 | Notification list endpoint returns full payload + joins; polled every 20s by every client | `notifications.service.ts:29-131` + `ChatUnreadContext`/`NavBadgesContext` | High | Add cheap `GET /notifications/unread-count` (single COUNT). Reserve full list for explicit user fetch. Better: replace polling with WebSocket push event `notification:new`. |
| N3 | Push delivery is **not implemented** — FCM is only stored, never sent | `notifications.service.ts` | **Critical** (for the feature) | BullMQ `notifications.push` consumer using Firebase Admin SDK; SMS via MSG91/Twilio adapter. Workers retry with exponential backoff. |
| N4 | No batching on broadcast | `admin.service.ts:167-177` | High | `prisma.notification.createMany({ data: [...] })` in chunks of 1000; queue push fan-out separately. |

### 3.6 Search (`modules/search/`)

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| S1 | Substring `ILIKE` on name/bio, no full-text index | `search.service.ts:114-115` | High | Add `pg_trgm` GIN indexes on `display_name`, `bio`, `company_name`; or move discovery to Meilisearch. |
| S2 | `skills`/`genres` arrays filtered in JS after fetch | `search.service.ts:143-154` | High | GIN indexes on the array columns; use Prisma `hasSome` so PG does the filter. |
| S3 | Per-vendor availability check inside loop = N+1 | `search.service.ts:231-240,349-435` | Medium | Single windowed query joining `AvailabilitySlot` and `BookingRequest` once; expose `available: boolean` per row. |
| S4 | No result cache | search hot path | Medium | Cache search results 60–120s in Redis keyed by normalized filter hash. Invalidate on profile or availability writes. |

### 3.7 Availability (`modules/availability/`)

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| AV1 | `bulkSet` upserts row-by-row with no transaction | `availability.service.ts:336-347` | High | Wrap in `$transaction(async tx => …)`; chunk in batches of ≤500. |
| AV2 | `getMonth` calls `getBookingForDate` per day | `availability.service.ts:241` | Medium | Single query: pre-fetch all bookings for `[start, end)` and zip in JS. |
| AV3 | "Healing" already uses `updateMany` — fine. | `availability.service.ts:288-291` | OK | — |

### 3.8 Equipment (`modules/equipment/`)

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| EQ1 | Date-range overlap detection happens in JS, not SQL | `equipment.service.ts:16-67`, `search.service.ts:349-435` | Medium | Use the existing index `[equipmentId, availableFrom, availableTo]` with a proper `lte/gte` overlap query. |
| EQ2 | No `quantityAvailable` accounting — bookings cannot decrement stock | `schema.prisma:222-240` | High | Add `quantityAvailable INT`; atomic `update({ data: { quantityAvailable: { decrement: 1 } } })` in booking lock; restore on cancel. |

### 3.9 Profiles (`modules/profiles/`)

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| P1 | Avatar/cover signed URL re-generated on every read | `profiles.service.ts:54-65`, `storage.service.ts:118-130` | High | Cache signed URLs in Redis for 25 min (S3 default 30 min). For public assets, use `getPublicUrl`. |
| P2 | Vendor equipment + portfolio loaded unbounded inside profile fetch | `profiles.service.ts:34-88,264-311` | Medium | Cap `take: 10`; add dedicated paginated `/equipment` and `/portfolio` endpoints. |
| P3 | `profileScore` source unclear — verify it is precomputed and not recomputed on every search sort | `search.service:138` `orderBy: { profileScore: 'desc' }` | Medium | Background nightly job to recompute, or DB trigger on profile updates. |

### 3.10 Admin (`modules/admin/`)

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| AD1 | Dashboard analytics scan full tables | `admin.service.ts:132-147` | High | Materialised view refreshed every 5 min, or denormalised `platform_stats` row updated by event listener. |
| AD2 | Broadcast notification = sequential 5k awaits | `admin.service.ts:167-177` | High | `createMany` in chunks of 1000 + queue push fan-out. |
| AD3 | No audit log of admin actions | admin module | Medium | `audit_logs(actorUserId, action, target, before, after, createdAt)` table; intercept admin controller via interceptor. |

### 3.11 Storage (`modules/storage/`)

| # | Finding | File:line | Severity | Fix |
|---|---|---|---|---|
| ST1 | Local `./uploads` directory used as fallback | `storage.controller.ts:8,39-44` | **Critical** for multi-pod | Hard-fail on boot in production unless S3 or Supabase is configured. Files written to one pod are invisible to peers. |
| ST2 | No multer size limit | `storage.controller.ts:22-53` | High | `limits: { fileSize: 25_000_000 }`; reject larger uploads. |
| ST3 | Supabase upload double-hops through API | `storage.service.ts:59-68` | Medium | Issue Supabase signed PUT URL directly; client uploads to Supabase, then registers the key. |

### 3.12 Database / Schema

| # | Finding | Where | Severity | Fix |
|---|---|---|---|---|
| D1 | Missing index for booking expiry job | `BookingRequest` | High | `@@index([status, expiresAt])` |
| D2 | Missing index for soft-deleted message scans | `Message` | Medium | `@@index([conversationId, deletedAt, createdAt])` |
| D3 | Missing GIN indexes on array & text-search columns | `IndividualProfile.skills`, `genres`, `displayName`, `bio`; `CompanyProfile.companyName`; `VendorProfile.companyName` | High | Add GIN (trigram for text, default for arrays). |
| D4 | No covering index for `RefreshToken` cleanup | `RefreshToken` | Medium | `@@index([userId, revoked, expiresAt])` |
| D5 | No index for `OtpSession` cleanup or per-user lookup | `OtpSession` | Medium | `@@index([userId, expiresAt])`, `@@index([expiresAt])` |
| D6 | No partitioning strategy for high-volume tables | `Message`, `Notification`, `AvailabilitySlot` | Medium | Range-partition `Message` by month once it crosses 50M rows; same for `Notification`. |
| D7 | No `pgbouncer` or pool tuning | `DATABASE_URL` | High | Run PgBouncer in transaction-pooling mode; per-pod Prisma `connection_limit=25`. |
| D8 | No read replica routing | Prisma | Medium | Use Prisma's `replica` extension or split read/write clients for analytics + search. |

---

## 4. What to Cache (and Where)

Redis cache plan, keyed and TTL'd:

| Key pattern | TTL | Invalidation trigger | Reason |
|---|---|---|---|
| `user:{id}:mainUserId` | 1 h | user updated | Hottest lookup in chat (6 paths) |
| `user:{id}:roles` | 15 min | role change | Used in JWT guard hydration |
| `conv:{id}:members` | 30 min | conversation update | Avoids per-message membership query |
| `conv:{id}:access:{userId}` | 5 min | assignment change | Skips subuser project lookup |
| `unread:{userId}` (hash by convId) | persistent (write-through) | message sent / read | Replaces in-memory `.filter()` |
| `search:crew:{hash(filters)}` | 90 s | profile or availability write | Search is the worst read path |
| `signed-url:{key}` | 25 min | object replaced | Saves S3/Supabase API calls |
| `rate:otp:{phone}` | 60 s | TTL only | OTP throttle |
| `rate:ws:{userId}:msg` | 1 s | TTL only | Per-socket message rate limit |
| `notify:unread-count:{userId}` | 30 s | message/notification write | Cheap badge polling |

Use cache-aside pattern with single-flight (one DB hit per key per stampede window).

---

## 5. What to Queue (BullMQ)

| Queue | Producer → Consumer | Why |
|---|---|---|
| `notifications.push` | any `createForUser` → Firebase Admin / SMS provider | Push must not block API; needs retries with backoff |
| `notifications.email` | invoice send / booking accept | Same as above |
| `bookings.created` | `bookings.createRequest` → notification + chat summary | Removes 2 awaits from request path (item B4) |
| `bookings.expire` | repeatable cron, every 5 min | Item B1 — enforces 48h expiry |
| `invoices.pdf` | `invoice.send` → puppeteer worker → S3 | Item I1 |
| `webhooks.razorpay` | webhook controller → invoice updater | Item I3 — return 200 fast |
| `admin.broadcast` | admin broadcast endpoint | Item AD2 |
| `cleanup.tokens` | hourly cron | Item A5 |
| `cleanup.messages` | nightly cron | Item C7 |
| `availability.heal` | hourly cron | Already implemented sync — move to worker |

Worker concurrency starts at 4 per pod; PDF queue rate-limited to 2 concurrent jobs (Chromium is heavy).

---

## 6. Security Hardening Checklist

- [ ] Boot-time env schema validation (`joi`/`zod`); fail loud on missing secrets.
- [ ] `helmet()` for HTTP security headers.
- [ ] CORS allowlist — no wildcard with credentials.
- [ ] Disable Swagger in production (or basic-auth-gate it).
- [ ] Rate-limit auth endpoints (login, OTP send, register, refresh) per IP **and** per identifier.
- [ ] Bcrypt offload to worker pool; consider `argon2id`.
- [ ] Refresh-token family revocation on detected re-use.
- [ ] Razorpay webhook idempotency table.
- [ ] Attachment MIME+size whitelist; AV scan (e.g., ClamAV via S3 trigger).
- [ ] Pre-signed URLs scoped to single object key with short TTL.
- [ ] Soft-delete + GDPR-style account erasure on request.
- [ ] Audit log on admin actions.
- [ ] Disable `EXPOSE_OTP_IN_API` in prod (boot check).
- [ ] PII redaction in logs (Pino `redact` paths: `req.headers.authorization`, `req.body.password`, `req.body.otp`).

---

## 7. Observability Stack

- **Logs:** `nestjs-pino` → JSON → stdout → Loki / Datadog. Include `requestId`, `userId`, `route`, `latencyMs`, Prisma slow-query events.
- **Metrics:** `prom-client` exporter at `/metrics`. Key SLIs:
  - HTTP p95 latency by route
  - WebSocket connected sockets per pod
  - BullMQ queue depth + failure rate per queue
  - Prisma query duration histogram
  - Postgres connection pool saturation
- **Tracing:** OpenTelemetry SDK + auto-instrumentation for HTTP/Prisma/Redis/Socket.IO. Export to Tempo/Jaeger.
- **Errors:** Sentry with release + environment tagging. Alert on new error classes.
- **Health:** `/health/live` (process) and `/health/ready` (DB ping + Redis ping + queue accessible). Wire to Kubernetes probes.
- **SLOs:** p95 API < 300 ms, error rate < 0.5 %, WS message delivery < 500 ms.

---

## 8. Phased Rollout Plan

### Phase 1 — Stop-the-bleeding (Week 1) — _ship before any load test_

1. Boot-time env validation; refuse to start in prod without `JWT_SECRET`, etc. **(A2, A6)**
2. Drop bcrypt to 10 rounds **and** offload via `bcrypt`'s async callbacks; benchmark login under load. **(A1)**
3. Add `@nestjs/throttler` with Redis store; protect `/auth/*`, `/chat`, `/search`. **(A3, C5)**
4. Add `helmet`, `compression`, graceful shutdown, structured Pino logging.
5. Disable Swagger and `EXPOSE_OTP_IN_API` in prod.
6. Add Redis client (`ioredis`), BullMQ wiring, `socket.io-redis` adapter; replace `fetchSockets()` loop with `to(room).emit`. **(C1)**
7. Health checks, `/metrics`, Sentry.

### Phase 2 — Background workers (Week 2)

8. BullMQ workers: `notifications.push` (FCM), `bookings.expire` cron, `bookings.created` side effects, `webhooks.razorpay` enqueue, `admin.broadcast`. **(B1, B4, I3, AD2, N3)**
9. PDF generation worker with puppeteer + S3 upload. **(I1)**
10. Promote `User.fcmToken` to `DeviceToken` table; multi-device push fan-out. **(N1)**
11. Token cleanup + expired-OTP cleanup nightly job. **(A5)**

### Phase 3 — Database + caching (Week 3)

12. Add all missing indexes (D1–D5). Add GIN indexes on arrays + trigram on text columns.
13. Run PgBouncer in transaction pooling; tune Prisma `connection_limit`.
14. Read-replica for analytics + search.
15. Implement cache layer (table in Section 4): mainUserId, conversation membership, signed URLs, search results, unread counts.
16. Add `unreadCount` denormalised to `Conversation`; remove in-memory `.filter()`. **(C6)**

### Phase 4 — Algorithmic fixes (Week 4)

17. Move skill/genre/availability filtering into SQL with proper indexes. **(S1, S2, S3)**
18. Switch search results to Redis cache. **(S4)**
19. Replace booking-list `include` with explicit `select` + cursor pagination. **(B5)**
20. `lockAllProjectBookings` → batched UPDATE. **(B3)**
21. `availability.bulkSet` in transaction + chunked. **(AV1)**
22. `equipment.quantityAvailable` field + atomic decrement. **(EQ2)**
23. Notification badge: lightweight count endpoint or push event. **(N2)**

### Phase 5 — Hardening & scale tests (Week 5)

24. Razorpay idempotency table; integer GST math; serial-number sequence. **(I3, I4, I5)**
25. Attachment MIME + size validation; AV scan. **(I6, ST2)**
26. `messages` archival/TTL job. **(C7)**
27. Materialised view for admin dashboard. **(AD1)**
28. Audit log on admin actions. **(AD3)**
29. **k6 / Artillery load test:** ramp 0 → 5,000 CCU over 10 min, hold 30 min, mixed scenario (40 % browse, 30 % chat, 20 % booking flows, 10 % auth). Verify SLOs.

### Phase 6 — Long-term (post-launch)

- Move discovery search to Meilisearch.
- Partition `messages`/`notifications` by month once tables cross 50M rows.
- Consider event sourcing for booking state machine.
- Multi-region active/passive with logical replication.

---

## 9. Quick-Reference Severity Map

| Severity | Count | Module breakdown |
|---|---|---|
| Critical | 8 | Chat scaling (1), bcrypt (1), JWT secret (1), env validation (1), workers/queues (1), PDF gen (1), local FS storage (1), missing push delivery (1) |
| High | 16 | Bookings (3), Auth (1), Invoices (1), Notifications (3), Search (3), Availability (1), Equipment (1), Profiles (1), Admin (2) |
| Medium | 22 | Various — see per-module tables |
| Low / nice-to-have | 4 | Code dedup, audit polish |

---

## 10. TL;DR

The backend is a clean Nest + Prisma codebase with real domain depth, but to handle 5,000 concurrent users it needs a Redis layer (cache + Socket.IO adapter + rate limiter), a BullMQ worker tier (push, PDF, expiry, broadcasts), structured observability, env-validated configuration, and a half-dozen targeted index + query rewrites. None of the work is exotic — it's all the standard "MVP → production" gap. Start with the 4 critical blockers in Phase 1 before any meaningful load test.

 # CrewCall Backend

Production backend for **CrewCall / Claapo** (crewcall.in / crewcall.app) — a hiring and crew-management platform connecting production companies with verified freelance crew and equipment vendors.

**Stack:** Node.js (NestJS 10) · TypeScript · PostgreSQL 16 · Prisma 5 · Redis 7 (cache + BullMQ queues + throttler storage) · Socket.IO 4 · Swagger

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | **>= 20** (tested on Node 24) |
| npm | >= 10 |
| Docker + Docker Compose | latest stable |

> Both **PostgreSQL** and **Redis** run in Docker via the bundled `docker-compose.yml` — you do not need either installed on the host.

---

## Quick start

```bash
# 1. Clone & install
cd crewcall-backend
npm install

# 2. Create your env file
cp .env.example .env
# Edit .env if you want to change credentials, ports, JWT secrets, etc.

# 3. Start local services in Docker (Postgres → claapo-db, Redis → claapo-redis)
docker compose up -d

# 4. Apply migrations and generate the Prisma client
npm run prisma:migrate:deploy
npm run prisma:generate

# 5. (Optional) Seed light demo data — 10 accounts, full relational demo
npm run prisma:seed

# 6. Start the API in dev mode
npm run start:dev
```

> See [Seed data](#seed-data) for the list of demo accounts and what the light seed contains.

After step 6 the API is available at:

| Endpoint | URL |
|---|---|
| REST API | http://localhost:3000/v1 |
| Swagger docs | http://localhost:3000/docs |
| Health check | http://localhost:3000/v1/health |
| Chat WebSocket | ws://localhost:3000/chat |

---

## Demo accounts (login credentials)

After running `npm run prisma:seed` you can log in with any of the accounts below. **All accounts share the same password** — copy it once and reuse.

```
Password (all accounts):  Test@1234
```

| Email | Password | Role | Persona |
|---|---|---|---|
| `admin@claapo.test` | `Test@1234` | admin | Platform admin — full admin panel access |
| `company1@claapo.test` | `Test@1234` | company | **Demo Production House** (Mumbai) — main test account for company flows |
| `company2@claapo.test` | `Test@1234` | company | **Sunrise Studios** (Delhi) — second company for cross-company testing |
| `subuser1@claapo.test` | `Test@1234` | company sub-user | Producer under Demo Production House, assigned to Project 1 |
| `freelancer1@claapo.test` | `Test@1234` | individual | **Riya Sharma** — DOP, Mumbai. Has locked booking, invoice, contract, reviews |
| `freelancer2@claapo.test` | `Test@1234` | individual | **Arjun Verma** — Sound Engineer, Bangalore |
| `freelancer3@claapo.test` | `Test@1234` | individual | **Priya Patel** — Editor, Mumbai. Has a pending booking request |
| `freelancer4@claapo.test` | `Test@1234` | individual | **Karan Mehta** — Gaffer, Delhi. Has a declined booking |
| `vendor1@claapo.test` | `Test@1234` | vendor | **Demo Cine Rentals** — equipment vendor (Sony FX6, ARRI SkyPanel) |
| `vendor2@claapo.test` | `Test@1234` | vendor | **Reel Catering Co** — catering vendor. Has a `cancel_requested` booking |

### Quick login snippets

```bash
# company flow
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"company1@claapo.test","password":"Test@1234"}'

# freelancer flow
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"freelancer1@claapo.test","password":"Test@1234"}'

# vendor flow
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"vendor1@claapo.test","password":"Test@1234"}'

# admin
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@claapo.test","password":"Test@1234"}'
```

> ⚠️ These credentials are **for local/dev only**. Never seed demo accounts against a production database.

---

## Local services (Docker)

`docker-compose.yml` at the backend root brings up two containers:

### Postgres — `claapo-db`

| Setting | Default |
|---|---|
| Image | `postgres:16-alpine` |
| Container name | **`claapo-db`** |
| Host port | `5432` |
| User / Password / DB | `claapo` / `claapo_password` / `claapo` |
| Persistent volume | `claapo_pgdata` |

Override via env vars (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`) before running compose.

The matching `DATABASE_URL` for the defaults is:

```
postgresql://claapo:claapo_password@localhost:5432/claapo?schema=public
```

### Redis — `claapo-redis`

Backs three subsystems: the throttler store, the cache layer (`AppCacheService`), and BullMQ queues.

| Setting | Default |
|---|---|
| Image | `redis:7-alpine` |
| Container name | **`claapo-redis`** |
| Host port | `6379` |
| Persistence | AOF (`--appendonly yes`) |
| Memory cap | `512 MB` |
| Eviction policy | **`noeviction`** *(BullMQ requirement — losing a job key to LRU would silently drop work)* |
| Persistent volume | `claapo_redisdata` |

Override the host port via `REDIS_PORT`. The app reads `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` (and falls back to `REDIS_URL` if set).

### Common commands

```bash
docker compose up -d                # start both containers in background
docker compose ps                   # status / health
docker compose logs -f db           # tail Postgres
docker compose logs -f redis        # tail Redis
docker compose exec redis redis-cli ping   # → PONG
docker compose stop                 # stop both (data preserved)
docker compose down                 # stop + remove containers (volumes kept)
docker compose down -v              # stop AND wipe data volumes (destructive)
```

The compose defaults for both containers are already wired into `.env` after step 2 of the quick start.

---

## Caching, queueing & rate limiting

Three Redis-backed subsystems are wired into the API. Each is gated by a **feature flag** so a fresh checkout boots in legacy behavior — flip them on after Redis is up.

| Flag | Subsystem | What it does | Failure mode |
|---|---|---|---|
| `THROTTLER_ENABLED` | `@nestjs/throttler` + `nestjs-throttler-storage-redis` | Global default **200 req/min/IP**; `/auth/*` capped at **10 req/min/IP**; webhooks skipped. Counter state in Redis so it works across pods. | Off → guard short-circuits and allows every request. |
| `CACHE_ENABLED` | `AppCacheService.wrap()` (direct ioredis, cache-aside) | Caches **user identity** (1h), **S3 signed URLs** (25m), **unread-notification count** (30s). Keys live in `apps/api/src/common/cache/cache-keys.ts`. | Off → loader runs every call. On → SETEX failure also degrades to loader. |
| `QUEUE_ENABLED` | BullMQ producers + workers | `bookings-expire` cron flips `pending → expired` every 5 min. `notifications` queue handles `booking-created` fan-out (notification + chat summary). | Off → producers no-op, cron is not scheduled, code paths fall back to inline. |

### Toggle from `.env`

```env
THROTTLER_ENABLED=true
CACHE_ENABLED=true
QUEUE_ENABLED=true
```

Restart the API after flipping any flag — they are read at boot.

### Verifying it's working

```bash
# Throttler — 11th /auth/login in a minute should return 429
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/v1/auth/login \
    -H 'Content-Type: application/json' -d '{"email":"x","password":"x"}';
done

# Cache — first call hits DB, second call hits Redis
docker compose exec redis redis-cli KEYS 'app:cache:*'

# Queue — inspect BullMQ keys
docker compose exec redis redis-cli KEYS 'bull:*'
```

The full design + rollout history lives in [`CACHING_QUEUEING_PLAN.md`](./CACHING_QUEUEING_PLAN.md).

> **Production note:** all three flags should be **on** in production, and Redis must be a managed instance reachable from every API pod. Throttling per-IP is meaningless on a single pod that's behind a load balancer with no shared store, and BullMQ explicitly requires `noeviction` on the Redis cluster.

---

## Environment variables

See `.env.example` for the full list. The most relevant groups:

| Group | Keys |
|---|---|
| **App** | `NODE_ENV`, `PORT`, `API_BASE_URL`, `CORS_ORIGINS` |
| **Database** | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` |
| **Redis** | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` *(component vars preferred)* · `REDIS_URL` *(fallback)* |
| **Feature flags** | `THROTTLER_ENABLED`, `CACHE_ENABLED`, `QUEUE_ENABLED` *(see [Caching, queueing & rate limiting](#caching-queueing--rate-limiting))* |
| **JWT** | `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` |
| **AWS S3** *(required for avatar / cover / showreel uploads)* | `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_CLOUDFRONT_DOMAIN` *(optional)* |
| **Razorpay** *(optional)* | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| **Rate limits** | `THROTTLE_TTL`, `THROTTLE_LIMIT`, `AI_CHAT_HOURLY_LIMIT` |

`CORS_ORIGINS` is comma-separated. Use `*` to reflect any browser Origin (handy in dev / when testing from ngrok). **Do not combine `*` with credentials in production** — set it to your real frontend origin(s).

---

## Project structure

```
crewcall-backend/
├── apps/
│   ├── api/                          # Main NestJS API
│   │   └── src/
│   │       ├── main.ts               # Bootstrap, Swagger, CORS, global prefix /v1
│   │       ├── app.module.ts
│   │       ├── common/               # Guards, filters, pipes, decorators
│   │       │   ├── cache/            # AppCacheService.wrap() + cache-keys registry
│   │       │   ├── queue/            # BullMQ queue tokens + job names
│   │       │   ├── redis/            # Global ioredis client (REDIS_CLIENT)
│   │       │   └── throttler/       # ConditionalThrottlerGuard (flag-gated)
│   │       ├── config/
│   │       ├── database/             # Prisma module + service
│   │       ├── gateways/             # Socket.IO chat gateway
│   │       └── modules/
│   │           ├── admin/            # Admin panel APIs
│   │           ├── ai/               # AI features
│   │           ├── auth/             # Register, OTP, login, refresh, reset
│   │           ├── availability/     # Calendar slots
│   │           ├── bookings/         # Crew/vendor booking requests + bookings-expire BullMQ processor
│   │           ├── chat/             # Conversations + messages
│   │           ├── equipment/        # Vendor equipment catalogue
│   │           ├── invoices/         # Invoices, line items, Razorpay
│   │           ├── notifications/    # In-app + FCM + BullMQ processor (booking-created fan-out)
│   │           ├── profiles/         # Individual / Company / Vendor
│   │           ├── projects/         # Projects + project roles
│   │           ├── reviews/
│   │           ├── search/           # Crew & vendor discovery
│   │           ├── storage/          # S3 presigned URLs
│   │           ├── users/
│   │           └── webhooks/         # Razorpay webhook
│   └── workers/                      # Background workers (BullMQ)
├── libs/
│   ├── shared-types/                 # DTOs, enums
│   └── shared-utils/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seeds/                        # seed.ts, seed-light.ts, wipe-database.ts
├── scripts/
├── docker-compose.yml                # Local Postgres (claapo-db) + Redis (claapo-redis)
├── docker/                           # Legacy compose file (kept for reference)
├── CACHING_QUEUEING_PLAN.md          # Phase-by-phase design for cache/queue/throttler rollout
├── NOTIFICATIONS_REALTIME_PLAN.md    # Forward-looking plan for FCM push + WebSocket notifications
├── PRODUCTION_READINESS.md           # Pre-launch hardening checklist
├── .env.example
├── package.json
└── tsconfig.json
```

---

## API surface (high level)

All routes are prefixed with **`/v1`**. JWT bearer auth is required except where noted.

| Area | Sample routes |
|---|---|
| **Auth** | `POST /auth/register/individual` · `/company` · `/vendor` · `/auth/otp/send` · `/auth/otp/verify` · `/auth/login` · `/auth/refresh` · `/auth/logout` · `/auth/password/reset` |
| **Profile** | `GET /profile/me` · `PATCH /profile/individual\|company\|vendor` · `GET /profile/:userId` · `POST /profile/avatar` · `POST /profile/cover` *(presigned, all roles)* · `POST /profile/showreel` |
| **Availability** | `GET /availability/me` · `PUT /availability/bulk` · `GET /availability/:userId` |
| **Projects** | `POST /projects` · `GET /projects` · `GET /projects/:id` · `PATCH /projects/:id` · `DELETE /projects/:id` · `POST /projects/:id/roles` |
| **Bookings** | `POST /bookings/request` · `GET /bookings/incoming\|outgoing` · `PATCH /bookings/:id/accept\|decline\|lock\|cancel` |
| **Search** | `GET /search/crew` · `GET /search/vendors` |
| **Equipment** | `GET /equipment` · `POST /equipment` · `PATCH /equipment/:id` · `DELETE /equipment/:id` |
| **Invoices** | `POST /invoices` · `GET /invoices` · `GET /invoices/:id` · `POST /invoices/:id/send` · `POST /invoices/:id/pay` · `GET /invoices/:id/pdf` |
| **Notifications** | `GET /notifications` · `PATCH /notifications/:id/read` · `PATCH /notifications/read-all` · `GET\|PATCH /notifications/preferences` · `POST /devices/fcm-token` |
| **Chat** | REST: `GET /chat/conversations` · `GET /chat/conversations/:id/messages` · WebSocket namespace: `/chat` |
| **Admin** *(role=admin)* | `GET /admin/users` · `PATCH /admin/users/:id/status` · `GET /admin/projects\|bookings\|invoices` · `GET /admin/analytics/dashboard\|revenue` · `POST /admin/broadcast` |
| **Webhooks** | `POST /webhooks/razorpay` (HMAC verified, raw body) |

The full, always-current list lives in **Swagger** at http://localhost:3000/docs.

---

## Scripts

| Command | Description |
|---|---|
| `npm run start:dev` | Start API in watch mode |
| `npm run start:debug` | Start with `--debug --watch` |
| `npm run start` | Start once (no watch) |
| `npm run start:prod` | Run compiled `dist/main.js` |
| `npm run build` | Compile with `nest build` |
| `npm run lint` | ESLint over `apps/` and `libs/` |
| `npm test` | Jest unit tests |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate` | Create + apply a new migration (dev) |
| `npm run prisma:migrate:deploy` | Apply existing migrations (CI / prod / fresh clone) |
| `npm run prisma:studio` | Open Prisma Studio |
| `npm run prisma:seed` / `npm run seed` | Seed light demo data (see below) |
| `npm run seed:massive` | Seed full demo dataset (60 freelancers + 60 companies + 60 vendors — see `prisma/seeds/README.md`) |
| `npm run prisma:wipe` | Wipe all tables (destructive) |

---

## Seed data

Two seed scripts ship with the backend:

- **Light seed** — `npm run prisma:seed` (or `npm run seed`) — runs `prisma/seeds/seed-light.ts`. Small, deterministic, fast. Intended for local dev and as a smoke test after migrations.
- **Massive seed** — `npm run seed:massive` — runs `prisma/seeds/seed.ts`. ~180 users with thousands of related rows. See `prisma/seeds/README.md` for details.

> **Both seeds wipe existing data first.** Do not run on a database that has anything you care about.

For the list of demo accounts and shared password, see [Demo accounts (login credentials)](#demo-accounts-login-credentials) above.

### Light seed — what it creates

| Entity | Count | Notes |
|---|---|---|
| Users | 10 | Includes one sub-user (`mainUserId` set) |
| Individual profiles | 4 | Full bios, skills, PAN, bank details, social URLs, showreel |
| Company profiles | 2 | GST, PAN, bank details, `aboutUs`, social URLs |
| Vendor profiles | 2 | GST, PAN, bank details, `aboutUs` |
| Vendor equipment | 2 | Each with an availability window |
| Portfolio items | 3 | Across 2 freelancers |
| Projects | 3 | `active` (Monsoon Short), `open` (Q2 TVC), `draft` (Documentary Pitch) |
| Project roles | 6 | DOP, Sound, Editor, Gaffer across the 3 projects |
| Sub-user assignments | 1 | `subuser1` → Project 1 |
| Availability slots | ~30 | Past work / booked / available / blocked across freelancers |
| Booking requests | 7 | Covers `locked`, `accepted`, `pending`, `declined`, `cancel_requested`, plus a counter-offer (`counterRate` / `counterMessage`) — **includes a `shootDateLocations` example** |
| Conversations | 2 | Between company1 ↔ freelancer1 and company1 ↔ freelancer2 |
| Messages | 5 | With pinned + read/unread variations |
| Invoices | 3 | One `draft`, one `sent` (with PDF attachment + line item), one `paid` |
| Contracts | 1 | Signed by both parties, attached to the locked DOP booking |
| Reviews | 2 | 5-star and 4-star, from company → freelancers |
| Notifications | 5 | `booking_locked`, `booking_countered`, `booking_cancel_requested`, `booking_request`, `invoice_sent` — with `data` payloads |

Every field on every current Prisma model is exercised somewhere in the light seed — including recent additions like `shootDateLocations`, `deliveryDate`, `aboutMe` / `aboutUs`, `profileScore`, `notificationPreferences`, and the counter/cancel booking fields. This makes the light seed a useful sanity check after schema changes: if it runs clean, the new fields are wired up correctly.

---

## Mobile / web client integration

Other apps connect to this backend by URL — there is no folder coupling.

- Set `VITE_API_URL` (web) or `API base URL` in app settings (mobile) to:
  - `http://localhost:3000/v1` for local dev
  - `https://api.crewcall.in/v1` for production
- For physical mobile devices use **ngrok**: `ngrok http 3000`, then put the HTTPS URL into the app's developer settings (no rebuild needed).
- Make sure the client origin is allowed in `CORS_ORIGINS`.

---

## Production notes

- Build: `npm run build` → `node dist/main.js`
- Run migrations on deploy with `npm run prisma:migrate:deploy` (never `prisma:migrate` in prod).
- The Razorpay webhook needs the **raw request body** to verify HMAC — keep that route's body parser configured accordingly.
- Set strong values for `JWT_SECRET` and `JWT_REFRESH_SECRET` (rotate the defaults from `.env.example` — they are placeholder strings).
- For AWS S3 uploads to work, set `AWS_REGION`, `AWS_S3_BUCKET`, and either env credentials (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) or an instance role. The bucket's CORS allowlist must include your production frontend origin — local-only origins in CORS will cause browser PUTs to fail in prod.
- Enable `THROTTLER_ENABLED`, `CACHE_ENABLED`, `QUEUE_ENABLED` in production. Point them at a **managed Redis** (Upstash / ElastiCache / Railway / etc.) reachable from every pod, with `maxmemory-policy noeviction` (BullMQ requirement).
- Set `CORS_ORIGINS` to explicit frontend origins — do **not** include `*` in production (combined with `credentials: true` it lets any site read authenticated responses).
- See [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md) for the full pre-launch checklist.

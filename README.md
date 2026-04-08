# CrewCall Backend

Production backend for **CrewCall / Claapo** (crewcall.in / crewcall.app) — a hiring and crew-management platform connecting production companies with verified freelance crew and equipment vendors.

**Stack:** Node.js (NestJS 10) · TypeScript · PostgreSQL 16 · Prisma 5 · Redis · Socket.IO · Swagger

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | **>= 20** (tested on Node 24) |
| npm | >= 10 |
| Docker + Docker Compose | latest stable |

> The local PostgreSQL database runs in Docker — you do not need Postgres installed on the host.

---

## Quick start

```bash
# 1. Clone & install
cd crewcall-backend
npm install

# 2. Create your env file
cp .env.example .env
# Edit .env if you want to change credentials, ports, JWT secrets, etc.

# 3. Start the database (Docker container: claapo-db)
docker compose up -d

# 4. Apply migrations and generate the Prisma client
npm run prisma:migrate:deploy
npm run prisma:generate

# 5. (Optional) Seed light demo data
npm run prisma:seed

# 6. Start the API in dev mode
npm run start:dev
```

After step 6 the API is available at:

| Endpoint | URL |
|---|---|
| REST API | http://localhost:3000/v1 |
| Swagger docs | http://localhost:3000/docs |
| Health check | http://localhost:3000/v1/health |
| Chat WebSocket | ws://localhost:3000/chat |

---

## Database (Docker)

The local Postgres instance is defined in **`docker-compose.yml`** at the backend root.

| Setting | Default |
|---|---|
| Image | `postgres:16-alpine` |
| Container name | **`claapo-db`** |
| Host port | `5432` |
| User / Password / DB | `claapo` / `claapo_password` / `claapo` |
| Persistent volume | `claapo_pgdata` |

Override any of these via env vars (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`) before running compose.

### Common commands

```bash
docker compose up -d           # start the database in background
docker compose ps              # check status / health
docker compose logs -f db      # tail database logs
docker compose stop            # stop the container (keeps data)
docker compose down            # stop and remove the container (keeps volume)
docker compose down -v         # stop AND wipe the data volume (destructive)
```

The matching `DATABASE_URL` for the defaults is:

```
postgresql://claapo:claapo_password@localhost:5432/claapo?schema=public
```

This is already set in `.env` after step 2 of the quick start.

---

## Environment variables

See `.env.example` for the full list. The most relevant groups:

| Group | Keys |
|---|---|
| **App** | `NODE_ENV`, `PORT`, `API_BASE_URL`, `CORS_ORIGINS` |
| **Database** | `DATABASE_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` |
| **Redis** | `REDIS_URL` |
| **JWT** | `JWT_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` |
| **AWS S3** *(optional)* | `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_CLOUDFRONT_DOMAIN` |
| **Razorpay** *(optional)* | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| **Rate limits** | `THROTTLE_TTL`, `THROTTLE_LIMIT`, `AI_CHAT_HOURLY_LIMIT` |

`CORS_ORIGINS` is comma-separated. Use `*` to reflect any browser Origin (handy in dev / when testing from ngrok).

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
│   │       ├── config/
│   │       ├── database/             # Prisma module + service
│   │       ├── gateways/             # Socket.IO chat gateway
│   │       └── modules/
│   │           ├── admin/            # Admin panel APIs
│   │           ├── ai/               # AI features
│   │           ├── auth/             # Register, OTP, login, refresh, reset
│   │           ├── availability/     # Calendar slots
│   │           ├── bookings/         # Crew/vendor booking requests
│   │           ├── chat/             # Conversations + messages
│   │           ├── equipment/        # Vendor equipment catalogue
│   │           ├── invoices/         # Invoices, line items, Razorpay
│   │           ├── notifications/    # In-app + FCM
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
├── docker-compose.yml                # Local Postgres (container: claapo-db)
├── docker/                           # Legacy compose file (kept for reference)
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
| **Profile** | `GET /profile/me` · `PATCH /profile/individual\|company\|vendor` · `GET /profile/:userId` · `POST /profile/avatar` (presigned) · `POST /profile/showreel` |
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
| `npm run prisma:seed` / `npm run seed` | Seed light demo data |
| `npm run seed:massive` | Seed full demo dataset |
| `npm run prisma:wipe` | Wipe all tables (destructive) |

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
- Set strong values for `JWT_SECRET` and `JWT_REFRESH_SECRET`.
- For AWS S3 uploads to work, set `AWS_REGION`, `AWS_S3_BUCKET`, and either AWS env credentials or an instance role.

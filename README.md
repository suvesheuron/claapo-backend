# CrewCall Backend

Production-grade backend for CrewCall (crewcall.in / crewcall.app).  
Stack: **Node.js (NestJS)** + **PostgreSQL** + **Redis**.  
See `../crewcall_backend_plan.md` for full architecture.

## Directory structure (from plan)

```
crewcall-backend/
├── apps/
│   ├── api/                    # Main NestJS API
│   │   └── src/
│   │       ├── modules/        # auth, users, profiles, availability, projects,
│   │       │                   # bookings, search, chat, invoices, notifications,
│   │       │                   # admin, ai, storage, webhooks
│   │       ├── gateways/       # Socket.io chat gateway
│   │       ├── common/         # guards, interceptors, filters, pipes, decorators
│   │       ├── config/
│   │       ├── database/
│   │       └── main.ts
│   └── workers/                # BullMQ: email, sms, push, pdf, ai
├── libs/
│   ├── shared-types/           # DTOs, enums
│   └── shared-utils/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/                    # seed, generate-openapi
├── docker/                     # Dockerfile.api, Dockerfile.worker, docker-compose
└── .github/workflows/          # ci.yml, deploy.yml
```

## Mobile app alignment (crewcall-mobile-app)

Screens that will consume this API: Login, Register, UserTypeSelection, Profile, Calendar, CreateProject, FindCrew, Invoices, Messages, Notifications, Company/Vendor dashboards, etc.

## Repo layout and frontend connection

Backend connects to frontends **by URL**, not by folder structure. You can keep admin UI and web UI in the repo root alongside the backend:

```
crewcall/
├── crewcall-backend/     # this API
├── crewcall-mobile-app/
├── crewcall-admin-ui/    # admin dashboard
└── crewcall-web-ui/      # main marketing/app site
```

- Each frontend sets its API base URL (e.g. `VITE_API_URL`, `NEXT_PUBLIC_API_URL`) to the backend (e.g. `http://localhost:3000` in dev, `https://api.crewcall.in` in prod).
- Backend must allow their origins in **CORS**: set `CORS_ORIGINS` in `.env` to include admin and web UI origins (see `.env.example`).

No backend code changes are required for “finding” admin or web UI; they just call the same API.

## Part 1 — Foundation & Auth ✓

- NestJS app under `apps/api`, global prefix `v1`, Swagger at `/docs`.
- Prisma schema: `users`, `otp_sessions`, `refresh_tokens` (enums: UserRole, OtpType).
- Docker Compose: Postgres 16 + Redis 7 in `docker/docker-compose.yml`.
- Auth: register (individual, company, vendor), OTP send/verify, login, refresh, logout, password reset.
- Common: JwtAuthGuard, RolesGuard, CurrentUser decorator, validation pipe, exception filter.

### Run locally

1. **Install**
   ```bash
   cd crewcall-backend
   npm install
   copy .env.example .env
   ```
   Edit `.env` (e.g. `DATABASE_URL`, `JWT_SECRET`).

2. **Start database (Docker)**
   ```bash
   docker compose -f docker/docker-compose.yml up -d
   ```

3. **Setup database**
   ```bash
   # Generate Prisma client
   npm run prisma:generate

   # Run migrations (use deploy when pulling repo; use this when changing schema)
   npm run prisma:migrate
   # Or, when only applying existing migrations (e.g. after git pull):
   # npm run prisma:migrate:deploy

   # Seed test data (optional; run after adding prisma/seed.ts)
   npm run prisma:seed
   ```

4. **Start API**
   ```bash
   npm run start:dev
   ```
   - API: http://localhost:3000/v1  
   - Swagger: http://localhost:3000/docs  
   - Health: http://localhost:3000/v1/health  

5. **Try auth**
   - `POST /v1/auth/register/individual` with `{ "email", "phone", "password" }`
   - `POST /v1/auth/otp/send` with `{ "phone" }` — in dev, OTP is logged to console
   - `POST /v1/auth/otp/verify` with `{ "phone", "otp" }` → returns `accessToken`, `refreshToken`
   - `POST /v1/auth/login` with `{ "email", "password" }` → tokens

## Part 2 — Profiles & Storage ✓

- Prisma: `IndividualProfile`, `CompanyProfile`, `VendorProfile` (with `VendorType` enum).
- **GET** `/v1/profile/me` — own profile (with avatar/showreel/logo URLs when S3 configured).
- **PATCH** `/v1/profile/individual` | `/company` | `/vendor` — update by role.
- **GET** `/v1/profile/:userId` — public profile (rates masked for non-company viewers).
- **POST** `/v1/profile/avatar` — presigned PUT URL for avatar/logo; **POST** `/v1/profile/avatar/confirm` with `{ "key" }` to save.
- **POST** `/v1/profile/showreel` (individual only) — presigned URL; **POST** `/v1/profile/showreel/confirm` with `{ "key" }`.
- Storage: S3 presigned URLs via `StorageService` (optional; set `AWS_S3_BUCKET` and credentials to enable).

After Part 2, run: `npx prisma migrate dev --name add_profiles`

## Part 3 — Availability & Calendar ✓

- Prisma: `AvailabilitySlot` (userId, date, status: available | booked | blocked | past_work).
- **GET** `/v1/availability/me?year=&month=` — own calendar (returns `{ year, month, slots: { "YYYY-MM-DD": status } }`).
- **PUT** `/v1/availability/bulk` — body `{ slots: [{ date, status, notes? }] }` (individual/vendor only).
- **GET** `/v1/availability/:userId?year=&month=` — company views another user’s calendar (masked).

Run: `npx prisma migrate dev --name add_availability`

### Mobile app alignment

The **crewcall-mobile-app** is wired to this backend:

- **API base URL**: In dev the app uses `http://localhost:3000/v1` by default. For **physical device or APK**, use **Settings → Developer → API base URL** and paste your ngrok URL (e.g. `https://xxxx.ngrok-free.app/v1`) — no rebuild needed. See **[../docs/NGROK_SETUP.md](../docs/NGROK_SETUP.md)** for full steps.
- **Auth**: Login screen calls `POST /auth/login`; Register calls `/auth/register/individual|company|vendor` then login. Tokens stored in memory; logout clears them and resets to Login screen.
- **Profile**: Drawer and Profile screen show `user` from `GET /profile/me` (loaded after login).
- **Availability**: `getMyCalendar(year, month)` and `setAvailability(slots)` in `src/api/availability.ts` for future Calendar screen integration.

Ensure backend is running. CORS: in development, `.env.example` sets `CORS_ORIGINS=*,...` so ngrok and any origin are allowed; for production set explicit origins.

## Part 4 — Projects & Bookings ✓

- Prisma: `Project`, `ProjectRole`, `BookingRequest`; enums `ProjectStatus`, `BookingStatus`.
- **POST** `/v1/projects` — create project (company).
- **GET** `/v1/projects` — list own projects (paginated).
- **GET** `/v1/projects/:id` — get project (owner or booked crew).
- **PATCH** `/v1/projects/:id` — update; **DELETE** `/v1/projects/:id` — draft only.
- **POST** `/v1/projects/:id/roles` — add role (company).
- **POST** `/v1/bookings/request` — send request; **GET** `/v1/bookings/incoming` | **/outgoing**.
- **PATCH** `/v1/bookings/:id/accept` | **/decline** | **/lock** | **/cancel**.
- Accept sets target’s calendar slots to `booked`; cancel reverts to `available`.

Run: `npx prisma migrate dev --name add_projects_bookings`

## Part 5 — Search & Discovery ✓ (no AI)

- **GET** `/v1/search/crew` — company only. Query: `skill`, `city`, `state`, `startDate`, `endDate`, `rateMin`, `rateMax`, `availableOnly`, `page`, `limit`. Returns individuals with optional date-availability filter (excludes users with booked slots in range).
- **GET** `/v1/search/vendors` — company only. Query: `type` (equipment|lighting|transport|catering), `page`, `limit`.

## Part 6 — Invoices & Webhooks ✓

- Prisma: `Invoice` (projectId, issuer/recipient userId, invoiceNumber, amount, gstAmount, totalAmount, status, dueDate, pdfKey, razorpayOrderId, paidAt), `InvoiceLineItem` (description, quantity, unitPrice, amount). Amounts in **paise** (INR × 100).
- **POST** `/v1/invoices` — create (individual/vendor); body: projectId, recipientUserId, dueDate?, lineItems[].
- **GET** `/v1/invoices`, **GET** `/v1/invoices/:id` — list own, get one.
- **PATCH** `/v1/invoices/:id` — update draft (issuer).
- **POST** `/v1/invoices/:id/send` — set status to sent (issuer).
- **GET** `/v1/invoices/:id/pdf` — returns pdfKey or placeholder (PDF generation can be added via worker).
- **POST** `/v1/invoices/:id/pay` — company initiates Razorpay order; returns orderId, amount, keyId for client-side checkout.
- **POST** `/v1/webhooks/razorpay` — Razorpay webhook (HMAC verified); on `payment.captured` marks invoice paid. Configure raw body for this route for signature verification.

Run: `npx prisma migrate dev --name add_invoices`. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` for payments.

## Part 7 — Notifications ✓

- Prisma: `Notification` (userId, type, title, body, data, readAt, createdAt); `User.notificationPreferences` (Json), `User.fcmToken` already present.
- **GET** `/v1/notifications` — list own (paginated, unread first); response includes `unreadCount`.
- **PATCH** `/v1/notifications/:id/read` — mark one read.
- **PATCH** `/v1/notifications/read-all` — mark all read.
- **GET** `/v1/notifications/preferences` — get push/email/SMS preferences.
- **PATCH** `/v1/notifications/preferences` — body `{ push?, email?, sms? }`.
- **POST** `/v1/devices/fcm-token` — body `{ token }` to register/update FCM token.
- In-app notification created when a booking request is sent (target user gets a notification).

Run: `npx prisma migrate dev --name add_notifications`

## Part 8 — Admin panel APIs ✓

All under **`/v1/admin`**, **JWT + admin role** required.

- **GET** `/admin/users` — list users; query: `role`, `isActive`, `search`, `page`, `limit`.
- **PATCH** `/admin/users/:id/status` — body `{ status: "active" | "inactive" | "banned" }`.
- **POST** `/admin/users/:id/verify-gst` — mark company/vendor GST verified.
- **GET** `/admin/projects` — list all projects (paginated).
- **GET** `/admin/bookings` — list all bookings (paginated).
- **GET** `/admin/invoices` — financial overview (paginated).
- **GET** `/admin/analytics/dashboard` — KPI snapshot (usersTotal, projectsTotal, bookingsTotal, invoicesTotal, revenuePaise).
- **GET** `/admin/analytics/revenue` — revenue by status, paid total/count.
- **POST** `/admin/broadcast` — body `{ title?, body, type? }` — in-app notification to all active users.

---

Backend implementation (excluding Chat and AI) is complete. Remaining: Chat, AI features (to be added later).

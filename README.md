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

5. **Start workers (optional, for OTP SMS, email, push, PDF, booking expire)**
   ```bash
   npm run build:workers
   npm run start:workers
   ```
   Requires `REDIS_URL` (same as API). Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL` for email; `MSG91_AUTH_KEY` or `TWILIO_*` for SMS; `FIREBASE_*` for push; `AWS_S3_BUCKET` for invoice PDFs. See `.env.example`.

6. **Try auth**
   - `POST /v1/auth/register/individual` with `{ "email", "phone", "password" }`
   - `POST /v1/auth/otp/send` with `{ "phone" }` — in dev, OTP is logged to console; with workers + SMS config, OTP is sent via SMS
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

- **API base URL**: `src/api/config.ts` — `http://localhost:3000/v1` in dev. Use your machine IP (e.g. `http://192.168.1.x:3000/v1`) when testing on a physical device.
- **Auth**: Login screen calls `POST /auth/login`; Register calls `/auth/register/individual|company|vendor` then login. Tokens stored in memory; logout clears them and resets to Login screen.
- **Profile**: Drawer and Profile screen show `user` from `GET /profile/me` (loaded after login).
- **Availability**: `getMyCalendar(year, month)` and `setAvailability(slots)` in `src/api/availability.ts` for future Calendar screen integration.

Ensure backend is running and CORS allows the app origin (e.g. `http://localhost:8081` for Metro, or your device IP).

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
- **GET** `/v1/invoices/:id/pdf` — returns pdfKey (generated by BullMQ PDF worker after send).
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
- **BullMQ**: Notifications also enqueue **email** (SendGrid) and **push** (FCM) per user preferences. Queues: `sms`, `email`, `push`, `pdf`, `booking-expire`. Run workers with `npm run start:workers` (see step 5 above).

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

## Part 9 — BullMQ workers ✓

- **Queues** (Redis): `sms`, `email`, `push`, `pdf`, `booking-expire`.
- **SMS**: OTP send (auth) and password-reset OTP; MSG91 or Twilio (set `MSG91_AUTH_KEY` or `TWILIO_*`).
- **Email**: SendGrid; used for notification delivery (booking request, invoice sent, etc.). Set `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`.
- **Push**: FCM for notifications and chat offline; set `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`.
- **PDF**: Invoice PDF generation (Puppeteer) and S3 upload after `POST /invoices/:id/send`; set `AWS_S3_BUCKET`.
- **Booking expire**: Delayed job (48h) marks pending booking as expired and notifies company.
- **Chat**: When recipient is offline, a delayed push job (30s) is enqueued.
- Build workers: `npm run build:workers`. Run: `npm run start:workers`. Docker: `docker compose -f docker/docker-compose.yml up -d` (includes `workers` service).

---

Backend implementation (excluding AI) is complete. Remaining: AI features (to be added later).

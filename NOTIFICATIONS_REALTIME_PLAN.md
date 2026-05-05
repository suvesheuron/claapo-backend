# Notifications — Real-Time + Push Plan

**Goal:** Make notifications **fast** (instant in-app delivery instead of up to 20 s polling delay) and **actually delivered** (FCM push so closed-browser users still get notified).

**Plan date:** 2026-05-04
**Builds on:** `CACHING_QUEUEING_PLAN.md` (Phases 1–4 already shipped)

---

## What this plan delivers

1. **DeviceToken table** — replace single `User.fcmToken` with multiple devices per user (web/iOS/Android each).
2. **Real FCM push delivery** via a new `notifications.push` BullMQ queue (the queue tier is already built in Phase 4; we add one consumer).
3. **Real-time in-app delivery** — server emits `notification:new` over the existing Socket.IO chat gateway (same connection, no new infra); frontend listens.
4. **Reduced polling load** — once Socket.IO is proven stable, raise the 20 s polling intervals to 60 s as a safety net.

## What this plan deliberately does NOT touch

- Chat polling cadence (`Chat.tsx` 8 s poll stays) — that's its own UX migration.
- Multi-pod WebSocket scaling (Socket.IO Redis adapter).
- Email / SMS delivery (Twilio, SES). FCM only.
- Browser Web Push (the "send to a closed browser tab via service worker"). FCM mobile only for now; Web Push is a follow-up if needed.
- Dropping `User.fcmToken` — kept for backwards compat for the duration of this plan; removed in a separate cleanup phase later.

---

## Ground rules (per the user's "very very carefully" ask)

1. **One phase = one PR.** Independent, revertible.
2. **Every new behavior is env-flag-gated** so we can flip it off without redeploy.
3. **Schema changes are ADDITIVE only** in this plan. No `DROP COLUMN`, no `RENAME`. We add `DeviceToken`; we leave `User.fcmToken` alone.
4. **Polling stays operational throughout.** Socket.IO is purely additive — if WS fails, the existing 20 s poll keeps the UI correct. We only tighten/reduce polling in the final phase, after WS has soaked.
5. **Best-effort side effects.** Failure to push, failure to emit a WS event, failure to clean up a stale token — all log and continue. None of them roll back the underlying notification row.
6. **No changes to chat behavior in this plan.** The ChatGateway is reused for the notification room (it already has `USER_ROOM(userId)`), but no chat code paths change.
7. **Each phase ends with a documented manual verification + rollback step.**

### Existing state we can rely on

- `apps/api/src/modules/chat/chat.gateway.ts:75` already calls `client.join(USER_ROOM(payload.sub))` on connection — perfect anchor for notification emits.
- BullMQ infrastructure is already wired (Phase 4) — adding a queue is just a new constant + a `@Processor` class.
- `AppCacheService.invalidateUnreadCount` is already called from `createForUser`; no extra invalidation work is needed.
- The flag `QUEUE_ENABLED=true` already gates the queue tier; we'll layer `FCM_ENABLED` and `WS_NOTIFICATIONS_ENABLED` independently.

---

## Phase A — DeviceToken table (foundation)

**Why first:** Phase B (FCM push) needs a per-device fan-out. The current `User.fcmToken` (single string) can't do multi-device. We add the table now, dual-write, and read from it; we leave the legacy column alone.

**Risk:** Low. Pure addition.

### A.1 Schema

Add to `prisma/schema.prisma`:

```prisma
model DeviceToken {
  id          String    @id @default(uuid()) @db.Uuid
  userId      String    @map("user_id") @db.Uuid
  token       String    @unique
  platform    String    // 'web' | 'ios' | 'android'
  lastSeenAt  DateTime  @default(now()) @map("last_seen_at")
  createdAt   DateTime  @default(now()) @map("created_at")
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("device_tokens")
}
```

Add the back-relation on `User`:

```prisma
deviceTokens  DeviceToken[]
```

**Do not touch `User.fcmToken`.** It stays nullable, dual-written, ignored by readers we add.

### A.2 Migration

```
npx prisma migrate dev --name add_device_tokens
```

Verify the generated SQL is purely `CREATE TABLE` + `CREATE INDEX`. No drops, no renames.

### A.3 Dual-write the existing endpoint

Modify `apps/api/src/modules/notifications/devices.controller.ts` to accept an optional `platform` field (default `'web'`):

```ts
@Post('fcm-token')
setFcmToken(@CurrentUser() user, @Body() dto: FcmTokenDto) {
  return this.notificationsService.registerDeviceToken(user.id, dto.token, dto.platform ?? 'web');
}
```

Modify `notifications.service.ts`:

```ts
async registerDeviceToken(userId: string, token: string, platform: string) {
  // 1. Legacy: keep User.fcmToken so existing FCM consumers (none yet) and
  //    backfill scripts continue to work.
  await this.prisma.user.update({ where: { id: userId }, data: { fcmToken: token } });
  // 2. New: multi-device store. Upsert so re-registering the same token bumps lastSeenAt.
  await this.prisma.deviceToken.upsert({
    where: { token },
    create: { userId, token, platform, lastSeenAt: new Date() },
    update: { userId, platform, lastSeenAt: new Date() },
  });
  return { ok: true };
}
```

Keep the legacy method `setFcmToken` as an alias if anything else inside the codebase calls it.

### A.4 Backfill

Create `apps/api/scripts/backfill-device-tokens.ts`:

```ts
// Reads every User.fcmToken non-null, inserts as 'web' platform.
// Idempotent — uses upsert on the unique token column.
```

Run once: `npx ts-node apps/api/scripts/backfill-device-tokens.ts`. Print before/after counts.

### A.5 Verification

- `npx prisma migrate status` clean.
- Backfill: count of `User.fcmToken IS NOT NULL` ≈ count of `DeviceToken` (allowing for duplicates if any).
- Register a token via `POST /v1/devices/fcm-token` with a fresh value → both `User.fcmToken` and a `DeviceToken` row appear.
- Re-register the same token → `DeviceToken.lastSeenAt` updates; no duplicate row.

### A.6 Rollback

Drop the migration and `prisma db push --force-reset`. The old table is untouched. No application code change is required to rollback because the legacy field is still present and authoritative.

---

## Phase B — FCM push via `notifications.push` queue

**Why second:** the table from Phase A makes multi-device fan-out possible. Now we plug in real Firebase delivery.

**Risk:** Medium — needs Firebase project config. Mitigated by `FCM_ENABLED` flag (default off until creds are present).

### B.1 Dependencies + env

Backend:
```
npm i firebase-admin
```

`.env.example` (and `.env`) additions:
```
# Firebase Admin (push notifications). Required when FCM_ENABLED=true.
FCM_ENABLED=false
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

`configuration.ts`:

```ts
fcm: {
  enabled: process.env.FCM_ENABLED === 'true',
  projectId: process.env.FIREBASE_PROJECT_ID ?? '',
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
  // FIREBASE_PRIVATE_KEY arrives with literal \n characters from env files.
  privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
},
```

Boot guard in `main.ts`: if `FCM_ENABLED=true` but any of the three creds is empty → throw "FCM_ENABLED requires FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY". Fail loud.

### B.2 Firebase Admin module

Create `apps/api/src/common/firebase/firebase.module.ts`:

```ts
@Global()
@Module({
  providers: [{
    provide: FIREBASE_APP,
    inject: [ConfigService],
    useFactory: (config) => {
      if (!config.get<boolean>('fcm.enabled')) return null;
      return admin.initializeApp({
        credential: admin.credential.cert({
          projectId: config.get('fcm.projectId'),
          clientEmail: config.get('fcm.clientEmail'),
          privateKey: config.get('fcm.privateKey'),
        }),
      });
    },
  }],
  exports: [FIREBASE_APP],
})
export class FirebaseModule {}
```

Inject into `AppModule`.

### B.3 Queue + producer

Add to `queue.constants.ts`:

```ts
export const QUEUE_NOTIFICATIONS_PUSH = 'notifications.push';
export const JOB_PUSH_SEND = 'push-send';
```

Modify `notifications.service.ts:createForUser`:

```ts
async createForUser(userId, type, title, body, data) {
  const created = await this.prisma.notification.create({...});
  await this.invalidateUnreadCount(userId);

  // NEW: enqueue FCM push as a background side effect. Best-effort —
  // a failure here doesn't roll back the notification row.
  if (isQueueEnabled() && this.fcm.enabled()) {
    try {
      await this.pushQueue.add(JOB_PUSH_SEND, {
        userId, type, title,
        body: body ?? null,
        data: data ?? null,
      }, {
        jobId: `push:${created.id}`,   // idempotent on retry
        attempts: 5,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      });
    } catch (err) {
      this.logger.warn(`enqueue push failed: ${err.message}`);
    }
  }

  return created;
}
```

Inject `@InjectQueue(QUEUE_NOTIFICATIONS_PUSH)` into `NotificationsService`.

### B.4 Consumer

Create `apps/api/src/modules/notifications/fcm-push.processor.ts`:

```ts
@Processor(QUEUE_NOTIFICATIONS_PUSH)
export class FcmPushProcessor extends WorkerHost {
  async process(job) {
    if (!isQueueEnabled() || !this.fcm.enabled()) return { skipped: true };
    const { userId, title, body, data } = job.data;

    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    if (tokens.length === 0) return { sent: 0, removed: 0 };

    const response = await this.fcm.app().messaging().sendEachForMulticast({
      tokens: tokens.map(t => t.token),
      notification: { title, body: body ?? '' },
      data: this.flattenStringMap(data),
    });

    // Clean up tokens that FCM says are no longer valid.
    const stale = response.responses
      .map((r, i) => r.success ? null : tokens[i].token)
      .filter(Boolean);
    if (stale.length > 0) {
      await this.prisma.deviceToken.deleteMany({ where: { token: { in: stale } } });
    }

    return { sent: response.successCount, failed: response.failureCount, removed: stale.length };
  }
}
```

Register in `notifications.module.ts` providers + `BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS_PUSH })`.

### B.5 Verification

- With `FCM_ENABLED=false`: enqueue path is skipped entirely. No new behavior.
- With `FCM_ENABLED=true` and a real Firebase test project:
  - Register a token via `POST /devices/fcm-token` from a test mobile build.
  - Trigger any notification (e.g. create a booking) → push arrives on the device.
  - In Redis: `bull:notifications.push:completed` ZCARD increments.
  - Job result includes `{ sent, failed, removed }`.
- Test stale-token cleanup: register a fake token `"bogus_token"` directly in DB → trigger a notification → confirm the row is deleted by the worker.
- No real Firebase project for local dev? Mock the messaging client behind an interface and enable `FCM_ENABLED` against the mock.

### B.6 Rollback

`FCM_ENABLED=false` in `.env`. Producer skips the enqueue. Existing notifications behavior is unchanged.

---

## Phase C — Real-time delivery via Socket.IO

**Why third:** with FCM the notification reaches a closed browser/phone. With WS, an open browser sees it instantly instead of waiting up to 20 s.

**Risk:** Medium-high — touches both backend gateway and frontend AuthContext. Mitigated by `WS_NOTIFICATIONS_ENABLED` flag and the fact that polling continues to work as a safety net.

### C.1 Backend — emit on notification create

The chat gateway already auto-joins `USER_ROOM(userId)` on connection (`chat.gateway.ts:75`). We piggyback on that.

Add to `chat.gateway.ts`:

```ts
/**
 * Public method called by NotificationsService after a row is committed.
 * Best-effort emit — caller does not await network propagation.
 */
emitNotificationToUser(userId: string, payload: NotificationEvent) {
  if (process.env.WS_NOTIFICATIONS_ENABLED !== 'true') return;
  try {
    this.server.to(USER_ROOM(userId)).emit('notification:new', payload);
  } catch (err) {
    this.logger.warn(`WS notification emit failed: ${err.message}`);
  }
}
```

Inject `ChatGateway` into `NotificationsService` (use `forwardRef` since `NotificationsService` is also indirectly imported by chat). Modify `createForUser`:

```ts
const created = await this.prisma.notification.create({...});
await this.invalidateUnreadCount(userId);
this.chatGateway.emitNotificationToUser(userId, {
  id: created.id,
  type: created.type,
  title: created.title,
  body: created.body,
  data: created.data,
  createdAt: created.createdAt,
});
// queue enqueue (Phase B) follows
```

### C.2 Frontend — socket client

Install:
```
cd crewcall-frontend && npm i socket.io-client
```

`.env` / `.env.production`:
```
VITE_WS_URL=http://localhost:3000  # in dev; same origin via Vite proxy if you prefer
```

Create `src/lib/socket.ts`:

```ts
let _socket: Socket | null = null;

export function getSocket(token: string): Socket {
  if (_socket?.connected) return _socket;
  _socket?.disconnect();
  _socket = io(import.meta.env.VITE_WS_URL, {
    path: '/chat',  // matches the existing chat namespace path
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
    transports: ['websocket'],
  });
  return _socket;
}

export function disconnectSocket() {
  _socket?.disconnect();
  _socket = null;
}
```

Wire from `AuthContext`:
- On login or session restore: `getSocket(accessToken)`.
- On token refresh: `disconnectSocket(); getSocket(newToken);` (new auth handshake).
- On logout: `disconnectSocket()`.

### C.3 Frontend — listen + invalidate

Modify `NavBadgesContext.tsx` and `ChatUnreadContext.tsx`:

```ts
useEffect(() => {
  if (!accessToken) return;
  const socket = getSocket(accessToken);
  const handler = () => refetch();
  socket.on('notification:new', handler);
  return () => { socket.off('notification:new', handler); };
}, [accessToken, refetch]);
```

That's it — when a notification event fires, the same `refetch()` the 20 s poll uses runs immediately. Polling continues unchanged.

### C.4 Verification

- With `WS_NOTIFICATIONS_ENABLED=false` server-side: nothing emitted. Frontend connects fine but never receives `notification:new`. UI continues to refresh every 20 s as today.
- With `WS_NOTIFICATIONS_ENABLED=true`:
  - In two browser tabs (company A, individual B), login. Open DevTools → WS frame.
  - Company A creates a booking request. Within ~100 ms tab B receives a `notification:new` frame and the badge increments.
  - Disable network on tab B briefly → badge falls back to 20 s poll → re-enable → next event arrives over WS again.
- Socket.IO disconnect handling: kill the API and watch the client retry; restart API and confirm reconnect.

### C.5 Rollback

`WS_NOTIFICATIONS_ENABLED=false`. Server stops emitting. Frontend code stays in place but the listener never fires. Polling at 20 s carries the load.

---

## Phase D — Tighten polling cadence (optional, after C has soaked)

**Goal:** once WS is proven stable for at least a week of real use, raise the polling intervals so polling acts as a low-cost safety net rather than the primary delivery mechanism.

**Risk:** Low.

### D.1 Frontend changes

- `ChatUnreadContext.POLL_INTERVAL_MS`: 20_000 → 60_000.
- `NavBadgesContext.POLL_INTERVAL_MS`: 20_000 → 60_000.
- Leave `Chat.tsx` (8 s, chat messages) untouched — out of scope.

That's it. No backend change.

### D.2 Verification

- Open the app, leave it idle 90 s with throttler/cache enabled.
- Confirm WS still delivers notifications instantly.
- Confirm if you disconnect WS, badges still update within 60 s via polling.

### D.3 Rollback

Revert the constants. Nothing else depends on them.

---

## Phase summary

| Phase | Scope | Days | Risk | User-visible |
|---|---|---|---|---|
| A | DeviceToken table + dual-write + backfill | 0.5 | Low | No |
| B | FCM push via `notifications.push` queue | 1 | Medium (needs Firebase creds) | Yes — pushes start arriving |
| C | Real-time WS push on existing chat gateway + frontend listener | 1.5 | Medium (frontend touches AuthContext) | Yes — instant in-app delivery |
| D | Tighten 20 s polls → 60 s as safety net | 0.5 | Low | Negligible |

**Total: ~3.5 working days.**

---

## Cross-cutting safeguards

These apply to every phase. Designed to make the plan unbreakable.

| Safeguard | What it prevents |
|---|---|
| Each phase behind its own env flag | Bad rollouts can be reverted with one env edit + restart |
| Schema is additive only | Migration rollback never destroys data |
| `User.fcmToken` left in place | Existing token registrations keep working through the migration |
| Dual-write before single-write | Readers can switch over independently of writers |
| Polling stays operational | If WS goes down, UI is still correct (just slower) |
| Best-effort side effects | A failed push, emit, or token cleanup never blocks the actual notification create |
| WS errors logged, not thrown | A flaky WS doesn't break the request handler |
| FCM cred validation at boot | Wrong/missing config fails loud immediately, not on first push |
| Per-job idempotency keys (`push:{id}`) | Retries don't duplicate pushes |
| Stale-token cleanup keyed on FCM error | We never accumulate dead tokens forever |

---

## Concrete verification checklist (run before merging each phase)

| Phase | Pre-merge gate |
|---|---|
| A | `prisma migrate status` clean ✓ Backfill count matches ✓ Re-registering token updates `lastSeenAt` ✓ |
| B | `FCM_ENABLED=false` produces zero new behavior ✓ With creds: real device receives push from a synthetic notification ✓ Stale token gets deleted ✓ `bull:notifications.push:completed` ZCARD increments ✓ |
| C | `WS_NOTIFICATIONS_ENABLED=false` produces zero WS frames ✓ With flag on: two-tab demo receives instant badge update ✓ Polling continues as fallback when WS disconnects ✓ |
| D | Idle 90 s with WS connected → still instant ✓ Disconnect WS → badge updates within 60 s ✓ |

---

## What this delivers in performance terms

| Today | After this plan |
|---|---|
| Notification appears 0–20 s late | Instant when browser open; up to 60 s late only as fallback |
| Closed-browser users get nothing | FCM push arrives on registered devices |
| 3 polls × 20 s = 9 req/min/user just for badges | 3 polls × 60 s = 3 req/min/user (-66 %) |
| Single-device per user | Multi-device per user |
| User.fcmToken stored, never used | DeviceToken stored AND used |

---

## Out-of-scope follow-ups (future plans, not this one)

- **Browser Web Push** — service worker + VAPID for closed-tab desktop browsers
- **SMS / Email** — Twilio / SES providers
- **Drop `User.fcmToken`** — once `DeviceToken` has been authoritative for ≥ 30 days
- **Multi-pod WS scaling** — Socket.IO Redis adapter (so WS works across multiple API pods)
- **WS-based chat migration** — drop `Chat.tsx`'s 8 s poll
- **Notification preferences enforcement** — currently `User.notificationPreferences` is stored, never consulted at delivery time

import { Worker } from 'bullmq';
import { createRedisConnection } from './redis';
import { QUEUE_PUSH, type PushJobPayload } from './shared';

let firebaseApp: unknown = null;
let firebaseMessaging: { send: (msg: unknown) => Promise<string> } | null = null;
function getMessaging(): typeof firebaseMessaging {
  if (firebaseMessaging) return firebaseMessaging;
  if (!firebaseApp) {
    const key = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    if (key && clientEmail && projectId) {
      const admin = require('firebase-admin');
      firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey: key.replace(/\\n/g, '\n'),
        }),
      });
      firebaseMessaging = admin.messaging();
    }
  }
  return firebaseMessaging;
}

const connection = createRedisConnection();

async function sendPush(payload: PushJobPayload): Promise<void> {
  const messaging = getMessaging();
  const token = payload.fcmToken;

  if (!token && !payload.userId) return;

  if (!messaging) {
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Push Worker] Dev: would send to ${payload.userId}: ${payload.title}`);
      return;
    }
    throw new Error('Firebase not configured: set FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, FIREBASE_PROJECT_ID');
  }

  const targetToken = token || await getFcmTokenForUser(payload.userId);
  if (!targetToken) return;

  await messaging.send({
    token: targetToken,
    notification: { title: payload.title, body: payload.body },
    data: payload.data ?? {},
    android: { priority: 'high' as const },
    apns: { payload: { aps: { sound: 'default' } } },
  });
}

async function getFcmTokenForUser(userId: string): Promise<string | null> {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true },
    });
    return user?.fcmToken ?? null;
  } finally {
    await prisma.$disconnect();
  }
}

const worker = new Worker<PushJobPayload>(
  QUEUE_PUSH,
  async (job) => {
    if (job.name === 'notification' || job.name === 'chat_offline') {
      await sendPush(job.data);
    }
  },
  {
    connection: connection as any,
    concurrency: 5,
  },
);

worker.on('completed', (job) => console.log(`[Push] Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`[Push] Job ${job?.id} failed:`, err.message));

async function close() {
  await worker.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);

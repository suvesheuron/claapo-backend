import sgMail from '@sendgrid/mail';
import { Worker } from 'bullmq';
import { createRedisConnection } from './redis';
import { QUEUE_EMAIL, type EmailJobPayload } from './shared';

const apiKey = process.env.SENDGRID_API_KEY;
if (apiKey) {
  sgMail.setApiKey(apiKey);
}

const connection = createRedisConnection();
const fromEmail = process.env.SENDGRID_FROM_EMAIL ?? 'noreply@crewcall.in';
const fromName = process.env.SENDGRID_FROM_NAME ?? 'CrewCall';

const worker = new Worker<EmailJobPayload>(
  QUEUE_EMAIL,
  async (job) => {
    if (job.name === 'notification') {
      const { to, subject, html, text } = job.data;
      if (!apiKey) {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[Email Worker] Dev: would send to ${to}: ${subject}`);
          return;
        }
        throw new Error('SENDGRID_API_KEY not set');
      }
      await sgMail.send({
        to,
        from: { email: fromEmail, name: fromName },
        subject,
        html: html || (text ? `<p>${text}</p>` : ''),
        text: text ?? undefined,
      });
    }
  },
  {
    connection: connection as any,
    concurrency: 5,
  },
);

worker.on('completed', (job) => console.log(`[Email] Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`[Email] Job ${job?.id} failed:`, err.message));

async function close() {
  await worker.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);

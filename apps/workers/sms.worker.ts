import { Worker } from 'bullmq';
import { createRedisConnection } from './redis';
import { QUEUE_SMS, type SmsJobPayload } from './shared';

const connection = createRedisConnection();

async function sendSms(payload: SmsJobPayload): Promise<void> {
  const { phone, otp, type } = payload;
  const msg = type === 'password_reset'
    ? `Your CrewCall password reset OTP is ${otp}. Valid for 5 minutes.`
    : `Your CrewCall verification code is ${otp}. Valid for 5 minutes.`;

  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_NUMBER;

  if (twilioAccountSid && twilioAuthToken && twilioFrom) {
    try {
      const twilio = require('twilio');
      const client = twilio(twilioAccountSid, twilioAuthToken);
      await client.messages.create({
        body: msg,
        from: twilioFrom,
        to: phone.startsWith('+') ? phone : `+91${phone.replace(/\D/g, '')}`,
      });
      return;
    } catch (e) {
      throw new Error(`Twilio send failed: ${(e as Error).message}`);
    }
  }

  const msg91AuthKey = process.env.MSG91_AUTH_KEY;
  if (msg91AuthKey) {
    const res = await fetch('https://api.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authkey: msg91AuthKey },
      body: JSON.stringify({
        template_id: process.env.MSG91_TEMPLATE_ID || 'default',
        short_url: '0',
        recipients: [{ mobiles: `91${phone.replace(/\D/g, '')}`, otp }],
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`MSG91 error: ${res.status} ${text}`);
    }
    return;
  }

  if (process.env.NODE_ENV === 'development') {
    console.log(`[SMS Worker] Dev: would send OTP ${otp} to ${phone}`);
    return;
  }
  throw new Error('SMS not configured: set TWILIO_* or MSG91_AUTH_KEY');
}

const worker = new Worker<SmsJobPayload>(
  QUEUE_SMS,
  async (job) => {
    if (job.name === 'otp') {
      await sendSms(job.data);
    }
  },
  {
    connection: connection as any,
    concurrency: 5,
  },
);

worker.on('completed', (job) => console.log(`[SMS] Job ${job.id} completed`));
worker.on('failed', (job, err) => console.error(`[SMS] Job ${job?.id} failed:`, err.message));

async function close() {
  await worker.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGTERM', close);
process.on('SIGINT', close);

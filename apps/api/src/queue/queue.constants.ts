/**
 * BullMQ queue names. Must match worker queue names and job payload types.
 */
export const QUEUE_SMS = 'sms';
export const QUEUE_EMAIL = 'email';
export const QUEUE_PUSH = 'push';
export const QUEUE_PDF = 'pdf';
export const QUEUE_BOOKING_EXPIRE = 'booking-expire';

export const QUEUE_NAMES = [
  QUEUE_SMS,
  QUEUE_EMAIL,
  QUEUE_PUSH,
  QUEUE_PDF,
  QUEUE_BOOKING_EXPIRE,
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

/** Default job options: retries and backoff per plan (max 3, exponential 5s, 30s, 120s) */
export const DEFAULT_JOB_OPTS = {
  attempts: 3,
  backoff: {
    type: 'exponential' as const,
    delay: 5000,
  },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

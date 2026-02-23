/**
 * Queue names and job payload types for workers. Must match API queue.constants and job-payloads.
 */
export const QUEUE_SMS = 'sms';
export const QUEUE_EMAIL = 'email';
export const QUEUE_PUSH = 'push';
export const QUEUE_PDF = 'pdf';
export const QUEUE_BOOKING_EXPIRE = 'booking-expire';

export type OtpJobType = 'registration' | 'login' | 'password_reset';

export interface SmsJobPayload {
  phone: string;
  otp: string;
  type: OtpJobType;
}

export interface EmailJobPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  templateId?: string;
  dynamicTemplateData?: Record<string, unknown>;
}

export interface PushJobPayload {
  userId: string;
  title: string;
  body?: string;
  data?: Record<string, string>;
  fcmToken?: string;
}

export interface PdfJobPayload {
  invoiceId: string;
}

export interface BookingExpireJobPayload {
  bookingId: string;
}

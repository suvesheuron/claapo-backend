/**
 * Job payload types for BullMQ queues. Workers must use the same shapes.
 */

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
  /** If set, use this token instead of looking up user's fcmToken */
  fcmToken?: string;
}

export interface PdfJobPayload {
  invoiceId: string;
}

export interface BookingExpireJobPayload {
  bookingId: string;
}

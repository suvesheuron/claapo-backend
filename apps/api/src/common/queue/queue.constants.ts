/**
 * Central registry of BullMQ queue names. Producers and consumers MUST import
 * from here so a queue is never spelled differently in two places.
 */
export const QUEUE_BOOKINGS_EXPIRE = 'bookings.expire';
export const QUEUE_NOTIFICATIONS = 'notifications.send';

/** Job name(s) on the notifications.send queue. */
export const JOB_BOOKING_CREATED = 'booking-created';

/** Job name on the bookings.expire queue (single ticker). */
export const JOB_EXPIRE_TICK = 'tick';

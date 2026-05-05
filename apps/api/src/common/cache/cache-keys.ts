/**
 * Central cache-key registry. Every module that reads or invalidates a cache
 * entry MUST go through this file — no inline string literals — so we never
 * end up with a writer and a reader using subtly different key formats.
 */
export const cacheKeys = {
  /** `{ mainUserId, role }` for a user — used by chat & notifications hot paths. */
  userIdentity: (userId: string) => `user:${userId}:identity`,

  /** Pre-signed GET URL for a storage object key. */
  signedUrl: (storageKey: string) => `signed-url:${storageKey}`,

  /** Unread notification count for a user (account-aware). */
  unreadNotificationCount: (userId: string) => `notify:unread-count:${userId}`,
};

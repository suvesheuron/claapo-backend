/**
 * Helpers for producer-side queue interactions. The single source of truth for
 * the QUEUE_ENABLED feature flag — every `.add()` call site funnels through
 * here so flipping the flag is a one-line behavioral switch.
 */

export function isQueueEnabled(): boolean {
  return process.env.QUEUE_ENABLED === 'true';
}

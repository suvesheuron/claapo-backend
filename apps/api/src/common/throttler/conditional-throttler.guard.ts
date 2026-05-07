import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Throttler guard that no-ops when the THROTTLER_ENABLED env flag is not "true".
 *
 * We read directly from process.env so the guard stays cheap and stateless;
 * env vars are immutable at runtime, so caching via ConfigService gains nothing
 * and adds DI complexity over an already-extended guard.
 */
@Injectable()
export class ConditionalThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (process.env.THROTTLER_ENABLED !== 'true') return true;
    return super.canActivate(context);
  }
}

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  SIGN_IN_MAX_KEYS,
  SIGN_IN_WINDOW_MS,
  createRateLimiter,
  ipRateKey,
} from '../auth/rate-limit.js';

/** Typed-value tests per signed-in user per window (a user retrying a URL or key a few times). */
export const TYPED_TEST_MAX_PER_USER = 20;
/**
 * Per client IP per window. Well above the per-user limit because many users can share one IP
 * behind a NAT (5 users each at their full per-user limit).
 */
export const TYPED_TEST_MAX_PER_IP = 100;

/**
 * Rate limit for the Settings routes that take typed, unsaved values (Wallos Test connection,
 * Actual Load budgets). Each call owns its own limiter, so these routes never share a counter with
 * login, register, verify-email or password change. Keys are the session user id and the client IP;
 * the user key is taken first, so attempts the user limit already refused do not use up the shared
 * IP budget. Returns a function that answers 429 and returns true when the request is refused.
 */
export function createTypedTestGuard(now: () => number = Date.now) {
  const limiter = createRateLimiter({
    now,
    maxPerEmail: TYPED_TEST_MAX_PER_USER,
    maxPerIp: TYPED_TEST_MAX_PER_IP,
    windowMs: SIGN_IN_WINDOW_MS,
    maxKeys: SIGN_IN_MAX_KEYS,
  });
  return (request: FastifyRequest, reply: FastifyReply, userId: string): boolean => {
    for (const key of [`email:${userId}`, `ip:${ipRateKey(request.ip)}`] as const) {
      const result = limiter.take(key);
      if (!result.allowed) {
        void reply
          .header('Retry-After', String(result.retryAfterSeconds))
          .code(429)
          .send({ error: 'rate_limited' });
        return true;
      }
    }
    return false;
  };
}

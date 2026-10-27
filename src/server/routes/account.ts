import type { FastifyError, FastifyPluginAsync } from 'fastify';
import type { AuthMode } from '../../lib/auth-mode.js';
import {
  isAcceptablePasswordLength,
  isWithinRawLimit,
  hashPassword,
  normalisePassword,
  verifyAgainstDummy,
  verifyPassword,
} from '../auth/passwords.js';
import {
  SIGN_IN_MAX_KEYS,
  SIGN_IN_MAX_PER_EMAIL,
  SIGN_IN_WINDOW_MS,
  createRateLimiter,
  ipRateKey,
} from '../auth/rate-limit.js';
import { isAdminEmail } from '../auth/registration.js';
import type { AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';

/** Password changes per client IP per window; well above the per-user limit (see the limiter below). */
export const PASSWORD_CHANGE_MAX_PER_IP = 100;

export interface AccountRoutesOptions {
  readonly db: AppDatabase;
  readonly mode: AuthMode;
  /** Lowercased ADMIN_EMAILS, for the `isAdmin` flag. Default none. */
  readonly adminEmails?: readonly string[];
  /** Clock in ms for the password-change limiter. Defaults to `Date.now`. */
  readonly now?: () => number;
}

/**
 * GET /api/account and PUT /api/account/password. Both read the user from the session only.
 * The password hash is read inside the PUT handler and never leaves it. A successful change
 * deletes the user's other sessions and keeps the current one.
 */
export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (app, opts) => {
  const { db, mode } = opts;
  const adminEmails = opts.adminEmails ?? [];

  // Own limiter, per user id and per client IP. The current password is checked here, so this
  // route is a password-guessing oracle for a stolen session. The per-user limit (5 per 15 min)
  // bounds guessing against one account. The per-IP key is kept only as abuse protection and is
  // set well above it (100 per 15 min, 20 users each at their full per-user limit), because many
  // users can share one IP behind a NAT: one user's failures must not block another before that
  // user reaches their own per-user limit. The user key is taken first, so attempts already
  // refused by the per-user limit do not also use up the shared IP budget.
  const limiter = createRateLimiter({
    now: opts.now ?? Date.now,
    maxPerEmail: SIGN_IN_MAX_PER_EMAIL,
    maxPerIp: PASSWORD_CHANGE_MAX_PER_IP,
    windowMs: SIGN_IN_WINDOW_MS,
    maxKeys: SIGN_IN_MAX_KEYS,
  });

  // Body parse failures (malformed JSON, empty body, wrong media type) get a fixed body.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/account', (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const repo = createUserRepo(db, request.auth.userId);
    const email = repo.getEmail();
    if (email === undefined) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return {
      email,
      mode,
      hasPassword: repo.getPasswordHash() !== null,
      identities: repo.listIdentities(),
      isAdmin: isAdminEmail(adminEmails, email),
    };
  });

  app.put('/account/password', { config: { localAuthOnly: true } }, async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    if (mode === 'oidc') {
      return reply.code(403).send({ error: 'local_auth_disabled' });
    }
    // Before the body is read or any Argon2 work. The per-user key is the user id.
    for (const key of [`email:${request.auth.userId}`, `ip:${ipRateKey(request.ip)}`] as const) {
      const result = limiter.take(key);
      if (!result.allowed) {
        return reply
          .header('Retry-After', String(result.retryAfterSeconds))
          .code(429)
          .send({ error: 'rate_limited' });
      }
    }
    const body: unknown = request.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const { currentPassword, newPassword } = body as Record<string, unknown>;
    if (
      typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' ||
      !isWithinRawLimit(newPassword)
    ) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const next = normalisePassword(newPassword);
    if (!isAcceptablePasswordLength(next)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const repo = createUserRepo(db, request.auth.userId);
    const stored = repo.getPasswordHash();
    let ok: boolean;
    if (stored === null || !isWithinRawLimit(currentPassword)) {
      ok = await verifyAgainstDummy('');
    } else {
      const current = normalisePassword(currentPassword);
      ok = isAcceptablePasswordLength(current)
        ? await verifyPassword(current, stored)
        : await verifyAgainstDummy('');
    }
    if (!ok) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    if (!repo.setPasswordHash(await hashPassword(next))) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    limiter.clear(`email:${request.auth.userId}`);
    repo.deleteOtherSessions(request.auth.idHash);
    return reply.code(204).send();
  });
};

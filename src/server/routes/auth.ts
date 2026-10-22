import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthMode } from '../../lib/auth-mode.js';
import {
  deleteSession,
  createSession,
  setSessionCookies,
} from '../auth/sessions.js';
import {
  SIGN_IN_MAX_KEYS,
  SIGN_IN_MAX_PER_EMAIL,
  SIGN_IN_MAX_PER_IP,
  SIGN_IN_WINDOW_MS,
  createRateLimiter,
  ipRateKey,
  type RateLimitKey,
} from '../auth/rate-limit.js';
import {
  dummyHashReady,
  hashPassword,
  isAcceptablePasswordLength,
  isWithinRawLimit,
  normalisePassword,
  verifyAgainstDummy,
  verifyPassword,
  warmDummyHash,
} from '../auth/passwords.js';
import { createUser } from '../db/accounts.js';
import type { AppDatabase } from '../db/client.js';
import { findLoginByEmail } from '../db/lookup.js';
import { createUserRepo } from '../db/repo.js';

export interface AuthRoutesOptions {
  readonly db: AppDatabase;
  readonly mode: AuthMode;
  readonly allowRegistration: boolean;
  readonly secureCookies: boolean;
  /** Clock in ms since the epoch, the same one the session hook uses. */
  readonly now: () => number;
}

const MAX_EMAIL_LENGTH = 254;

interface Credentials {
  readonly email: string;
  readonly password: string;
}

/** Reads a body with a string email and a string password, or null. Nothing is logged. */
function readCredentials(body: unknown): Credentials | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return null;
  }
  return { email, password };
}

/** True only for a unique violation on users.email. Anything else is a real failure. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' &&
    message === 'UNIQUE constraint failed: users.email'
  );
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, opts) => {
  const { db, mode, allowRegistration, secureCookies, now } = opts;

  if (mode === 'local') {
    // Pay for the dummy hash now, not on the first unknown-email login.
    warmDummyHash();
  }

  app.get('/auth/config', { config: { public: true } }, () => ({
    mode,
    registration: allowRegistration,
  }));

  app.get('/auth/me', (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const email = createUserRepo(db, request.auth.userId).getEmail();
    if (email === undefined) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return { email, authMethod: request.auth.authMethod };
  });

  /** Replaces the caller's current session, if any, with a fresh local one. */
  function startLocalSession(request: FastifyRequest, reply: FastifyReply, userId: string): void {
    if (request.auth !== null) {
      deleteSession(db, request.auth);
    }
    setSessionCookies(reply, createSession(db, userId, 'local', now()), secureCookies);
  }

  // One limiter holds both kinds of key. The email counter is shared by login and register.
  const limiter = createRateLimiter({
    now,
    maxPerEmail: SIGN_IN_MAX_PER_EMAIL,
    maxPerIp: SIGN_IN_MAX_PER_IP,
    windowMs: SIGN_IN_WINDOW_MS,
    maxKeys: SIGN_IN_MAX_KEYS,
  });

  /** Counts one attempt. On refusal sends 429 and returns true; the caller must stop. */
  function limited(reply: FastifyReply, key: RateLimitKey): boolean {
    const result = limiter.take(key);
    if (result.allowed) {
      return false;
    }
    void reply
      .header('Retry-After', String(result.retryAfterSeconds))
      .code(429)
      .send({ error: 'rate_limited' });
    return true;
  }

  // The local credential routes live in their own scope so the two hooks below touch only them.
  await app.register(async (local) => {
    // Runs before the body is parsed, validated or the database is read.
    local.addHook('onRequest', (_request, reply, done) => {
      if (mode === 'oidc') {
        void reply.code(403).send({ error: 'local_auth_disabled' });
        return;
      }
      done();
    });

    // A malformed JSON body gets the same answer as a missing field. Any 5xx gets a fixed body.
    local.setErrorHandler((error: FastifyError, _request, reply) => {
      if (error.statusCode === 400) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const status = error.statusCode;
      if (status === undefined || status >= 500) {
        // Never echo the internal message (for example an Argon2 error) to the caller.
        return reply.code(500).send({ error: 'internal' });
      }
      throw error;
    });

    local.post('/auth/register', { config: { public: true } }, async (request, reply) => {
      if (!allowRegistration) {
        return reply.code(403).send({ error: 'registration_disabled' });
      }
      // Order: mode gate (hook), registration gate, IP, then email, all before any credential work.
      if (limited(reply, `ip:${ipRateKey(request.ip)}`)) {
        return reply;
      }
      const credentials = readCredentials(request.body);
      if (credentials === null) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const email = credentials.email.trim().toLowerCase();
      // Before the limiter key exists, so a huge email never becomes a map key.
      if (email.length > MAX_EMAIL_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (limited(reply, `email:${email}`)) {
        return reply;
      }
      if (email === '' || !email.includes('@')) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (!isWithinRawLimit(credentials.password)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const password = normalisePassword(credentials.password);
      if (!isAcceptablePasswordLength(password)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (findLoginByEmail(db, email) !== undefined) {
        return reply.code(409).send({ error: 'email_taken' });
      }
      const passwordHash = await hashPassword(password);
      let user: { id: string; email: string };
      try {
        user = createUser(db, { email, passwordHash });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: 'email_taken' });
        }
        throw error;
      }
      startLocalSession(request, reply, user.id);
      return reply.code(201).send({ email: user.email, authMethod: 'local' });
    });

    local.post('/auth/login', { config: { public: true } }, async (request, reply) => {
      // Order: mode gate (hook), IP, then email, before the dummy hash, lookup or any Argon2 work.
      if (limited(reply, `ip:${ipRateKey(request.ip)}`)) {
        return reply;
      }
      const credentials = readCredentials(request.body);
      if (credentials === null) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const email = credentials.email.trim().toLowerCase();
      // Before the limiter key exists, so a huge email never becomes a map key.
      if (email.length > MAX_EMAIL_LENGTH) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (limited(reply, `email:${email}`)) {
        return reply;
      }
      // Before any lookup or branch: if the dummy hash is unavailable every login throws (500),
      // so the status cannot depend on which email was sent.
      await dummyHashReady();
      const user = findLoginByEmail(db, email);
      let ok: boolean;
      if (!isWithinRawLimit(credentials.password)) {
        // Neither normalised nor hashed: only the dummy check, so the timing still matches.
        ok = await verifyAgainstDummy('');
      } else {
        const password = normalisePassword(credentials.password);
        if (user?.passwordHash == null) {
          ok = await verifyAgainstDummy(password);
        } else if (isAcceptablePasswordLength(password)) {
          ok = await verifyPassword(password, user.passwordHash);
        } else {
          // Out of range: the normalised value never reaches Argon2.
          ok = await verifyAgainstDummy('');
        }
      }
      if (user === undefined || user.passwordHash === null || !ok) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      limiter.clear(`email:${email}`);
      startLocalSession(request, reply, user.userId);
      return reply.code(200).send({ email, authMethod: 'local' });
    });
  });
};

import { randomBytes } from 'node:crypto';
import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthMode } from '../../lib/auth-mode.js';
import {
  deleteSession,
  createSession,
  hashToken,
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
import { canRegisterEmail, isRegistrationOpen } from '../auth/registration.js';
import { createUser } from '../db/accounts.js';
import type { AppDatabase } from '../db/client.js';
import { findEmailVerification, findLoginByEmail } from '../db/lookup.js';
import { createUserRepo } from '../db/repo.js';
import {
  VERIFICATION_TOKEN_TTL_MS,
  alreadyRegisteredEmail,
  verificationEmail,
  type Mailer,
} from '../mail/index.js';

export interface AuthRoutesOptions {
  readonly db: AppDatabase;
  readonly mode: AuthMode;
  readonly allowRegistration: boolean;
  /** Lowercased ADMIN_EMAILS: these may register while the stored toggle is off. Default none. */
  readonly adminEmails?: readonly string[];
  readonly secureCookies: boolean;
  /** Clock in ms since the epoch, the same one the session hook uses. */
  readonly now: () => number;
  /** Sends verification mail. Fire and forget: a failure never changes a response. */
  readonly mailer: Mailer;
  /** The origin browsers use to reach Walley; verification links start with it. */
  readonly publicOrigin: string;
}

const MAX_EMAIL_LENGTH = 254;

/**
 * Registration only: no whitespace or control characters, one '@', and a dot in the domain.
 * The local part also excludes ',', ';', '"', '<' and '>', which nodemailer's address parser splits or unquotes.
 */
const REGISTER_EMAIL_SHAPE = /^[^\s@,;"<>\p{Cc}]+@[^\s@.\p{Cc}]+(?:\.[^\s@.\p{Cc}]+)+$/u;

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
  const { db, mode, allowRegistration, secureCookies, now, mailer, publicOrigin } = opts;
  const adminEmails = opts.adminEmails ?? [];

  if (mode === 'local') {
    // Pay for the dummy hash now, not on the first unknown-email login.
    warmDummyHash();
  }

  // The effective state: the ALLOW_REGISTRATION ceiling AND the admin toggle, read per request.
  app.get('/auth/config', { config: { public: true } }, () => ({
    mode,
    registration: isRegistrationOpen(db, allowRegistration),
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

  const limiterOptions = {
    now,
    maxPerEmail: SIGN_IN_MAX_PER_EMAIL,
    maxPerIp: SIGN_IN_MAX_PER_IP,
    windowMs: SIGN_IN_WINDOW_MS,
    maxKeys: SIGN_IN_MAX_KEYS,
  };
  // Holds the IP keys of login and register and the email counter they share.
  const limiter = createRateLimiter(limiterOptions);
  // verify-email's own IP counter, so a login or register flood from one IP cannot block it.
  // It stops guessing across many tokens (SIGN_IN_MAX_PER_IP).
  const verifyLimiter = createRateLimiter(limiterOptions);

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

    local.post('/auth/register', { config: { public: true, localAuthOnly: true } }, async (request, reply) => {
      const body: unknown = request.body;
      const submitted = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).email : undefined;
      if (!canRegisterEmail(db, allowRegistration, adminEmails, typeof submitted === 'string' ? submitted : '')) {
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
      // Also before the limiter key exists: only a plain local@domain.tld shape becomes an email key.
      if (!REGISTER_EMAIL_SHAPE.test(email)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      if (limited(reply, `email:${email}`)) {
        return reply;
      }
      if (!isWithinRawLimit(credentials.password)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const password = normalisePassword(credentials.password);
      if (!isAcceptablePasswordLength(password)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      // Always hash, whatever the email's state, so the timing does not reveal it.
      const passwordHash = await hashPassword(password);
      const existing = findLoginByEmail(db, email);
      const sendAlreadyRegistered = (): void => {
        const content = alreadyRegisteredEmail(publicOrigin);
        mailer.send({ to: email, subject: content.subject, text: content.text });
      };
      // Stores only the hash of a fresh token and mails the link. Every older token of this user
      // is voided. The registrant's password hash rides on the token, never on the user, until
      // the token is used. If the user already has a live token, the repo keeps that token's
      // pending hash and this registrant's hash is discarded (issue 132, M1).
      const issueVerification = (userId: string, pendingPasswordHash: string): void => {
        const token = randomBytes(32).toString('hex');
        const issuedAt = now();
        createUserRepo(db, userId).createEmailVerification({
          idHash: hashToken(token),
          now: new Date(issuedAt),
          expiresAt: new Date(issuedAt + VERIFICATION_TOKEN_TTL_MS),
          pendingPasswordHash,
        });
        const content = verificationEmail(publicOrigin, token);
        mailer.send({ to: email, subject: content.subject, text: content.text });
      };
      try {
        if (existing === undefined) {
          // No password on the user until the address is verified.
          const user = createUser(db, { email, passwordHash: null });
          issueVerification(user.id, passwordHash);
        } else if (!existing.emailVerified) {
          // A fresh link that voids the earlier tokens. It keeps the pending hash of a live
          // earlier token; only with no live token does it carry this registrant's hash.
          issueVerification(existing.userId, passwordHash);
        } else {
          sendAlreadyRegistered();
        }
      } catch (error) {
        // A concurrent registration of the same email gets the same answer.
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
      return reply.code(202).send({ status: 'verification_sent' });
    });

    local.post('/auth/verify-email', { config: { public: true, localAuthOnly: true } }, async (request, reply) => {
      const body =
        typeof request.body === 'object' && request.body !== null
          ? (request.body as Record<string, unknown>)
          : {};
      const token = body['token'];
      if (typeof token !== 'string') {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      // Per-IP guard against guessing across many tokens, on verify-email's own limiter.
      const ipTake = verifyLimiter.take(`ip:${ipRateKey(request.ip)}`);
      if (!ipTake.allowed) {
        return reply
          .header('Retry-After', String(ipTake.retryAfterSeconds))
          .code(429)
          .send({ error: 'rate_limited' });
      }
      const idHash = hashToken(token);
      const when = new Date(now());
      const found = findEmailVerification(db, idHash, when);
      // A verified owner's leftover token looks exactly like an unknown one.
      if (found === undefined || found.emailVerified) {
        return reply.code(400).send({ error: 'invalid_token' });
      }
      // Issued before the password moved onto the token: there is no hash to apply, so refuse.
      if (found.pendingPasswordHash === null) {
        return reply.code(400).send({ error: 'token_without_password' });
      }
      // The link is the proof of inbox ownership: no password is asked. A token consumed or
      // voided meanwhile looks like an unknown one.
      if (!createUserRepo(db, found.userId).consumeEmailVerification(idHash, when)) {
        return reply.code(400).send({ error: 'invalid_token' });
      }
      return reply.code(204).send();
    });

    local.post('/auth/login', { config: { public: true, localAuthOnly: true } }, async (request, reply) => {
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
      // An email without '@' can never match a local user, so it gets no limiter key. It still
      // runs the dummy hash below and gets the same 401, so the timing does not change.
      const plausibleEmail = email.includes('@');
      if (plausibleEmail && limited(reply, `email:${email}`)) {
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
        if (user?.passwordHash == null || !user.emailVerified) {
          // Unverified counts as a wrong password: same dummy work, same 401.
          ok = await verifyAgainstDummy(password);
        } else if (isAcceptablePasswordLength(password)) {
          ok = await verifyPassword(password, user.passwordHash);
        } else {
          // Out of range: the normalised value never reaches Argon2.
          ok = await verifyAgainstDummy('');
        }
      }
      if (user === undefined || user.passwordHash === null || !user.emailVerified || !ok) {
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      limiter.clear(`email:${email}`);
      startLocalSession(request, reply, user.userId);
      return reply.code(200).send({ email, authMethod: 'local' });
    });
  });
};

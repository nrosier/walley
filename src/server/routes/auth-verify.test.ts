import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthMode } from '../../lib/auth-mode.js';
import { hashPassword, verifyAgainstDummy } from '../auth/passwords.js';
import { hashToken } from '../auth/sessions.js';
import { createUser } from '../db/accounts.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { findSessionByIdHash } from '../db/lookup.js';
import {
  VERIFICATION_TOKEN_TTL_MS,
  MAIL_FAILED_LINE,
  alreadyRegisteredEmail,
  createCapturingMailer,
  createMailer,
  verificationEmail,
  type CapturingMailer,
  type Mailer,
} from '../mail/index.js';
import { makeAuthApp, signIn, type AuthApp } from '../test/auth-helpers.js';

// Counts every Argon2 derivation (hash or verify), as auth-local.test.ts does.
const argon = vi.hoisted(() => ({ calls: 0 }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const wrapped = ((alg: string, params: unknown, callback: unknown) => {
    argon.calls += 1;
    (actual.argon2 as unknown as (...a: unknown[]) => void)(alg, params, callback);
  }) as unknown as typeof actual.argon2;
  return { ...actual, argon2: wrapped };
});

// Records every limiter key taken, so a refused register can be shown to create none.
const limiterKeys = vi.hoisted(() => ({ taken: [] as string[] }));

vi.mock('../auth/rate-limit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/rate-limit.js')>();
  return {
    ...actual,
    createRateLimiter: (opts: Parameters<typeof actual.createRateLimiter>[0]) => {
      const limiter = actual.createRateLimiter(opts);
      return {
        ...limiter,
        take: (key: string) => {
          limiterKeys.taken.push(key);
          return limiter.take(key as Parameters<typeof limiter.take>[0]);
        },
      };
    },
  };
});

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a different long passphrase';
const ACCEPTED_BODY = '{"status":"verification_sent"}';

const created: AuthApp[] = [];

afterEach(async () => {
  for (const t of created.splice(0)) {
    await t.app.close();
    closeDatabase(t.db);
  }
});

function setup(
  opts: {
    mode?: AuthMode;
    allowRegistration?: boolean;
    mailer?: Mailer;
    logStream?: NodeJS.WritableStream;
  } = {},
): AuthApp {
  const t = makeAuthApp({ allowRegistration: true, ...opts });
  created.push(t);
  return t;
}

function post(t: AuthApp, url: string, payload: unknown, headers: Record<string, string> = {}) {
  return t.app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: { origin: t.publicOrigin, ...headers },
  });
}

const register = (t: AuthApp, email: string, password = PASSWORD) =>
  post(t, '/api/auth/register', { email, password });
const login = (t: AuthApp, email: string, password = PASSWORD) =>
  post(t, '/api/auth/login', { email, password });
const verify = (t: AuthApp, token: unknown) => post(t, '/api/auth/verify-email', { token });

/** The token in the most recent verification mail, read from the link in its body. */
function lastToken(mailer: CapturingMailer): string {
  const text = mailer.sent.at(-1)?.text ?? '';
  const match = /#token=([0-9a-f]+)/.exec(text);
  if (match?.[1] === undefined) throw new Error('no verification link in the last mail');
  return match[1];
}

function userRow(db: AppDatabase, email: string) {
  return db.$client
    .prepare('select password_hash as hash, email_verified_at as verifiedAt from users where email = ?')
    .get(email) as { hash: string | null; verifiedAt: number | null } | undefined;
}

/** The pending password hash on the token row for this raw token, or undefined if there is no row. */
function pendingHash(db: AppDatabase, token: string): string | null | undefined {
  const row = db.$client
    .prepare('select pending_password_hash as h from email_verifications where id = ?')
    .get(hashToken(token)) as { h: string | null } | undefined;
  return row?.h;
}

function tokenCount(db: AppDatabase): number {
  return (db.$client.prepare('select count(*) as n from email_verifications').get() as { n: number }).n;
}

describe('POST /api/auth/register responses', () => {
  it('returns identical bytes for new, unverified, verified, OIDC and re-cased emails, with no cookie', async () => {
    const t = setup();
    createUser(t.db, { email: 'verified@example.test', passwordHash: await hashPassword(PASSWORD), verifiedAt: new Date() });
    createUser(t.db, { email: 'oidc@example.test', passwordHash: null, identity: { issuer: 'https://idp.test', subject: 'sub-1' } });
    expect((await register(t, 'unverified@example.test')).statusCode).toBe(202);

    const responses = [
      await register(t, 'brand-new@example.test'),
      await register(t, 'unverified@example.test'),
      await register(t, 'verified@example.test'),
      await register(t, 'oidc@example.test'),
      await register(t, '  UNVERIFIED@Example.TEST '),
      await register(t, 'VERIFIED@example.test'),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(202);
      expect(res.body).toBe(ACCEPTED_BODY);
      expect(res.headers['content-type']).toBe(responses[0]?.headers['content-type']);
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.cookies).toHaveLength(0);
    }
  });

  it('leaves the session the request carries in the database', async () => {
    const t = setup();
    const owner = signIn(t, createUser(t.db, { email: 'owner@example.test', passwordHash: null }).id);
    const res = await post(t, '/api/auth/register', { email: 'x@example.test', password: PASSWORD }, {
      cookie: owner.cookie,
      'x-csrf-token': owner.csrfToken,
    });
    expect(res.statusCode).toBe(202);
    expect(res.cookies).toHaveLength(0);
    expect(findSessionByIdHash(t.db, hashToken(owner.token))).toBeDefined();
  });
});

describe('register email shape', () => {
  it.each([
    ['no dot in the domain', 'user@localhost'],
    ['a space inside', 'us er@example.test'],
    ['a tab inside', 'user@exa\tmple.test'],
    ['a newline inside', 'user@exam\nple.test'],
    ['a control character', 'user\u0007@example.test'],
    ['two at signs', 'a@b@example.test'],
    ['an empty local part', '@example.test'],
    ['an empty domain label', 'user@example..test'],
    ['no at sign', 'example.test'],
  ])('refuses %s with 400 invalid_request and sends no mail', async (_name, email) => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    const res = await register(t, email);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(mailer.sent).toHaveLength(0);
    expect(tokenCount(t.db)).toBe(0);
  });

  it.each([
    ['a comma splitting the local part', 'x,victim@corp.com'],
    ['a semicolon in the local part', 'a;b@x.co'],
    ['a double quote in the local part', 'a"b@x.co'],
    ['an angle bracket in the local part', 'a<b@x.co'],
  ])('refuses %s with 400 invalid_request, no user and no limiter key', async (_name, email) => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    limiterKeys.taken.length = 0;
    const res = await register(t, email);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(userRow(t.db, email.toLowerCase())).toBeUndefined();
    expect(limiterKeys.taken.filter((key) => key.startsWith('email:'))).toEqual([]);
    expect(mailer.sent).toHaveLength(0);
  });

  it('accepts a plain address after trimming and lowercasing', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    expect((await register(t, '  First.Last+tag@Sub.Example.test ')).statusCode).toBe(202);
    expect(mailer.sent[0]?.to).toBe('first.last+tag@sub.example.test');
  });
});

describe('POST /api/auth/verify-email', () => {
  it('accepts a valid token with 204 and no cookie, and refuses reuse', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'v@example.test');
    const token = lastToken(mailer);
    const ok = await verify(t, token);
    expect(ok.statusCode).toBe(204);
    expect(ok.body).toBe('');
    expect(ok.headers['set-cookie']).toBeUndefined();
    expect(userRow(t.db, 'v@example.test')?.verifiedAt).not.toBeNull();
    const again = await verify(t, token);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'invalid_token' });
  });

  it.each(['', 'garbage', '0'.repeat(64), 'x'.repeat(5000)])('refuses the unknown token %j with 400 invalid_token', async (token) => {
    const t = setup();
    await register(t, 'v@example.test');
    const res = await verify(t, token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_token' });
    expect(userRow(t.db, 'v@example.test')?.verifiedAt).toBeNull();
  });

  it('refuses a token after its 24 hours are over, and keeps the user unverified', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'late@example.test');
    const token = lastToken(mailer);
    t.clock.advance(VERIFICATION_TOKEN_TTL_MS + 1);
    const res = await verify(t, token);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_token' });
    expect(userRow(t.db, 'late@example.test')?.verifiedAt).toBeNull();
  });

  it('accepts a token just inside the 24 hours', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'early@example.test');
    const token = lastToken(mailer);
    t.clock.advance(VERIFICATION_TOKEN_TTL_MS - 1);
    expect((await verify(t, token)).statusCode).toBe(204);
  });

  it.each([
    ['no body', undefined],
    ['missing token', {}],
    ['a password and no token', { password: PASSWORD }],
    ['a non-string token with a password', { token: 5, password: PASSWORD }],
    ['number', { token: 5 }],
    ['null', { token: null }],
    ['array', { token: ['a'] }],
    ['object', { token: { a: 1 } }],
  ])('rejects %s with 400 invalid_request', async (_name, payload) => {
    const t = setup();
    const res = await post(t, '/api/auth/verify-email', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it('gives 403 local_auth_disabled in oidc mode without reading the database', async () => {
    const t = setup({ mode: 'oidc' });
    const client = t.db.$client;
    const originalPrepare = client.prepare.bind(client);
    const queries: string[] = [];
    client.prepare = (sql: string) => {
      queries.push(sql);
      throw new Error('database must not be read');
    };
    try {
      const res = await verify(t, 'sometoken');
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'local_auth_disabled' });
      expect(queries).toEqual([]);
    } finally {
      client.prepare = originalPrepare;
    }
  });
});

describe('login before and after verification', () => {
  it('gives an unverified user the same 401 as a wrong password, then 200 once verified', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'u@example.test');
    const wrong = await login(t, 'u@example.test', NEW_PASSWORD);
    const unverified = await login(t, 'u@example.test');
    expect(unverified.statusCode).toBe(401);
    expect(unverified.body).toBe('{"error":"invalid_credentials"}');
    expect(unverified.statusCode).toBe(wrong.statusCode);
    expect(unverified.body).toBe(wrong.body);
    expect(unverified.headers['content-type']).toBe(wrong.headers['content-type']);
    expect(unverified.cookies).toHaveLength(0);

    expect((await verify(t, lastToken(mailer))).statusCode).toBe(204);
    const ok = await login(t, 'u@example.test');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ email: 'u@example.test', authMethod: 'local' });
  });
});

describe('registration keeps the password off the user until verified', () => {
  it('stores no password hash on the user and puts the hash on the token', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'fresh@example.test');
    expect(userRow(t.db, 'fresh@example.test')).toEqual({ hash: null, verifiedAt: null });
    const pending = t.db.$client.prepare('select pending_password_hash as h from email_verifications').get() as { h: string };
    expect(pending.h.startsWith('$argon2id$')).toBe(true);
  });

  it('refuses login of an unverified account, even with the registered password', async () => {
    const t = setup();
    await register(t, 'unv@example.test');
    const res = await login(t, 'unv@example.test');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_credentials' });
    expect(res.cookies).toHaveLength(0);
  });

  it('refuses login of a legacy unverified row that still holds a hash', async () => {
    const t = setup();
    createUser(t.db, { email: 'legacy@example.test', passwordHash: await hashPassword(PASSWORD) });
    expect((await login(t, 'legacy@example.test')).statusCode).toBe(401);
  });
});

describe('verify-email link token', () => {
  const ATTACKER = 'attacker chosen passphrase';
  const VICTIM = 'victim chosen passphrase';

  it('activates the account from the link alone and applies the password chosen at sign-up', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'link@example.test', NEW_PASSWORD);
    const res = await verify(t, lastToken(mailer));
    expect(res.statusCode).toBe(204);
    expect(userRow(t.db, 'link@example.test')?.hash?.startsWith('$argon2id$')).toBe(true);
    expect(tokenCount(t.db)).toBe(0);
    expect((await login(t, 'link@example.test', NEW_PASSWORD)).statusCode).toBe(200);
  });

  it('ignores a password sent along with the token', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'extra@example.test');
    const res = await post(t, '/api/auth/verify-email', { token: lastToken(mailer), password: 'any other passphrase' });
    expect(res.statusCode).toBe(204);
    expect((await login(t, 'extra@example.test')).statusCode).toBe(200);
  });

  it('stores only the SHA-256 of the token', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'hash@example.test');
    const token = lastToken(mailer);
    const ids = t.db.$client.prepare('select id from email_verifications').all() as { id: string }[];
    expect(ids).toEqual([{ id: hashToken(token) }]);
    expect(JSON.stringify(t.db.$client.prepare('select * from email_verifications').all())).not.toContain(token);
  });

  it('takes only the verify-email IP limiter key, never an email or token key', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'keys@example.test');
    const token = lastToken(mailer);
    limiterKeys.taken.length = 0;
    expect((await verify(t, '0'.repeat(64))).statusCode).toBe(400);
    expect((await verify(t, token)).statusCode).toBe(204);
    expect(limiterKeys.taken).toHaveLength(2);
    expect(limiterKeys.taken.every((key) => key.startsWith('ip:'))).toBe(true);
  });

  it('refuses a token that carries no pending hash with 400 token_without_password and keeps it', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'old@example.test');
    t.db.$client.prepare('update email_verifications set pending_password_hash = null').run();
    const res = await verify(t, lastToken(mailer));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'token_without_password' });
    expect(userRow(t.db, 'old@example.test')?.verifiedAt).toBeNull();
    expect(tokenCount(t.db)).toBe(1);
  });

  it('a verified user token gets the same response as an unknown token', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'done@example.test');
    const token = lastToken(mailer);
    const user = t.db.$client.prepare('select id from users where email = ?').get('done@example.test') as { id: string };
    // A leftover token on a verified account, as legacy data could hold.
    t.db.$client.prepare('update users set email_verified_at = 1000 where id = ?').run(user.id);
    const verified = await verify(t, token);
    const unknown = await verify(t, '0'.repeat(64));
    expect(verified.statusCode).toBe(400);
    expect(verified.body).toBe(unknown.body);
    expect(verified.body).toBe('{"error":"invalid_token"}');
    expect(verified.headers['content-type']).toBe(unknown.headers['content-type']);
  });

  it('two parallel uses of one token: one 204, the other the same 400 as an unknown token', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'twice@example.test');
    const token = lastToken(mailer);
    const [first, second] = await Promise.all([verify(t, token), verify(t, token)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([204, 400]);
    const loser = first.statusCode === 400 ? first : second;
    expect(loser.body).toBe((await verify(t, '0'.repeat(64))).body);
  });

  it('M1: a second registration inside the live window keeps the first pending password, so only the first password works after verification', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    const first = await register(t, 'victim@example.test', ATTACKER);
    expect(first.statusCode).toBe(202);
    expect(first.headers['set-cookie']).toBeUndefined();
    expect(first.cookies).toHaveLength(0);
    const attackerLink = lastToken(mailer);
    const attackerHash = pendingHash(t.db, attackerLink);
    expect(attackerHash?.startsWith('$argon2id$')).toBe(true);
    // The link went to the victim's inbox; without it the registrant has no session and no API access.
    const attempt = await login(t, 'victim@example.test', ATTACKER);
    expect(attempt.statusCode).toBe(401);
    expect(attempt.cookies).toHaveLength(0);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);

    // The victim registers inside the live 24-hour window: the pending password is not replaced.
    const second = await register(t, 'victim@example.test', VICTIM);
    expect(second.statusCode).toBe(202);
    expect(second.body).toBe(ACCEPTED_BODY);
    expect(second.headers['set-cookie']).toBeUndefined();
    expect(second.cookies).toHaveLength(0);
    // A fresh link is mailed to the address, and it carries the first registrant's hash.
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]?.to).toBe('victim@example.test');
    const liveLink = lastToken(mailer);
    expect(liveLink).not.toBe(attackerLink);
    expect(pendingHash(t.db, liveLink)).toBe(attackerHash);
    // Only the earlier link of this address is voided; the user is untouched until a link is used.
    expect(pendingHash(t.db, attackerLink)).toBeUndefined();
    expect(tokenCount(t.db)).toBe(1);
    expect(userRow(t.db, 'victim@example.test')).toEqual({ hash: null, verifiedAt: null });
    const voided = await verify(t, attackerLink);
    expect(voided.statusCode).toBe(400);
    expect(voided.json()).toEqual({ error: 'invalid_token' });

    // Following the link activates the account with the first password, and gives no session.
    const activated = await verify(t, liveLink);
    expect(activated.statusCode).toBe(204);
    expect(activated.headers['set-cookie']).toBeUndefined();
    expect(activated.cookies).toHaveLength(0);
    expect((await t.app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    const withSecond = await login(t, 'victim@example.test', VICTIM);
    expect(withSecond.statusCode).toBe(401);
    expect(withSecond.json()).toEqual({ error: 'invalid_credentials' });
    expect(withSecond.cookies).toHaveLength(0);
    expect((await login(t, 'victim@example.test', ATTACKER)).statusCode).toBe(200);
  });

  it('runs no Argon2 derivation on verify', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'cheap@example.test');
    const before = argon.calls;
    expect((await verify(t, '0'.repeat(64))).statusCode).toBe(400);
    expect((await verify(t, lastToken(mailer))).statusCode).toBe(204);
    expect(argon.calls).toBe(before);
  });
});

describe('verify-email limits', () => {
  it('(d) still applies the per-IP limit', async () => {
    const t = setup();
    for (let i = 0; i < 20; i += 1) {
      expect((await verify(t, '0'.repeat(64))).statusCode).toBe(400);
    }
    const res = await verify(t, '0'.repeat(64));
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('(e) is not blocked by login or register floods from the same IP', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'victim@example.test');
    const token = lastToken(mailer);
    // Exhaust the shared login and register IP key.
    for (let i = 0; i < 25; i += 1) {
      await login(t, `flood${String(i)}@example.test`);
    }
    expect((await login(t, 'flood-last@example.test')).statusCode).toBe(429);
    expect((await register(t, 'flood-reg@example.test')).statusCode).toBe(429);
    expect((await verify(t, token)).statusCode).toBe(204);
  });

  it('(f) verify-email floods do not use up the login IP key', async () => {
    const t = setup();
    for (let i = 0; i < 21; i += 1) {
      await verify(t, '0'.repeat(64));
    }
    expect((await login(t, 'someone@example.test')).statusCode).toBe(401);
  });

  it('five failed logins on the owner email do not block verify', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'flood@example.test');
    const token = lastToken(mailer);
    for (let i = 0; i < 5; i += 1) {
      await login(t, 'flood@example.test', `wrong passphrase number ${String(i)}`);
    }
    expect((await login(t, 'flood@example.test')).statusCode).toBe(429);
    expect((await verify(t, token)).statusCode).toBe(204);
    expect(tokenCount(t.db)).toBe(0);
  });
});

describe('re-registering', () => {
  it('M1: a repeat registration with a live link keeps the first pending password, voids the old token and mails a new link', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'again@example.test');
    const oldToken = lastToken(mailer);
    const firstHash = pendingHash(t.db, oldToken);
    expect(firstHash?.startsWith('$argon2id$')).toBe(true);
    const res = await register(t, 'again@example.test', NEW_PASSWORD);
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe(ACCEPTED_BODY);
    expect(res.cookies).toHaveLength(0);
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]?.to).toBe('again@example.test');
    const newToken = lastToken(mailer);
    expect(newToken).not.toBe(oldToken);
    // The new token row carries the first registration's hash; only the newest token is left.
    expect(pendingHash(t.db, newToken)).toBe(firstHash);
    expect(pendingHash(t.db, oldToken)).toBeUndefined();
    expect(tokenCount(t.db)).toBe(1);
    // Nothing changes on the user until a token is used.
    expect(userRow(t.db, 'again@example.test')).toEqual({ hash: null, verifiedAt: null });
    const stale = await verify(t, oldToken);
    expect(stale.statusCode).toBe(400);
    expect(stale.json()).toEqual({ error: 'invalid_token' });
    expect(userRow(t.db, 'again@example.test')).toEqual({ hash: null, verifiedAt: null });

    // The first registrant's password is the one that works; the second is discarded.
    expect((await verify(t, newToken)).statusCode).toBe(204);
    expect((await login(t, 'again@example.test')).statusCode).toBe(200);
    expect((await login(t, 'again@example.test', NEW_PASSWORD)).statusCode).toBe(401);
  });

  it('M1: a repeat registration with no live link stores the new password', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'late@example.test');
    const oldToken = lastToken(mailer);
    const firstHash = pendingHash(t.db, oldToken);
    t.clock.advance(VERIFICATION_TOKEN_TTL_MS);
    await register(t, 'late@example.test', NEW_PASSWORD);
    const newToken = lastToken(mailer);
    expect(tokenCount(t.db)).toBe(1);
    expect(pendingHash(t.db, newToken)).not.toBe(firstHash);
    expect((await verify(t, newToken)).statusCode).toBe(204);
    expect((await login(t, 'late@example.test', NEW_PASSWORD)).statusCode).toBe(200);
    expect((await login(t, 'late@example.test')).statusCode).toBe(401);
  });

  it('voids the old token at once, even well inside its 24 hours', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'slow@example.test');
    const oldToken = lastToken(mailer);
    t.clock.advance(VERIFICATION_TOKEN_TTL_MS / 2);
    await register(t, 'slow@example.test');
    const newToken = lastToken(mailer);
    expect((await verify(t, oldToken)).statusCode).toBe(400);
    // The new token runs its own 24 hours from its own issue.
    t.clock.advance(VERIFICATION_TOKEN_TTL_MS - 1);
    expect((await verify(t, newToken)).statusCode).toBe(204);
  });

  it('voids only the tokens of that address', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'first@example.test');
    const firstToken = lastToken(mailer);
    await register(t, 'second@example.test');
    await register(t, 'second@example.test');
    expect(tokenCount(t.db)).toBe(2);
    expect((await verify(t, firstToken)).statusCode).toBe(204);
  });

  it('leaves the hash of a verified email unchanged and verifies nothing', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    createUser(t.db, { email: 'done@example.test', passwordHash: await hashPassword(PASSWORD), verifiedAt: new Date(1234) });
    const before = userRow(t.db, 'done@example.test');
    const tokensBefore = tokenCount(t.db);
    await register(t, 'done@example.test', NEW_PASSWORD);
    expect(userRow(t.db, 'done@example.test')).toEqual(before);
    expect(tokenCount(t.db)).toBe(tokensBefore);
    expect((await login(t, 'done@example.test')).statusCode).toBe(200);
    expect((await login(t, 'done@example.test', NEW_PASSWORD)).statusCode).toBe(401);
  });

  it('does not verify an unknown user or a null-hash user', async () => {
    const t = setup();
    createUser(t.db, { email: 'oidc@example.test', passwordHash: null, identity: { issuer: 'https://idp.test', subject: 's' } });
    const before = userRow(t.db, 'oidc@example.test');
    await register(t, 'oidc@example.test');
    expect(userRow(t.db, 'oidc@example.test')).toEqual(before);
    expect(tokenCount(t.db)).toBe(0);
  });
});

describe('mail', () => {
  it('sends exactly one mail per register, with the template for its branch', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    createUser(t.db, { email: 'verified@example.test', passwordHash: await hashPassword(PASSWORD), verifiedAt: new Date() });
    createUser(t.db, { email: 'oidc@example.test', passwordHash: null, identity: { issuer: 'https://idp.test', subject: 's' } });
    const already = alreadyRegisteredEmail(t.publicOrigin);

    await register(t, 'fresh@example.test');
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe('fresh@example.test');
    expect(mailer.sent[0]?.subject).toBe(verificationEmail(t.publicOrigin, 'x').subject);
    expect(mailer.sent[0]?.text).toContain(`${t.publicOrigin}/verify-email#token=`);

    await register(t, 'fresh@example.test'); // unverified: a new verification mail
    expect(mailer.sent).toHaveLength(2);
    expect(mailer.sent[1]?.to).toBe('fresh@example.test');
    expect(mailer.sent[1]?.subject).toBe(verificationEmail(t.publicOrigin, 'x').subject);

    await register(t, 'verified@example.test');
    expect(mailer.sent).toHaveLength(3);
    expect(mailer.sent[2]).toEqual({ to: 'verified@example.test', subject: already.subject, text: already.text });

    await register(t, 'oidc@example.test');
    expect(mailer.sent).toHaveLength(4);
    expect(mailer.sent[3]).toEqual({ to: 'oidc@example.test', subject: already.subject, text: already.text });
  });

  it('sends no mail for a refused request', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'nope', PASSWORD);
    await register(t, 'a@example.test', 'short');
    await verify(t, 'garbage');
    expect(mailer.sent).toHaveLength(0);
  });

  it('keeps the response when the real mailer cannot deliver', async () => {
    // createMailer never throws: a failing transport only produces a fixed log line.
    const lines: string[] = [];
    const mailer = createMailer({
      transport: { sendMail: () => Promise.reject(new Error('smtp down')) },
      from: 'walley@example.test',
      log: (line) => lines.push(line),
    });
    const t = setup({ mailer });
    createUser(t.db, { email: 'verified@example.test', passwordHash: await hashPassword(PASSWORD), verifiedAt: new Date() });
    for (const email of ['brand-new@example.test', 'verified@example.test']) {
      const res = await register(t, email);
      expect(res.statusCode, email).toBe(202);
      expect(res.body, email).toBe(ACCEPTED_BODY);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lines).toEqual([MAIL_FAILED_LINE, MAIL_FAILED_LINE]);
  });
});

describe('logs', () => {
  it('never contain an email, a token or a password', async () => {
    const chunks: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk.toString('utf8'));
        done();
      },
    });
    const mailer = createCapturingMailer();
    const t = setup({ mailer, logStream });
    const email = 'secret.person@example.test';
    const secretPassword = 'hunter2 hunter2 hunter2 hunter2';
    await register(t, email, secretPassword);
    const token = lastToken(mailer);
    await register(t, email, secretPassword);
    await verify(t, token);
    await verify(t, 'SECRETGARBAGETOKEN');
    await login(t, email, secretPassword);
    const output = chunks.join('');
    expect(output).toContain('/api/auth/register');
    expect(output).toContain('/api/auth/verify-email');
    for (const secret of [email, 'secret.person', token, lastToken(mailer), 'SECRETGARBAGETOKEN', secretPassword]) {
      expect(output).not.toContain(secret);
    }
  });
});

describe('database failures on register and verify', () => {
  it('answer 500 internal and log neither the message nor the params', async () => {
    const chunks: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk.toString('utf8'));
        done();
      },
    });
    const t = setup({ mailer: createCapturingMailer(), logStream });
    const email = 'dbfail.person@example.test';
    const token = 'c'.repeat(64);
    const client = t.db.$client;
    const originalPrepare = client.prepare.bind(client);
    // Shaped like a Drizzle error: the message carries the bound params.
    client.prepare = (sql: string) => {
      if (/insert|update|delete|select/i.test(sql)) {
        throw new Error(`Failed query: ${sql}\nparams: ${email},hashvalue,${token}`);
      }
      return originalPrepare(sql);
    };
    try {
      const reg = await register(t, email);
      expect(reg.statusCode).toBe(500);
      expect(reg.json()).toEqual({ error: 'internal' });
      const ver = await verify(t, token);
      expect(ver.statusCode).toBe(500);
      expect(ver.json()).toEqual({ error: 'internal' });
    } finally {
      client.prepare = originalPrepare;
    }
    const output = chunks.join('');
    for (const secret of [email, 'dbfail.person', 'hashvalue', token, 'Failed query']) {
      expect(output).not.toContain(secret);
    }
  });
});

describe('Argon2 work at registration', () => {
  it('runs exactly one derivation on every register path', async () => {
    const t = setup();
    createUser(t.db, { email: 'verified@example.test', passwordHash: await hashPassword(PASSWORD), verifiedAt: new Date() });
    createUser(t.db, { email: 'oidc@example.test', passwordHash: null, identity: { issuer: 'https://idp.test', subject: 's' } });
    await t.app.ready();
    await verifyAgainstDummy(''); // the dummy hash exists, so only the requests are counted

    const counts: Record<string, number> = {};
    for (const [name, email] of [
      ['new', 'new@example.test'],
      ['unverified', 'new@example.test'],
      ['verified', 'verified@example.test'],
      ['oidc', 'oidc@example.test'],
    ] as const) {
      argon.calls = 0;
      expect((await register(t, email)).statusCode).toBe(202);
      counts[name] = argon.calls;
    }
    expect(counts).toEqual({ new: 1, unverified: 1, verified: 1, oidc: 1 });
  });
});

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
const verify = (t: AuthApp, token: unknown, password: unknown = PASSWORD) =>
  post(t, '/api/auth/verify-email', { token, password });

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
    ['missing password', { token: 'abc' }],
    ['non-string password', { token: 'abc', password: 5 }],
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

describe('verify-email password check', () => {
  const ATTACKER = 'attacker chosen passphrase';
  const VICTIM = 'victim chosen passphrase';

  it('(a) refuses the attacker older mail with the wrong password, keeps the token, verifies nothing', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'victim@example.test', ATTACKER);
    const attackerToken = lastToken(mailer);
    await register(t, 'victim@example.test', VICTIM);
    const res = await verify(t, attackerToken, VICTIM);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_password' });
    expect(userRow(t.db, 'victim@example.test')).toEqual({ hash: null, verifiedAt: null });
    expect(tokenCount(t.db)).toBe(2);
    expect((await login(t, 'victim@example.test', VICTIM)).statusCode).toBe(401);
  });

  it('(b) lets the victim verify with their own password and then log in; the attacker cannot', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'victim@example.test', ATTACKER);
    await register(t, 'victim@example.test', VICTIM);
    const victimToken = lastToken(mailer);
    // A wrong try does not burn the token, so the owner can retry.
    expect((await verify(t, victimToken, 'a wrong passphrase here')).statusCode).toBe(401);
    expect((await verify(t, victimToken, VICTIM)).statusCode).toBe(204);
    expect((await login(t, 'victim@example.test', VICTIM)).statusCode).toBe(200);
    expect((await login(t, 'victim@example.test', ATTACKER)).statusCode).toBe(401);
  });

  it('(c) the attacker newer mail with the attacker password cannot take over a verified account', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'victim@example.test', VICTIM);
    const victimToken = lastToken(mailer);
    await register(t, 'victim@example.test', ATTACKER);
    const attackerToken = lastToken(mailer);
    expect((await verify(t, victimToken, VICTIM)).statusCode).toBe(204);
    // The attacker's token still holds a hash, but the user is already verified: nothing changes.
    await verify(t, attackerToken, ATTACKER);
    expect((await login(t, 'victim@example.test', VICTIM)).statusCode).toBe(200);
    expect((await login(t, 'victim@example.test', ATTACKER)).statusCode).toBe(401);
  });

  it('(c) the attacker cannot take over while the victim is still verifying', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'victim@example.test', VICTIM);
    const victimToken = lastToken(mailer);
    await register(t, 'victim@example.test', ATTACKER);
    // The attacker never saw the victim's token: only the victim's password opens it.
    expect((await verify(t, victimToken, ATTACKER)).statusCode).toBe(401);
    expect(userRow(t.db, 'victim@example.test')?.verifiedAt).toBeNull();
    expect((await verify(t, victimToken, VICTIM)).statusCode).toBe(204);
    expect((await login(t, 'victim@example.test', ATTACKER)).statusCode).toBe(401);
    expect((await login(t, 'victim@example.test', VICTIM)).statusCode).toBe(200);
  });

  it('(e) a consumed token cannot be used again', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'once@example.test');
    const token = lastToken(mailer);
    expect((await verify(t, token)).statusCode).toBe(204);
    const again = await verify(t, token);
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'invalid_token' });
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

  it('refuses an over-long or too-short password with 401 invalid_password', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'len@example.test');
    const token = lastToken(mailer);
    for (const bad of ['short', 'x'.repeat(100_000)]) {
      const res = await verify(t, token, bad);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'invalid_password' });
    }
  });
});

describe('verify-email brute-force limits', () => {
  it('(a) burns the token after repeated wrong passwords, so the correct one then fails', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'burn@example.test');
    const token = lastToken(mailer);
    for (let i = 0; i < 6; i += 1) {
      const res = await verify(t, token, `wrong passphrase number ${String(i)}`);
      // The register call already counted once against the shared email key, so the burn lands
      // on the 5th miss at the latest; later tries find no token.
      if (i < 4) {
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'invalid_password' });
      }
      expect(res.statusCode).not.toBe(204);
    }
    expect(tokenCount(t.db)).toBe(0);
    const right = await verify(t, token);
    expect(right.statusCode).toBe(400);
    expect(right.json()).toEqual({ error: 'invalid_token' });
    expect(userRow(t.db, 'burn@example.test')).toEqual({ hash: null, verifiedAt: null });
  });

  it('keeps the token while the misses stay under the limit', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'few@example.test');
    const token = lastToken(mailer);
    for (let i = 0; i < 3; i += 1) {
      expect((await verify(t, token, `wrong passphrase number ${String(i)}`)).statusCode).toBe(401);
    }
    expect((await verify(t, token)).statusCode).toBe(204);
  });

  it('(b) a correct verify deletes the other tokens, and an older link returns invalid_token', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'multi@example.test');
    const older = lastToken(mailer);
    await register(t, 'multi@example.test');
    const newer = lastToken(mailer);
    expect(tokenCount(t.db)).toBe(2);
    expect((await verify(t, newer)).statusCode).toBe(204);
    expect(tokenCount(t.db)).toBe(0);
    const res = await verify(t, older);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_token' });
  });

  it('(c) a verified user token gets the same response as an unknown token', async () => {
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

  it('(e) parallel guesses on one token cannot verify the account once the limit is used up', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'race@example.test');
    const token = lastToken(mailer);
    // The register call took one email count, so four attempts are allowed. Wrong guesses come
    // first and use them up; the correct ones start after the limit is reached.
    const wrong = Array.from({ length: 6 }, (_v, i) => verify(t, token, `wrong passphrase number ${String(i)}`));
    const right = Array.from({ length: 4 }, () => verify(t, token));
    const results = await Promise.all([...wrong, ...right]);
    // A request that looks the token up after the burn gets 400 invalid_token, as a wrong one would.
    for (const res of results) {
      expect([400, 401]).toContain(res.statusCode);
      expect(res.body).toBe(res.statusCode === 401 ? '{"error":"invalid_password"}' : '{"error":"invalid_token"}');
    }
    expect(userRow(t.db, 'race@example.test')).toEqual({ hash: null, verifiedAt: null });
    expect(tokenCount(t.db)).toBe(0);
  });

  it('(f) after the burn the correct password gets the same status and body as a wrong one', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'same@example.test');
    const token = lastToken(mailer);
    await Promise.all(Array.from({ length: 6 }, (_v, i) => verify(t, token, `wrong passphrase number ${String(i)}`)));
    const right = await verify(t, token);
    const wrong = await verify(t, token, 'another wrong passphrase');
    expect(right.statusCode).toBe(wrong.statusCode);
    expect(right.body).toBe(wrong.body);
    expect(right.headers['content-type']).toBe(wrong.headers['content-type']);
  });

  it('(g) a correct password whose consume fails gets the same status and body as a wrong one', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'twice@example.test');
    const token = lastToken(mailer);
    const [first, second] = await Promise.all([verify(t, token), verify(t, token)]);
    const wrong = await verify(t, '0'.repeat(64), 'wrong passphrase here');
    const statuses = [first.statusCode, second.statusCode].sort();
    // One wins, the other finds the token already consumed after its Argon2 check.
    expect(statuses).toEqual([204, 401]);
    const loser = first.statusCode === 401 ? first : second;
    expect(loser.body).toBe('{"error":"invalid_password"}');
    const wrongOnLiveToken = await (async () => {
      await register(t, 'other@example.test');
      return verify(t, lastToken(mailer), 'wrong passphrase here');
    })();
    expect(loser.statusCode).toBe(wrongOnLiveToken.statusCode);
    expect(loser.body).toBe(wrongOnLiveToken.body);
    expect(wrong.statusCode).toBe(400);
  });

  it('(d) still applies the per-IP limit', async () => {
    const t = setup();
    for (let i = 0; i < 20; i += 1) {
      expect((await verify(t, '0'.repeat(64))).statusCode).toBe(400);
    }
    const res = await verify(t, '0'.repeat(64));
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
  });
});

describe('re-registering', () => {
  it('sends a new link with its own pending hash and leaves the old token valid', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'again@example.test');
    const oldToken = lastToken(mailer);
    await register(t, 'again@example.test', NEW_PASSWORD);
    const newToken = lastToken(mailer);
    expect(newToken).not.toBe(oldToken);
    // Nothing changes on the user until a token is used.
    expect(userRow(t.db, 'again@example.test')).toEqual({ hash: null, verifiedAt: null });
    expect(tokenCount(t.db)).toBe(2);

    // The newest registrant verifies: their password is the one that works.
    expect((await verify(t, newToken, NEW_PASSWORD)).statusCode).toBe(204);
    expect((await login(t, 'again@example.test', NEW_PASSWORD)).statusCode).toBe(200);
    expect((await login(t, 'again@example.test')).statusCode).toBe(401);
    // Verifying deleted every token of the user, so the older link is now unknown.
    const stale = await verify(t, oldToken);
    expect(stale.statusCode).toBe(400);
    expect(stale.json()).toEqual({ error: 'invalid_token' });
    expect((await login(t, 'again@example.test', NEW_PASSWORD)).statusCode).toBe(200);
    expect((await login(t, 'again@example.test')).statusCode).toBe(401);
  });

  it('keeps the old token valid until it expires after a repeat registration', async () => {
    const mailer = createCapturingMailer();
    const t = setup({ mailer });
    await register(t, 'slow@example.test');
    const oldToken = lastToken(mailer);
    t.clock.advance(VERIFICATION_TOKEN_TTL_MS / 2);
    await register(t, 'slow@example.test');
    t.clock.advance(VERIFICATION_TOKEN_TTL_MS / 2 - 1);
    expect((await verify(t, oldToken)).statusCode).toBe(204);
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
    await verify(t, token, secretPassword);
    await verify(t, 'SECRETGARBAGETOKEN', secretPassword);
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

import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthMode } from '../../lib/auth-mode.js';
import { MAX_RAW_PASSWORD_UNITS, hashPassword, normalisePassword, verifyAgainstDummy } from '../auth/passwords.js';
import { CSRF_COOKIE, SESSION_COOKIE, hashToken } from '../auth/sessions.js';
import { createUser } from '../db/accounts.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { findSessionByIdHash } from '../db/lookup.js';
import type { CapturingMailer } from '../mail/index.js';
import { makeAuthApp, signIn, verifyEmail, type AuthApp } from '../test/auth-helpers.js';

// Every Argon2 derivation (hash or verify) goes through node:crypto's argon2. The wrapper below
// counts the calls and records each message, and can be told to fail once.
const argon = vi.hoisted(() => ({
  calls: 0,
  messages: [] as string[],
  /** The next this many derivations fail. */
  failures: 0,
}));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const wrapped = ((alg: string, params: { message: Buffer }, callback: (e: Error | null, k: Buffer) => void) => {
    argon.calls += 1;
    argon.messages.push(params.message.toString('utf8'));
    if (argon.failures > 0) {
      argon.failures -= 1;
      callback(new Error('argon2 failed on purpose'), Buffer.alloc(0));
      return;
    }
    (actual.argon2 as unknown as (...a: unknown[]) => void)(alg, params, callback);
  }) as unknown as typeof actual.argon2;
  return { ...actual, argon2: wrapped };
});

vi.mock('../auth/passwords.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../auth/passwords.js')>();
  return { ...actual, normalisePassword: vi.fn(actual.normalisePassword) };
});

vi.mock('../db/accounts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/accounts.js')>();
  return { ...actual, createUser: vi.fn(actual.createUser) };
});

const PASSWORD = 'correct horse battery staple';
const OTHER_PASSWORD = 'another long passphrase here';

const created: AuthApp[] = [];

beforeEach(() => {
  vi.mocked(normalisePassword).mockClear();
  vi.mocked(createUser).mockClear();
});

afterEach(async () => {
  for (const t of created.splice(0)) {
    await t.app.close();
    closeDatabase(t.db);
  }
});

function setup(opts: { mode?: AuthMode; allowRegistration?: boolean; mailer?: CapturingMailer } = {}): AuthApp {
  const t = makeAuthApp(opts);
  created.push(t);
  return t;
}

/** A request that carries a session also needs its CSRF token; read it from the CSRF cookie. */
function csrfHeader(cookie: string): Record<string, string> {
  const m = /(?:^|;\s*)walley_csrf=([^;]+)/.exec(cookie);
  return m?.[1] === undefined ? {} : { 'x-csrf-token': m[1] };
}

function post(t: AuthApp, url: string, payload: unknown, cookie?: string) {
  return t.app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: {
      origin: t.publicOrigin,
      ...(cookie === undefined ? {} : { cookie, ...csrfHeader(cookie) }),
    },
  });
}

function cookieValue(res: LightMyRequestResponse, name: string): string | undefined {
  return res.cookies.find((c) => c.name === name)?.value;
}

function register(t: AuthApp, email: string, password = PASSWORD) {
  return post(t, '/api/auth/register', { email, password });
}

function login(t: AuthApp, email: string, password = PASSWORD, cookie?: string) {
  return post(t, '/api/auth/login', { email, password }, cookie);
}

/** Registers through the API (202), then verifies the email as the link would. */
async function registerVerified(t: AuthApp, email: string, password = PASSWORD): Promise<void> {
  expect((await register(t, email, password)).statusCode).toBe(202);
  verifyEmail(t.db, email);
}

function verifiedAt(db: AppDatabase, email: string): number | null | undefined {
  const row = db.$client
    .prepare('select email_verified_at as v from users where email = ?')
    .get(email) as { v: number | null } | undefined;
  return row?.v;
}

function storedHash(db: AppDatabase, email: string): string | null | undefined {
  const row = db.$client
    .prepare('select password_hash as h from users where email = ?')
    .get(email) as { h: string | null } | undefined;
  return row?.h;
}

describe('POST /api/auth/register', () => {
  it('creates an unverified user and returns 202 verification_sent with no cookies', async () => {
    const t = setup({ allowRegistration: true });
    const res = await register(t, '  New.User@Example.TEST ');
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'verification_sent' });
    expect(res.cookies).toHaveLength(0);
    expect(res.headers['set-cookie']).toBeUndefined();
    // The password waits on the verification token; the user has none until verified.
    expect(storedHash(t.db, 'new.user@example.test')).toBeNull();
    expect(verifiedAt(t.db, 'new.user@example.test')).toBeNull();
  });

  it('answers a duplicate in any casing with the identical 202', async () => {
    const t = setup({ allowRegistration: true });
    const first = await register(t, 'dup@example.test');
    expect(first.statusCode).toBe(202);
    for (const email of ['dup@example.test', 'DUP@Example.Test', ' dup@example.test ']) {
      const res = await register(t, email);
      expect(res.statusCode, email).toBe(202);
      expect(res.body).toBe(first.body);
      expect(res.cookies).toHaveLength(0);
    }
  });

  it.each([false, undefined])('gives 403 registration_disabled when the flag is %s', async (flag) => {
    const t = setup(flag === undefined ? {} : { allowRegistration: flag });
    const res = await register(t, 'a@example.test');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'registration_disabled' });
    expect(res.cookies).toHaveLength(0);
  });

  it.each([true, false])('gives 403 local_auth_disabled in oidc mode (flag %s)', async (flag) => {
    const t = setup({ mode: 'oidc', allowRegistration: flag });
    const res = await register(t, 'a@example.test');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'local_auth_disabled' });
    expect(res.cookies).toHaveLength(0);
  });

  it('gives 403 local_auth_disabled in oidc mode even for a malformed body', async () => {
    const t = setup({ mode: 'oidc', allowRegistration: true });
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'application/json', origin: t.publicOrigin },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'local_auth_disabled' });
  });

  describe('failure path', () => {
    it('rejects malformed JSON with 400 invalid_request', async () => {
      const t = setup({ allowRegistration: true });
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'content-type': 'application/json', origin: t.publicOrigin },
        payload: '{not json',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    });

    it.each([
      ['no body', undefined],
      ['missing password', { email: 'a@example.test' }],
      ['missing email', { password: PASSWORD }],
      ['non-string password', { email: 'a@example.test', password: 1234 }],
      ['non-string email', { email: 5, password: PASSWORD }],
      ['empty email', { email: '   ', password: PASSWORD }],
      ['email without @', { email: 'nope', password: PASSWORD }],
      ['email over 254 characters', { email: `${'a'.repeat(250)}@x.test`, password: PASSWORD }],
      ['14 code points', { email: 'a@example.test', password: 'a'.repeat(14) }],
      ['257 code points', { email: 'a@example.test', password: 'a'.repeat(257) }],
    ])('rejects %s with 400 invalid_request', async (_name, payload) => {
      const t = setup({ allowRegistration: true });
      const res = await post(t, '/api/auth/register', payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
      expect(res.cookies).toHaveLength(0);
    });

    it('rejects a 1025-unit password with 400 before normalising it, and stores nothing', async () => {
      const t = setup({ allowRegistration: true });
      const res = await register(t, 'big@example.test', 'a'.repeat(MAX_RAW_PASSWORD_UNITS + 1));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
      expect(res.cookies).toHaveLength(0);
      expect(normalisePassword).not.toHaveBeenCalled();
      expect(storedHash(t.db, 'big@example.test')).toBeUndefined();
    });

    it('lets a 1024-unit password reach the code point check', async () => {
      const t = setup({ allowRegistration: true });
      const res = await register(t, 'edge@example.test', 'a'.repeat(MAX_RAW_PASSWORD_UNITS));
      expect(res.statusCode).toBe(400);
      expect(normalisePassword).toHaveBeenCalledTimes(1);
    });

    it('counts code points, not UTF-16 units: 15 emoji pass, 257 fail', async () => {
      const t = setup({ allowRegistration: true });
      const ok = await register(t, 'emoji@example.test', '\u{1F600}'.repeat(15));
      expect(ok.statusCode).toBe(202);
      const bad = await register(t, 'emoji2@example.test', '\u{1F600}'.repeat(257));
      expect(bad.statusCode).toBe(400);
    });
  });

  describe('unique violation mapping', () => {
    it('maps a unique violation on users.email to the same 202', async () => {
      const t = setup({ allowRegistration: true });
      const real = vi.mocked(createUser).getMockImplementation() as typeof createUser;
      // Another request wins the race after the pre-check: the insert hits the real constraint.
      vi.mocked(createUser).mockImplementationOnce((db, input) => {
        real(db, { email: input.email, passwordHash: null });
        return real(db, input);
      });
      const res = await register(t, 'race@example.test');
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'verification_sent' });
      expect(res.cookies).toHaveLength(0);
    });

    it('rethrows a CHECK failure instead of reporting 409', async () => {
      const t = setup({ allowRegistration: true });
      // Stubbed createUser: a SqliteError-shaped error with the CHECK code.
      vi.mocked(createUser).mockImplementationOnce(() => {
        throw Object.assign(new Error('CHECK constraint failed: key_salt'), {
          code: 'SQLITE_CONSTRAINT_CHECK',
        });
      });
      const res = await register(t, 'check@example.test');
      expect(res.statusCode).toBe(500);
      expect(res.statusCode).not.toBe(202);
      expect(res.cookies).toHaveLength(0);
    });

    it('rethrows a unique violation on another column', async () => {
      const t = setup({ allowRegistration: true });
      vi.mocked(createUser).mockImplementationOnce(() => {
        throw Object.assign(new Error('UNIQUE constraint failed: users.id'), {
          code: 'SQLITE_CONSTRAINT_UNIQUE',
        });
      });
      const res = await register(t, 'id@example.test');
      expect(res.statusCode).toBe(500);
    });
  });

  it('leaves the session the request already carries in the database', async () => {
    const t = setup({ allowRegistration: true });
    const old = signIn(t, createUser(t.db, { email: 'old@example.test', passwordHash: null }).id);
    const oldHash = hashToken(old.token);
    expect(findSessionByIdHash(t.db, oldHash)).toBeDefined();
    const res = await post(
      t,
      '/api/auth/register',
      { email: 'fresh@example.test', password: PASSWORD },
      old.cookie,
    );
    expect(res.statusCode).toBe(202);
    expect(res.cookies).toHaveLength(0);
    expect(findSessionByIdHash(t.db, oldHash)).toBeDefined();
  });
});

describe('POST /api/auth/login', () => {
  async function withUser(email = 'user@example.test') {
    const t = setup({ allowRegistration: true });
    await registerVerified(t, email);
    return t;
  }

  it('returns 200 with both cookies for the right password', async () => {
    const t = await withUser();
    const res = await login(t, 'user@example.test');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'user@example.test', authMethod: 'local' });
    expect(cookieValue(res, SESSION_COOKIE)).toBeTruthy();
    expect(cookieValue(res, CSRF_COOKIE)).toBeTruthy();
  });

  it('works when registration is disabled', async () => {
    const t = setup({ allowRegistration: false });
    createUser(t.db, {
      email: 'closed@example.test',
      passwordHash: await hashPassword(PASSWORD),
      verifiedAt: new Date(),
    });
    const res = await login(t, 'closed@example.test');
    expect(res.statusCode).toBe(200);
  });

  it('trims and lowercases the email', async () => {
    const t = await withUser();
    const res = await login(t, '  USER@Example.Test  ');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'user@example.test', authMethod: 'local' });
  });

  it('accepts a password in a different Unicode normalisation form', async () => {
    const t = setup({ allowRegistration: true });
    const composed = 'café au lait, s’il vous plaît';
    await registerVerified(t, 'u@example.test', composed);
    const res = await login(t, 'u@example.test', composed.normalize('NFD'));
    expect(res.statusCode).toBe(200);
  });

  it('gives identical 401 responses for wrong password, unknown email, null hash and bad length', async () => {
    const t = await withUser();
    createUser(t.db, { email: 'nohash@example.test', passwordHash: null });
    const responses = [
      await login(t, 'user@example.test', OTHER_PASSWORD),
      await login(t, 'nobody@example.test'),
      await login(t, 'nohash@example.test'),
      await login(t, 'user@example.test', 'short'),
      await login(t, 'user@example.test', 'a'.repeat(300)),
    ];
    for (const res of responses) {
      expect(res.statusCode).toBe(401);
      expect(res.body).toBe('{"error":"invalid_credentials"}');
      expect(res.cookies).toHaveLength(0);
      expect(res.headers['content-type']).toBe(responses[0]?.headers['content-type']);
    }
  });

  it('gives the same 401 for a 1025-unit password as for an unknown email, without normalising it', async () => {
    const t = await withUser();
    const unknown = await login(t, 'nobody@example.test');
    vi.mocked(normalisePassword).mockClear();
    const huge = 'a'.repeat(MAX_RAW_PASSWORD_UNITS + 1);
    const res = await login(t, 'user@example.test', huge);
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe(unknown.body);
    expect(res.body).toBe('{"error":"invalid_credentials"}');
    expect(res.headers['content-type']).toBe(unknown.headers['content-type']);
    expect(res.cookies).toHaveLength(0);
    expect(normalisePassword).not.toHaveBeenCalled();
    expect(argon.messages).not.toContain(huge);
  });

  it('lets a 1024-unit password reach the length check and the normaliser', async () => {
    const t = await withUser();
    vi.mocked(normalisePassword).mockClear();
    const res = await login(t, 'user@example.test', 'a'.repeat(MAX_RAW_PASSWORD_UNITS));
    expect(res.statusCode).toBe(401);
    expect(normalisePassword).toHaveBeenCalledTimes(1);
  });

  describe('timing: one Argon2 derivation per failed or successful login', () => {
    async function derivations(t: AuthApp, email: string, password: string): Promise<number> {
      await verifyAgainstDummy(''); // the dummy hash is built, so only the login is counted
      argon.calls = 0;
      await login(t, email, password);
      return argon.calls;
    }

    it('runs exactly one derivation on every path', async () => {
      const t = await withUser();
      createUser(t.db, { email: 'nohash@example.test', passwordHash: null });
      const huge = 'a'.repeat(MAX_RAW_PASSWORD_UNITS + 1);
      const counts = {
        wrongPassword: await derivations(t, 'user@example.test', OTHER_PASSWORD),
        unknownEmail: await derivations(t, 'nobody@example.test', PASSWORD),
        nullHash: await derivations(t, 'nohash@example.test', PASSWORD),
        overLimit: await derivations(t, 'user@example.test', huge),
        tooShort: await derivations(t, 'user@example.test', 'short'),
      };
      expect(counts).toEqual({ wrongPassword: 1, unknownEmail: 1, nullHash: 1, overLimit: 1, tooShort: 1 });
    });
  });

  it.each([
    ['no body', undefined],
    ['missing password', { email: 'a@example.test' }],
    ['non-string email', { email: 1, password: PASSWORD }],
  ])('rejects %s with 400 invalid_request', async (_name, payload) => {
    const t = setup();
    const res = await post(t, '/api/auth/login', payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it('gives 403 local_auth_disabled in oidc mode without reading the database', async () => {
    const t = setup({ mode: 'oidc' });
    const queries: string[] = [];
    const client = t.db.$client;
    const originalPrepare = client.prepare.bind(client);
    client.prepare = (sql: string) => {
      queries.push(sql);
      throw new Error('database must not be read');
    };
    try {
      const res = await login(t, 'user@example.test');
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'local_auth_disabled' });
      expect(res.cookies).toHaveLength(0);
      expect(queries).toEqual([]);
    } finally {
      client.prepare = originalPrepare;
    }
  });

  it('replaces the session the request already carries', async () => {
    const t = await withUser();
    const first = await login(t, 'user@example.test');
    const oldToken = cookieValue(first, SESSION_COOKIE) as string;
    const oldCookie = `${SESSION_COOKIE}=${oldToken}; walley_csrf=${cookieValue(first, 'walley_csrf') as string}`;
    const oldHash = hashToken(oldToken);
    expect(findSessionByIdHash(t.db, oldHash)).toBeDefined();
    const second = await login(t, 'user@example.test', PASSWORD, oldCookie);
    expect(second.statusCode).toBe(200);
    expect(findSessionByIdHash(t.db, oldHash)).toBeUndefined();
    const newToken = cookieValue(second, SESSION_COOKIE);
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(oldToken);
  });

  it('keeps the old session when the login fails', async () => {
    const t = await withUser();
    const first = await login(t, 'user@example.test');
    const oldToken = cookieValue(first, SESSION_COOKIE) as string;
    const oldCookie = `${SESSION_COOKIE}=${oldToken}; walley_csrf=${cookieValue(first, 'walley_csrf') as string}`;
    const res = await login(t, 'user@example.test', OTHER_PASSWORD, oldCookie);
    expect(res.statusCode).toBe(401);
    expect(findSessionByIdHash(t.db, hashToken(oldToken))).toBeDefined();
  });
});

describe('two-user isolation', () => {
  it('a session from logging in as A reads A, never B', async () => {
    const t = setup({ allowRegistration: true });
    await registerVerified(t, 'a@example.test');
    await registerVerified(t, 'b@example.test', OTHER_PASSWORD);
    const res = await login(t, 'a@example.test');
    const token = cookieValue(res, SESSION_COOKIE) as string;
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toEqual({ email: 'a@example.test', authMethod: 'local' });
    expect(me.body).not.toContain('b@example.test');
    // A's password does not open B's account.
    expect((await login(t, 'b@example.test', PASSWORD)).statusCode).toBe(401);
  });
});

describe('dummy hash warm-up at registration', () => {
  // A fresh module graph gives an empty dummy-hash cache. argon.calls counts derivations.
  async function freshApp(mode: AuthMode) {
    // The passwords.js mock above caches the original module, and with it the dummy hash.
    vi.doUnmock('../auth/passwords.js');
    vi.resetModules();
    const helpers = await import('../test/auth-helpers.js');
    argon.calls = 0;
    const t = helpers.makeAuthApp({ mode });
    created.push(t);
    await t.app.ready();
    return t;
  }

  it('starts the dummy hash when the plugin is registered in local mode', async () => {
    await freshApp('local');
    expect(argon.calls).toBe(1);
  });

  it('does not start it in oidc mode', async () => {
    await freshApp('oidc');
    expect(argon.calls).toBe(0);
  });

  /** A fresh app with a user who has a password and one who has none. Hash made before failing. */
  async function freshWithUsers(failures: number) {
    const knownHash = await hashPassword(PASSWORD);
    argon.failures = failures;
    const t = await freshApp('local');
    createUser(t.db, { email: 'known@example.test', passwordHash: knownHash, verifiedAt: new Date() });
    createUser(t.db, { email: 'nohash@example.test', passwordHash: null });
    // Let the failed warm-up settle, so its rejection handler has run.
    await new Promise((resolve) => setTimeout(resolve, 20));
    return t;
  }

  it('B1: after one failed warm-up an unknown email gets the same 401 as a wrong password', async () => {
    const t = await freshWithUsers(1);
    const unknown = await login(t, 'nobody@example.test');
    const wrong = await login(t, 'known@example.test', OTHER_PASSWORD);
    expect(unknown.statusCode).toBe(401);
    expect(unknown.body).toBe('{"error":"invalid_credentials"}');
    expect(wrong.statusCode).toBe(401);
    expect(wrong.body).toBe(unknown.body);
  });

  it('gives 500 on a known email with a wrong password while the dummy is unavailable, then 401', async () => {
    // One failure for the warm-up, one for the first login's rebuild.
    const t = await freshWithUsers(2);
    const down = await login(t, 'known@example.test', OTHER_PASSWORD);
    expect(down.statusCode).toBe(500);
    for (const [email, password] of [
      ['known@example.test', OTHER_PASSWORD],
      ['nobody@example.test', PASSWORD],
      ['nohash@example.test', PASSWORD],
      ['known@example.test', 'short'],
      ['known@example.test', 'a'.repeat(MAX_RAW_PASSWORD_UNITS + 1)],
    ] as const) {
      const res = await login(t, email, password);
      expect(res.statusCode, email).toBe(401);
      expect(res.body, email).toBe('{"error":"invalid_credentials"}');
    }
  });

  it('returns exactly { error: "internal" } for a 500, without the internal error text', async () => {
    const t = await freshWithUsers(2);
    const res = await login(t, 'known@example.test', PASSWORD);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal' });
    expect(res.body).not.toContain('argon2 failed on purpose');
  });

  it('returns exactly { error: "internal" } for a 500 on register', async () => {
    const t = setup({ allowRegistration: true });
    vi.mocked(createUser).mockImplementationOnce(() => {
      throw new Error('secret internal detail');
    });
    const res = await register(t, 'boom@example.test');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal' });
    expect(res.body).not.toContain('secret internal detail');
  });

  it('gives the same 500 for every login that reaches the credential check while the dummy is unavailable', async () => {
    // Warm-up plus six logins, each of which tries to rebuild the dummy and fails.
    const t = await freshWithUsers(7);
    const responses = [
      await login(t, 'nobody@example.test'),
      await login(t, 'nohash@example.test'),
      await login(t, 'known@example.test', OTHER_PASSWORD),
      await login(t, 'known@example.test', PASSWORD),
      await login(t, 'known@example.test', 'short'),
      await login(t, 'known@example.test', 'a'.repeat(MAX_RAW_PASSWORD_UNITS + 1)),
    ];
    expect(responses.map((r) => r.statusCode)).toEqual([500, 500, 500, 500, 500, 500]);
    for (const res of responses) {
      expect(res.body).toBe('{"error":"internal"}');
      expect(res.cookies).toHaveLength(0);
    }
  });
});

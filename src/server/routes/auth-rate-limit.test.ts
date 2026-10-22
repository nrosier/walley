import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { hashPassword, verifyAgainstDummy } from '../auth/passwords.js';
import { createUser } from '../db/accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { makeClock, type TestClock } from '../test/auth-helpers.js';

// Counts every Argon2 derivation, as auth-local.test.ts does.
const argon = vi.hoisted(() => ({ calls: 0 }));

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  const wrapped = ((alg: string, params: unknown, callback: unknown) => {
    argon.calls += 1;
    (actual.argon2 as unknown as (...a: unknown[]) => void)(alg, params, callback);
  }) as unknown as typeof actual.argon2;
  return { ...actual, argon2: wrapped };
});

const PASSWORD = 'correct horse battery staple';
const WRONG = 'another long passphrase here';
const ORIGIN = 'http://localhost:3000';
const WINDOW = 15 * 60 * 1000;

interface Ctx {
  app: ReturnType<typeof buildApp>;
  db: AppDatabase;
  clock: TestClock;
}

const created: Ctx[] = [];

afterEach(async () => {
  for (const t of created.splice(0)) {
    await t.app.close();
    closeDatabase(t.db);
  }
});

function setup(opts: { trustProxy?: string[]; allowRegistration?: boolean } = {}): Ctx {
  const db = openDatabase(':memory:');
  const clock = makeClock();
  const app = buildApp({
    db,
    ...(opts.trustProxy === undefined ? {} : { trustProxy: opts.trustProxy }),
    auth: {
      mode: 'local',
      secureCookies: false,
      allowRegistration: opts.allowRegistration ?? true,
      publicOrigin: ORIGIN,
      now: () => clock.now(),
    },
  });
  const t = { app, db, clock };
  created.push(t);
  return t;
}

function attempt(
  t: Ctx,
  path: 'login' | 'register',
  payload: unknown,
  extra: { remoteAddress?: string; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  return t.app.inject({
    method: 'POST',
    url: `/api/auth/${path}`,
    payload: payload as object,
    headers: { origin: ORIGIN, ...extra.headers },
    ...(extra.remoteAddress === undefined ? {} : { remoteAddress: extra.remoteAddress }),
  });
}

const login = (t: Ctx, email: string, password = WRONG) => attempt(t, 'login', { email, password });

async function withUser(t: Ctx, email: string): Promise<void> {
  createUser(t.db, { email, passwordHash: await hashPassword(PASSWORD) });
}

function expectLimited(res: LightMyRequestResponse): void {
  expect(res.statusCode).toBe(429);
  expect(res.json()).toEqual({ error: 'rate_limited' });
  const retry = Number(res.headers['retry-after']);
  expect(Number.isInteger(retry)).toBe(true);
  expect(retry).toBeGreaterThan(0);
}

describe('rate limit, per email', () => {
  it('gives 401 for attempts one to five and 429 for the sixth', async () => {
    const t = setup();
    await withUser(t, 'a@example.test');
    for (let i = 1; i <= 5; i += 1) {
      const res = await login(t, 'a@example.test');
      expect(res.statusCode, `attempt ${String(i)}`).toBe(401);
      expect(res.body).toBe('{"error":"invalid_credentials"}');
    }
    expectLimited(await login(t, 'a@example.test'));
  });

  it('refuses even the right password once the limit is hit, and reopens after the window', async () => {
    const t = setup();
    await withUser(t, 'a@example.test');
    for (let i = 0; i < 5; i += 1) await login(t, 'a@example.test');
    expectLimited(await login(t, 'a@example.test', PASSWORD));
    t.clock.advance(WINDOW);
    expect((await login(t, 'a@example.test', PASSWORD)).statusCode).toBe(200);
  });

  it('keys on the trimmed, lowercased email and counts unknown emails too', async () => {
    const t = setup();
    for (const email of ['nobody@example.test', ' NOBODY@example.test', 'Nobody@Example.Test ', 'nobody@example.test', 'NOBODY@EXAMPLE.TEST']) {
      expect((await login(t, email)).statusCode).toBe(401);
    }
    expectLimited(await login(t, ' nobody@example.test '));
  });

  it('shares one counter between register and login', async () => {
    const t = setup();
    const email = 'shared@example.test';
    expect((await attempt(t, 'register', { email, password: PASSWORD })).statusCode).toBe(201);
    expect((await attempt(t, 'register', { email, password: PASSWORD })).statusCode).toBe(409);
    for (let i = 0; i < 3; i += 1) {
      expect((await login(t, email)).statusCode).toBe(401);
    }
    expectLimited(await login(t, email));
    expectLimited(await attempt(t, 'register', { email, password: PASSWORD }));
  });

  it('a successful login clears the email counter; a failure does not', async () => {
    const t = setup();
    await withUser(t, 'a@example.test');
    for (let i = 0; i < 4; i += 1) expect((await login(t, 'a@example.test')).statusCode).toBe(401);
    expect((await login(t, 'a@example.test', PASSWORD)).statusCode).toBe(200);
    // The counter restarted: five more attempts fit, the sixth does not.
    for (let i = 0; i < 4; i += 1) expect((await login(t, 'a@example.test')).statusCode).toBe(401);
    expect((await login(t, 'a@example.test')).statusCode).toBe(401);
    expectLimited(await login(t, 'a@example.test'));
  });

  it('isolates users: A exhausting its limit does not block B', async () => {
    const t = setup();
    await withUser(t, 'a@example.test');
    await withUser(t, 'b@example.test');
    for (let i = 0; i < 5; i += 1) await login(t, 'a@example.test');
    expectLimited(await login(t, 'a@example.test'));
    expect((await login(t, 'b@example.test', PASSWORD)).statusCode).toBe(200);
  });
});

describe('rate limit, per IP', () => {
  it('refuses the 21st attempt from one peer across different emails', async () => {
    const t = setup();
    for (let i = 1; i <= 20; i += 1) {
      const res = await attempt(t, 'login', { email: `u${String(i)}@example.test`, password: WRONG }, { remoteAddress: '192.0.2.10' });
      expect(res.statusCode, `attempt ${String(i)}`).toBe(401);
    }
    expectLimited(await attempt(t, 'login', { email: 'u21@example.test', password: WRONG }, { remoteAddress: '192.0.2.10' }));
    // Another peer is unaffected.
    const other = await attempt(t, 'login', { email: 'u21@example.test', password: WRONG }, { remoteAddress: '192.0.2.11' });
    expect(other.statusCode).toBe(401);
  });

  it('a successful login leaves the IP counter intact', async () => {
    const t = setup();
    await withUser(t, 'ok@example.test');
    const peer = { remoteAddress: '192.0.2.20' };
    for (let i = 1; i <= 10; i += 1) {
      const res = await attempt(t, 'login', { email: `f${String(i)}@example.test`, password: WRONG }, peer);
      expect(res.statusCode).toBe(401);
    }
    expect((await attempt(t, 'login', { email: 'ok@example.test', password: PASSWORD }, peer)).statusCode).toBe(200);
    // 11 attempts counted so far: nine more are allowed, the 10th is refused.
    for (let i = 1; i <= 9; i += 1) {
      const res = await attempt(t, 'login', { email: `g${String(i)}@example.test`, password: WRONG }, peer);
      expect(res.statusCode, `attempt ${String(i)}`).toBe(401);
    }
    expectLimited(await attempt(t, 'login', { email: 'g10@example.test', password: WRONG }, peer));
  });

  it('shares one bucket across an IPv6 /64 and not with other prefixes', async () => {
    const t = setup();
    for (let i = 1; i <= 20; i += 1) {
      const res = await attempt(t, 'login', { email: `v${String(i)}@example.test`, password: WRONG }, { remoteAddress: '2001:db8::1' });
      expect(res.statusCode, `attempt ${String(i)}`).toBe(401);
    }
    expectLimited(await attempt(t, 'login', { email: 'v21@example.test', password: WRONG }, { remoteAddress: '2001:db8::2' }));
    const other = await attempt(t, 'login', { email: 'v22@example.test', password: WRONG }, { remoteAddress: '2001:db9::1' });
    expect(other.statusCode).toBe(401);
  });

  // A body with no credentials is refused with 400 after the IP check, so these stay cheap.
  async function sendFrom(t: Ctx, peer: string, forwardedFor: string): Promise<number> {
    const res = await attempt(t, 'login', {}, { remoteAddress: peer, headers: { 'x-forwarded-for': forwardedFor } });
    return res.statusCode;
  }

  it('ignores X-Forwarded-For when trustProxy is unset, so a spoofed header cannot evade the limit', async () => {
    const t = setup();
    for (let i = 1; i <= 20; i += 1) {
      expect(await sendFrom(t, '192.0.2.10', `203.0.113.${String(i)}`)).toBe(400);
    }
    expect(await sendFrom(t, '192.0.2.10', '203.0.113.99')).toBe(429);
  });

  it('keys on X-Forwarded-For when the peer is a trusted proxy', async () => {
    const t = setup({ trustProxy: ['10.0.0.0/8'] });
    for (let i = 1; i <= 21; i += 1) {
      expect(await sendFrom(t, '10.0.0.1', `203.0.113.${String(i)}`), `client ${String(i)}`).toBe(400);
    }
    for (let i = 0; i < 20; i += 1) {
      expect(await sendFrom(t, '10.0.0.1', '203.0.113.200')).toBe(400);
    }
    expect(await sendFrom(t, '10.0.0.1', '203.0.113.200')).toBe(429);
  });

  it('does not trust X-Forwarded-For from a peer outside the trusted range', async () => {
    const t = setup({ trustProxy: ['10.0.0.0/8'] });
    for (let i = 1; i <= 20; i += 1) {
      expect(await sendFrom(t, '192.0.2.10', `203.0.113.${String(i)}`)).toBe(400);
    }
    expect(await sendFrom(t, '192.0.2.10', '203.0.113.99')).toBe(429);
  });
});

describe('rate limit, email length', () => {
  const long = `${'a'.repeat(250)}@x.test`;

  it.each(['login', 'register'] as const)('rejects an over-long email on %s with 400 before counting it', async (path) => {
    const t = setup();
    for (let i = 0; i < 7; i += 1) {
      const res = await attempt(t, path, { email: long, password: PASSWORD });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }
  });
});

describe('rate limit, ordering', () => {
  it('a limited request does no Argon2 work, for login and register', async () => {
    const t = setup();
    await withUser(t, 'a@example.test');
    await verifyAgainstDummy(''); // build the dummy hash, so only the requests are counted
    for (let i = 0; i < 5; i += 1) await login(t, 'a@example.test');
    argon.calls = 0;
    expectLimited(await login(t, 'a@example.test', PASSWORD));
    expectLimited(await attempt(t, 'register', { email: 'a@example.test', password: PASSWORD }));
    expect(argon.calls).toBe(0);
  });

  it('an IP-limited request does no Argon2 work', async () => {
    const t = setup();
    await verifyAgainstDummy('');
    for (let i = 0; i < 20; i += 1) {
      await attempt(t, 'login', {}, { remoteAddress: '192.0.2.10' });
    }
    argon.calls = 0;
    expectLimited(await attempt(t, 'login', { email: 'x@example.test', password: PASSWORD }, { remoteAddress: '192.0.2.10' }));
    expect(argon.calls).toBe(0);
  });

  it('keeps the existing 403s ahead of the limit', async () => {
    const closed = setup({ allowRegistration: false });
    for (let i = 0; i < 25; i += 1) {
      const res = await attempt(closed, 'register', { email: 'a@example.test', password: PASSWORD });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'registration_disabled' });
    }
  });
});

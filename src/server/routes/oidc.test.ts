import { Writable } from 'node:stream';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthMode } from '../../lib/auth-mode.js';
import { buildApp } from '../app.js';
import { OIDC_FLOW_COOKIE, OIDC_FLOW_TTL_MS } from '../auth/oidc-flow.js';
import { OidcError, type OidcFlow, type OidcIdentity, type OidcProvider } from '../auth/oidc.js';
import { CSRF_COOKIE, SESSION_COOKIE } from '../auth/sessions.js';
import { deriveFlowKey } from '../crypto/keys.js';
import { createUser } from '../db/accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { makeClock, signIn } from '../test/auth-helpers.js';

const ISS = 'https://idp.example.test';
const CALLBACK = 'http://localhost:3000/api/auth/oidc/callback';
const PROVIDER_URL = 'https://idp.example.test/authorize?client_id=walley';

type Outcome = OidcIdentity | Error;

interface FakeProvider extends OidcProvider {
  starts: number;
  finishes: number;
  /** The outcome the next finish returns. */
  outcome: Outcome;
  /** When set, finish ignores the flow and fails as the library does on a nonce mismatch. */
  nonceMismatch: boolean;
}

/** Behaves like the real provider: finish throws unless the URL state equals the flow state. */
function fakeProvider(outcome: Outcome): FakeProvider {
  let counter = 0;
  const provider: FakeProvider = {
    starts: 0,
    finishes: 0,
    outcome,
    nonceMismatch: false,
    start() {
      provider.starts += 1;
      counter += 1;
      const flow: OidcFlow = {
        state: `state-secret-${String(counter)}`,
        nonce: `nonce-secret-${String(counter)}`,
        codeVerifier: `verifier-secret-${String(counter)}`,
      };
      return Promise.resolve({ url: new URL(PROVIDER_URL), flow });
    },
    finish(currentUrl, flow) {
      provider.finishes += 1;
      if (currentUrl.searchParams.get('error') !== null) {
        return Promise.reject(new Error('MARKER provider said no'));
      }
      if (currentUrl.searchParams.get('state') !== flow.state) {
        return Promise.reject(new OidcError('finish', 'INVALID_RESPONSE'));
      }
      if (provider.nonceMismatch) {
        return Promise.reject(new OidcError('finish', 'JWT_CLAIM_COMPARISON_FAILED'));
      }
      if (provider.outcome instanceof Error) {
        return Promise.reject(provider.outcome);
      }
      return Promise.resolve(provider.outcome);
    },
  };
  return provider;
}

const identity = (over: Partial<OidcIdentity> = {}): OidcIdentity => ({
  issuer: ISS,
  subject: 'sub-1',
  email: 'kate@x.com',
  emailVerified: true,
  ...over,
});

const apps: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const t of apps.splice(0)) {
    await t.app.close();
    closeDatabase(t.db);
  }
});

function setup(
  opts: {
    mode?: AuthMode;
    allowRegistration?: boolean;
    outcome?: Outcome;
    logStream?: NodeJS.WritableStream;
  } = {},
) {
  const db = openDatabase(':memory:');
  const clock = makeClock();
  const provider = fakeProvider(opts.outcome ?? identity());
  const mode = opts.mode ?? 'oidc';
  const app = buildApp({
    ...(opts.logStream === undefined ? {} : { logger: { stream: opts.logStream } }),
    db,
    auth: {
      mode,
      secureCookies: false,
      allowRegistration: opts.allowRegistration ?? false,
      publicOrigin: 'http://localhost:3000',
      now: () => clock.now(),
      oidc: { provider, flowKey: deriveFlowKey('a'.repeat(40)), callbackUrl: CALLBACK },
    },
  });
  apps.push({ app, db });
  return { app, db, clock, provider };
}

type T = ReturnType<typeof setup>;

const cookieOf = (res: LightMyRequestResponse, name: string) =>
  res.cookies.find((c) => c.name === name);

async function login(t: T): Promise<{ res: LightMyRequestResponse; flowCookie: string }> {
  const res = await t.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
  return { res, flowCookie: cookieOf(res, OIDC_FLOW_COOKIE)?.value ?? '' };
}

async function callback(
  t: T,
  opts: { flowCookie?: string; query?: string; extraCookie?: string } = {},
): Promise<LightMyRequestResponse> {
  const parts = [
    opts.flowCookie === undefined ? undefined : `${OIDC_FLOW_COOKIE}=${opts.flowCookie}`,
    opts.extraCookie,
  ].filter((p) => p !== undefined);
  return t.app.inject({
    method: 'GET',
    url: `/api/auth/oidc/callback${opts.query ?? '?code=c&state=state-secret-1'}`,
    headers: parts.length > 0 ? { cookie: parts.join('; ') } : {},
  });
}

const count = (db: AppDatabase, table: string): number =>
  (db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

const sessions = (db: AppDatabase) =>
  db.$client
    .prepare('select user_id as userId, auth_method as method from sessions')
    .all() as { userId: string; method: string }[];

const userRow = (db: AppDatabase, id: string) =>
  db.$client
    .prepare('select email, password_hash as ph, key_salt as ks from users where id = ?')
    .get(id) as { email: string; ph: string | null; ks: Buffer };

function expectFlowCleared(res: LightMyRequestResponse): void {
  const cleared = cookieOf(res, OIDC_FLOW_COOKIE);
  expect(cleared?.value).toBe('');
  expect(cleared?.maxAge).toBe(0);
  expect(cleared?.path).toBe('/api/auth/oidc');
}

function expectFailed(res: LightMyRequestResponse): void {
  expect(res.statusCode).toBe(302);
  expect(res.headers.location).toBe('/login?error=oidc_failed');
  expect(cookieOf(res, SESSION_COOKIE)).toBeUndefined();
  expectFlowCleared(res);
}

describe('local mode', () => {
  it.each(['/api/auth/oidc/login', '/api/auth/oidc/callback?code=c&state=s'])(
    '%s returns 404 and never calls the provider',
    async (url) => {
      const t = setup({ mode: 'local' });
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(t.provider.starts + t.provider.finishes).toBe(0);
      expect(res.cookies).toHaveLength(0);
    },
  );

  it('the callback 404 keeps the code and the state out of the body and the log', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const t = setup({ mode: 'local', logStream: stream });
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/auth/oidc/callback?code=SECRETCODE&state=SECRETSTATE',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ message: 'Not Found', error: 'Not Found', statusCode: 404 });
    expect(res.body).not.toContain('SECRETCODE');
    expect(res.body).not.toContain('SECRETSTATE');
    const output = lines.join('');
    expect(output).toContain('/api/auth/oidc/callback');
    expect(output).not.toContain('SECRETCODE');
    expect(output).not.toContain('SECRETSTATE');
  });
});

describe('GET /api/auth/oidc/login', () => {
  it('redirects 302 to the provider and sets a sealed, scoped flow cookie', async () => {
    const t = setup();
    const { res } = await login(t);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe(PROVIDER_URL);
    expect(res.headers['cache-control']).toBe('no-store');
    const cookie = cookieOf(res, OIDC_FLOW_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    expect(cookie?.path).toBe('/api/auth/oidc');
    expect(cookie?.maxAge).toBe(OIDC_FLOW_TTL_MS / 1000);
    const value = cookie?.value ?? '';
    for (const secret of ['state-secret', 'nonce-secret', 'verifier-secret']) {
      expect(value).not.toContain(secret);
      expect(Buffer.from(value, 'base64').toString('utf8')).not.toContain(secret);
      expect(Buffer.from(value, 'base64url').toString('utf8')).not.toContain(secret);
    }
    expect(res.headers['set-cookie']).toBeDefined();
    expect(String(res.headers.location)).not.toContain('state-secret');
  });

  it('redirects to oidc_failed with no cookie when start throws', async () => {
    const t = setup();
    t.provider.start = () => Promise.reject(new Error('MARKER discovery down'));
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login?error=oidc_failed');
    expect(cookieOf(res, OIDC_FLOW_COOKIE)).toBeUndefined();
    expect(res.body).not.toContain('MARKER');
  });

  it('429 rate_limited on the 21st start from one IP, with no provider call for it', async () => {
    const t = setup();
    for (let i = 0; i < 20; i += 1) {
      const ok = await t.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
      expect(ok.statusCode).toBe(302);
    }
    expect(t.provider.starts).toBe(20);
    const res = await t.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(t.provider.starts).toBe(20);
    expect(cookieOf(res, OIDC_FLOW_COOKIE)).toBeUndefined();
    // Another IP is unaffected, and the window slides.
    const other = await t.app.inject({
      method: 'GET',
      url: '/api/auth/oidc/login',
      remoteAddress: '10.9.8.7',
    });
    expect(other.statusCode).toBe(302);
    t.clock.advance(15 * 60 * 1000 + 1);
    const later = await t.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    expect(later.statusCode).toBe(302);
  });

  it('login starts share no counter with password login', async () => {
    const t = setup();
    for (let i = 0; i < 20; i += 1) {
      await t.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    }
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'a@b.c', password: 'x' },
      headers: { origin: 'http://localhost:3000' },
    });
    // OIDC mode answers 403 for password login; the point is it is not 429.
    expect(res.statusCode).toBe(403);
  });

  it('is public (no 401 without a session) and has no HEAD route', async () => {
    const t = setup();
    const head = await t.app.inject({ method: 'HEAD', url: '/api/auth/oidc/login' });
    expect(head.statusCode).not.toBe(302);
    expect(t.provider.starts).toBe(0);
  });
});

describe('GET /api/auth/oidc/callback failures', () => {
  it('missing flow cookie: oidc_failed, no token exchange', async () => {
    const t = setup();
    const res = await callback(t);
    expectFailed(res);
    expect(t.provider.finishes).toBe(0);
  });

  it('tampered flow cookie: oidc_failed, no token exchange', async () => {
    const t = setup();
    const { flowCookie } = await login(t);
    const last = flowCookie.at(-1) === 'A' ? 'B' : 'A';
    const res = await callback(t, { flowCookie: flowCookie.slice(0, -1) + last });
    expectFailed(res);
    expect(t.provider.finishes).toBe(0);
  });

  it('expired flow cookie (+601 s): oidc_failed, no token exchange', async () => {
    const t = setup();
    const { flowCookie } = await login(t);
    t.clock.advance(601_000);
    const res = await callback(t, { flowCookie });
    expectFailed(res);
    expect(t.provider.finishes).toBe(0);
  });

  it('state mismatch: oidc_failed, no session', async () => {
    const t = setup();
    createUser(t.db, { email: 'kate@x.com', passwordHash: 'h' });
    const { flowCookie } = await login(t);
    const res = await callback(t, { flowCookie, query: '?code=c&state=wrong' });
    expectFailed(res);
    expect(sessions(t.db)).toHaveLength(0);
    expect(count(t.db, 'user_identities')).toBe(0);
  });

  it('nonce mismatch: oidc_failed, no session', async () => {
    const t = setup();
    t.provider.nonceMismatch = true;
    createUser(t.db, { email: 'kate@x.com', passwordHash: 'h' });
    const { flowCookie } = await login(t);
    const res = await callback(t, { flowCookie });
    expectFailed(res);
    expect(sessions(t.db)).toHaveLength(0);
  });

  it('provider error response: oidc_failed and the provider text never reaches the browser', async () => {
    const t = setup();
    const { flowCookie } = await login(t);
    const res = await callback(t, {
      flowCookie,
      query: '?error=access_denied&error_description=MARKER&state=state-secret-1',
    });
    expectFailed(res);
    expect(JSON.stringify([res.body, res.headers, res.cookies])).not.toContain('MARKER');
    expect(t.provider.finishes).toBe(1);
  });

  it('an unexpected provider throw is oidc_failed with no leak', async () => {
    const t = setup({ outcome: new Error('MARKER boom') });
    const { flowCookie } = await login(t);
    const res = await callback(t, { flowCookie });
    expectFailed(res);
    expect(JSON.stringify([res.body, res.headers])).not.toContain('MARKER');
  });

  it('the request log records the path but never the code or state', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString('utf8'));
        done();
      },
    });
    const t = setup({ logStream: stream });
    const { flowCookie } = await login(t);
    await callback(t, { flowCookie, query: '?code=SECRETCODE&state=SECRETSTATE' });
    const output = lines.join('');
    expect(output).toContain('/api/auth/oidc/callback');
    expect(output).not.toContain('SECRETCODE');
    expect(output).not.toContain('SECRETSTATE');
  });

  it('429 rate_limited on the 21st callback from one IP, with no token request for it', async () => {
    const t = setup();
    for (let i = 0; i < 20; i += 1) {
      const ok = await callback(t);
      expectFailed(ok);
    }
    const { flowCookie } = await login(t);
    const finishes = t.provider.finishes;
    const res = await callback(t, { flowCookie });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(t.provider.finishes).toBe(finishes);
    expect(cookieOf(res, SESSION_COOKIE)).toBeUndefined();
    // Login starts and other IPs keep their own counters.
    expect((await login(t)).res.statusCode).toBe(302);
    const other = await t.app.inject({
      method: 'GET',
      url: '/api/auth/oidc/callback?code=c&state=s',
      remoteAddress: '10.9.8.7',
    });
    expectFailed(other);
  });

  it('a replayed flow cookie is still cleared and a second state fails', async () => {
    const t = setup();
    const { flowCookie } = await login(t);
    const res = await callback(t, { flowCookie, query: '?code=c&state=other' });
    expectFailed(res);
    expectFlowCleared(res);
  });
});

describe('GET /api/auth/oidc/callback success paths', () => {
  it('a known identity signs in: oidc session, redirect to /', async () => {
    const t = setup();
    const kate = createUser(t.db, { email: 'kate@x.com', passwordHash: 'h' });
    // First login links; the second finds the identity even though the email is now unverified.
    const first = await callback(t, { flowCookie: (await login(t)).flowCookie });
    expect(first.statusCode).toBe(302);
    t.provider.outcome = identity({ emailVerified: false, email: undefined });
    const { flowCookie } = await login(t);
    const res = await callback(t, { flowCookie, query: '?code=c&state=state-secret-2' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(cookieOf(res, SESSION_COOKIE)?.value).toBeTruthy();
    expect(cookieOf(res, CSRF_COOKIE)?.value).toBeTruthy();
    expectFlowCleared(res);
    expect(sessions(t.db).filter((s) => s.userId === kate.id)).toHaveLength(2);
    expect(sessions(t.db).every((s) => s.method === 'oidc')).toBe(true);
  });

  it('a verified email links the user and leaves password_hash and key_salt unchanged', async () => {
    const t = setup();
    const kate = createUser(t.db, { email: 'kate@x.com', passwordHash: 'hash-kate' });
    const before = userRow(t.db, kate.id);
    const { flowCookie } = await login(t);
    const res = await callback(t, { flowCookie });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(cookieOf(res, SESSION_COOKIE)?.value).toBeTruthy();
    expect(sessions(t.db)).toEqual([{ userId: kate.id, method: 'oidc' }]);
    expect(count(t.db, 'user_identities')).toBe(1);
    expect(count(t.db, 'users')).toBe(1);
    const after = userRow(t.db, kate.id);
    expect(after.ph).toBe('hash-kate');
    expect(after.ks.equals(before.ks)).toBe(true);
    expectFlowCleared(res);
  });

  it('email matching is case-insensitive', async () => {
    const t = setup({ outcome: identity({ email: 'KATE@X.com' }) });
    const kate = createUser(t.db, { email: 'kate@x.com', passwordHash: 'h' });
    const res = await callback(t, { flowCookie: (await login(t)).flowCookie });
    expect(res.headers.location).toBe('/');
    expect(sessions(t.db)[0]?.userId).toBe(kate.id);
  });

  it.each([false, undefined, 'true'] as const)(
    'email_verified %s with a matching user: account_not_linked, no session, no link',
    async (flag) => {
      const t = setup({ outcome: identity({ emailVerified: flag }) });
      createUser(t.db, { email: 'kate@x.com', passwordHash: 'h' });
      const { flowCookie } = await login(t);
      const res = await callback(t, { flowCookie });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login?error=account_not_linked');
      expect(cookieOf(res, SESSION_COOKIE)).toBeUndefined();
      expect(sessions(t.db)).toHaveLength(0);
      expect(count(t.db, 'user_identities')).toBe(0);
      expectFlowCleared(res);
    },
  );

  it('creates a user with a null password_hash when registration is on', async () => {
    const t = setup({ allowRegistration: true, outcome: identity({ email: 'new@x.com' }) });
    const res = await callback(t, { flowCookie: (await login(t)).flowCookie });
    expect(res.headers.location).toBe('/');
    expect(cookieOf(res, SESSION_COOKIE)?.value).toBeTruthy();
    expect(count(t.db, 'users')).toBe(1);
    const [session] = sessions(t.db);
    expect(session?.method).toBe('oidc');
    const user = userRow(t.db, session?.userId ?? '');
    expect(user.email).toBe('new@x.com');
    expect(user.ph).toBeNull();
    expect(user.ks).toHaveLength(32);
    expect(count(t.db, 'user_identities')).toBe(1);
  });

  it('creation with registration off: account_not_linked, no user created', async () => {
    const t = setup({ allowRegistration: false, outcome: identity({ email: 'new@x.com' }) });
    const res = await callback(t, { flowCookie: (await login(t)).flowCookie });
    expect(res.headers.location).toBe('/login?error=account_not_linked');
    expect(count(t.db, 'users')).toBe(0);
    expect(count(t.db, 'user_identities')).toBe(0);
    expect(sessions(t.db)).toHaveLength(0);
    expectFlowCleared(res);
  });

  it('creation with registration on but email_verified false: refused, no user', async () => {
    const t = setup({
      allowRegistration: true,
      outcome: identity({ email: 'new@x.com', emailVerified: false }),
    });
    const res = await callback(t, { flowCookie: (await login(t)).flowCookie });
    expect(res.headers.location).toBe('/login?error=account_not_linked');
    expect(count(t.db, 'users')).toBe(0);
  });
});

describe('sessions and isolation', () => {
  it('deletes a presented session when the callback succeeds, and the new one differs', async () => {
    const t = setup();
    const kate = createUser(t.db, { email: 'kate@x.com', passwordHash: 'h' });
    const old = signIn(t, kate.id, 'oidc');
    expect(sessions(t.db)).toHaveLength(1);
    const { flowCookie } = await login(t);
    const res = await callback(t, { flowCookie, extraCookie: `${SESSION_COOKIE}=${old.token}` });
    expect(res.headers.location).toBe('/');
    const fresh = cookieOf(res, SESSION_COOKIE)?.value;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(old.token);
    expect(sessions(t.db)).toHaveLength(1);
    // The old token no longer authenticates.
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${old.token}` },
    });
    expect(me.statusCode).toBe(401);
  });

  it('keeps a presented session when the callback is refused', async () => {
    const t = setup({ outcome: identity({ emailVerified: false }) });
    const kate = createUser(t.db, { email: 'kate@x.com', passwordHash: 'h' });
    const old = signIn(t, kate.id, 'oidc');
    const { flowCookie } = await login(t);
    const res = await callback(t, { flowCookie, extraCookie: `${SESSION_COOKIE}=${old.token}` });
    expect(res.headers.location).toBe('/login?error=account_not_linked');
    expect(sessions(t.db)).toHaveLength(1);
  });

  it("another user's session is not used for a different identity", async () => {
    const t = setup();
    const alice = createUser(t.db, { email: 'alice@x.com', passwordHash: 'ha' });
    const bob = createUser(t.db, { email: 'bob@x.com', passwordHash: 'hb' });
    // Alice is linked and signed in.
    t.provider.outcome = identity({ subject: 'sub-alice', email: 'alice@x.com' });
    const aliceLogin = await callback(t, { flowCookie: (await login(t)).flowCookie });
    const aliceToken = cookieOf(aliceLogin, SESSION_COOKIE)?.value ?? '';
    expect(aliceToken).not.toBe('');
    // Bob signs in from the same browser, with Alice's session cookie presented.
    t.provider.outcome = identity({ subject: 'sub-bob', email: 'bob@x.com' });
    const { flowCookie } = await login(t);
    const res = await callback(t, {
      flowCookie,
      query: '?code=c&state=state-secret-2',
      extraCookie: `${SESSION_COOKIE}=${aliceToken}`,
    });
    expect(res.headers.location).toBe('/');
    const bobToken = cookieOf(res, SESSION_COOKIE)?.value ?? '';
    const me = await t.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${SESSION_COOKIE}=${bobToken}` },
    });
    expect(me.json()).toMatchObject({ email: 'bob@x.com', authMethod: 'oidc' });
    expect(sessions(t.db)).toEqual([{ userId: bob.id, method: 'oidc' }]);
    expect(userRow(t.db, alice.id).ph).toBe('ha');
    const rows = t.db.$client
      .prepare('select user_id as userId, subject from user_identities order by subject')
      .all();
    expect(rows).toEqual([
      { userId: alice.id, subject: 'sub-alice' },
      { userId: bob.id, subject: 'sub-bob' },
    ]);
  });

  it("Alice's subject with Bob's verified email signs in Alice, not Bob", async () => {
    const t = setup();
    const alice = createUser(t.db, { email: 'alice@x.com', passwordHash: 'ha' });
    createUser(t.db, { email: 'bob@x.com', passwordHash: 'hb' });
    t.provider.outcome = identity({ subject: 'sub-alice', email: 'alice@x.com' });
    await callback(t, { flowCookie: (await login(t)).flowCookie });
    t.provider.outcome = identity({ subject: 'sub-alice', email: 'bob@x.com' });
    const { flowCookie } = await login(t);
    const res = await callback(t, { flowCookie, query: '?code=c&state=state-secret-2' });
    expect(res.headers.location).toBe('/');
    expect(sessions(t.db).every((s) => s.userId === alice.id)).toBe(true);
    expect(count(t.db, 'user_identities')).toBe(1);
  });
});

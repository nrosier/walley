import { get } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthMode } from '../../lib/auth-mode.js';
import { buildApp } from '../app.js';
import { hashToken } from '../auth/sessions.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import { createCapturingMailer } from '../mail/index.js';
import { findSessionByIdHash } from '../db/lookup.js';
import { injectAs, makeClock, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';

const MODES: readonly AuthMode[] = ['local', 'oidc'];
const REGISTRATION = [true, false] as const;
const UNAUTHENTICATED = { error: 'unauthenticated' };

const dbs: AppDatabase[] = [];
const apps: { close(): Promise<unknown> }[] = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
  for (const db of dbs.splice(0)) {
    closeDatabase(db);
  }
});

function setup(mode: AuthMode, allowRegistration: boolean, db?: AppDatabase) {
  const database = db ?? openDatabase(':memory:');
  if (db === undefined) {
    dbs.push(database);
  }
  const clock = makeClock();
  const app = buildApp({
    db: database,
    auth: {
      mode,
      secureCookies: false,
      allowRegistration,
      publicOrigin: 'http://localhost:3000',
      now: () => clock.now(),
      mailer: createCapturingMailer(),
    },
  });
  apps.push(app);
  return { app, db: database, clock };
}

describe('default-deny', () => {
  it.each(MODES.flatMap((mode) => REGISTRATION.map((reg) => [mode, reg] as const)))(
    'every non-public route returns 401 without a cookie (%s, registration %s)',
    async (mode, allowRegistration) => {
      const database = openDatabase(':memory:');
      dbs.push(database);
      const clock = makeClock();
      const app = buildApp({
        db: database,
        auth: {
          mode,
          secureCookies: false,
          allowRegistration,
          publicOrigin: 'http://localhost:3000',
          now: () => clock.now(),
          mailer: createCapturingMailer(),
        },
      });
      apps.push(app);
      const routes: { method: string; url: string }[] = [];
      app.addHook('onRoute', (route) => {
        if (route.config?.public !== true) {
          const methods = Array.isArray(route.method) ? route.method : [route.method];
          for (const method of methods) {
            if (method !== 'HEAD' && method !== 'OPTIONS') {
              routes.push({ method, url: route.url.replace(/:[A-Za-z0-9_]+/g, 'x') });
            }
          }
        }
      });
      // Not public and never reads request.auth, so only the deny hook can answer 401.
      app.get('/api/__probe', () => ({ ok: true }));
      await app.ready();
      expect(routes.map((r) => `${r.method} ${r.url}`)).toContain('GET /api/auth/me');
      expect(routes.map((r) => `${r.method} ${r.url}`)).toContain('POST /api/auth/logout');
      expect(routes.map((r) => `${r.method} ${r.url}`)).toContain('GET /api/__probe');
      for (const { method, url } of routes) {
        const res = await app.inject({ method: method as 'GET', url });
        expect(res.statusCode, `${method} ${url}`).toBe(401);
        expect(res.json(), `${method} ${url}`).toEqual(UNAUTHENTICATED);
      }
    },
  );

  it('public routes never return 401 without a cookie', async () => {
    const { app } = setup('local', false);
    for (const url of ['/api/health', '/api/auth/config']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it.each(MODES.flatMap((mode) => REGISTRATION.map((reg) => [mode, reg] as const)))(
    'POST /api/auth/login and /api/auth/register never return 401 without a cookie (%s, %s)',
    async (mode, allowRegistration) => {
      const { app } = setup(mode, allowRegistration);
      for (const url of ['/api/auth/login', '/api/auth/register']) {
        const res = await app.inject({
          method: 'POST',
          url,
          payload: {},
          headers: { origin: 'http://localhost:3000' },
        });
        expect(res.statusCode, url).not.toBe(401);
      }
    },
  );

  it.each(MODES.flatMap((mode) => REGISTRATION.map((reg) => [mode, reg] as const)))(
    'GET /api/auth/config body has exactly the keys mode and registration (%s, %s)',
    async (mode, allowRegistration) => {
      const { app } = setup(mode, allowRegistration);
      const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ mode, registration: allowRegistration });
    },
  );

  it('a valid local session reaches GET /api/auth/me', async () => {
    const t = setup('local', false);
    const email = 'me@example.test';
    const session = signIn(t, makeUser(t.db, email), 'local');
    const res = await injectAs(t.app, session, { method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email, authMethod: 'local' });
  });

  it('oidc mode: a valid local session gets 401 and its row is deleted', async () => {
    const first = setup('local', false);
    const session = signIn(first, makeUser(first.db), 'local');
    const hash = hashToken(session.token);
    expect(findSessionByIdHash(first.db, hash)).toBeDefined();

    const second = setup('oidc', false, first.db);
    const res = await injectAs(second.app, session, { method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(findSessionByIdHash(first.db, hash)).toBeUndefined();
  });

  it('local mode: a valid oidc session gets 401 and its row is deleted', async () => {
    const first = setup('oidc', false);
    const session = signIn(first, makeUser(first.db), 'oidc');
    const hash = hashToken(session.token);
    expect(findSessionByIdHash(first.db, hash)).toBeDefined();

    const second = setup('local', false, first.db);
    const res = await injectAs(second.app, session, { method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(findSessionByIdHash(first.db, hash)).toBeUndefined();
  });

  it('unknown /api path with no session returns 401', async () => {
    const { app } = setup('local', false);
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual(UNAUTHENTICATED);
  });

  it('an absolute-form request to an unknown /api path returns 401', async () => {
    const { app } = setup('local', false);
    await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const { port } = app.server.address() as AddressInfo;
      const path = `http://127.0.0.1:${String(port)}/api/nope`;
      const res = await new Promise<{ status: number | undefined; body: string }>(
        (resolve, reject) => {
          get({ host: '127.0.0.1', port, path }, (incoming) => {
            let body = '';
            incoming.setEncoding('utf8');
            incoming.on('data', (chunk: string) => {
              body += chunk;
            });
            incoming.on('end', () => {
              resolve({ status: incoming.statusCode, body });
            });
          }).on('error', reject);
        },
      );
      expect(res.status).toBe(401);
      expect(res.body).toBe('{"error":"unauthenticated"}');
    } finally {
      await app.close();
    }
  });

  it('unknown /api path with a session returns 404', async () => {
    const t = setup('local', false);
    const session = signIn(t, makeUser(t.db), 'local');
    const res = await injectAs(t.app, session, { method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
  });
});

describe('buildApp wires account and settings routes', () => {
  function setupWithSettings(mode: AuthMode = 'local') {
    const db = openDatabase(':memory:');
    dbs.push(db);
    const clock = makeClock();
    const app = buildApp({
      db,
      auth: {
        mode,
        secureCookies: false,
        allowRegistration: false,
        publicOrigin: TEST_ORIGIN,
        now: () => clock.now(),
      },
      settings: {
        repoFor: (id) => createUserRepo(db, id),
        wallos: { listCurrencies: vi.fn().mockResolvedValue([]) },
        appSecret: 'test-app-secret-value-0123456789abcdef',
        actual: {
          withActualServer: vi.fn().mockResolvedValue([]),
          withActual: vi.fn().mockResolvedValue('USD'),
        },
      },
    });
    apps.push(app);
    return { app, db, clock };
  }
  const GETS = ['/api/account', '/api/settings/wallos', '/api/settings/matching', '/api/settings/actual'];

  it.each(MODES)('GET routes give 401 without a session and 200 with one (%s)', async (mode) => {
    const t = setupWithSettings(mode);
    const session = signIn(t, makeUser(t.db), mode);
    for (const url of GETS) {
      const anon = await t.app.inject({ method: 'GET', url });
      expect(anon.statusCode, url).toBe(401);
      expect(anon.json(), url).toEqual(UNAUTHENTICATED);
      const res = await injectAs(t.app, session, { method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body, url).not.toContain('test-app-secret');
    }
  });

  it.each(MODES)('Actual settings routes give 401 without a session (%s)', async (mode) => {
    const t = setupWithSettings(mode);
    const probes = [
      { method: 'GET', url: '/api/settings/actual' },
      { method: 'PUT', url: '/api/settings/actual' },
      { method: 'POST', url: '/api/settings/actual/budgets' },
      { method: 'POST', url: '/api/settings/actual/base-currency' },
    ] as const;
    for (const { method, url } of probes) {
      const res = await t.app.inject({ method, url, payload: {}, headers: { origin: TEST_ORIGIN } });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json(), `${method} ${url}`).toEqual(UNAUTHENTICATED);
    }
  });

  it('PUT /api/settings/actual without a CSRF token gives 403', async () => {
    const t = setupWithSettings();
    const session = signIn(t, makeUser(t.db));
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/settings/actual',
      payload: { actualUrl: 'https://actual.example.com', password: 'p' },
      headers: { origin: TEST_ORIGIN, cookie: session.cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('without settings, account is registered but settings routes are not', async () => {
    const t = setup('local', false);
    const session = signIn(t, makeUser(t.db), 'local');
    expect((await injectAs(t.app, session, { method: 'GET', url: '/api/account' })).statusCode).toBe(200);
    for (const url of ['/api/settings/wallos', '/api/settings/matching']) {
      expect((await injectAs(t.app, session, { method: 'GET', url })).statusCode, url).toBe(404);
    }
  });

  it('PUT without a CSRF token gives 403 and writes nothing', async () => {
    const t = setupWithSettings();
    const userId = makeUser(t.db);
    const session = signIn(t, userId);
    for (const [url, payload] of [
      ['/api/settings/matching', { tolerancePercent: 10 }],
      ['/api/settings/wallos', { wallosUrl: 'https://wallos.example.com', apiKey: 'k' }],
      ['/api/account/password', { currentPassword: 'x', newPassword: 'y' }],
    ] as const) {
      const res = await t.app.inject({
        method: 'PUT',
        url,
        payload,
        headers: { origin: TEST_ORIGIN, cookie: session.cookie },
      });
      expect(res.statusCode, url).toBe(403);
    }
    expect(createUserRepo(t.db, userId).getConfig()).toBeUndefined();
  });

  it('matching tolerance boundaries through buildApp', async () => {
    const t = setupWithSettings();
    const session = signIn(t, makeUser(t.db));
    const put = (payload: string | object) =>
      injectAs(t.app, session, {
        method: 'PUT',
        url: '/api/settings/matching',
        payload,
        headers: { 'content-type': 'application/json' },
      });
    for (const v of [0, 50]) {
      const res = await put({ tolerancePercent: v });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ tolerancePercent: v });
    }
    for (const v of [-0.1, 50.1]) {
      const res = await put({ tolerancePercent: v });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'out_of_range' });
    }
    // JSON has no NaN; the raw literal is rejected before the handler as invalid_request.
    const nan = await put('{"tolerancePercent":NaN}');
    expect(nan.statusCode).toBe(400);
    expect(nan.json()).toEqual({ error: 'invalid_request' });
    const str = await put({ tolerancePercent: '10' });
    expect(str.statusCode).toBe(400);
    expect(str.json()).toEqual({ error: 'invalid_request' });
  });

  it("user A's PUT does not change user B's tolerance", async () => {
    const t = setupWithSettings();
    const a = signIn(t, makeUser(t.db));
    const b = signIn(t, makeUser(t.db));
    const put = (s: typeof a, v: number) =>
      injectAs(t.app, s, { method: 'PUT', url: '/api/settings/matching', payload: { tolerancePercent: v } });
    const get = (s: typeof a) => injectAs(t.app, s, { method: 'GET', url: '/api/settings/matching' });
    expect((await put(b, 15)).statusCode).toBe(200);
    expect((await put(a, 30)).statusCode).toBe(200);
    expect((await get(a)).json()).toEqual({ tolerancePercent: 30 });
    expect((await get(b)).json()).toEqual({ tolerancePercent: 15 });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import type { AuthMode } from '../../lib/auth-mode.js';
import { buildApp } from '../app.js';
import { hashToken } from '../auth/sessions.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { findSessionByIdHash } from '../db/lookup.js';
import { injectAs, makeClock, makeUser, signIn } from '../test/auth-helpers.js';

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
    auth: { mode, secureCookies: false, allowRegistration, now: () => clock.now() },
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
        auth: { mode, secureCookies: false, allowRegistration, now: () => clock.now() },
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
      await app.ready();
      expect(routes.map((r) => `${r.method} ${r.url}`)).toContain('GET /api/auth/me');
      expect(routes.map((r) => `${r.method} ${r.url}`)).toContain('POST /api/auth/logout');
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

  it('unknown /api path with a session returns 404', async () => {
    const t = setup('local', false);
    const session = signIn(t, makeUser(t.db), 'local');
    const res = await injectAs(t.app, session, { method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
  });
});

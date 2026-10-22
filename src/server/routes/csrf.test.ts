import { afterEach, describe, expect, it } from 'vitest';
import { hashToken } from '../auth/sessions.js';
import { closeDatabase } from '../db/client.js';
import { findSessionByIdHash } from '../db/lookup.js';
import { injectAs, makeAuthApp, makeUser, signIn, type AuthApp } from '../test/auth-helpers.js';

const open: AuthApp[] = [];
const FAILED = { error: 'csrf_failed' };
const LOGOUT = { method: 'POST', url: '/api/auth/logout' } as const;

function setup(): AuthApp {
  const made = makeAuthApp({ allowRegistration: true });
  open.push(made);
  return made;
}

afterEach(async () => {
  for (const { app, db } of open.splice(0)) {
    await app.close();
    closeDatabase(db);
  }
});

function sessionExists(t: AuthApp, token: string): boolean {
  return findSessionByIdHash(t.db, hashToken(token)) !== undefined;
}

describe('CSRF protection', () => {
  it('logout with session, token and Origin returns 204', async () => {
    const t = setup();
    const s = signIn(t, makeUser(t.db));
    const res = await injectAs(t.app, s, LOGOUT);
    expect(res.statusCode).toBe(204);
    expect(sessionExists(t, s.token)).toBe(false);
  });

  it('rejects logout with no token', async () => {
    const t = setup();
    const s = signIn(t, makeUser(t.db));
    const res = await t.app.inject({
      ...LOGOUT,
      headers: { cookie: s.cookie, origin: t.publicOrigin },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
    expect(sessionExists(t, s.token)).toBe(true);
  });

  it('rejects logout with a wrong token', async () => {
    const t = setup();
    const s = signIn(t, makeUser(t.db));
    const res = await injectAs(t.app, s, { ...LOGOUT, headers: { 'x-csrf-token': 'nope' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
    expect(sessionExists(t, s.token)).toBe(true);
  });

  it('rejects logout with a wrong Origin', async () => {
    const t = setup();
    const s = signIn(t, makeUser(t.db));
    const res = await injectAs(t.app, s, {
      ...LOGOUT,
      headers: { origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
    expect(sessionExists(t, s.token)).toBe(true);
  });

  it('rejects logout with no Origin', async () => {
    const t = setup();
    const s = signIn(t, makeUser(t.db));
    const res = await t.app.inject({
      ...LOGOUT,
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrfToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
    expect(sessionExists(t, s.token)).toBe(true);
  });

  it('login with the correct Origin and no session reaches the handler', async () => {
    const t = setup();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: t.publicOrigin },
      payload: { email: 'nobody@example.test', password: 'wrong password entirely' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_credentials' });
  });

  it('login with no Origin returns 403 csrf_failed', async () => {
    const t = setup();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'a@example.test', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
  });

  it('login with a wrong Origin returns 403 csrf_failed', async () => {
    const t = setup();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://localhost:3001' },
      payload: { email: 'a@example.test', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
  });

  it('register with no Origin returns 403 csrf_failed', async () => {
    const t = setup();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'a@example.test', password: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
  });

  it.each(['GET', 'HEAD'] as const)('%s /api/auth/me without Origin is not blocked', async (method) => {
    const t = setup();
    const s = signIn(t, makeUser(t.db));
    const res = await t.app.inject({ method, url: '/api/auth/me', headers: { cookie: s.cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('unauthenticated logout with no Origin is 401, not 403', async () => {
    const t = setup();
    const res = await t.app.inject(LOGOUT);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('a token from another user does not work', async () => {
    const t = setup();
    const a = signIn(t, makeUser(t.db));
    const b = signIn(t, makeUser(t.db));
    const bad = await injectAs(t.app, a, { ...LOGOUT, headers: { 'x-csrf-token': b.csrfToken } });
    expect(bad.statusCode).toBe(403);
    expect(bad.json()).toEqual(FAILED);
    expect(sessionExists(t, a.token)).toBe(true);
    const ok = await injectAs(t.app, a, LOGOUT);
    expect(ok.statusCode).toBe(204);
    expect(sessionExists(t, b.token)).toBe(true);
  });

  it('rejects register on an encoded path with no Origin and creates no user', async () => {
    const t = setup();
    const res = await t.app.inject({
      method: 'POST',
      url: '/%61pi/auth/register',
      payload: { email: 'enc@example.test', password: 'a long enough password' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
    const row = t.db.$client.prepare('select count(*) as n from users').get() as { n: number };
    expect(row.n).toBe(0);
  });

  it('rejects logout on an encoded path with no Origin and a bad token', async () => {
    const t = setup();
    const s = signIn(t, makeUser(t.db));
    const res = await t.app.inject({
      method: 'POST',
      url: '/%61pi/auth/logout',
      headers: { cookie: s.cookie, 'x-csrf-token': 'bad' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
    expect(sessionExists(t, s.token)).toBe(true);
  });

  it('rejects an absolute-form target with no Origin', async () => {
    const t = setup();
    const s = signIn(t, makeUser(t.db));
    const res = await t.app.inject({
      method: 'POST',
      url: 'http://localhost:3000/api/auth/logout',
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrfToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
    expect(sessionExists(t, s.token)).toBe(true);
  });

  it('GET on an encoded path without Origin is not blocked', async () => {
    const t = setup();
    const s = signIn(t, makeUser(t.db, 'me@example.test'));
    const res = await t.app.inject({
      method: 'GET',
      url: '/%61pi/auth/me',
      headers: { cookie: s.cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'me@example.test', authMethod: 'local' });
  });

  const count = (t: AuthApp, table: string): number =>
    (t.db.$client.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

  it.each(['/%61pi/auth/login', '/%2561pi/auth/register'])(
    'rejects POST %s with no Origin and no session, changing nothing',
    async (url) => {
      const t = setup();
      const before = [count(t, 'users'), count(t, 'sessions')];
      const res = await t.app.inject({
        method: 'POST',
        url,
        payload: { email: 'x@example.test', password: 'a long enough password' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual(FAILED);
      expect([count(t, 'users'), count(t, 'sessions')]).toEqual(before);
    },
  );

  // Without a session the deny hook answers 401 first, so these carry a session and no Origin.
  it.each([
    '/api/%61uth/logout',
    '/api/auth/logout%3F',
    '/api/auth/logout%2F',
    '/api/auth/logout/',
  ])('rejects POST %s with a session and no Origin, changing nothing', async (url) => {
    const t = setup();
    const s = signIn(t, makeUser(t.db));
    const before = [count(t, 'users'), count(t, 'sessions')];
    const res = await t.app.inject({
      method: 'POST',
      url,
      headers: { cookie: s.cookie, 'x-csrf-token': s.csrfToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(FAILED);
    expect([count(t, 'users'), count(t, 'sessions')]).toEqual(before);
    expect(sessionExists(t, s.token)).toBe(true);
  });
});

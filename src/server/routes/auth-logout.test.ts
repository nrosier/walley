import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { hashToken } from '../auth/sessions.js';
import { closeDatabase } from '../db/client.js';
import { findSessionByIdHash } from '../db/lookup.js';
import { injectAs, makeAuthApp, makeUser, signIn, type AuthApp } from '../test/auth-helpers.js';

const open: AuthApp[] = [];

function setup(): AuthApp {
  const made = makeAuthApp();
  open.push(made);
  return made;
}

afterEach(async () => {
  for (const { app, db } of open.splice(0)) {
    await app.close();
    closeDatabase(db);
  }
});

function setCookies(header: string | number | string[] | undefined): string[] {
  if (Array.isArray(header)) {
    return header;
  }
  return typeof header === 'string' ? [header] : [];
}

describe('POST /api/auth/logout', () => {
  it('logout deletes the row and clears both cookies', async () => {
    const t = setup();
    const session = signIn(t, makeUser(t.db));
    const idHash = hashToken(session.token);
    expect(findSessionByIdHash(t.db, idHash)).toBeDefined();

    const res = await injectAs(t.app, session, { method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(findSessionByIdHash(t.db, idHash)).toBeUndefined();

    const cookies = setCookies(res.headers['set-cookie']);
    for (const name of ['walley_session', 'walley_csrf']) {
      const cookie = cookies.find((c) => c.startsWith(`${name}=`));
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('Path=/');
    }
  });

  it('the old cookie returns 401 after logout', async () => {
    const t = setup();
    const session = signIn(t, makeUser(t.db));
    await injectAs(t.app, session, { method: 'POST', url: '/api/auth/logout' });
    const again = await injectAs(t.app, session, { method: 'POST', url: '/api/auth/logout' });
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: 'unauthenticated' });
  });

  it('logout without a cookie returns 401 unauthenticated', async () => {
    const t = setup();
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('logout deletes only the caller\'s own session', async () => {
    const t = setup();
    const alice = signIn(t, makeUser(t.db));
    const bob = signIn(t, makeUser(t.db));
    const secondAlice = signIn(t, alice.userId);

    const res = await injectAs(t.app, alice, { method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(204);
    expect(findSessionByIdHash(t.db, hashToken(alice.token))).toBeUndefined();
    expect(findSessionByIdHash(t.db, hashToken(bob.token))).toBeDefined();
    expect(findSessionByIdHash(t.db, hashToken(secondAlice.token))).toBeDefined();
  });

  it('clears the cookies of a stale session cookie', async () => {
    const t = setup();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { cookie: 'walley_session=stale-token' },
    });
    expect(res.statusCode).toBe(401);
    const cookies = setCookies(res.headers['set-cookie']);
    expect(cookies.some((c) => c.startsWith('walley_session=;') && c.includes('Max-Age=0'))).toBe(
      true,
    );
  });

  it('buildApp without auth has no logout route (404)', async () => {
    const app: FastifyInstance = buildApp();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/auth/logout' });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('buildApp rejects auth without db', () => {
    expect(() => buildApp({ auth: { mode: 'local', secureCookies: false } })).toThrow(
      'auth requires db',
    );
  });
});

describe('session hook scope', () => {
  it('a stale session cookie on GET /api/health is cleared', async () => {
    const t = setup();
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { cookie: `walley_session=${'x'.repeat(43)}` },
    });
    expect(res.statusCode).toBe(200);
    const cookies = setCookies(res.headers['set-cookie']);
    expect(
      cookies.some((c) => c.startsWith('walley_session=') && c.includes('Max-Age=0')),
    ).toBe(true);
  });
});

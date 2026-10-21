import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { findSessionByIdHash } from '../db/lookup.js';
import { makeClock, makeUser } from '../test/auth-helpers.js';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  clearSessionCookies,
  createSession,
  findSession,
  hashToken,
  setSessionCookies,
} from './sessions.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const dbs: AppDatabase[] = [];
const apps: FastifyInstance[] = [];

function freshDb(): AppDatabase {
  const db = openDatabase(':memory:');
  dbs.push(db);
  return db;
}

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
  for (const db of dbs.splice(0)) {
    closeDatabase(db);
  }
});

/** A bare app with the cookie plugin and one route that sets or clears the cookies. */
async function cookieApp(
  action: 'set' | 'clear',
  secure: boolean,
): Promise<{ setCookie: string[] }> {
  const app = Fastify();
  apps.push(app);
  await app.register(fastifyCookie);
  app.get('/x', (_request, reply) => {
    if (action === 'set') {
      setSessionCookies(
        reply,
        { token: 'tok', csrfToken: 'csrf', expiresAt: new Date(0) },
        secure,
      );
    } else {
      clearSessionCookies(reply, secure);
    }
    return reply.send({});
  });
  const res = await app.inject({ method: 'GET', url: '/x' });
  const header = res.headers['set-cookie'];
  const setCookie = Array.isArray(header) ? header : header === undefined ? [] : [header];
  return { setCookie };
}

function cookieNamed(setCookie: string[], name: string): string {
  const found = setCookie.find((c) => c.startsWith(`${name}=`));
  if (found === undefined) {
    throw new Error(`no ${name} cookie`);
  }
  return found;
}

describe('cookies', () => {
  it('session cookie is HttpOnly, SameSite=Lax, Path=/', async () => {
    const { setCookie } = await cookieApp('set', false);
    const cookie = cookieNamed(setCookie, SESSION_COOKIE);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=43200');
    expect(cookie.startsWith('walley_session=tok;')).toBe(true);
  });

  it('Secure is set only when secureCookies is true', async () => {
    const insecure = await cookieApp('set', false);
    for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
      expect(cookieNamed(insecure.setCookie, name)).not.toContain('Secure');
    }
    const secure = await cookieApp('set', true);
    for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
      expect(cookieNamed(secure.setCookie, name)).toContain('Secure');
    }
  });

  it('csrf cookie is readable (not HttpOnly)', async () => {
    const { setCookie } = await cookieApp('set', false);
    const cookie = cookieNamed(setCookie, CSRF_COOKIE);
    expect(cookie).not.toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=43200');
  });

  it('clearSessionCookies expires both cookies on the same path', async () => {
    for (const secure of [false, true]) {
      const { setCookie } = await cookieApp('clear', secure);
      for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
        const cookie = cookieNamed(setCookie, name);
        expect(cookie.startsWith(`${name}=;`)).toBe(true);
        expect(cookie).toContain('Max-Age=0');
        expect(cookie).toContain('Path=/');
        expect(cookie).toContain('SameSite=Lax');
        expect(cookie.includes('Secure')).toBe(secure);
      }
    }
  });
});

describe('createSession', () => {
  it('createSession stores the given auth_method', () => {
    const db = freshDb();
    const userId = makeUser(db);
    for (const method of ['local', 'oidc'] as const) {
      const issued = createSession(db, userId, method, 1_000);
      expect(findSessionByIdHash(db, hashToken(issued.token))?.authMethod).toBe(method);
    }
  });

  it('sessions.id is sha256(token) and the raw token is not in the database', () => {
    const db = freshDb();
    const userId = makeUser(db);
    const now = Date.UTC(2030, 0, 1);
    const issued = createSession(db, userId, 'local', now);
    const expected = createHash('sha256').update(issued.token, 'utf8').digest('hex');
    expect(hashToken(issued.token)).toBe(expected);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt.getTime()).toBe(now + 12 * HOUR);

    const row = findSessionByIdHash(db, expected);
    expect(row?.id).toBe(expected);
    expect(row?.csrfHash).toBe(hashToken(issued.csrfToken));
    expect(row?.lastSeenAt.getTime()).toBe(now);

    const dump = db.$client.prepare('SELECT * FROM sessions').all();
    const text = JSON.stringify(dump);
    expect(text).not.toContain(issued.token);
    expect(text).not.toContain(issued.csrfToken);
  });
});

describe('findSession', () => {
  it('a missing token returns null', () => {
    const db = freshDb();
    expect(findSession(db, undefined, 'local', 1_000)).toBeNull();
    expect(findSession(db, 'not-a-real-token', 'local', 1_000)).toBeNull();
  });

  it('returns the context for a live session', () => {
    const db = freshDb();
    const userId = makeUser(db);
    const issued = createSession(db, userId, 'local', 1_000);
    expect(findSession(db, issued.token, 'local', 2_000)).toEqual({
      idHash: hashToken(issued.token),
      userId,
      authMethod: 'local',
      csrfHash: hashToken(issued.csrfToken),
    });
  });

  it('absolute expiry at 12 h returns null and deletes the row', () => {
    const db = freshDb();
    const userId = makeUser(db);
    const clock = makeClock();
    const issued = createSession(db, userId, 'local', clock.now());
    const idHash = hashToken(issued.token);
    const start = clock.now();
    // Keep the session active every 20 minutes so only the absolute limit can expire it.
    while (clock.now() - start < 12 * HOUR - 20 * MIN) {
      clock.advance(20 * MIN);
      expect(findSession(db, issued.token, 'local', clock.now())).not.toBeNull();
    }
    clock.set(start + 12 * HOUR - 1);
    expect(findSession(db, issued.token, 'local', clock.now())).not.toBeNull();
    expect(findSessionByIdHash(db, idHash)).toBeDefined();
    clock.set(start + 12 * HOUR);
    expect(findSession(db, issued.token, 'local', clock.now())).toBeNull();
    expect(findSessionByIdHash(db, idHash)).toBeUndefined();
  });

  it('idle over 30 min returns null', () => {
    const db = freshDb();
    const userId = makeUser(db);
    const issued = createSession(db, userId, 'local', 0);
    const idHash = hashToken(issued.token);
    // The call below touches the session at 30 min - 1 ms, so the idle clock restarts there.
    expect(findSession(db, issued.token, 'local', 30 * MIN - 1)).not.toBeNull();
    expect(findSession(db, issued.token, 'local', 60 * MIN - 2)).not.toBeNull();
    // Idle for exactly 30 min since the touch at 60 min - 2 ms.
    expect(findSession(db, issued.token, 'local', 90 * MIN - 2)).toBeNull();
    expect(findSessionByIdHash(db, idHash)).toBeUndefined();
  });

  it('last_seen_at is written at most once a minute', () => {
    const db = freshDb();
    const userId = makeUser(db);
    const issued = createSession(db, userId, 'local', 0);
    const idHash = hashToken(issued.token);
    const lastSeen = () => findSessionByIdHash(db, idHash)?.lastSeenAt.getTime();

    expect(findSession(db, issued.token, 'local', 30_000)).not.toBeNull();
    expect(lastSeen()).toBe(0);
    expect(findSession(db, issued.token, 'local', 61_000)).not.toBeNull();
    expect(lastSeen()).toBe(61_000);
    expect(findSession(db, issued.token, 'local', 100_000)).not.toBeNull();
    expect(lastSeen()).toBe(61_000);
  });

  it('a session with the other auth method returns null and the row is gone', () => {
    const db = freshDb();
    const userId = makeUser(db);
    const issued = createSession(db, userId, 'local', 0);
    const idHash = hashToken(issued.token);
    expect(findSession(db, issued.token, 'oidc', 1_000)).toBeNull();
    expect(findSessionByIdHash(db, idHash)).toBeUndefined();
    expect(findSession(db, issued.token, 'local', 2_000)).toBeNull();
  });
});

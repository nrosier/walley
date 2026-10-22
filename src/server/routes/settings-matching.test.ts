import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import { injectAs, makeClock, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';
import { checkTolerance } from './settings-matching.js';

const PATH = '/api/settings/matching';
const open: { close(): Promise<unknown>; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    closeDatabase(a.db);
  }
});

function setup() {
  const db = openDatabase(':memory:');
  const clock = makeClock();
  const app = buildApp({
    db,
    auth: {
      mode: 'local',
      secureCookies: false,
      allowRegistration: false,
      publicOrigin: TEST_ORIGIN,
      now: () => clock.now(),
    },
    settings: {
      repoFor: (id) => createUserRepo(db, id),
      wallos: { listCurrencies: vi.fn().mockResolvedValue([]) },
      appSecret: 'test-app-secret-value-0123456789abcdef',
    },
  });
  open.push({ close: () => app.close(), db });
  const a = makeUser(db);
  const b = makeUser(db);
  return { app, db, a, b, sa: signIn({ db, clock }, a), sb: signIn({ db, clock }, b) };
}

type S = ReturnType<typeof setup>;
const put = (s: S, who: 'sa' | 'sb', payload: string | object) =>
  injectAs(s.app, s[who], {
    method: 'PUT',
    url: PATH,
    payload,
    headers: { 'content-type': 'application/json' },
  });
const get = (s: S, who: 'sa' | 'sb') => injectAs(s.app, s[who], { method: 'GET', url: PATH });

describe('checkTolerance', () => {
  it('accepts 0 to 50 and rejects the rest with fixed codes', () => {
    expect(checkTolerance(0)).toEqual({ ok: true, value: 0 });
    expect(checkTolerance(-0)).toEqual({ ok: true, value: 0 });
    expect(checkTolerance(50)).toEqual({ ok: true, value: 50 });
    expect(checkTolerance(2.5)).toEqual({ ok: true, value: 2.5 });
    for (const v of [-0.1, 50.1, NaN, Infinity, -Infinity]) {
      expect(checkTolerance(v)).toEqual({ ok: false, error: 'out_of_range' });
    }
    for (const v of ['5', null, undefined, true, [5], { v: 5 }]) {
      expect(checkTolerance(v)).toEqual({ ok: false, error: 'invalid_request' });
    }
  });
});

describe('settings-matching routes', () => {
  it('401 without a session', async () => {
    const s = setup();
    const g = await s.app.inject({ method: 'GET', url: PATH });
    const p = await s.app.inject({
      method: 'PUT',
      url: PATH,
      payload: { tolerancePercent: 10 },
      headers: { origin: TEST_ORIGIN },
    });
    for (const res of [g, p]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthenticated' });
    }
    expect(createUserRepo(s.db, s.a).getConfig()).toBeUndefined();
  });

  it('403 without CSRF token or with a foreign Origin, and nothing is written', async () => {
    const s = setup();
    const noToken = await s.app.inject({
      method: 'PUT',
      url: PATH,
      payload: { tolerancePercent: 10 },
      headers: { origin: TEST_ORIGIN, cookie: s.sa.cookie },
    });
    const foreign = await injectAs(s.app, s.sa, {
      method: 'PUT',
      url: PATH,
      payload: { tolerancePercent: 10 },
      headers: { origin: 'https://evil.example' },
    });
    for (const res of [noToken, foreign]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'csrf_failed' });
    }
    expect(createUserRepo(s.db, s.a).getConfig()).toBeUndefined();
  });

  it('GET defaults to 5 when no config row exists', async () => {
    const s = setup();
    const res = await get(s, 'sa');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tolerancePercent: 5 });
  });

  it('PUT saves boundaries 0 and 50 and returns the saved value', async () => {
    const s = setup();
    for (const v of [0, 50, 12.5]) {
      const res = await put(s, 'sa', { tolerancePercent: v });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ tolerancePercent: v });
      expect((await get(s, 'sa')).json()).toEqual({ tolerancePercent: v });
    }
  });

  it('PUT rejects out-of-range and wrong-type values without writing', async () => {
    const s = setup();
    await put(s, 'sa', { tolerancePercent: 7 });
    for (const v of [-0.1, 50.1, 51, 100, -1]) {
      const res = await put(s, 'sa', { tolerancePercent: v });
      expect(res.statusCode, String(v)).toBe(400);
      expect(res.json()).toEqual({ error: 'out_of_range' });
    }
    // JSON cannot carry NaN or Infinity; a raw literal fails to parse and gets invalid_request.
    for (const raw of ['{"tolerancePercent":NaN}', '{"tolerancePercent":Infinity}', '{bad']) {
      const res = await put(s, 'sa', raw);
      expect(res.statusCode, raw).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }
    for (const payload of [{ tolerancePercent: '10' }, { tolerancePercent: null }, {}, [10]]) {
      const res = await put(s, 'sa', payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }
    expect((await get(s, 'sa')).json()).toEqual({ tolerancePercent: 7 });
  });

  it('isolates two users and ignores a user id in the body', async () => {
    const s = setup();
    await put(s, 'sb', { tolerancePercent: 20 });
    const res = await put(s, 'sa', { tolerancePercent: 3, userId: s.b, user_id: s.b });
    expect(res.statusCode).toBe(200);
    expect((await get(s, 'sa')).json()).toEqual({ tolerancePercent: 3 });
    expect((await get(s, 'sb')).json()).toEqual({ tolerancePercent: 20 });
    expect(createUserRepo(s.db, s.b).getConfig()?.tolerancePercent).toBe(20);
  });
});

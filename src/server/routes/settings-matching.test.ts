import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import { injectAs, makeClock, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';
import { checkCurrencyDrift, checkTolerance } from './settings-matching.js';

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

describe('checkCurrencyDrift', () => {
  it('accepts multiples of 0.5 from 0 to 10 and rejects the rest with fixed codes', () => {
    for (const v of [0, 0.5, 2, 2.5, 10]) expect(checkCurrencyDrift(v)).toEqual({ ok: true, value: v });
    const neg = checkCurrencyDrift(-0);
    expect(neg.ok && Object.is(neg.value, 0)).toBe(true);
    for (const v of [-0.1, -0.5, 10.1, 10.5, 2.3, 0.25, NaN, Infinity, -Infinity]) {
      expect(checkCurrencyDrift(v), String(v)).toEqual({ ok: false, error: 'out_of_range' });
    }
    for (const v of ['2', null, undefined, true, [2], { v: 2 }]) {
      expect(checkCurrencyDrift(v)).toEqual({ ok: false, error: 'invalid_request' });
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
    expect(res.json()).toEqual({ tolerancePercent: 5, currencyDriftPercent: 2 });
  });

  it('PUT saves boundaries 0 and 50 and returns the saved value', async () => {
    const s = setup();
    for (const v of [0, 50, 12.5]) {
      const res = await put(s, 'sa', { tolerancePercent: v });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ tolerancePercent: v, currencyDriftPercent: 2 });
      expect((await get(s, 'sa')).json()).toEqual({ tolerancePercent: v, currencyDriftPercent: 2 });
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
    expect((await get(s, 'sa')).json()).toEqual({ tolerancePercent: 7, currencyDriftPercent: 2 });
  });

  it('isolates two users and ignores a user id in the body', async () => {
    const s = setup();
    await put(s, 'sb', { tolerancePercent: 20 });
    const res = await put(s, 'sa', { tolerancePercent: 3, userId: s.b, user_id: s.b });
    expect(res.statusCode).toBe(200);
    expect((await get(s, 'sa')).json()).toEqual({ tolerancePercent: 3, currencyDriftPercent: 2 });
    expect((await get(s, 'sb')).json()).toEqual({ tolerancePercent: 20, currencyDriftPercent: 2 });
    expect(createUserRepo(s.db, s.b).getConfig()?.tolerancePercent).toBe(20);
  });

  describe('currencyDriftPercent', () => {
    it('GET defaults to 2 when no config row exists', async () => {
      const s = setup();
      expect((await get(s, 'sa')).json()).toMatchObject({ currencyDriftPercent: 2 });
    });

    it('PUT saves 0, 0.5, 2.5 and 10 and returns both values', async () => {
      const s = setup();
      for (const v of [0, 0.5, 2.5, 10]) {
        const res = await put(s, 'sa', { currencyDriftPercent: v });
        expect(res.statusCode, String(v)).toBe(200);
        expect(res.json()).toEqual({ tolerancePercent: 5, currencyDriftPercent: v });
        expect((await get(s, 'sa')).json()).toEqual({ tolerancePercent: 5, currencyDriftPercent: v });
      }
    });

    it('stores -0 as 0', async () => {
      const s = setup();
      const res = await s.app.inject({
        method: 'PUT',
        url: PATH,
        payload: '{"currencyDriftPercent":-0}',
        headers: {
          'content-type': 'application/json',
          origin: TEST_ORIGIN,
          cookie: s.sa.cookie,
          'x-csrf-token': s.sa.csrfToken,
        },
      });
      expect(res.statusCode).toBe(200);
      expect(Object.is(createUserRepo(s.db, s.a).getConfig()?.currencyDriftPercent, 0)).toBe(true);
    });

    it('rejects out-of-range and wrong-type values and an empty body without writing', async () => {
      const s = setup();
      await put(s, 'sa', { currencyDriftPercent: 3 });
      for (const v of [-0.1, 10.1, 2.3, 11, -1]) {
        const res = await put(s, 'sa', { currencyDriftPercent: v });
        expect(res.statusCode, String(v)).toBe(400);
        expect(res.json()).toEqual({ error: 'out_of_range' });
      }
      for (const payload of [
        { currencyDriftPercent: '2' },
        { currencyDriftPercent: null },
        { currencyDriftPercent: true },
        {},
        { userId: s.b },
        '{"currencyDriftPercent":NaN}',
      ]) {
        const res = await put(s, 'sa', payload);
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'invalid_request' });
      }
      expect(createUserRepo(s.db, s.a).getConfig()?.currencyDriftPercent).toBe(3);
    });

    it('a PUT with one key keeps the other, and both keys together are saved', async () => {
      const s = setup();
      await put(s, 'sa', { tolerancePercent: 12 });
      expect((await put(s, 'sa', { currencyDriftPercent: 4 })).json()).toEqual({
        tolerancePercent: 12,
        currencyDriftPercent: 4,
      });
      expect((await put(s, 'sa', { tolerancePercent: 8 })).json()).toEqual({
        tolerancePercent: 8,
        currencyDriftPercent: 4,
      });
      const both = await put(s, 'sa', { tolerancePercent: 20, currencyDriftPercent: 6.5 });
      expect(both.statusCode).toBe(200);
      expect(both.json()).toEqual({ tolerancePercent: 20, currencyDriftPercent: 6.5 });
    });

    it('one valid and one invalid key write nothing', async () => {
      const s = setup();
      await put(s, 'sa', { tolerancePercent: 7, currencyDriftPercent: 3 });
      const a = await put(s, 'sa', { tolerancePercent: 9, currencyDriftPercent: 2.3 });
      expect(a.statusCode).toBe(400);
      expect(a.json()).toEqual({ error: 'out_of_range' });
      const b = await put(s, 'sa', { tolerancePercent: 51, currencyDriftPercent: 1 });
      expect(b.statusCode).toBe(400);
      expect(b.json()).toEqual({ error: 'out_of_range' });
      const c = await put(s, 'sa', { tolerancePercent: 9, currencyDriftPercent: '1' });
      expect(c.statusCode).toBe(400);
      expect(c.json()).toEqual({ error: 'invalid_request' });
      expect((await get(s, 'sa')).json()).toEqual({ tolerancePercent: 7, currencyDriftPercent: 3 });
    });

    it('401 without a session and 403 without CSRF, nothing written', async () => {
      const s = setup();
      const noSession = await s.app.inject({
        method: 'PUT',
        url: PATH,
        payload: { currencyDriftPercent: 4 },
        headers: { origin: TEST_ORIGIN },
      });
      expect(noSession.statusCode).toBe(401);
      const noToken = await s.app.inject({
        method: 'PUT',
        url: PATH,
        payload: { currencyDriftPercent: 4 },
        headers: { origin: TEST_ORIGIN, cookie: s.sa.cookie },
      });
      expect(noToken.statusCode).toBe(403);
      expect(createUserRepo(s.db, s.a).getConfig()).toBeUndefined();
    });

    it('isolates two users, ignores a user id in the body and returns no secret', async () => {
      const s = setup();
      createUserRepo(s.db, s.b).upsertConfig({ wallosApiKeyEnc: 'v1:secret-ciphertext' });
      await put(s, 'sb', { currencyDriftPercent: 7 });
      const res = await put(s, 'sa', { currencyDriftPercent: 1.5, userId: s.b, user_id: s.b });
      expect(res.statusCode).toBe(200);
      expect(Object.keys(res.json()).sort()).toEqual(['currencyDriftPercent', 'tolerancePercent']);
      expect(res.body).not.toContain('secret');
      expect((await get(s, 'sa')).json()).toMatchObject({ currencyDriftPercent: 1.5 });
      expect((await get(s, 'sb')).json()).toMatchObject({ currencyDriftPercent: 7 });
      expect(createUserRepo(s.db, s.b).getConfig()?.currencyDriftPercent).toBe(7);
    });
  });
});

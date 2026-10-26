import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import { injectAs, makeClock, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';

const URL = '/api/overrides/w1';
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
  return {
    app,
    db,
    a,
    b,
    repoA: createUserRepo(db, a),
    repoB: createUserRepo(db, b),
    sa: signIn({ db, clock }, a),
    sb: signIn({ db, clock }, b),
  };
}
type S = ReturnType<typeof setup>;
const call = (s: S, who: 'sa' | 'sb', method: 'GET' | 'PUT' | 'DELETE', payload?: unknown, url = URL) =>
  injectAs(s.app, s[who], {
    method,
    url,
    ...(payload === undefined ? {} : { payload: payload as object, headers: { 'content-type': 'application/json' } }),
  });

describe('overrides routes', () => {
  it('401 without a session on all three verbs', async () => {
    const s = setup();
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      const res = await s.app.inject({ method, url: URL, headers: { origin: TEST_ORIGIN } });
      expect(res.statusCode, method).toBe(401);
    }
  });

  it('403 without CSRF or with a foreign Origin on PUT and DELETE, nothing written', async () => {
    const s = setup();
    for (const method of ['PUT', 'DELETE'] as const) {
      const noToken = await s.app.inject({
        method,
        url: URL,
        payload: { rate: '1.5' },
        headers: { origin: TEST_ORIGIN, cookie: s.sa.cookie },
      });
      const foreign = await injectAs(s.app, s.sa, {
        method,
        url: URL,
        payload: { rate: '1.5' },
        headers: { origin: 'https://evil.example' },
      });
      expect(noToken.statusCode).toBe(403);
      expect(foreign.statusCode).toBe(403);
    }
    expect(s.repoA.getSubscriptionOverride('w1')).toBeUndefined();
  });

  it('GET 404, PUT 200, GET 200, DELETE 204, GET 404', async () => {
    const s = setup();
    expect((await call(s, 'sa', 'GET')).statusCode).toBe(404);
    const put = await call(s, 'sa', 'PUT', { rate: ' 1.0850 ' });
    expect(put.statusCode).toBe(200);
    expect(put.json()).toEqual({ wallosSubscriptionId: 'w1', rate: '1.0850', resetMatches: 0 });
    const got = await call(s, 'sa', 'GET');
    expect(got.json()).toEqual({ wallosSubscriptionId: 'w1', rate: '1.0850' });
    expect((await call(s, 'sa', 'DELETE')).statusCode).toBe(204);
    const gone = await call(s, 'sa', 'GET');
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ error: 'not_found' });
    expect((await call(s, 'sa', 'DELETE')).statusCode).toBe(404);
  });

  it('PUT rejects a bad rate with invalid_rate and writes nothing', async () => {
    const s = setup();
    const m = s.repoA.insertMatch({
      wallosId: 'w1',
      actualScheduleId: 'a1',
      status: 'LINKED',
      lastKnownWallosHash: 'hw',
    });
    for (const rate of ['0', '-1', '', '   ', 'abc', '1e3', '1,5']) {
      const res = await call(s, 'sa', 'PUT', { rate });
      expect(res.statusCode, rate).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_rate' });
    }
    expect(s.repoA.getSubscriptionOverride('w1')).toBeUndefined();
    expect(s.repoA.getMatch(m.id)?.lastKnownWallosHash).toBe('hw');
  });

  it('PUT rejects a missing or non-string rate and a blank id with invalid_request', async () => {
    const s = setup();
    for (const payload of [{}, { rate: 1.5 }, { rate: null }, []]) {
      const res = await call(s, 'sa', 'PUT', payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }
    // Fastify's own param cap (100) rejects long ids before the 200 cap in the handler is reached.
    const blank = await call(s, 'sa', 'PUT', { rate: '1' }, '/api/overrides/%20');
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ error: 'invalid_request' });
  });

  it('a changed PUT and a DELETE reset LINKED Wallos hashes; a same-rate PUT does not', async () => {
    const s = setup();
    const m = s.repoA.insertMatch({
      wallosId: 'w1',
      actualScheduleId: 'a1',
      status: 'LINKED',
      lastKnownWallosHash: 'hw',
      lastKnownActualHash: 'ha',
    });
    expect((await call(s, 'sa', 'PUT', { rate: '2' })).json()).toMatchObject({ resetMatches: 1 });
    expect(s.repoA.getMatch(m.id)).toMatchObject({ lastKnownWallosHash: null, lastKnownActualHash: 'ha' });
    s.repoA.updateMatch(m.id, { lastKnownWallosHash: 'hw2' });
    expect((await call(s, 'sa', 'PUT', { rate: '2' })).json()).toMatchObject({ resetMatches: 0 });
    expect(s.repoA.getMatch(m.id)?.lastKnownWallosHash).toBe('hw2');
    expect((await call(s, 'sa', 'DELETE')).statusCode).toBe(204);
    expect(s.repoA.getMatch(m.id)?.lastKnownWallosHash).toBeNull();
  });

  it('two users: B cannot read, overwrite or delete A override, and B PUT never resets A hashes', async () => {
    const s = setup();
    await call(s, 'sa', 'PUT', { rate: '1.5' });
    const mine = s.repoA.insertMatch({
      wallosId: 'w1',
      actualScheduleId: 'a1',
      status: 'LINKED',
      lastKnownWallosHash: 'hw',
      lastKnownActualHash: 'ha',
    });
    expect((await call(s, 'sb', 'GET')).statusCode).toBe(404);
    expect((await call(s, 'sb', 'DELETE')).statusCode).toBe(404);
    expect(s.repoA.getSubscriptionOverride('w1')?.rate).toBe('1.5');

    const bPut = await call(s, 'sb', 'PUT', { rate: '9' });
    expect(bPut.json()).toMatchObject({ rate: '9', resetMatches: 0 });
    expect(s.repoA.getSubscriptionOverride('w1')?.rate).toBe('1.5');
    expect(s.repoB.getSubscriptionOverride('w1')?.rate).toBe('9');
    expect(s.repoA.getMatch(mine.id)).toEqual(mine);
  });
});

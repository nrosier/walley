import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { CreateDeps } from '../integrations/create.js';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { hashMatchFields } from '../matching/hash.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';

const fieldsOf = (name: string, cents: number): MatchFieldsInput => ({
  name,
  amount: { kind: 'single', cents },
  frequency: 'monthly',
  interval: 1,
  currency: 'EUR',
  startDate: '2026-01-01',
});

const open: { close(): Promise<unknown>; db?: AppDatabase }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    if (a.db) closeDatabase(a.db);
  }
});

function setup() {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  const sub = (id: number, name: string, price: string) => ({
    id,
    name,
    price,
    currency_id: 1,
    cycle: 3,
    frequency: 1,
    next_payment: '2026-11-03',
    start_date: '2026-01-01',
    inactive: 0,
  });
  const remote = {
    subs: [sub(7, 'Netflix', '12.50'), sub(8, 'Spotify', '9.99')] as Record<string, unknown>[],
    schedules: [
      { id: 'sch-a', name: 'Netflix', amount: -1250 },
      { id: 'sch-b', name: 'Completely Different', amount: -5000 },
      { id: 'sch-c', name: 'Netflix', amount: -1250, patterns: [{ type: 'day', value: 1 }] as unknown[] | undefined },
    ],
  };
  const writes = {
    createSubscription: vi.fn(),
    updateSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
  };
  const reads = { listSubscriptions: vi.fn(), listCurrencies: vi.fn(), withActual: vi.fn() };
  const api = {
    getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
    getSchedules: async () =>
      remote.schedules.map((x) => ({
        id: x.id,
        name: x.name,
        amount: x.amount,
        amountOp: 'is',
        date: { frequency: 'monthly', interval: 1, start: '2026-01-01', ...(x.patterns ? { patterns: x.patterns } : {}) },
      })),
    createSchedule: writes.createSchedule,
    updateSchedule: writes.updateSchedule,
    deleteSchedule: writes.deleteSchedule,
  };
  const deps = {
    wallos: {
      listSubscriptions: async () => {
        reads.listSubscriptions();
        return remote.subs;
      },
      listPaymentMethods: async () => [],
      listCategories: async () => [],
      listCurrencies: async () => {
        reads.listCurrencies();
        return [{ id: 1, code: 'EUR', rate: '1' }];
      },
      createSubscription: writes.createSubscription,
      updateSubscription: writes.updateSubscription,
      deleteSubscription: writes.deleteSubscription,
    },
    repoFor: (id: string) => createUserRepo(t.db, id),
    withActual: (_id: string, use: (a: unknown) => Promise<unknown>) => {
      reads.withActual();
      return use(api);
    },
  } as unknown as CreateDeps;
  const app = buildApp({
    db: t.db,
    integrations: deps,
    auth: {
      mode: 'local',
      secureCookies: false,
      allowRegistration: false,
      publicOrigin: t.publicOrigin,
      now: () => t.clock.now(),
    },
  });
  open.push({ close: () => app.close(), db: t.db });
  void t.app.close();
  const a = makeUser(t.db);
  const b = makeUser(t.db);
  const ctx = { db: t.db, clock: t.clock };
  const noWrites = () => {
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
  };
  return {
    app,
    sa: signIn(ctx, a),
    sb: signIn(ctx, b),
    repoA: createUserRepo(t.db, a),
    repoB: createUserRepo(t.db, b),
    remote,
    reads,
    noWrites,
  };
}

const link = (wallosId: unknown, actualScheduleId: unknown) => ({
  method: 'POST' as const,
  url: '/api/matches',
  payload: { wallosId, actualScheduleId },
});
const ignore = (side: unknown, itemId: unknown) => ({
  method: 'POST' as const,
  url: '/api/matches/ignore',
  payload: { side, itemId },
});

describe('POST /api/matches', () => {
  it('links a candidate pair, seeds both hashes and calls no write method', async () => {
    const { app, sa, repoA, noWrites } = setup();
    const res = await injectAs(app, sa, link('7', 'sch-a'));
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string; status: string }>();
    expect(body.status).toBe('LINKED');
    expect(Object.keys(body).sort()).toEqual(['id', 'status']);
    expect(repoA.getMatch(body.id)).toMatchObject({
      wallosId: '7',
      actualScheduleId: 'sch-a',
      status: 'LINKED',
      lastKnownWallosHash: hashMatchFields(fieldsOf('Netflix', -1250)),
      lastKnownActualHash: hashMatchFields(fieldsOf('Netflix', -1250)),
    });
    noWrites();
  });

  it('409 already_matched when either id has a row, and keeps one row', async () => {
    const { app, sa, repoA } = setup();
    expect((await injectAs(app, sa, link('7', 'sch-a'))).statusCode).toBe(201);
    for (const [w, s] of [['7', 'sch-a'], ['7', 'sch-b'], ['8', 'sch-a']] as const) {
      const res = await injectAs(app, sa, link(w, s));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'already_matched' });
    }
    expect(repoA.listMatches()).toHaveLength(1);
  });

  it('409 when one id is ignored', async () => {
    const { app, sa } = setup();
    expect((await injectAs(app, sa, ignore('wallos', '7'))).statusCode).toBe(201);
    const res = await injectAs(app, sa, link('7', 'sch-a'));
    expect(res.statusCode).toBe(409);
  });

  it('400 item_not_found for a missing id on either side', async () => {
    const { app, sa, repoA } = setup();
    for (const [w, s] of [['999', 'sch-a'], ['7', 'nope']] as const) {
      const res = await injectAs(app, sa, link(w, s));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'item_not_found' });
    }
    expect(repoA.listMatches()).toHaveLength(0);
  });

  it('400 not_candidate for a name mismatch, an amount mismatch and an unhashable side', async () => {
    const { app, sa, repoA } = setup();
    for (const [w, s] of [['7', 'sch-b'], ['8', 'sch-a'], ['7', 'sch-c']] as const) {
      const res = await injectAs(app, sa, link(w, s));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'not_candidate' });
    }
    expect(repoA.listMatches()).toHaveLength(0);
  });

  it('400 invalid_request for bad bodies', async () => {
    const { app, sa } = setup();
    for (const payload of [undefined, {}, { wallosId: '7' }, { wallosId: 7, actualScheduleId: 'x' }, { wallosId: '  ', actualScheduleId: 'x' }, { wallosId: 'a'.repeat(201), actualScheduleId: 'x' }, []]) {
      const res = await injectAs(app, sa, { method: 'POST', url: '/api/matches', ...(payload === undefined ? {} : { payload }) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('two users can link the same pair; each row stays in its own scope', async () => {
    const { app, sa, sb, repoA, repoB } = setup();
    const rb = await injectAs(app, sb, link('7', 'sch-a'));
    expect(rb.statusCode).toBe(201);
    const idB = rb.json<{ id: string }>().id;
    const rowB = repoB.getMatch(idB);
    expect(rowB).toBeDefined();

    const ra = await injectAs(app, sa, link('7', 'sch-a'));
    expect(ra.statusCode).toBe(201);
    const idA = ra.json<{ id: string }>().id;
    expect(idA).not.toBe(idB);

    expect(repoB.getMatch(idB)).toEqual(rowB);
    expect(repoB.listMatches()).toEqual([rowB]);
    expect(repoB.getMatch(idA)).toBeUndefined();
    expect(repoA.listMatches().map((m) => m.id)).toEqual([idA]);
  });

  it('B ignoring an item does not block A from linking it; B ignored row is untouched', async () => {
    const { app, sa, sb, repoB, noWrites } = setup();
    const ignored = await injectAs(app, sb, ignore('wallos', '7'));
    expect(ignored.statusCode).toBe(201);
    const idB = ignored.json<{ id: string }>().id;
    const rowB = repoB.getMatch(idB);
    expect(rowB).toBeDefined();

    const ra = await injectAs(app, sa, link('7', 'sch-a'));
    expect(ra.statusCode).toBe(201);
    expect(ra.json<{ status: string }>().status).toBe('LINKED');

    expect(repoB.getMatch(idB)).toEqual(rowB);
    expect(repoB.listMatches()).toEqual([rowB]);
    noWrites();
  });

  it('401 without a session and 403 csrf_failed without the token', async () => {
    const { app, sa } = setup();
    const none = await app.inject({ ...link('7', 'sch-a'), headers: { origin: TEST_ORIGIN } });
    expect(none.statusCode).toBe(401);
    const noCsrf = await app.inject({ ...link('7', 'sch-a'), headers: { origin: TEST_ORIGIN, cookie: sa.cookie } });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toEqual({ error: 'csrf_failed' });
  });
});

describe('POST /api/matches/ignore', () => {
  it('ignores each side with only that id set and makes no remote call', async () => {
    const { app, sa, repoA, reads, noWrites } = setup();
    const w = await injectAs(app, sa, ignore('wallos', '7'));
    expect(w.statusCode).toBe(201);
    expect(w.json()).toEqual({ id: expect.any(String) as string, status: 'IGNORED_WALLOS' });
    const a = await injectAs(app, sa, ignore('actual', 'sch-a'));
    expect(a.statusCode).toBe(201);
    expect(a.json()).toEqual({ id: expect.any(String) as string, status: 'IGNORED_ACTUAL' });
    expect(repoA.getMatch(w.json<{ id: string }>().id)).toMatchObject({
      wallosId: '7',
      actualScheduleId: null,
      lastKnownWallosHash: null,
      lastKnownActualHash: null,
    });
    expect(repoA.getMatch(a.json<{ id: string }>().id)).toMatchObject({ wallosId: null, actualScheduleId: 'sch-a' });
    for (const fn of Object.values(reads)) expect(fn).not.toHaveBeenCalled();
    noWrites();
  });

  it('409 already_matched when the item has a row', async () => {
    const { app, sa } = setup();
    expect((await injectAs(app, sa, ignore('wallos', '7'))).statusCode).toBe(201);
    const again = await injectAs(app, sa, ignore('wallos', '7'));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'already_matched' });
    expect((await injectAs(app, sa, link('7', 'sch-a'))).statusCode).toBe(409);
  });

  it('400 invalid_request for bad bodies', async () => {
    const { app, sa } = setup();
    for (const payload of [{}, { side: 'both', itemId: '7' }, { side: 'wallos' }, { side: 'wallos', itemId: 7 }, { side: 'actual', itemId: '' }]) {
      const res = await injectAs(app, sa, { method: 'POST', url: '/api/matches/ignore', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('401 and 403 csrf_failed', async () => {
    const { app, sa } = setup();
    expect((await app.inject({ ...ignore('wallos', '7'), headers: { origin: TEST_ORIGIN } })).statusCode).toBe(401);
    const res = await app.inject({ ...ignore('wallos', '7'), headers: { origin: TEST_ORIGIN, cookie: sa.cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'csrf_failed' });
  });

  it('A can ignore an item B has linked (201, not 409); B LINKED row is unchanged', async () => {
    const { app, sa, sb, repoB, noWrites } = setup();
    const linked = await injectAs(app, sb, link('7', 'sch-a'));
    expect(linked.statusCode).toBe(201);
    const idB = linked.json<{ id: string }>().id;
    const rowB = repoB.getMatch(idB);
    expect(rowB).toBeDefined();

    const ra = await injectAs(app, sa, ignore('wallos', '7'));
    expect(ra.statusCode).toBe(201);
    expect(ra.json<{ status: string }>().status).toBe('IGNORED_WALLOS');

    expect(repoB.getMatch(idB)).toEqual(rowB);
    expect(repoB.listMatches()).toEqual([rowB]);
    noWrites();
  });

  it('two users ignore the same Wallos id independently', async () => {
    const { app, sa, sb, repoA, repoB } = setup();
    const ra = await injectAs(app, sa, ignore('wallos', '7'));
    const rb = await injectAs(app, sb, ignore('wallos', '7'));
    expect(ra.statusCode).toBe(201);
    expect(rb.statusCode).toBe(201);
    expect(repoA.listMatches()).toHaveLength(1);
    expect(repoB.listMatches()).toHaveLength(1);
    expect(ra.json<{ id: string }>().id).not.toBe(rb.json<{ id: string }>().id);
  });
});

describe('DELETE /api/matches/:id', () => {
  const del = (id: string) => ({ method: 'DELETE' as const, url: `/api/matches/${encodeURIComponent(id)}` });

  it('deletes an ignored row with 204 and no remote call', async () => {
    const { app, sa, repoA, reads, noWrites } = setup();
    const id = (await injectAs(app, sa, ignore('actual', 'sch-a'))).json<{ id: string }>().id;
    const res = await injectAs(app, sa, del(id));
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(repoA.getMatch(id)).toBeUndefined();
    for (const fn of Object.values(reads)) expect(fn).not.toHaveBeenCalled();
    noWrites();
  });

  it('400 invalid_state for a LINKED row and keeps it', async () => {
    const { app, sa, repoA } = setup();
    const id = (await injectAs(app, sa, link('7', 'sch-a'))).json<{ id: string }>().id;
    const res = await injectAs(app, sa, del(id));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_state' });
    expect(repoA.getMatch(id)).toBeDefined();
  });

  it('404 match_not_found for a missing id and for another user\'s id', async () => {
    const { app, sa, sb, repoB } = setup();
    const idB = (await injectAs(app, sb, ignore('wallos', '7'))).json<{ id: string }>().id;
    for (const id of ['missing', idB]) {
      const res = await injectAs(app, sa, del(id));
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'match_not_found' });
      expect(res.body).not.toContain(idB);
    }
    expect(repoB.getMatch(idB)).toBeDefined();
  });

  it('401 and 403 csrf_failed', async () => {
    const { app, sa } = setup();
    expect((await app.inject({ ...del('x'), headers: { origin: TEST_ORIGIN } })).statusCode).toBe(401);
    const res = await app.inject({ ...del('x'), headers: { origin: TEST_ORIGIN, cookie: sa.cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'csrf_failed' });
  });
});

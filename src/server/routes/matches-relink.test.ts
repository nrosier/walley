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
    subsByUser: {} as Record<string, Record<string, unknown>[]>,
  };
  const hooks: { replace?: () => boolean } = {};
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
      listSubscriptions: async (uid: string) => {
        reads.listSubscriptions();
        return remote.subsByUser[uid] ?? remote.subs;
      },
      listCurrencies: async () => {
        reads.listCurrencies();
        return [{ id: 1, code: 'EUR', rate: '1' }];
      },
      createSubscription: writes.createSubscription,
      updateSubscription: writes.updateSubscription,
      deleteSubscription: writes.deleteSubscription,
    },
    repoFor: (id: string) => {
      const repo = createUserRepo(t.db, id);
      return {
        ...repo,
        replaceMatchSide: (...args: Parameters<typeof repo.replaceMatchSide>) =>
          hooks.replace ? hooks.replace() : repo.replaceMatchSide(...args),
      };
    },
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
  const syncCheck = async (session: ReturnType<typeof signIn>) =>
    (await injectAs(app, session, { method: 'POST', url: '/api/sync/check' })).json<{
      linked: { matchId: string; wallosId: string; actualScheduleId: string; status: string; orphan: string | null }[];
    }>();
  const noWrites = () => {
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
  };
  return {
    app,
    sa: signIn(ctx, a),
    sb: signIn(ctx, b),
    a,
    b,
    hooks,
    repoA: createUserRepo(t.db, a),
    repoB: createUserRepo(t.db, b),
    remote,
    reads,
    writes,
    noWrites,
    syncCheck,
  };
}

const link = (wallosId: string, actualScheduleId: string) => ({
  method: 'POST' as const,
  url: '/api/matches',
  payload: { wallosId, actualScheduleId },
});
const relink = (id: string, itemId: unknown) => ({
  method: 'POST' as const,
  url: `/api/matches/${encodeURIComponent(id)}/relink`,
  payload: { itemId },
});

async function linkedPair(t: ReturnType<typeof setup>) {
  const res = await injectAs(t.app, t.sa, link('7', 'sch-a'));
  expect(res.statusCode).toBe(201);
  return res.json<{ id: string }>().id;
}
const dropWallos = (t: ReturnType<typeof setup>) => {
  t.remote.subs = t.remote.subs.filter((s) => s['id'] !== 7);
};
const dropActual = (t: ReturnType<typeof setup>) => {
  t.remote.schedules = t.remote.schedules.filter((s) => s.id !== 'sch-a');
};
const remoteCalls = (t: ReturnType<typeof setup>) =>
  t.reads.listSubscriptions.mock.calls.length + t.reads.withActual.mock.calls.length;

describe('POST /api/matches/:id/relink', () => {
  it('repoints an orphaned Wallos side, keeps the id, stores server hashes, then sync shows it linked', async () => {
    const t = setup();
    const id = await linkedPair(t);
    dropWallos(t);
    expect((await t.syncCheck(t.sa)).linked[0]?.orphan).toBe('orphaned_wallos');
    const res = await injectAs(t.app, t.sa, relink(id, '8'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id, status: 'LINKED' });
    const row = t.repoA.getMatch(id);
    expect(row).toMatchObject({
      wallosId: '8',
      actualScheduleId: 'sch-a',
      status: 'LINKED',
      lastKnownWallosHash: hashMatchFields(fieldsOf('Spotify', -999)),
      lastKnownActualHash: hashMatchFields(fieldsOf('Netflix', -1250)),
    });
    expect(t.repoA.listMatches()).toHaveLength(1);
    const after = await t.syncCheck(t.sa);
    expect(after.linked).toHaveLength(1);
    expect(after.linked[0]).toMatchObject({ matchId: id, wallosId: '8', orphan: null });
    t.noWrites();
  });

  it('repoints an orphaned Actual side', async () => {
    const t = setup();
    const id = await linkedPair(t);
    dropActual(t);
    const res = await injectAs(t.app, t.sa, relink(id, 'sch-b'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id, status: 'LINKED' });
    expect(t.repoA.getMatch(id)).toMatchObject({
      wallosId: '7',
      actualScheduleId: 'sch-b',
      status: 'LINKED',
      lastKnownWallosHash: hashMatchFields(fieldsOf('Netflix', -1250)),
      lastKnownActualHash: hashMatchFields(fieldsOf('Completely Different', -5000)),
    });
    expect((await t.syncCheck(t.sa)).linked[0]).toMatchObject({ matchId: id, orphan: null });
    t.noWrites();
  });

  it('stores a null hash when the chosen item cannot be hashed', async () => {
    const t = setup();
    const id = await linkedPair(t);
    dropActual(t);
    const res = await injectAs(t.app, t.sa, relink(id, 'sch-c'));
    expect(res.statusCode).toBe(200);
    expect(t.repoA.getMatch(id)).toMatchObject({
      actualScheduleId: 'sch-c',
      status: 'LINKED',
      lastKnownActualHash: null,
      lastKnownWallosHash: hashMatchFields(fieldsOf('Netflix', -1250)),
    });
  });

  it('400 invalid_state for IGNORED rows, with no remote read', async () => {
    const t = setup();
    const ig = (await injectAs(t.app, t.sa, { method: 'POST', url: '/api/matches/ignore', payload: { side: 'wallos', itemId: '7' } })).json<{ id: string }>().id;
    const res = await injectAs(t.app, t.sa, relink(ig, '8'));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_state' });
    expect(remoteCalls(t)).toBe(0);
  });

  it('400 invalid_state when both sides are still present, and when both are gone', async () => {
    const t = setup();
    const id = await linkedPair(t);
    const present = await injectAs(t.app, t.sa, relink(id, '8'));
    expect(present.statusCode).toBe(400);
    expect(present.json()).toEqual({ error: 'invalid_state' });
    dropWallos(t);
    dropActual(t);
    const both = await injectAs(t.app, t.sa, relink(id, '8'));
    expect(both.statusCode).toBe(400);
    expect(both.json()).toEqual({ error: 'invalid_state' });
    expect(t.repoA.getMatch(id)).toMatchObject({ wallosId: '7', actualScheduleId: 'sch-a' });
  });

  it('400 item_not_found for an id absent on the missing side (including one on the survivor side)', async () => {
    const t = setup();
    const id = await linkedPair(t);
    dropWallos(t);
    for (const item of ['999', 'sch-b']) {
      const res = await injectAs(t.app, t.sa, relink(id, item));
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'item_not_found' });
    }
    expect(t.repoA.getMatch(id)).toMatchObject({ wallosId: '7', actualScheduleId: 'sch-a' });
  });

  it('409 already_matched when the item has a row (ignored), with no remote read', async () => {
    const t = setup();
    const id = await linkedPair(t);
    const other = (await injectAs(t.app, t.sa, { method: 'POST', url: '/api/matches/ignore', payload: { side: 'wallos', itemId: '8' } })).json<{ id: string }>().id;
    const ig = await injectAs(t.app, t.sa, { method: 'POST', url: '/api/matches/ignore', payload: { side: 'wallos', itemId: '9' } });
    expect(ig.statusCode).toBe(201);
    dropWallos(t);
    const before = remoteCalls(t);
    for (const item of ['8', '9']) {
      const res = await injectAs(t.app, t.sa, relink(id, item));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'already_matched' });
    }
    expect(remoteCalls(t)).toBe(before);
    expect(t.repoA.getMatch(id)).toMatchObject({ wallosId: '7' });
    expect(t.repoA.getMatch(other)).toMatchObject({ wallosId: '8', status: 'IGNORED_WALLOS' });
  });

  it('409 already_matched on a unique violation in a race, 400 invalid_state when the repoint is refused', async () => {
    const t = setup();
    const id = await linkedPair(t);
    dropWallos(t);
    t.hooks.replace = () => {
      throw Object.assign(new Error('unique'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    };
    const race = await injectAs(t.app, t.sa, relink(id, '8'));
    expect(race.statusCode).toBe(409);
    expect(race.json()).toEqual({ error: 'already_matched' });
    t.hooks.replace = () => false;
    const stale = await injectAs(t.app, t.sa, relink(id, '8'));
    expect(stale.statusCode).toBe(400);
    expect(stale.json()).toEqual({ error: 'invalid_state' });
    expect(t.repoA.getMatch(id)).toMatchObject({ wallosId: '7', actualScheduleId: 'sch-a' });
  });

  it('404 match_not_found for an unknown id, with no remote read', async () => {
    const t = setup();
    const res = await injectAs(t.app, t.sa, relink('nope', '8'));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'match_not_found' });
    expect(remoteCalls(t)).toBe(0);
  });

  it('400 invalid_request for bad bodies', async () => {
    const t = setup();
    const id = await linkedPair(t);
    for (const payload of [undefined, {}, { itemId: 8 }, { itemId: '  ' }, { itemId: 'a'.repeat(201) }, []]) {
      const res = await injectAs(t.app, t.sa, { method: 'POST', url: `/api/matches/${id}/relink`, ...(payload === undefined ? {} : { payload }) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('401 without a session, 403 csrf_failed without the token, 403 for a foreign Origin', async () => {
    const t = setup();
    const req = relink('x', '8');
    expect((await t.app.inject({ ...req, headers: { origin: TEST_ORIGIN } })).statusCode).toBe(401);
    const noCsrf = await t.app.inject({ ...req, headers: { origin: TEST_ORIGIN, cookie: t.sa.cookie } });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toEqual({ error: 'csrf_failed' });
    const evil = await injectAs(t.app, t.sa, { ...req, headers: { origin: 'http://evil.example' } });
    expect(evil.statusCode).toBe(403);
  });

  it('two users: B gets 404 on A\'s match and A\'s row is unchanged', async () => {
    const t = setup();
    const id = await linkedPair(t);
    dropWallos(t);
    const rowA = t.repoA.getMatch(id);
    const before = remoteCalls(t);
    const res = await injectAs(t.app, t.sb, relink(id, '8'));
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'match_not_found' });
    expect(remoteCalls(t)).toBe(before);
    expect(t.repoA.getMatch(id)).toEqual(rowA);
    expect(t.repoB.listMatches()).toHaveLength(0);
    t.noWrites();
  });

  it('two users: B cannot claim an item id that exists only in A\'s data', async () => {
    const t = setup();
    const idB = (await injectAs(t.app, t.sb, link('7', 'sch-a'))).json<{ id: string }>().id;
    const idA = (await injectAs(t.app, t.sa, link('7', 'sch-a'))).json<{ id: string }>().id;
    const onlyA = { id: 77, name: 'Only A', price: '3.00', currency_id: 1, cycle: 3, frequency: 1, next_payment: '2026-11-03', start_date: '2026-01-01', inactive: 0 };
    // A sees subscription 77 but not 7; B sees neither 77 nor 7.
    t.remote.subsByUser[t.a] = [onlyA];
    t.remote.subsByUser[t.b] = [];
    const resB = await injectAs(t.app, t.sb, relink(idB, '77'));
    expect(resB.statusCode).toBe(400);
    expect(resB.json()).toEqual({ error: 'item_not_found' });
    expect(t.repoB.getMatch(idB)).toMatchObject({ wallosId: '7' });
    const resA = await injectAs(t.app, t.sa, relink(idA, '77'));
    expect(resA.statusCode).toBe(200);
    expect(t.repoA.getMatch(idA)).toMatchObject({ wallosId: '77' });
    expect(t.repoB.getMatch(idB)).toMatchObject({ wallosId: '7' });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { CreateDeps } from '../integrations/create.js';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { hashMatchFields } from '../matching/hash.js';
import { runSyncCheck } from '../matching/sync-check.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

interface FakeSched {
  id: string;
  name: string;
  amount: number;
  patterns?: unknown[];
}
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
  // Current remote values, changed per test. Reads go only through the fakes below.
  const remote: { subs: Record<string, unknown>[]; schedules: FakeSched[] } = {
    subs: [
      {
        id: 7,
        name: 'Netflix',
        price: '12.50',
        currency_id: 1,
        cycle: 3,
        frequency: 1,
        next_payment: '2026-11-03',
        start_date: '2026-01-01',
        inactive: 0,
      },
    ],
    schedules: [{ id: 'sch-a', name: 'Netflix', amount: -1250 }],
  };
  const reads = { listSubscriptions: vi.fn(), listCurrencies: vi.fn(), withActual: vi.fn() };
  const writes = {
    createSubscription: vi.fn(),
    createSchedule: vi.fn(),
    updateSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    updateSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
  };
  const calls = { ...reads, ...writes };
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
  const repoA = createUserRepo(t.db, a);
  const repoB = createUserRepo(t.db, b);
  const row = (status: 'LINKED' | 'MISMATCH_DETECTED' | 'IGNORED_WALLOS' | 'IGNORED_ACTUAL', repo = repoA) =>
    repo.insertMatch({
      wallosId: status === 'IGNORED_ACTUAL' ? null : '7',
      actualScheduleId: status === 'IGNORED_WALLOS' ? null : 'sch-a',
      status,
      lastKnownWallosHash: H1,
      lastKnownActualHash: H2,
    });
  const noCalls = () => {
    for (const fn of Object.values(calls)) expect(fn).not.toHaveBeenCalled();
  };
  const noWrites = () => {
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
  };
  return { app, sa: signIn(ctx, a), userId: a, deps, remote, reads, repoA, repoB, row, noCalls, noWrites };
}

const url = (id: string) => `/api/matches/${encodeURIComponent(id)}/resolve`;

describe('POST /api/matches/:id/resolve', () => {
  it('answers 401 without a session', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: url('x'),
      payload: { action: 'unlink', confirm: true },
      headers: { origin: TEST_ORIGIN },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a missing CSRF header and a foreign Origin', async () => {
    const { app, sa, row, repoA } = setup();
    const m = row('MISMATCH_DETECTED');
    const noCsrf = await app.inject({
      method: 'POST',
      url: url(m.id),
      payload: { action: 'unlink', confirm: true },
      headers: { origin: TEST_ORIGIN, cookie: sa.cookie },
    });
    expect(noCsrf.statusCode).toBe(403);
    const evil = await injectAs(app, sa, {
      method: 'POST',
      url: url(m.id),
      payload: { action: 'unlink', confirm: true },
      headers: { origin: 'http://evil.example' },
    });
    expect(evil.statusCode).toBe(403);
    expect(repoA.getMatch(m.id)).toBeDefined();
  });

  it('ignore_diff stores the CURRENT hashes, then a sync check shows no mismatch', async () => {
    const { app, sa, userId, deps, remote, reads, row, repoA, noWrites } = setup();
    const m = row('MISMATCH_DETECTED');
    remote.schedules[0] = { id: 'sch-a', name: 'NETFLIX', amount: -1499 };
    const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action: 'ignore_diff' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'LINKED' });
    const stored = repoA.getMatch(m.id);
    expect(stored?.status).toBe('LINKED');
    expect(stored?.lastKnownActualHash).toBe(hashMatchFields(fieldsOf('netflix', -1499)));
    expect(stored?.lastKnownWallosHash).not.toBe(H1);
    expect(stored?.lastKnownActualHash).not.toBe(H2);
    expect(reads.listSubscriptions).toHaveBeenCalledTimes(1);
    expect(reads.withActual).toHaveBeenCalledTimes(1);
    noWrites();
    const check = await runSyncCheck({ ...deps, now: () => 0 }, userId);
    expect(check.mismatches).toEqual([]);
    expect(repoA.getMatch(m.id)?.status).toBe('LINKED');
    noWrites();
  });

  it('ignore_diff ignores client-supplied hashes', async () => {
    const { app, sa, row, repoA } = setup();
    const m = row('MISMATCH_DETECTED');
    const res = await injectAs(app, sa, {
      method: 'POST',
      url: url(m.id),
      payload: { action: 'ignore_diff', lastKnownWallosHash: 'c'.repeat(64), lastKnownActualHash: 'd'.repeat(64) },
    });
    expect(res.statusCode).toBe(200);
    expect(repoA.getMatch(m.id)?.lastKnownWallosHash).not.toBe('c'.repeat(64));
    expect(repoA.getMatch(m.id)?.lastKnownActualHash).not.toBe('d'.repeat(64));
  });

  it('ignore_diff returns 400 invalid_state and writes nothing when a side is missing', async () => {
    for (const side of ['wallos', 'actual'] as const) {
      const { app, sa, row, repoA, remote, noWrites } = setup();
      const m = row('MISMATCH_DETECTED');
      if (side === 'wallos') remote.subs = [];
      else remote.schedules = [];
      const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action: 'ignore_diff' } });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_state' });
      expect(repoA.getMatch(m.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1, lastKnownActualHash: H2 });
      noWrites();
    }
  });

  it('ignore_diff returns 400 invalid_state for a pattern schedule and writes nothing', async () => {
    const { app, sa, row, repoA, remote, noWrites } = setup();
    const m = row('MISMATCH_DETECTED');
    remote.schedules[0] = { id: 'sch-a', name: 'Netflix', amount: -1250, patterns: [{ type: 'day', value: 1 }] };
    const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action: 'ignore_diff' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_state' });
    expect(repoA.getMatch(m.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1, lastKnownActualHash: H2 });
    noWrites();
  });

  it('ignore_diff on LINKED returns 400 invalid_state', async () => {
    const { app, sa, row, repoA } = setup();
    const m = row('LINKED');
    const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action: 'ignore_diff' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_state' });
    expect(repoA.getMatch(m.id)?.status).toBe('LINKED');
  });

  it('unlink without confirm returns 400 confirmation_required and keeps the row', async () => {
    const { app, sa, row, repoA } = setup();
    const m = row('LINKED');
    for (const payload of [{ action: 'unlink' }, { action: 'unlink', confirm: 'true' }]) {
      const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'confirmation_required' });
    }
    expect(repoA.getMatch(m.id)).toBeDefined();
  });

  it('unlink with confirm deletes the row and calls no Wallos or Actual client', async () => {
    const { app, sa, row, repoA, noCalls } = setup();
    const m = row('MISMATCH_DETECTED');
    const res = await injectAs(app, sa, {
      method: 'POST',
      url: url(m.id),
      payload: { action: 'unlink', confirm: true },
    });
    expect(res.statusCode).toBe(200);
    expect(repoA.getMatch(m.id)).toBeUndefined();
    noCalls();
  });

  it('answers 400 unsupported_action for unknown actions and calls nothing', async () => {
    const { app, sa, row, repoA, noCalls } = setup();
    const m = row('MISMATCH_DETECTED');
    for (const action of ['bogus', 5]) {
      const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action, confirm: true } });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'unsupported_action' });
    }
    expect(repoA.getMatch(m.id)?.status).toBe('MISMATCH_DETECTED');
    noCalls();
  });

  it('answers 400 invalid_request for a missing body or a blank id', async () => {
    const { app, sa } = setup();
    const noBody = await injectAs(app, sa, { method: 'POST', url: url('x') });
    expect(noBody.statusCode).toBe(400);
    expect(noBody.json()).toEqual({ error: 'invalid_request' });
    const blank = await injectAs(app, sa, {
      method: 'POST',
      url: url('   '),
      payload: { action: 'unlink', confirm: true },
    });
    expect(blank.statusCode).toBe(400);
    expect(blank.json()).toEqual({ error: 'invalid_request' });
  });

  it("answers 404 match_not_found for another user's id and leaves their row alone", async () => {
    const { app, sa, row, repoB } = setup();
    const mb = row('MISMATCH_DETECTED', repoB);
    for (const payload of [{ action: 'ignore_diff' }, { action: 'unlink', confirm: true }]) {
      const res = await injectAs(app, sa, { method: 'POST', url: url(mb.id), payload });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'match_not_found' });
      expect(res.body).not.toContain(mb.id);
    }
    expect(repoB.getMatch(mb.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1 });
  });

  it('answers 400 invalid_state for ignored rows on both actions', async () => {
    const { app, sa, row, repoA } = setup();
    for (const status of ['IGNORED_WALLOS', 'IGNORED_ACTUAL'] as const) {
      const m = row(status);
      for (const payload of [{ action: 'ignore_diff' }, { action: 'unlink', confirm: true }]) {
        const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'invalid_state' });
      }
      expect(repoA.getMatch(m.id)?.status).toBe(status);
    }
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { WallosClient } from '../integrations/wallos/client.js';
import { makeUser } from '../test/auth-helpers.js';
import { hashMatchFields } from './hash.js';
import { runSyncCheck, type SyncCheckDeps } from './sync-check.js';

const dbs: AppDatabase[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) closeDatabase(d);
});

interface Sub {
  id: number;
  name: string;
  price: string;
  currency_id: number;
}
interface Sched {
  id: string;
  name: string;
  amount: number | { num1: number; num2: number };
  patterns?: unknown[];
}

const sub = (id: number, name: string, price: string, currency_id = 1): Sub => ({ id, name, price, currency_id });
const sched = (id: string, name: string, amount: Sched['amount'], patterns?: unknown[]): Sched => ({
  id,
  name,
  amount,
  ...(patterns === undefined ? {} : { patterns }),
});

function setup(subs: Sub[], schedules: Sched[]) {
  const db = openDatabase(':memory:');
  dbs.push(db);
  const userId = makeUser(db);
  const deps: SyncCheckDeps = {
    now: () => Date.UTC(2030, 0, 1),
    repoFor: (id) => createUserRepo(db, id),
    wallos: {
      listSubscriptions: async () =>
        subs.map((s) => ({ ...s, cycle: 3, frequency: 1, next_payment: '2026-11-03', start_date: '2026-01-01', inactive: 0 })),
      listCurrencies: async () => [
        { id: 1, code: 'EUR', rate: '1' },
        { id: 2, code: 'USD', rate: '2' },
      ],
    } as unknown as WallosClient,
    withActual: (_id, use) =>
      use({
        getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
        getSchedules: async () =>
          schedules.map((s) => ({
            id: s.id,
            name: s.name,
            amount: s.amount,
            amountOp: typeof s.amount === 'number' ? 'is' : 'isbetween',
            date: { frequency: 'monthly', interval: 1, start: '2026-01-01', ...(s.patterns ? { patterns: s.patterns } : {}) },
          })),
      } as never),
  };
  return { db, userId, deps, repo: createUserRepo(db, userId) };
}

const fields = (name: string, cents: number): MatchFieldsInput => ({
  name,
  amount: { kind: 'single', cents },
  frequency: 'monthly',
  interval: 1,
  currency: 'EUR',
  startDate: '2026-01-01',
});
const h = (name: string, cents: number): string => hashMatchFields(fields(name, cents)) ?? '';

describe('runSyncCheck', () => {
  it('keeps a saved pair linked and unlisted', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a1', 'Netflix', -1250)]);
    const m = t.repo.insertMatch({
      wallosId: '1',
      actualScheduleId: 'a1',
      status: 'LINKED',
      lastKnownWallosHash: h('Netflix', -1250),
      lastKnownActualHash: h('Netflix', -1250),
    });
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.unlinkedWallos).toEqual([]);
    expect(res.unlinkedActual).toEqual([]);
    expect(res.mismatches).toEqual([]);
    expect(res.orphaned).toEqual([]);
    expect(t.repo.getMatch(m.id)?.status).toBe('LINKED');
  });

  it('orphans a pair whose Actual schedule vanished, without flagging drift', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], []);
    const m = t.repo.insertMatch({
      wallosId: '1',
      actualScheduleId: 'gone',
      status: 'LINKED',
      lastKnownWallosHash: h('Netflix', -1250),
      lastKnownActualHash: h('Netflix', -1250),
    });
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.orphaned).toEqual([
      { wallosId: '1', actualScheduleId: 'gone', classification: 'orphaned_actual', status: 'LINKED' },
    ]);
    expect(res.mismatches).toEqual([]);
    expect(t.repo.getMatch(m.id)?.status).toBe('LINKED');
  });

  it('marks a drifted Actual amount MISMATCH_DETECTED and keeps the old hash', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a1', 'Netflix', -1499)]);
    const old = h('Netflix', -1250);
    const m = t.repo.insertMatch({
      wallosId: '1',
      actualScheduleId: 'a1',
      status: 'LINKED',
      lastKnownWallosHash: old,
      lastKnownActualHash: old,
    });
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.mismatches).toHaveLength(1);
    expect(res.mismatches[0]).toMatchObject({ wallosId: '1', actualScheduleId: 'a1', actualDrift: true, wallosDrift: false });
    const row = t.repo.getMatch(m.id);
    expect(row?.status).toBe('MISMATCH_DETECTED');
    expect(row?.lastKnownActualHash).toBe(old);
    expect(row?.lastKnownWallosHash).toBe(old);
    // A second run keeps the mismatch.
    expect((await runSyncCheck(t.deps, t.userId)).mismatches).toHaveLength(1);
  });

  it('sets a baseline from a null stored hash without flagging', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a1', 'Netflix', -1250)]);
    const m = t.repo.insertMatch({ wallosId: '1', actualScheduleId: 'a1', status: 'LINKED' });
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.mismatches).toEqual([]);
    const row = t.repo.getMatch(m.id);
    expect(row?.status).toBe('LINKED');
    expect(row?.lastKnownWallosHash).toBe(h('Netflix', -1250));
    expect(row?.lastKnownActualHash).toBe(h('Netflix', -1250));
  });

  it('leaves ignored rows untouched and out of the unlinked lists', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a9', 'Other', -500)]);
    const w = t.repo.insertMatch({ wallosId: '1', actualScheduleId: null, status: 'IGNORED_WALLOS' });
    const a = t.repo.insertMatch({ wallosId: null, actualScheduleId: 'a9', status: 'IGNORED_ACTUAL' });
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.unlinkedWallos).toEqual([]);
    expect(res.unlinkedActual).toEqual([]);
    expect(res.mismatches).toEqual([]);
    expect(t.repo.getMatch(w.id)).toMatchObject({ status: 'IGNORED_WALLOS', lastKnownWallosHash: null });
    expect(t.repo.getMatch(a.id)).toMatchObject({ status: 'IGNORED_ACTUAL', lastKnownActualHash: null });
  });

  it('reports a pattern schedule as unmappable and never as a candidate', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a1', 'Netflix', -1250, [{ type: 'day', value: 1 }])]);
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.unmappable).toEqual([{ side: 'actual', id: 'a1', name: 'Netflix', reason: 'patterns_unsupported' }]);
    expect(res.candidates).toEqual([]);
  });

  it('flags a range schedule and matches on the midpoint', async () => {
    const t = setup([sub(1, 'Gym', '12.50')], [sched('a1', 'Gym', { num1: -1200, num2: -1300 })]);
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.unlinkedActual[0]).toMatchObject({ id: 'a1', isRange: true, amountCents: -1250 });
    expect(res.unlinkedWallos[0]?.isRange).toBe(false);
    expect(res.candidates).toHaveLength(1);
    expect(res.candidates[0]).toMatchObject({ isRange: true, actualAmountCents: -1250 });
  });

  it('requires both the name and the amount to match', async () => {
    const t = setup(
      [sub(1, 'Netflix', '12.50'), sub(2, 'Spotify', '10.00')],
      [sched('a1', 'Netflix', -2000), sched('a2', 'Hulu', -1000), sched('a3', 'Spotify', -1020)],
    );
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.candidates.map((c) => [c.wallosId, c.actualScheduleId])).toEqual([['2', 'a3']]);
  });

  it('honours the user tolerance', async () => {
    const t = setup([sub(1, 'Netflix', '10.00')], [sched('a1', 'Netflix', -1100)]);
    expect((await runSyncCheck(t.deps, t.userId)).candidates).toHaveLength(0);
    t.repo.upsertConfig({ tolerancePercent: 10 });
    expect((await runSyncCheck(t.deps, t.userId)).candidates).toHaveLength(1);
  });

  it('converts a USD Wallos item to the base currency before comparing', async () => {
    // USD rate 2 per EUR rate 1: 25.00 USD is 12.50 EUR.
    const t = setup([sub(1, 'Netflix', '25.00', 2)], [sched('a1', 'Netflix', -1250)]);
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.unlinkedWallos[0]?.amountCents).toBe(-1250);
    expect(res.candidates).toHaveLength(1);
  });

  it('lets a per-subscription override win', async () => {
    const t = setup([sub(1, 'Netflix', '25.00', 2)], [sched('a1', 'Netflix', -2500)]);
    t.repo.upsertSubscriptionOverride('1', { rate: '1', now: new Date(0) });
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.unlinkedWallos[0]?.amountCents).toBe(-2500);
  });

  it('reports an unconvertible Wallos item as unmappable instead of failing', async () => {
    const t = setup([sub(1, 'Netflix', '12.50', 99)], []);
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.unmappable).toEqual([{ side: 'wallos', id: '1', name: 'Netflix', reason: 'mapping_failed' }]);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { WallosClient } from '../integrations/wallos/client.js';
import { makeUser } from '../test/auth-helpers.js';
import { hashMatchFields } from './hash.js';
import { isCandidate, runSyncCheck, type SyncCheckDeps } from './sync-check.js';

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

// Captured from the pre-refactor candidate loop (M7-S1); must stay byte-identical.
const PINNED_CANDIDATES =
  '[{"wallosId":"1","actualScheduleId":"a1","nameScore":1,"wallosName":"Netflix","actualName":"Netflix","wallosAmountCents":-1250,"actualAmountCents":-1260,"isRange":false},' +
  '{"wallosId":"3","actualScheduleId":"a3","nameScore":1,"wallosName":"Gym","actualName":"Gym","wallosAmountCents":-3000,"actualAmountCents":-3000,"isRange":true},' +
  '{"wallosId":"4","actualScheduleId":"a4","nameScore":1,"wallosName":"Disney Plus","actualName":"Disney+ Plus","wallosAmountCents":-999,"actualAmountCents":-999,"isRange":false},' +
  '{"wallosId":"1","actualScheduleId":"a5","nameScore":0.6666666666666666,"wallosName":"Netflix","actualName":"Netflix Family","wallosAmountCents":-1250,"actualAmountCents":-1250,"isRange":false},' +
  '{"wallosId":"2","actualScheduleId":"a2","nameScore":0.6666666666666666,"wallosName":"Spotify Premium","actualName":"Spotify","wallosAmountCents":-1000,"actualAmountCents":-1000,"isRange":false}]';

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

  it('returns the base currency', async () => {
    const t = setup([], []);
    expect((await runSyncCheck(t.deps, t.userId)).baseCurrency).toBe('EUR');
  });

  it('lists a linked pair with display fields and no orphan', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a1', 'Netflix', -1250)]);
    const m = t.repo.insertMatch({ wallosId: '1', actualScheduleId: 'a1', status: 'LINKED' });
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.linked).toEqual([
      {
        matchId: m.id,
        wallosId: '1',
        actualScheduleId: 'a1',
        status: 'LINKED',
        orphan: null,
        wallosName: 'Netflix',
        actualName: 'Netflix',
        wallosAmountCents: -1250,
        actualAmountCents: -1250,
        isRange: false,
      },
    ]);
    expect(res.ignored).toEqual([]);
  });

  it('carries the matchId on a mismatch and lists it as MISMATCH_DETECTED in linked', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a1', 'Netflix', { num1: -1400, num2: -1600 })]);
    const old = h('Netflix', -1250);
    const m = t.repo.insertMatch({
      wallosId: '1',
      actualScheduleId: 'a1',
      status: 'LINKED',
      lastKnownWallosHash: old,
      lastKnownActualHash: old,
    });
    const res = await runSyncCheck(t.deps, t.userId);
    expect(res.mismatches).toEqual([
      expect.objectContaining({ matchId: m.id, wallosId: '1', actualScheduleId: 'a1', isRange: true }),
    ]);
    expect(res.linked).toEqual([
      expect.objectContaining({
        matchId: m.id,
        status: 'MISMATCH_DETECTED',
        orphan: null,
        wallosAmountCents: -1250,
        actualAmountCents: -1500,
        isRange: true,
      }),
    ]);
  });

  it('adds field-level detail for both sides of a mismatch and keeps the old keys', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a1', 'Netflix', { num1: -1400, num2: -1600 })]);
    const old = h('Netflix', -1250);
    t.repo.insertMatch({ wallosId: '1', actualScheduleId: 'a1', status: 'LINKED', lastKnownWallosHash: old, lastKnownActualHash: old });
    const [mm] = (await runSyncCheck(t.deps, t.userId)).mismatches;
    expect(mm).toMatchObject({
      wallosName: 'Netflix',
      actualName: 'Netflix',
      wallosAmountCents: -1250,
      actualAmountCents: -1500,
      isRange: true,
      wallosDrift: false,
      actualDrift: true,
    });
    expect(mm?.wallosFields).toEqual({
      frequency: 'monthly',
      interval: 1,
      startDate: expect.any(String) as string,
      currency: 'EUR',
      amount: { kind: 'single', cents: -1250 },
    });
    expect(mm?.actualFields).toEqual({
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-01-01',
      currency: 'EUR',
      amount: { kind: 'range', num1: -1400, num2: -1600 },
    });
  });

  it('keeps two users\' sync checks apart, rows and names', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a1', 'Netflix', -1499)]);
    const old = h('Netflix', -1250);
    const a = t.repo.insertMatch({ wallosId: '1', actualScheduleId: 'a1', status: 'LINKED', lastKnownWallosHash: old, lastKnownActualHash: old });
    const bId = makeUser(t.db);
    const resB = await runSyncCheck({ ...t.deps, repoFor: (id) => createUserRepo(t.db, id) }, bId);
    expect(resB.mismatches).toEqual([]);
    expect(resB.linked).toEqual([]);
    expect(resB.ignored).toEqual([]);
    expect(resB.orphaned).toEqual([]);
    expect(JSON.stringify(resB)).not.toContain(a.id);
    expect(t.repo.getMatch(a.id)?.status).toBe('LINKED');
    expect((await runSyncCheck(t.deps, t.userId)).mismatches).toHaveLength(1);
  });

  it('marks each orphan kind in linked with null fields for the missing side', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a2', 'Spotify', -999)]);
    const mw = t.repo.insertMatch({ wallosId: 'gone-w', actualScheduleId: 'a2', status: 'LINKED' });
    const ma = t.repo.insertMatch({ wallosId: '1', actualScheduleId: 'gone-a', status: 'MISMATCH_DETECTED' });
    const mb = t.repo.insertMatch({ wallosId: 'gone-w2', actualScheduleId: 'gone-a2', status: 'LINKED' });
    const res = await runSyncCheck(t.deps, t.userId);
    const byId = new Map(res.linked.map((l) => [l.matchId, l]));
    expect(byId.get(mw.id)).toEqual({
      matchId: mw.id,
      wallosId: 'gone-w',
      actualScheduleId: 'a2',
      status: 'LINKED',
      orphan: 'orphaned_wallos',
      wallosName: null,
      actualName: 'Spotify',
      wallosAmountCents: null,
      actualAmountCents: -999,
      isRange: false,
    });
    expect(byId.get(ma.id)).toEqual({
      matchId: ma.id,
      wallosId: '1',
      actualScheduleId: 'gone-a',
      status: 'MISMATCH_DETECTED',
      orphan: 'orphaned_actual',
      wallosName: 'Netflix',
      actualName: null,
      wallosAmountCents: -1250,
      actualAmountCents: null,
      isRange: false,
    });
    expect(byId.get(mb.id)).toMatchObject({
      orphan: 'orphaned_both',
      wallosName: null,
      actualName: null,
      wallosAmountCents: null,
      actualAmountCents: null,
    });
    expect(res.orphaned).toHaveLength(3);
    // No writes for orphaned rows.
    expect(t.repo.getMatch(ma.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: null });
  });

  it('lists ignored rows with display fields, null when the item is gone', async () => {
    const t = setup(
      [sub(1, 'Netflix', '12.50'), sub(2, 'Broken', '1.00', 99)],
      [sched('a9', 'Gym', { num1: -1000, num2: -2000 })],
    );
    const w = t.repo.insertMatch({ wallosId: '1', actualScheduleId: null, status: 'IGNORED_WALLOS' });
    const bad = t.repo.insertMatch({ wallosId: '2', actualScheduleId: null, status: 'IGNORED_WALLOS' });
    const a = t.repo.insertMatch({ wallosId: null, actualScheduleId: 'a9', status: 'IGNORED_ACTUAL' });
    const gone = t.repo.insertMatch({ wallosId: null, actualScheduleId: 'gone', status: 'IGNORED_ACTUAL' });
    const res = await runSyncCheck(t.deps, t.userId);
    const byId = new Map(res.ignored.map((i) => [i.matchId, i]));
    expect(byId.get(w.id)).toEqual({
      matchId: w.id,
      side: 'wallos',
      itemId: '1',
      name: 'Netflix',
      amountCents: -1250,
      isRange: false,
      reason: null,
    });
    expect(byId.get(bad.id)).toEqual({
      matchId: bad.id,
      side: 'wallos',
      itemId: '2',
      name: 'Broken',
      amountCents: null,
      isRange: false,
      reason: 'mapping_failed',
    });
    expect(byId.get(a.id)).toEqual({
      matchId: a.id,
      side: 'actual',
      itemId: 'a9',
      name: 'Gym',
      amountCents: -1500,
      isRange: true,
      reason: null,
    });
    expect(byId.get(gone.id)).toEqual({
      matchId: gone.id,
      side: 'actual',
      itemId: 'gone',
      name: null,
      amountCents: null,
      isRange: false,
      reason: null,
    });
    expect(res.linked).toEqual([]);
    expect(res.unlinkedWallos).toEqual([]);
    expect(res.unlinkedActual).toEqual([]);
  });

  it('never returns another user\'s rows or names', async () => {
    const t = setup([sub(1, 'Netflix', '12.50')], [sched('a1', 'Netflix', -1250)]);
    const otherId = makeUser(t.db);
    const other = createUserRepo(t.db, otherId);
    const ol = other.insertMatch({ wallosId: '1', actualScheduleId: 'a1', status: 'LINKED' });
    const oi = other.insertMatch({ wallosId: null, actualScheduleId: 'zz', status: 'IGNORED_ACTUAL' });
    const res = await runSyncCheck(t.deps, t.userId);
    const body = JSON.stringify(res);
    expect(body).not.toContain(ol.id);
    expect(body).not.toContain(oi.id);
    expect(res.linked).toEqual([]);
    expect(res.ignored).toEqual([]);
    expect(other.getMatch(ol.id)).toMatchObject({ lastKnownWallosHash: null, lastKnownActualHash: null });
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

  it('pins the candidates output for a fixture', async () => {
    const t = setup(
      [sub(1, 'Netflix', '12.50'), sub(2, 'Spotify Premium', '10.00'), sub(3, 'Gym', '30.00'), sub(4, 'Disney Plus', '9.99')],
      [
        sched('a1', 'Netflix', -1260),
        sched('a2', 'Spotify', -1000),
        sched('a3', 'Gym', { num1: -2900, num2: -3100 }),
        sched('a4', 'Disney+ Plus', -999),
        sched('a5', 'Netflix Family', -1250),
      ],
    );
    const res = await runSyncCheck(t.deps, t.userId);
    expect(JSON.stringify(res.candidates)).toBe(PINNED_CANDIDATES);
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

describe('isCandidate', () => {
  const item = (id: string, name: string, amountCents: number | null, isRange = false) => ({ id, name, amountCents, isRange });

  it('needs both the name and the amount rule', () => {
    expect(isCandidate(item('1', 'Netflix', -1250), item('a', 'Netflix', -1260), 5)).toEqual({
      wallosId: '1',
      actualScheduleId: 'a',
      nameScore: 1,
      wallosName: 'Netflix',
      actualName: 'Netflix',
      wallosAmountCents: -1250,
      actualAmountCents: -1260,
      isRange: false,
    });
    expect(isCandidate(item('1', 'Netflix', -1250), item('a', 'Hulu', -1250), 5)).toBeNull();
    expect(isCandidate(item('1', 'Netflix', -1000), item('a', 'Netflix', -1100), 5)).toBeNull();
    expect(isCandidate(item('1', 'Netflix', -1000), item('a', 'Netflix', -1100), 10)).not.toBeNull();
  });

  it('rejects an item without an amount', () => {
    expect(isCandidate(item('1', 'Netflix', null), item('a', 'Netflix', -1250), 5)).toBeNull();
    expect(isCandidate(item('1', 'Netflix', -1250), item('a', 'Netflix', null), 5)).toBeNull();
  });
});

/**
 * #223 `overwrite_wallos_currency`: sets the Wallos subscription to the Actual budget currency and
 * the Actual amount in it. Mocked Wallos and Actual clients only, no network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { CreateDeps } from '../integrations/create.js';
import { WallosNetworkError, WallosRejectedError } from '../integrations/wallos/client.js';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn } from '../test/auth-helpers.js';
import { hashMatchFields } from './hash.js';
import { overwriteWallosCurrency } from './overwrite.js';
import { runSyncCheck } from './sync-check.js';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);
const SECRET = 'wallos-key-SENTINEL-9f3c';
const ACTION = 'overwrite_wallos_currency';

interface Currency {
  id: number;
  code: string;
  rate?: string;
}

const EUR: Currency = { id: 1, code: 'EUR', rate: '1' };
const USD: Currency = { id: 2, code: 'USD', rate: '1.1' };
const JPY: Currency = { id: 3, code: 'JPY', rate: '150' };

const fieldsOf = (cents: number, currency: string): MatchFieldsInput => ({
  name: 'Netflix',
  amount: { kind: 'single', cents },
  frequency: 'monthly',
  interval: 1,
  currency,
  startDate: '2026-01-01',
});

const open: { close(): Promise<unknown>; db?: AppDatabase }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    if (a.db) closeDatabase(a.db);
  }
});

interface SetupOptions {
  budget?: string;
  amount?: number;
  currencies?: Currency[];
  /** Wallos side overrides (e.g. a different cycle or name). */
  sub?: Record<string, unknown>;
  /** Actual schedule recurrence override (e.g. a different frequency). */
  schedule?: Record<string, unknown>;
}

/** A USD subscription paired with a schedule in a EUR (or `budget`) budget. Write fakes change `remote`. */
function setup(opts: SetupOptions = {}) {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  const remote = {
    subs: [
      {
        id: 7,
        name: 'Netflix',
        price: '15.00',
        currency_id: 2,
        cycle: 3,
        frequency: 1,
        next_payment: '2026-11-03',
        start_date: '2026-01-01',
        inactive: 0,
        notes: 'keep me',
        category_id: 4,
        ...opts.sub,
      } as Record<string, unknown>,
    ],
    amount: opts.amount ?? -1250,
    currencies: opts.currencies ?? [EUR, USD, JPY],
  };
  const holder: { repo?: ReturnType<typeof createUserRepo> } = {};
  const snapshotsAtWrite: number[] = [];
  const actualWrites = {
    updateSchedule: vi.fn(),
    createSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    sync: vi.fn(),
  };
  const wallosWrites = {
    createSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    updateSubscription: vi.fn(async (_u: string, id: string, f: Record<string, string>) => {
      snapshotsAtWrite.push(holder.repo?.listOverwriteSnapshots().length ?? -1);
      const sub = remote.subs.find((s) => String(s['id']) === id);
      if (sub === undefined) return;
      for (const [k, v] of Object.entries(f)) sub[k] = v;
    }),
  };
  const api = {
    getPreferences: async () => ({ defaultCurrencyCode: opts.budget ?? 'EUR' }),
    getSchedules: async () => [
      {
        id: 'sch-a',
        name: 'Netflix',
        amount: remote.amount,
        amountOp: 'is',
        date: { frequency: 'monthly', interval: 1, start: '2026-01-01', ...opts.schedule },
      },
    ],
    ...actualWrites,
  };
  const deps = {
    wallos: {
      listSubscriptions: async () => remote.subs.map((s) => ({ ...s })),
      listPaymentMethods: async () => [],
      listCategories: async () => [],
      listCurrencies: async () => remote.currencies.map((c) => ({ ...c })),
      ...wallosWrites,
    },
    repoFor: (id: string) => createUserRepo(t.db, id),
    withActual: (_id: string, use: (a: unknown) => Promise<unknown>) => use(api),
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
  holder.repo = repoA;
  const row = (status: 'LINKED' | 'MISMATCH_DETECTED', repo = repoA) =>
    repo.insertMatch({ wallosId: '7', actualScheduleId: 'sch-a', status, lastKnownWallosHash: H1, lastKnownActualHash: H2 });
  const noActualWrites = () => {
    for (const fn of Object.values(actualWrites)) expect(fn).not.toHaveBeenCalled();
  };
  const noWrites = () => {
    noActualWrites();
    for (const fn of Object.values(wallosWrites)) expect(fn).not.toHaveBeenCalled();
  };
  const unchanged = (id: string, repo = repoA) => {
    expect(repo.getMatch(id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1, lastKnownActualHash: H2 });
  };
  const resolve = (id: string, payload: Record<string, unknown>, as = signIn(ctx, a)) =>
    injectAs(app, as, { method: 'POST', url: `/api/matches/${encodeURIComponent(id)}/resolve`, payload });
  const check = (userId = a) =>
    runSyncCheck({ ...deps, now: () => Date.UTC(2030, 0, 1) }, userId);
  return {
    check, app, ctx, remote, deps, userA: a, userB: b, repoA, repoB, row, resolve, unchanged,
    wallosWrites, actualWrites, noWrites, noActualWrites, signInB: () => signIn(ctx, b),
    snapshotsAtWrite: () => snapshotsAtWrite,
  };
}

describe('overwrite_wallos_currency', () => {
  it('requires confirm: true and writes nothing without it', async () => {
    const s = setup();
    const m = s.row('MISMATCH_DETECTED');
    for (const payload of [{ action: ACTION }, { action: ACTION, confirm: 'true' }, { action: ACTION, confirm: false }]) {
      const res = await s.resolve(m.id, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'confirmation_required' });
    }
    s.unchanged(m.id);
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    s.noWrites();
  });

  it('sets the budget currency id and the Actual amount, snapshots first, stores server hashes', async () => {
    const s = setup();
    const m = s.row('MISMATCH_DETECTED');
    const res = await s.resolve(m.id, { action: ACTION, confirm: true, lastKnownWallosHash: 'c'.repeat(64), price: '1.00', currency_id: '2' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'LINKED' });
    expect(s.wallosWrites.updateSubscription).toHaveBeenCalledTimes(1);
    const [, id, fields] = s.wallosWrites.updateSubscription.mock.calls[0] ?? [];
    expect(id).toBe('7');
    expect(fields).toEqual({ next_payment: '2026-11-03', currency_id: '1', price: '12.50' });
    expect(s.snapshotsAtWrite()).toEqual([1]);
    const snaps = s.repoA.listOverwriteSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ matchId: m.id, target: 'wallos', targetId: '7' });
    expect(JSON.parse(snaps[0]?.valuesJson ?? '{}')).toMatchObject({ id: 7, price: '15.00', currency_id: 2 });
    const stored = s.repoA.getMatch(m.id);
    expect(stored?.status).toBe('LINKED');
    expect(stored?.lastKnownWallosHash).toBe(hashMatchFields(fieldsOf(-1250, 'EUR')));
    expect(stored?.lastKnownActualHash).toBe(hashMatchFields(fieldsOf(-1250, 'EUR')));
    expect(s.remote.subs[0]).toMatchObject({ notes: 'keep me', category_id: 4 });
    // A raw foreign-currency number never reaches Actual: this action makes no Actual write at all.
    s.noActualWrites();
  });

  it('writes the exact minor-unit price: one cent, and a 0-decimal budget currency', async () => {
    const cent = setup({ amount: -1 });
    const m1 = cent.row('MISMATCH_DETECTED');
    expect((await cent.resolve(m1.id, { action: ACTION, confirm: true })).statusCode).toBe(200);
    expect(cent.wallosWrites.updateSubscription.mock.calls[0]?.[2]).toMatchObject({ currency_id: '1', price: '0.01' });

    const jpy = setup({ budget: 'JPY', amount: -1500 });
    const m2 = jpy.row('MISMATCH_DETECTED');
    const res = await jpy.resolve(m2.id, { action: ACTION, confirm: true });
    expect(res.statusCode).toBe(200);
    expect(jpy.wallosWrites.updateSubscription.mock.calls[0]?.[2]).toEqual({ next_payment: '2026-11-03', currency_id: '3', price: '1500' });
    expect(jpy.repoA.getMatch(m2.id)?.lastKnownWallosHash).toBe(hashMatchFields(fieldsOf(-1500, 'JPY')));
    jpy.noActualWrites();
  });

  it('refuses with wallos_currency_missing when the budget currency is not in Wallos, writing nothing', async () => {
    const s = setup({ currencies: [USD, JPY] });
    const m = s.row('MISMATCH_DETECTED');
    const res = await s.resolve(m.id, { action: ACTION, confirm: true });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'wallos_currency_missing' });
    s.unchanged(m.id);
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    s.noWrites();
  });

  it('surfaces a missing Wallos rate as currency_conversion_failed and writes nothing', async () => {
    const s = setup({ currencies: [{ id: 1, code: 'EUR' }, USD] });
    const m = s.row('MISMATCH_DETECTED');
    const res = await s.resolve(m.id, { action: ACTION, confirm: true });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'currency_conversion_failed' });
    s.unchanged(m.id);
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    s.noWrites();
  });

  it('answers a typed error on a Wallos timeout or rejection and keeps the match status', async () => {
    const cases: [Error, number, string][] = [
      [new WallosNetworkError(), 502, 'wallos_unavailable'],
      [new WallosRejectedError('Invalid currency ID'), 502, 'wallos_rejected'],
    ];
    for (const [error, status, code] of cases) {
      const s = setup();
      const m = s.row('MISMATCH_DETECTED');
      s.wallosWrites.updateSubscription.mockRejectedValueOnce(error);
      const res = await s.resolve(m.id, { action: ACTION, confirm: true });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error: code });
      s.unchanged(m.id);
      expect(s.remote.subs[0]).toMatchObject({ price: '15.00', currency_id: 2 });
      // As for overwrite_wallos: the before-state snapshot written ahead of the failed write stays.
      expect(s.repoA.listOverwriteSnapshots()).toHaveLength(1);
      s.noActualWrites();
    }
  });

  it('puts no secret from an upstream error into the response or the thrown error', async () => {
    const s = setup();
    const m = s.row('MISMATCH_DETECTED');
    s.wallosWrites.updateSubscription.mockRejectedValueOnce(new Error(`upstream said api_key=${SECRET}`));
    const res = await s.resolve(m.id, { action: ACTION, confirm: true });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain(SECRET);
    expect(res.json()).toEqual({ error: 'internal_error' });

    const missing = setup({ currencies: [USD] });
    const m2 = missing.row('MISMATCH_DETECTED');
    const err: unknown = await overwriteWallosCurrency(missing.deps, missing.userA, m2, new Date()).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'wallos_currency_missing' });
    expect((err as Error).message).not.toMatch(/key|password|USD|EUR|Netflix/i);
  });

  it('answers no_change_needed and writes nothing when Wallos already has the budget currency and amount', async () => {
    const s = setup();
    s.remote.subs[0] = { ...s.remote.subs[0], currency_id: 1, price: '12.50' };
    const m = s.row('MISMATCH_DETECTED');
    const res = await s.resolve(m.id, { action: ACTION, confirm: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'MISMATCH_DETECTED', outcome: 'no_change_needed' });
    s.unchanged(m.id);
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    s.noWrites();
  });

  it('refuses a LINKED match with invalid_state, also on a stale caller row', async () => {
    const s = setup();
    const m = s.row('LINKED');
    const res = await s.resolve(m.id, { action: ACTION, confirm: true });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_state' });
    const stale = { ...m, status: 'MISMATCH_DETECTED' as const };
    await expect(overwriteWallosCurrency(s.deps, s.userA, stale, new Date())).rejects.toMatchObject({ code: 'invalid_state' });
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    s.noWrites();
  });

  it("isolates users: B gets 404 on A's match, A's match, snapshots and override stay untouched", async () => {
    const s = setup();
    const ma = s.row('MISMATCH_DETECTED');
    s.repoA.upsertSubscriptionOverride('7', { rate: '1.2', now: new Date('2026-11-01T00:00:00Z') });
    const res = await s.resolve(ma.id, { action: ACTION, confirm: true }, s.signInB());
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'match_not_found' });
    expect(s.repoB.getMatch(ma.id)).toBeUndefined();
    s.unchanged(ma.id);
    expect(s.repoA.getSubscriptionOverride('7')?.rate).toBe('1.2');
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    expect(s.repoB.listOverwriteSnapshots()).toEqual([]);
    s.noWrites();
  });

  it("updates only the acting user's row when both users hold the same pair", async () => {
    const s = setup();
    const ma = s.row('MISMATCH_DETECTED', s.repoA);
    const mb = s.row('MISMATCH_DETECTED', s.repoB);
    expect(await overwriteWallosCurrency(s.deps, s.userA, ma, new Date())).toBe('written');
    expect(s.repoA.getMatch(ma.id)?.status).toBe('LINKED');
    s.unchanged(mb.id, s.repoB);
    expect(s.repoA.listOverwriteSnapshots()).toHaveLength(1);
    expect(s.repoB.listOverwriteSnapshots()).toEqual([]);
  });

  it('stays LINKED on the real next sync check and keeps the override row', async () => {
    const s = setup();
    const m = s.row('MISMATCH_DETECTED');
    s.repoA.upsertSubscriptionOverride('7', { rate: '1.2', now: new Date('2026-11-01T00:00:00Z') });
    expect(await overwriteWallosCurrency(s.deps, s.userA, m, new Date())).toBe('written');
    const result = await s.check();
    expect(result.mismatches).toEqual([]);
    expect(s.repoA.getMatch(m.id)?.status).toBe('LINKED');
    expect(s.repoA.getSubscriptionOverride('7')?.rate).toBe('1.2');
  });

  it('with a Wallos main currency other than the budget currency: right id and price, next check LINKED', async () => {
    // Wallos main USD (rate 1), EUR rate 0.92; budget EUR.
    const s = setup({ currencies: [{ id: 1, code: 'EUR', rate: '0.92' }, { id: 2, code: 'USD', rate: '1' }, JPY] });
    const m = s.row('MISMATCH_DETECTED');
    expect(await overwriteWallosCurrency(s.deps, s.userA, m, new Date())).toBe('written');
    expect(s.wallosWrites.updateSubscription.mock.calls[0]?.[2]).toEqual({ next_payment: '2026-11-03', currency_id: '1', price: '12.50' });
    expect((await s.check()).mismatches).toEqual([]);
    expect(s.repoA.getMatch(m.id)?.status).toBe('LINKED');
  });

  it('a double submit writes once: concurrent calls and a later call give invalid_state', async () => {
    const s = setup();
    const m = s.row('MISMATCH_DETECTED');
    const results = await Promise.allSettled([
      overwriteWallosCurrency(s.deps, s.userA, m, new Date()),
      overwriteWallosCurrency(s.deps, s.userA, m, new Date()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'invalid_state' } });
    expect(s.wallosWrites.updateSubscription).toHaveBeenCalledTimes(1);
    expect(s.repoA.listOverwriteSnapshots()).toHaveLength(1);
    const again = await s.resolve(m.id, { action: ACTION, confirm: true });
    expect(again.statusCode).toBe(400);
    expect(again.json()).toEqual({ error: 'invalid_state' });
    await expect(overwriteWallosCurrency(s.deps, s.userA, m, new Date())).rejects.toMatchObject({ code: 'invalid_state' });
    expect(s.wallosWrites.updateSubscription).toHaveBeenCalledTimes(1);
  });

  describe('another compared field also differs', () => {
    const variants: [string, SetupOptions, string][] = [
      ['frequency', { schedule: { frequency: 'yearly' } }, 'frequency'],
      ['name', { sub: { name: 'Netflix Premium' } }, 'name'],
    ];
    for (const [label, opts, field] of variants) {
      it(`writes currency and price only, stays MISMATCH_DETECTED, and the next check still reports ${label}`, async () => {
        const s = setup(opts);
        const m = s.row('MISMATCH_DETECTED');
        const res = await s.resolve(m.id, { action: ACTION, confirm: true });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: 'MISMATCH_DETECTED', outcome: 'currency_changed_other_fields_differ' });
        expect(s.wallosWrites.updateSubscription.mock.calls[0]?.[2]).toEqual({ next_payment: '2026-11-03', currency_id: '1', price: '12.50' });
        s.noActualWrites();
        const stored = s.repoA.getMatch(m.id);
        expect(stored?.status).toBe('MISMATCH_DETECTED');
        expect(stored?.lastKnownActualHash).toBe(H2);
        expect(stored?.lastKnownWallosHash).not.toBe(H1);
        for (let i = 0; i < 2; i++) {
          const check = await s.check();
          expect(check.mismatches).toHaveLength(1);
          const mm = check.mismatches[0];
          const differing = (['amount', 'currency', 'frequency', 'interval', 'startDate'] as const).filter(
            (k) => JSON.stringify(mm?.wallosFields[k]) !== JSON.stringify(mm?.actualFields[k]),
          );
          if (field === 'frequency') expect(differing).toEqual(['frequency']);
          else expect(differing).toEqual([]);
          if (field === 'name') expect(mm?.wallosName).not.toBe(mm?.actualName);
          expect(s.repoA.getMatch(m.id)?.status).toBe('MISMATCH_DETECTED');
        }
      });
    }

    it('returns to LINKED on the next check once the other field is fixed in Wallos', async () => {
      // Proves the Wallos-side case only: the Actual hash H2 is a placeholder baseline, so it is re-baselined by hand
      // to the real Actual fields to state "Actual never drifted". The case where Actual drifted too follows below.
      const s = setup({ sub: { name: 'Netflix Premium' } });
      const m = s.row('MISMATCH_DETECTED');
      await overwriteWallosCurrency(s.deps, s.userA, m, new Date());
      s.remote.subs[0] = { ...s.remote.subs[0], name: 'Netflix' };
      s.repoA.updateMatch(m.id, { lastKnownActualHash: hashMatchFields(fieldsOf(-1250, 'EUR')) });
      expect((await s.check()).mismatches).toEqual([]);
      expect(s.repoA.getMatch(m.id)?.status).toBe('LINKED');
    });

    it('(d) the user edits the differing field in Actual instead: the pair stays MISMATCH_DETECTED with both drift flags set', async () => {
      const schedule: Record<string, unknown> = { frequency: 'yearly' };
      const s = setup({ schedule });
      const m = s.row('MISMATCH_DETECTED');
      await overwriteWallosCurrency(s.deps, s.userA, m, new Date());
      // Fix the frequency in Actual: it now matches Wallos, but Actual moved away from its stored hash H2.
      schedule.frequency = 'monthly';
      const check = await s.check();
      expect(check.mismatches).toHaveLength(1);
      expect(check.mismatches[0]).toMatchObject({ wallosDrift: true, actualDrift: true });
      expect(s.repoA.getMatch(m.id)?.status).toBe('MISMATCH_DETECTED');
    });

    it('Actual had also drifted before the action and only the Wallos field is fixed: the pair does not return to LINKED silently', async () => {
      // H2 stays the placeholder baseline (Actual differs from it), as for any pair whose Actual side drifted.
      const s = setup({ sub: { name: 'Netflix Premium' } });
      const m = s.row('MISMATCH_DETECTED');
      await overwriteWallosCurrency(s.deps, s.userA, m, new Date());
      s.remote.subs[0] = { ...s.remote.subs[0], name: 'Netflix' };
      const check = await s.check();
      expect(check.mismatches).toHaveLength(1);
      expect(check.mismatches[0]).toMatchObject({ actualDrift: true });
      expect(s.repoA.getMatch(m.id)?.status).toBe('MISMATCH_DETECTED');
    });
  });

  it('treats a subscription on an earlier duplicate id of the budget code as already in that currency', async () => {
    const dup: Currency[] = [{ id: 5, code: 'eur ', rate: '1' }, EUR, USD];
    const s = setup({ currencies: dup, sub: { currency_id: 5, price: '15.00' } });
    const m = s.row('MISMATCH_DETECTED');
    expect(await overwriteWallosCurrency(s.deps, s.userA, m, new Date())).toBe('written');
    // Price is rewritten, the currency id is not.
    expect(s.wallosWrites.updateSubscription.mock.calls[0]?.[2]).toEqual({ next_payment: '2026-11-03', price: '12.50' });

    const same = setup({ currencies: dup, sub: { currency_id: 5, price: '12.50' } });
    const m2 = same.row('MISMATCH_DETECTED');
    expect(await overwriteWallosCurrency(same.deps, same.userA, m2, new Date())).toBe('no_change_needed');
    same.noWrites();
  });
});

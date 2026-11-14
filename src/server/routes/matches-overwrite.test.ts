import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { CreateDeps } from '../integrations/create.js';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { hashMatchFields } from '../matching/hash.js';
import { overwriteActual, overwriteWallos } from '../matching/overwrite.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn } from '../test/auth-helpers.js';

const H1 = 'a'.repeat(64);
const H2 = 'b'.repeat(64);

interface FakeSched {
  id: string;
  name: string;
  amount: number;
  amountOp?: string;
  date?: Record<string, unknown>;
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

/** Mocked clients only. The write fakes change `remote`, so the re-read sees the result. */
function setup() {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
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
        notes: 'keep me',
        category_id: 4,
      },
    ],
    schedules: [{ id: 'sch-a', name: 'Netflix', amount: -1250 }],
  };
  const snapshotsAtWrite: number[] = [];
  const holder: { repo?: ReturnType<typeof createUserRepo> } = {};
  const writes = {
    createSubscription: vi.fn(),
    createSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    deleteSubscription: vi.fn(),
    sync: vi.fn(),
    updateSubscription: vi.fn(async (_u: string, id: string, f: Record<string, string>) => {
      snapshotsAtWrite.push(holder.repo?.listOverwriteSnapshots().length ?? -1);
      const sub = remote.subs.find((s) => String(s['id']) === id);
      if (sub === undefined) return;
      for (const [k, v] of Object.entries(f)) sub[k] = v;
    }),
    updateSchedule: vi.fn(async (id: string, f: Record<string, unknown>) => {
      snapshotsAtWrite.push(holder.repo?.listOverwriteSnapshots().length ?? -1);
      const s = remote.schedules.find((x) => x.id === id);
      if (s === undefined) return id;
      if (f['name'] !== undefined) s.name = f['name'] as string;
      if (f['amount'] !== undefined) s.amount = f['amount'] as number;
      if (f['date'] !== undefined) s.date = f['date'] as Record<string, unknown>;
      return id;
    }),
  };
  const api = {
    getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
    getSchedules: async () =>
      remote.schedules.map((x) => ({
        id: x.id,
        name: x.name,
        amount: x.amount,
        amountOp: x.amountOp ?? 'is',
        date: x.date ?? { frequency: 'monthly', interval: 1, start: '2026-01-01' },
      })),
    updateSchedule: writes.updateSchedule,
    sync: writes.sync,
    createSchedule: writes.createSchedule,
    deleteSchedule: writes.deleteSchedule,
  };
  const deps = {
    wallos: {
      listSubscriptions: async () => remote.subs.map((s) => ({ ...s })),
      listPaymentMethods: async () => [],
      listCategories: async () => [],
      listCurrencies: async () => [{ id: 1, code: 'EUR', rate: '1' }],
      createSubscription: writes.createSubscription,
      updateSubscription: writes.updateSubscription,
      deleteSubscription: writes.deleteSubscription,
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
  const noWrites = () => {
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
  };
  return {
    app, sa: signIn(ctx, a), sb: signIn(ctx, b), remote, writes, repoA, repoB, row, noWrites, deps, userA: a,
    snapshotsAtWrite: () => snapshotsAtWrite,
  };
}

const url = (id: string) => `/api/matches/${encodeURIComponent(id)}/resolve`;
const ACTIONS = ['overwrite_wallos', 'overwrite_actual'] as const;

describe('POST /api/matches/:id/resolve overwrite actions', () => {
  it('requires confirm: true and writes nothing without it', async () => {
    for (const action of ACTIONS) {
      const { app, sa, row, repoA, noWrites } = setup();
      const m = row('MISMATCH_DETECTED');
      for (const payload of [{ action }, { action, confirm: 'true' }, { action, confirm: false }]) {
        const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'confirmation_required' });
      }
      expect(repoA.getMatch(m.id)?.status).toBe('MISMATCH_DETECTED');
      expect(repoA.listOverwriteSnapshots()).toEqual([]);
      noWrites();
    }
  });

  it('refuses a LINKED match with invalid_state and writes nothing', async () => {
    for (const action of ACTIONS) {
      const { app, sa, row, repoA, noWrites } = setup();
      const m = row('LINKED');
      const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action, confirm: true } });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_state' });
      expect(repoA.listOverwriteSnapshots()).toEqual([]);
      noWrites();
    }
  });

  it('overwrite_wallos snapshots first, sends id and only changed fields, then re-reads and stores hashes', async () => {
    const { app, sa, remote, writes, repoA, row, snapshotsAtWrite } = setup();
    const m = row('MISMATCH_DETECTED');
    remote.schedules[0] = { id: 'sch-a', name: 'Netflix', amount: -1499 };
    const res = await injectAs(app, sa, {
      method: 'POST',
      url: url(m.id),
      payload: { action: 'overwrite_wallos', confirm: true, lastKnownWallosHash: 'c'.repeat(64), price: '1.00' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'LINKED' });
    expect(writes.updateSubscription).toHaveBeenCalledTimes(1);
    const [, id, fields] = writes.updateSubscription.mock.calls[0] ?? [];
    expect(id).toBe('7');
    expect(fields).toEqual({ next_payment: '2026-11-03', price: '14.99' });
    expect(writes.updateSchedule).not.toHaveBeenCalled();
    expect(snapshotsAtWrite()).toEqual([1]);
    const snaps = repoA.listOverwriteSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ matchId: m.id, target: 'wallos', targetId: '7' });
    expect(JSON.parse(snaps[0]?.valuesJson ?? '{}')).toMatchObject({ id: 7, price: '12.50', notes: 'keep me' });
    const stored = repoA.getMatch(m.id);
    expect(stored?.status).toBe('LINKED');
    expect(stored?.lastKnownWallosHash).toBe(hashMatchFields(fieldsOf('Netflix', -1499)));
    expect(stored?.lastKnownActualHash).toBe(hashMatchFields(fieldsOf('Netflix', -1499)));
    expect(stored?.lastKnownWallosHash).not.toBe('c'.repeat(64));
    expect(remote.subs[0]).toMatchObject({ notes: 'keep me', category_id: 4 });
  });

  it('overwrite_actual snapshots first, updates only changed fields, syncs, then re-reads and stores hashes', async () => {
    const { app, sa, remote, writes, repoA, row, snapshotsAtWrite } = setup();
    const m = row('MISMATCH_DETECTED');
    remote.schedules[0] = { id: 'sch-a', name: 'Netflix', amount: -999 };
    const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action: 'overwrite_actual', confirm: true } });
    expect(res.statusCode).toBe(200);
    expect(writes.updateSchedule).toHaveBeenCalledTimes(1);
    expect(writes.updateSchedule).toHaveBeenCalledWith('sch-a', { amount: -1250 });
    expect(writes.sync).toHaveBeenCalledTimes(1);
    expect(writes.updateSubscription).not.toHaveBeenCalled();
    expect(snapshotsAtWrite()).toEqual([1]);
    const snaps = repoA.listOverwriteSnapshots();
    expect(snaps[0]).toMatchObject({ matchId: m.id, target: 'actual', targetId: 'sch-a' });
    expect(JSON.parse(snaps[0]?.valuesJson ?? '{}')).toMatchObject({ id: 'sch-a', amount: -999 });
    const stored = repoA.getMatch(m.id);
    expect(stored?.status).toBe('LINKED');
    expect(stored?.lastKnownActualHash).toBe(hashMatchFields(fieldsOf('Netflix', -1250)));
    expect(stored?.lastKnownWallosHash).toBe(hashMatchFields(fieldsOf('Netflix', -1250)));
  });

  it('refuses range and pattern schedules for both actions and writes nothing', async () => {
    const cases: [FakeSched, string][] = [
      [{ id: 'sch-a', name: 'Netflix', amount: -1250, amountOp: 'isbetween' }, 'range_amount_unsupported'],
      [
        { id: 'sch-a', name: 'Netflix', amount: -1250, date: { frequency: 'monthly', start: '2026-01-01', patterns: [{ type: 'day', value: 1 }] } },
        'patterns_unsupported',
      ],
    ];
    for (const action of ACTIONS) {
      for (const [sched, code] of cases) {
        const { app, sa, remote, row, repoA, noWrites } = setup();
        const m = row('MISMATCH_DETECTED');
        remote.schedules[0] = sched;
        const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action, confirm: true } });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: code });
        expect(repoA.getMatch(m.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1, lastKnownActualHash: H2 });
        expect(repoA.listOverwriteSnapshots()).toEqual([]);
        noWrites();
      }
    }
  });

  it("answers 404 match_not_found for another user's match with zero write calls", async () => {
    for (const action of ACTIONS) {
      const { app, sa, row, repoA, repoB, noWrites } = setup();
      const mb = row('MISMATCH_DETECTED', repoB);
      const res = await injectAs(app, sa, { method: 'POST', url: url(mb.id), payload: { action, confirm: true } });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'match_not_found' });
      expect(repoB.getMatch(mb.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1 });
      expect(repoA.listOverwriteSnapshots()).toEqual([]);
      expect(repoB.listOverwriteSnapshots()).toEqual([]);
      noWrites();
    }
  });

  it('two users with the same pair each update only their own row and snapshot', async () => {
    const { app, sa, sb, remote, repoA, repoB, row } = setup();
    const ma = row('MISMATCH_DETECTED', repoA);
    const mb = row('MISMATCH_DETECTED', repoB);
    remote.schedules[0] = { id: 'sch-a', name: 'Netflix', amount: -999 };
    const res = await injectAs(app, sa, { method: 'POST', url: url(ma.id), payload: { action: 'overwrite_actual', confirm: true } });
    expect(res.statusCode).toBe(200);
    expect(repoA.getMatch(ma.id)?.status).toBe('LINKED');
    expect(repoB.getMatch(mb.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1, lastKnownActualHash: H2 });
    expect(repoA.listOverwriteSnapshots()).toHaveLength(1);
    expect(repoB.listOverwriteSnapshots()).toEqual([]);
    const resB = await injectAs(app, sb, { method: 'POST', url: url(mb.id), payload: { action: 'overwrite_actual', confirm: true } });
    expect(resB.statusCode).toBe(200);
    // The shared fake remote was already fixed by A's write, so B has nothing to change.
    expect(resB.json()).toEqual({ status: 'MISMATCH_DETECTED', outcome: 'no_change_needed' });
    expect(repoB.getMatch(mb.id)?.status).toBe('MISMATCH_DETECTED');
    expect(repoA.listOverwriteSnapshots()).toHaveLength(1);
    expect(repoB.listOverwriteSnapshots()).toHaveLength(0);
  });

  it('refuses a second overwrite with invalid_state, no second snapshot and no second write', async () => {
    for (const action of ACTIONS) {
      const { app, sa, remote, writes, repoA, row } = setup();
      const m = row('MISMATCH_DETECTED');
      remote.schedules[0] = { id: 'sch-a', name: 'Netflix', amount: action === 'overwrite_actual' ? -999 : -1499 };
      const payload = { action, confirm: true };
      const first = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload });
      expect(first.statusCode).toBe(200);
      const second = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload });
      expect(second.statusCode).toBe(400);
      expect(second.json()).toEqual({ error: 'invalid_state' });
      expect(repoA.listOverwriteSnapshots()).toHaveLength(1);
      expect(writes.updateSubscription.mock.calls.length + writes.updateSchedule.mock.calls.length).toBe(1);
    }
  });

  it('re-checks the status right before the snapshot when the caller holds a stale row', async () => {
    for (const run of [overwriteWallos, overwriteActual]) {
      const { remote, writes, repoA, row, deps, userA } = setup();
      const m = row('MISMATCH_DETECTED');
      remote.schedules[0] = { id: 'sch-a', name: 'Netflix', amount: -999 };
      repoA.updateMatch(m.id, { status: 'LINKED' });
      await expect(run(deps, userA, m, new Date())).rejects.toMatchObject({ code: 'invalid_state' });
      expect(repoA.listOverwriteSnapshots()).toEqual([]);
      expect(writes.updateSubscription).not.toHaveBeenCalled();
      expect(writes.updateSchedule).not.toHaveBeenCalled();
    }
  });

  it('answers no_change_needed, writes nothing and keeps MISMATCH_DETECTED when nothing differs', async () => {
    for (const action of ACTIONS) {
      const { app, sa, writes, repoA, row, noWrites } = setup();
      const m = row('MISMATCH_DETECTED');
      const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action, confirm: true } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'MISMATCH_DETECTED', outcome: 'no_change_needed' });
      expect(repoA.getMatch(m.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1, lastKnownActualHash: H2 });
      expect(repoA.listOverwriteSnapshots()).toEqual([]);
      expect(writes.updateSubscription).not.toHaveBeenCalled();
      noWrites();
    }
  });

  it('passes resetNextDate true to updateSchedule only when the start date or frequency changed', async () => {
    const dated = setup();
    const m1 = dated.row('MISMATCH_DETECTED');
    dated.remote.schedules[0] = {
      id: 'sch-a',
      name: 'Netflix',
      amount: -1250,
      date: { frequency: 'monthly', interval: 1, start: '2026-02-01' },
    };
    const r1 = await injectAs(dated.app, dated.sa, { method: 'POST', url: url(m1.id), payload: { action: 'overwrite_actual', confirm: true } });
    expect(r1.statusCode).toBe(200);
    const call1 = dated.writes.updateSchedule.mock.calls[0] as unknown[];
    expect(call1[0]).toBe('sch-a');
    expect(call1[2]).toBe(true);

    const plain = setup();
    const m2 = plain.row('MISMATCH_DETECTED');
    plain.remote.schedules[0] = { id: 'sch-a', name: 'Netflix', amount: -999 };
    const r2 = await injectAs(plain.app, plain.sa, { method: 'POST', url: url(m2.id), payload: { action: 'overwrite_actual', confirm: true } });
    expect(r2.statusCode).toBe(200);
    const call2 = plain.writes.updateSchedule.mock.calls[0] as unknown[];
    expect(call2[2] === undefined || call2[2] === false).toBe(true);
  });

  it('stores no api_key or password in the snapshot', async () => {
    for (const action of ACTIONS) {
      const { app, sa, remote, repoA, row } = setup();
      const m = row('MISMATCH_DETECTED');
      remote.schedules[0] = { id: 'sch-a', name: 'Netflix', amount: -999 };
      remote.schedules[0] = { id: 'sch-a', name: 'Netflix', amount: action === 'overwrite_actual' ? -999 : -1499 };
      const res = await injectAs(app, sa, { method: 'POST', url: url(m.id), payload: { action, confirm: true } });
      expect(res.statusCode).toBe(200);
      const json = (repoA.listOverwriteSnapshots()[0]?.valuesJson ?? '').toLowerCase();
      expect(json).not.toBe('');
      expect(json).not.toContain('api_key');
      expect(json).not.toContain('apikey');
      expect(json).not.toContain('password');
    }
  });
});

/**
 * #223 `overwrite_wallos_currency` through the real app: session, CSRF and Origin checks, the
 * per-user match lookup, and the response bodies. Mocked Wallos and Actual clients only.
 */
describe('POST /api/matches/:id/resolve overwrite_wallos_currency (HTTP)', () => {
  const ACTION = 'overwrite_wallos_currency';
  const WALLOS_KEY = 'wallos-api-key-SENTINEL-1a2b';
  const ACTUAL_PW = 'actual-password-SENTINEL-3c4d';
  const SYNC_KEY = 'sync-key-SENTINEL-5e6f';

  function currencySetup(currencies = [{ id: 1, code: 'EUR', rate: '1' }, { id: 2, code: 'USD', rate: '1.1' }]) {
    const t = makeAuthApp({ mailer: createCapturingMailer() });
    const remote = {
      subs: [
        {
          id: 7, name: 'Netflix', price: '15.00', currency_id: 2, cycle: 3, frequency: 1,
          next_payment: '2026-11-03', start_date: '2026-01-01', inactive: 0, notes: 'keep me',
        } as Record<string, unknown>,
      ],
    };
    /** Every outside call, with the user id it was made for. */
    const calls: { fn: string; userId: string }[] = [];
    const updateSubscription = vi.fn(async (u: string, id: string, f: Record<string, string>) => {
      calls.push({ fn: 'updateSubscription', userId: u });
      const sub = remote.subs.find((s) => String(s['id']) === id);
      if (sub !== undefined) Object.assign(sub, f);
    });
    const updateSchedule = vi.fn();
    const api = {
      getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
      getSchedules: async () => [
        { id: 'sch-a', name: 'Netflix', amount: -1250, amountOp: 'is', date: { frequency: 'monthly', interval: 1, start: '2026-01-01' } },
      ],
      updateSchedule,
      createSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
      sync: vi.fn(),
    };
    const deps = {
      wallos: {
        listSubscriptions: async (u: string) => {
          calls.push({ fn: 'listSubscriptions', userId: u });
          return remote.subs.map((s) => ({ ...s }));
        },
        listPaymentMethods: async () => [],
        listCategories: async () => [],
        listCurrencies: async (u: string) => {
          calls.push({ fn: 'listCurrencies', userId: u });
          return currencies.map((c) => ({ ...c }));
        },
        updateSubscription,
        createSubscription: vi.fn(),
        deleteSubscription: vi.fn(),
      },
      repoFor: (id: string) => createUserRepo(t.db, id),
      withActual: (u: string, use: (a: unknown) => Promise<unknown>) => {
        calls.push({ fn: 'withActual', userId: u });
        return use(api);
      },
    } as unknown as CreateDeps;
    const logs: string[] = [];
    const logStream = new Writable({
      write(chunk: Buffer, _enc, done) {
        logs.push(chunk.toString());
        done();
      },
    });
    const app = buildApp({
      db: t.db,
      integrations: deps,
      logger: { stream: logStream },
      auth: { mode: 'local', secureCookies: false, allowRegistration: false, publicOrigin: t.publicOrigin, now: () => t.clock.now() },
    });
    open.push({ close: () => app.close(), db: t.db });
    void t.app.close();
    const a = makeUser(t.db);
    const b = makeUser(t.db);
    const ctx = { db: t.db, clock: t.clock };
    const repoA = createUserRepo(t.db, a);
    const repoB = createUserRepo(t.db, b);
    repoA.upsertConfig({ wallosUrl: 'https://wallos.example.test', wallosApiKeyEnc: WALLOS_KEY, actualPasswordEnc: ACTUAL_PW, actualSyncKeyEnc: SYNC_KEY });
    const row = (repo = repoA, status: 'LINKED' | 'MISMATCH_DETECTED' = 'MISMATCH_DETECTED') =>
      repo.insertMatch({ wallosId: '7', actualScheduleId: 'sch-a', status, lastKnownWallosHash: H1, lastKnownActualHash: H2 });
    const noOutsideWrites = () => {
      expect(updateSubscription).not.toHaveBeenCalled();
      expect(updateSchedule).not.toHaveBeenCalled();
      expect(api.createSchedule).not.toHaveBeenCalled();
      expect(api.sync).not.toHaveBeenCalled();
    };
    return { app, logs, remote, calls, updateSubscription, updateSchedule, repoA, repoB, row, noOutsideWrites, sa: signIn(ctx, a), sb: signIn(ctx, b), userA: a };
  }

  it('without confirm: true answers 400 confirmation_required with no Wallos call, no snapshot, match unchanged', async () => {
    const s = currencySetup();
    const m = s.row();
    for (const payload of [{ action: ACTION }, { action: ACTION, confirm: 'true' }, { action: ACTION, confirm: false }, { action: ACTION, confirm: 1 }]) {
      const res = await injectAs(s.app, s.sa, { method: 'POST', url: url(m.id), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'confirmation_required' });
    }
    expect(s.calls).toEqual([]);
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    expect(s.repoA.getMatch(m.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1, lastKnownActualHash: H2 });
    s.noOutsideWrites();
  });

  it('answers 401 without a session and csrf_failed without the CSRF header or with a foreign Origin, calling nothing', async () => {
    const s = currencySetup();
    const m = s.row();
    const payload = { action: ACTION, confirm: true };
    const anon = await s.app.inject({ method: 'POST', url: url(m.id), payload, headers: { origin: 'http://localhost:3000' } });
    expect(anon.statusCode).toBe(401);
    const noCsrf = await s.app.inject({
      method: 'POST', url: url(m.id), payload, headers: { origin: 'http://localhost:3000', cookie: s.sa.cookie },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(noCsrf.json()).toEqual({ error: 'csrf_failed' });
    const badCsrf = await injectAs(s.app, s.sa, { method: 'POST', url: url(m.id), payload, headers: { 'x-csrf-token': 'nope' } });
    expect(badCsrf.statusCode).toBe(403);
    expect(badCsrf.json()).toEqual({ error: 'csrf_failed' });
    const evil = await injectAs(s.app, s.sa, { method: 'POST', url: url(m.id), payload, headers: { origin: 'http://evil.example' } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json()).toEqual({ error: 'csrf_failed' });
    expect(s.calls).toEqual([]);
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    expect(s.repoA.getMatch(m.id)?.status).toBe('MISMATCH_DETECTED');
  });

  it("answers 404 match_not_found for B on A's match: no call with A's credentials, A's rows untouched", async () => {
    const s = currencySetup();
    const ma = s.row();
    s.repoA.upsertSubscriptionOverride('7', { rate: '1.2', now: new Date('2026-11-01T00:00:00Z') });
    const overrideBefore = s.repoA.getSubscriptionOverride('7');
    for (const confirm of [true, undefined]) {
      const res = await injectAs(s.app, s.sb, {
        method: 'POST', url: url(ma.id), payload: { action: ACTION, ...(confirm === undefined ? {} : { confirm }) },
      });
      // Without confirm the 400 comes first; with it the lookup is scoped to B and finds nothing.
      expect(res.statusCode).toBe(confirm === true ? 404 : 400);
      if (confirm === true) expect(res.json()).toEqual({ error: 'match_not_found' });
    }
    expect(s.calls).toEqual([]);
    expect(s.calls.filter((c) => c.userId === s.userA)).toEqual([]);
    expect(s.repoA.getMatch(ma.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1, lastKnownActualHash: H2 });
    expect(s.repoA.getSubscriptionOverride('7')).toEqual(overrideBefore);
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    expect(s.repoB.listOverwriteSnapshots()).toEqual([]);
    s.noOutsideWrites();
  });

  it('answers 400 wallos_currency_missing end to end and writes nothing', async () => {
    const s = currencySetup([{ id: 2, code: 'USD', rate: '1.1' }]);
    const m = s.row();
    const res = await injectAs(s.app, s.sa, { method: 'POST', url: url(m.id), payload: { action: ACTION, confirm: true } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'wallos_currency_missing' });
    expect(s.repoA.getMatch(m.id)).toMatchObject({ status: 'MISMATCH_DETECTED', lastKnownWallosHash: H1, lastKnownActualHash: H2 });
    expect(s.repoA.listOverwriteSnapshots()).toEqual([]);
    expect(s.remote.subs[0]).toMatchObject({ price: '15.00', currency_id: 2 });
    s.noOutsideWrites();
  });

  it('returns 200 LINKED and stores server-computed hashes, ignoring client-sent hash fields', async () => {
    const s = currencySetup();
    const m = s.row();
    const res = await injectAs(s.app, s.sa, {
      method: 'POST',
      url: url(m.id),
      payload: {
        action: ACTION, confirm: true, lastKnownWallosHash: 'c'.repeat(64), lastKnownActualHash: 'd'.repeat(64),
        status: 'IGNORED_WALLOS', currency_id: '2', price: '1.00',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'LINKED' });
    const expected = hashMatchFields({
      name: 'Netflix', amount: { kind: 'single', cents: -1250 }, frequency: 'monthly', interval: 1, currency: 'EUR', startDate: '2026-01-01',
    });
    expect(s.repoA.getMatch(m.id)).toMatchObject({ status: 'LINKED', lastKnownWallosHash: expected, lastKnownActualHash: expected });
    expect(s.updateSubscription.mock.calls[0]?.[2]).toEqual({ next_payment: '2026-11-03', currency_id: '1', price: '12.50' });
    expect(s.repoA.listOverwriteSnapshots()).toHaveLength(1);
    expect(s.calls.every((c) => c.userId === s.userA)).toBe(true);
    expect(s.updateSubscription).toHaveBeenCalledTimes(1);
    expect(s.updateSchedule).not.toHaveBeenCalled();
  });

  it('answers 200 MISMATCH_DETECTED with outcome currency_changed_other_fields_differ when the name also differs', async () => {
    const s = currencySetup();
    s.remote.subs[0] = { ...s.remote.subs[0], name: 'Netflix Premium' };
    const m = s.row();
    const res = await injectAs(s.app, s.sa, { method: 'POST', url: url(m.id), payload: { action: ACTION, confirm: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'MISMATCH_DETECTED', outcome: 'currency_changed_other_fields_differ' });
    expect(s.updateSubscription).toHaveBeenCalledTimes(1);
    expect(s.updateSubscription.mock.calls[0]?.[2]).toEqual({ next_payment: '2026-11-03', currency_id: '1', price: '12.50' });
    expect(s.updateSchedule).not.toHaveBeenCalled();
    const stored = s.repoA.getMatch(m.id);
    expect(stored?.status).toBe('MISMATCH_DETECTED');
    expect(stored?.lastKnownActualHash).toBe(H2);
    expect(s.repoA.listOverwriteSnapshots()).toHaveLength(1);
  });

  it('puts no secret, session token or CSRF token in any response body or log line', async () => {
    const secrets = (s: ReturnType<typeof currencySetup>) => [WALLOS_KEY, ACTUAL_PW, SYNC_KEY, s.sa.token, s.sa.csrfToken, s.sb.token, s.sb.csrfToken];
    const bodies: [ReturnType<typeof currencySetup>, string][] = [];
    const run = async (s: ReturnType<typeof currencySetup>, payload: object, id: string, as = s.sa) => {
      const res = await injectAs(s.app, as, { method: 'POST', url: url(id), payload });
      bodies.push([s, res.body + JSON.stringify(res.headers) + s.logs.join('')]);
      return res;
    };
    const ok = currencySetup();
    expect((await run(ok, { action: ACTION, confirm: true }, ok.row().id)).statusCode).toBe(200);
    const missing = currencySetup([{ id: 2, code: 'USD', rate: '1.1' }]);
    expect((await run(missing, { action: ACTION, confirm: true }, missing.row().id)).statusCode).toBe(400);
    const noRate = currencySetup([{ id: 1, code: 'EUR' } as never, { id: 2, code: 'USD', rate: '1.1' }]);
    expect((await run(noRate, { action: ACTION, confirm: true }, noRate.row().id)).json()).toEqual({ error: 'currency_conversion_failed' });
    const other = currencySetup();
    expect((await run(other, { action: ACTION, confirm: true }, other.row().id, other.sb)).statusCode).toBe(404);
    const boom = currencySetup();
    boom.updateSubscription.mockRejectedValueOnce(new Error(`upstream said ${WALLOS_KEY} ${ACTUAL_PW} ${SYNC_KEY}`));
    const res = await run(boom, { action: ACTION, confirm: true }, boom.row().id);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error' });
    expect(bodies).toHaveLength(5);
    // The capture is live: the failing write logged at least one line.
    expect(boom.logs.length).toBeGreaterThan(0);
    for (const [s, body] of bodies) {
      for (const secret of secrets(s)) expect(body).not.toContain(secret);
      expect(body).not.toMatch(/upstream said|netflix/i);
    }
  });
});

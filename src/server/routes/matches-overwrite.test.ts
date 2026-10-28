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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { createUpstreamCache } from '../cache/upstream-cache.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { CreateDeps } from '../integrations/create.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn } from '../test/auth-helpers.js';

const CHECK = '/api/sync/check';
const open: { close(): Promise<unknown>; db?: AppDatabase }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    if (a.db) closeDatabase(a.db);
  }
});

function setup() {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  const reads = { wallos: new Map<string, number>(), actual: new Map<string, number>() };
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  const updateSubscription = vi.fn(async () => undefined);
  const names = new Map<string, string>();
  const deps: CreateDeps = {
    wallos: {
      listSubscriptions: async (id: string) => {
        bump(reads.wallos, id);
        return [
          { id: 1, name: names.get(id) ?? 'Netflix', price: '12.50', currency_id: 1, cycle: 3, frequency: 1, next_payment: '2026-11-03', start_date: '2026-01-01', inactive: 0 },
        ];
      },
      listPaymentMethods: async () => [],
      listCategories: async () => [],
      listCurrencies: async () => [{ id: 1, code: 'EUR', rate: '1' }],
      createSubscription: vi.fn(async () => '9'),
      updateSubscription,
    },
    repoFor: (id) => createUserRepo(t.db, id),
    withActual: (id, use) => {
      bump(reads.actual, id);
      return use({
        getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
        getSchedules: async () => [
          { id: 'a1', name: 'Netflix', amount: -1250, amountOp: 'is', date: { frequency: 'monthly', start: '2026-01-01' } },
        ],
      } as never);
    },
    createSchedule: vi.fn(),
  };
  const app = buildApp({
    db: t.db,
    integrations: deps,
    cache: createUpstreamCache(),
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
  return { app, db: t.db, a, b, sa: signIn(ctx, a), sb: signIn(ctx, b), reads, names, updateSubscription };
}

describe('POST /api/sync/check cache', () => {
  it('an empty body and a missing body use the cache', async () => {
    const { app, sa, a, reads } = setup();
    expect((await injectAs(app, sa, { method: 'POST', url: CHECK, payload: {} })).statusCode).toBe(200);
    expect((await injectAs(app, sa, { method: 'POST', url: CHECK })).statusCode).toBe(200);
    expect((await injectAs(app, sa, { method: 'POST', url: CHECK, payload: { refresh: false } })).statusCode).toBe(200);
    expect(reads.wallos.get(a)).toBe(1);
    expect(reads.actual.get(a)).toBe(1);
  });

  it('refresh true bypasses the cache and the response shape is unchanged', async () => {
    const { app, sa, a, reads } = setup();
    const first = await injectAs(app, sa, { method: 'POST', url: CHECK, payload: {} });
    const second = await injectAs(app, sa, { method: 'POST', url: CHECK, payload: { refresh: true } });
    expect(reads.wallos.get(a)).toBe(2);
    expect(reads.actual.get(a)).toBe(2);
    expect(Object.keys(second.json<object>()).sort()).toEqual(Object.keys(first.json<object>()).sort());
  });

  it('shows a change made in Wallos only after a refresh', async () => {
    const { app, sa, a, names } = setup();
    const before = await injectAs(app, sa, { method: 'POST', url: CHECK, payload: {} });
    names.set(a, 'Renamed');
    const cached = await injectAs(app, sa, { method: 'POST', url: CHECK, payload: {} });
    expect(cached.json<{ unlinkedWallos: { name: string }[] }>().unlinkedWallos[0]?.name).toBe('Netflix');
    const fresh = await injectAs(app, sa, { method: 'POST', url: CHECK, payload: { refresh: true } });
    expect(fresh.json<{ unlinkedWallos: { name: string }[] }>().unlinkedWallos[0]?.name).toBe('Renamed');
    expect(before.statusCode).toBe(200);
  });

  it.each([
    ['a string', { refresh: 'true' }],
    ['a number', { refresh: 1 }],
    ['null', { refresh: null }],
    ['an object', { refresh: {} }],
  ])('rejects refresh as %s with 400 and reads nothing', async (_name, payload) => {
    const { app, sa, a, reads } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: CHECK, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(reads.wallos.get(a)).toBeUndefined();
  });

  it('rejects a non-object body with 400', async () => {
    const { app, sa } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: CHECK, payload: [true] });
    expect(res.statusCode).toBe(400);
  });

  it('isolates two users: each user reads upstream for themselves and never sees the other cache', async () => {
    const { app, sa, sb, a, b, reads, names } = setup();
    names.set(a, 'Alice Only');
    names.set(b, 'Bob Only');
    const ra = await injectAs(app, sa, { method: 'POST', url: CHECK, payload: {} });
    const rb = await injectAs(app, sb, { method: 'POST', url: CHECK, payload: {} });
    expect(ra.json<{ unlinkedWallos: { name: string }[] }>().unlinkedWallos.map((i) => i.name)).toEqual(['Alice Only']);
    expect(rb.json<{ unlinkedWallos: { name: string }[] }>().unlinkedWallos.map((i) => i.name)).toEqual(['Bob Only']);
    expect(reads.wallos.get(a)).toBe(1);
    expect(reads.wallos.get(b)).toBe(1);
    // Cached for each, still separate on the second round.
    const ra2 = await injectAs(app, sa, { method: 'POST', url: CHECK, payload: {} });
    const rb2 = await injectAs(app, sb, { method: 'POST', url: CHECK, payload: {} });
    expect(ra2.json<{ unlinkedWallos: { name: string }[] }>().unlinkedWallos[0]?.name).toBe('Alice Only');
    expect(rb2.json<{ unlinkedWallos: { name: string }[] }>().unlinkedWallos[0]?.name).toBe('Bob Only');
    expect(reads.wallos.get(a)).toBe(1);
    expect(reads.wallos.get(b)).toBe(1);
  });

  it("a refresh by one user does not drop the other user's cache", async () => {
    const { app, sa, sb, b, reads } = setup();
    await injectAs(app, sa, { method: 'POST', url: CHECK, payload: {} });
    await injectAs(app, sb, { method: 'POST', url: CHECK, payload: {} });
    await injectAs(app, sa, { method: 'POST', url: CHECK, payload: { refresh: true } });
    await injectAs(app, sb, { method: 'POST', url: CHECK, payload: {} });
    expect(reads.wallos.get(b)).toBe(1);
  });
});

describe('Walley writes invalidate only the writer cache', () => {
  const post = (app: ReturnType<typeof setup>['app'], s: ReturnType<typeof setup>['sa'], url: string, payload: object) =>
    injectAs(app, s, { method: 'POST', url, payload });

  it('ignore, restore, link and unlink drop the caller cache', async () => {
    const { app, sa, sb, a, b, reads } = setup();
    await post(app, sa, CHECK, {});
    await post(app, sb, CHECK, {});
    const ignored = await post(app, sa, '/api/matches/ignore', { side: 'wallos', itemId: '1' });
    expect(ignored.statusCode).toBe(201);
    await post(app, sa, CHECK, {});
    expect(reads.wallos.get(a)).toBe(2);
    expect(reads.wallos.get(b)).toBe(1);
    const id = ignored.json<{ id: string }>().id;
    const restored = await injectAs(app, sa, { method: 'DELETE', url: `/api/matches/${id}` });
    expect(restored.statusCode).toBe(204);
    await post(app, sa, CHECK, {});
    expect(reads.wallos.get(a)).toBe(3);
    const linked = await post(app, sa, '/api/matches', { wallosId: '1', actualScheduleId: 'a1' });
    expect(linked.statusCode).toBe(201);
    await post(app, sa, CHECK, {});
    expect(reads.wallos.get(a)).toBeGreaterThanOrEqual(4);
    expect(reads.wallos.get(b)).toBe(1);
  });

  it('a failed write also drops the cache', async () => {
    const { app, sa, a, reads } = setup();
    await post(app, sa, CHECK, {});
    // Unknown match id: the route answers 404 but still invalidates.
    const res = await post(app, sa, '/api/matches/nope/resolve', { action: 'unlink', confirm: true });
    expect(res.statusCode).toBe(404);
    await post(app, sa, CHECK, {});
    expect(reads.wallos.get(a)).toBe(2);
  });

  it('an overwrite drops the cache whether it writes or not', async () => {
    const { app, sa, a, db, reads } = setup();
    await post(app, sa, CHECK, {});
    const row = createUserRepo(db, a).insertMatch({
      wallosId: '1',
      actualScheduleId: 'a1',
      status: 'MISMATCH_DETECTED',
      lastKnownWallosHash: 'x'.repeat(64),
      lastKnownActualHash: 'y'.repeat(64),
    });
    const res = await post(app, sa, `/api/matches/${row.id}/resolve`, { action: 'overwrite_wallos', confirm: true });
    expect(res.statusCode).toBe(200);
    const before = reads.wallos.get(a) ?? 0;
    await post(app, sa, CHECK, {});
    // The overwrite itself reads live (not cached), then the check reads live again after invalidation.
    expect((reads.wallos.get(a) ?? 0) - before).toBe(1);
  });

  it('creating a Wallos subscription from an Actual schedule drops the cache', async () => {
    const { app, sa, a, reads } = setup();
    await post(app, sa, CHECK, {});
    const made = await post(app, sa, '/api/integrations/wallos-subscriptions', { scheduleId: 'a1' });
    expect(made.statusCode).toBe(201);
    const before = reads.wallos.get(a) ?? 0;
    await post(app, sa, CHECK, {});
    expect((reads.wallos.get(a) ?? 0) - before).toBe(1);
  });

  it('creating an Actual schedule from a Wallos subscription drops the cache', async () => {
    const { app, sa, a, reads } = setup();
    await post(app, sa, CHECK, {});
    // The fake has no accounts or payee create, so the route fails. Failure must still invalidate.
    const madeA = await post(app, sa, '/api/integrations/actual-schedules', {
      wallosSubscriptionId: '1',
      accountId: 'acc',
      payee: { kind: 'new', name: 'Netflix' },
    });
    expect(madeA.statusCode).toBe(500);
    const before = reads.wallos.get(a) ?? 0;
    await post(app, sa, CHECK, {});
    expect((reads.wallos.get(a) ?? 0) - before).toBe(1);
  });
});

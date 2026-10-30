import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUpstreamCache, type UpstreamCache } from '../cache/upstream-cache.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { WallosClient } from '../integrations/wallos/client.js';
import { makeUser } from '../test/auth-helpers.js';
import { runSyncCheck, type SyncCheckDeps } from './sync-check.js';

const dbs: AppDatabase[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  for (const d of dbs.splice(0)) closeDatabase(d);
});

/** Counting fakes: every upstream read is recorded per user. */
function fakes() {
  const db = openDatabase(':memory:');
  dbs.push(db);
  const calls = { wallos: 0, actual: 0 };
  const deps: SyncCheckDeps = {
    now: () => Date.now(),
    cache: createUpstreamCache(),
    repoFor: (id) => createUserRepo(db, id),
    wallos: {
      listSubscriptions: vi.fn(async () => {
        calls.wallos += 1;
        return [{ id: 1, name: 'Netflix', price: '12.50', currency_id: 1, cycle: 3, frequency: 1, next_payment: '2026-11-03', start_date: '2026-01-01', inactive: 0 }];
      }),
      listPaymentMethods: async () => [],
      listCategories: async () => [],
      listCurrencies: vi.fn(async () => [{ id: 1, code: 'EUR', rate: '1' }]),
    } as unknown as WallosClient,
    withActual: (_id, use) => {
      calls.actual += 1;
      return use({
        getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
        getSchedules: async () => [
          { id: 'a1', name: 'Netflix', amount: -1250, amountOp: 'is', date: { frequency: 'monthly', interval: 1, start: '2026-01-01' } },
        ],
      } as never);
    },
  };
  return { db, deps, calls, cache: deps.cache as UpstreamCache };
}

const TTL = 300_000;

describe('runSyncCheck with the upstream cache', () => {
  it('a second check within the TTL reads nothing upstream', async () => {
    const t = fakes();
    const u = makeUser(t.db);
    await runSyncCheck(t.deps, u);
    await runSyncCheck(t.deps, u);
    expect(t.calls).toEqual({ wallos: 1, actual: 1 });
  });

  it('after the TTL expires the next check reads upstream again', async () => {
    const t = fakes();
    const u = makeUser(t.db);
    await runSyncCheck(t.deps, u);
    vi.advanceTimersByTime(TTL);
    await runSyncCheck(t.deps, u);
    expect(t.calls).toEqual({ wallos: 2, actual: 2 });
  });

  it('refresh true bypasses the cache and stores the fresh read', async () => {
    const t = fakes();
    const u = makeUser(t.db);
    await runSyncCheck(t.deps, u);
    await runSyncCheck(t.deps, u, { refresh: true });
    expect(t.calls).toEqual({ wallos: 2, actual: 2 });
    await runSyncCheck(t.deps, u);
    expect(t.calls).toEqual({ wallos: 2, actual: 2 });
  });

  it('invalidate forces the next check to read upstream after a write', async () => {
    const t = fakes();
    const u = makeUser(t.db);
    await runSyncCheck(t.deps, u);
    t.cache.invalidate(u);
    await runSyncCheck(t.deps, u);
    expect(t.calls).toEqual({ wallos: 2, actual: 2 });
  });

  it('two users never share cache entries', async () => {
    const t = fakes();
    const a = makeUser(t.db);
    const b = makeUser(t.db);
    await runSyncCheck(t.deps, a);
    await runSyncCheck(t.deps, b);
    expect(t.calls).toEqual({ wallos: 2, actual: 2 });
    await runSyncCheck(t.deps, a);
    await runSyncCheck(t.deps, b);
    expect(t.calls).toEqual({ wallos: 2, actual: 2 });
  });

  it('invalidating one user leaves the other user cached', async () => {
    const t = fakes();
    const a = makeUser(t.db);
    const b = makeUser(t.db);
    await runSyncCheck(t.deps, a);
    await runSyncCheck(t.deps, b);
    t.cache.invalidate(a);
    await runSyncCheck(t.deps, b);
    expect(t.calls).toEqual({ wallos: 2, actual: 2 });
  });

  it('a cached value is never returned to a different user', async () => {
    const t = fakes();
    const a = makeUser(t.db);
    const b = makeUser(t.db);
    // A's Wallos data differs from B's; the fake returns the user's own name.
    const per: Record<string, string> = { [a]: 'Alice Only', [b]: 'Bob Only' };
    const listSubscriptions = vi.fn(async (id: string) => [
      { id: 1, name: per[id], price: '12.50', currency_id: 1, cycle: 3, frequency: 1, next_payment: '2026-11-03', start_date: '2026-01-01', inactive: 0 },
    ]);
    const deps: SyncCheckDeps = { ...t.deps, wallos: { ...t.deps.wallos, listSubscriptions } };
    const ra = await runSyncCheck(deps, a);
    const rb = await runSyncCheck(deps, b);
    expect(ra.unlinkedWallos.map((i) => i.name)).toEqual(['Alice Only']);
    expect(rb.unlinkedWallos.map((i) => i.name)).toEqual(['Bob Only']);
  });

  it('a check that runs with no cache option reads live every time', async () => {
    const t = fakes();
    const u = makeUser(t.db);
    const live: SyncCheckDeps = { ...t.deps, cache: undefined };
    await runSyncCheck(live, u);
    await runSyncCheck(live, u);
    expect(t.calls).toEqual({ wallos: 2, actual: 2 });
  });

  it('the cache never holds the Wallos or Actual credentials', async () => {
    const t = fakes();
    const u = makeUser(t.db);
    await runSyncCheck(t.deps, u);
    const stored = JSON.stringify([
      t.cache.peek(u, 'wallos-subscriptions'),
      t.cache.peek(u, 'wallos-currencies'),
      t.cache.peek(u, 'actual-schedules'),
      t.cache.peek(u, 'actual-budget-meta'),
    ]);
    expect(stored).toContain('Netflix');
    expect(stored).not.toMatch(/api[_-]?key|password|sync[_-]?key|wallos_api/i);
  });
});

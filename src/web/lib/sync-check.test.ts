import { errorText } from '@/i18n/translate';
import { describe, expect, it, vi } from 'vitest';
import type { SyncCheckResult } from '../../lib/sync-check-types';
import {
  applyIgnore,
  applyLink,
  applyRestore,
  buildRows,
  createSyncStore,
  filterRows,
  nextRowId,
  performAction,
  restoreAndRecheck,
  rollback,
} from './sync-check';

export const sample = (): SyncCheckResult => ({
  checkedAt: '2026-01-01T00:00:00Z',
  baseCurrency: 'EUR',
  unlinkedWallos: [
    { id: 'w1', name: 'Netflix', amountCents: 1299, isRange: false, reason: null },
    { id: 'w2', name: 'Gym', amountCents: null, isRange: false, reason: 'invalid_amount' },
  ],
  unlinkedActual: [
    { id: 'a1', name: 'NETFLIX.COM', amountCents: 1300, isRange: true, reason: null },
    { id: 'a2', name: 'Rent', amountCents: 90000, isRange: false, reason: null },
  ],
  candidates: [
    {
      wallosId: 'w1',
      actualScheduleId: 'a1',
      nameScore: 0.9,
      wallosName: 'Netflix',
      actualName: 'NETFLIX.COM',
      wallosAmountCents: 1299,
      actualAmountCents: 1300,
      isRange: true,
    },
  ],
  mismatches: [],
  unmappable: [],
  orphaned: [],
  linked: [],
  ignored: [{ matchId: 'm1', side: 'wallos', itemId: 'w9', name: 'Old', amountCents: 500, isRange: false, reason: null }],
});

const json = (status: number, body: unknown) => Response.json(body, { status });

describe('filterRows and buildRows', () => {
  it('filters by name, case-insensitively', () => {
    const rows = buildRows(sample(), 'actual', '', false);
    expect(filterRows(rows, 'netflix').map((r) => r.id)).toEqual(['a1']);
    expect(filterRows(rows, '  ').length).toBe(2);
  });
  it('shows ignored rows only when asked', () => {
    expect(buildRows(sample(), 'wallos', '', false).map((r) => r.id)).toEqual(['w1', 'w2']);
    const withIgnored = buildRows(sample(), 'wallos', 'old', true);
    expect(withIgnored.map((r) => [r.id, r.ignored])).toEqual([['w9', true]]);
  });
});

describe('applyLink, applyIgnore, rollback', () => {
  it('applyLink removes both items and their candidates and adds a linked row', () => {
    const next = applyLink(sample(), 'w1', 'a1');
    expect(next.unlinkedWallos.map((i) => i.id)).toEqual(['w2']);
    expect(next.unlinkedActual.map((i) => i.id)).toEqual(['a2']);
    expect(next.candidates).toEqual([]);
    expect(next.linked).toHaveLength(1);
  });
  it('applyIgnore moves the item to ignored and drops its candidates', () => {
    const next = applyIgnore(sample(), 'actual', 'a1');
    expect(next.unlinkedActual.map((i) => i.id)).toEqual(['a2']);
    expect(next.candidates).toEqual([]);
    expect(next.ignored.at(-1)).toMatchObject({ side: 'actual', itemId: 'a1', name: 'NETFLIX.COM' });
  });
  it('does not mutate its input and rollback returns the snapshot', () => {
    const before = sample();
    const next = applyIgnore(before, 'wallos', 'w1');
    expect(before).toEqual(sample());
    expect(rollback(next, before)).toBe(before);
  });
  it('applyRestore moves the ignored row back to its unlinked column', () => {
    const before = sample();
    const next = applyRestore(before, 'm1');
    expect(next.ignored).toEqual([]);
    expect(next.unlinkedWallos.map((i) => i.id)).toEqual(['w1', 'w2', 'w9']);
    expect(next.unlinkedWallos.at(-1)).toMatchObject({ name: 'Old', amountCents: 500 });
    expect(before).toEqual(sample());
    expect(rollback(next, before)).toBe(before);
    expect(applyRestore(before, 'nope')).toBe(before);
  });
  it('nextRowId prefers the next row, then the previous', () => {
    expect(nextRowId(['a', 'b', 'c'], 'b')).toBe('c');
    expect(nextRowId(['a', 'b'], 'b')).toBe('a');
    expect(nextRowId(['a'], 'a')).toBeNull();
  });
});

describe('mismatch field detail', () => {
  const side = (cents: number) => ({
    frequency: 'monthly',
    interval: 1,
    startDate: '2026-01-01',
    currency: 'EUR',
    amount: { kind: 'single' as const, cents },
  });
  const withMismatch = (): SyncCheckResult => ({
    ...sample(),
    mismatches: [
      {
        matchId: 'm9',
        wallosId: 'w5',
        actualScheduleId: 'a5',
        wallosName: 'Gym',
        actualName: 'Gym',
        wallosAmountCents: -1000,
        actualAmountCents: -1100,
        isRange: false,
        wallosDrift: false,
        actualDrift: true,
        wallosFields: side(-1000),
        actualFields: side(-1100),
      },
    ],
  });
  it('keeps mismatches, with their field detail, through link, ignore and restore', () => {
    const before = withMismatch();
    expect(applyLink(before, 'w1', 'a1').mismatches).toEqual(before.mismatches);
    expect(applyIgnore(before, 'wallos', 'w1').mismatches).toEqual(before.mismatches);
    expect(applyRestore(before, 'm1').mismatches).toEqual(before.mismatches);
    expect(before.mismatches[0]?.actualFields.amount).toEqual({ kind: 'single', cents: -1100 });
  });
  it('does not touch the mismatch rows when filtering the dashboard columns', () => {
    const r = withMismatch();
    expect(buildRows(r, 'wallos', '', false).map((x) => x.id)).toEqual(['w1', 'w2']);
    expect(buildRows(r, 'actual', '', false).map((x) => x.id)).toEqual(['a1', 'a2']);
  });
});

describe('performAction', () => {
  const harness = () => {
    let current: SyncCheckResult | null = sample();
    return { get: () => current, set: (r: SyncCheckResult) => (current = r) };
  };
  it('link success keeps the optimistic list and posts the pair', async () => {
    const h = harness();
    const f = vi.fn(async () => json(201, { id: 'm', status: 'LINKED' }));
    const out = await performAction(h.get, h.set, { kind: 'link', wallosId: 'w1', actualScheduleId: 'a1' }, f);
    expect(out).toEqual({ ok: true });
    expect(h.get()?.linked).toHaveLength(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/matches');
    expect(JSON.parse(init.body as string)).toEqual({ wallosId: 'w1', actualScheduleId: 'a1' });
  });
  it('link failure rolls back and returns the server code', async () => {
    const h = harness();
    const f = vi.fn(async () => json(409, { error: 'already_matched' }));
    const out = await performAction(h.get, h.set, { kind: 'link', wallosId: 'w1', actualScheduleId: 'a1' }, f);
    expect(out).toEqual({ ok: false, code: 'already_matched' });
    expect(h.get()).toEqual(sample());
  });
  it('a failed action does not undo or overwrite a later overlapping action', async () => {
    const h = harness();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const failing = vi.fn(async () => {
      await gate;
      return json(500, { error: 'boom' });
    });
    const first = performAction(h.get, h.set, { kind: 'ignore', side: 'actual', itemId: 'a2' }, failing);
    const second = await performAction(
      h.get,
      h.set,
      { kind: 'link', wallosId: 'w1', actualScheduleId: 'a1' },
      async () => json(201, { id: 'm', status: 'LINKED' }),
    );
    expect(second.ok).toBe(true);
    release();
    expect((await first).ok).toBe(false);
    const after = h.get();
    expect(after?.linked).toHaveLength(1);
    expect(after?.unlinkedWallos.map((i) => i.id)).toEqual(['w2']);
    expect(after?.unlinkedActual.map((i) => i.id)).toEqual(['a2']);
    expect(after?.ignored.some((r) => r.itemId === 'a2')).toBe(false);
  });
  it('ignore success posts side and itemId', async () => {
    const h = harness();
    const f = vi.fn(async () => json(201, { id: 'm', status: 'IGNORED_WALLOS' }));
    const out = await performAction(h.get, h.set, { kind: 'ignore', side: 'wallos', itemId: 'w2' }, f);
    expect(out.ok).toBe(true);
    expect(h.get()?.unlinkedWallos.map((i) => i.id)).toEqual(['w1']);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/matches/ignore');
    expect(JSON.parse(init.body as string)).toEqual({ side: 'wallos', itemId: 'w2' });
  });
  it('restore 204 moves the item back and sends DELETE', async () => {
    const h = harness();
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    const out = await performAction(h.get, h.set, { kind: 'restore', matchId: 'm1' }, f);
    expect(out).toEqual({ ok: true });
    expect(h.get()?.ignored).toEqual([]);
    expect(h.get()?.unlinkedWallos.map((i) => i.id)).toContain('w9');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/matches/m1');
    expect(init.method).toBe('DELETE');
  });
  it('restore 404 rolls back and returns match_not_found', async () => {
    const h = harness();
    const f = vi.fn(async () => json(404, { error: 'match_not_found' }));
    const out = await performAction(h.get, h.set, { kind: 'restore', matchId: 'm1' }, f);
    expect(out).toEqual({ ok: false, code: 'match_not_found' });
    expect(h.get()).toEqual(sample());
    expect(errorText('match_not_found', 'en')).toContain('no longer exists');
  });
  it('ignore then restore works without a refetch using the returned id', async () => {
    const h = harness();
    await performAction(h.get, h.set, { kind: 'ignore', side: 'wallos', itemId: 'w2' }, async () => json(201, { id: 'real', status: 'IGNORED_WALLOS' }));
    expect(h.get()?.ignored.at(-1)?.matchId).toBe('real');
  });
  it('a network failure rolls back with request_failed', async () => {
    const h = harness();
    const f = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const out = await performAction(h.get, h.set, { kind: 'ignore', side: 'actual', itemId: 'a2' }, f);
    expect(out).toEqual({ ok: false, code: 'request_failed' });
    expect(h.get()).toEqual(sample());
  });
});

describe('sync store', () => {
  it('starts idle, loads the result, and keeps it on a later error', async () => {
    const ok = vi.fn(async () => json(200, sample()));
    const store = createSyncStore(ok);
    expect(store.getState().status).toBe('idle');
    await store.run();
    expect(store.getState()).toMatchObject({ status: 'ready', errorCode: null });
    expect((ok.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('/api/sync/check');
  });
  it('reports the server code on failure', async () => {
    const store = createSyncStore(async () => json(502, { error: 'wallos_unavailable' }));
    await store.run();
    expect(store.getState()).toMatchObject({ status: 'error', errorCode: 'wallos_unavailable', result: null });
  });
});

describe('sync store refresh flag', () => {
  const gated = () => {
    const resolvers: ((r: Response) => void)[] = [];
    const f = vi.fn(() => new Promise<Response>((resolve) => { resolvers.push(resolve); }));
    return {
      f,
      settle: (i: number, r: Response) => { resolvers[i]?.(r); },
    };
  };
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  const result = (name: string): SyncCheckResult => ({ ...sample(), checkedAt: name });
  const bodyOf = (f: { mock: { calls: unknown[][] } }, n: number): unknown =>
    JSON.parse(((f.mock.calls[n] as unknown as [string, RequestInit])[1].body as string));

  it('run() sends an empty body, so the server may use its cache', async () => {
    const f = vi.fn(async () => json(200, sample()));
    const store = createSyncStore(f);
    await store.run();
    expect(bodyOf(f, 0)).toEqual({});
  });

  it('run({ refresh: true }) sends refresh true', async () => {
    const f = vi.fn(async () => json(200, sample()));
    const store = createSyncStore(f);
    await store.run({ refresh: true });
    expect(bodyOf(f, 0)).toEqual({ refresh: true });
  });

  it('a refresh during a cached check queues one refreshing check after it', async () => {
    const g = gated();
    const store = createSyncStore(g.f);
    const first = store.run();
    await tick();
    const refreshed = store.run({ refresh: true });
    g.settle(0, json(200, result('stale')));
    await tick();
    g.settle(1, json(200, result('fresh')));
    await Promise.all([first, refreshed]);
    expect(g.f).toHaveBeenCalledTimes(2);
    expect(bodyOf(g.f, 0)).toEqual({});
    expect(bodyOf(g.f, 1)).toEqual({ refresh: true });
    expect(store.getState().result?.checkedAt).toBe('fresh');
  });

  it('a refresh during a refreshing check joins it', async () => {
    const g = gated();
    const store = createSyncStore(g.f);
    const first = store.run({ refresh: true });
    await tick();
    const second = store.run({ refresh: true });
    g.settle(0, json(200, result('fresh')));
    await Promise.all([first, second]);
    expect(g.f).toHaveBeenCalledTimes(1);
  });

  it('a plain run after a refresh does not keep refreshing', async () => {
    const f = vi.fn(async () => json(200, sample()));
    const store = createSyncStore(f);
    await store.run({ refresh: true });
    await store.run();
    expect(bodyOf(f, 0)).toEqual({ refresh: true });
    expect(bodyOf(f, 1)).toEqual({});
  });
});

describe('row actions update the shared store without a refetch (#48, #49)', () => {
  const setup = () => {
    const stub = vi.fn(async () => json(201, { id: 'm1', status: 'LINKED' }));
    const store = createSyncStore(stub);
    store.setResult(sample());
    const run = (action: Parameters<typeof performAction>[2]) =>
      performAction(() => store.getState().result, store.setResult, action, stub);
    return { stub, store, run };
  };
  const urls = (stub: ReturnType<typeof setup>['stub']) =>
    stub.mock.calls.map((c) => (c as unknown as [string, RequestInit])[0]);

  it('Link started from the Actual column updates the store and calls only the match route once', async () => {
    const { stub, store, run } = setup();
    const out = await run({ kind: 'link', wallosId: 'w1', actualScheduleId: 'a1' });
    expect(out).toEqual({ ok: true });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(urls(stub)).toEqual(['/api/matches']);
    expect(store.getState()).toMatchObject({ status: 'ready', errorCode: null });
    expect(store.getState().result?.linked).toHaveLength(1);
    expect(store.getState().result?.unlinkedActual.map((i) => i.id)).toEqual(['a2']);
  });

  it('Ignore on the Wallos side updates the store and calls only the ignore route once', async () => {
    const { stub, store, run } = setup();
    const out = await run({ kind: 'ignore', side: 'wallos', itemId: 'w2' });
    expect(out).toEqual({ ok: true });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(urls(stub)).toEqual(['/api/matches/ignore']);
    expect(store.getState().result?.unlinkedWallos.map((i) => i.id)).toEqual(['w1']);
    expect(store.getState().result?.ignored.at(-1)).toMatchObject({ side: 'wallos', itemId: 'w2' });
  });

  it('Ignore on the Actual side updates the store and calls only the ignore route once', async () => {
    const { stub, store, run } = setup();
    const out = await run({ kind: 'ignore', side: 'actual', itemId: 'a2' });
    expect(out).toEqual({ ok: true });
    expect(stub).toHaveBeenCalledTimes(1);
    expect(urls(stub)).toEqual(['/api/matches/ignore']);
    expect(store.getState().result?.unlinkedActual.map((i) => i.id)).toEqual(['a1']);
    expect(store.getState().result?.ignored.at(-1)).toMatchObject({ side: 'actual', itemId: 'a2' });
  });

  it('never requests /api/sync/check during a row action', async () => {
    const { stub, run } = setup();
    await run({ kind: 'link', wallosId: 'w1', actualScheduleId: 'a1' });
    await run({ kind: 'ignore', side: 'wallos', itemId: 'w2' });
    await run({ kind: 'ignore', side: 'actual', itemId: 'a2' });
    expect(urls(stub).some((u) => u.includes('sync/check'))).toBe(false);
  });
});

describe('requestRun', () => {
  const result = (name: string): SyncCheckResult => ({ ...sample(), checkedAt: name });
  /** A fake fetch whose check calls stay pending until the test settles them in order. */
  const gated = () => {
    const pending: Array<(r: Response) => void> = [];
    const f = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    );
    return { f, settle: (i: number, r: Response) => pending[i]?.(r) };
  };
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  it('starts a check while idle', async () => {
    const f = vi.fn(async () => json(200, result('one')));
    const store = createSyncStore(f);
    await store.requestRun();
    expect(f).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({ status: 'ready', result: { checkedAt: 'one' } });
  });

  it('while loading, discards the stale result and runs one trailing check', async () => {
    const g = gated();
    const store = createSyncStore(g.f);
    const first = store.requestRun();
    await tick();
    const second = store.requestRun();
    g.settle(0, json(200, result('stale')));
    await tick();
    expect(store.getState().result).toBeNull();
    expect(store.getState().status).toBe('loading');
    expect(g.f).toHaveBeenCalledTimes(2);
    g.settle(1, json(200, result('fresh')));
    await Promise.all([first, second]);
    expect(store.getState()).toMatchObject({ status: 'ready', result: { checkedAt: 'fresh' } });
  });

  it('three calls while loading give exactly one trailing check', async () => {
    const g = gated();
    const store = createSyncStore(g.f);
    const all = [store.requestRun()];
    await tick();
    all.push(store.requestRun(), store.requestRun(), store.requestRun());
    g.settle(0, json(200, result('stale')));
    await tick();
    g.settle(1, json(200, result('fresh')));
    await Promise.all(all);
    expect(g.f).toHaveBeenCalledTimes(2);
    expect(store.getState().result?.checkedAt).toBe('fresh');
  });

  it('a failed check keeps the result and sets error', async () => {
    const f = vi.fn(async () => json(500, { error: 'boom' }));
    const store = createSyncStore(f);
    store.setResult(result('kept'));
    await store.requestRun();
    expect(store.getState()).toMatchObject({ status: 'error', errorCode: 'boom', result: { checkedAt: 'kept' } });
  });

  it('a failed trailing check also keeps the result', async () => {
    const g = gated();
    const store = createSyncStore(g.f);
    store.setResult(result('kept'));
    const a = store.requestRun();
    await tick();
    const b = store.requestRun();
    g.settle(0, json(200, result('stale')));
    await tick();
    g.settle(1, json(500, { error: 'boom' }));
    await Promise.all([a, b]);
    expect(store.getState()).toMatchObject({ status: 'error', result: { checkedAt: 'kept' } });
  });

  describe('concurrency', () => {
    it('run() during a requestRun check after a setResult starts no second fetch', async () => {
      const g = gated();
      const store = createSyncStore(g.f);
      const first = store.requestRun();
      await tick();
      store.setResult(result('optimistic')); // flips status away from loading in the old code
      expect(store.getState().status).toBe('loading');
      const viaRun = store.run();
      const again = store.requestRun(); // queues the one trailing check
      g.settle(0, json(200, result('stale')));
      await tick();
      g.settle(1, json(200, result('fresh')));
      await Promise.all([first, viaRun, again]);
      expect(g.f.mock.calls.length).toBeLessThanOrEqual(2);
      expect(g.f).toHaveBeenCalledTimes(2);
      expect(store.getState().result?.checkedAt).toBe('fresh');
    });

    it('run() alone during a check after a setResult joins it (one fetch)', async () => {
      const g = gated();
      const store = createSyncStore(g.f);
      const first = store.requestRun();
      await tick();
      store.setResult(result('optimistic'));
      const viaRun = store.run();
      await tick();
      expect(g.f).toHaveBeenCalledTimes(1);
      g.settle(0, json(200, result('stale')));
      await Promise.all([first, viaRun]);
      expect(g.f).toHaveBeenCalledTimes(1);
      expect(store.getState()).toMatchObject({ status: 'ready', result: { checkedAt: 'optimistic' } });
    });

    it('after the first check settles, requestRun starts exactly one new check', async () => {
      const g = gated();
      const store = createSyncStore(g.f);
      const first = store.requestRun();
      await tick();
      store.setResult(result('optimistic'));
      const viaRun = store.run();
      g.settle(0, json(200, result('stale')));
      await Promise.all([first, viaRun]);
      expect(g.f).toHaveBeenCalledTimes(1);
      const next = store.requestRun();
      await tick();
      expect(g.f).toHaveBeenCalledTimes(2);
      g.settle(1, json(200, result('next')));
      await next;
      expect(g.f).toHaveBeenCalledTimes(2);
      expect(store.getState().result?.checkedAt).toBe('next');
    });

    it('requestRun in the completion gap still runs its trailing check', async () => {
      const g = gated();
      const store = createSyncStore(g.f);
      const first = store.requestRun();
      await tick();
      let second: Promise<void> | undefined;
      store.subscribe(() => {
        // Fires inside the loop's final set(), right before it checks wantsRerun() and finishes.
        if (second === undefined && store.getState().status === 'ready') second = store.requestRun();
      });
      g.settle(0, json(200, result('one')));
      await tick();
      expect(second).toBeDefined();
      expect(g.f).toHaveBeenCalledTimes(2); // the trailing check ran
      g.settle(1, json(200, result('two')));
      await Promise.all([first, second]);
      expect(store.getState().result?.checkedAt).toBe('two');
    });

    it('requestRun right after the loop returns (gap before finally) starts a new check', async () => {
      const g = gated();
      const store = createSyncStore(g.f);
      const first = store.requestRun();
      await tick();
      g.settle(0, json(200, result('one')));
      await first;
      const second = store.requestRun();
      await tick();
      expect(g.f).toHaveBeenCalledTimes(2);
      g.settle(1, json(200, result('two')));
      await second;
    });

    it('requestRun from a microtask right after the loop ends starts a new check', async () => {
      const g = gated();
      const store = createSyncStore(g.f);
      let queued = false;
      store.subscribe(() => {
        if (!queued && store.getState().status === 'ready') {
          queued = true;
          queueMicrotask(() => {
            void store.requestRun();
          });
        }
      });
      const first = store.requestRun();
      await tick();
      g.settle(0, json(200, result('one')));
      await first;
      await tick();
      expect(queued).toBe(true);
      expect(g.f).toHaveBeenCalledTimes(2);
      g.settle(1, json(200, result('two')));
      await tick();
      expect(store.getState().result?.checkedAt).toBe('two');
    });
  });

  describe('stale check versus an optimistic restore', () => {
    const routed = (checkOutcomes: Array<(r: Response) => void>, restoreStatus = 204) => {
      const calls: string[] = [];
      const f = vi.fn((input: string) => {
        const url = input;
        calls.push(url);
        if (url.includes('sync/check')) {
          return new Promise<Response>((resolve) => {
            checkOutcomes.push(resolve);
          });
        }
        return Promise.resolve(restoreStatus === 204 ? new Response(null, { status: 204 }) : json(restoreStatus, { error: 'boom' }));
      });
      return { f: f as unknown as typeof fetch, calls };
    };

    it('a check that lands after the optimistic write does not put the pre-change row back', async () => {
      const checks: Array<(r: Response) => void> = [];
      const { f } = routed(checks);
      const store = createSyncStore(f);
      const first = store.requestRun();
      await tick();
      // The server answered with the ignored row still present (pre-change state).
      store.setResult(sample());
      const restored = restoreAndRecheck(store, 'm1', f);
      // Optimistic write is in; the old check lands now, before the restore call has settled.
      expect(store.getState().result?.ignored).toEqual([]);
      checks[0]?.(json(200, sample()));
      await tick();
      expect(store.getState().result?.ignored).toEqual([]);
      expect((await restored).ok).toBe(true);
      await tick();
      checks[1]?.(json(200, { ...sample(), ignored: [] }));
      await first;
      expect(store.getState().result?.ignored).toEqual([]);
    });

    it('if the trailing check fails, the restored row stays restored', async () => {
      const checks: Array<(r: Response) => void> = [];
      const { f } = routed(checks);
      const store = createSyncStore(f);
      const first = store.requestRun();
      await tick();
      store.setResult(sample());
      const restored = restoreAndRecheck(store, 'm1', f);
      checks[0]?.(json(200, sample())); // stale pre-change answer
      await restored;
      await tick();
      checks[1]?.(json(500, { error: 'boom' }));
      await first;
      const state = store.getState();
      expect(state.status).toBe('error');
      expect(state.result?.ignored).toEqual([]);
      expect(state.result?.unlinkedWallos.some((i) => i.id === 'w9')).toBe(true);
    });

    it('a stale check that lands before the restore call settles cannot undo the write (other order)', async () => {
      const checks: Array<(r: Response) => void> = [];
      const { f } = routed(checks);
      const store = createSyncStore(f);
      const first = store.requestRun();
      await tick();
      store.setResult(sample());
      const restored = restoreAndRecheck(store, 'm1', f);
      await restored; // restore call done first, trailing check queued
      checks[0]?.(json(200, sample())); // stale answer lands after
      await tick();
      expect(store.getState().result?.ignored).toEqual([]);
      checks[1]?.(json(500, { error: 'boom' }));
      await first;
      expect(store.getState().result?.ignored).toEqual([]);
    });

    it('a stale check landing while the restore call is still pending cannot put the row back', async () => {
      const checks: Array<(r: Response) => void> = [];
      let finishRestore: (r: Response) => void = () => undefined;
      const f = vi.fn((input: string) =>
        input.includes('sync/check')
          ? new Promise<Response>((resolve) => {
              checks.push(resolve);
            })
          : new Promise<Response>((resolve) => {
              finishRestore = resolve;
            }),
      ) as unknown as typeof fetch;
      const store = createSyncStore(f);
      const first = store.requestRun();
      await tick();
      store.setResult(sample());
      const restored = restoreAndRecheck(store, 'm1', f); // optimistic write now; the restore fetch stays pending
      expect(store.getState().result?.ignored).toEqual([]);
      checks[0]?.(json(200, sample())); // stale answer: the row is still ignored in it
      await first;
      expect(store.getState().result?.ignored).toEqual([]);
      finishRestore(new Response(null, { status: 204 }));
      expect((await restored).ok).toBe(true);
      await tick();
      expect(checks).toHaveLength(2); // the trailing check
      checks[1]?.(json(500, { error: 'boom' }));
      await tick();
      expect(store.getState().status).toBe('error');
      expect(store.getState().result?.ignored).toEqual([]);
    });
  });
});

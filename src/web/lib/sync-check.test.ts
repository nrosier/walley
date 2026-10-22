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

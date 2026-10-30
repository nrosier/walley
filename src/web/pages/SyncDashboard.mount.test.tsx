// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncCheckResult } from '../../lib/sync-check-types';

// The Sync Dashboard runs one sync check when it loads. The check is POST /api/sync/check. The
// shared syncStore is a module singleton, so every test loads a fresh module graph.
// Other requests on the page (/api/health from HealthStatus, the session check) are not counted.

const result: SyncCheckResult = {
  checkedAt: '2026-01-01T00:00:00Z',
  baseCurrency: 'EUR',
  unlinkedWallos: [{ id: 'w1', name: 'Netflix', amountCents: 1299, isRange: false, reason: null }],
  unlinkedActual: [],
  candidates: [],
  mismatches: [],
  linked: [],
  ignored: [],
  unmappable: [],
  orphaned: [],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const isCheck = (input: unknown) => String(input).includes('/api/sync/check');
const checkCalls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => isCheck(c[0])).length;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Fake fetch: check calls go to `onCheck`; every other call resolves 200 with no body. */
function fakeFetch(onCheck: () => Promise<Response>) {
  return vi.fn(async (input: unknown) => (isCheck(input) ? onCheck() : new Response(null, { status: 200 })));
}

/** Loads the page module and the store of the current module graph, then mounts the page in English. */
async function mountPage() {
  const [{ SyncDashboard }, { I18nProvider }, { syncStore }] = await Promise.all([
    import('./SyncDashboard'),
    import('@/i18n'),
    import('@/lib/sync-check'),
  ]);
  const mount = () =>
    render(
      <I18nProvider initialLocale="en">
        <SyncDashboard />
      </I18nProvider>,
    );
  mount();
  return { store: syncStore, remount: () => { cleanup(); mount(); } };
}

let original: typeof fetch;

beforeEach(() => {
  vi.resetModules();
  original = globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = original;
  vi.restoreAllMocks();
});

describe('Sync Dashboard load-time check', () => {
  it('starts exactly one check on mount when the store is idle', async () => {
    const f = fakeFetch(async () => json(200, result));
    globalThis.fetch = f;

    const { store } = await mountPage();
    await waitFor(() => { expect(store.getState().status).toBe('ready'); });
    await tick();
    expect(checkCalls(f)).toBe(1);
  });

  it('does not start a second check while one is already running', async () => {
    let settle: (r: Response) => void = () => undefined;
    const f = fakeFetch(() => new Promise<Response>((r) => { settle = r; }));
    globalThis.fetch = f;

    // The first mount starts the check and it stays in flight. Mounting again on the same store must not start another.
    const { store, remount } = await mountPage();
    const early = store.run();
    await tick();
    expect(checkCalls(f)).toBe(1);

    // A second mount on the same store must join the in-flight check, not start one.
    remount();
    await tick();
    expect(checkCalls(f)).toBe(1);

    settle(json(200, result));
    await early;
    expect(checkCalls(f)).toBe(1);
  });

  it('a failed check on load shows the failure state and does not retry on its own', async () => {
    const f = fakeFetch(async () => json(502, { error: 'wallos_unavailable' }));
    globalThis.fetch = f;

    const { store } = await mountPage();
    await waitFor(() => { expect(store.getState().status).toBe('error'); });
    await tick();
    await tick();

    expect(checkCalls(f)).toBe(1);
    expect(screen.getByRole('alert').textContent).toContain('Could not reach Wallos.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('the Run Sync Check button still triggers a check on click', async () => {
    const f = fakeFetch(async () => json(200, result));
    globalThis.fetch = f;

    const { store } = await mountPage();
    await waitFor(() => { expect(store.getState().status).toBe('ready'); });
    expect(checkCalls(f)).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Run Sync Check' }));
    await waitFor(() => { expect(checkCalls(f)).toBe(2); });
  });
});

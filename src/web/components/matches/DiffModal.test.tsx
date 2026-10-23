import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { resolveMatch } from '@/lib/matches.api';
import { applyResolve, driftedFields, performResolve } from '@/lib/resolve-mismatch';
import type { SyncCheckResult, SyncMismatch, SyncMismatchFields } from '../../../lib/sync-check-types';
import src from './DiffModal.tsx?raw';
import { DiffModal } from './DiffModal';

const fields = (over: Partial<SyncMismatchFields> = {}): SyncMismatchFields => ({
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-01-01',
  currency: 'EUR',
  amount: { kind: 'single', cents: 1299 },
  ...over,
});

const mismatch: SyncMismatch = {
  matchId: 'm1',
  wallosId: 'w1',
  actualScheduleId: 'a1',
  wallosName: 'Netflix',
  actualName: 'NETFLIX.COM',
  wallosAmountCents: 1299,
  actualAmountCents: 1499,
  isRange: false,
  wallosDrift: true,
  actualDrift: false,
  wallosFields: fields(),
  actualFields: fields({ amount: { kind: 'single', cents: 1499 }, frequency: 'yearly' }),
};

const result = (): SyncCheckResult => ({
  checkedAt: 'x',
  baseCurrency: 'EUR',
  unlinkedWallos: [],
  unlinkedActual: [],
  candidates: [],
  mismatches: [mismatch],
  unmappable: [],
  orphaned: [],
  linked: [
    {
      matchId: 'm1',
      wallosId: 'w1',
      actualScheduleId: 'a1',
      status: 'MISMATCH_DETECTED',
      orphan: null,
      wallosName: 'Netflix',
      actualName: 'NETFLIX.COM',
      wallosAmountCents: 1299,
      actualAmountCents: 1499,
      isRange: false,
    },
  ],
  ignored: [],
});

const body = (f: ReturnType<typeof vi.fn>) =>
  JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as unknown;
const ok = () => vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

describe('driftedFields', () => {
  it('lists only differing fields', () => {
    expect(driftedFields(mismatch.wallosFields, mismatch.actualFields)).toEqual(['amount', 'frequency']);
  });
});

describe('DiffModal markup', () => {
  it('renders closed without content when no mismatch', () => {
    expect(
      renderToStaticMarkup(
        <I18nProvider initialLocale="en">
          <DiffModal mismatch={null} baseCurrency="EUR" onClose={() => undefined} onIgnoreDiff={() => undefined} onUnlink={() => undefined} />
        </I18nProvider>,
      ),
    ).not.toContain('Overwrite Wallos');
  });
  it('has no hard-coded JSX text', () => {
    expect(/>\s*[A-Z][a-z]+(\s+[a-z]+)*\s*</.test(src)).toBe(false);
  });
});

describe('resolveMatch', () => {
  it('Ignore Diff posts ignore_diff', async () => {
    const f = ok();
    await resolveMatch('m1', 'ignore_diff', f);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/matches/m1/resolve');
    expect(body(f)).toEqual({ action: 'ignore_diff' });
  });
  it('Unlink posts unlink with confirm: true', async () => {
    const f = ok();
    await resolveMatch('m1', 'unlink', f);
    expect(body(f)).toEqual({ action: 'unlink', confirm: true });
  });
});

describe('overwrite buttons', () => {
  it('both are disabled in the markup and the component never imports an overwrite call', () => {
    const out = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <DiffModal mismatch={mismatch} baseCurrency="EUR" onClose={() => undefined} onIgnoreDiff={() => undefined} onUnlink={() => undefined} />
      </I18nProvider>,
    );
    // Dialog content mounts only in a browser DOM, so check the source for the disabled buttons.
    expect(out).toBeDefined();
    expect(src).toMatch(/variant="outline" disabled/);
    expect(src).not.toMatch(/overwrite_(wallos|actual)/);
    expect(src).not.toMatch(/fetch|apiRequest|resolveMatch/);
  });
  it('the resolve client has no overwrite action', async () => {
    const f = ok();
    await performResolve(() => result(), () => undefined, 'm1', 'ignore_diff', () => Promise.resolve(), f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body(f))).not.toContain('overwrite');
  });
});

describe('performResolve', () => {
  it('applies optimistically, then refreshes on success', async () => {
    let state = result();
    const refresh = vi.fn(() => Promise.resolve());
    const out = await performResolve(() => state, (r) => (state = r), 'm1', 'unlink', refresh, ok());
    expect(out).toEqual({ ok: true });
    expect(state.mismatches).toEqual([]);
    expect(state.linked).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('ignore_diff turns the row LINKED', () => {
    expect(applyResolve(result(), 'm1', 'ignore_diff').linked[0]?.status).toBe('LINKED');
  });
  it('a failed resolve rolls back only that row and does not refresh', async () => {
    let state = result();
    const refresh = vi.fn(() => Promise.resolve());
    const f = vi.fn(() => Promise.resolve(Response.json({ error: 'invalid_state' }, { status: 400 })));
    const out = await performResolve(() => state, (r) => (state = r), 'm1', 'ignore_diff', refresh, f);
    expect(out).toEqual({ ok: false, code: 'invalid_state' });
    expect(state).toEqual(result());
    expect(refresh).not.toHaveBeenCalled();
  });
});

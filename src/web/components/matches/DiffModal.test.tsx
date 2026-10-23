import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { resolveMatch } from '@/lib/matches.api';
import { applyResolve, driftedFields, performResolve } from '@/lib/resolve-mismatch';
import type { SyncCheckResult, SyncMismatch, SyncMismatchFields } from '../../../lib/sync-check-types';
import src from './DiffModal.tsx?raw';
import { DiffModal } from './DiffModal';
import { diffModalMessages, isOverwriteErrorCode, OVERWRITE_ERROR_CODES } from './DiffModal.messages';

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
          <DiffModal mismatch={null} baseCurrency="EUR" onClose={() => undefined} onIgnoreDiff={() => undefined} onOverwrite={() => undefined} onUnlink={() => undefined} />
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
  it('are enabled, and only the confirmation action calls onOverwrite', () => {
    expect(src).not.toMatch(/disabled/);
    expect(src).not.toMatch(/fetch|apiRequest|resolveMatch/);
    // onOverwrite appears once in the call position: inside the AlertDialogAction onClick.
    expect(src.match(/onOverwrite\(mismatch\.matchId, action\)/g)).toHaveLength(1);
    const confirmBlock = src.slice(src.indexOf('<AlertDialogAction'), src.indexOf('</AlertDialogAction>'));
    expect(confirmBlock).toContain('onOverwrite(mismatch.matchId, action)');
    const cancelBlock = src.slice(src.indexOf('<AlertDialogCancel'), src.indexOf('</AlertDialogCancel>'));
    expect(cancelBlock).not.toContain('onOverwrite');
    expect(src).toContain("'overwrite_wallos'");
    expect(src).toContain("'overwrite_actual'");
  });
  it.each(['overwrite_wallos', 'overwrite_actual'] as const)('%s sends the action with confirm true, once', async (action) => {
    const f = ok();
    const refresh = vi.fn(() => Promise.resolve());
    expect(f).not.toHaveBeenCalled(); // nothing is sent until the confirmation calls performResolve
    const out = await performResolve(() => result(), () => undefined, 'm1', action, refresh, f);
    expect(out).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/matches/m1/resolve');
    expect(body(f)).toEqual({ action, confirm: true });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('a failed overwrite rolls back only that row', async () => {
    const other = { ...mismatch, matchId: 'm2' };
    let state: SyncCheckResult = { ...result(), mismatches: [mismatch, other] };
    const before = state;
    const f = vi.fn(() => Promise.resolve(Response.json({ error: 'overwrite_unverified' }, { status: 409 })));
    const refresh = vi.fn(() => Promise.resolve());
    const out = await performResolve(() => state, (r) => (state = r), 'm1', 'overwrite_wallos', refresh, f);
    expect(out).toEqual({ ok: false, code: 'overwrite_unverified' });
    expect(state.mismatches.map((m) => m.matchId).sort()).toEqual(['m1', 'm2']);
    expect(state.linked).toEqual(before.linked);
    expect(refresh).not.toHaveBeenCalled();
  });
  it.each(OVERWRITE_ERROR_CODES)('maps %s to a fixed en and nl message', (code) => {
    expect(isOverwriteErrorCode(code)).toBe(true);
    for (const l of ['en', 'nl'] as const) {
      const msg = diffModalMessages[l].overwriteErrors[code];
      expect(msg.length).toBeGreaterThan(10);
    }
    expect(diffModalMessages.en.overwriteErrors[code]).not.toBe(diffModalMessages.nl.overwriteErrors[code]);
  });
  it('unknown server text is not a mapped code', () => {
    expect(isOverwriteErrorCode('boom: raw server text')).toBe(false);
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

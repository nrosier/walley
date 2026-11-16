// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SyncCheckResult, SyncLinked } from '../../../lib/sync-check-types';
import { cleanupDashboard, mountDashboard, tabbables } from '../../a11y.helpers';
import type { Locale } from '@/i18n';

// The within-rate-margin hint on a Synced row (#229): text, wiring to the cell toolbar, no extra tab stop.

afterEach(cleanupDashboard);

const pair = (over: Partial<SyncLinked> = {}): SyncLinked => ({
  matchId: 'm-us',
  wallosId: 'w-us',
  actualScheduleId: 'a-us',
  status: 'LINKED',
  orphan: null,
  wallosName: 'Hosting',
  actualName: 'Hosting EU',
  wallosAmountCents: -1238,
  actualAmountCents: -1250,
  isRange: false,
  relinkCandidateIds: [],
  rateMargin: { differenceCents: 12, marginCents: 25, marginPercent: 2 },
  ...over,
});

const result = (baseCurrency: string, link: SyncLinked): SyncCheckResult => ({
  checkedAt: '2026-01-01T00:00:00Z',
  baseCurrency,
  unlinkedWallos: [],
  unlinkedActual: [],
  candidates: [],
  mismatches: [],
  linked: [link],
  ignored: [],
  unmappable: [],
  orphaned: [],
});

const mount = (locale: Locale, link: SyncLinked, baseCurrency = 'EUR') => mountDashboard({ locale, result: result(baseCurrency, link) });
function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected an element');
  return v;
}
const toolbar = (id: string) => must(document.querySelector<HTMLElement>(`[role="toolbar"][data-row-id="${id}"]`));
const hintOf = () => document.querySelector<HTMLElement>('[data-rate-margin]');
const hintEl = () => must(hintOf());

describe('Synced row rate-margin hint (#229)', () => {
  it('shows the amount and percent in en, wired to the Wallos toolbar after the arrow hint', async () => {
    await mount('en', pair());
    const hint = hintEl();
    expect(hint.textContent).toBe('Within rate margin: €0.12 (1.0%)');
    expect(hint.id).not.toBe('');
    expect(hint.className).toContain('text-xs');
    expect(hint.className).toContain('text-muted');
    expect(hint.closest('[role="toolbar"]')).toBe(toolbar('w-us'));
    expect(toolbar('w-us').getAttribute('aria-describedby')).toBe(`row-arrow-hint ${hint.id}`);
    expect(document.getElementById('row-arrow-hint')).not.toBeNull();
    expect(toolbar('a-us').getAttribute('aria-describedby')).toBe('row-arrow-hint');
    expect(screen.getAllByText('Synced').length).toBeGreaterThan(0);
    expect(screen.queryByText('Mismatch')).toBeNull();
    expect(hint.closest('[role="status"],[aria-live]')).toBeNull();
  });

  it('shows the Dutch text', async () => {
    await mount('nl', pair());
    expect(hintEl().textContent).toMatch(/^Binnen de koersmarge: €\s?0,12 \(1,0\s?%\)$/);
  });

  it('leaves out the percent when the Actual amount is 0', async () => {
    await mount('en', pair({ actualAmountCents: 0, wallosAmountCents: -1, rateMargin: { differenceCents: 1, marginCents: 2, marginPercent: 2 } }));
    expect(hintEl().textContent).toBe('Within rate margin: €0.01');
  });

  it('formats a 0-decimal currency (JPY)', async () => {
    await mount('en', pair({ actualAmountCents: -1000, wallosAmountCents: -1012, rateMargin: { differenceCents: 12, marginCents: 20, marginPercent: 2 } }), 'JPY');
    expect(hintEl().textContent).toBe('Within rate margin: ¥12 (1.2%)');
  });

  it('is absent without rateMargin and the toolbar keeps only the arrow hint', async () => {
    const withMargin = pair();
    const plain: SyncLinked = Object.fromEntries(Object.entries(withMargin).filter(([k]) => k !== 'rateMargin')) as unknown as SyncLinked;
    await mount('en', plain);
    expect(hintOf()).toBeNull();
    expect(toolbar('w-us').getAttribute('aria-describedby')).toBe('row-arrow-hint');
  });

  it('adds no tab stop: one per cell, the hint is not focusable', async () => {
    await mount('en', pair());
    const hint = hintEl();
    const stops = tabbables(document.body);
    expect(stops).not.toContain(hint);
    expect(stops.filter((el) => el.closest('[data-row-id="w-us"]') !== null)).toHaveLength(1);
    expect(hint.hasAttribute('tabindex')).toBe(false);
  });
});

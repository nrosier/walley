import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import type { RowModel } from '@/lib/sync-check';
import { buildRows } from '@/lib/sync-check';
import { sample } from '@/lib/sync-check.test';
import { ItemRow } from './ItemRow';

const row = (extra: Partial<RowModel> = {}): RowModel => ({
  id: 'w1',
  name: 'Netflix',
  amountCents: 1299,
  isRange: false,
  reason: null,
  ignored: false,
  matchId: null,
  ...extra,
});

const render = (r: RowModel, side: 'wallos' | 'actual', locale: Locale) =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <ul>
        <ItemRow row={r} side={side} baseCurrency="EUR" candidates={[]} createLabel="Create" />
      </ul>
    </I18nProvider>,
  );

describe('ItemRow billing cycle (#136)', () => {
  it('shows the cycle next to the amount on an unlinked Wallos row, in en and nl', () => {
    const r = row({ cycle: { key: 'custom_days', count: 7 } });
    const en = render(r, 'wallos', 'en');
    expect(en).toMatch(/font-mono[^>]*>€12\.99<\/span><span[^>]*data-cycle="custom_days"[^>]*>Every 7 days<\/span>/);
    const nl = render(r, 'wallos', 'nl');
    expect(nl).toMatch(/data-cycle="custom_days"[^>]*>Elke 7 dagen<\/span>/);
    expect(nl).not.toContain('Every 7 days');
  });

  it('shows the same cycle on an unlinked Actual row, keeping font-mono on the amount only', () => {
    const html = render(row({ id: 'a1', cycle: { key: 'monthly', count: 1 } }), 'actual', 'en');
    expect(html).toContain('>Every month<');
    expect(html.match(/font-mono/g)).toHaveLength(1);
    expect(html.match(/<button[^>]*>(Create|Link)<\/button>/g)).toHaveLength(1);
  });

  it('shows no cycle on a row without one or on an ignored row', () => {
    expect(render(row(), 'wallos', 'en')).not.toContain('data-cycle');
    const ignored = row({ ignored: true, matchId: 'm1', cycle: { key: 'yearly', count: 1 } });
    expect(render(ignored, 'wallos', 'en')).not.toContain('data-cycle');
  });

  it('carries the cycle of an unlinked item into its row and leaves ignored rows unchanged', () => {
    const result = {
      ...sample(),
      unlinkedWallos: [{ id: 'w1', name: 'Netflix', amountCents: 1299, isRange: false, reason: null, cycle: { key: 'yearly' as const, count: 1 } }],
    };
    expect(buildRows(result, 'wallos', '', true).map((r) => [r.id, r.ignored, r.cycle])).toEqual([
      ['w1', false, { key: 'yearly', count: 1 }],
      ['w9', true, undefined],
    ]);
  });
});

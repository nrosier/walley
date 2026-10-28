import { describe, expect, it } from 'vitest';
import { billingCycleOf } from '../../lib/billing-cycle';
import { wallosToActual } from '../../lib/frequency-mapper';
import { createT } from '@/i18n/translate';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { cycleLabel } from './billing-cycle-label';

describe('cycleLabel (#136)', () => {
  it('gives the same label for the same input on the Wallos side and the Actual side, in en and nl', () => {
    for (const locale of ['en', 'nl'] as const) {
      const t = createT(syncDashboardMessages, locale);
      const fromWallos = wallosToActual({ type: 'custom_days', days: 7 });
      const wallosCycle = billingCycleOf(fromWallos.frequency, fromWallos.interval);
      const actualCycle = billingCycleOf('daily', 7);
      if (wallosCycle === null || actualCycle === null) throw new Error('cycle expected');
      expect(wallosCycle).toEqual(actualCycle);
      expect(cycleLabel(t, wallosCycle)).toBe(cycleLabel(t, actualCycle));
    }
  });

  it('labels each key, singular and plural, in en and nl', () => {
    const en = createT(syncDashboardMessages, 'en');
    const nl = createT(syncDashboardMessages, 'nl');
    expect(cycleLabel(en, { key: 'monthly', count: 1 })).toBe('Every month');
    expect(cycleLabel(en, { key: 'yearly', count: 1 })).toBe('Every year');
    expect(cycleLabel(en, { key: 'weekly', count: 2 })).toBe('Every 2 weeks');
    expect(cycleLabel(en, { key: 'custom_days', count: 7 })).toBe('Every 7 days');
    expect(cycleLabel(nl, { key: 'monthly', count: 1 })).toBe('Elke maand');
    expect(cycleLabel(nl, { key: 'yearly', count: 3 })).toBe('Elke 3 jaar');
    expect(cycleLabel(nl, { key: 'custom_days', count: 7 })).toBe('Elke 7 dagen');
  });
});

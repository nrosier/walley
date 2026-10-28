import { describe, expect, it } from 'vitest';
import { billingCycleOf } from './billing-cycle.js';
import { wallosToActual, type WallosInterval } from './frequency-mapper.js';

describe('billingCycleOf (#136)', () => {
  const cases: [WallosInterval, { key: string; count: number }][] = [
    [{ type: 'monthly', every: 1 }, { key: 'monthly', count: 1 }],
    [{ type: 'yearly', every: 2 }, { key: 'yearly', count: 2 }],
    [{ type: 'weekly', every: 3 }, { key: 'weekly', count: 3 }],
    [{ type: 'custom_days', days: 45 }, { key: 'custom_days', count: 45 }],
  ];

  it.each(cases)('gives the same cycle for the Wallos interval %j and its Actual recurrence', (wallos, cycle) => {
    const actual = wallosToActual(wallos);
    expect(billingCycleOf(actual.frequency, actual.interval)).toEqual(cycle);
  });

  it('folds a missing Actual interval to 1', () => {
    expect(billingCycleOf('monthly')).toEqual({ key: 'monthly', count: 1 });
  });

  it('returns null for an unknown frequency or a bad interval', () => {
    expect(billingCycleOf('hourly')).toBeNull();
    expect(billingCycleOf('monthly', 0)).toBeNull();
    expect(billingCycleOf('monthly', 1.5)).toBeNull();
  });
});

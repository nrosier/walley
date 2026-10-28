import { describe, expect, it } from 'vitest';
import { actualToWallos } from '../../../lib/frequency-mapper.js';
import {
  nextPaymentFor,
  priceToMinorUnits,
  readBillingCycle,
  readPrice,
  readStartDate,
  readTitle,
  recurrenceWithBillingCycle,
} from './create-fields.js';
import { buildWallosSubscriptionPayload } from './write.js';

describe('readTitle (#133)', () => {
  it('trims and accepts 1 to 200 characters', () => {
    expect(readTitle('  Netflix  ')).toBe('Netflix');
    expect(readTitle('x'.repeat(200))).toBe('x'.repeat(200));
  });
  it('is undefined when absent or null, false when invalid', () => {
    expect(readTitle(undefined)).toBeUndefined();
    expect(readTitle(null)).toBeUndefined();
    for (const bad of ['', '   ', 'x'.repeat(201), 5, ['a'], {}]) expect(readTitle(bad)).toBe(false);
  });
});

describe('readPrice (#133)', () => {
  it('accepts a positive decimal string or number', () => {
    expect(readPrice('12.50')).toBe('12.50');
    expect(readPrice(' 8 ')).toBe('8');
    expect(readPrice(12.5)).toBe('12.5');
  });
  it('is undefined when absent or null, false when invalid', () => {
    expect(readPrice(undefined)).toBeUndefined();
    expect(readPrice(null)).toBeUndefined();
    for (const bad of ['', 'abc', '-1', '0', '0.00', '1,5', '1e3', '.5', '1.', 0, -2, NaN, Infinity, 1e-7, 1e21, true, [], {}]) {
      expect(readPrice(bad)).toBe(false);
    }
  });
});

describe('readBillingCycle (#133)', () => {
  it.each(['monthly', 'yearly', 'weekly', 'custom_days'] as const)('accepts %s', (cycle) => {
    expect(readBillingCycle(cycle)).toBe(cycle);
  });
  it('is undefined when absent, false for anything else', () => {
    expect(readBillingCycle(undefined)).toBeUndefined();
    expect(readBillingCycle(null)).toBeUndefined();
    for (const bad of ['daily', 'Monthly', '', 3, ['monthly'], {}]) expect(readBillingCycle(bad)).toBe(false);
  });
});

describe('readStartDate (#133)', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(readStartDate('2026-02-28')).toBe('2026-02-28');
    expect(readStartDate('2028-02-29')).toBe('2028-02-29');
  });
  it('is undefined when absent, false for anything else', () => {
    expect(readStartDate(undefined)).toBeUndefined();
    expect(readStartDate(null)).toBeUndefined();
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '01-02-2026', '2026-02-28T00:00:00Z', '', 20260228, {}]) {
      expect(readStartDate(bad)).toBe(false);
    }
  });
});

describe('priceToMinorUnits uses the currency exponent (#133)', () => {
  it.each([
    ['12.50', 'EUR', 1250],
    ['12.5', 'EUR', 1250],
    ['12', 'USD', 1200],
    ['0.01', 'EUR', 1],
    ['1250', 'JPY', 1250],
    ['1250', 'KRW', 1250],
    ['1250.0', 'JPY', 1250],
    ['12.500', 'EUR', 1250],
    ['1.005', 'XYZ', null],
  ] as const)('%s %s -> %s', (price, code, expected) => {
    expect(priceToMinorUnits(price, code)).toBe(expected);
  });
  it('refuses more decimals than the currency has instead of rounding', () => {
    expect(priceToMinorUnits('12.505', 'EUR')).toBeNull();
    expect(priceToMinorUnits('12.5', 'JPY')).toBeNull();
  });
  it('is case-insensitive on the code', () => {
    expect(priceToMinorUnits('500', ' jpy ')).toBe(500);
  });
  it('feeds the payload builder: EUR keeps two places, JPY none', () => {
    const base = { name: 'X', currencyId: '1', recurrence: { frequency: 'monthly' as const }, startDate: null, nextPaymentDate: '2026-11-01' };
    expect(buildWallosSubscriptionPayload({ ...base, priceCents: -1250 }, 2).price).toBe('12.50');
    expect(buildWallosSubscriptionPayload({ ...base, priceCents: -1250 }, 0).price).toBe('1250');
  });
});

describe('recurrenceWithBillingCycle maps all four Wallos values (#133)', () => {
  it.each([
    ['monthly', { frequency: 'monthly', interval: 2 }, { type: 'monthly', every: 2 }],
    ['yearly', { frequency: 'yearly', interval: 2 }, { type: 'yearly', every: 2 }],
    ['weekly', { frequency: 'weekly', interval: 2 }, { type: 'weekly', every: 2 }],
    ['custom_days', { frequency: 'daily', interval: 2 }, { type: 'custom_days', days: 2 }],
  ] as const)('%s keeps the count and goes through the mapper', (cycle, recurrence, wallos) => {
    const out = recurrenceWithBillingCycle({ frequency: 'monthly', interval: 2 }, cycle);
    expect(out).toEqual(recurrence);
    expect(actualToWallos(out)).toEqual(wallos);
  });
  it('treats a missing interval as 1', () => {
    expect(recurrenceWithBillingCycle({ frequency: 'weekly' }, 'yearly')).toEqual({ frequency: 'yearly', interval: 1 });
  });
  it('still refuses patterns', () => {
    expect(() => recurrenceWithBillingCycle({ frequency: 'monthly', patterns: [{}] }, 'weekly')).toThrow(
      expect.objectContaining({ code: 'patterns_unsupported' }),
    );
  });
});

describe('nextPaymentFor (#133)', () => {
  it('never precedes the start date', () => {
    expect(nextPaymentFor('2026-11-01', '2026-12-05')).toBe('2026-12-05');
    expect(nextPaymentFor('2026-11-01', '2026-01-05')).toBe('2026-11-01');
  });
});

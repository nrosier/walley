import { describe, expect, it } from 'vitest';
import { convertPriceCents, CurrencyConversionError } from './currency-convert.js';
import { resolveBaseConversion } from './currency-prepare.js';

const LIST = [
  { code: 'EUR', rate: '1.0000' },
  { code: 'usd', rate: '1.1000' },
  { code: 'GBP', rate: '0.8500' },
  { code: 'XXX' },
];

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof CurrencyConversionError) return err.code;
    throw err;
  }
  return undefined;
}

describe('resolveBaseConversion', () => {
  it('uses the Wallos rates without an override', () => {
    const rates = resolveBaseConversion(LIST, 'USD', 'GBP');
    expect(rates).toEqual({ fromRate: 1.1, baseRate: 0.85 });
    // -11.00 USD -> GBP: -1100 * 0.85 / 1.1 = -850.
    expect(convertPriceCents(-1100, rates.fromRate, rates.baseRate)).toBe(-850);
  });

  it('lets the override replace the subscription currency rate', () => {
    const rates = resolveBaseConversion(LIST, 'USD', 'EUR', '1.25');
    expect(rates).toEqual({ fromRate: 1.25, baseRate: 1 });
    expect(convertPriceCents(-1250, rates.fromRate, rates.baseRate)).toBe(-1000);
  });

  it('is the identity when the codes match, override ignored', () => {
    expect(resolveBaseConversion(LIST, 'eur', 'EUR', '2')).toEqual({ fromRate: 1, baseRate: 1 });
  });

  it('accepts an override for a currency with no Wallos rate', () => {
    expect(resolveBaseConversion(LIST, 'XXX', 'EUR', 3).fromRate).toBe(3);
  });

  it('throws missing_rate when the base code is not in the list', () => {
    expect(codeOf(() => resolveBaseConversion(LIST, 'USD', 'JPY'))).toBe('missing_rate');
    expect(codeOf(() => resolveBaseConversion(LIST, 'USD', 'XXX'))).toBe('missing_rate');
  });

  it('throws missing_rate when the subscription currency has no rate and no override', () => {
    expect(codeOf(() => resolveBaseConversion(LIST, 'XXX', 'EUR'))).toBe('missing_rate');
    expect(codeOf(() => resolveBaseConversion(LIST, 'CHF', 'EUR'))).toBe('missing_rate');
  });

  it('throws invalid_rate for a bad override', () => {
    expect(codeOf(() => resolveBaseConversion(LIST, 'USD', 'EUR', '0'))).toBe('invalid_rate');
  });
});

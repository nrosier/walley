import { describe, expect, it } from 'vitest';
import { currencyExponent, DEFAULT_CURRENCY_EXPONENT } from './currency-exponent.js';

describe('currencyExponent', () => {
  it('uses 0 for zero-decimal currencies and 2 for EUR and USD', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
    expect(currencyExponent('EUR')).toBe(2);
    expect(currencyExponent('USD')).toBe(2);
  });

  it('trims and ignores case', () => {
    expect(currencyExponent(' jpy ')).toBe(0);
  });

  it('falls back to the default for an unknown code', () => {
    expect(currencyExponent('XYZ')).toBe(DEFAULT_CURRENCY_EXPONENT);
  });
});

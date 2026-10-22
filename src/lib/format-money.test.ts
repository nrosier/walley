import { describe, expect, it } from 'vitest';
import { formatMoney } from './format-money.js';

describe('formatMoney', () => {
  it('formats EUR 1250 cents as €12.50 in en-US', () => {
    expect(formatMoney(1250, 'EUR', 'en-US')).toBe('€12.50');
  });

  it('keeps the sign for negative amounts', () => {
    const result = formatMoney(-1250, 'EUR', 'en-US');
    expect(result).toBe('-€12.50');
    expect(result.startsWith('-')).toBe(true);
  });

  it('formats zero', () => {
    expect(formatMoney(0, 'EUR', 'en-US')).toBe('€0.00');
  });

  it('treats negative zero as zero', () => {
    expect(formatMoney(-0, 'EUR', 'en-US')).toBe('€0.00');
  });

  it('throws RangeError for a non-integer value', () => {
    expect(() => formatMoney(12.5, 'EUR', 'en-US')).toThrow(RangeError);
  });

  it('throws RangeError for non-finite values', () => {
    expect(() => formatMoney(Number.NaN, 'EUR', 'en-US')).toThrow(RangeError);
    expect(() => formatMoney(Number.POSITIVE_INFINITY, 'EUR', 'en-US')).toThrow(RangeError);
  });

  it('formats zero-decimal JPY 1250 as 1,250 without decimals', () => {
    expect(formatMoney(1250, 'JPY', 'en-US')).toBe('¥1,250');
  });

  it('formats EUR with the nl locale', () => {
    expect(formatMoney(1250, 'EUR', 'nl')).toBe('€ 12,50');
  });
});

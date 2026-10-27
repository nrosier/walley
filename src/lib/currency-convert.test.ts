import { describe, expect, it } from 'vitest';
import {
  CurrencyConversionError,
  convertPriceCents,
  parseRate,
  selectRate,
} from './currency-convert.js';

/** Returns the thrown CurrencyConversionError code, or fails when nothing is thrown. */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error: unknown) {
    if (error instanceof CurrencyConversionError) return error.code;
    throw error;
  }
  throw new Error('expected a CurrencyConversionError');
}

describe('convertPriceCents', () => {
  it('converts between currencies on the Wallos scale (base / from)', () => {
    // 10.00 in a currency with rate 1.1 per base unit is 9.09 base, so 909 cents.
    expect(convertPriceCents(1000, 1.1, 1)).toBe(909);
    // 10.00 base is 11.00 in a currency with rate 1.1.
    expect(convertPriceCents(1000, 1, 1.1)).toBe(1100);
  });

  it('returns the same cents when the rates are equal', () => {
    expect(convertPriceCents(1250, 1.1, 1.1)).toBe(1250);
  });

  it('rounds half away from zero', () => {
    // 1 cent at rate 1 to rate 2 is exactly 2 cents.
    expect(convertPriceCents(1, 1, 2)).toBe(2);
    // 5 cents at rate 1 to rate 0.5 is exactly 2.5 cents, which rounds to 3.
    expect(convertPriceCents(5, 1, 0.5)).toBe(3);
    expect(convertPriceCents(-5, 1, 0.5)).toBe(-3);
  });

  it('corrects float error on an exact half', () => {
    // 100 cents * 1.005 is exactly 100.5 cents, but the float product is 100.49999999999999.
    // It must round to 101, not 100.
    expect(convertPriceCents(100, 1, 1.005)).toBe(101);
  });

  it('keeps the sign of a negative (expense) amount', () => {
    // -12.50 expense at rate 1 to rate 1.1: -13.75 -> -1375.
    expect(convertPriceCents(-1250, 1, 1.1)).toBe(-1375);
    // -12.50 expense at rate 1.1 to rate 1: -11.36 -> -1136.
    expect(convertPriceCents(-1250, 1.1, 1)).toBe(-1136);
  });

  it('rescales between currencies with different minor units', () => {
    // JPY 1250 (exponent 0) at JPY rate 160 per EUR is EUR 7.81 -> 781 cents.
    expect(convertPriceCents(-1250, 160, 1, 0, 2)).toBe(-781);
    // EUR 10.00 (1000 cents) at JPY rate 160 is JPY 1600.
    expect(convertPriceCents(-1000, 1, 160, 2, 0)).toBe(-1600);
    // Same currency, exponent 0 on both sides: unchanged.
    expect(convertPriceCents(-1250, 1, 1, 0, 0)).toBe(-1250);
  });

  it('never returns negative zero', () => {
    expect(Object.is(convertPriceCents(0, 1.1, 1), 0)).toBe(true);
    expect(Object.is(convertPriceCents(0, 1, 1), 0)).toBe(true);
  });

  it('throws invalid_amount for a non-integer or unsafe amount', () => {
    expect(codeOf(() => convertPriceCents(12.5, 1, 1))).toBe('invalid_amount');
    expect(codeOf(() => convertPriceCents(Number.NaN, 1, 1))).toBe('invalid_amount');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '', 'abc', '1e3', '-1.1'])(
    'throws invalid_rate for %p on either side',
    (rate) => {
      expect(codeOf(() => convertPriceCents(1000, rate as number, 1))).toBe('invalid_rate');
      expect(codeOf(() => convertPriceCents(1000, 1, rate as number))).toBe('invalid_rate');
    },
  );
});

describe('parseRate', () => {
  it('parses a Wallos decimal string', () => {
    expect(parseRate('1.1000')).toBe(1.1);
    expect(parseRate(' 150 ')).toBe(150);
  });

  it('rejects zero, negatives and malformed input', () => {
    expect(codeOf(() => parseRate('0'))).toBe('invalid_rate');
    expect(codeOf(() => parseRate('-2'))).toBe('invalid_rate');
    expect(codeOf(() => parseRate('1,5'))).toBe('invalid_rate');
  });
});

describe('selectRate', () => {
  it('uses the Wallos rate when there is no override', () => {
    expect(selectRate({ wallosRate: '1.1000' })).toBe(1.1);
    expect(selectRate({ override: null, wallosRate: '1.1000' })).toBe(1.1);
  });

  it('lets an override win over the Wallos rate', () => {
    expect(selectRate({ override: '1.0850', wallosRate: '1.1000' })).toBe(1.085);
  });

  it('throws missing_rate when neither is present', () => {
    expect(codeOf(() => selectRate({}))).toBe('missing_rate');
  });

  it('does not fall back to the Wallos rate when the override is invalid', () => {
    expect(codeOf(() => selectRate({ override: '0', wallosRate: '1.1000' }))).toBe('invalid_rate');
  });
});

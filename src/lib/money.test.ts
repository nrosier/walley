import { describe, expect, it } from 'vitest';
import { fromActualCents, toActualCents } from './money.js';

describe('toActualCents', () => {
  it('negates an expense', () => {
    expect(toActualCents(12.5, { expense: true })).toBe(-1250);
  });

  it('keeps a negative amount expense as a negative cent value', () => {
    expect(toActualCents(-12.5, { expense: true })).toBe(1250);
  });

  it('rounds half away from zero', () => {
    expect(toActualCents(0.005, { expense: false })).toBe(1);
    expect(toActualCents(-0.005, { expense: false })).toBe(-1);
  });

  it('corrects binary float error', () => {
    expect(toActualCents(1.005, { expense: false })).toBe(101);
  });

  it('never returns -0', () => {
    const result = toActualCents(0, { expense: true });
    expect(result).toBe(0);
    expect(Object.is(result, -0)).toBe(false);
  });

  it('round trips two-decimal values', () => {
    for (const value of [0.01, 19.99, 1234.56]) {
      expect(fromActualCents(toActualCents(value, { expense: false }))).toBe(value);
    }
  });

  it('round trips expense values through negative cents', () => {
    expect(toActualCents(12.5, { expense: true })).toBe(-1250);
    expect(fromActualCents(-1250)).toBe(-12.5);
    for (const value of [12.5, 19.99, 1234.56]) {
      const cents = toActualCents(value, { expense: true });
      expect(cents).toBeLessThan(0);
      expect(fromActualCents(cents)).toBe(-value);
    }
  });

  it('throws a fixed RangeError for NaN and Infinity', () => {
    for (const value of [NaN, Infinity]) {
      expect(() => toActualCents(value, { expense: false })).toThrow(RangeError);
      expect(() => toActualCents(value, { expense: false })).toThrow(
        /^Amount must be a finite number$/,
      );
      expect(() => toActualCents(value, { expense: false })).not.toThrow(String(value));
    }
  });
});

describe('fromActualCents', () => {
  it('throws RangeError for a non-integer', () => {
    expect(() => fromActualCents(1.5)).toThrow(RangeError);
  });
});

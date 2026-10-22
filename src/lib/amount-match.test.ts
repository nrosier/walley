import { describe, expect, it } from 'vitest';
import { DEFAULT_TOLERANCE_PERCENT, amountWithinTolerance, rangeMidpointCents } from './amount-match.js';

describe('amountWithinTolerance', () => {
  it('matches 1000 and 1049 at 5 percent', () => {
    expect(amountWithinTolerance(1000, 1049, 5)).toBe(true);
  });

  it('does not match 1000 and 1060 at 5 percent', () => {
    expect(amountWithinTolerance(1000, 1060, 5)).toBe(false);
  });

  it('defaults to 5 percent', () => {
    expect(DEFAULT_TOLERANCE_PERCENT).toBe(5);
  });

  it('requires equality at 0 percent', () => {
    expect(amountWithinTolerance(1000, 1000, 0)).toBe(true);
    expect(amountWithinTolerance(1000, 1001, 0)).toBe(false);
  });

  it('uses the larger amount as the base, so both directions agree', () => {
    // 50 / 1050 is within 5 percent; 50 / 1000 is exactly 5 percent.
    expect(amountWithinTolerance(1000, 1050, 5)).toBe(true);
    expect(amountWithinTolerance(1050, 1000, 5)).toBe(true);
    // 52 / 1052 is within 5 percent of the larger, but 52 / 1000 is not within 5 percent of the smaller.
    expect(amountWithinTolerance(1000, 1052, 5)).toBe(true);
    expect(amountWithinTolerance(1052, 1000, 5)).toBe(true);
    expect(amountWithinTolerance(1000, 1060, 5)).toBe(amountWithinTolerance(1060, 1000, 5));
  });

  it('compares absolute values', () => {
    expect(amountWithinTolerance(-1000, 1049, 5)).toBe(true);
    expect(amountWithinTolerance(-1000, -1060, 5)).toBe(false);
  });

  it('handles fractional tolerance exactly', () => {
    expect(amountWithinTolerance(1000, 1025, 2.5)).toBe(true);
    expect(amountWithinTolerance(1000, 1026, 2.5)).toBe(false);
  });

  it('rejects non-integer cents and out-of-range tolerance', () => {
    expect(() => amountWithinTolerance(10.5, 10, 5)).toThrow(RangeError);
    expect(() => amountWithinTolerance(10, 10, -1)).toThrow(RangeError);
    expect(() => amountWithinTolerance(10, 10, 101)).toThrow(RangeError);
    expect(() => amountWithinTolerance(10, 10, Number.NaN)).toThrow(RangeError);
  });
});

describe('rangeMidpointCents', () => {
  it('rounds an odd sum half away from zero', () => {
    expect(rangeMidpointCents(100, 101)).toBe(101);
    expect(rangeMidpointCents(101, 100)).toBe(101);
  });

  it('keeps the sign of a negative range', () => {
    expect(rangeMidpointCents(-100, -200)).toBe(-150);
    expect(rangeMidpointCents(-100, -101)).toBe(-101);
  });

  it('returns the exact midpoint for an even sum', () => {
    expect(rangeMidpointCents(1000, 2000)).toBe(1500);
    expect(rangeMidpointCents(-1, 1)).toBe(0);
  });

  it('rejects non-integer bounds', () => {
    expect(() => rangeMidpointCents(1.5, 2)).toThrow(RangeError);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CURRENCY_DRIFT_STEP,
  DEFAULT_CURRENCY_DRIFT_PERCENT,
  DEFAULT_TOLERANCE_PERCENT,
  MAX_CURRENCY_DRIFT_PERCENT,
  MIN_CURRENCY_DRIFT_PERCENT,
  RATE_MARGIN_FLOOR_MINOR_UNITS,
  amountWithinTolerance,
  rangeMidpointCents,
  rateMarginUnits,
  withinRateMargin,
} from './amount-match.js';

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

describe('rate margin constants (#229)', () => {
  it('has the agreed defaults and bounds', () => {
    expect(RATE_MARGIN_FLOOR_MINOR_UNITS).toBe(2);
    expect(DEFAULT_CURRENCY_DRIFT_PERCENT).toBe(2);
    expect(MIN_CURRENCY_DRIFT_PERCENT).toBe(0);
    expect(MAX_CURRENCY_DRIFT_PERCENT).toBe(10);
    expect(CURRENCY_DRIFT_STEP).toBe(0.5);
  });
});

describe('rateMarginUnits (#229)', () => {
  it('is 2 percent of a EUR amount: -1250 gives 25', () => {
    expect(rateMarginUnits(-1250, 2)).toBe(25);
  });

  it('rounds the percentage up: -1001 at 2 percent gives ceil(20.02) = 21', () => {
    expect(rateMarginUnits(-1001, 2)).toBe(21);
  });

  it('applies the 2-unit floor: -50 at 2 percent gives 2', () => {
    expect(rateMarginUnits(-50, 2)).toBe(2);
    expect(rateMarginUnits(0, 2)).toBe(2);
  });

  it('works on exponent-0 currencies: JPY -1500 at 2 percent gives 30', () => {
    expect(rateMarginUnits(-1500, 2)).toBe(30);
  });

  it('is null at 0 percent (margin off, no floor)', () => {
    expect(rateMarginUnits(-1250, 0)).toBeNull();
    expect(rateMarginUnits(0, 0)).toBeNull();
  });

  it('is exact at 2.5 percent: -1000 gives 25', () => {
    expect(rateMarginUnits(-1000, 2.5)).toBe(25);
    expect(rateMarginUnits(-1010, 2.5)).toBe(26);
  });

  it('handles 10 percent and step values such as 0.5', () => {
    expect(rateMarginUnits(-1250, 10)).toBe(125);
    expect(rateMarginUnits(-1250, 0.5)).toBe(7);
  });

  it('uses the absolute Actual amount', () => {
    expect(rateMarginUnits(1250, 2)).toBe(25);
  });

  it('does not lose precision on large values', () => {
    expect(rateMarginUnits(-99999999, 2)).toBe(2000000);
    expect(rateMarginUnits(-Number.MAX_SAFE_INTEGER, 10)).toBe(900719925474100);
  });

  it('throws RangeError for a non-integer amount', () => {
    expect(() => rateMarginUnits(-12.5, 2)).toThrow(RangeError);
  });

  it('throws RangeError for a percent outside 0..10 or not finite', () => {
    expect(() => rateMarginUnits(-1250, -1)).toThrow(RangeError);
    expect(() => rateMarginUnits(-1250, 10.5)).toThrow(RangeError);
    expect(() => rateMarginUnits(-1250, Number.NaN)).toThrow(RangeError);
  });
});

describe('withinRateMargin (#229)', () => {
  it('EUR -1250 at 2 percent: a difference of 25 passes, 26 fails', () => {
    expect(withinRateMargin(-1225, -1250, 2)).toBe(true);
    expect(withinRateMargin(-1275, -1250, 2)).toBe(true);
    expect(withinRateMargin(-1224, -1250, 2)).toBe(false);
    expect(withinRateMargin(-1276, -1250, 2)).toBe(false);
  });

  it('EUR -1001 at 2 percent: 21 passes, 22 fails', () => {
    expect(withinRateMargin(-980, -1001, 2)).toBe(true);
    expect(withinRateMargin(-979, -1001, 2)).toBe(false);
  });

  it('floor: -50 at 2 percent, 2 passes and 3 fails', () => {
    expect(withinRateMargin(-48, -50, 2)).toBe(true);
    expect(withinRateMargin(-47, -50, 2)).toBe(false);
  });

  it('a 1-unit difference on -99 passes', () => {
    expect(withinRateMargin(-98, -99, 2)).toBe(true);
    expect(withinRateMargin(-100, -99, 2)).toBe(true);
  });

  it('JPY -1500 at 2 percent: 30 passes, 31 fails', () => {
    expect(withinRateMargin(-1530, -1500, 2)).toBe(true);
    expect(withinRateMargin(-1531, -1500, 2)).toBe(false);
  });

  it('is false at 0 percent, even for equal amounts (the margin is off)', () => {
    expect(withinRateMargin(-1249, -1250, 0)).toBe(false);
    expect(withinRateMargin(-1250, -1250, 0)).toBe(false);
  });

  it('2.5 and 10 percent boundaries', () => {
    expect(withinRateMargin(-975, -1000, 2.5)).toBe(true);
    expect(withinRateMargin(-974, -1000, 2.5)).toBe(false);
    expect(withinRateMargin(-1125, -1250, 10)).toBe(true);
    expect(withinRateMargin(-1124, -1250, 10)).toBe(false);
  });

  it('fails on opposite signs even when the magnitude is close', () => {
    expect(withinRateMargin(1, -1, 2)).toBe(false);
    expect(withinRateMargin(1250, -1250, 10)).toBe(false);
    expect(withinRateMargin(-1250, 1250, 10)).toBe(false);
  });

  it('throws RangeError for non-integer amounts', () => {
    expect(() => withinRateMargin(-12.5, -1250, 2)).toThrow(RangeError);
    expect(() => withinRateMargin(-1250, -12.5, 2)).toThrow(RangeError);
  });

  it('does not lose precision on large values', () => {
    expect(withinRateMargin(-99999999 + 2000000, -99999999, 2)).toBe(true);
    expect(withinRateMargin(-99999999 + 2000001, -99999999, 2)).toBe(false);
  });
});

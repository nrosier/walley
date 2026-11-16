/**
 * Pure amount matching on integer cents (#34). No floats are compared: the check runs in BigInt.
 */

/** Default user_configs.tolerance_percent. */
export const DEFAULT_TOLERANCE_PERCENT = 5;

/** Tolerance is scaled to hundredths of a percent, so a stored value such as 2.5 stays exact. */
const TOLERANCE_SCALE = 100;

function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be integer cents`);
  }
}

/**
 * True when |a - b| is within tolerancePercent of the larger of |a| and |b|:
 * |a - b| * 100 <= tolerancePercent * max(|a|, |b|). Signs are ignored (absolute values are
 * compared). tolerancePercent must be in 0..100; it is rounded to hundredths of a percent.
 * At 0 percent the amounts must be equal.
 */
export function amountWithinTolerance(a: number, b: number, tolerancePercent: number): boolean {
  assertCents(a, 'a');
  assertCents(b, 'b');
  if (!Number.isFinite(tolerancePercent) || tolerancePercent < 0 || tolerancePercent > 100) {
    throw new RangeError('tolerancePercent must be between 0 and 100');
  }
  const absA = BigInt(Math.abs(a));
  const absB = BigInt(Math.abs(b));
  const diff = absA > absB ? absA - absB : absB - absA;
  const larger = absA > absB ? absA : absB;
  const tol = BigInt(Math.round(tolerancePercent * TOLERANCE_SCALE));
  return diff * 100n * BigInt(TOLERANCE_SCALE) <= tol * larger;
}

/** Smallest rate margin in minor units when the margin is on (#229): absorbs rounding on small prices. */
export const RATE_MARGIN_FLOOR_MINOR_UNITS = 2;

/** Default user_configs.currency_drift_percent (#229). */
export const DEFAULT_CURRENCY_DRIFT_PERCENT = 2;

/** Bounds and step of currency_drift_percent (#229). 0 turns the margin off. */
export const MIN_CURRENCY_DRIFT_PERCENT = 0;
export const MAX_CURRENCY_DRIFT_PERCENT = 10;
export const CURRENCY_DRIFT_STEP = 0.5;

function assertDriftPercent(percent: number): void {
  if (
    !Number.isFinite(percent) ||
    percent < MIN_CURRENCY_DRIFT_PERCENT ||
    percent > MAX_CURRENCY_DRIFT_PERCENT
  ) {
    throw new RangeError(
      `percent must be between ${String(MIN_CURRENCY_DRIFT_PERCENT)} and ${String(MAX_CURRENCY_DRIFT_PERCENT)}`,
    );
  }
}

/**
 * Rate margin in minor units for a foreign-currency pair (#229): max(2, ceil(percent% of
 * |actualCents|)), in BigInt with percent rounded to hundredths. Returns null at 0 percent: the
 * margin is off and the floor does not apply, so comparison stays exact. percent must be in 0..10.
 */
export function rateMarginUnits(actualCents: number, percent: number): number | null {
  assertCents(actualCents, 'actualCents');
  assertDriftPercent(percent);
  if (percent === 0) {
    return null;
  }
  const p = BigInt(Math.round(percent * TOLERANCE_SCALE));
  const scale = 100n * BigInt(TOLERANCE_SCALE);
  const product = p * BigInt(Math.abs(actualCents));
  const pct = (product + scale - 1n) / scale;
  const floor = BigInt(RATE_MARGIN_FLOOR_MINOR_UNITS);
  return Number(pct > floor ? pct : floor);
}

/**
 * True when the converted Wallos amount is within the rate margin of the Actual amount (#229):
 * |wallosCents - actualCents| <= rateMarginUnits(actualCents, percent), boundary included. Uses the
 * signed difference, so amounts of opposite sign always fail. False at 0 percent (margin off).
 */
export function withinRateMargin(wallosCents: number, actualCents: number, percent: number): boolean {
  assertCents(wallosCents, 'wallosCents');
  const margin = rateMarginUnits(actualCents, percent);
  if (margin === null) {
    return false;
  }
  if ((wallosCents < 0 && actualCents > 0) || (wallosCents > 0 && actualCents < 0)) {
    return false;
  }
  const diff = BigInt(wallosCents) - BigInt(actualCents);
  const absDiff = diff < 0n ? -diff : diff;
  return absDiff <= BigInt(margin);
}

/**
 * Midpoint of a range schedule's bounds in integer cents: (num1 + num2) / 2, an odd sum rounding
 * half away from zero (100 and 101 give 101; -100 and -101 give -101).
 */
export function rangeMidpointCents(num1: number, num2: number): number {
  assertCents(num1, 'num1');
  assertCents(num2, 'num2');
  const sum = num1 + num2;
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError('range bounds are too large');
  }
  const half = (Math.abs(sum) + (sum % 2 === 0 ? 0 : 1)) / 2;
  const result = sum < 0 ? -half : half;
  return result === 0 ? 0 : result;
}

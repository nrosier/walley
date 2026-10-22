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

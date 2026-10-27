import { DEFAULT_CURRENCY_EXPONENT } from './currency-exponent.js';

function checkExponent(exponent: number): void {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    throw new RangeError('Exponent must be a non-negative integer');
  }
}

/**
 * Converts a decimal amount to integer minor units, the unit Actual Budget stores. `exponent` is
 * the currency's number of minor-unit digits (currency-exponent.ts): 2 for EUR (12.50 -> 1250),
 * 0 for JPY (1250 -> 1250). Rounds half away from zero. An expense is returned as a negative number.
 */
export function toActualCents(
  amount: number,
  options: { expense: boolean; exponent?: number },
): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError('Amount must be a finite number');
  }
  const exponent = options.exponent ?? DEFAULT_CURRENCY_EXPONENT;
  checkExponent(exponent);
  // The EPSILON term corrects binary float error such as 1.005 * 100 (100.49999999999999).
  // It is added before the multiply so it is large enough to matter at this magnitude.
  const cents = Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 10 ** exponent);
  const signed = options.expense ? -cents : cents;
  return signed === 0 ? 0 : signed;
}

/** Converts integer minor units, as Actual Budget stores them, back to a decimal amount. */
export function fromActualCents(cents: number, exponent: number = DEFAULT_CURRENCY_EXPONENT): number {
  if (!Number.isInteger(cents)) {
    throw new RangeError('Cents must be an integer');
  }
  checkExponent(exponent);
  return exponent === 0 ? cents : cents / 10 ** exponent;
}

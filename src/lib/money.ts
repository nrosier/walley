/**
 * Converts a decimal amount to integer cents, the unit Actual Budget stores.
 * Rounds half away from zero. An expense is returned as a negative number.
 */
export function toActualCents(amount: number, options: { expense: boolean }): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError('Amount must be a finite number');
  }
  // The EPSILON term corrects binary float error such as 1.005 * 100 (100.49999999999999).
  // It is added before the multiply so it is large enough to matter at this magnitude.
  const cents = Math.sign(amount) * Math.round((Math.abs(amount) + Number.EPSILON) * 100);
  const signed = options.expense ? -cents : cents;
  return signed === 0 ? 0 : signed;
}

/** Converts integer cents, as Actual Budget stores them, back to a decimal amount. */
export function fromActualCents(cents: number): number {
  if (!Number.isInteger(cents)) {
    throw new RangeError('Cents must be an integer');
  }
  return cents / 100;
}

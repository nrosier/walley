/**
 * Pure currency conversion for Wallos prices. No I/O.
 *
 * Rates use the Wallos scale: units of a currency per one unit of the Wallos main currency
 * (the `rate` field of get_currencies.php). To convert an amount from currency X to currency B,
 * multiply by rate(B) / rate(X). A manual per-subscription override uses the same scale and
 * replaces the Wallos rate for that subscription's currency.
 *
 * Amounts are integer cents, the unit Actual Budget stores, and rounding is half away from zero,
 * as in money.ts.
 */

export type CurrencyConversionErrorCode = 'invalid_rate' | 'invalid_amount' | 'missing_rate';

/** A rate, amount or override that cannot be used. The message never contains user secrets. */
export class CurrencyConversionError extends Error {
  readonly code: CurrencyConversionErrorCode;
  constructor(code: CurrencyConversionErrorCode, message: string) {
    super(message);
    this.name = 'CurrencyConversionError';
    this.code = code;
  }
}

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Parses a Wallos-style rate: a positive decimal string, or a positive finite number.
 * Throws CurrencyConversionError('invalid_rate') for anything else, including zero and negatives.
 */
export function parseRate(value: string | number): number {
  let rate = Number.NaN;
  if (typeof value === 'number') {
    rate = value;
  } else if (DECIMAL_PATTERN.test(value.trim())) {
    rate = Number(value.trim());
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new CurrencyConversionError('invalid_rate', 'rate must be a positive finite decimal');
  }
  return rate;
}

/**
 * Picks the rate for a subscription. A manual override wins over the Wallos rate. Throws
 * CurrencyConversionError('missing_rate') when neither is present.
 */
export function selectRate(input: {
  override?: string | number | null;
  wallosRate?: string | number | null;
}): number {
  if (input.override !== undefined && input.override !== null) {
    return parseRate(input.override);
  }
  if (input.wallosRate !== undefined && input.wallosRate !== null) {
    return parseRate(input.wallosRate);
  }
  throw new CurrencyConversionError('missing_rate', 'no override or Wallos rate for this currency');
}

/**
 * Converts integer cents from one currency to another. The result is integer cents, rounded half
 * away from zero. The sign is kept, so an expense stays negative. Zero is never returned as -0.
 */
export function convertPriceCents(priceCents: number, fromRate: number, toRate: number): number {
  if (!Number.isSafeInteger(priceCents)) {
    throw new CurrencyConversionError('invalid_amount', 'amount must be an integer number of cents');
  }
  const from = parseRate(fromRate);
  const to = parseRate(toRate);

  const exact = (priceCents * to) / from;
  // toPrecision(15) removes float noise from the product (for example 100.49999999999999 becomes
  // 100.5) so that exact halves round up in magnitude. Rates such as 1.1 are not exact in binary.
  const magnitude = Math.round(Number(Math.abs(exact).toPrecision(15)));
  const signed = exact < 0 ? -magnitude : magnitude;
  return signed === 0 ? 0 : signed;
}

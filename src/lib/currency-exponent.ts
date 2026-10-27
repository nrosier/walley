/**
 * Minor-unit exponents per ISO currency code: the number of decimal places of the integer amounts
 * Actual Budget stores (JPY 1250 is stored as 1250, EUR 12.50 as 1250). Pure, browser-safe.
 *
 * The repo had no currency exponent data, so this is a small table taken from the currency list
 * of @actual-app/api 26.10.0 (loot-core/src/shared/currencies.ts, `decimalPlaces`). Every
 * currency in that list uses 2 except the ones below. A code not in the list also uses 2, as
 * Actual does for an unknown code.
 */
export const DEFAULT_CURRENCY_EXPONENT = 2;

const NON_DEFAULT_EXPONENTS: Readonly<Record<string, number>> = {
  IRR: 0,
  JPY: 0,
  KRW: 0,
};

/** Exponent for a currency code (trimmed, case-insensitive). 2 unless the table says otherwise. */
export function currencyExponent(code: string): number {
  return NON_DEFAULT_EXPONENTS[code.trim().toUpperCase()] ?? DEFAULT_CURRENCY_EXPONENT;
}

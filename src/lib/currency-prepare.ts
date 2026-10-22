/**
 * Pure: picks the two rates that convert a subscription's currency into the base currency. No I/O.
 *
 * Rates use the Wallos scale (units per one unit of the Wallos main currency), as in
 * currency-convert.ts. Pass the result to convertPriceCents(cents, fromRate, baseRate) for the
 * subscription-to-base direction, or convertPriceCents(cents, baseRate, fromRate) for the inverse.
 */
import { CurrencyConversionError, selectRate } from './currency-convert.js';

/** One entry of the Wallos currency list. Only the code and rate are read. */
export interface CurrencyRateEntry {
  readonly code: string;
  readonly rate?: string | number | null;
}

export interface BaseConversionRates {
  /** Rate of the subscription's currency. The override replaces the Wallos rate here. */
  readonly fromRate: number;
  /** Rate of the base currency, from the Wallos list. */
  readonly baseRate: number;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

function findRate(
  currencies: readonly CurrencyRateEntry[],
  code: string,
): { found: boolean; rate: string | number | null | undefined } {
  let found = false;
  let rate: string | number | null | undefined;
  // A later duplicate code replaces an earlier one, as in buildCurrencyMap.
  for (const c of currencies) {
    if (normalizeCode(c.code) === code) {
      found = true;
      rate = c.rate;
    }
  }
  return { found, rate };
}

/**
 * Returns the rates for converting `fromCode` into `baseCode`. A manual override (selectRate)
 * wins over the Wallos rate of the subscription's currency. When the two codes are the same the
 * conversion is the identity and the override is not applied. Throws
 * CurrencyConversionError('missing_rate') when the base code, or the subscription code without an
 * override, is not in the list or has no rate; 'invalid_rate' when a rate does not parse.
 */
export function resolveBaseConversion(
  currencies: readonly CurrencyRateEntry[],
  fromCode: string,
  baseCode: string,
  override?: string | number | null,
): BaseConversionRates {
  const base = normalizeCode(baseCode);
  const from = normalizeCode(fromCode);

  const baseEntry = findRate(currencies, base);
  if (!baseEntry.found || baseEntry.rate === undefined || baseEntry.rate === null) {
    throw new CurrencyConversionError(
      'missing_rate',
      `base currency ${base} is not in the Wallos currency list`,
    );
  }
  const baseRate = selectRate({ wallosRate: baseEntry.rate });

  if (from === base) {
    return { fromRate: baseRate, baseRate };
  }

  const fromEntry = findRate(currencies, from);
  const fromRate = selectRate({ override, wallosRate: fromEntry.rate });
  return { fromRate, baseRate };
}

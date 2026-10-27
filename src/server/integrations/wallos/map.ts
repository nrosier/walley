import { currencyExponent } from '../../../lib/currency-exponent.js';
import { toActualCents } from '../../../lib/money.js';
import {
  wallosToActual,
  type ActualRecurrence,
  type WallosInterval,
} from '../../../lib/frequency-mapper.js';
import type { WallosCurrency, WallosSubscription } from './types.js';

/**
 * Wallos `cycle` values, from the upstream source (ellite/Wallos):
 * includes/list_subscriptions.php (getBillingCycle) and api/subscriptions/get_monthly_cost.php.
 * 1 = daily, 2 = weekly, 3 = monthly, 4 = yearly. `frequency` is the count of those units.
 * 5 = one-time, which has no recurring interval and is rejected here.
 */
export const WALLOS_CYCLE_DAILY = 1;
export const WALLOS_CYCLE_WEEKLY = 2;
export const WALLOS_CYCLE_MONTHLY = 3;
export const WALLOS_CYCLE_YEARLY = 4;
export const WALLOS_CYCLE_ONE_TIME = 5;

export type WallosMappingErrorCode =
  | 'missing_field'
  | 'invalid_value'
  | 'invalid_price'
  | 'unknown_cycle'
  | 'unsupported_cycle'
  | 'unknown_currency';

/** A subscription that cannot be mapped. `field` names the Wallos field at fault. */
export class WallosMappingError extends Error {
  readonly code: WallosMappingErrorCode;
  readonly field: string;
  constructor(code: WallosMappingErrorCode, field: string, message: string) {
    super(message);
    this.name = 'WallosMappingError';
    this.code = code;
    this.field = field;
  }
}

export interface MappedWallosSubscription {
  /** Wallos `id`, as a string. Used as `matches.wallos_id`. */
  wallosId: string;
  name: string;
  /**
   * Price in the subscription's own currency, as integer minor units of that currency (cents for
   * EUR, whole yen for JPY; see currency-exponent.ts). Negative, following the expense convention
   * in money.ts. Base-currency conversion is not done here.
   */
  priceCents: number;
  /** Wallos `currency_id`. The currency code is not in this payload, so it is not mapped. */
  currencyId: string;
  /** Wallos interval, from `cycle` and `frequency`. */
  interval: WallosInterval;
  /** Actual Budget recurrence for the same interval, from the frequency mapper. */
  recurrence: ActualRecurrence;
  /** `YYYY-MM-DD`, or null when Wallos omits `next_payment`. */
  nextPaymentDate: string | null;
  /** `YYYY-MM-DD`, or null when Wallos omits `start_date`. */
  startDate: string | null;
  /** False when Wallos `inactive` is truthy. */
  active: boolean;
}

/** Wallos `currency_id` (as a string) to ISO code, built from the user's currency list. */
export type WallosCurrencyMap = ReadonlyMap<string, string>;

/** Pure. A later duplicate id replaces an earlier one. */
export function buildCurrencyMap(currencies: readonly WallosCurrency[]): WallosCurrencyMap {
  const map = new Map<string, string>();
  for (const c of currencies) map.set(String(c.id), c.code.trim().toUpperCase());
  return map;
}

/** Throws WallosMappingError('unknown_currency') when the id is not in the map. */
export function resolveCurrencyCode(map: WallosCurrencyMap, currencyId: string): string {
  const code = map.get(currencyId);
  if (code === undefined) {
    throw new WallosMappingError(
      'unknown_currency',
      'currency_id',
      `currency_id ${currencyId} is not in the Wallos currency list`,
    );
  }
  return code;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

function requirePresent<K extends keyof WallosSubscription>(
  raw: WallosSubscription,
  field: K,
): NonNullable<WallosSubscription[K]> {
  // Typed as unknown: the declared type of an optional field hides a runtime absence.
  const value: unknown = raw[field];
  if (value === undefined || value === null) {
    throw new WallosMappingError('missing_field', field, `Wallos subscription is missing ${field}`);
  }
  return value as NonNullable<WallosSubscription[K]>;
}

function parseDate(value: string, field: string): string {
  const match = DATE_PATTERN.exec(value);
  if (match) {
    const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    const check = new Date(Date.UTC(year, month - 1, day));
    if (
      check.getUTCFullYear() === year &&
      check.getUTCMonth() === month - 1 &&
      check.getUTCDate() === day
    ) {
      return value;
    }
  }
  throw new WallosMappingError('invalid_value', field, `${field} must be a valid YYYY-MM-DD date`);
}

function parseOptionalDate(raw: string | null | undefined, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  return parseDate(raw, field);
}

function parseCount(value: number | string, field: string): number {
  const text = typeof value === 'number' ? String(value) : value;
  if (!/^\d+$/.test(text) || Number(text) < 1) {
    throw new WallosMappingError('invalid_value', field, `${field} must be a positive integer`);
  }
  return Number(text);
}

function parsePrice(value: number | string): number {
  // Accept a numeric string as Wallos may send it. Anything else is rejected, not coerced.
  if (typeof value === 'string' && !DECIMAL_PATTERN.test(value.trim())) {
    throw new WallosMappingError('invalid_price', 'price', 'price must be a positive decimal');
  }
  const amount = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new WallosMappingError('invalid_price', 'price', 'price must be greater than zero');
  }
  return amount;
}

function parseInterval(cycleRaw: number | string, frequencyRaw: number | string): WallosInterval {
  const cycle = typeof cycleRaw === 'number' ? cycleRaw : Number(cycleRaw);
  switch (cycle) {
    case WALLOS_CYCLE_DAILY:
      return { type: 'custom_days', days: parseCount(frequencyRaw, 'frequency') };
    case WALLOS_CYCLE_WEEKLY:
      return { type: 'weekly', every: parseCount(frequencyRaw, 'frequency') };
    case WALLOS_CYCLE_MONTHLY:
      return { type: 'monthly', every: parseCount(frequencyRaw, 'frequency') };
    case WALLOS_CYCLE_YEARLY:
      return { type: 'yearly', every: parseCount(frequencyRaw, 'frequency') };
    case WALLOS_CYCLE_ONE_TIME:
      throw new WallosMappingError(
        'unsupported_cycle',
        'cycle',
        'one-time subscriptions (cycle 5) have no recurring interval',
      );
    default:
      throw new WallosMappingError('unknown_cycle', 'cycle', `unknown Wallos cycle: ${String(cycleRaw)}`);
  }
}

function parseActive(value: number | boolean): boolean {
  if (value === 0 || value === false) return true;
  if (value === 1 || value === true) return false;
  throw new WallosMappingError('invalid_value', 'inactive', 'inactive must be 0, 1, true or false');
}

/**
 * Maps one documented Wallos subscription to the internal model. Pure: no I/O, no credentials.
 * Throws WallosMappingError for any field it cannot map. It never substitutes a default.
 *
 * `currencies` (the user's Wallos currency map) gives the price its currency's minor units, so a
 * JPY price of 1250 maps to 1250 and a EUR price of 12.50 to 1250. Production callers must pass
 * it; an id not in the map throws unknown_currency. Without it the price is read as two decimals.
 */
export function mapWallosSubscription(
  raw: WallosSubscription,
  currencies?: WallosCurrencyMap,
): MappedWallosSubscription {
  const name = requirePresent(raw, 'name');
  if (name.trim() === '') {
    throw new WallosMappingError('invalid_value', 'name', 'name must not be empty');
  }

  const priceRaw = requirePresent(raw, 'price');
  const amount = parsePrice(priceRaw);

  const currencyId = String(requirePresent(raw, 'currency_id'));
  const exponent =
    currencies === undefined ? undefined : currencyExponent(resolveCurrencyCode(currencies, currencyId));
  const priceCents = toActualCents(amount, { expense: true, exponent });

  const interval = parseInterval(
    requirePresent(raw, 'cycle'),
    requirePresent(raw, 'frequency'),
  );

  const active = parseActive(requirePresent(raw, 'inactive'));

  return {
    wallosId: String(requirePresent(raw, 'id')),
    name,
    priceCents,
    currencyId,
    interval,
    recurrence: wallosToActual(interval),
    nextPaymentDate: parseOptionalDate(raw.next_payment, 'next_payment'),
    startDate: parseOptionalDate(raw.start_date, 'start_date'),
    active,
  };
}

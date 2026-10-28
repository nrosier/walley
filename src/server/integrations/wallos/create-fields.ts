/**
 * #133: pure helpers for the optional fields of the Wallos create route (title, price, billing
 * cycle, start date). The readers validate request values and return `false` for an invalid one
 * and `undefined` for an absent one; the mappers turn a valid value into the same internal shapes
 * the prefill uses, so `buildWallosSubscriptionPayload` stays the single place that writes Wallos
 * fields. Nothing here logs or reads the network.
 */
import { currencyExponent } from '../../../lib/currency-exponent.js';
import {
  actualToWallos,
  wallosToActual,
  WALLOS_INTERVAL_TYPES,
  type ActualRecurrence,
  type WallosIntervalType,
} from '../../../lib/frequency-mapper.js';
import { isIsoDate } from './write.js';

export const MAX_TITLE_LENGTH = 200;
/** At most 12 integer digits and 8 decimals; the minor-unit rounding happens later, per currency. */
const PRICE_PATTERN = /^\d{1,12}(\.\d{1,8})?$/;
const MAX_PRICE = 999_999_999_999;

/** Trimmed title of 1 to 200 characters. */
export function readTitle(value: unknown): string | undefined | false {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return false;
  const title = value.trim();
  return title.length >= 1 && title.length <= MAX_TITLE_LENGTH ? title : false;
}

/** Positive decimal number string, or a positive finite number, as a normalised decimal string. */
export function readPrice(value: unknown): string | undefined | false {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0 || value > MAX_PRICE) return false;
    const text = String(value);
    // Exponent forms (1e-7) are not a plain decimal; refuse them rather than guess.
    return PRICE_PATTERN.test(text) ? text : false;
  }
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return PRICE_PATTERN.test(text) && Number(text) > 0 ? text : false;
}

/** One of the frequency mapper's Wallos interval types. */
export function readBillingCycle(value: unknown): WallosIntervalType | undefined | false {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && (WALLOS_INTERVAL_TYPES as readonly string[]).includes(value)
    ? (value as WallosIntervalType)
    : false;
}

/** A real calendar date as YYYY-MM-DD. */
export function readStartDate(value: unknown): string | undefined | false {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && isIsoDate(value) ? value : false;
}

/**
 * Positive decimal string (as `readPrice` returns it) -> positive integer minor units of the
 * currency, using its exponent (EUR "12.50" -> 1250, JPY "1250" -> 1250). Exact string arithmetic,
 * no float. Returns null for a price with more decimals than the currency has (it is refused, never
 * rounded), and for a price of zero.
 */
export function priceToMinorUnits(price: string, currencyCode: string): number | null {
  const exponent = currencyExponent(currencyCode);
  const [whole = '', fraction = ''] = price.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  if (trimmed.length > exponent) return null;
  const minor = Number(whole + trimmed.padEnd(exponent, '0'));
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}

/**
 * Replaces the recurrence's unit with the chosen Wallos billing cycle and keeps its count
 * (every 2 months with "weekly" becomes every 2 weeks). Goes through the frequency mapper in both
 * directions, so patterns are still refused and the count is still validated.
 */
export function recurrenceWithBillingCycle(
  recurrence: ActualRecurrence,
  billingCycle: WallosIntervalType,
): ActualRecurrence {
  const current = actualToWallos(recurrence);
  const count = current.type === 'custom_days' ? current.days : current.every;
  const next = billingCycle === 'custom_days' ? ({ type: billingCycle, days: count } as const) : ({ type: billingCycle, every: count } as const);
  return wallosToActual(next);
}

/** A payment cannot precede the subscription's start: the later of the two ISO dates. */
export function nextPaymentFor(nextPayment: string, startDate: string): string {
  return startDate > nextPayment ? startDate : nextPayment;
}

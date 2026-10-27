import { DEFAULT_CURRENCY_EXPONENT } from '../../../lib/currency-exponent.js';
import { fromActualCents } from '../../../lib/money.js';
import {
  actualToWallos,
  FrequencyMappingError,
  type ActualRecurrence,
  type WallosInterval,
} from '../../../lib/frequency-mapper.js';
import {
  WALLOS_CYCLE_DAILY,
  WALLOS_CYCLE_MONTHLY,
  WALLOS_CYCLE_WEEKLY,
  WALLOS_CYCLE_YEARLY,
  WallosMappingError,
} from './map.js';

/**
 * Form fields for `add` on ellite/Wallos api/subscriptions/set_subscriptions.php, confirmed
 * 2026-10-22 from the raw source. Wallos requires name, price, currency_id, frequency, cycle
 * and next_payment; it rejects the add when any is empty. `api_key` and `action` are added by
 * the client, not here.
 */
export type WallosSubscriptionPayload = {
  readonly name: string;
  /** Positive decimal in the subscription's currency, with its minor-unit places: "12.50" (EUR), "1250" (JPY). */
  readonly price: string;
  readonly currency_id: string;
  /** 1 = days, 2 = weeks, 3 = months, 4 = years. */
  readonly cycle: string;
  /** Count of the `cycle` unit, e.g. 2 with cycle 3 = every two months. */
  readonly frequency: string;
  /** YYYY-MM-DD. */
  readonly next_payment: string;
  /** YYYY-MM-DD. Omitted when absent; Wallos then uses the current date. */
  readonly start_date?: string;
};

/** A recurring subscription in the internal model, e.g. from an Actual schedule. */
export interface RecurringSubscriptionInput {
  name: string;
  /** Integer minor units of the currency, negative for an expense (money.ts convention). */
  priceCents: number;
  /** Wallos `currency_id`, as a string of digits. */
  currencyId: string;
  /** Actual recurrence. Converted to the Wallos cycle and frequency. */
  recurrence: ActualRecurrence;
  /** `YYYY-MM-DD`, or null when unknown. */
  startDate: string | null;
  /** `YYYY-MM-DD`. Required by Wallos on add, so null is a typed error. */
  nextPaymentDate: string | null;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const CURRENCY_ID_PATTERN = /^\d+$/;

function checkDate(value: string, field: string): string {
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

function cycleFor(interval: WallosInterval): { cycle: number; frequency: number } {
  switch (interval.type) {
    case 'custom_days':
      return { cycle: WALLOS_CYCLE_DAILY, frequency: interval.days };
    case 'weekly':
      return { cycle: WALLOS_CYCLE_WEEKLY, frequency: interval.every };
    case 'monthly':
      return { cycle: WALLOS_CYCLE_MONTHLY, frequency: interval.every };
    case 'yearly':
      return { cycle: WALLOS_CYCLE_YEARLY, frequency: interval.every };
  }
}

/**
 * Pure. Builds the `add` form fields from an internal recurring subscription. Converts integer
 * minor units back to a positive Wallos price with `exponent` decimal places (the currency's
 * minor units, currency-exponent.ts; 2 by default, 0 for JPY). Throws WallosMappingError for any
 * field it cannot write. It never substitutes a default.
 */
export function buildWallosSubscriptionPayload(
  input: RecurringSubscriptionInput,
  exponent: number = DEFAULT_CURRENCY_EXPONENT,
): WallosSubscriptionPayload {
  const name = input.name.trim();
  if (name === '') {
    throw new WallosMappingError('missing_field', 'name', 'name is required');
  }

  if (!Number.isSafeInteger(input.priceCents)) {
    throw new WallosMappingError('invalid_price', 'price', 'price must be integer cents');
  }
  // Expenses are negative in money.ts. Wallos stores the price positive.
  if (input.priceCents >= 0) {
    throw new WallosMappingError('invalid_price', 'price', 'price must be an expense (negative cents)');
  }
  const amount = Math.abs(fromActualCents(input.priceCents, exponent));
  const price = amount.toFixed(exponent);

  if (!CURRENCY_ID_PATTERN.test(input.currencyId) || Number(input.currencyId) < 1) {
    throw new WallosMappingError('missing_field', 'currency_id', 'currency_id is required');
  }

  let interval: WallosInterval;
  try {
    interval = actualToWallos(input.recurrence);
  } catch (err) {
    if (err instanceof FrequencyMappingError && err.code !== 'patterns_unsupported') {
      throw new WallosMappingError('unsupported_cycle', 'cycle', err.message);
    }
    throw err;
  }
  const { cycle, frequency } = cycleFor(interval);

  if (input.nextPaymentDate === null) {
    throw new WallosMappingError('missing_field', 'next_payment', 'next_payment is required by Wallos');
  }

  const payload: { -readonly [K in keyof WallosSubscriptionPayload]: WallosSubscriptionPayload[K] } = {
    name,
    price,
    currency_id: input.currencyId,
    cycle: String(cycle),
    frequency: String(frequency),
    next_payment: checkDate(input.nextPaymentDate, 'next_payment'),
  };
  if (input.startDate !== null) {
    payload.start_date = checkDate(input.startDate, 'start_date');
  }
  return payload;
}

/**
 * Form fields for `edit` on ellite/Wallos api/subscriptions/set_subscriptions.php. Wallos keeps the
 * stored value of every field that is not sent, so only changed fields are included, with one
 * exception: `next_payment` is validated as YYYY-MM-DD on every edit, so it is always sent. Never
 * add payment_method_id, category_id, payer_user_id, notify, inactive or notes here: sending
 * category_id or payer_user_id replaces the whole list. `id`, `action` and `api_key` are added by
 * the client.
 */
export type WallosSubscriptionUpdate = {
  readonly next_payment: string;
  readonly name?: string;
  readonly price?: string;
  readonly currency_id?: string;
  readonly cycle?: string;
  readonly frequency?: string;
  readonly start_date?: string;
};

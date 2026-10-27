/**
 * Pure glue between the Wallos and Actual write paths: converts amounts between a subscription's
 * currency and the Actual base currency. No I/O; every argument is already-fetched data.
 * The caller must fetch the Wallos currency list once per sync run and pass it to every call.
 */
import { convertPriceCents } from '../../lib/currency-convert.js';
import { currencyExponent } from '../../lib/currency-exponent.js';
import { resolveBaseConversion } from '../../lib/currency-prepare.js';
import type { CreateScheduleInput } from './actual/write.js';
import { buildCurrencyMap, resolveCurrencyCode, WallosMappingError } from './wallos/map.js';
import type { MappedWallosSubscription } from './wallos/map.js';
import type { WallosCurrency } from './wallos/types.js';
import {
  buildWallosSubscriptionPayload,
  type RecurringSubscriptionInput,
  type WallosSubscriptionPayload,
} from './wallos/write.js';

/** The part of CreateScheduleInput derived from a Wallos subscription. Payee and account are user choices. */
export type PreparedScheduleInput = Pick<
  CreateScheduleInput,
  'name' | 'amountCents' | 'recurrence' | 'startDate'
>;

/** Override rate on the Wallos scale for the subscription's currency, e.g. a subscription_overrides row rate. */
export type OverrideRate = string | number | null | undefined;

/**
 * Wallos subscription -> createActualSchedule fields. The amount is converted into the base
 * currency, from the subscription currency's minor units to the base currency's
 * (currency-exponent.ts), and stays negative (mapWallosSubscription already applied toActualCents with
 * expense true). The start date is the Wallos start_date, or next_payment when it is absent.
 * Throws WallosMappingError (unknown_currency, or missing_field when both dates are absent) and
 * CurrencyConversionError (missing_rate, invalid_rate).
 */
export function prepareActualScheduleInput(
  subscription: MappedWallosSubscription,
  currencies: readonly WallosCurrency[],
  baseCode: string,
  override?: OverrideRate,
): PreparedScheduleInput {
  const code = resolveCurrencyCode(buildCurrencyMap(currencies), subscription.currencyId);
  const { fromRate, baseRate } = resolveBaseConversion(currencies, code, baseCode, override);
  const startDate = subscription.startDate ?? subscription.nextPaymentDate;
  if (startDate === null) {
    throw new WallosMappingError(
      'missing_field',
      'start_date',
      'start_date or next_payment is required for an Actual schedule',
    );
  }
  return {
    name: subscription.name,
    amountCents: convertPriceCents(
      subscription.priceCents,
      fromRate,
      baseRate,
      currencyExponent(code),
      currencyExponent(baseCode),
    ),
    recurrence: subscription.recurrence,
    startDate,
  };
}

/**
 * Inverse direction (#30): `input.priceCents` is in the base currency's minor units (negative for
 * an expense) and is converted into the minor units of the currency named by `input.currencyId`
 * before building the Wallos `add` payload, whose price has that currency's decimal places. Throws WallosMappingError and CurrencyConversionError as above.
 */
export function prepareWallosSubscriptionPayload(
  input: RecurringSubscriptionInput,
  currencies: readonly WallosCurrency[],
  baseCode: string,
  override?: OverrideRate,
): WallosSubscriptionPayload {
  const code = resolveCurrencyCode(buildCurrencyMap(currencies), input.currencyId);
  const { fromRate, baseRate } = resolveBaseConversion(currencies, code, baseCode, override);
  const exponent = currencyExponent(code);
  return buildWallosSubscriptionPayload(
    {
      ...input,
      priceCents: convertPriceCents(
        input.priceCents,
        baseRate,
        fromRate,
        currencyExponent(baseCode),
        exponent,
      ),
    },
    exponent,
  );
}

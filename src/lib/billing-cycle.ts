/**
 * The billing cycle of an unlinked item, shown on Sync Dashboard rows (#136). One mapping for both
 * sides: Wallos items and Actual schedules both reach it as an Actual frequency plus interval
 * (Wallos through the frequency mapper at read time), and it goes through `actualToWallos` so the
 * key set is the Wallos interval type set. Browser-safe, no labels: the web layer owns the text.
 */
import {
  actualToWallos,
  FrequencyMappingError,
  type ActualFrequency,
  type WallosIntervalType,
} from './frequency-mapper.js';

export interface BillingCycle {
  /** Stable key. `custom_days` is a daily Actual recurrence. */
  readonly key: WallosIntervalType;
  /** Repeat every N units of the key (N days for `custom_days`); a missing interval counts as 1. */
  readonly count: number;
}

/** The cycle for an Actual frequency and interval, or null when the frequency or interval is invalid. */
export function billingCycleOf(frequency: string, interval?: number): BillingCycle | null {
  try {
    const mapped = actualToWallos({ frequency: frequency as ActualFrequency, ...(interval === undefined ? {} : { interval }) });
    return mapped.type === 'custom_days'
      ? { key: 'custom_days', count: mapped.days }
      : { key: mapped.type, count: mapped.every };
  } catch (error: unknown) {
    if (error instanceof FrequencyMappingError) return null;
    throw error;
  }
}

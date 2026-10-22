// Bidirectional mapper between Wallos billing intervals and Actual Budget
// schedule recurrence (the `frequency` and `interval` fields of a schedule's
// RecurConfig). Start date and end mode are the caller's concern. Recurrences with
// non-empty patterns are refused (Actual to Wallos throws 'patterns_unsupported'),
// so no caller can silently drop pattern detail.
// Verified against RecurConfig in @actual-app/core (api 26.10.0), see #32.

export const WALLOS_INTERVAL_TYPES = ['monthly', 'yearly', 'weekly', 'custom_days'] as const;
export type WallosIntervalType = (typeof WALLOS_INTERVAL_TYPES)[number];

export type WallosInterval =
  | { type: 'monthly' | 'yearly' | 'weekly'; every: number }
  | { type: 'custom_days'; days: number };

export const ACTUAL_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type ActualFrequency = (typeof ACTUAL_FREQUENCIES)[number];

export interface ActualRecurrence {
  frequency: ActualFrequency;
  /** Repeat every N units of `frequency`. Actual treats a missing value as 1. */
  interval?: number;
  /** Only checked for presence: a non-empty array is refused by actualToWallos. */
  patterns?: unknown[];
}

export type FrequencyMappingErrorCode = 'invalid_interval' | 'invalid_frequency' | 'patterns_unsupported';

export class FrequencyMappingError extends Error {
  readonly code: FrequencyMappingErrorCode;
  constructor(code: FrequencyMappingErrorCode, message: string) {
    super(message);
    this.name = 'FrequencyMappingError';
    this.code = code;
  }
}

function assertCount(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new FrequencyMappingError('invalid_interval', `${label} must be a positive integer`);
  }
  return value;
}

export function wallosToActual(input: WallosInterval): Omit<ActualRecurrence, 'patterns'> {
  const type: unknown = input.type;
  switch (type) {
    case 'monthly':
    case 'yearly':
    case 'weekly': {
      const every = assertCount((input as { every?: unknown }).every, 'every');
      return { frequency: type === 'weekly' ? 'weekly' : type === 'monthly' ? 'monthly' : 'yearly', interval: every };
    }
    case 'custom_days':
      return { frequency: 'daily', interval: assertCount((input as { days?: unknown }).days, 'days') };
    default:
      throw new FrequencyMappingError('invalid_interval', `Unknown Wallos interval type: ${String(type)}`);
  }
}

export function actualToWallos(input: ActualRecurrence): WallosInterval {
  const patterns: unknown = input.patterns;
  if (Array.isArray(patterns) && patterns.length > 0) {
    throw new FrequencyMappingError('patterns_unsupported', 'Recurrence patterns cannot be mapped to Wallos');
  }
  const frequency: unknown = input.frequency;
  const count = input.interval === undefined ? 1 : assertCount(input.interval, 'interval');
  switch (frequency) {
    case 'daily':
      return { type: 'custom_days', days: count };
    case 'weekly':
    case 'monthly':
    case 'yearly':
      return { type: frequency, every: count };
    default:
      throw new FrequencyMappingError('invalid_frequency', `Unsupported Actual frequency: ${String(frequency)}`);
  }
}

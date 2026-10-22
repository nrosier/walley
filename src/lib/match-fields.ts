/**
 * Pure, browser-safe canonicalisation of the compared fields of a Wallos subscription or an
 * Actual schedule (#36): name, amount cents, frequency, currency and start date. The server
 * hashes the serialised string (src/server/matching/hash.ts). No I/O, no Node built-ins.
 */

/** One amount: a single value, or both bounds of an Actual range ("isbetween") schedule. */
export type MatchAmount =
  | { readonly kind: 'single'; readonly cents: number }
  | { readonly kind: 'range'; readonly num1: number; readonly num2: number };

export interface MatchFieldsInput {
  readonly name: string;
  readonly amount: MatchAmount;
  readonly frequency: string;
  /** Repeat every N units of `frequency`; a missing value means 1, as in Actual. */
  readonly interval?: number;
  readonly currency: string;
  /** `YYYY-MM-DD`, or null when the source has no start date. */
  readonly startDate: string | null;
  /** A non-empty array marks a pattern schedule, which cannot be mapped and gets no hash. */
  readonly patterns?: readonly unknown[];
}

export type CanonicalAmount =
  | { readonly kind: 'single'; readonly cents: number }
  | { readonly kind: 'range'; readonly high: number; readonly low: number };

export interface CanonicalMatchFields {
  readonly amount: CanonicalAmount;
  readonly currency: string;
  readonly frequency: string;
  readonly interval: number;
  readonly name: string;
  readonly startDate: string | null;
}

function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be integer cents`);
  }
}

/** Integers print the same everywhere; -0 is folded to 0. */
function intOrZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Trims and collapses whitespace in the name, upper-cases the currency, folds a missing interval
 * to 1 and orders range bounds. Returns null for a pattern schedule (unmappable, no hash).
 * Throws RangeError for a non-integer amount or interval.
 */
export function normalizeMatchFields(input: MatchFieldsInput): CanonicalMatchFields | null {
  if (input.patterns !== undefined && input.patterns.length > 0) return null;
  const interval = input.interval ?? 1;
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new RangeError('interval must be a positive integer');
  }
  let amount: CanonicalAmount;
  if (input.amount.kind === 'range') {
    assertCents(input.amount.num1, 'num1');
    assertCents(input.amount.num2, 'num2');
    amount = {
      kind: 'range',
      high: intOrZero(Math.max(input.amount.num1, input.amount.num2)),
      low: intOrZero(Math.min(input.amount.num1, input.amount.num2)),
    };
  } else {
    assertCents(input.amount.cents, 'cents');
    amount = { kind: 'single', cents: intOrZero(input.amount.cents) };
  }
  return {
    amount,
    currency: input.currency.trim().toUpperCase(),
    frequency: input.frequency,
    interval,
    name: input.name.trim().replace(/\s+/gu, ' '),
    startDate: input.startDate,
  };
}

function serializeValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError('canonical numbers must be integers');
    return String(intOrZero(value));
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const parts = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${serializeValue(record[key])}`);
    return `{${parts.join(',')}}`;
  }
  throw new TypeError('unsupported canonical value');
}

/** Stable string for the fields: keys sorted at every level, integers only. Key order of the input never matters. */
export function serializeMatchFields(fields: CanonicalMatchFields): string {
  return serializeValue(fields);
}

/** normalizeMatchFields then serializeMatchFields; null for a pattern schedule. */
export function canonicalMatchString(input: MatchFieldsInput): string | null {
  const fields = normalizeMatchFields(input);
  return fields === null ? null : serializeMatchFields(fields);
}

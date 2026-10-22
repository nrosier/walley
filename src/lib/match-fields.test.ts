import { describe, expect, it } from 'vitest';
import {
  canonicalMatchString,
  serializeMatchFields,
  type CanonicalMatchFields,
  type MatchFieldsInput,
} from './match-fields.js';

const base: MatchFieldsInput = {
  name: 'Netflix',
  amount: { kind: 'single', cents: -1299 },
  frequency: 'monthly',
  interval: 1,
  currency: 'EUR',
  startDate: '2026-01-03',
};

describe('canonicalMatchString', () => {
  it('ignores key order', () => {
    const reordered: MatchFieldsInput = {
      startDate: '2026-01-03',
      currency: 'EUR',
      interval: 1,
      frequency: 'monthly',
      amount: { cents: -1299, kind: 'single' },
      name: 'Netflix',
    };
    expect(canonicalMatchString(reordered)).toBe(canonicalMatchString(base));
  });

  it('serialises sorted keys at every level', () => {
    const fields: CanonicalMatchFields = {
      name: 'n',
      startDate: null,
      interval: 2,
      frequency: 'weekly',
      currency: 'USD',
      amount: { kind: 'single', cents: 5 },
    };
    expect(serializeMatchFields(fields)).toBe(
      '{"amount":{"cents":5,"kind":"single"},"currency":"USD","frequency":"weekly","interval":2,"name":"n","startDate":null}',
    );
  });

  it('changes when any value changes', () => {
    const ref = canonicalMatchString(base);
    const variants: MatchFieldsInput[] = [
      { ...base, name: 'Netflix 4K' },
      { ...base, amount: { kind: 'single', cents: -1300 } },
      { ...base, frequency: 'yearly' },
      { ...base, interval: 2 },
      { ...base, currency: 'USD' },
      { ...base, startDate: '2026-01-04' },
      { ...base, startDate: null },
    ];
    for (const v of variants) expect(canonicalMatchString(v)).not.toBe(ref);
  });

  it('treats a missing interval as 1 and normalises name spacing and currency case', () => {
    const noInterval: MatchFieldsInput = {
      name: base.name,
      amount: base.amount,
      frequency: base.frequency,
      currency: base.currency,
      startDate: base.startDate,
    };
    expect(canonicalMatchString(noInterval)).toBe(canonicalMatchString(base));
    expect(canonicalMatchString({ ...base, name: '  Netflix ', currency: 'eur' })).toBe(canonicalMatchString(base));
  });

  it('hashes both range bounds', () => {
    const range = (num1: number, num2: number): MatchFieldsInput => ({ ...base, amount: { kind: 'range', num1, num2 } });
    const ref = canonicalMatchString(range(-1000, -2000));
    expect(canonicalMatchString(range(-1000, -2001))).not.toBe(ref);
    expect(canonicalMatchString(range(-999, -2000))).not.toBe(ref);
    expect(ref).not.toBe(canonicalMatchString({ ...base, amount: { kind: 'single', cents: -1500 } }));
  });

  it('gives no canonical string for a pattern schedule', () => {
    expect(canonicalMatchString({ ...base, patterns: [{ value: 1, type: 'day' }] })).toBeNull();
    expect(canonicalMatchString({ ...base, patterns: [] })).not.toBeNull();
  });

  it('rejects floats', () => {
    expect(() => canonicalMatchString({ ...base, amount: { kind: 'single', cents: 12.5 } })).toThrow(RangeError);
    expect(() => canonicalMatchString({ ...base, interval: 1.5 })).toThrow(RangeError);
  });
});

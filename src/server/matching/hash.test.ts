import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { hashMatchFields, sha256Hex } from './hash.js';

const base: MatchFieldsInput = {
  name: 'Netflix',
  amount: { kind: 'single', cents: -1299 },
  frequency: 'monthly',
  interval: 1,
  currency: 'EUR',
  startDate: '2026-01-03',
};

describe('sha256Hex', () => {
  it('matches the known SHA-256 of "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('hashMatchFields', () => {
  it('is the same for any key order', () => {
    const reordered: MatchFieldsInput = {
      startDate: '2026-01-03',
      currency: 'EUR',
      interval: 1,
      frequency: 'monthly',
      amount: { cents: -1299, kind: 'single' },
      name: 'Netflix',
    };
    expect(hashMatchFields(reordered)).toBe(hashMatchFields(base));
    expect(hashMatchFields(base)).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('is the same for names that differ only in case', () => {
    expect(hashMatchFields({ ...base, name: 'netflix' })).toBe(hashMatchFields(base));
    expect(hashMatchFields({ ...base, name: 'NETFLIX' })).toBe(hashMatchFields(base));
  });

  it('changes on a real rename', () => {
    expect(hashMatchFields({ ...base, name: 'Netflix Premium' })).not.toBe(hashMatchFields(base));
  });

  it('changes on a range bound change even when only the name case also differs', () => {
    const range = (a: number, b: number): MatchFieldsInput => ({ ...base, amount: { kind: 'range', num1: a, num2: b } });
    expect(hashMatchFields({ ...range(-100, -200), name: 'netflix' })).toBe(hashMatchFields(range(-100, -200)));
    expect(hashMatchFields({ ...range(-100, -201), name: 'netflix' })).not.toBe(hashMatchFields(range(-100, -200)));
  });

  it('changes when the amount changes', () => {
    expect(hashMatchFields({ ...base, amount: { kind: 'single', cents: -1300 } })).not.toBe(hashMatchFields(base));
  });

  it('changes when either range bound changes', () => {
    const range = (a: number, b: number): MatchFieldsInput => ({ ...base, amount: { kind: 'range', num1: a, num2: b } });
    const ref = hashMatchFields(range(-100, -200));
    expect(hashMatchFields(range(-100, -201))).not.toBe(ref);
    expect(hashMatchFields(range(-101, -200))).not.toBe(ref);
  });

  it('returns null for a pattern schedule', () => {
    expect(hashMatchFields({ ...base, patterns: [{}] })).toBeNull();
  });
});

describe('browser safety', () => {
  it('keeps the canonical serialiser in src/lib free of node:crypto and other Node built-ins', () => {
    const source = readFileSync(new URL('../../lib/match-fields.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from\s+['"]node:/u);
    expect(source).not.toMatch(/import[^;]*crypto/u);
  });
});

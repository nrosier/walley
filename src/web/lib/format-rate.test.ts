import { describe, expect, it } from 'vitest';
import { formatRate } from './format-rate';

describe('formatRate', () => {
  it('never uses exponent notation', () => {
    expect(formatRate(1e-7)).toBe('0.0000001');
    expect(formatRate(2)).toBe('2');
    expect(formatRate(0.5)).toBe('0.5');
    expect(formatRate(1.0833)).toBe('1.0833');
    expect(formatRate(160)).toBe('160');
    expect(formatRate(1e-7)).not.toMatch(/e/i);
  });
  it('keeps the shortest decimal text, with no float noise', () => {
    expect(formatRate(16012.37)).toBe('16012.37');
    expect(formatRate(99999.99)).toBe('99999.99');
  });
  it('leaves a non-finite value as text', () => {
    expect(formatRate(Number.NaN)).toBe('NaN');
  });
});

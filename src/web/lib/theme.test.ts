import { describe, expect, it } from 'vitest';
import { applyTheme, parseTheme, readTheme, THEME_KEY, toggleTheme, writeTheme } from './theme';

const store = (value: string | null) => ({ getItem: () => value });
const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('theme', () => {
  it('defaults to dark with no stored choice', () => {
    expect(readTheme(store(null))).toBe('dark');
  });
  it('lets a stored choice win', () => {
    expect(readTheme(store('light'))).toBe('light');
    expect(readTheme(store('dark'))).toBe('dark');
  });
  it('ignores invalid stored values', () => {
    expect(readTheme(store('purple'))).toBe('dark');
    expect(parseTheme(undefined)).toBe('dark');
  });
  it('falls back to dark when storage throws or is missing', () => {
    expect(readTheme(throwing)).toBe('dark');
    expect(readTheme()).toBe('dark');
    expect(writeTheme('light', throwing)).toBe(false);
  });
  it('writes the choice and toggles', () => {
    const data: Record<string, string> = {};
    expect(writeTheme('light', { setItem: (k, v) => void (data[k] = v) })).toBe(true);
    expect(data[THEME_KEY]).toBe('light');
    expect(toggleTheme('dark')).toBe('light');
    expect(toggleTheme('light')).toBe('dark');
  });
  it('sets data-theme on the root', () => {
    const root = { dataset: {} as DOMStringMap };
    applyTheme('light', root);
    expect(root.dataset.theme).toBe('light');
  });
});

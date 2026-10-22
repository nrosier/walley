import { describe, expect, it } from 'vitest';
import { contrastRatio, parseColor } from './contrast';
import { PALETTE, type ThemeName } from './palette';

const THEMES: ThemeName[] = ['dark', 'light'];

const color = (theme: ThemeName, name: string) => {
  const value = PALETTE[theme][name as keyof (typeof PALETTE)[ThemeName]];
  return parseColor(value);
};

const ratio = (theme: ThemeName, text: string, background: string) =>
  contrastRatio(color(theme, text), color(theme, background), color(theme, 'card'));

const BADGES: Array<[string, string]> = [
  ['success', 'success-bg'],
  ['warning', 'warning-bg'],
  ['neutral', 'neutral-bg'],
];

describe('contrast helpers', () => {
  it('matches the WCAG reference ratio for black on white', () => {
    expect(contrastRatio(parseColor('#000000'), parseColor('#ffffff'))).toBeCloseTo(21, 5);
  });

  it('composites rgba over an opaque backdrop', () => {
    const card = parseColor('#000000');
    const translucentWhite = parseColor('rgb(255 255 255 / 0.5)');
    expect(contrastRatio(parseColor('#ffffff'), translucentWhite, card)).toBeGreaterThan(1);
  });

  it('exposes the CLAUDE.md palette values', () => {
    expect(PALETTE.dark.background).toBe('#0c0f19');
    expect(PALETTE.light.background).toBe('#f8fafc');
    expect(PALETTE.dark['accent-text']).toBe('#6366f1');
    expect(PALETTE.light['accent-text']).toBe('#4f46e5');
  });
});

describe.each(THEMES)('%s theme contrast', (theme) => {
  it('foreground on background and card is at least 4.5', () => {
    expect(ratio(theme, 'foreground', 'background')).toBeGreaterThanOrEqual(4.5);
    expect(ratio(theme, 'foreground', 'card')).toBeGreaterThanOrEqual(4.5);
  });

  it('muted-foreground on card is at least 4.5', () => {
    expect(ratio(theme, 'muted-foreground', 'card')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(BADGES)('%s text on %s over card is at least 4.5', (text, badgeBg) => {
    expect(ratio(theme, text, badgeBg)).toBeGreaterThanOrEqual(4.5);
  });

  it('warning text on card is at least 4.5', () => {
    expect(ratio(theme, 'warning', 'card')).toBeGreaterThanOrEqual(4.5);
  });

  it('primary-foreground on primary is at least 4.5', () => {
    expect(ratio(theme, 'primary-foreground', 'primary')).toBeGreaterThanOrEqual(4.5);
  });

  it('accent-text on card is at least 3.0', () => {
    expect(ratio(theme, 'accent-text', 'card')).toBeGreaterThanOrEqual(3.0);
  });
});

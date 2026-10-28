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

/** Ratio of `text` on `surface`, compositing translucent surfaces over `backdrop`. */
const ratioOver = (theme: ThemeName, text: string, surface: string, backdrop: string) =>
  contrastRatio(color(theme, text), color(theme, surface), color(theme, backdrop));

// Opaque and translucent surfaces; translucent ones are checked over card and over background.
const SURFACES = ['background', 'card', 'surface-2', 'success-bg', 'warning-bg', 'danger-bg', 'info-bg', 'neutral-bg'];
const BACKDROPS = ['card', 'background'];

// Every new text-on-surface pair: [text token, surface token].
const TEXT_PAIRS: Array<[string, string]> = [
  ['danger', 'card'],
  ['danger', 'background'],
  ['danger', 'surface-2'],
  ['danger', 'danger-bg'],
  ['danger-line', 'card'],
  ['info', 'card'],
  ['info', 'background'],
  ['info', 'surface-2'],
  ['info', 'info-bg'],
  ['accent-text', 'card'],
  ['accent-text', 'background'],
  ['accent-text', 'surface-2'],
  ['foreground', 'surface-2'],
];

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
    expect(PALETTE.dark['accent-text']).toBe('#818cf8');
    expect(PALETTE.light['accent-text']).toBe('#4f46e5');
  });

  it('records the approved muted values', () => {
    expect(PALETTE.light.muted).toBe('#556478');
    expect(PALETTE.dark.muted).toBe('#94a3b8');
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

  it.each(SURFACES.flatMap((surface) => BACKDROPS.map((backdrop) => [surface, backdrop])))(
    'muted on %s over %s is at least 4.5',
    (surface, backdrop) => {
      expect(ratioOver(theme, 'muted', surface, backdrop)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(TEXT_PAIRS)('%s on %s is at least 4.5', (text, surface) => {
    expect(ratioOver(theme, text, surface, 'card')).toBeGreaterThanOrEqual(4.5);
    expect(ratioOver(theme, text, surface, 'background')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['background', 'card', 'surface-2'])('focus ring on %s is at least 3.0', (surface) => {
    expect(ratio(theme, 'ring', surface)).toBeGreaterThanOrEqual(3.0);
  });

  it.each(['background', 'card', 'surface-2'])('input-border on %s is at least 3.0', (surface) => {
    expect(ratio(theme, 'input-border', surface)).toBeGreaterThanOrEqual(3.0);
  });

  it('danger-line on card, background and surface-2 is at least 3.0', () => {
    expect(ratio(theme, 'danger-line', 'card')).toBeGreaterThanOrEqual(3.0);
    expect(ratio(theme, 'danger-line', 'background')).toBeGreaterThanOrEqual(3.0);
    expect(ratio(theme, 'danger-line', 'surface-2')).toBeGreaterThanOrEqual(3.0);
  });

  it('keeps the subtle card border separate from the input border', () => {
    expect(color(theme, 'input-border')).not.toEqual(color(theme, 'border'));
  });
});

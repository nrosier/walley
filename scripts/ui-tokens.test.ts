import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Vitest does not process CSS (a ?raw import returns ''), and src/web must not
// import Node built-ins, so the stylesheet is read here. Issue 113.
const css = readFileSync(new URL('../src/web/index.css', import.meta.url), 'utf8');

describe('index.css @theme tokens (issue 113)', () => {
  it('maps --color-hover to --hover so hover:bg-hover generates a rule', () => {
    const theme = css.slice(css.indexOf('@theme'), css.indexOf('}', css.indexOf('@theme')));
    expect(theme).toMatch(/--color-hover:\s*var\(--hover\)/);
  });
});

// Issue 58, D6: the focus ring colour must be visible (>= 3:1, WCAG 1.4.11) on the page and card surfaces of both themes.
describe('focus ring contrast (issue 58)', () => {
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = (hex: string) => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16) / 255));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
  };
  const themeBlock = (selector: string) => {
    const start = css.indexOf(selector);
    return css.slice(start, css.indexOf('}', start));
  };
  const token = (block: string, name: string) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block)?.[1] ?? '';

  it('--ring clears 3:1 on --background and --card in both themes', () => {
    for (const selector of [':root,', ':root[data-theme="light"]']) {
      const block = themeBlock(selector);
      const ring = token(block, '--ring');
      expect(ring).not.toBe('');
      for (const surface of ['--background', '--card']) {
        const color = token(block, surface);
        expect(color).not.toBe('');
        expect(ratio(ring, color)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

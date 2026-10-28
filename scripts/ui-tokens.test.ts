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

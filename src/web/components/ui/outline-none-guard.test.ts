import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(['./*.tsx', '!./*.test.tsx'], { query: '?raw', import: 'default', eager: true });
/** Every web source: the same mistake was repeated on pages, so the class pair is also barred there. */
const allSources = import.meta.glob<string>(['../../**/*.{ts,tsx}', '!../../**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true });

/** Every quoted or template string literal that contains the `outline-none` utility class. */
function outlineNoneStrings(text: string): string[] {
  return [...text.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*?)\1/g)]
    .map((m) => m[2] ?? '')
    .filter((literal) => literal.split(/\s+/).includes('outline-none'));
}

describe('issue 113 focus ring is not cancelled by outline-none', () => {
  it('scans the ui primitives', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });
  it('a class string in components/ui with outline-none also has a focus-visible outline, or is a container that takes focus by script', () => {
    // outline-none sets outline-style: none and beats focus-visible:outline-2, so a control with both draws no ring.
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      for (const literal of outlineNoneStrings(text)) {
        if (/\bfocus-visible:outline-(2|ring)/.test(literal)) offenders.push(`${file}: ${literal.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it('no web source puts outline-none and a focus-visible outline on one control', () => {
    expect(Object.keys(allSources).length).toBeGreaterThan(Object.keys(sources).length);
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(allSources)) {
      for (const literal of outlineNoneStrings(text)) {
        if (/\bfocus-visible:outline-(2|ring)/.test(literal)) offenders.push(`${file}: ${literal.slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it('Button and the dialog action buttons carry no outline-none', () => {
    for (const [file, text] of Object.entries(sources)) {
      if (!/\/(button|dialog)\.tsx$/.test(file)) continue;
      const literals = outlineNoneStrings(text);
      // dialog.tsx keeps outline-none only on the two modal content panels, which take focus by script and are not controls.
      for (const literal of literals) {
        expect(literal, file).toContain('fixed top-1/2 left-1/2');
      }
    }
  });
  it('Button keeps the shared focus outline', () => {
    const button = sources['./button.tsx'] ?? '';
    expect(button).not.toMatch(/(^|[\s"'`])outline-none([\s"'`]|$)/);
    expect(button).toContain('focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring');
  });
});

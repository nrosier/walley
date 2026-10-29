import { describe, expect, it } from 'vitest';
import buttonSrc from './button.tsx?raw';
import dialogSrc from './dialog.tsx?raw';
import diffModalSrc from '../matches/DiffModal.tsx?raw';

const sources = import.meta.glob<string>(
  ['../**/*.tsx', '../../pages/**/*.tsx', '!../**/*.test.tsx', '!../../pages/**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
);

describe('issue 113 focus ring (2px, 2px offset)', () => {
  it('scans real files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });
  it('no component or page uses the 3px 50%-alpha ring', () => {
    const offenders = Object.entries(sources)
      .filter(([, text]) => text.includes('ring-[3px]') || text.includes('ring-ring/50'))
      .map(([file]) => file);
    expect(offenders).toEqual([]);
  });
  it('Button and dialog use the 2px outline with a 2px offset', () => {
    for (const text of [buttonSrc, dialogSrc]) {
      expect(text).toContain('focus-visible:outline-2');
      expect(text).toContain('outline-offset-2');
      expect(text).toContain('focus-visible:outline-ring');
    }
  });
});

describe('issue 113 focus ring is not animated', () => {
  it('Button and the dialog action buttons do not use transition-all (it animates outline width and offset, so a focus reading shows 3px / 0px mid-transition)', () => {
    for (const text of [buttonSrc, dialogSrc]) expect(text).not.toContain('transition-all');
    expect(buttonSrc).toContain('transition-colors');
  });
});

describe('issue 113 hover token', () => {
  it('Button and dialog no longer use hover:bg-accent', () => {
    expect(buttonSrc).not.toContain('hover:bg-accent');
    expect(dialogSrc).not.toContain('hover:bg-accent');
    expect(buttonSrc).toContain('hover:bg-hover');
  });
});

describe('issue 113 Unlink colour', () => {
  const start = diffModalSrc.lastIndexOf('<AlertDialogTrigger asChild>', diffModalSrc.indexOf('<Unlink'));
  const unlinkBlock = diffModalSrc.slice(start, diffModalSrc.indexOf('</AlertDialogTrigger>', start));
  it('Unlink uses the danger token and not the warning token', () => {
    expect(unlinkBlock).toContain('<Unlink');
    expect(unlinkBlock).toContain('border-danger-line');
    expect(unlinkBlock).toContain('text-danger');
    expect(unlinkBlock).toContain('hover:bg-danger-bg');
    expect(unlinkBlock).not.toMatch(/warning|amber/);
  });
});

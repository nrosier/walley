import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalogues } from './catalogues';
import { commonMessages } from './common.messages';
import { I18nProvider } from './I18nProvider';
import { LanguageSelect } from './LanguageSelect';
import { LOCALE_KEY, localeFromLanguages, readStoredLocale, resolveLocale, writeLocale } from './locale';
import { createT, errorText, format, type Catalogue } from './translate';

/** Every string leaf as [dotted path, value]. */
function leaves(node: unknown, prefix = ''): [string, unknown][] {
  if (typeof node !== 'object' || node === null) return [[prefix, node]];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix === '' ? k : `${prefix}.${k}`));
}
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

/** Parity problems of one catalogue: missing or empty nl strings and placeholder mismatches. */
function parityProblems(catalogue: Catalogue<object>): string[] {
  const nl = new Map(leaves(catalogue.nl));
  const problems: string[] = [];
  for (const [path, en] of leaves(catalogue.en)) {
    const value = nl.get(path);
    if (typeof value !== 'string' || value.trim() === '') problems.push(`${path}: missing or empty in nl`);
    else if (typeof en === 'string' && placeholders(en).join() !== placeholders(value).join())
      problems.push(`${path}: placeholders differ`);
  }
  return problems;
}

const store = (value: string | null) => ({ getItem: () => value });
const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('catalogue parity', () => {
  for (const [name, catalogue] of Object.entries(catalogues)) {
    it(`${name}: every en key has a non-empty nl string with the same placeholders`, () => {
      expect(parityProblems(catalogue)).toEqual([]);
    });
  }

  it('detects a removed Dutch key and a placeholder mismatch', () => {
    const nl: Partial<typeof commonMessages.nl> = { ...commonMessages.nl };
    delete nl.genericError;
    expect(parityProblems({ en: commonMessages.en, nl })).toEqual([
      'genericError: missing or empty in nl',
    ]);
    expect(parityProblems({ en: { a: 'Hi {name}' }, nl: { a: 'Hoi {naam}' } })).toEqual(['a: placeholders differ']);
    expect(parityProblems({ en: { a: 'Hi' }, nl: { a: ' ' } })).toEqual(['a: missing or empty in nl']);
  });
});

describe('translate', () => {
  it('looks up nested keys per locale and replaces placeholders', () => {
    const cat = { en: { a: { b: 'Hello {name}, {n} items' } }, nl: { a: { b: 'Hallo {name}, {n} items' } } };
    expect(createT(cat, 'en')('a.b', { name: 'Ada', n: 3 })).toBe('Hello Ada, 3 items');
    expect(createT(cat, 'nl')('a.b', { name: 'Ada', n: 3 })).toBe('Hallo Ada, 3 items');
  });
  it('type-checks message keys', () => {
    const t = createT(commonMessages, 'en');
    expect(t('errors.invalid_url')).toBe(commonMessages.en.errors.invalid_url);
    // @ts-expect-error unknown key is a compile error
    expect(t('errors.nope')).toBe('errors.nope');
  });
  it('leaves unknown placeholders in place', () => {
    expect(format('Hi {name}', {})).toBe('Hi {name}');
  });
  it('translates error codes and falls back for unknown codes', () => {
    expect(errorText('rate_limited', 'en')).toBe(commonMessages.en.errors.rate_limited);
    expect(errorText('rate_limited', 'nl')).toBe(commonMessages.nl.errors.rate_limited);
    expect(errorText('no_such_code', 'nl')).toBe(commonMessages.nl.genericError);
    expect(errorText('toString', 'en')).toBe(commonMessages.en.genericError);
  });
});

describe('locale resolution', () => {
  it('lets a stored value win over the browser', () => {
    expect(resolveLocale({ storage: store('nl'), languages: ['en-US'] })).toBe('nl');
    expect(resolveLocale({ storage: store('en'), languages: ['nl-NL'] })).toBe('en');
  });
  it('uses the first supported browser language', () => {
    expect(resolveLocale({ storage: store(null), languages: ['nl-BE'] })).toBe('nl');
    expect(localeFromLanguages(['fr-FR', 'NL', 'en'])).toBe('nl');
  });
  it('falls back to English for unsupported languages', () => {
    expect(resolveLocale({ storage: store(null), languages: ['fr'] })).toBe('en');
    expect(resolveLocale({ storage: store('de'), languages: [] })).toBe('en');
  });
  it('treats storage that throws as missing', () => {
    expect(readStoredLocale(throwing)).toBeNull();
    expect(resolveLocale({ storage: throwing, languages: ['nl-BE'] })).toBe('nl');
  });
  it('stores the choice and never throws', () => {
    const saved: Record<string, string> = {};
    expect(writeLocale('nl', { setItem: (k, v) => (saved[k] = v) })).toBe(true);
    expect(saved[LOCALE_KEY]).toBe('nl');
    expect(writeLocale('nl', throwing)).toBe(false);
  });
});

describe('LanguageSelect', () => {
  it('renders a labelled custom dropdown (globe, current language, chevron), not a native select', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="nl">
        <LanguageSelect />
      </I18nProvider>,
    );
    // The only <select> is Radix's hidden form input (aria-hidden, name="locale"); the visible control is the combobox.
    expect(html).toMatch(/<select aria-hidden="true"[^>]*name="locale"/);
    expect(html.match(/<select(?![^>]*aria-hidden)/g)).toBeNull();
    expect(html).toContain('role="combobox"');
    expect(html).toContain('Taal (Dit apparaat)');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('Nederlands');
    expect(html).toContain('lucide-globe');
    expect(html).toContain('lucide-chevron-down');
    expect(html).toContain('name="locale"');
  });
  it('shows the English label in en', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <LanguageSelect />
      </I18nProvider>,
    );
    expect(html).toContain('Language (This device)');
  });
});

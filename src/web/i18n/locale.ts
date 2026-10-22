/** Pure locale resolution and storage. No React; safe to call without a DOM. */
export type Locale = 'en' | 'nl';

export const LOCALES: readonly Locale[] = ['en', 'nl'];
export const LOCALE_KEY = 'walley-locale';
export const DEFAULT_LOCALE: Locale = 'en';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export function parseLocale(value: unknown): Locale | null {
  return value === 'en' || value === 'nl' ? value : null;
}

/** Reads the stored choice. Missing, invalid or inaccessible storage gives null. */
export function readStoredLocale(storage?: ReadableStorage): Locale | null {
  try {
    const store = storage ?? globalThis.localStorage;
    return parseLocale(store.getItem(LOCALE_KEY));
  } catch {
    return null;
  }
}

/** First browser language whose primary subtag is a supported locale, e.g. 'nl-BE' gives 'nl'. */
export function localeFromLanguages(languages: readonly string[] | undefined): Locale | null {
  for (const tag of languages ?? []) {
    const prefix = parseLocale(tag.toLowerCase().split(/[-_]/)[0]);
    if (prefix !== null) return prefix;
  }
  return null;
}

function browserLanguages(): readonly string[] {
  try {
    const nav = globalThis.navigator as Navigator | undefined;
    if (nav === undefined) return [];
    if (nav.languages.length > 0) return nav.languages;
    return [nav.language];
  } catch {
    return [];
  }
}

export interface LocaleSources {
  storage?: ReadableStorage;
  languages?: readonly string[];
}

/** Stored value, then the first matching browser language, then English. */
export function resolveLocale(sources: LocaleSources = {}): Locale {
  return (
    readStoredLocale(sources.storage) ??
    localeFromLanguages(sources.languages ?? browserLanguages()) ??
    DEFAULT_LOCALE
  );
}

/** Persists the choice. Returns false when storage is unavailable; never throws. */
export function writeLocale(locale: Locale, storage?: WritableStorage): boolean {
  try {
    const store = storage ?? globalThis.localStorage;
    store.setItem(LOCALE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

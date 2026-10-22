export type Theme = 'dark' | 'light';

export const THEME_KEY = 'walley-theme';
export const DEFAULT_THEME: Theme = 'dark';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

export function parseTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' ? value : DEFAULT_THEME;
}

export function toggleTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

/** Reads the stored choice. Missing, invalid or inaccessible storage gives dark. */
export function readTheme(storage?: ReadableStorage): Theme {
  try {
    const store = storage ?? globalThis.localStorage;
    return parseTheme(store.getItem(THEME_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** Persists the choice. Returns false when storage is unavailable; never throws. */
export function writeTheme(theme: Theme, storage?: WritableStorage): boolean {
  try {
    const store = storage ?? globalThis.localStorage;
    store.setItem(THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

export function applyTheme(theme: Theme, root: { dataset: DOMStringMap } = document.documentElement): void {
  root.dataset.theme = theme;
}

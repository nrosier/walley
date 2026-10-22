import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LocaleContext } from './context';
import { resolveLocale, writeLocale, type Locale } from './locale';

/** Holds the active locale, stores changes in localStorage and mirrors it to <html lang>. */
export function I18nProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale ?? resolveLocale());

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    writeLocale(next);
    setLocaleState(next);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

import { createContext, useContext, useMemo } from 'react';
import type { Locale } from './locale';
import { createT, errorText, type Catalogue, type TFunction } from './translate';

export interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const LocaleContext = createContext<LocaleContextValue>({ locale: 'en', setLocale: () => undefined });

/** Active locale and its setter (which also stores the choice). */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Translator for one catalogue in the active locale, plus errorText for server error codes. */
export function useT<T extends object>(catalogue: Catalogue<T>): { t: TFunction<T>; errorText: (code: string) => string; locale: Locale } {
  const { locale } = useLocale();
  return useMemo(
    () => ({ t: createT(catalogue, locale), errorText: (code: string) => errorText(code, locale), locale }),
    [catalogue, locale],
  );
}

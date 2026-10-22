/** Public i18n entry point. Import from '@/i18n'. */
export { I18nProvider } from './I18nProvider';
export { useLocale, useT, type LocaleContextValue } from './context';
export { LanguageSelect } from './LanguageSelect';
export { LOCALES, resolveLocale, writeLocale, type Locale } from './locale';
export { createT, errorText, format, type Catalogue, type MessageKey, type Params, type TFunction } from './translate';

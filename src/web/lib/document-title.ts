import { useEffect } from 'react';
import { useLocale, createT, type Locale } from '@/i18n';
import { appMessages } from '@/App.messages';
import type { Route } from './route';

const ROUTE_KEY = {
  sync: 'routes.sync',
  settings: 'routes.settings',
  login: 'routes.login',
  'verify-email': 'routes.verifyEmail',
  notFound: 'routes.notFound',
} as const satisfies Record<Route, string>;

/** The document title for a route in a locale, for example "Matches - Walley". */
export function documentTitle(route: Route, locale: Locale): string {
  const t = createT(appMessages, locale);
  return t('documentTitle', { page: t(ROUTE_KEY[route]) });
}

/** Sets document.title for the route and keeps it in step with the language. */
export function useDocumentTitle(route: Route): void {
  const { locale } = useLocale();
  useEffect(() => {
    document.title = documentTitle(route, locale);
  }, [route, locale]);
}

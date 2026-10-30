import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { NotFound } from './NotFound';

const render = (locale: Locale) =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <NotFound />
    </I18nProvider>,
  );

describe('NotFound', () => {
  it('shows a heading and a link to the Sync Dashboard (en)', () => {
    const html = render('en');
    expect(html).toMatch(/<h1[^>]*>Page not found<\/h1>/);
    expect(html).toMatch(/<a href="\/sync"[^>]*>Go to the Sync Dashboard<\/a>/);
  });
  it('shows the Dutch copy (nl)', () => {
    const html = render('nl');
    expect(html).toMatch(/<h1[^>]*>Pagina niet gevonden<\/h1>/);
    expect(html).toMatch(/<a href="\/sync"[^>]*>Ga naar het synchronisatiedashboard<\/a>/);
  });
});

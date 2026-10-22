import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { SettingsPage } from './SettingsPage';

const render = (locale: Locale) =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <SettingsPage />
    </I18nProvider>,
  );

const headings = (html: string, level: 1 | 2) =>
  [...html.matchAll(new RegExp(`<h${String(level)}[^>]*>([^<]*)</h${String(level)}>`, 'g'))].map((m) => (m[1] ?? '').trim());

describe('SettingsPage', () => {
  it('renders one h1 and the section headings in order (en)', () => {
    const html = render('en');
    expect(headings(html, 1)).toEqual(['Settings']);
    // AccountSettings shows its own "Account / Security" h2 once GET /api/account has loaded; SSR renders its loading state.
    expect(headings(html, 2)).toEqual(['General', 'Wallos', 'Actual Budget', 'Matching']);
    expect(html).toContain('This device');
    expect(html).toContain('Your account');
    expect(html).toContain('name="locale"');
    expect(html.indexOf('Your account')).toBeLessThan(html.indexOf('>Wallos<'));
  });
  it('renders the section headings in Dutch', () => {
    const html = render('nl');
    expect(headings(html, 1)).toEqual(['Instellingen']);
    expect(headings(html, 2)).toEqual(['Algemeen', 'Wallos', 'Actual Budget', 'Koppeling']);
    expect(html).toContain('Dit apparaat');
    expect(html).toContain('Uw account');
  });
});

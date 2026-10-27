import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { SettingsPage } from './SettingsPage';
import pageSrc from './SettingsPage.tsx?raw';
import appSrc from '../App.tsx?raw';

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
    // AccountSettings renders its card heading even while GET /api/account is loading.
    expect(headings(html, 2)).toEqual(['General', 'Wallos', 'Actual Budget', 'Matching', 'Account / Security']);
    expect(html).toContain('This device');
    expect(html).toContain('Your account');
    expect(html).toContain('name="locale"');
    // The scope pill sits in each card header, right after its heading.
    expect(html).toMatch(/>Wallos<\/h2><span[^>]*data-scope="account"[^>]*>Your account</);
  });
  it('renders the section headings in Dutch', () => {
    const html = render('nl');
    expect(headings(html, 1)).toEqual(['Instellingen']);
    expect(headings(html, 2)).toEqual(['Algemeen', 'Wallos', 'Actual Budget', 'Koppeling', 'Account / Beveiliging']);
    expect(html).toContain('Dit apparaat');
    expect(html).toContain('Uw account');
  });
});

describe('SettingsPage layout', () => {
  it('puts every section in a card with a scope pill: General on this device, the rest on the account', () => {
    const html = render('en');
    expect(html.match(/data-settings-card="device"/g)).toHaveLength(1);
    expect(html.match(/data-settings-card="account"/g)).toHaveLength(4);
    expect(html.match(/data-slot="scope-pill"/g)).toHaveLength(5);
  });
  it('has a sticky anchor nav and, for narrow screens, a labelled Select of the same sections', () => {
    const html = render('en');
    expect(html).toContain('aria-label="Settings sections"');
    for (const id of ['settings-general', 'settings-wallos', 'settings-actual', 'settings-matching', 'settings-account']) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<option value="${id}"`);
    }
    expect(html).toContain('sticky top-4');
    expect(html).toContain('>Section</span>');
    expect(render('nl')).toContain('>Onderdeel</span>');
  });
  it('General holds the language picker and a Theme control matching the header toggle, and says changes apply at once', () => {
    const html = render('en');
    const general = html.slice(html.indexOf('id="settings-general"'), html.indexOf('id="settings-wallos"'));
    expect(general).toContain('name="locale"');
    expect(general).toContain('role="radiogroup" aria-label="Theme"');
    expect(general).toMatch(/value="dark"[^>]*checked=""|checked=""[^>]*value="dark"/);
    expect(general).toContain('Changes apply immediately.');
    expect(general).not.toContain('type="submit"');
  });
  it('each account card with settings has exactly one footer Save', () => {
    const html = render('en');
    for (const form of ['wallos-settings-form', 'actual-settings-form', 'matching-settings-form']) {
      expect(html.match(new RegExp(`form="${form}"`, 'g')), form).toHaveLength(1);
    }
    expect(html).toContain('>Save Wallos<');
    expect(html).toContain('>Save Actual Budget<');
    expect(html).toContain('>Save Matching<');
  });
  it('keeps the "Save first" help on the Wallos card until typed-value testing lands', () => {
    expect(render('en')).toContain('Save first.');
  });
});

describe('Theme control wiring', () => {
  it('shares one theme state with the header toggle through the shell provider', () => {
    expect(appSrc).toContain('ThemeControlContext.Provider');
    expect(appSrc).toMatch(/onToggleTheme = useCallback\(\(\) => \{\s*chooseTheme\(toggleTheme\(theme\)\)/);
    expect(appSrc).toContain('writeTheme(next)');
    expect(pageSrc).toContain('useThemeControl()');
  });
});

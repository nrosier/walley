import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { SettingsPage } from './SettingsPage';
import pageSrc from './SettingsPage.tsx?raw';
import appSrc from '../App.tsx?raw';
import wallosSrc from './WallosSettings.tsx?raw';
import actualSrc from './ActualSettings.tsx?raw';
import matchingSrc from './MatchingSettings.tsx?raw';
import { settingsPageMessages } from './SettingsPage.messages';

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

describe('Settings save refreshes the Sync Dashboard', () => {
  it('re-runs the shared sync check after a successful Wallos or Actual save, so "not set up" does not stay stale', () => {
    const wallos = wallosSrc.slice(wallosSrc.indexOf('const save = '), wallosSrc.indexOf('const runTest'));
    const actual = actualSrc.slice(actualSrc.indexOf('const save = '), actualSrc.indexOf('const loadBudgets'));
    expect(wallos).toContain('syncStore.requestRun()');
    expect(actual).toContain('syncStore.requestRun()');
  });
});

describe('Settings checklist (issue 113)', () => {
  it('Each account card has a single footer Save covering budget pick and tolerance, with "Unsaved changes" / "No unsaved changes"', () => {
    const html = render('en');
    for (const [card, form, label] of [
      ['settings-wallos', 'wallos-settings-form', 'Save Wallos'],
      ['settings-actual', 'actual-settings-form', 'Save Actual Budget'],
      ['settings-matching', 'matching-settings-form', 'Save Matching'],
    ] as const) {
      const start = html.indexOf(`id="${card}"`);
      const section = html.slice(start, html.indexOf('</section>', start));
      const footer = section.slice(section.indexOf('<footer'));
      expect(footer.match(/type="submit"/g), card).toHaveLength(1);
      expect(footer, card).toContain(`form="${form}"`);
      expect(footer, card).toContain(`>${label}<`);
      expect(footer, card).toContain('No unsaved changes');
    }
    // Budget pick only changes the form; the footer Save sends it. Tolerance saves only through the footer.
    const pick = actualSrc.slice(actualSrc.indexOf('const pickBudget'), actualSrc.indexOf('return (\n    <ActualSettingsView'));
    expect(pick).not.toContain('saveBudgetChoice');
    expect(actualSrc.slice(actualSrc.indexOf('const save = '), actualSrc.indexOf('const loadBudgets'))).toContain('saveBudget(pick)');
    expect(matchingSrc).toContain('<SaveFooter');
    expect(matchingSrc).not.toMatch(/onBlur|onPointerUp|onKeyUp/);
    expect(settingsPageMessages.en.save).toEqual({ unsaved: 'Unsaved changes', clean: 'No unsaved changes' });
  });
  it('General saves instantly with "Saved"; Theme control is in General and matches the header toggle', () => {
    const html = render('en');
    const general = html.slice(html.indexOf('id="settings-general"'), html.indexOf('id="settings-wallos"'));
    expect(general).toContain('role="radiogroup" aria-label="Theme"');
    expect(general).not.toContain('type="submit"');
    expect(general).toContain('role="status"');
    // Language and theme changes apply at once and flash "Saved".
    const card = pageSrc.slice(pageSrc.indexOf('function GeneralCard'), pageSrc.indexOf('export function SettingsPage'));
    expect(card).toContain('<LanguageSelect onChange={flash} />');
    expect(card).toMatch(/setTheme\(parseTheme\(value\)\);\s*flash\(\);/);
    expect(card).toContain("t('general.saved')");
    expect(settingsPageMessages.en.general.saved).toBe('Saved');
    // The control reads and writes the same theme state the header toggle uses.
    expect(card).toContain('useThemeControl()');
    expect(appSrc).toContain('ThemeControlContext.Provider value={themeControl}');
    expect(appSrc).toContain('onToggleTheme={onToggleTheme}');
  });
});

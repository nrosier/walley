import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import type { Route } from '@/lib/route';
import { AppShell } from './AppShell';

const noop = () => undefined;
const render = (route: Route, opts: { theme?: 'dark' | 'light'; locale?: Locale; open?: boolean } = {}) =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={opts.locale ?? 'en'}>
      <AppShell
        route={route}
        theme={opts.theme ?? 'dark'}
        email="a@example.test"
        onRefresh={noop}
        onToggleTheme={noop}
        onLogout={noop}
        menuDefaultOpen={opts.open}
      >
        body
      </AppShell>
    </I18nProvider>,
  );

describe('AppShell', () => {
  it('renders title, path tabs and header actions', () => {
    const html = render('matches');
    expect(html).toContain('Walley');
    for (const label of ['Sync Dashboard', 'Matches', 'Settings']) expect(html).toContain(label);
    expect(html).toContain('href="/sync"');
    expect(html).toContain('href="/matches"');
    expect(html).toContain('href="/settings"');
    expect(html).not.toContain('href="#');
    expect(html).toContain('aria-label="Refresh"');
    expect(html).toContain('aria-label="Switch to light theme"');
    expect(html).toContain('body');
  });
  it('marks only the active tab with aria-current', () => {
    const html = render('matches');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Matches/);
  });
  it('offers dark when light is active', () => {
    expect(render('sync', { theme: 'light' })).toContain('Switch to dark theme');
  });
  it('renders the user menu trigger with the email, closed by default', () => {
    const html = render('sync');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-label="Account menu for a@example.test"');
    expect(html).toContain('a@example.test');
    expect(html).not.toContain('Log out');
  });
  it('shows Log out as a menu item when the menu is open', () => {
    const html = render('sync', { open: true });
    expect(html).toContain('role="menu"');
    expect(html).toMatch(/role="menuitem"[^>]*>.*Log out/);
  });
  it('translates to Dutch', () => {
    const html = render('settings', { locale: 'nl', open: true });
    for (const label of ['Synchronisatie', 'Koppelingen', 'Instellingen', 'Vernieuwen', 'Uitloggen']) expect(html).toContain(label);
  });
});

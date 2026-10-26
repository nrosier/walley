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
    expect(html).not.toContain('href="#/');
    expect(html).toContain('aria-label="Refresh"');
    expect(html).toContain('aria-label="Switch to light theme"');
    expect(html).toContain('body');
  });
  it('marks only the active tab with aria-current', () => {
    const html = render('matches');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>.*?<span[^>]*>Matches<\/span>/);
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
  it('puts the skip link first, targeting the main content', () => {
    const html = render('sync');
    const firstHref = /<a\b[^>]*href="([^"]*)"/.exec(html)?.[1];
    expect(firstHref).toBe('#main');
    expect(html).toContain('Skip to main content');
    expect(html).toMatch(/<main[^>]*id="main"/);
    expect(render('sync', { locale: 'nl' })).toContain('Naar hoofdinhoud springen');
  });
  it('links the title to /sync from every route', () => {
    for (const route of ['sync', 'matches', 'settings'] as const) {
      expect(render(route)).toMatch(/<a href="\/sync"[^>]*aria-label="Walley, go to Sync Dashboard"[^>]*>Walley<\/a>/);
    }
  });
  it('wraps the header and keeps tab names when icon-only', () => {
    const html = render('sync');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('w-full');
    expect(html).toContain('min-h-(--control-h)');
    expect(html).toMatch(/<span class="sr-only md:not-sr-only">Matches<\/span>/);
  });
});

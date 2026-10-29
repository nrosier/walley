import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import type { Route } from '@/lib/route';
import appSrc from '../App.tsx?raw';
import { documentTitle } from '../lib/document-title';
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
  it('Below 768px the header wraps, tabs form a second row, and nothing clips; title links to /sync', () => {
    const html = render('sync');
    const header = /<header class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(header).toContain('flex-wrap');
    expect(header).not.toMatch(/overflow-(hidden|x-auto|x-scroll)/);
    // The tab nav drops to its own full-width row below md and joins the header row from md up.
    const nav = /<nav [^>]*class="([^"]*)"/.exec(html)?.[1] ?? '';
    for (const cls of ['order-last', 'w-full', 'md:order-none', 'md:w-auto', 'md:flex-1']) expect(nav).toContain(cls);
    expect(nav).not.toMatch(/overflow-(hidden|x-auto|x-scroll)/);
    // Tabs share the row and keep a name when icon-only; the email is hidden below md instead of clipping.
    expect(html.match(/class="[^"]*\bflex-1\b[^"]*"[^>]*>(?:<svg|<span)/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(html).toMatch(/<span class="sr-only md:not-sr-only">Sync Dashboard<\/span>/);
    expect(html).toMatch(/<span class="hidden max-w-48 truncate md:inline">a@example.test<\/span>/);
    // Title links to /sync from every route and is a 44px target on narrow screens.
    for (const route of ['sync', 'matches', 'settings'] as const) {
      expect(render(route)).toMatch(/<a href="\/sync"[^>]*class="[^"]*min-h-\(--control-h\)[^"]*"[^>]*>Walley<\/a>/);
    }
  });
  it('Each route sets its own <title> (for example "Matches - Walley"); skip link is first focusable', () => {
    const titles = (['sync', 'matches', 'settings'] as const).map((r) => documentTitle(r, 'en'));
    expect(titles).toEqual(['Sync Dashboard - Walley', 'Matches - Walley', 'Settings - Walley']);
    expect(documentTitle('settings', 'nl')).toBe('Instellingen - Walley');
    // App sets the title for every route (including login and verify-email) before choosing what to render.
    expect(appSrc).toMatch(/const route = useRoute\(\);\s*useDocumentTitle\(route\);/);
    for (const route of ['sync', 'matches', 'settings'] as const) {
      const html = render(route);
      // The first focusable element in the shell is the skip link; no positive tabindex jumps ahead of it.
      const first = /<(?:a|button|input|select|textarea)\b[^>]*>|<[^>]*\btabindex="[^"]*"[^>]*>/.exec(html)?.[0] ?? '';
      expect(first, route).toContain('href="#main"');
      expect(html).not.toMatch(/tabindex="[1-9]/);
    }
  });
  it('issue 113: skip link, logo, tabs and header buttons carry the shared 2px/2px solid focus treatment', () => {
    const html = render('matches');
    const shared = ['focus-visible:outline-2', 'focus-visible:outline-offset-2', 'focus-visible:outline-ring'];
    const tags = html.match(/<(?:a|button)\b[^>]*>/g) ?? [];
    // skip link, logo, 3 tabs, Refresh, theme toggle, Account menu
    expect(tags).toHaveLength(8);
    for (const tag of tags) {
      for (const cls of shared) expect(tag, tag).toContain(cls);
      // No competing ring, auto outline or animated outline width/offset on these controls.
      expect(tag, tag).not.toMatch(/(^|[\s"])ring-|focus:ring|transition-all|outline-none|outline-1|outline-3/);
    }
    expect(tags[0]).toContain('href="#main"');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from './AppShell';

const noop = () => undefined;
const render = (route: 'sync' | 'matches' | 'settings' | 'login', theme: 'dark' | 'light' = 'dark') =>
  renderToStaticMarkup(
    <AppShell route={route} theme={theme} onRefresh={noop} onToggleTheme={noop} onLogout={noop}>
      body
    </AppShell>,
  );

describe('AppShell', () => {
  it('renders title, tabs and header actions', () => {
    const html = render('matches');
    expect(html).toContain('Walley');
    for (const label of ['Sync Dashboard', 'Matches', 'Settings']) expect(html).toContain(label);
    expect(html).toContain('href="#/settings"');
    expect(html).toContain('aria-label="Refresh"');
    expect(html).toContain('aria-label="Switch to light theme"');
    expect(html).toContain('aria-label="Log out"');
    expect(html).toContain('body');
  });
  it('marks only the active tab with aria-current', () => {
    const html = render('matches');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Matches/);
  });
  it('offers dark when light is active', () => {
    expect(render('sync', 'light')).toContain('Switch to dark theme');
  });
});

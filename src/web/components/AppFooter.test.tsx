// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import packageJson from '../../../package.json';
import { AppShell } from './AppShell';

// Footer and About dialog. Runs in jsdom (per-file pragma) so the dialog can be opened and inspected.

const pkg = packageJson as { version: string };
const noop = () => undefined;

const renderShell = (locale: Locale = 'en') =>
  render(
    <I18nProvider initialLocale={locale}>
      <AppShell route="sync" theme="dark" email="a@example.test" onRefresh={noop} onToggleTheme={noop} onLogout={noop}>
        body
      </AppShell>
    </I18nProvider>,
  );

afterEach(() => {
  cleanup();
});

describe('AppFooter', () => {
  it('shows the version from package.json in the footer', () => {
    expect(__APP_VERSION__).toBe(pkg.version);
    renderShell();
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toContain(`Walley v${pkg.version}`);
  });

  it('shows the copyright line and MIT in the footer', () => {
    renderShell();
    const footer = screen.getByRole('contentinfo');
    expect(footer.textContent).toContain('Copyright (c) 2026 Nick Rosier');
    expect(footer.textContent).toContain('MIT');
  });

  it('renders an About button in the footer', () => {
    renderShell();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('button', { name: 'About' })).toBeTruthy();
  });

  it('opens the About dialog with name, description, version, copyright, MIT licence and project link', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'About' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('About Walley')).toBeTruthy();
    expect(within(dialog).getByText(`Version ${pkg.version}`)).toBeTruthy();
    expect(within(dialog).getByText('Copyright (c) 2026 Nick Rosier')).toBeTruthy();
    expect(within(dialog).getByText('License: MIT')).toBeTruthy();
    const link = within(dialog).getByRole('link', { name: 'Project page on GitHub' });
    expect(link.getAttribute('href')).toBe('https://github.com/nrosier/walley');
  });

  it('translates the footer and About dialog to Dutch', () => {
    renderShell('nl');
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('button', { name: 'Over' })).toBeTruthy();
    fireEvent.click(within(footer).getByRole('button', { name: 'Over' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Over Walley')).toBeTruthy();
    expect(within(dialog).getByText('Licentie: MIT')).toBeTruthy();
  });

  it('keeps the footer on every route', () => {
    for (const route of ['sync', 'settings'] as const) {
      const { unmount } = render(
        <I18nProvider initialLocale="en">
          <AppShell route={route} theme="dark" email="a@example.test" onRefresh={noop} onToggleTheme={noop} onLogout={noop}>
            body
          </AppShell>
        </I18nProvider>,
      );
      expect(screen.getByRole('contentinfo')).toBeTruthy();
      unmount();
    }
  });
});

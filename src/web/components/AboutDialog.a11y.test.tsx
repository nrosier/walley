// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { expectDialogAccessibility, expectFocusTrapped, installDomPolyfills, nameOf, pressKey, tabbables, waitForFocus } from '../a11y.helpers';
import { appShellMessages } from './AppShell.messages';
import { AppShell } from './AppShell';

// Keyboard and screen reader behaviour of the About dialog, opened from the AppShell footer (issue 58).
// jsdom proves the wiring (names, description, trap, focus return); it cannot prove real Tab order.

beforeAll(installDomPolyfills);
afterEach(cleanup);

const noop = () => undefined;

function mount(locale: Locale = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <AppShell route="sync" theme="dark" email="a@example.test" onRefresh={noop} onToggleTheme={noop} onLogout={noop}>
        body
      </AppShell>
    </I18nProvider>,
  );
  const footer = screen.getByRole('contentinfo');
  return { opener: within(footer).getByRole('button', { name: appShellMessages[locale].footer.about }) };
}

/** Opens the dialog the keyboard way: focus the button and press Enter (jsdom needs the explicit click). */
async function open(opener: HTMLElement): Promise<HTMLElement> {
  opener.focus();
  pressKey(opener, 'Enter');
  fireEvent.click(opener);
  return screen.findByRole('dialog');
}

describe('About dialog accessibility', () => {
  it('is named and described, with a named close control and a named GitHub link', async () => {
    const { opener } = mount();
    const dialog = await open(opener);
    const m = appShellMessages.en.about;
    expectDialogAccessibility(dialog, { name: m.title, description: m.description });
    expect(nameOf(dialog.querySelector('[data-slot="dialog-close"]') as HTMLElement)).toBe('Close');
    const link = within(dialog).getByRole('link', { name: m.repository });
    expect(link.getAttribute('href')).toBe('https://github.com/nrosier/walley');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(nameOf(link)).toBe(m.repository);
  });

  it('shows the version, copyright and MIT licence text', async () => {
    const { opener } = mount();
    const dialog = await open(opener);
    const m = appShellMessages.en.about;
    expect(within(dialog).getByText(m.version.replace('{version}', __APP_VERSION__))).toBeTruthy();
    expect(within(dialog).getByText(m.copyright)).toBeTruthy();
    expect(within(dialog).getByText(m.license)).toBeTruthy();
    expect(m.license).toContain('MIT');
  });

  it('puts initial focus inside the dialog, on the Close control (Radix skips links; the walkthrough saw the container, D9)', async () => {
    const { opener } = mount();
    const dialog = await open(opener);
    const close = dialog.querySelector('[data-slot="dialog-close"]') as HTMLElement;
    await waitForFocus(close);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(nameOf(document.activeElement as Element)).toBe('Close');
  });

  it('traps Tab inside the dialog and hides the page behind it', async () => {
    const { opener } = mount();
    const dialog = await open(opener);
    const stops = tabbables(dialog).map((el) => nameOf(el));
    expect(stops).toEqual([appShellMessages.en.about.repository, 'Close']);
    expectFocusTrapped(dialog);
  });

  it('Escape closes it and returns focus to the About button', async () => {
    const { opener } = mount();
    const dialog = await open(opener);
    pressKey(dialog, 'Escape');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(opener);
  });

  it('the Close control also returns focus to the About button', async () => {
    const { opener } = mount();
    const dialog = await open(opener);
    fireEvent.click(dialog.querySelector('[data-slot="dialog-close"]') as HTMLElement);
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(opener);
  });

  it('is named differently in English and Dutch, and the Dutch name matches the catalogue', async () => {
    const en = mount('en');
    const enDialog = await open(en.opener);
    const enName = nameOf(enDialog);
    cleanup();
    const nl = mount('nl');
    const nlDialog = await open(nl.opener);
    const nlName = nameOf(nlDialog);
    expect(enName).toBe(appShellMessages.en.about.title);
    expect(nlName).toBe(appShellMessages.nl.about.title);
    expect(nlName).not.toBe(enName);
    expectDialogAccessibility(nlDialog, { name: appShellMessages.nl.about.title, description: appShellMessages.nl.about.description });
    expect(nameOf(nlDialog.querySelector('[data-slot="dialog-close"]') as HTMLElement)).toBe('Sluiten');
    expect(within(nlDialog).getByText(appShellMessages.nl.about.license)).toBeTruthy();
    pressKey(nlDialog, 'Escape');
    await waitForFocus(nl.opener);
  });
});

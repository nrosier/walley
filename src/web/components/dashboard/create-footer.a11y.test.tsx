// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { cleanupDashboard, mountDashboard, openRowMenuItem, type FailableEndpoint, type MountedDashboard } from '../../a11y.helpers';
import { createModalMessages } from './CreateModal.messages';

// Issue 215: the shared create footer keeps keyboard focus on the Create button while a create is pending, after it
// failed, and while it is off for a reason. A natively disabled button drops focus to the body, so the button is
// aria-disabled and the click and submit handlers block it. jsdom limits: it runs no implicit submission on Enter,
// so a browser's Enter-in-a-field is emulated by the click it fires on the form's default button plus a submit event.

afterEach(cleanupDashboard);

const fill = (text: string, vars: Record<string, string>): string => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), text);
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Holds back the answer to the matching POSTs until `release()`, and counts how many requests were started. */
function holdPosts(pattern: RegExp): { release: () => void; started: () => number } {
  const real = globalThis.fetch;
  let release = (): void => undefined;
  const open = new Promise<void>((resolve) => { release = resolve; });
  let count = 0;
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    if (pattern.test(input) && (init?.method ?? 'GET').toUpperCase() === 'POST') {
      count += 1;
      return open.then(() => real(input, init));
    }
    return real(input, init);
  }) as typeof fetch;
  return { release, started: () => count };
}

interface Scenario {
  name: string;
  endpoint: RegExp;
  /** Opens the dialog and returns it once the form is ready and every field but the blocking one is valid. */
  open: (locale: Locale, mounted: MountedDashboard) => Promise<HTMLElement>;
  /** Makes Create unavailable for a reason the user can fix. */
  block: (dialog: HTMLElement, locale: Locale) => void;
  /** The reason text the button must be described by. */
  reason: (locale: Locale) => string;
  /** Makes Create available again. */
  unblock: (dialog: HTMLElement, locale: Locale) => void;
  /** True when the form starts in the blocked state (no account yet), so `open` leaves it blocked. */
  startsBlocked: boolean;
}

const m = (locale: Locale) => createModalMessages[locale];
const accountField = (dialog: HTMLElement, locale: Locale): HTMLElement => within(dialog).getByLabelText(new RegExp(`^${escapeRe(m(locale).actual.account)}`));

const actualScenario = (kind: 'row' | 'recreate'): Scenario => ({
  name: kind === 'row' ? 'Create in Actual Budget' : 'Recreate in Actual Budget',
  endpoint: /\/api\/integrations\/actual-schedules$/,
  open: async (locale) => {
    if (kind === 'row') {
      const button = screen.getByRole('button', { name: fill(syncDashboardMessages[locale].row.createInActualNamed, { name: 'Hulu' }) });
      act(() => { button.focus(); });
      fireEvent.click(button);
    } else {
      await openRowMenuItem('Orphan', syncDashboardMessages[locale].orphan.recreateActual);
    }
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(m(locale).actual.name);
    return dialog;
  },
  block: (dialog, locale) => { fireEvent.change(accountField(dialog, locale), { target: { value: '' } }); },
  reason: (locale) => fill(m(locale).actual.createDisabled, { reason: m(locale).actual.accountRequired }),
  unblock: (dialog, locale) => { fireEvent.change(accountField(dialog, locale), { target: { value: 'acc1' } }); },
  startsBlocked: true,
});

const wallosScenario = (kind: 'row' | 'recreate'): Scenario => ({
  name: kind === 'row' ? 'Create in Wallos' : 'Recreate in Wallos',
  endpoint: /\/api\/integrations\/wallos-subscriptions$/,
  open: async (locale) => {
    if (kind === 'row') {
      const button = screen.getByRole('button', { name: fill(syncDashboardMessages[locale].row.createInWallosNamed, { name: 'Gym' }) });
      act(() => { button.focus(); });
      fireEvent.click(button);
    } else {
      await openRowMenuItem('Lost', syncDashboardMessages[locale].orphan.recreateWallos);
    }
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(m(locale).wallos.name);
    return dialog;
  },
  block: (dialog, locale) => { fireEvent.change(within(dialog).getByLabelText(m(locale).wallos.name), { target: { value: '' } }); },
  reason: (locale) => fill(m(locale).wallos.createDisabled, { reason: m(locale).wallos.titleInvalid }),
  unblock: (dialog, locale) => { fireEvent.change(within(dialog).getByLabelText(m(locale).wallos.name), { target: { value: 'Gym' } }); },
  startsBlocked: false,
});

const scenarios = [actualScenario('row'), wallosScenario('row'), actualScenario('recreate'), wallosScenario('recreate')];

const submitOf = (dialog: HTMLElement, locale: Locale): HTMLElement => within(dialog).getByRole('button', { name: new RegExp(`^(${escapeRe(m(locale).submit)}|${escapeRe(m(locale).creating)})$`) });
const formOf = (dialog: HTMLElement): HTMLFormElement => dialog.querySelector('form') as HTMLFormElement;

/** What a browser does for Enter in a form field: a click on the default button, then a submit event if that was not stopped. */
function enterInField(dialog: HTMLElement, locale: Locale): void {
  fireEvent.click(submitOf(dialog, locale));
  fireEvent.submit(formOf(dialog));
}

async function ready(s: Scenario, locale: Locale, fail: readonly FailableEndpoint[] = []): Promise<{ dialog: HTMLElement; mounted: MountedDashboard }> {
  const mounted = await mountDashboard({ locale, fail });
  const dialog = await s.open(locale, mounted);
  if (s.startsBlocked) s.unblock(dialog, locale);
  await waitFor(() => { expect(submitOf(dialog, locale).getAttribute('aria-disabled')).not.toBe('true'); });
  return { dialog, mounted };
}

const posts = (mounted: MountedDashboard, endpoint: RegExp): number => mounted.server.calls.filter((c) => c.method === 'POST' && endpoint.test(c.url)).length;

// The first mount of a worker pays the cold import of the dashboard; allow for it under a loaded full run.
describe.each(['en', 'nl'] as const)('create footer focus (%s)', { timeout: 20000 }, (locale) => {
  describe.each(scenarios)('$name', (s) => {
    it('keeps focus on the aria-disabled Create button while the request is pending and ignores a second activation', async () => {
      const { dialog, mounted } = await ready(s, locale);
      const held = holdPosts(s.endpoint);
      const submit = submitOf(dialog, locale);
      act(() => { submit.focus(); });
      fireEvent.click(submit);
      await waitFor(() => { expect(submit.textContent).toBe(m(locale).creating); });
      expect(held.started()).toBe(1);
      expect(submit.getAttribute('aria-disabled')).toBe('true');
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      expect(document.activeElement).toBe(submit);
      enterInField(dialog, locale);
      fireEvent.click(submit);
      expect(held.started()).toBe(1);
      expect(document.activeElement).toBe(submit);
      held.release();
      await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
      expect(posts(mounted, s.endpoint)).toBe(1);
    });

    it('keeps focus on the Create button after a failed create, announces the error, and allows a retry', async () => {
      const { dialog, mounted } = await ready(s, locale, ['create']);
      const submit = submitOf(dialog, locale);
      act(() => { submit.focus(); });
      fireEvent.click(submit);
      const alert = await within(dialog).findByRole('alert');
      expect(alert.textContent).not.toBe('');
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(submit);
      expect(submit.textContent).toBe(m(locale).submit);
      expect(submit.getAttribute('aria-disabled')).not.toBe('true');
      expect(screen.queryByRole('dialog')).not.toBeNull();
      fireEvent.click(submit);
      await waitFor(() => { expect(posts(mounted, s.endpoint)).toBe(2); });
      expect(document.activeElement).toBe(submit);
    });

    it('keeps focus when the failed create was sent from a form field, and never leaves it on the body', async () => {
      const { dialog } = await ready(s, locale, ['create']);
      const field = within(dialog).getByLabelText(m(locale)[s.endpoint.source.includes('actual') ? 'actual' : 'wallos'].name);
      act(() => { field.focus(); });
      enterInField(dialog, locale);
      await within(dialog).findByRole('alert');
      expect(document.activeElement).toBe(field);
    });

    it('blocks a Create that is off for a reason, with the reason still describing the aria-disabled button', async () => {
      const { dialog, mounted } = await ready(s, locale);
      s.block(dialog, locale);
      const submit = submitOf(dialog, locale);
      await waitFor(() => { expect(submit.getAttribute('aria-disabled')).toBe('true'); });
      expect((submit as HTMLButtonElement).disabled).toBe(false);
      const reasonId = submit.getAttribute('aria-describedby');
      expect(reasonId).not.toBeNull();
      expect(document.getElementById(reasonId as string)?.textContent).toBe(s.reason(locale));
      act(() => { submit.focus(); });
      expect(document.activeElement).toBe(submit);
      enterInField(dialog, locale);
      fireEvent.click(submit);
      expect(posts(mounted, s.endpoint)).toBe(0);
      expect(document.activeElement).toBe(submit);
      s.unblock(dialog, locale);
      await waitFor(() => { expect(submit.getAttribute('aria-disabled')).not.toBe('true'); });
      expect(submit.getAttribute('aria-describedby')).toBeNull();
    });
  });
});

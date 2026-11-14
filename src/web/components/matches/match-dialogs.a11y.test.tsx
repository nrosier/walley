// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n';
import { statusBadgeMessages } from '@/components/StatusBadge.messages';
import {
  cleanupDashboard,
  expectDialogAccessibility,
  expectFocusTrapped,
  focusIs,
  mountDashboard,
  nameOf,
  openRowMenuItem,
  pressKey,
  tabbables,
  waitForFocus,
  type FailableEndpoint,
  type MountedDashboard,
} from '../../a11y.helpers';
import { diffModalMessages } from './DiffModal.messages';
import { relinkDialogMessages } from './RelinkDialog.messages';
import { unlinkDialogMessages } from './UnlinkDialog.messages';

// Real-DOM accessibility tests of the match dialogs (issue 58): the Diff modal, its Overwrite and Unlink
// confirmations, the row-menu Unlink confirmation and the Relink dialog, mounted through the Sync Dashboard.
// jsdom cannot prove real Tab order or the focus ring: tab order is read from the DOM (`tabbables`) and Tab is
// emulated by `pressTab` inside `expectFocusTrapped`. Enter on a plain button is done as an explicit click.

afterEach(cleanupDashboard);

const messages = { en: diffModalMessages.en, nl: diffModalMessages.nl } as const;
const sentence = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v), template);

const reviewButton = (locale: Locale): HTMLElement =>
  screen.getByRole('button', { name: locale === 'en' ? 'Review differences: Adobe' : 'Verschillen bekijken: Adobe' });
const moreActions = (name: string): HTMLElement | null => document.querySelector(`[data-linked-match] [aria-haspopup="menu"][aria-label$=" ${name}"]`);
const diffDialog = (): HTMLElement => document.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
const names = (root: HTMLElement): string[] => tabbables(root).map(nameOf);
const resolveCalls = (m: MountedDashboard) => m.server.calls.filter((c) => c.url.endsWith('/resolve'));
const escape = (): void => { pressKey(document.activeElement ?? document.body, 'Escape'); };
const click = (el: Element): void => { fireEvent.click(el); };

async function openDiff(locale: Locale = 'en', fail: readonly FailableEndpoint[] = []): Promise<{ mounted: MountedDashboard; dialog: HTMLElement }> {
  const mounted = await mountDashboard({ locale, fail });
  const review = reviewButton(locale);
  review.focus();
  click(review);
  return { mounted, dialog: await screen.findByRole('dialog') };
}

/** Makes /resolve wait until `release()`; everything else goes to the fake server. */
function holdResolve(): { release: () => void } {
  const base = globalThis.fetch;
  let release = (): void => undefined;
  const gate = new Promise<void>((r) => { release = r; });
  globalThis.fetch = vi.fn(async (input: string, init?: RequestInit) => {
    if (input.endsWith('/resolve')) await gate;
    return base(input, init);
  }) as unknown as typeof fetch;
  return { release };
}

const openConfirmation = async (dialog: HTMLElement, label: string): Promise<HTMLElement> => {
  const trigger = Array.from(dialog.querySelectorAll('button')).find((b) => nameOf(b) === label) as HTMLElement;
  trigger.focus();
  click(trigger);
  return screen.findByRole('alertdialog');
};

describe.each(['en', 'nl'] as const)('Diff modal (%s)', (locale) => {
  const m = messages[locale];

  it('is a named, described dialog that lists the drifted fields', async () => {
    const { dialog } = await openDiff(locale);
    expectDialogAccessibility(dialog, {
      name: m.title,
      description: sentence(m.description, { wallos: 'Adobe', actual: 'Adobe CC' }),
    });
    const table = screen.getByRole('table', { name: m.table });
    expect(Array.from(table.querySelectorAll('[data-diff-row]')).map((r) => r.getAttribute('data-diff-row'))).toEqual(['amount']);
    const row = table.querySelector('[data-diff-row="amount"]') as HTMLElement;
    expect(row.querySelector('th')?.textContent).toBe(m.fields.amount);
    const cells = Array.from(row.querySelectorAll('td')).map((c) => c.textContent);
    expect(cells[0]).toMatch(/10[.,]00/);
    expect(cells[1]).toMatch(/12[.,]00/);
    expect(screen.getByRole('list', { name: m.options })).toBeTruthy();
  });

  it('puts initial focus on Ignore Diff, with a fixed tab order, and traps focus', async () => {
    const { dialog } = await openDiff(locale);
    await waitForFocus(() => screen.getByRole('button', { name: m.ignoreDiff }));
    expect(names(dialog)).toEqual([m.ignoreDiff, m.overwriteWallos, m.overwriteActual, m.unlink, locale === 'en' ? 'Close' : 'Sluiten']);
    expect(document.activeElement).toBe(tabbables(dialog)[0]);
    expectFocusTrapped(dialog);
  });

  it('Escape returns focus to the Review button', async () => {
    const { dialog } = await openDiff(locale);
    await waitForFocus(() => screen.getByRole('button', { name: m.ignoreDiff }));
    escape();
    await waitFor(() => { expect(dialog.isConnected).toBe(false); });
    await waitForFocus(() => document.querySelector('[data-review-for="m-ad"]'));
  });

  it('Ignore Diff returns focus to the pair details button, because the Review button is gone', async () => {
    const { mounted, dialog } = await openDiff(locale);
    const { server } = mounted;
    server.result = {
      ...server.result,
      mismatches: [],
      linked: server.result.linked.map((l) => (l.matchId === 'm-ad' ? { ...l, status: 'LINKED' as const } : l)),
    };
    const ignore = screen.getByRole('button', { name: m.ignoreDiff });
    ignore.focus();
    click(ignore);
    await waitFor(() => { expect(dialog.isConnected).toBe(false); });
    expect(resolveCalls(mounted).map((c) => c.body)).toEqual([{ action: 'ignore_diff' }]);
    const details = (): Element | null => document.querySelector('[data-linked-match="m-ad"] [data-details-for]');
    await waitForFocus(details);
    expect(nameOf(details() as Element)).toBe(locale === 'en' ? 'Show details for Adobe' : 'Details tonen voor Adobe');
  });
});

describe('Diff modal states', () => {
  it('while a resolve is in flight: buttons are aria-disabled and keep focus, a status shows, and Escape does not dismiss', async () => {
    const { mounted, dialog } = await openDiff();
    const hold = holdResolve();
    const ignore = screen.getByRole('button', { name: 'Ignore Diff' });
    ignore.focus();
    click(ignore);
    await screen.findByText(diffModalMessages.en.working);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    expect(within(dialog).getByRole('status').textContent).toContain('Working...');
    for (const label of ['Ignore Diff', 'Overwrite Wallos', 'Overwrite Actual', 'Unlink']) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-disabled'), label).toBe('true');
    }
    // aria-disabled buttons stay tabbable (that is what keeps focus on the activated one) and do nothing.
    expect(document.activeElement).toBe(ignore);
    escape();
    fireEvent.click(dialog.querySelector('[data-slot="dialog-close"]') as Element);
    expect(dialog.isConnected).toBe(true);
    expect(screen.getByRole('dialog')).toBe(dialog);
    hold.release();
    await waitFor(() => { expect(dialog.isConnected).toBe(false); });
    expect(resolveCalls(mounted)).toHaveLength(1);
  });

  it('shows a failed resolve in an alert, keeps the modal open and enables the buttons again', async () => {
    const { dialog } = await openDiff('en', ['resolve']);
    const ignore = screen.getByRole('button', { name: 'Ignore Diff' });
    ignore.focus();
    click(ignore);
    const alert = await screen.findByRole('alert');
    expect(dialog.contains(alert)).toBe(true);
    expect(alert.textContent).toContain('Could not update Adobe.');
    expect(alert.textContent).toMatch(/request failed/i);
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Ignore Diff' }).getAttribute('aria-disabled')).toBe('false'); });
    expect(document.activeElement).toBe(ignore);
    expect(dialog.getAttribute('aria-busy')).toBe('false');
    expect(dialog.isConnected).toBe(true);
    expectDialogAccessibility(dialog, { name: 'Review differences', description: /Adobe \(Wallos\)/ });
  });
});

describe.each([
  ['Overwrite Wallos', 'overwrite_wallos', 'en'],
  ['Overwrite Actual', 'overwrite_actual', 'en'],
  ['Wallos overschrijven', 'overwrite_wallos', 'nl'],
  ['Actual overschrijven', 'overwrite_actual', 'nl'],
] as const)('overwrite confirmation "%s"', (label, action, locale) => {
  const m = messages[locale];
  const title = action === 'overwrite_wallos' ? m.overwriteWallosConfirmTitle : m.overwriteActualConfirmTitle;

  it('is an alertdialog with Cancel focused first, a trap, and the diff modal hidden behind it', async () => {
    const { dialog } = await openDiff(locale);
    const alert = await openConfirmation(dialog, label);
    expectDialogAccessibility(alert, { name: title, description: m.overwriteConfirmBody });
    expect(names(alert)).toEqual([m.cancel, m.confirm]);
    await waitForFocus(() => screen.getByRole('button', { name: m.cancel }));
    expectFocusTrapped(alert);
    // The outer diff dialog is out of the accessibility tree and has no tab stops while the confirmation is open.
    expect(dialog.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(tabbables(dialog)).toEqual([]);
    expect(alert.contains(document.activeElement)).toBe(true);
  });

  it('Escape closes only the confirmation, focus returns to its trigger, and the diff modal is trapped again', async () => {
    const { mounted, dialog } = await openDiff(locale);
    const alert = await openConfirmation(dialog, label);
    await waitForFocus(() => screen.getByRole('button', { name: m.cancel }));
    escape();
    await waitFor(() => { expect(alert.isConnected).toBe(false); });
    expect(dialog.isConnected).toBe(true);
    const trigger = (): Element | undefined => Array.from(dialog.querySelectorAll('button')).find((b) => nameOf(b) === label);
    await waitForFocus(() => trigger() ?? null);
    await waitFor(() => { expect(dialog.closest('[aria-hidden="true"]')).toBeNull(); });
    expectFocusTrapped(dialog);
    expect(resolveCalls(mounted)).toHaveLength(0);
  });

  it('Cancel does the same and sends nothing', async () => {
    const { mounted, dialog } = await openDiff(locale);
    const alert = await openConfirmation(dialog, label);
    click(screen.getByRole('button', { name: m.cancel }));
    await waitFor(() => { expect(alert.isConnected).toBe(false); });
    expect(dialog.isConnected).toBe(true);
    await waitForFocus(() => Array.from(dialog.querySelectorAll('button')).find((b) => nameOf(b) === label) ?? null);
    expect(resolveCalls(mounted)).toHaveLength(0);
  });

  it('Confirm sends one resolve with confirm: true', async () => {
    const { mounted, dialog } = await openDiff(locale);
    await openConfirmation(dialog, label);
    click(screen.getByRole('button', { name: m.confirm }));
    await waitFor(() => { expect(resolveCalls(mounted)).toHaveLength(1); });
    expect(resolveCalls(mounted)[0]).toMatchObject({ method: 'POST', url: '/api/matches/m-ad/resolve', body: { action, confirm: true } });
  });
});

describe.each(['en', 'nl'] as const)('Unlink confirmation inside the diff modal (%s)', (locale) => {
  const m = messages[locale];

  it('is an alertdialog, Cancel first; Escape returns to the Unlink button of the diff modal', async () => {
    const { dialog } = await openDiff(locale);
    const alert = await openConfirmation(dialog, m.unlink);
    expectDialogAccessibility(alert, { name: m.unlinkConfirmTitle, description: m.unlinkConfirmBody });
    expect(names(alert)).toEqual([m.cancel, m.confirm]);
    await waitForFocus(() => screen.getByRole('button', { name: m.cancel }));
    expectFocusTrapped(alert);
    expect(dialog.closest('[aria-hidden="true"]')).not.toBeNull();
    escape();
    await waitFor(() => { expect(alert.isConnected).toBe(false); });
    expect(dialog.isConnected).toBe(true);
    const unlink = (): Element | null => Array.from(dialog.querySelectorAll('button')).find((b) => nameOf(b) === m.unlink) ?? null;
    await waitForFocus(unlink);
    expect(focusIs(unlink())).toBe(true);
  });

  it('Confirm sends one unlink with confirm: true', async () => {
    const { mounted, dialog } = await openDiff(locale);
    await openConfirmation(dialog, m.unlink);
    click(screen.getByRole('button', { name: m.confirm }));
    await waitFor(() => { expect(resolveCalls(mounted)).toHaveLength(1); });
    expect(resolveCalls(mounted)[0]?.body).toEqual({ action: 'unlink', confirm: true });
  });

  it('after a successful Unlink focus is not on the body: it lands on a row of the Wallos side', async () => {
    const { dialog } = await openDiff(locale);
    await openConfirmation(dialog, m.unlink);
    click(screen.getByRole('button', { name: m.confirm }));
    await waitFor(() => { expect(document.querySelector('[role="dialog"]')).toBeNull(); });
    await waitForFocus(() => document.activeElement === document.body ? null : document.activeElement);
    expect(document.activeElement).not.toBe(document.body);
    const active = document.activeElement as HTMLElement;
    expect(active.closest('[data-side="wallos"][data-row-id]') ?? active.matches('input[type="search"]')).toBeTruthy();
  });
});

describe.each(['en', 'nl'] as const)('Unlink confirmation from the row menu (%s)', (locale) => {
  const m = messages[locale];
  const u = unlinkDialogMessages[locale];
  const moreFor = (): HTMLElement | null => moreActions('Spotify');

  async function open(): Promise<{ mounted: MountedDashboard; alert: HTMLElement }> {
    const mounted = await mountDashboard({ locale });
    await openRowMenuItem('Spotify', m.unlink);
    return { mounted, alert: await screen.findByRole('alertdialog') };
  }

  it('names both items, starts on Cancel and traps focus', async () => {
    const { alert } = await open();
    expectDialogAccessibility(alert, { name: m.unlinkConfirmTitle, description: sentence(u.description, { wallos: 'Spotify', actual: 'Spotify EU' }) });
    expect(names(alert)).toEqual([m.cancel, m.confirm]);
    await waitForFocus(() => screen.getByRole('button', { name: m.cancel }));
    expectFocusTrapped(alert);
  });

  it('Escape and Cancel return focus to the "More actions" button of the row', async () => {
    const { mounted, alert } = await open();
    await waitForFocus(() => screen.getByRole('button', { name: m.cancel }));
    escape();
    await waitFor(() => { expect(alert.isConnected).toBe(false); });
    await waitForFocus(moreFor);
    expect(moreFor()?.getAttribute('aria-label')).toMatch(locale === 'en' ? /^More actions for Spotify$/ : /^Meer acties voor Spotify$/);

    await openRowMenuItem('Spotify', m.unlink);
    const second = await screen.findByRole('alertdialog');
    click(screen.getByRole('button', { name: m.cancel }));
    await waitFor(() => { expect(second.isConnected).toBe(false); });
    await waitForFocus(moreFor);
    expect(resolveCalls(mounted)).toHaveLength(0);
  });

  it('Confirm sends one request and moves focus to the search box', async () => {
    const { mounted, alert } = await open();
    click(screen.getByRole('button', { name: m.confirm }));
    await waitFor(() => { expect(alert.isConnected).toBe(false); });
    await waitForFocus(() => document.querySelector('input[type="search"]'));
    await waitFor(() => { expect(resolveCalls(mounted)).toHaveLength(1); });
    expect(resolveCalls(mounted)[0]).toMatchObject({ method: 'POST', url: '/api/matches/m-sp/resolve', body: { action: 'unlink', confirm: true } });
    expect(mounted.server.calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);
  });
});

describe.each(['en', 'nl'] as const)('Relink dialog (%s)', (locale) => {
  const r = relinkDialogMessages[locale];
  const itemLabel = locale === 'en' ? 'Link to another item' : 'Koppelen aan een ander item';
  const moreFor = (): HTMLElement | null => moreActions('Orphan');

  async function open(fail: readonly FailableEndpoint[] = []): Promise<{ mounted: MountedDashboard; dialog: HTMLElement }> {
    const mounted = await mountDashboard({ locale, fail });
    await openRowMenuItem('Orphan', itemLabel);
    return { mounted, dialog: await screen.findByRole('dialog') };
  }

  it('is a named, described dialog with a labelled option group, the suggestion first and focused', async () => {
    const { dialog } = await open();
    expectDialogAccessibility(dialog, {
      name: r.title,
      description: sentence(r.description, { name: 'Orphan', side: r.sides.actual }).replace(/\{side\}/g, r.sides.actual),
    });
    const group = screen.getByRole('radiogroup', { name: r.options });
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map(nameOf)).toEqual([expect.stringMatching(new RegExp(`^${locale === 'en' ? 'Suggested' : 'Voorgesteld'}: Gym \\(`)), expect.stringMatching(/^NETFLIX\.COM \(/)]);
    expect(radios.map((x) => x.checked)).toEqual([true, false]);
    await waitForFocus(radios[0] as HTMLElement);
    expect(names(dialog).slice(1)).toEqual([r.cancel, r.submit, locale === 'en' ? 'Close' : 'Sluiten']);
    expectFocusTrapped(dialog);
  });

  it('a failed submit shows the error in an alert and keeps the dialog open', async () => {
    const { mounted, dialog } = await open(['relink']);
    click(screen.getByRole('button', { name: r.submit }));
    const alert = await screen.findByRole('alert');
    expect(dialog.contains(alert)).toBe(true);
    expect(alert.textContent).toContain('request_failed');
    expect(dialog.isConnected).toBe(true);
    expect(mounted.server.calls.filter((c) => c.url.endsWith('/relink'))).toHaveLength(1);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: r.submit }).disabled).toBe(false);
  });

  it('Escape and Cancel return focus to the "More actions" button of the row', async () => {
    const { dialog } = await open();
    escape();
    await waitFor(() => { expect(dialog.isConnected).toBe(false); });
    await waitForFocus(moreFor);

    await openRowMenuItem('Orphan', itemLabel);
    const second = await screen.findByRole('dialog');
    click(screen.getByRole('button', { name: r.cancel }));
    await waitFor(() => { expect(second.isConnected).toBe(false); });
    await waitForFocus(moreFor);
    expect(diffDialog()).toBeNull();
  });
});

describe.each(['en', 'nl'] as const)('status badges on the dashboard (%s)', (locale) => {
  it('render Synced, Mismatch and Orphaned as text, not colour alone', async () => {
    await mountDashboard({ locale });
    const text = statusBadgeMessages[locale];
    for (const kind of ['synced', 'mismatch', 'orphaned'] as const) {
      const badges = Array.from(document.querySelectorAll(`[data-kind="${kind}"]`));
      expect(badges.length, kind).toBeGreaterThan(0);
      for (const b of badges) {
        expect(b.textContent.trim(), kind).toBe(text[kind]);
        expect(b.getAttribute('aria-hidden')).toBeNull();
      }
    }
  });
});

// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Locale } from '@/i18n';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import {
  cleanupDashboard,
  dashboardFixture,
  expectDialogAccessibility,
  expectFocusTrapped,
  mountDashboard,
  nameOf,
  openRowMenuItem,
  pressKey,
  syncItem,
  tabbables,
  waitForFocus,
} from '../../a11y.helpers';
import { createModalMessages } from './CreateModal.messages';
import { syncItemDetailsMessages } from './SyncItemDetailsDialog.messages';

// Real-DOM accessibility tests of the dashboard dialogs that are not the diff, confirmation or relink dialogs
// (issue 58): item details, Create in Actual Budget / Wallos, Recreate (both directions) and the announcements
// of Recreate and relink. jsdom limits: focus return is asserted with waitForFocus, Enter on a plain button
// needs an explicit click, and there is no real Tab order.

afterEach(cleanupDashboard);

const fill = (text: string, vars: Record<string, string>): string => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), text);
const dash = (locale: Locale) => syncDashboardMessages[locale];
const create = (locale: Locale) => createModalMessages[locale];

/** Presses Enter on a plain button the way a keyboard user would: focus, keydown/keyup, then the click a browser fires. */
function activate(button: HTMLElement): void {
  act(() => { button.focus(); });
  pressKey(button, 'Enter');
  fireEvent.click(button);
}

/** Holds back the fake server's answers to the URLs matching `pattern` until `release()` is called. */
function gate(pattern: RegExp): { release: () => void } {
  const real = globalThis.fetch;
  let release = (): void => undefined;
  const open = new Promise<void>((resolve) => { release = resolve; });
  globalThis.fetch = ((input: string, init?: RequestInit) =>
    pattern.test(input) ? open.then(() => real(input, init)) : real(input, init)) as typeof fetch;
  return { release };
}

const searchBox = (): Element | null => document.querySelector('input[type="search"]');

/** Waits until the fake server has received `count` requests with this method whose URL matches `pattern`. */
async function waitForCalls(mounted: { server: { calls: { method: string; url: string }[] } }, method: string, pattern: RegExp, count: number): Promise<void> {
  await waitFor(() => { expect(mounted.server.calls.filter((c) => c.method === method && pattern.test(c.url))).toHaveLength(count); });
}

/** The account label also holds its inline hint, so match on the leading word. */
const accountLabel = (name: string): RegExp => new RegExp(`^${name}`);

const region = (): HTMLElement => document.querySelector('[data-slot="announcement-region"]') as HTMLElement;
const regionText = (): string => region().textContent.trim();
const moreActions = (name: string, locale: Locale = 'en'): HTMLElement =>
  screen.getByRole('button', { name: `${locale === 'en' ? 'More actions for' : 'Meer acties voor'} ${name}` });
const createButton = (name: string, locale: Locale = 'en'): HTMLElement =>
  screen.getByRole('button', { name: fill(dash(locale).row.createInActualNamed, { name }) });
const createWallosButton = (name: string, locale: Locale = 'en'): HTMLElement =>
  screen.getByRole('button', { name: fill(dash(locale).row.createInWallosNamed, { name }) });

/** Asserts the shared create frame: names, labelled fields, reason wiring, trap. Returns the dialog. */
async function expectCreateFrame(opts: { locale: Locale; kind: 'actual' | 'wallos'; source: string; fieldLabels: (string | RegExp)[] }): Promise<HTMLElement> {
  const m = create(opts.locale)[opts.kind];
  const dialog = await screen.findByRole('dialog');
  expectDialogAccessibility(dialog, { name: m.title, description: fill(m.description, { name: opts.source }) });
  for (const label of opts.fieldLabels) expect(within(dialog).getByLabelText(label), `field ${String(label)}`).toBeTruthy();
  for (const field of Array.from(dialog.querySelectorAll<HTMLElement>('input,select'))) {
    expect(nameOf(field), `field ${field.id} has a name`).not.toBe('');
  }
  return dialog;
}

describe('Item details dialog', () => {
  it('is named after the item, described by its side, and lists every field as a dt/dd pair', async () => {
    await mountDashboard();
    const opener = screen.getByRole('button', { name: 'Show details for Spotify' });
    activate(opener);
    const dialog = await screen.findByRole('dialog');
    const m = syncItemDetailsMessages.en;
    expectDialogAccessibility(dialog, { name: 'Spotify', description: m.wallosHeading });
    await waitFor(() => { expect(dialog.querySelector('dl')).not.toBeNull(); });
    const terms = Array.from(dialog.querySelectorAll('dt')).map((e) => e.textContent);
    const defs = Array.from(dialog.querySelectorAll('dd')).map((e) => e.textContent);
    expect(terms).toEqual(Object.values(m.wallos));
    expect(defs).toHaveLength(terms.length);
    for (const dd of defs) expect(dd.trim()).not.toBe('');
    expect(defs[terms.indexOf(m.wallos.paymentMethod)]).toBe('Visa');
    expect(defs[terms.indexOf(m.wallos.notes)]).toBe(m.notSet);
    expect(defs[terms.indexOf(m.wallos.autoRenew)]).toBe(m.yes);
    // each dt is directly followed by its dd, inside the one description list
    for (const dt of Array.from(dialog.querySelectorAll('dt'))) expect(dt.nextElementSibling?.tagName).toBe('DD');
  });

  it('shows the Actual Budget side with its own headings', async () => {
    await mountDashboard();
    activate(screen.getByRole('button', { name: 'Show details for Spotify EU' }));
    const dialog = await screen.findByRole('dialog');
    const m = syncItemDetailsMessages.en;
    expectDialogAccessibility(dialog, { name: 'Spotify EU', description: m.actualHeading });
    await waitFor(() => { expect(dialog.querySelector('dl')).not.toBeNull(); });
    expect(Array.from(dialog.querySelectorAll('dt')).map((e) => e.textContent)).toEqual(Object.values(m.actual));
  });

  it('shows a loading state with the row name as title, then swaps in the details', async () => {
    await mountDashboard();
    const held = gate(/\/api\/sync\/items\//);
    activate(screen.getByRole('button', { name: 'Show details for Spotify' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(syncItemDetailsMessages.en.loading)).toBeTruthy();
    expect(dialog.querySelector('dl')).toBeNull();
    expectDialogAccessibility(dialog, { name: 'Spotify', description: syncItemDetailsMessages.en.wallosHeading });
    held.release();
    await waitFor(() => { expect(dialog.querySelector('dl')).not.toBeNull(); });
    expect(within(dialog).queryByText(syncItemDetailsMessages.en.loading)).toBeNull();
  });

  it('announces a load failure in a role=alert and keeps the dialog usable', async () => {
    await mountDashboard({ fail: ['details'] });
    activate(screen.getByRole('button', { name: 'Show details for Spotify' }));
    const dialog = await screen.findByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(syncItemDetailsMessages.en.loadFailed);
    expect(dialog.querySelector('dl')).toBeNull();
    expectDialogAccessibility(dialog, { name: 'Spotify', description: syncItemDetailsMessages.en.wallosHeading });
    expectFocusTrapped(dialog);
  });

  it('traps focus, and Escape and Close return focus to the name button', async () => {
    await mountDashboard();
    const opener = screen.getByRole('button', { name: 'Show details for Spotify' });
    activate(opener);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => { expect(dialog.querySelector('dl')).not.toBeNull(); });
    expectFocusTrapped(dialog);
    pressKey(dialog, 'Escape');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => document.querySelector('[data-details-for="w-sp"]'));

    activate(screen.getByRole('button', { name: 'Show details for Spotify' }));
    const again = await screen.findByRole('dialog');
    fireEvent.click(again.querySelector('[data-slot="dialog-close"]') as HTMLElement);
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => document.querySelector('[data-details-for="w-sp"]'));
  });

  it('is named and labelled in Dutch', async () => {
    await mountDashboard({ locale: 'nl' });
    const m = syncItemDetailsMessages.nl;
    activate(screen.getByRole('button', { name: fill(m.openDetails, { name: 'Spotify' }) }));
    const dialog = await screen.findByRole('dialog');
    expectDialogAccessibility(dialog, { name: 'Spotify', description: m.wallosHeading });
    await waitFor(() => { expect(dialog.querySelector('dl')).not.toBeNull(); });
    expect(Array.from(dialog.querySelectorAll('dt')).map((e) => e.textContent)).toEqual(Object.values(m.wallos));
    expect(nameOf(dialog.querySelector('[data-slot="dialog-close"]') as HTMLElement)).toBe('Sluiten');
  });
});

describe.each(['en', 'nl'] as const)('Create in Actual Budget (%s)', (locale) => {
  const m = create(locale).actual;
  const labels = [m.name, new RegExp(`^${m.amount.replace(/[()]/g, '\\$&')}`), m.startDate, accountLabel(m.account), m.category];

  it('focuses Cancel while the pre-fill loads and the first field after, with every field labelled', async () => {
    await mountDashboard({ locale });
    const held = gate(/prefill/);
    activate(createButton('Hulu', locale));
    const loading = await screen.findByRole('dialog');
    await within(loading).findByText(create(locale).loading);
    await waitForFocus(within(loading).getByRole('button', { name: create(locale).cancel }));
    held.release();
    const dialog = await expectCreateFrame({ locale, kind: 'actual', source: 'Hulu', fieldLabels: labels });
    await waitForFocus(within(dialog).getByLabelText(m.name));
    expect(within(dialog).getByLabelText<HTMLInputElement>(m.name).value).toBe('Hulu');
    // the payee choice is a labelled button, and the frequency a dt/dd pair
    expect(within(dialog).getByRole('button', { name: new RegExp(m.payee) })).toBeTruthy();
    expect(within(dialog).getByText(m.frequency).tagName).toBe('DT');
  });

  it('describes the disabled Create button by the reason, and the reason clears once an account is chosen', async () => {
    await mountDashboard({ locale });
    activate(createButton('Hulu', locale));
    const dialog = await expectCreateFrame({ locale, kind: 'actual', source: 'Hulu', fieldLabels: labels });
    await within(dialog).findByLabelText(m.name);
    const submit = within(dialog).getByRole('button', { name: create(locale).submit });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    const reasonId = submit.getAttribute('aria-describedby');
    expect(reasonId).not.toBeNull();
    expect(document.getElementById(reasonId as string)?.textContent).toBe(fill(m.createDisabled, { reason: m.accountRequired }));
    fireEvent.change(within(dialog).getByLabelText(accountLabel(m.account)), { target: { value: 'acc1' } });
    await waitFor(() => { expect((submit as HTMLButtonElement).disabled).toBe(false); });
    expect(submit.getAttribute('aria-describedby')).toBeNull();
  });

  it('traps focus, and Escape and Cancel return focus to the row Create button', async () => {
    await mountDashboard({ locale });
    activate(createButton('Hulu', locale));
    const dialog = await expectCreateFrame({ locale, kind: 'actual', source: 'Hulu', fieldLabels: labels });
    await within(dialog).findByLabelText(m.name);
    expectFocusTrapped(dialog);
    pressKey(dialog, 'Escape');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => createButton('Hulu', locale));

    activate(createButton('Hulu', locale));
    const again = await screen.findByRole('dialog');
    await within(again).findByLabelText(m.name);
    activate(within(again).getByRole('button', { name: create(locale).cancel }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => createButton('Hulu', locale));
  });

  async function createHulu(name = 'Hulu') {
    const mounted = await mountDashboard({ locale });
    activate(createButton(name, locale));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(accountLabel(m.account)), { target: { value: 'acc1' } });
    const submit = within(dialog).getByRole('button', { name: create(locale).submit });
    await waitFor(() => { expect((submit as HTMLButtonElement).disabled).toBe(false); });
    fireEvent.click(submit);
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(mounted.server.calls.some((c) => c.url === '/api/integrations/actual-schedules' && c.method === 'POST')).toBe(true);
  }

  it('after a successful create the outcome is announced', async () => {
    await createHulu();
    await waitFor(() => { expect(regionText()).toBe(fill(dash(locale).announce.createdInActual, { name: 'Hulu' })); }, { timeout: 2500 });
  });

  it('after a successful create focus goes to the next row primary action', async () => {
    await createHulu();
    await waitForFocus(() => createButton('Disney', locale), 800);
  });

  // Same fallback as Link, Ignore and Restore (nextRowId): the last row hands focus to the previous row.
  it('after a successful create of the last row focus goes to the previous row primary action', async () => {
    await createHulu('Disney');
    await waitForFocus(() => createButton('Hulu', locale), 800);
  });

});

describe.each(['en', 'nl'] as const)('Create in Wallos (%s)', (locale) => {
  const m = create(locale).wallos;
  const labels = [m.name, new RegExp(`^${m.price}`), m.startDate, m.paymentMethod, m.category];

  it('focuses Cancel while the pre-fill loads and the first field after, with every field labelled', async () => {
    await mountDashboard({ locale });
    const held = gate(/prefill/);
    activate(createWallosButton('Gym', locale));
    const loading = await screen.findByRole('dialog');
    await within(loading).findByText(create(locale).loading);
    await waitForFocus(within(loading).getByRole('button', { name: create(locale).cancel }));
    held.release();
    const dialog = await expectCreateFrame({ locale, kind: 'wallos', source: 'Gym', fieldLabels: labels });
    await waitForFocus(within(dialog).getByLabelText(m.name));
    expect(within(dialog).getByRole('radiogroup', { name: m.cycle })).toBeTruthy();
  });

  it('describes the disabled Create button by the reason once the title is emptied', async () => {
    await mountDashboard({ locale });
    activate(createWallosButton('Gym', locale));
    const dialog = await expectCreateFrame({ locale, kind: 'wallos', source: 'Gym', fieldLabels: labels });
    const title = await within(dialog).findByLabelText(m.name);
    const submit = within(dialog).getByRole('button', { name: create(locale).submit });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(title, { target: { value: '' } });
    await waitFor(() => { expect((submit as HTMLButtonElement).disabled).toBe(true); });
    const reasonId = submit.getAttribute('aria-describedby');
    expect(reasonId).not.toBeNull();
    expect(document.getElementById(reasonId as string)?.textContent).toBe(fill(m.createDisabled, { reason: m.titleInvalid }));
    expect(title.getAttribute('aria-describedby')).toBe(reasonId);
  });

  it('traps focus, and Escape and Cancel return focus to the row Create button', async () => {
    await mountDashboard({ locale });
    activate(createWallosButton('Gym', locale));
    const dialog = await expectCreateFrame({ locale, kind: 'wallos', source: 'Gym', fieldLabels: labels });
    await within(dialog).findByLabelText(m.name);
    expectFocusTrapped(dialog);
    pressKey(dialog, 'Escape');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => createWallosButton('Gym', locale));

    activate(createWallosButton('Gym', locale));
    const again = await screen.findByRole('dialog');
    await within(again).findByLabelText(m.name);
    activate(within(again).getByRole('button', { name: create(locale).cancel }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => createWallosButton('Gym', locale));
  });

  async function createGym(name = 'Gym') {
    const base = dashboardFixture();
    const result = { ...base, unlinkedActual: [...base.unlinkedActual, syncItem('a-rent', 'Rent', 90000)] };
    const mounted = await mountDashboard({ locale, result });
    activate(createWallosButton(name, locale));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(m.name);
    fireEvent.click(within(dialog).getByRole('button', { name: create(locale).submit }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(mounted.server.calls.some((c) => c.url === '/api/integrations/wallos-subscriptions' && c.method === 'POST')).toBe(true);
  }

  it('after a successful create the outcome is announced', async () => {
    await createGym();
    await waitFor(() => { expect(regionText()).toBe(fill(dash(locale).announce.createdInWallos, { name: 'Gym' })); }, { timeout: 2500 });
  });

  it('after a successful create focus goes to the next row primary action', async () => {
    await createGym();
    await waitForFocus(() => createWallosButton('Rent', locale), 800);
  });

  // Same fallback as Link, Ignore and Restore (nextRowId): the last row hands focus to the previous row.
  it('after a successful create of the last row focus goes to the previous row primary action', async () => {
    await createGym('Rent');
    await waitForFocus(() => createWallosButton('Gym', locale), 800);
  });

});

describe('Recreate in Actual Budget (orphaned_actual row)', () => {
  const m = create('en').actual;
  const labels = [m.name, /^Amount/, m.startDate, accountLabel(m.account), m.category];
  const menuLabel = dash('en').orphan.recreateActual;

  it('opens from the More actions menu by keyboard with the shared frame and sends the matchId', async () => {
    const mounted = await mountDashboard();
    await openRowMenuItem('Orphan', menuLabel);
    const dialog = await expectCreateFrame({ locale: 'en', kind: 'actual', source: 'Orphan', fieldLabels: labels });
    await waitForFocus(await within(dialog).findByLabelText(m.name));
    const submit = within(dialog).getByRole('button', { name: create('en').submit });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(document.getElementById(submit.getAttribute('aria-describedby') as string)?.textContent).toBe(fill(m.createDisabled, { reason: m.accountRequired }));
    expectFocusTrapped(dialog);
    fireEvent.change(within(dialog).getByLabelText(accountLabel(m.account)), { target: { value: 'acc1' } });
    await waitFor(() => { expect((submit as HTMLButtonElement).disabled).toBe(false); });
    fireEvent.click(submit);
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    const post = mounted.server.calls.find((c) => c.url === '/api/integrations/actual-schedules' && c.method === 'POST');
    expect(post?.body).toMatchObject({ wallosSubscriptionId: 'w-or', matchId: 'm-or', accountId: 'acc1' });
  });

  it('returns focus to "More actions for Orphan" on Escape and on Cancel', async () => {
    await mountDashboard();
    await openRowMenuItem('Orphan', menuLabel);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(m.name);
    pressKey(dialog, 'Escape');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => moreActions('Orphan'));

    await openRowMenuItem('Orphan', menuLabel);
    const again = await screen.findByRole('dialog');
    await within(again).findByLabelText(m.name);
    activate(within(again).getByRole('button', { name: create('en').cancel }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => moreActions('Orphan'));
  });

  it.each(['en', 'nl'] as const)('announces the recreate in the status region (%s) and says nothing when it fails', async (locale) => {
    const mounted = await mountDashboard({ locale });
    await openRowMenuItem('Orphan', dash(locale).orphan.recreateActual);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(accountLabel(create(locale).actual.account)), { target: { value: 'acc1' } });
    const submit = within(dialog).getByRole('button', { name: create(locale).submit });
    await waitFor(() => { expect((submit as HTMLButtonElement).disabled).toBe(false); });
    fireEvent.click(submit);
    await waitFor(() => { expect(regionText()).toBe(fill(dash(locale).announce.createdInActual, { name: 'Orphan' })); }, { timeout: 2500 });
    expect(region().getAttribute('role')).toBe('status');
    expect(mounted.server.calls.some((c) => c.method === 'POST' && c.url === '/api/integrations/actual-schedules')).toBe(true);
    // the orphan row's menu is gone with the dialog; a confirmed recreate hands focus to the search box
    await waitForFocus(searchBox);
  });

  it('announces nothing when the create fails, and keeps the dialog open with the error', async () => {
    const mounted = await mountDashboard({ fail: ['create'] });
    await openRowMenuItem('Orphan', menuLabel);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(accountLabel(m.account)), { target: { value: 'acc1' } });
    const submit = within(dialog).getByRole('button', { name: create('en').submit });
    await waitFor(() => { expect((submit as HTMLButtonElement).disabled).toBe(false); });
    fireEvent.click(submit);
    await within(dialog).findByRole('alert');
    await waitForCalls(mounted, 'POST', /actual-schedules$/, 1);
    expect(regionText()).toBe('');
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });
});

describe('Recreate in Wallos (orphaned_wallos row)', () => {
  const m = create('en').wallos;
  const labels = [m.name, /^Price/, m.startDate, m.paymentMethod, m.category];
  const menuLabel = dash('en').orphan.recreateWallos;

  it('opens from the More actions menu by keyboard with the shared frame and sends the matchId', async () => {
    const mounted = await mountDashboard();
    await openRowMenuItem('Lost', menuLabel);
    const dialog = await expectCreateFrame({ locale: 'en', kind: 'wallos', source: 'Lost', fieldLabels: labels });
    await waitForFocus(await within(dialog).findByLabelText(m.name));
    expectFocusTrapped(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: create('en').submit }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    const post = mounted.server.calls.find((c) => c.url === '/api/integrations/wallos-subscriptions' && c.method === 'POST');
    expect(post?.body).toMatchObject({ scheduleId: 'a-ow', matchId: 'm-ow' });
  });

  it('returns focus to "More actions for Lost" on Escape and on Cancel', async () => {
    await mountDashboard();
    await openRowMenuItem('Lost', menuLabel);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(m.name);
    pressKey(dialog, 'Escape');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => moreActions('Lost'));

    await openRowMenuItem('Lost', menuLabel);
    const again = await screen.findByRole('dialog');
    await within(again).findByLabelText(m.name);
    activate(within(again).getByRole('button', { name: create('en').cancel }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => moreActions('Lost'));
  });

  it.each(['en', 'nl'] as const)('announces the recreate in the status region (%s)', async (locale) => {
    await mountDashboard({ locale });
    await openRowMenuItem('Lost', dash(locale).orphan.recreateWallos);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(create(locale).wallos.name);
    fireEvent.click(within(dialog).getByRole('button', { name: create(locale).submit }));
    await waitFor(() => { expect(regionText()).toBe(fill(dash(locale).announce.createdInWallos, { name: 'Lost' })); }, { timeout: 2500 });
    await waitForFocus(searchBox);
  });

  it('announces nothing when the create fails', async () => {
    const mounted = await mountDashboard({ fail: ['create'] });
    await openRowMenuItem('Lost', menuLabel);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(m.name);
    fireEvent.click(within(dialog).getByRole('button', { name: create('en').submit }));
    await within(dialog).findByRole('alert');
    await waitForCalls(mounted, 'POST', /wallos-subscriptions$/, 1);
    expect(regionText()).toBe('');
  });
});

describe('Relink announcement from the row menu', () => {
  const link = (locale: Locale) => dash(locale).orphan.link;

  async function relinkFrom(row: string, locale: Locale): Promise<HTMLElement> {
    await openRowMenuItem(row, link(locale));
    const dialog = await screen.findByRole('dialog');
    expect(tabbables(dialog).length).toBeGreaterThan(0);
    return dialog;
  }
  const submitName = (locale: Locale): string => (locale === 'en' ? 'Link' : 'Koppelen');

  it.each(['Orphan', 'Lost'] as const)('announces the relink of %s in English once the server accepts it', async (row) => {
    const mounted = await mountDashboard();
    const dialog = await relinkFrom(row, 'en');
    expect(regionText()).toBe('');
    fireEvent.click(within(dialog).getByRole('button', { name: submitName('en') }));
    await waitFor(() => { expect(regionText()).toBe(fill(dash('en').announce.relinked, { name: row })); }, { timeout: 2500 });
    expect(mounted.server.calls.some((c) => c.method === 'POST' && c.url.endsWith('/relink'))).toBe(true);
    await waitForFocus(searchBox);
  });

  it('announces the relink in Dutch', async () => {
    await mountDashboard({ locale: 'nl' });
    const dialog = await relinkFrom('Orphan', 'nl');
    fireEvent.click(within(dialog).getByRole('button', { name: submitName('nl') }));
    await waitFor(() => { expect(regionText()).toBe(fill(dash('nl').announce.relinked, { name: 'Orphan' })); }, { timeout: 2500 });
  });

  it('announces nothing when the relink fails', async () => {
    const mounted = await mountDashboard({ fail: ['relink'] });
    const dialog = await relinkFrom('Orphan', 'en');
    fireEvent.click(within(dialog).getByRole('button', { name: submitName('en') }));
    await within(dialog).findByRole('alert');
    await waitForCalls(mounted, 'POST', /\/relink$/, 1);
    expect(regionText()).toBe('');
  });
});

// Focus after a successful Create from an unlinked row. The sync re-run that follows the create changes the DOM
// before the modal closes: the real server answers with a LINKED pair for the new item, whose cell renders first
// in its side with the same data-side and data-row-id as the row it replaces (found in a real browser: focus
// landed on the first row). 'removed' is the other server behaviour: the item just disappears.
describe.each(['en', 'nl'] as const)('Focus after Create from an unlinked row (%s)', (locale) => {
  const m = create(locale);
  const five = (prefix: string, label: string) => Array.from({ length: 5 }, (_, i) => syncItem(`${prefix}${String(i + 1)}`, `${label}${String(i + 1)}`));
  const resultOf = (wallos: number, actual: number) => ({
    ...dashboardFixture(),
    candidates: [],
    unlinkedWallos: five('w', 'Wal').slice(0, wallos),
    unlinkedActual: five('a', 'Act').slice(0, actual),
  });
  const buttonOf = (side: 'wallos' | 'actual', name: string) => (side === 'wallos' ? createButton(name, locale) : createWallosButton(name, locale));

  async function createFrom(side: 'wallos' | 'actual', name: string, outcome: 'linked' | 'removed', result: ReturnType<typeof resultOf>) {
    const mounted = await mountDashboard({ locale, result, createOutcome: outcome });
    activate(buttonOf(side, name));
    const dialog = await screen.findByRole('dialog');
    if (side === 'wallos') {
      fireEvent.change(await within(dialog).findByLabelText(accountLabel(m.actual.account)), { target: { value: 'acc1' } });
    } else {
      await within(dialog).findByLabelText(m.wallos.name);
    }
    const submit = within(dialog).getByRole('button', { name: m.submit });
    await waitFor(() => { expect((submit as HTMLButtonElement).disabled).toBe(false); });
    fireEvent.click(submit);
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForCalls(mounted, 'POST', side === 'wallos' ? /actual-schedules$/ : /wallos-subscriptions$/, 1);
    const announced = side === 'wallos' ? dash(locale).announce.createdInActual : dash(locale).announce.createdInWallos;
    await waitFor(() => { expect(regionText()).toBe(fill(announced, { name })); }, { timeout: 2500 });
    return mounted;
  }

  describe.each(['linked', 'removed'] as const)('server answer: %s', (outcome) => {
    describe.each(['wallos', 'actual'] as const)('%s side', (side) => {
      const prefix = side === 'wallos' ? 'Wal' : 'Act';
      const results = (n: number) => (side === 'wallos' ? resultOf(n, 5) : resultOf(5, n));

      it('a middle row of 5 hands focus to the next row', async () => {
        const mounted = await createFrom(side, `${prefix}3`, outcome, results(5));
        if (outcome === 'linked') {
          // the refreshed DOM really holds the created item twice: its new LINKED cell comes before every
          // unlinked row of the side, with the same data-side and data-row-id (what fooled a DOM read)
          const cells = Array.from(document.querySelectorAll<HTMLElement>(`[data-side="${side}"][data-row-id]`));
          const id = `${side === 'wallos' ? 'w' : 'a'}3`;
          const at = cells.findIndex((el) => el.dataset.rowId === id);
          expect(cells[at]?.hasAttribute('data-linked')).toBe(true);
          expect(cells.findIndex((el) => !el.hasAttribute('data-linked'))).toBeGreaterThan(at);
        }
        expect(mounted.server.calls.filter((c) => c.url.includes('/api/sync/check')).length).toBeGreaterThan(1);
        await waitForFocus(() => buttonOf(side, `${prefix}4`));
      });

      it('the last row hands focus to the previous row', async () => {
        await createFrom(side, `${prefix}5`, outcome, results(5));
        await waitForFocus(() => buttonOf(side, `${prefix}4`));
      });

      it('the first row hands focus to the next row', async () => {
        await createFrom(side, `${prefix}1`, outcome, results(5));
        await waitForFocus(() => buttonOf(side, `${prefix}2`));
      });

      it('the only row of its side hands focus to the search box', async () => {
        await createFrom(side, `${prefix}1`, outcome, results(1));
        await waitForFocus(searchBox);
      });
    });
  });

  it('Cancel after a successful create elsewhere does not matter: a re-opened, cancelled modal returns to its own Create button', async () => {
    await mountDashboard({ locale, result: resultOf(5, 5) });
    activate(createButton('Wal3', locale));
    let dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText(accountLabel(m.actual.account));
    activate(within(dialog).getByRole('button', { name: m.cancel }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => createButton('Wal3', locale));
    activate(createButton('Wal3', locale));
    dialog = await screen.findByRole('dialog');
    pressKey(dialog, 'Escape');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => createButton('Wal3', locale));
  });
});

describe('A failed Create from an unlinked row', () => {
  it('keeps the modal open with the error, announces nothing, and Cancel returns focus to that row Create button', async () => {
    const mounted = await mountDashboard({ fail: ['create'] });
    activate(createButton('Hulu'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(accountLabel(create('en').actual.account)), { target: { value: 'acc1' } });
    const submit = within(dialog).getByRole('button', { name: create('en').submit });
    await waitFor(() => { expect((submit as HTMLButtonElement).disabled).toBe(false); });
    fireEvent.click(submit);
    await within(dialog).findByRole('alert');
    await waitForCalls(mounted, 'POST', /actual-schedules$/, 1);
    expect(screen.queryByRole('dialog')).not.toBeNull();
    expect(regionText()).toBe('');
    activate(within(dialog).getByRole('button', { name: create('en').cancel }));
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    await waitForFocus(() => createButton('Hulu'));
    expect(regionText()).toBe('');
  });
});

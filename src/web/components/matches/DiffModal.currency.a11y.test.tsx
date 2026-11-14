// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Locale } from '@/i18n';
import {
  cleanupDashboard,
  dashboardFixture,
  expectDialogAccessibility,
  expectFocusTrapped,
  mountDashboard,
  nameOf,
  pressKey,
  tabbables,
  waitForFocus,
  type MountedDashboard,
} from '../../a11y.helpers';
import type { SyncCheckResult, SyncWallosSource } from '../../../lib/sync-check-types';
import { commonMessages } from '@/i18n/common.messages';
import { diffModalMessages } from './DiffModal.messages';
import { createModalMessages } from '../dashboard/CreateModal.messages';

// Issue 223: the Wallos source price, rate and rate source in the diff modal, the per-subscription rate override
// (RateField) and "Change Wallos currency to {budget currency}" with its confirmation, through the Sync Dashboard.

afterEach(cleanupDashboard);

const messages = { en: diffModalMessages.en, nl: diffModalMessages.nl } as const;
const sentence = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v), template);
const plain = (s: string | null | undefined): string => (s ?? '').replace(/[\u00a0\u202f]/g, ' ');
const click = (el: Element): void => { fireEvent.click(el); };
const escape = (): void => { pressKey(document.activeElement ?? document.body, 'Escape'); };
const names = (root: HTMLElement): string[] => tabbables(root).map(nameOf);
const resolveCalls = (m: MountedDashboard) => m.server.calls.filter((c) => c.url.endsWith('/resolve'));

const USD: SyncWallosSource = { currencyCode: 'USD', priceCents: 2500, rate: 2, rateSource: 'wallos' };

/** The Adobe pair (m-ad) with a foreign Wallos source: Wallos 12.50 EUR from USD 25.00, Actual 12.00. */
function foreign(source: SyncWallosSource | null, wallosCents = 1250): SyncCheckResult {
  const base = dashboardFixture();
  return {
    ...base,
    mismatches: base.mismatches.map((m) => ({
      ...m,
      wallosAmountCents: wallosCents,
      wallosFields: { ...m.wallosFields, amount: { kind: 'single', cents: wallosCents }, ...(source === null ? {} : { source }) },
    })),
  };
}

type Reply = { status: number; body?: unknown };

/** Wraps the fake server's fetch: `/resolve` gets `reply`, `PUT/DELETE /api/overrides/*` run `onOverride`. */
function intercept(m: MountedDashboard, hooks: { resolve?: Reply; onOverride?: (method: string, body: unknown) => void }): void {
  const inner = globalThis.fetch;
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    if (hooks.resolve !== undefined && input.endsWith('/resolve')) {
      m.server.calls.push({ method, url: input, body });
      return hooks.resolve.body === undefined
        ? new Response(null, { status: hooks.resolve.status })
        : Response.json(hooks.resolve.body, { status: hooks.resolve.status });
    }
    if (input.startsWith('/api/overrides/')) {
      m.server.calls.push({ method, url: input, body });
      hooks.onOverride?.(method, body);
      return method === 'DELETE'
        ? new Response(null, { status: 204 })
        : Response.json({ wallosSubscriptionId: 'w-ad', rate: '1', resetMatches: 0 });
    }
    return inner(input, init);
  }) as unknown as typeof fetch;
}

async function openDiff(locale: Locale, result: SyncCheckResult): Promise<{ mounted: MountedDashboard; dialog: HTMLElement }> {
  const mounted = await mountDashboard({ locale, result });
  const review = screen.getByRole('button', { name: locale === 'en' ? 'Review differences: Adobe' : 'Verschillen bekijken: Adobe' });
  review.focus();
  click(review);
  return { mounted, dialog: await screen.findByRole('dialog') };
}

const buttonIn = (root: HTMLElement, label: string): HTMLElement =>
  Array.from(root.querySelectorAll('button')).find((b) => nameOf(b) === label) as HTMLElement;

describe.each(['en', 'nl'] as const)('Wallos source block (%s)', (locale) => {
  const m = messages[locale];

  it('shows the source price, rate, effective rate and rate source for a foreign-currency subscription', async () => {
    const { dialog } = await openDiff(locale, foreign(USD));
    const block = dialog.querySelector<HTMLElement>('[data-wallos-source]') as HTMLElement;
    expect(block).not.toBeNull();
    expect(within(block).getByRole('heading', { name: m.source.heading })).toBeTruthy();
    const text = plain(block.textContent);
    expect(text).toContain(locale === 'en' ? 'USD 25.00' : 'USD 25,00');
    expect(text).toContain(m.source.rateSources.wallos);
    expect(text).not.toContain(m.source.rateSources.override);
    expect(text).toMatch(locale === 'en' ? /1 USD ≈ 0\.50 EUR/ : /1 USD ≈ 0,50 EUR/);
    // The converted amount stays, with the source price under it, in the monospaced amount cell.
    const cell = dialog.querySelector<HTMLElement>('[data-diff-row="amount"] td') as HTMLElement;
    expect(cell.className).toContain('font-mono');
    expect(plain(cell.querySelector('[data-source-price]')?.textContent)).toBe(locale === 'en' ? 'USD 25.00' : 'USD 25,00');
  });

  it('formats a zero-decimal currency without fraction digits (JPY)', async () => {
    const { dialog } = await openDiff(locale, foreign({ currencyCode: 'JPY', priceCents: 2000, rate: 160, rateSource: 'override' }));
    const block = dialog.querySelector<HTMLElement>('[data-wallos-source]') as HTMLElement;
    const text = plain(block.textContent);
    expect(text).toMatch(locale === 'en' ? /JPY 2,000(?![.,]\d)/ : /JPY 2\.000(?![.,]\d)/);
    expect(text).toContain(m.source.rateSources.override);
  });

  it('adds nothing for a base-currency pair', async () => {
    const { dialog } = await openDiff(locale, foreign(null));
    expect(dialog.querySelector('[data-wallos-source]')).toBeNull();
    expect(dialog.querySelector('[data-source-price]')).toBeNull();
    expect(screen.queryByRole('button', { name: sentence(m.changeCurrency, { currency: 'EUR' }) })).toBeNull();
    expect(names(dialog)).toEqual([m.ignoreDiff, m.overwriteWallos, m.overwriteActual, m.unlink, locale === 'en' ? 'Close' : 'Sluiten']);
  });
});

describe('rate override from the diff modal', () => {
  const rateLabel = diffModalMessages.en.source.wallosRate.replace('{from}', 'USD');
  const saved = createModalMessages.en.actual.rate.save;

  it('saves the override, re-runs the check and shows the updated converted amount and source', async () => {
    const { mounted, dialog } = await openDiff('en', foreign(USD));
    intercept(mounted, {
      onOverride: () => {
        // What the next check returns once the override (1 USD = 1.0 on the Wallos scale) is stored.
        mounted.server.result = foreign({ ...USD, rate: 1, rateSource: 'override' }, 2500);
      },
    });
    const before = mounted.server.calls.filter((c) => c.url.includes('/api/sync/check')).length;
    fireEvent.change(within(dialog).getByLabelText(rateLabel), { target: { value: '1' } });
    click(within(dialog).getByRole('button', { name: saved }));
    await waitFor(() => { expect(plain(dialog.querySelector('[data-wallos-source]')?.textContent)).toContain(diffModalMessages.en.source.rateSources.override); });
    const put = mounted.server.calls.find((c) => c.method === 'PUT');
    expect(put).toMatchObject({ url: '/api/overrides/w-ad', body: { rate: '1' } });
    expect(mounted.server.calls.filter((c) => c.url.includes('/api/sync/check')).length).toBeGreaterThan(before);
    expect(plain(dialog.querySelector('[data-wallos-source]')?.textContent)).toContain(diffModalMessages.en.source.rateSources.override);
    expect(dialog.isConnected).toBe(true);
    expect(resolveCalls(mounted)).toHaveLength(0);
  });

  it('when the new rate makes the pair agree, the next check shows it Synced and the modal closes', async () => {
    const { mounted, dialog } = await openDiff('en', foreign(USD));
    intercept(mounted, {
      onOverride: () => {
        const r = mounted.server.result;
        mounted.server.result = {
          ...r,
          mismatches: [],
          linked: r.linked.map((l) => (l.matchId === 'm-ad' ? { ...l, status: 'LINKED' as const } : l)),
        };
      },
    });
    fireEvent.change(within(dialog).getByLabelText(rateLabel), { target: { value: '2.08' } });
    click(within(dialog).getByRole('button', { name: saved }));
    await waitFor(() => { expect(dialog.isConnected).toBe(false); });
    const row = document.querySelector('[data-linked-match="m-ad"]') as HTMLElement;
    expect(row.querySelector('[data-kind="mismatch"]')).toBeNull();
    expect(row.querySelector('[data-kind="synced"]')).not.toBeNull();
    expect(document.querySelector('[data-review-for="m-ad"]')).toBeNull();
  });

  it('Clear removes the override and re-runs the check', async () => {
    const { mounted, dialog } = await openDiff('en', foreign({ ...USD, rate: 1, rateSource: 'override' }, 2500));
    intercept(mounted, { onOverride: () => { mounted.server.result = foreign(USD); } });
    click(within(dialog).getByRole('button', { name: createModalMessages.en.actual.rate.clear }));
    await waitFor(() => { expect(plain(dialog.querySelector('[data-diff-row="amount"] td')?.textContent)).toContain('12.50'); });
    expect(mounted.server.calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/overrides/w-ad');
    expect(plain(dialog.querySelector('[data-wallos-source]')?.textContent)).toContain(diffModalMessages.en.source.rateSources.wallos);
  });
});

describe.each(['en', 'nl'] as const)('Change Wallos currency (%s)', (locale) => {
  const m = messages[locale];
  const label = sentence(m.changeCurrency, { currency: 'EUR' });
  const title = sentence(m.changeCurrencyConfirmTitle, { currency: 'EUR' });
  const open = async (reply?: Reply) => {
    const { mounted, dialog } = await openDiff(locale, foreign(USD));
    if (reply !== undefined) intercept(mounted, { resolve: reply });
    const trigger = buttonIn(dialog, label);
    trigger.focus();
    click(trigger);
    return { mounted, dialog, alert: await screen.findByRole('alertdialog') };
  };

  it('is a button of the action area, after the two overwrites and before Unlink', async () => {
    const { dialog } = await openDiff(locale, foreign(USD));
    const order = [m.ignoreDiff, m.overwriteWallos, m.overwriteActual, label, m.unlink].map((n) => names(dialog).indexOf(n));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(names(dialog).indexOf(label)).toBeGreaterThan(names(dialog).indexOf(m.overwriteActual));
    expect(names(dialog).indexOf(label)).toBeLessThan(names(dialog).indexOf(m.unlink));
  });

  it('opens an alertdialog naming the change, Cancel first, focus trapped', async () => {
    const { dialog, alert } = await open();
    expectDialogAccessibility(alert, {
      name: title,
      description: locale === 'en'
        ? /Adobe changes from USD to EUR, and its price becomes .{0,2}12\.00.*Walley cannot add a missing currency to Wallos/
        : /wijzigt Adobe van USD naar EUR, en de prijs wordt .{0,2}12,00.*Walley kan geen ontbrekende valuta aan Wallos toevoegen/,
    });
    expect(plain(alert.textContent)).toContain('USD');
    expect(plain(alert.textContent)).toContain('EUR');
    expect(names(alert)).toEqual([m.cancel, m.confirm]);
    await waitForFocus(() => screen.getByRole('button', { name: m.cancel }));
    expectFocusTrapped(alert);
    expect(dialog.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('Escape and Cancel return focus to the button and send nothing', async () => {
    const { mounted, dialog, alert } = await open();
    await waitForFocus(() => screen.getByRole('button', { name: m.cancel }));
    escape();
    await waitFor(() => { expect(alert.isConnected).toBe(false); });
    await waitForFocus(() => buttonIn(dialog, label));
    const again = buttonIn(dialog, label);
    click(again);
    const second = await screen.findByRole('alertdialog');
    click(screen.getByRole('button', { name: m.cancel }));
    await waitFor(() => { expect(second.isConnected).toBe(false); });
    await waitForFocus(() => buttonIn(dialog, label));
    expect(resolveCalls(mounted)).toHaveLength(0);
  });

  it('Confirm sends exactly one overwrite_wallos_currency with confirm: true and closes the modal', async () => {
    const { mounted, dialog } = await open({ status: 200, body: { status: 'LINKED' } });
    click(screen.getByRole('button', { name: m.confirm }));
    await waitFor(() => { expect(dialog.isConnected).toBe(false); });
    expect(resolveCalls(mounted)).toHaveLength(1);
    expect(resolveCalls(mounted)[0]).toMatchObject({ method: 'POST', url: '/api/matches/m-ad/resolve', body: { action: 'overwrite_wallos_currency', confirm: true } });
  });

  it('wallos_currency_missing shows its message in an alert and the modal stays open', async () => {
    const { mounted, dialog } = await open({ status: 400, body: { error: 'wallos_currency_missing' } });
    click(screen.getByRole('button', { name: m.confirm }));
    const alert = await screen.findByRole('alert');
    expect(dialog.contains(alert)).toBe(true);
    expect(alert.textContent).toContain(sentence(m.overwriteErrors.wallos_currency_missing, { currency: 'EUR' }));
    expect(alert.textContent).not.toContain('{currency}');
    expect(dialog.isConnected).toBe(true);
    expect(resolveCalls(mounted)).toHaveLength(1);
    await waitFor(() => { expect(buttonIn(dialog, label).getAttribute('aria-disabled')).toBe('false'); });
  });

  it('currency_conversion_failed shows its message in an alert and the modal stays open', async () => {
    const { dialog } = await open({ status: 400, body: { error: 'currency_conversion_failed' } });
    click(screen.getByRole('button', { name: m.confirm }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(m.overwriteErrors.currency_conversion_failed);
    expect(dialog.isConnected).toBe(true);
  });
});

describe('Change Wallos currency copy', () => {
  it('the English strings read as specified', () => {
    const en = diffModalMessages.en;
    expect(sentence(en.changeCurrency, { currency: 'EUR' })).toBe('Change Wallos currency to EUR');
    expect(sentence(en.overwriteErrors.wallos_currency_missing, { currency: 'EUR' })).toBe('EUR is not set up in your Wallos. Add it in Wallos first, then try again.');
    expect(en.changeCurrencyConfirmBody).toContain('Walley cannot add a missing currency to Wallos');
  });
  it('the common error catalogue still covers the Wallos upstream codes the action can return', () => {
    for (const code of ['wallos_unavailable', 'wallos_rejected', 'wallos_auth_failed'] as const) {
      expect(commonMessages.en.errors[code].length).toBeGreaterThan(5);
      expect(commonMessages.nl.errors[code]).not.toBe(commonMessages.en.errors[code]);
    }
  });
});

/** Holds the answer to `/resolve` until `release()`; counts the requests. */
function holdResolve(m: MountedDashboard, reply: Reply): { release: () => void; started: () => number } {
  const inner = globalThis.fetch;
  let release = (): void => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let count = 0;
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    if (input.endsWith('/resolve')) {
      count += 1;
      m.server.calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url: input, body: undefined });
      await gate;
      return reply.body === undefined ? new Response(null, { status: reply.status }) : Response.json(reply.body, { status: reply.status });
    }
    return inner(input, init);
  }) as unknown as typeof fetch;
  return { release, started: () => count };
}

describe.each(['en', 'nl'] as const)('non-ISO Wallos currency code (%s)', (locale) => {
  it('renders the price as "{code} {amount}" instead of crashing the app (US$)', async () => {
    const { dialog } = await openDiff(locale, foreign({ currencyCode: 'US$', priceCents: 2500, rate: 2, rateSource: 'wallos' }));
    const text = plain(dialog.querySelector('[data-wallos-source]')?.textContent);
    expect(text).toContain(locale === 'en' ? 'US$ 25.00' : 'US$ 25,00');
    expect(plain(dialog.querySelector('[data-source-price]')?.textContent)).toBe(locale === 'en' ? 'US$ 25.00' : 'US$ 25,00');
    expect(dialog.isConnected).toBe(true);
  });
});

describe.each(['en', 'nl'] as const)('source price sign (%s)', (locale) => {
  const cases: [string, SyncWallosSource, string, string][] = [
    ['ISO', { ...USD, priceCents: -2500 }, 'USD 25.00', 'USD 25,00'],
    ['JPY', { currencyCode: 'JPY', priceCents: -2000, rate: 160, rateSource: 'wallos' }, 'JPY 2,000', 'JPY 2.000'],
    ['US$ fallback', { ...USD, currencyCode: 'US$', priceCents: -2500 }, 'US$ 25.00', 'US$ 25,00'],
  ];
  for (const [label, source, en, nl] of cases) {
    it(`shows an expense's own price without a minus sign (${label})`, async () => {
      const { dialog } = await openDiff(locale, foreign(source));
      const text = plain(dialog.querySelector('[data-source-price]')?.textContent);
      expect(text).toBe(locale === 'en' ? en : nl);
    });
  }
});

describe.each(['en', 'nl'] as const)('rate help with an override (%s)', (locale) => {
  it('does not call the override the Wallos rate', async () => {
    const { dialog } = await openDiff(locale, foreign({ ...USD, rate: 4, rateSource: 'override' }));
    const text = plain(dialog.querySelector('[data-wallos-source]')?.textContent);
    expect(text).not.toContain(locale === 'en' ? 'Wallos rate: 4' : 'Wallos-koers: 4');
    const input = within(dialog).getByLabelText<HTMLInputElement>(diffModalMessages[locale].source.wallosRate.replace('{from}', 'USD'));
    expect(input.value).toBe('4');
    expect(input.getAttribute('placeholder')).toBe('');
  });
});

describe('rate field and resolve actions lock each other', () => {
  const rateLabel = diffModalMessages.en.source.wallosRate.replace('{from}', 'USD');

  it('during a pending resolve the rate input is read-only and Save and Clear send nothing', async () => {
    const { mounted, dialog } = await openDiff('en', foreign({ ...USD, rate: 3, rateSource: 'override' }));
    const hold = holdResolve(mounted, { status: 204 });
    click(buttonIn(dialog, diffModalMessages.en.ignoreDiff));
    await waitFor(() => { expect(hold.started()).toBe(1); });
    const input = within(dialog).getByLabelText<HTMLInputElement>(rateLabel);
    expect(input.readOnly).toBe(true);
    const save = within(dialog).getByRole('button', { name: createModalMessages.en.actual.rate.save });
    const clear = within(dialog).getByRole('button', { name: createModalMessages.en.actual.rate.clear });
    expect(save.getAttribute('aria-disabled')).toBe('true');
    expect(clear.getAttribute('aria-disabled')).toBe('true');
    click(save);
    click(clear);
    pressKey(input, 'Enter');
    expect(mounted.server.calls.filter((c) => c.url.startsWith('/api/overrides/'))).toHaveLength(0);
    hold.release();
    await waitFor(() => { expect(dialog.isConnected).toBe(false); });
  });

  it('during a pending rate save Ignore Diff and Overwrite send no request', async () => {
    const { mounted, dialog } = await openDiff('en', foreign(USD));
    const inner = globalThis.fetch;
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      if (input.startsWith('/api/overrides/')) {
        await gate;
        return Response.json({ error: 'invalid_rate' }, { status: 400 });
      }
      return inner(input, init);
    }) as unknown as typeof fetch;
    fireEvent.change(within(dialog).getByLabelText(rateLabel), { target: { value: '1' } });
    click(within(dialog).getByRole('button', { name: createModalMessages.en.actual.rate.save }));
    const ignore = buttonIn(dialog, diffModalMessages.en.ignoreDiff);
    await waitFor(() => { expect(ignore.getAttribute('aria-disabled')).toBe('true'); });
    click(ignore);
    click(buttonIn(dialog, diffModalMessages.en.overwriteWallos));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(mounted.server.calls.filter((c) => c.url.endsWith('/resolve'))).toHaveLength(0);
    release();
    await within(dialog).findByText(commonMessages.en.errors.invalid_rate);
    expect(ignore.getAttribute('aria-disabled')).toBe('false');
  });
});

describe('rate labels and scale', () => {
  it('the read-only effective rate and the Wallos-scale input have different labels, with the scale help', async () => {
    const { dialog } = await openDiff('en', foreign({ ...USD, rate: 2 }));
    const block = dialog.querySelector<HTMLElement>('[data-wallos-source]') as HTMLElement;
    const effective = diffModalMessages.en.source.rate.replace('{from}', 'USD').replace('{to}', 'EUR');
    const wallosLabel = diffModalMessages.en.source.wallosRate.replace('{from}', 'USD');
    expect(effective).not.toBe(wallosLabel);
    expect(within(block).getAllByText(effective)).toHaveLength(1);
    expect(within(block).getAllByText(wallosLabel)).toHaveLength(2 - 1);
    const input = within(block).getByLabelText(wallosLabel);
    expect(input.getAttribute('placeholder')).toBe('2');
    expect(plain(block.textContent)).toContain('Wallos rate: 2');
    expect(plain(block.textContent)).toMatch(/1 USD ≈ 0\.50 EUR/);
  });

  it('shows a tiny rate without exponent notation', async () => {
    const { dialog } = await openDiff('en', foreign({ ...USD, rate: 1e-7, rateSource: 'override' }));
    const input = within(dialog).getByLabelText<HTMLInputElement>(diffModalMessages.en.source.wallosRate.replace('{from}', 'USD'));
    expect(input.value).toBe('0.0000001');
  });
});

describe('Enter saves the rate', () => {
  it('Enter in the rate input sends the override once', async () => {
    const { mounted, dialog } = await openDiff('en', foreign(USD));
    intercept(mounted, { onOverride: () => { mounted.server.result = foreign({ ...USD, rate: 1, rateSource: 'override' }, 2500); } });
    const input = within(dialog).getByLabelText(diffModalMessages.en.source.wallosRate.replace('{from}', 'USD'));
    fireEvent.change(input, { target: { value: '1' } });
    pressKey(input, 'Enter');
    await waitFor(() => { expect(mounted.server.calls.filter((c) => c.method === 'PUT')).toHaveLength(1); });
    expect(mounted.server.calls.find((c) => c.method === 'PUT')).toMatchObject({ body: { rate: '1' } });
  });
});

describe('focus stays on the activated button while busy', () => {
  it('Ignore Diff: focus stays, a second activation sends nothing, and the modal cannot be dismissed', async () => {
    const { mounted, dialog } = await openDiff('en', foreign(USD));
    const hold = holdResolve(mounted, { status: 204 });
    const ignore = buttonIn(dialog, diffModalMessages.en.ignoreDiff);
    ignore.focus();
    click(ignore);
    await waitFor(() => { expect(hold.started()).toBe(1); });
    expect(document.activeElement).toBe(ignore);
    expect(ignore.hasAttribute('disabled')).toBe(false);
    expect(ignore.getAttribute('aria-disabled')).toBe('true');
    click(ignore);
    escape();
    expect(hold.started()).toBe(1);
    expect(dialog.isConnected).toBe(true);
    hold.release();
    await waitFor(() => { expect(dialog.isConnected).toBe(false); });
  });

  it('Ignore Diff after a failure: focus is still on the button', async () => {
    const { mounted, dialog } = await openDiff('en', foreign(USD));
    intercept(mounted, { resolve: { status: 400, body: { error: 'invalid_state' } } });
    const ignore = buttonIn(dialog, diffModalMessages.en.ignoreDiff);
    ignore.focus();
    click(ignore);
    await screen.findByRole('alert');
    expect(document.activeElement).toBe(ignore);
    expect(ignore.getAttribute('aria-disabled')).toBe('false');
  });

  it('a pending Change currency: the trigger keeps focus, a second activation opens no confirmation and sends nothing', async () => {
    const { mounted, dialog } = await openDiff('en', foreign(USD));
    const hold = holdResolve(mounted, { status: 400, body: { error: 'wallos_currency_missing' } });
    const label = sentence(diffModalMessages.en.changeCurrency, { currency: 'EUR' });
    const trigger = buttonIn(dialog, label);
    trigger.focus();
    click(trigger);
    await screen.findByRole('alertdialog');
    click(screen.getByRole('button', { name: diffModalMessages.en.confirm }));
    await waitFor(() => { expect(hold.started()).toBe(1); });
    await waitForFocus(() => buttonIn(dialog, label));
    expect(trigger.getAttribute('aria-disabled')).toBe('true');
    click(trigger);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    hold.release();
    await screen.findByRole('alert');
    await waitForFocus(() => buttonIn(dialog, label));
    expect(hold.started()).toBe(1);
  });

  it('the rate Save button keeps focus while saving and after a failure, and a second click sends nothing', async () => {
    const { mounted, dialog } = await openDiff('en', foreign(USD));
    const inner = globalThis.fetch;
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let puts = 0;
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      if (input.startsWith('/api/overrides/')) {
        puts += 1;
        await gate;
        return Response.json({ error: 'invalid_rate' }, { status: 400 });
      }
      return inner(input, init);
    }) as unknown as typeof fetch;
    fireEvent.change(within(dialog).getByLabelText(diffModalMessages.en.source.wallosRate.replace('{from}', 'USD')), { target: { value: 'x' } });
    const save = within(dialog).getByRole('button', { name: createModalMessages.en.actual.rate.save });
    save.focus();
    click(save);
    const busy = within(dialog).getByRole('button', { name: createModalMessages.en.actual.rate.saving });
    expect(busy).toBe(save);
    expect(document.activeElement).toBe(save);
    click(save);
    expect(puts).toBe(1);
    release();
    await within(dialog).findByText(commonMessages.en.errors.invalid_rate);
    expect(document.activeElement).toBe(save);
    expect(mounted.server.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });
});

describe.each(['en', 'nl'] as const)('currency written but other fields differ (%s)', (locale) => {
  const m = messages[locale];
  it('keeps the modal open on the refreshed pair, re-runs the check and shows a status', async () => {
    const { mounted, dialog } = await openDiff(locale, foreign(USD));
    const label = sentence(m.changeCurrency, { currency: 'EUR' });
    // After the write the check lists the pair again: same amount, but the interval still differs.
    mounted.server.result = foreign(USD, 1200);
    intercept(mounted, { resolve: { status: 200, body: { status: 'MISMATCH_DETECTED', outcome: 'currency_changed_other_fields_differ' } } });
    const before = mounted.server.calls.filter((c) => c.url.includes('/api/sync/check')).length;
    click(buttonIn(dialog, label));
    click(await screen.findByRole('button', { name: m.confirm }));
    const status = await within(dialog).findByText(m.currencyChanged);
    expect(status.closest('[role="status"]')).not.toBeNull();
    expect(dialog.isConnected).toBe(true);
    expect(resolveCalls(mounted)).toHaveLength(1);
    expect(mounted.server.calls.filter((c) => c.url.includes('/api/sync/check')).length).toBeGreaterThan(before);
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });
});

describe('Change Wallos currency edge cases', () => {
  it('is hidden when the Actual amount is a range', async () => {
    const base = foreign(USD);
    const result: SyncCheckResult = {
      ...base,
      mismatches: base.mismatches.map((x) => ({ ...x, actualFields: { ...x.actualFields, amount: { kind: 'range', num1: 1000, num2: 2000 } } })),
    };
    const { dialog } = await openDiff('en', result);
    expect(buttonIn(dialog, sentence(diffModalMessages.en.changeCurrency, { currency: 'EUR' }))).toBeUndefined();
  });

  it('currency_conversion_failed on Overwrite Wallos uses the common text, not the "set your own rate here" one', async () => {
    const { mounted, dialog } = await openDiff('en', foreign(USD));
    intercept(mounted, { resolve: { status: 400, body: { error: 'currency_conversion_failed' } } });
    click(buttonIn(dialog, diffModalMessages.en.overwriteWallos));
    click(await screen.findByRole('button', { name: diffModalMessages.en.confirm }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain(commonMessages.en.errors.currency_conversion_failed);
    expect(alert.textContent).not.toContain('Set your own rate');
    vi.restoreAllMocks();
  });
});

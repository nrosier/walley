import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { ApiError } from '@/lib/api';
import { commonMessages } from '@/i18n/common.messages';
import { buildWallosBody, createActualSchedule, createWallosSubscription, prefillActualSchedule, prefillWallosSubscription, type ActualSchedulePrefill, type WallosSubscriptionPrefill } from '@/lib/create.api';
import { clearOverride, saveOverride } from '@/lib/overrides.api';
import { CreateActualForm } from './CreateActualModal';
import { actualDisabledReason, actualEdits, actualFieldsReason, actualFieldValues, actualSubmitDisabled, buildActualBody, centsToDecimal, performCreate, submitCreate, wallosDisabledReason, wallosEdits, wallosSubmitDisabled } from './create-submit';
import { createNoticeKinds, createNoticeStore } from '@/lib/notices';
import { NoticeToastView } from './NoticeToast';
import { CreateWallosForm } from './CreateWallosModal';
import actualSrc from './CreateActualModal.tsx?raw';
import wallosSrc from './CreateWallosModal.tsx?raw';
import apiSrc from '@/lib/create.api.ts?raw';
import frameSrc from './CreateModalFrame.tsx?raw';
import shellSrc from '../ui/dialog-shell.tsx?raw';
import dashboardSrc from '../../pages/SyncDashboard.tsx?raw';

const actual: ActualSchedulePrefill = {
  name: 'Netflix',
  amountCents: -1299,
  baseCurrency: 'EUR',
  sourceCurrency: 'EUR',
  wallosRate: '1',
  overrideRate: null,
  recurrence: { frequency: 'monthly', interval: 1 },
  startDate: '2026-11-01',
  accounts: [{ id: 'a1', name: 'Checking' }],
  payees: [{ id: 'p1', name: 'NETFLIX.COM' }],
  categories: [{ id: 'c1', name: 'Fun' }],
};
const wallos: WallosSubscriptionPrefill = {
  name: 'Rent',
  price: '900.00',
  currencyCode: 'EUR',
  cycle: 3,
  frequency: 1,
  startDate: '2026-01-05',
  nextPayment: '2026-11-05',
  paymentMethods: [],
  categories: [],
};

const render = (ui: React.ReactElement, locale: Locale = 'en') =>
  renderToStaticMarkup(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);

const jsonFetch = (body: unknown) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

describe('CreateActualForm', () => {
  it('renders the pre-fill, payee option cards, two dropdowns and a Submit that is disabled until an account is chosen', () => {
    const html = render(<CreateActualForm prefill={actual} wallosId="w1" />);
    expect(html).toMatch(/<input[^>]*value="Netflix"/);
    expect(html).toMatch(/<input[^>]*inputMode="decimal"[^>]*class="[^"]*font-mono"[^>]*value="12\.99"/);
    expect(html).toContain('Every month');
    expect(html.match(/<select/g)).toHaveLength(2);
    expect(html).toContain('role="radiogroup" aria-label="Payee"');
    expect(html.match(/type="radio"/g)).toHaveLength(1 + actual.payees.length);
    expect(html).toContain('NETFLIX.COM');
    expect(html).toContain('Checking');
    expect(html).toContain('Fun');
    expect(html).not.toContain('Held:');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create<\/button>/);
  });
  it('renders in nl', () => {
    const html = render(<CreateActualForm prefill={actual} wallosId="w1" />, 'nl');
    expect(html).toContain('Elke maand');
    expect(html).toContain('Rekening');
  });
});

describe('RateField in CreateActualForm', () => {
  const foreign: ActualSchedulePrefill = { ...actual, sourceCurrency: 'USD', wallosRate: '0.92', overrideRate: '0.95' };
  it('is hidden for base-currency subscriptions', () => {
    expect(render(<CreateActualForm prefill={actual} wallosId="w1" />)).not.toContain('Rate (');
  });
  it('shows both codes, the Wallos rate help, the saved rate and Clear for foreign currency', () => {
    const html = render(<CreateActualForm prefill={foreign} wallosId="w1" />);
    expect(html).toContain('Rate (USD to EUR)');
    expect(html).toContain('Wallos rate: 0.92');
    expect(html).toContain('value="0.95"');
    expect(html).toContain('Clear');
    expect(render(<CreateActualForm prefill={foreign} wallosId="w1" />, 'nl')).toContain('Koers (USD naar EUR)');
  });
  it('shows the empty state without a Wallos rate and no Clear without an override', () => {
    const html = render(<CreateActualForm prefill={{ ...foreign, wallosRate: null, overrideRate: null }} wallosId="w1" />);
    expect(html).toContain('Wallos has no rate');
    expect(html).not.toContain('>Clear<');
  });
  it('overrides.api calls PUT with the rate and DELETE, same-origin', async () => {
    const f = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ wallosSubscriptionId: 'w 1', rate: '0.9', resetMatches: 0 }), { status: 200 })));
    await saveOverride('w 1', '0.9', f);
    const [url, init] = f.mock.calls[0] ?? [];
    expect(url).toBe('/api/overrides/w%201');
    expect(init?.method).toBe('PUT');
    expect(init?.body).toBe('{"rate":"0.9"}');
    const d = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
    await clearOverride('w1', d);
    expect(d.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });
  it('surfaces invalid_rate as an ApiError code with en and nl text', async () => {
    const f = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ error: 'invalid_rate' }), { status: 400 })));
    await expect(saveOverride('w1', 'x', f)).rejects.toMatchObject({ code: 'invalid_rate' });
    expect(commonMessages.nl.errors.invalid_rate).not.toBe(commonMessages.en.errors.invalid_rate);
  });
});

describe('CreateWallosForm', () => {
  it('renders the pre-fill and a Submit that is disabled until an account is chosen', () => {
    const html = render(<CreateWallosForm prefill={wallos} scheduleId="s1" />);
    expect(html).toContain('value="Rent"');
    expect(html).toContain('value="900.00"');
    expect(html).toContain('Price (EUR)');
    expect(html).toContain('Every month');
    expect(html).toContain('2026-01-05');
    expect(html).not.toContain('Held:');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Create<\/button>/);
    expect(html).toMatch(/<button[^>]*>Create<\/button>/);
  });
});

describe('CreateWallosForm payment method and category', () => {
  const withChoices: WallosSubscriptionPrefill = {
    ...wallos,
    paymentMethods: [{ id: '4', name: 'Visa' }],
    categories: [{ id: '7', name: 'Housing' }],
  };
  it('renders both selects with the options and an empty default', () => {
    const html = render(<CreateWallosForm prefill={withChoices} scheduleId="s1" />);
    expect(html).toContain('Payment method');
    expect(html).toContain('<option value="" selected="">No payment method</option>');
    expect(html).toContain('<option value="4">Visa</option>');
    expect(html).toContain('<option value="" selected="">No category</option>');
    expect(html).toContain('<option value="7">Housing</option>');
    expect(html).not.toContain('<option value="4" selected');
    expect(html).not.toContain('<option value="7" selected');
  });
  it('renders in nl', () => {
    const html = render(<CreateWallosForm prefill={withChoices} scheduleId="s1" />, 'nl');
    expect(html).toContain('Betaalmethode');
    expect(html).toContain('Geen categorie');
  });
  it('hides each field when Wallos returned no options for it', () => {
    const none = render(<CreateWallosForm prefill={wallos} scheduleId="s1" />);
    expect(none).not.toContain('<select');
    const onlyCategory = render(<CreateWallosForm prefill={{ ...wallos, categories: withChoices.categories }} scheduleId="s1" />);
    expect(onlyCategory).toContain('Housing');
    expect(onlyCategory).not.toContain('Payment method');
    const onlyMethod = render(<CreateWallosForm prefill={{ ...wallos, paymentMethods: withChoices.paymentMethods }} scheduleId="s1" />);
    expect(onlyMethod).toContain('Visa');
    expect(onlyMethod).not.toContain('No category');
  });
  it('sends the chosen ids as digit strings, and nothing when empty', async () => {
    expect(buildWallosBody('s1')).toEqual({ scheduleId: 's1' });
    expect(buildWallosBody('s1', undefined, { paymentMethodId: '', categoryId: '' })).toEqual({ scheduleId: 's1' });
    expect(buildWallosBody('s1', 'm1', { paymentMethodId: '4' })).toEqual({ scheduleId: 's1', matchId: 'm1', paymentMethodId: '4' });
    const f = jsonFetch({ wallosSubscriptionId: '9' });
    await createWallosSubscription('s1', f, undefined, undefined, { paymentMethodId: '4', categoryId: '7' });
    expect(JSON.parse(f.mock.calls[0]?.[1]?.body as string)).toEqual({ scheduleId: 's1', paymentMethodId: '4', categoryId: '7' });
    const g = jsonFetch({ wallosSubscriptionId: '9' });
    await createWallosSubscription('s1', g, undefined, undefined, { paymentMethodId: '', categoryId: '' });
    expect(JSON.parse(g.mock.calls[0]?.[1]?.body as string)).toEqual({ scheduleId: 's1' });
  });
  it('buildWallosBody sends both chosen ids as digit strings', () => {
    const body = buildWallosBody('s1', undefined, { paymentMethodId: '4', categoryId: '7' });
    expect(body).toEqual({ scheduleId: 's1', paymentMethodId: '4', categoryId: '7' });
    expect(body.paymentMethodId).toMatch(/^\d+$/);
    expect(body.categoryId).toMatch(/^\d+$/);
  });
  it('buildWallosBody sends only the one chosen id', () => {
    expect(buildWallosBody('s1', undefined, { paymentMethodId: '4', categoryId: '' })).toEqual({ scheduleId: 's1', paymentMethodId: '4' });
    expect(buildWallosBody('s1', undefined, { paymentMethodId: '', categoryId: '7' })).toEqual({ scheduleId: 's1', categoryId: '7' });
  });
  it('an empty selection (fields hidden) builds the body it always did: scheduleId only', () => {
    expect(buildWallosBody('s1', undefined, { paymentMethodId: '', categoryId: '' })).toEqual({ scheduleId: 's1' });
    expect(Object.keys(buildWallosBody('s1', undefined, { paymentMethodId: '', categoryId: '' }))).toEqual(['scheduleId']);
  });
  it('renders no payment method or category select when both lists are empty', () => {
    const html = render(<CreateWallosForm prefill={{ ...wallos, paymentMethods: [], categories: [] }} scheduleId="s1" />);
    expect(html).not.toContain('<select');
    expect(html).not.toContain('Payment method');
    expect(html).not.toContain('No category');
  });
  it('the form passes its two selected values into the create call', () => {
    // Secondary, static-source check: no DOM is available, so the submit handler itself is not executed.
    expect(wallosSrc).toMatch(/paymentMethodId: paymentMethod, categoryId: category, \.\.\.wallosEdits\(prefill, fields, prefillUnit\)/);
    expect(wallosSrc).toMatch(/prefill\.paymentMethods\.length > 0/);
    expect(wallosSrc).toMatch(/prefill\.categories\.length > 0/);
  });
});

describe('Wallos edited fields reach the create body (#133)', () => {
  it('buildWallosBody sends each edited field only when set', () => {
    expect(buildWallosBody('s1', undefined, { title: 'Music', price: '9.90', billingCycle: 'weekly', startDate: '2026-03-04' })).toEqual({
      scheduleId: 's1',
      title: 'Music',
      price: '9.90',
      billingCycle: 'weekly',
      startDate: '2026-03-04',
    });
    expect(buildWallosBody('s1', undefined, { title: '', price: '', startDate: '' })).toEqual({ scheduleId: 's1' });
  });
  it('createWallosSubscription posts the edited fields as JSON', async () => {
    const f = jsonFetch({ wallosSubscriptionId: '9' });
    await createWallosSubscription('s1', f, undefined, 'm1', { title: 'Music', billingCycle: 'custom_days', price: '5', startDate: '2026-03-04' });
    expect(JSON.parse(f.mock.calls[0]?.[1]?.body as string)).toEqual({
      scheduleId: 's1',
      matchId: 'm1',
      title: 'Music',
      price: '5',
      billingCycle: 'custom_days',
      startDate: '2026-03-04',
    });
  });
  const fields = { title: 'Rent', price: '900.00', unit: 'month', startDate: '2026-01-05' } as const;
  it('wallosEdits sends nothing for an untouched form, so the body is what it always was', () => {
    expect(wallosEdits(wallos, fields, 'month')).toEqual({});
    expect(buildWallosBody('s1', undefined, { paymentMethodId: '', categoryId: '', ...wallosEdits(wallos, fields, 'month') })).toEqual({ scheduleId: 's1' });
  });
  it('wallosEdits sends only the changed fields, each cycle segment as its Wallos value', () => {
    expect(wallosEdits(wallos, { ...fields, title: ' Flat ', price: '12,5', startDate: '2026-02-01' }, 'month')).toEqual({
      title: 'Flat',
      price: '12.5',
      startDate: '2026-02-01',
    });
    expect(wallosEdits(wallos, { ...fields, unit: 'day' }, 'month')).toEqual({ billingCycle: 'custom_days' });
    expect(wallosEdits(wallos, { ...fields, unit: 'week' }, 'month')).toEqual({ billingCycle: 'weekly' });
    expect(wallosEdits(wallos, { ...fields, unit: 'year' }, 'month')).toEqual({ billingCycle: 'yearly' });
    expect(wallosEdits(wallos, { ...fields, unit: 'month' }, 'week')).toEqual({ billingCycle: 'monthly' });
  });
  it('wallosEdits compares the start date with the next payment when Wallos has no start date', () => {
    expect(wallosEdits({ ...wallos, startDate: null }, { ...fields, startDate: '2026-11-05' }, 'month')).toEqual({});
  });
  it('wallosDisabledReason mirrors the server: title length, price places for the currency, real date', () => {
    expect(wallosDisabledReason(fields, 'EUR')).toBeNull();
    expect(wallosDisabledReason({ ...fields, title: ' ' }, 'EUR')).toBe('title');
    expect(wallosDisabledReason({ ...fields, title: 'x'.repeat(201) }, 'EUR')).toBe('title');
    expect(wallosDisabledReason({ ...fields, price: '0' }, 'EUR')).toBe('price');
    expect(wallosDisabledReason({ ...fields, price: '9.999' }, 'EUR')).toBe('price');
    expect(wallosDisabledReason({ ...fields, price: '12,50' }, 'EUR')).toBeNull();
    expect(wallosDisabledReason({ ...fields, price: '1250' }, 'JPY')).toBeNull();
    expect(wallosDisabledReason({ ...fields, price: '12.5' }, 'JPY')).toBe('price');
    expect(wallosDisabledReason({ ...fields, startDate: '' }, 'EUR')).toBe('startDate');
    expect(wallosDisabledReason({ ...fields, startDate: '2026-02-30' }, 'EUR')).toBe('startDate');
  });
});

describe('create.api', () => {
  it('prefill wrappers call only the prefill routes, same-origin', async () => {
    const f1 = jsonFetch(actual);
    expect(await prefillActualSchedule('w1', f1)).toEqual(actual);
    const f2 = jsonFetch(wallos);
    expect(await prefillWallosSubscription('s1', f2)).toEqual(wallos);
    const calls = [...f1.mock.calls, ...f2.mock.calls];
    expect(calls.map((c) => c[0])).toEqual([
      '/api/integrations/actual-schedules/prefill',
      '/api/integrations/wallos-subscriptions/prefill',
    ]);
    for (const [, init] of calls) {
      expect(init?.credentials).toBe('same-origin');
      expect(init?.method).toBe('POST');
    }
  });
  it('rendering and prefill make no create call', () => {
    const f = jsonFetch({});
    render(<CreateActualForm prefill={actual} wallosId="w1" fetchImpl={f} />);
    render(<CreateWallosForm prefill={wallos} scheduleId="s1" fetchImpl={f} />);
    expect(f).not.toHaveBeenCalled();
  });
  it('create wrappers POST the exact body to the create routes', async () => {
    const f1 = jsonFetch({ scheduleId: 'x', payeeId: 'p', payeeCreated: true, categoryApplied: false });
    const body = buildActualBody('w1', 'a1', '__new__', 'Netflix', '');
    await createActualSchedule(body, f1);
    const f2 = jsonFetch({ wallosSubscriptionId: '9' });
    await createWallosSubscription('s1', f2);
    expect(f1.mock.calls[0]?.[0]).toBe('/api/integrations/actual-schedules');
    expect(f2.mock.calls[0]?.[0]).toBe('/api/integrations/wallos-subscriptions');
    expect(JSON.parse(f1.mock.calls[0]?.[1]?.body as string)).toEqual({
      wallosSubscriptionId: 'w1',
      accountId: 'a1',
      payee: { kind: 'new', name: 'Netflix' },
    });
    expect(JSON.parse(f2.mock.calls[0]?.[1]?.body as string)).toEqual({ scheduleId: 's1' });
    for (const f of [f1, f2]) {
      expect(f.mock.calls[0]?.[1]?.credentials).toBe('same-origin');
      expect(f.mock.calls[0]?.[1]?.method).toBe('POST');
    }
  });
});

describe('submit logic', () => {
  it('builds existing payee and category bodies', () => {
    expect(buildActualBody('w1', 'a1', 'p1', 'ignored', 'c1')).toEqual({
      wallosSubscriptionId: 'w1',
      accountId: 'a1',
      payee: { kind: 'existing', id: 'p1' },
      categoryId: 'c1',
    });
  });
  it('disables Actual Submit without an account and while in flight', () => {
    expect(actualSubmitDisabled('', false)).toBe(true);
    expect(actualSubmitDisabled('a1', true)).toBe(true);
    expect(actualSubmitDisabled('a1', false)).toBe(false);
  });
  it('disables Wallos Submit while in flight only', () => {
    expect(wallosSubmitDisabled(true)).toBe(true);
    expect(wallosSubmitDisabled(false)).toBe(false);
  });
  it('runs the refresh after success and not after failure', async () => {
    const refresh = vi.fn();
    const ok = await performCreate(() => Promise.resolve({ id: 1 }), refresh);
    expect(ok).toEqual({ ok: true, result: { id: 1 } });
    expect(refresh).toHaveBeenCalledTimes(1);
    const bad = await performCreate(() => Promise.reject(new ApiError(502, 'wallos_unavailable')), refresh);
    expect(bad).toEqual({ ok: false, code: 'wallos_unavailable' });
    const odd = await performCreate(() => Promise.reject(new Error('secret text')), refresh);
    expect(odd).toEqual({ ok: false, code: 'request_failed' });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('success through a mocked fetch triggers the refresh', async () => {
    const f = jsonFetch({ wallosSubscriptionId: '9' });
    const refresh = vi.fn();
    await performCreate(() => createWallosSubscription('s1', f), refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  const codes = [
    'invalid_request', 'range_amount_unsupported', 'base_currency_missing', 'wallos_subscription_not_found',
    'schedule_not_found', 'actual_not_configured', 'actual_unavailable', 'actual_sync_failed',
    'wallos_not_configured', 'wallos_auth_failed', 'wallos_rejected', 'wallos_unavailable',
    'patterns_unsupported', 'mapping_failed', 'currency_conversion_failed', 'internal_error', 'unauthenticated',
    'invalid_payee', 'invalid_account', 'invalid_category',
  ] as const;
  it.each(codes)('has distinct en and nl messages for %s', (code) => {
    const en = commonMessages.en.errors[code as keyof typeof commonMessages.en.errors];
    const nl = commonMessages.nl.errors[code as keyof typeof commonMessages.nl.errors];
    expect(en).toBeTruthy();
    expect(nl).toBeTruthy();
    expect(nl).not.toBe(en);
  });
  it('modal sources show errors through errorText only', () => {
    for (const src of [actualSrc, wallosSrc]) {
      expect(src).toContain('errorText(errorCode)');
      expect(src).not.toMatch(/\.message\b/);
    }
    expect(apiSrc).toContain('/api/integrations/actual-schedules');
  });
});

describe('create modal layout (Actual fields editable, #135; Wallos fields editable, #133)', () => {
  it('The frontend can then unlock the fields: Actual name, amount and start date are editable inputs, pre-filled; frequency stays read-only', () => {
    const html = render(<CreateActualForm prefill={actual} wallosId="w1" />);
    // name, amount and the new payee name are text inputs; the start date is a date input.
    expect(html.match(/<input[^>]*type="text"/g)).toHaveLength(3);
    expect(html).toMatch(/<input[^>]*type="text"[^>]*maxLength="200"[^>]*value="Netflix"/);
    expect(html).toMatch(/<input[^>]*inputMode="decimal"[^>]*value="12\.99"/);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2026-11-01"/);
    expect(html).toContain('Amount (converted) (EUR)');
    // Frequency is display text, not an input or a control.
    expect(html).toMatch(/<dt[^>]*>Frequency<\/dt><dd>Every month<\/dd>/);
    expect(html).not.toMatch(/<(input|select)[^>]*aria-label="Frequency"/);
    expect(html).not.toContain('Pre-filled values are shown read-only.');
    // Payee, account and category stay editable choices, from the caller's own pre-fill lists.
    expect(html).toContain('role="radiogroup" aria-label="Payee"');
    expect(html.match(/<select/g)).toHaveLength(2);
    expect(actualSrc).not.toContain("t('readOnlyNote')");
  });
  it('The frontend can then unlock the fields: renders the editable Actual inputs in nl', () => {
    const html = render(<CreateActualForm prefill={actual} wallosId="w1" />, 'nl');
    for (const label of ['Naam', 'Bedrag (omgerekend) (EUR)', 'Frequentie', 'Startdatum']) expect(html).toContain(label);
  });
  it('The frontend can then unlock the fields: Create is off with a reason when an edited Actual field is invalid', () => {
    expect(actualFieldsReason(actual, { name: '  ' })).toBe('name');
    expect(actualFieldsReason(actual, { name: 'x'.repeat(201) })).toBe('name');
    expect(actualFieldsReason(actual, { amount: '0' })).toBe('amount');
    expect(actualFieldsReason(actual, { amount: '9.999' })).toBe('amount');
    expect(actualFieldsReason({ ...actual, baseCurrency: 'JPY', amountCents: -1250 }, { amount: '12.5' })).toBe('amount');
    expect(actualFieldsReason(actual, { startDate: '2026-02-30' })).toBe('startDate');
    expect(actualFieldsReason(actual, { name: 'Films', amount: '9,90', startDate: '2026-03-04' })).toBeNull();
    expect(actualFieldsReason(actual, {})).toBeNull();
    // A pre-fill whose own value is out of range is not sent, so it does not block Create.
    expect(actualFieldsReason({ ...actual, startDate: 'n/a' }, {})).toBeNull();
    const html = render(<CreateActualForm prefill={{ ...actual, name: '' }} wallosId="w1" />);
    expect(html).not.toContain('Name must be between 1 and 200 characters.');
  });
  it('Existing no-override requests are unchanged (regression test): an untouched Actual form sends the body it always did', () => {
    expect(actualEdits(actual, {})).toEqual({});
    expect(actualEdits(actual, actualFieldValues(actual, {}))).toEqual({});
    expect(buildActualBody('w1', 'a1', 'p1', '', 'c1', undefined, actualEdits(actual, {}))).toEqual({
      wallosSubscriptionId: 'w1',
      accountId: 'a1',
      payee: { kind: 'existing', id: 'p1' },
      categoryId: 'c1',
    });
    expect(buildActualBody('w1', 'a1', 'p1', '', 'c1', undefined, {})).toEqual(buildActualBody('w1', 'a1', 'p1', '', 'c1'));
  });
  it('Both create routes accept overrides and apply them: the Actual submit sends only the changed fields', async () => {
    expect(actualEdits(actual, { name: ' Films ' })).toEqual({ name: 'Films' });
    expect(actualEdits(actual, { amount: '12,5' })).toEqual({ amount: '12.5' });
    expect(actualEdits(actual, { amount: '12.99' })).toEqual({});
    expect(actualEdits(actual, { startDate: '2026-12-01' })).toEqual({ startDate: '2026-12-01' });
    expect(actualEdits(actual, { name: 'Netflix', startDate: '2026-11-01' })).toEqual({});
    const body = buildActualBody('w1', 'a1', '__new__', 'New', '', 'm1', { name: 'Films', amount: '5' });
    expect(body).toEqual({ wallosSubscriptionId: 'w1', accountId: 'a1', payee: { kind: 'new', name: 'New' }, matchId: 'm1', name: 'Films', amount: '5' });
    const f = jsonFetch({ scheduleId: 's', payeeId: 'p', payeeCreated: false, categoryApplied: false });
    await createActualSchedule(body, f);
    expect(JSON.parse(f.mock.calls[0]?.[1]?.body as string)).toEqual(body);
    expect(actualSrc).toContain('buildActualBody(wallosId, account, payee, newName, category, matchId, actualEdits(prefill, fields))');
  });
  it('centsToDecimal writes the pre-fill amount with the base currency places, without float', () => {
    expect(centsToDecimal(-1299, 'EUR')).toBe('12.99');
    expect(centsToDecimal(-5, 'EUR')).toBe('0.05');
    expect(centsToDecimal(-1250, 'JPY')).toBe('1250');
    expect(centsToDecimal(-123456789012, 'USD')).toBe('1234567890.12');
  });
  it('Actual: Cancel and Create sit together and the reason Create is off shows in the footer and beside the field', () => {
    const html = render(<CreateActualForm prefill={actual} wallosId="w1" onCancel={() => undefined} />);
    const footer = html.slice(html.indexOf('data-slot="create-footer"'));
    expect(footer).toContain('>Cancel</button>');
    expect(footer).toMatch(/<button[^>]*disabled=""[^>]*>Create<\/button>/);
    expect(footer).toContain('Create is off: An account is required.');
    expect(footer).toMatch(/aria-describedby="[^"]+"[^>]*>Create</);
    const beside = html.slice(html.indexOf('Choose an account'), html.indexOf('data-slot="create-footer"'));
    expect(beside).toContain('An account is required.');
    expect(render(<CreateActualForm prefill={actual} wallosId="w1" />, 'nl')).toContain('Aanmaken niet mogelijk: Een rekening is verplicht.');
  });
  it('actualDisabledReason names the first missing field', () => {
    expect(actualDisabledReason('', '__new__', 'x')).toBe('account');
    expect(actualDisabledReason('a1', '__new__', '  ')).toBe('payeeName');
    expect(actualDisabledReason('a1', 'p1', '')).toBeNull();
    expect(actualDisabledReason('a1', '__new__', 'Netflix')).toBeNull();
  });
  it('Wallos (#133): title, price, billing cycle (segmented) and start date are editable inputs, pre-filled', () => {
    const html = render(<CreateWallosForm prefill={wallos} scheduleId="s1" onCancel={() => undefined} />);
    expect(html).toContain('role="radiogroup" aria-label="Billing cycle"');
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html).not.toMatch(/type="radio"[^>]*disabled=""|disabled=""[^>]*type="radio"/);
    expect(html).toMatch(/value="month"[^>]*checked=""|checked=""[^>]*value="month"/);
    expect(html.match(/<input[^>]*type="text"/g)).toHaveLength(2); // title and price
    expect(html).toMatch(/<input[^>]*type="text"[^>]*value="Rent"/);
    expect(html).toMatch(/<input[^>]*inputMode="decimal"[^>]*value="900\.00"/);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2026-01-05"/);
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('Pre-filled values are shown read-only.');
    const footer = html.slice(html.indexOf('data-slot="create-footer"'));
    expect(footer).toContain('>Cancel</button>');
    expect(footer).toContain('>Create</button>');
  });
  it('Wallos (#133): the start date falls back to the next payment when Wallos has no start date', () => {
    const html = render(<CreateWallosForm prefill={{ ...wallos, startDate: null }} scheduleId="s1" />);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value="2026-11-05"/);
  });
  it('Wallos (#133): renders the four inputs in nl', () => {
    const html = render(<CreateWallosForm prefill={wallos} scheduleId="s1" />, 'nl');
    for (const label of ['Titel', 'Prijs (EUR)', 'Factureringscyclus', 'Startdatum']) expect(html).toContain(label);
    expect(html).toContain('Elke maand');
  });
  it('Wallos (#133): Create is off with a reason when a field is invalid', () => {
    const reasons = [
      [{ ...wallos, name: '   ' }, 'Create is off: Title must be between 1 and 200 characters.'],
      [{ ...wallos, price: '0' }, "Create is off: Enter a price above zero matching the currency&#x27;s decimals."],
      [{ ...wallos, startDate: '2026-02-30' }, 'Create is off: Enter a valid start date.'],
    ] as const;
    for (const [prefill, text] of reasons) {
      const html = render(<CreateWallosForm prefill={prefill} scheduleId="s1" />);
      expect(html).toContain(text);
      expect(html.slice(html.indexOf('data-slot="create-footer"'))).toMatch(/<button[^>]*disabled=""[^>]*>Create<\/button>/);
    }
  });
  it('Wallos (#133): the submit builds its body from the form fields through buildWallosBody', () => {
    expect(wallosSrc).toMatch(/\.\.\.wallosEdits\(prefill, fields, prefillUnit\)/);
    expect(wallosSrc).toContain('createWallosSubscription(scheduleId, fetchImpl, undefined, matchId,');
    expect(apiSrc).toMatch(/buildWallosBody\(scheduleId, matchId, choices\)/);
  });
  it('both modals use the shared frame (DialogShell: pinned header and footer, scrolling body, sheet below 768px)', () => {
    expect(frameSrc).toContain('<DialogShell');
    expect(shellSrc).toContain('max-md:h-dvh');
    expect(shellSrc).toContain('overflow-y-auto');
    for (const src of [actualSrc, wallosSrc]) {
      expect(src).toContain('<CreateModalFrame');
      expect(src).toContain('footerHost={host}');
    }
  });
});

describe('close on success and toast notices (issue 110)', () => {
  const okResult = { scheduleId: 'x', payeeId: 'p', payeeCreated: true, categoryApplied: false, categoryError: true };

  it('On success the modal closes automatically and the dashboard refreshes', async () => {
    const order: string[] = [];
    const refresh = vi.fn(() => { order.push('refresh'); });
    const onCreated = vi.fn(() => { order.push('close'); });
    const onFailed = vi.fn();
    const f = jsonFetch(okResult);
    await submitCreate(() => createActualSchedule(buildActualBody('w1', 'a1', 'p1', '', ''), f), refresh, { onCreated, onFailed });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith(okResult);
    expect(onFailed).not.toHaveBeenCalled();
    expect(order).toEqual(['refresh', 'close']);
    for (const src of [actualSrc, wallosSrc]) {
      expect(src).toContain('onCreated={');
      expect(src).not.toMatch(/<Alert variant="success">/);
    }
    expect(actualSrc).toMatch(/onCreated=\{\(result\) => \{[^}]*props\.onClose\(\);/);
    expect(wallosSrc).toContain('onCreated={props.onClose}');
  });

  it('If the create returns payee or category notices, they are shown on the dashboard as a dismissible toast, not in a blocking modal', () => {
    expect(createNoticeKinds(okResult)).toEqual(['payeeCreated', 'categoryError']);
    expect(createNoticeKinds({ payeeCreated: false })).toEqual([]);
    const store = createNoticeStore();
    store.push(createNoticeKinds(okResult));
    const html = render(<NoticeToastView notices={store.getNotices()} onDismiss={store.dismiss} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('A new payee was created.');
    expect(html).toContain('the category could not be set');
    expect(html).toContain('aria-label="Dismiss notice"');
    expect(html).not.toContain('role="dialog"');
    expect(render(<NoticeToastView notices={store.getNotices()} onDismiss={store.dismiss} />, 'nl')).toContain('aria-label="Melding sluiten"');
    const first = store.getNotices()[0];
    store.dismiss(first?.id ?? -1);
    expect(store.getNotices().map((n) => n.kind)).toEqual(['categoryError']);
    store.dismiss(store.getNotices()[0]?.id ?? -1);
    expect(render(<NoticeToastView notices={store.getNotices()} onDismiss={store.dismiss} />)).toBe('');
    expect(actualSrc).toContain('noticeStore.push(createNoticeKinds(result))');
    expect(dashboardSrc).toContain('<NoticeToast />');
  });

  it('On failure the modal stays open with the error', async () => {
    const refresh = vi.fn();
    const onCreated = vi.fn();
    const onFailed = vi.fn();
    const f = vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify({ error: 'actual_unavailable' }), { status: 502 })));
    await submitCreate(() => createActualSchedule(buildActualBody('w1', 'a1', 'p1', '', ''), f), refresh, { onCreated, onFailed });
    expect(onFailed).toHaveBeenCalledWith('actual_unavailable');
    expect(onCreated).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    for (const src of [actualSrc, wallosSrc]) expect(src).toContain('{errorCode !== null ? <Alert variant="error">{errorText(errorCode)}</Alert> : null}');
  });
});

describe('Create modals checklist (issue 113)', () => {
  it('Below 768px the modal is a full-screen sheet', () => {
    // Both modals open through CreateModalFrame, which renders DialogShell.
    for (const src of [actualSrc, wallosSrc]) expect(src).toContain('<CreateModalFrame');
    expect(frameSrc).toContain('<DialogShell');
    // Below the md breakpoint (768px) the shell fills the viewport with no rounding, border or centring offset.
    for (const cls of ['max-md:inset-0', 'max-md:h-dvh', 'max-md:max-h-none', 'max-md:max-w-none', 'max-md:translate-x-0', 'max-md:translate-y-0', 'max-md:rounded-none', 'max-md:border-0']) {
      expect(shellSrc, cls).toContain(cls);
    }
  });
});

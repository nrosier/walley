import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { ApiError } from '@/lib/api';
import { commonMessages } from '@/i18n/common.messages';
import { createActualSchedule, createWallosSubscription, prefillActualSchedule, prefillWallosSubscription, type ActualSchedulePrefill, type WallosSubscriptionPrefill } from '@/lib/create.api';
import { CreateActualForm } from './CreateActualModal';
import { actualSubmitDisabled, buildActualBody, performCreate, wallosSubmitDisabled } from './create-submit';
import { CreateWallosForm } from './CreateWallosModal';
import actualSrc from './CreateActualModal.tsx?raw';
import wallosSrc from './CreateWallosModal.tsx?raw';
import apiSrc from '@/lib/create.api.ts?raw';

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
};

const render = (ui: React.ReactElement, locale: Locale = 'en') =>
  renderToStaticMarkup(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);

const jsonFetch = (body: unknown) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

describe('CreateActualForm', () => {
  it('renders the pre-fill, three dropdowns and a Submit that is disabled until an account is chosen', () => {
    const html = render(<CreateActualForm prefill={actual} wallosId="w1" />);
    expect(html).toContain('Netflix');
    expect(html).toMatch(/font-mono[^>]*>-?€12\.99|font-mono[^>]*>.€12\.99/);
    expect(html).toContain('Every month');
    expect(html.match(/<select/g)).toHaveLength(3);
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

describe('CreateWallosForm', () => {
  it('renders the pre-fill and a Submit that is disabled until an account is chosen', () => {
    const html = render(<CreateWallosForm prefill={wallos} scheduleId="s1" />);
    expect(html).toContain('Rent');
    expect(html).toMatch(/font-mono[^>]*>900\.00 EUR/);
    expect(html).toContain('Every month');
    expect(html).toContain('2026-01-05');
    expect(html).not.toContain('Held:');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Create<\/button>/);
    expect(html).toMatch(/<button[^>]*>Create<\/button>/);
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

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { ApiError } from '@/lib/api';
import { commonMessages } from '@/i18n/common.messages';
import { createActualSchedule, createWallosSubscription, prefillActualSchedule, prefillWallosSubscription, type ActualSchedulePrefill, type WallosSubscriptionPrefill } from '@/lib/create.api';
import { clearOverride, saveOverride } from '@/lib/overrides.api';
import { CreateActualForm } from './CreateActualModal';
import { actualDisabledReason, actualSubmitDisabled, buildActualBody, performCreate, submitCreate, wallosSubmitDisabled } from './create-submit';
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
};

const render = (ui: React.ReactElement, locale: Locale = 'en') =>
  renderToStaticMarkup(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);

const jsonFetch = (body: unknown) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));

describe('CreateActualForm', () => {
  it('renders the pre-fill, payee option cards, two dropdowns and a Submit that is disabled until an account is chosen', () => {
    const html = render(<CreateActualForm prefill={actual} wallosId="w1" />);
    expect(html).toContain('Netflix');
    expect(html).toMatch(/font-mono[^>]*>-?€12\.99|font-mono[^>]*>.€12\.99/);
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

describe('create modal layout (UI only, pre-fill read-only until the override backend lands)', () => {
  it('Actual: pre-filled name, amount, frequency and start date are read-only display, not inputs', () => {
    const html = render(<CreateActualForm prefill={actual} wallosId="w1" />);
    expect(html).toContain('<dl');
    expect(html).toContain('Pre-filled values are shown read-only.');
    expect(html).not.toContain('value="2026-11-01"');
    expect(html.match(/<input[^>]*type="text"/g)).toHaveLength(1); // the new payee name only
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
    expect(render(<CreateActualForm prefill={actual} wallosId="w1" />, 'nl')).toContain('Aanmaken is uitgeschakeld: Een rekening is verplicht.');
  });
  it('actualDisabledReason names the first missing field', () => {
    expect(actualDisabledReason('', '__new__', 'x')).toBe('account');
    expect(actualDisabledReason('a1', '__new__', '  ')).toBe('payeeName');
    expect(actualDisabledReason('a1', 'p1', '')).toBeNull();
    expect(actualDisabledReason('a1', '__new__', 'Netflix')).toBeNull();
  });
  it('Wallos: title, price, billing cycle (segmented) and start date are read-only display', () => {
    const html = render(<CreateWallosForm prefill={wallos} scheduleId="s1" onCancel={() => undefined} />);
    expect(html).toContain('role="radiogroup" aria-label="Billing cycle"');
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html.match(/type="radio"[^>]*disabled=""|disabled=""[^>]*type="radio"/g)).toHaveLength(4);
    expect(html).toMatch(/value="month"[^>]*checked=""|checked=""[^>]*value="month"/);
    expect(html).not.toContain('type="text"');
    expect(html).toContain('Pre-filled values are shown read-only.');
    const footer = html.slice(html.indexOf('data-slot="create-footer"'));
    expect(footer).toContain('>Cancel</button>');
    expect(footer).toContain('>Create</button>');
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

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { prefillActualSchedule, prefillWallosSubscription, type ActualSchedulePrefill, type WallosSubscriptionPrefill } from '@/lib/create.api';
import { CreateActualForm } from './CreateActualModal';
import { CreateWallosForm } from './CreateWallosModal';
import actualSrc from './CreateActualModal.tsx?raw';
import wallosSrc from './CreateWallosModal.tsx?raw';
import apiSrc from '@/lib/create.api.ts?raw';

const actual: ActualSchedulePrefill = {
  name: 'Netflix',
  amountCents: -1299,
  baseCurrency: 'EUR',
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
  it('renders the pre-fill, three dropdowns and a disabled Submit with the held note', () => {
    const html = render(<CreateActualForm prefill={actual} />);
    expect(html).toContain('Netflix');
    expect(html).toMatch(/font-mono[^>]*>-?€12\.99|font-mono[^>]*>.€12\.99/);
    expect(html).toContain('Every month');
    expect(html.match(/<select/g)).toHaveLength(3);
    expect(html).toContain('NETFLIX.COM');
    expect(html).toContain('Checking');
    expect(html).toContain('Fun');
    expect(html).toContain('Held: creating items arrives in a later release.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create<\/button>/);
  });
  it('renders in nl', () => {
    const html = render(<CreateActualForm prefill={actual} />, 'nl');
    expect(html).toContain('Elke maand');
    expect(html).toContain('Rekening');
  });
});

describe('CreateWallosForm', () => {
  it('renders the pre-fill and a disabled Submit with the held note', () => {
    const html = render(<CreateWallosForm prefill={wallos} />);
    expect(html).toContain('Rent');
    expect(html).toMatch(/font-mono[^>]*>900\.00 EUR/);
    expect(html).toContain('Every month');
    expect(html).toContain('2026-01-05');
    expect(html).toContain('Held: creating items arrives in a later release.');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Create<\/button>/);
  });
});

describe('create.api', () => {
  it('calls only the two prefill routes, same-origin', async () => {
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
  it('sources reference no create route', () => {
    for (const src of [actualSrc, wallosSrc, apiSrc]) {
      expect(src).not.toMatch(/\/api\/integrations\/(actual-schedules|wallos-subscriptions)['"`]/);
      expect(src).not.toMatch(/createActualSchedule|createWallosSubscription|createSchedule/);
    }
  });
});

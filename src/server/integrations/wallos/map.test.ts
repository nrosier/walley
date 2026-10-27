import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildCurrencyMap,
  mapWallosSubscription,
  resolveCurrencyCode,
  WallosMappingError,
} from './map.js';
import type { WallosCurrency, WallosSubscription, WallosSubscriptionsResponse } from './types.js';

/** Copy of the fixture with one key removed, to simulate Wallos omitting it. */
function without(sub: WallosSubscription, key: keyof WallosSubscription): WallosSubscription {
  return Object.fromEntries(Object.entries(sub).filter(([k]) => k !== key)) as WallosSubscription;
}

/** Copy of the fixture with one key set to a value outside the declared type, as JSON may send. */
function withRuntimeValue(sub: WallosSubscription, key: keyof WallosSubscription, value: unknown): WallosSubscription {
  return { ...sub, [key]: value };
}

// Saved fixture: the first subscription from the example response in ellite/Wallos
// api/subscriptions/get_subscriptions.php (confirmed 2026-10-22). Plain object, no I/O.
const FIXTURE_ACTIVE: WallosSubscription = {
  id: 1,
  name: 'Example Subscription',
  logo: 'example.png',
  price: 10.0,
  currency_id: 1,
  start_date: '2024-09-01',
  next_payment: '2024-09-01',
  cycle: 3,
  frequency: 1,
  auto_renew: 1,
  notes: 'Example note',
  payment_method_id: 1,
  payer_user_id: 1,
  category_id: 1,
  notify: 1,
  url: 'https://example.com',
  inactive: 0,
  notify_days_before: 1,
  user_id: 1,
  cancelation_date: null,
  cancellation_date: '',
  category_name: 'General',
  category_ids: [1, 2],
  category_names: ['General', 'Entertainment'],
  payer_user_name: 'John Doe',
  payer_user_ids: [1, 2],
  payer_user_names: ['John Doe', 'Jane Doe'],
  payment_method_name: 'PayPal',
};

// Saved fixture: the second example subscription, inactive, with a replacement subscription.
// The upstream example sends `notify_days_before: null`; that is omitted here because
// types.ts declares it as number | string only.
const FIXTURE_INACTIVE: WallosSubscription = {
  id: 2,
  name: 'Another Subscription',
  logo: 'another.png',
  price: 15.0,
  currency_id: 2,
  start_date: '2024-09-02',
  next_payment: '2024-09-02',
  cycle: 3,
  frequency: 1,
  auto_renew: 0,
  notes: '',
  payment_method_id: 2,
  payer_user_id: 2,
  category_id: 2,
  notify: 0,
  url: '',
  inactive: 1,
  user_id: 2,
  cancelation_date: null,
  cancellation_date: '',
  category_name: 'Entertainment',
  payer_user_name: 'Jane Doe',
  payment_method_name: 'Credit Card',
  replacement_subscription_id: 1,
};

describe('saved Wallos subscriptions response fixture', () => {
  // Sanitized, invented sample of the documented /api/subscriptions response shape.
  const saved = JSON.parse(
    readFileSync(new URL('./__fixtures__/wallos-subscriptions.json', import.meta.url), 'utf8'),
  ) as WallosSubscriptionsResponse;
  const currencies = buildCurrencyMap([
    { id: 1, name: 'US Dollar', code: 'USD' },
    { id: 2, name: 'Japanese Yen', code: 'JPY' },
    { id: 3, name: 'Euro', code: 'EUR' },
  ]);

  const expected = [
    {
      wallosId: '101', name: 'Sample Streaming Plan', priceCents: -1250, currency: 'USD',
      interval: { type: 'monthly', every: 1 }, recurrence: { frequency: 'monthly', interval: 1 },
      nextPaymentDate: '2026-11-15', startDate: '2025-01-15', active: true,
    },
    {
      wallosId: '102', name: 'Sample Cloud Storage', priceCents: -9999, currency: 'EUR',
      interval: { type: 'yearly', every: 1 }, recurrence: { frequency: 'yearly', interval: 1 },
      nextPaymentDate: '2027-03-01', startDate: '2024-03-01', active: true,
    },
    {
      // JPY has no minor units, so the Wallos price 1200 is 1200 yen, not 120000.
      wallosId: '103', name: 'Sample Meal Box', priceCents: -1200, currency: 'JPY',
      interval: { type: 'weekly', every: 2 }, recurrence: { frequency: 'weekly', interval: 2 },
      nextPaymentDate: '2026-11-03', startDate: '2025-06-02', active: true,
    },
    {
      wallosId: '104', name: 'Sample Parking Pass', priceCents: -420, currency: 'USD',
      interval: { type: 'custom_days', days: 30 }, recurrence: { frequency: 'daily', interval: 30 },
      nextPaymentDate: '2026-11-09', startDate: '2026-02-10', active: false,
    },
  ];

  it('maps every subscription in the saved response', () => {
    expect(saved.success).toBe(true);
    const subs = saved.subscriptions ?? [];
    expect(subs).toHaveLength(expected.length);
    expected.forEach((want, i) => {
      const sub = subs[i];
      if (!sub) throw new Error(`fixture is missing subscription ${String(i)}`);
      const { currency, ...rest } = want;
      const mapped = mapWallosSubscription(sub, currencies);
      expect(mapped).toMatchObject(rest);
      expect(mapped.name).toBe(rest.name);
      expect(mapped.priceCents).toBe(rest.priceCents);
      expect(resolveCurrencyCode(currencies, mapped.currencyId)).toBe(currency);
      expect(mapped.interval).toEqual(rest.interval);
      expect(mapped.nextPaymentDate).toBe(rest.nextPaymentDate);
      expect(mapped.startDate).toBe(rest.startDate);
      expect(mapped.active).toBe(rest.active);
    });
  });
});

describe('mapWallosSubscription', () => {
  it('uses the currency minor units: JPY 1250 is 1250, EUR 12.50 is 1250', () => {
    const map = buildCurrencyMap([
      { id: 1, code: 'EUR' },
      { id: 2, code: 'JPY' },
    ]);
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, price: 1250, currency_id: 2 }, map).priceCents).toBe(-1250);
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, price: '12.50', currency_id: 1 }, map).priceCents).toBe(-1250);
    expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, currency_id: 9 }, map)).toThrow(
      expect.objectContaining({ code: 'unknown_currency' }),
    );
  });

  it('maps the saved active fixture to the internal model', () => {
    expect(mapWallosSubscription(FIXTURE_ACTIVE)).toEqual({
      wallosId: '1',
      name: 'Example Subscription',
      priceCents: -1000,
      currencyId: '1',
      interval: { type: 'monthly', every: 1 },
      recurrence: { frequency: 'monthly', interval: 1 },
      nextPaymentDate: '2024-09-01',
      startDate: '2024-09-01',
      active: true,
    });
  });

  it('maps the saved inactive fixture with active false', () => {
    const mapped = mapWallosSubscription(FIXTURE_INACTIVE);
    expect(mapped.active).toBe(false);
    expect(mapped.priceCents).toBe(-1500);
    expect(mapped.currencyId).toBe('2');
  });

  it('treats inactive as a boolean as well as 0 and 1', () => {
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, inactive: true }).active).toBe(false);
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, inactive: false }).active).toBe(true);
  });

  it('rejects an inactive value that is neither 0, 1 nor a boolean', () => {
    expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, inactive: 2 })).toThrow(
      WallosMappingError,
    );
  });

  it('maps every documented cycle value', () => {
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, cycle: 1, frequency: 3 }).recurrence).toEqual({
      frequency: 'daily',
      interval: 3,
    });
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, cycle: 2, frequency: 2 }).recurrence).toEqual({
      frequency: 'weekly',
      interval: 2,
    });
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, cycle: 3, frequency: 1 }).recurrence).toEqual({
      frequency: 'monthly',
      interval: 1,
    });
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, cycle: 4, frequency: 1 }).recurrence).toEqual({
      frequency: 'yearly',
      interval: 1,
    });
  });

  it('accepts cycle and frequency sent as numeric strings', () => {
    const mapped = mapWallosSubscription({ ...FIXTURE_ACTIVE, cycle: '4', frequency: '2' });
    expect(mapped.interval).toEqual({ type: 'yearly', every: 2 });
  });

  it('converts a string price to negative integer cents', () => {
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, price: '12.50' }).priceCents).toBe(-1250);
  });

  it('keeps the price as cents without float drift', () => {
    expect(mapWallosSubscription({ ...FIXTURE_ACTIVE, price: 1.005 }).priceCents).toBe(-101);
  });

  describe('missing optional fields', () => {
    it('returns null for an absent next_payment', () => {
      const rest = without(FIXTURE_ACTIVE, 'next_payment');
      expect(mapWallosSubscription(rest).nextPaymentDate).toBeNull();
    });

    it('returns null for an absent start_date', () => {
      const rest = without(FIXTURE_ACTIVE, 'start_date');
      expect(mapWallosSubscription(rest).startDate).toBeNull();
    });

    it('returns null for an explicit null next_payment', () => {
      expect(
        mapWallosSubscription(withRuntimeValue(FIXTURE_ACTIVE, 'next_payment', null)).nextPaymentDate,
      ).toBeNull();
    });

    it('throws missing_field when a required field is absent', () => {
      const rest = without(FIXTURE_ACTIVE, 'name');
      try {
        mapWallosSubscription(rest);
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(WallosMappingError);
        expect((err as WallosMappingError).code).toBe('missing_field');
        expect((err as WallosMappingError).field).toBe('name');
      }
    });

    it('throws missing_field when currency_id is absent', () => {
      const rest = without(FIXTURE_ACTIVE, 'currency_id');
      expect(() => mapWallosSubscription(rest)).toThrow(
        expect.objectContaining({ code: 'missing_field', field: 'currency_id' }),
      );
    });

    it('throws on a malformed date instead of passing it through', () => {
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, next_payment: '2024-02-30' })).toThrow(
        expect.objectContaining({ code: 'invalid_value', field: 'next_payment' }),
      );
    });
  });

  describe('unknown cycle', () => {
    it('throws unknown_cycle for a value outside 1 to 5', () => {
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, cycle: 9 })).toThrow(
        expect.objectContaining({ code: 'unknown_cycle', field: 'cycle' }),
      );
    });

    it('throws unsupported_cycle for one-time (cycle 5)', () => {
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, cycle: 5 })).toThrow(
        expect.objectContaining({ code: 'unsupported_cycle', field: 'cycle' }),
      );
    });

    it('throws unknown_cycle for a non-numeric cycle', () => {
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, cycle: 'monthly' })).toThrow(
        expect.objectContaining({ code: 'unknown_cycle' }),
      );
    });

    it('throws invalid_value for a zero or non-integer frequency', () => {
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, frequency: 0 })).toThrow(
        expect.objectContaining({ code: 'invalid_value', field: 'frequency' }),
      );
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, frequency: 1.5 })).toThrow(
        expect.objectContaining({ code: 'invalid_value', field: 'frequency' }),
      );
    });
  });

  describe('price', () => {
    it('rejects a negative price', () => {
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, price: -10 })).toThrow(
        expect.objectContaining({ code: 'invalid_price', field: 'price' }),
      );
    });

    it('rejects a zero price', () => {
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, price: 0 })).toThrow(
        expect.objectContaining({ code: 'invalid_price', field: 'price' }),
      );
    });

    it('rejects a negative price sent as a string', () => {
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, price: '-10.00' })).toThrow(
        expect.objectContaining({ code: 'invalid_price' }),
      );
    });

    it('rejects a non-numeric price string', () => {
      expect(() => mapWallosSubscription({ ...FIXTURE_ACTIVE, price: 'free' })).toThrow(
        expect.objectContaining({ code: 'invalid_price' }),
      );
    });
  });
});

describe('currency code lookup', () => {
  // Saved fixture: the documented example in ellite/Wallos api/currencies/get_currencies.php.
  const CURRENCY_FIXTURE: WallosCurrency[] = [
    { id: 1, name: 'US Dollar', code: 'USD' },
    { id: 2, name: 'Japanese Yen', code: 'JPY' },
    { id: 3, name: 'Euro', code: 'EUR' },
  ];

  it('builds an id-to-code map from the documented currency list', () => {
    const map = buildCurrencyMap(CURRENCY_FIXTURE);
    expect(map.get('1')).toBe('USD');
    expect(map.get('2')).toBe('JPY');
    expect(map.get('3')).toBe('EUR');
    expect(map.size).toBe(3);
  });

  it('resolves the currency_id of a mapped subscription to its code', () => {
    const map = buildCurrencyMap(CURRENCY_FIXTURE);
    const mapped = mapWallosSubscription(FIXTURE_ACTIVE);
    expect(resolveCurrencyCode(map, mapped.currencyId)).toBe('USD');
  });

  it('throws a typed unknown_currency error for an id not in the list', () => {
    const map = buildCurrencyMap(CURRENCY_FIXTURE);
    expect(() => resolveCurrencyCode(map, '99')).toThrow(
      expect.objectContaining({ code: 'unknown_currency', field: 'currency_id' }),
    );
    expect(() => resolveCurrencyCode(map, '99')).toThrow(WallosMappingError);
  });
});

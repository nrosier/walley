import { describe, expect, it } from 'vitest';
import { CurrencyConversionError } from '../../lib/currency-convert.js';
import { prepareActualScheduleInput, prepareWallosSubscriptionPayload } from './prepare.js';
import { buildCurrencyMap, mapWallosSubscription, WallosMappingError } from './wallos/map.js';
import type { WallosCurrency, WallosSubscription } from './wallos/types.js';
import type { RecurringSubscriptionInput } from './wallos/write.js';

const CURRENCIES: WallosCurrency[] = [
  { id: 1, code: 'EUR', name: 'Euro', rate: '1.0000' },
  { id: 2, code: 'USD', name: 'US Dollar', rate: '1.1000' },
  { id: 3, code: 'GBP', name: 'Pound', rate: '0.8500' },
];

const RAW: WallosSubscription = {
  id: 7,
  name: 'Netflix',
  price: '11.00',
  currency_id: 2,
  cycle: 3,
  frequency: 1,
  next_payment: '2026-11-03',
  start_date: '2026-01-03',
  inactive: 0,
};

const SCHEDULE: RecurringSubscriptionInput = {
  name: 'Spotify',
  priceCents: -1000,
  currencyId: '2',
  recurrence: { frequency: 'monthly', interval: 1 },
  startDate: '2026-01-03',
  nextPaymentDate: '2026-11-03',
};

describe('prepareActualScheduleInput', () => {
  it('converts into the base currency and keeps the expense sign', () => {
    const out = prepareActualScheduleInput(mapWallosSubscription(RAW), CURRENCIES, 'EUR');
    // -1100 USD cents * 1 / 1.1 = -1000 EUR cents.
    expect(out).toEqual({
      name: 'Netflix',
      amountCents: -1000,
      recurrence: { frequency: 'monthly', interval: 1 },
      startDate: '2026-01-03',
    });
  });

  it('applies the override rate', () => {
    const out = prepareActualScheduleInput(mapWallosSubscription(RAW), CURRENCIES, 'EUR', '1.25');
    expect(out.amountCents).toBe(-880);
  });

  it('keeps the same start date for a start_date item whatever next_payment says', () => {
    const a = prepareActualScheduleInput(mapWallosSubscription(RAW), CURRENCIES, 'EUR');
    const b = prepareActualScheduleInput(
      mapWallosSubscription({ ...RAW, next_payment: '2026-12-03' }),
      CURRENCIES,
      'EUR',
    );
    expect(b.startDate).toBe(a.startDate);
    expect(b.startDate).toBe('2026-01-03');
  });

  it('falls back to next_payment when start_date is absent', () => {
    const sub = { ...mapWallosSubscription(RAW), startDate: null };
    expect(prepareActualScheduleInput(sub, CURRENCIES, 'EUR').startDate).toBe('2026-11-03');
    expect(() =>
      prepareActualScheduleInput({ ...sub, nextPaymentDate: null }, CURRENCIES, 'EUR'),
    ).toThrow(WallosMappingError);
  });

  it('throws for an unknown currency id or base code', () => {
    const sub = { ...mapWallosSubscription(RAW), currencyId: '99' };
    expect(() => prepareActualScheduleInput(sub, CURRENCIES, 'EUR')).toThrow(WallosMappingError);
    expect(() => prepareActualScheduleInput(mapWallosSubscription(RAW), CURRENCIES, 'JPY')).toThrow(
      CurrencyConversionError,
    );
  });
});

describe('prepareWallosSubscriptionPayload', () => {
  it('converts base cents into the subscription currency', () => {
    const payload = prepareWallosSubscriptionPayload(SCHEDULE, CURRENCIES, 'EUR');
    // -1000 EUR cents * 1.1 = -1100 USD cents -> "11.00".
    expect(payload).toMatchObject({ name: 'Spotify', price: '11.00', currency_id: '2', cycle: '3', frequency: '1' });
  });

  it('applies the override rate', () => {
    expect(prepareWallosSubscriptionPayload(SCHEDULE, CURRENCIES, 'EUR', '1.25').price).toBe('12.50');
  });

  it('rejects a positive (income) amount', () => {
    expect(() =>
      prepareWallosSubscriptionPayload({ ...SCHEDULE, priceCents: 1000 }, CURRENCIES, 'EUR'),
    ).toThrow(WallosMappingError);
  });

  it.each([-1, -999, -1234, -100001])(
    'round trips %i base cents through a Wallos price within one cent',
    (cents) => {
      for (const currencyId of ['1', '2', '3']) {
        const payload = prepareWallosSubscriptionPayload(
          { ...SCHEDULE, priceCents: cents, currencyId },
          CURRENCIES,
          'EUR',
        );
        const mapped = mapWallosSubscription({
          ...RAW,
          price: payload.price,
          currency_id: Number(currencyId),
        });
        const back = prepareActualScheduleInput(mapped, CURRENCIES, 'EUR');
        expect(back.amountCents).toBeLessThan(0);
        expect(Math.abs(back.amountCents - cents)).toBeLessThanOrEqual(1);
      }
    },
  );
});

describe('zero-decimal currencies (JPY)', () => {
  const WITH_JPY: WallosCurrency[] = [
    { id: 1, code: 'EUR', name: 'Euro', rate: '1.0000' },
    { id: 4, code: 'JPY', name: 'Yen', rate: '160.0000' },
  ];
  const map = buildCurrencyMap(WITH_JPY);
  const jpyRaw: WallosSubscription = { ...RAW, price: '1250', currency_id: 4 };

  it('keeps a JPY amount unchanged from Wallos to a JPY Actual budget', () => {
    const out = prepareActualScheduleInput(mapWallosSubscription(jpyRaw, map), WITH_JPY, 'JPY');
    expect(out.amountCents).toBe(-1250);
  });

  it('keeps a JPY amount unchanged from a JPY Actual budget to Wallos', () => {
    const payload = prepareWallosSubscriptionPayload(
      { ...SCHEDULE, priceCents: -1250, currencyId: '4' },
      WITH_JPY,
      'JPY',
    );
    expect(payload.price).toBe('1250');
    const back = mapWallosSubscription({ ...RAW, price: payload.price, currency_id: 4 }, map);
    expect(prepareActualScheduleInput(back, WITH_JPY, 'JPY').amountCents).toBe(-1250);
  });

  it('converts JPY into EUR cents and EUR cents into JPY', () => {
    // 1250 yen / 160 = EUR 7.81.
    expect(prepareActualScheduleInput(mapWallosSubscription(jpyRaw, map), WITH_JPY, 'EUR').amountCents).toBe(-781);
    // EUR 10.00 * 160 = 1600 yen, written with no decimals.
    const payload = prepareWallosSubscriptionPayload(
      { ...SCHEDULE, priceCents: -1000, currencyId: '4' },
      WITH_JPY,
      'EUR',
    );
    expect(payload.price).toBe('1600');
  });

  it('still converts a EUR amount to cents as before', () => {
    const eur = mapWallosSubscription({ ...RAW, price: '12.50', currency_id: 1 }, map);
    expect(eur.priceCents).toBe(-1250);
    expect(prepareActualScheduleInput(eur, WITH_JPY, 'EUR').amountCents).toBe(-1250);
    expect(
      prepareWallosSubscriptionPayload({ ...SCHEDULE, priceCents: -1250, currencyId: '1' }, WITH_JPY, 'EUR').price,
    ).toBe('12.50');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUser } from '../db/accounts.js';
import { createUserRepo } from '../db/repo.js';
import type { ActualApi } from './actual/session.js';
import type { CreateScheduleInput } from './actual/write.js';
import {
  createActualScheduleFromWallos,
  createWallosSubscriptionFromActualSchedule,
  CreateFlowError,
  readWallosChoices,
  prefillActualScheduleFromWallos,
  prefillWallosSubscriptionFromSchedule,
  type CreateDeps,
} from './create.js';
import { prepareWallosSubscriptionPayload } from './prepare.js';
import type { WallosClient } from './wallos/client.js';
import type { WallosCurrency, WallosSubscription } from './wallos/types.js';

const CURRENCIES: WallosCurrency[] = [
  { id: 1, code: 'EUR', rate: '1.0000' },
  { id: 2, code: 'USD', rate: '1.1000' },
];

const SUB: WallosSubscription = {
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

let db: AppDatabase;
let userId: string;
let wallos: {
  listSubscriptions: ReturnType<typeof vi.fn>;
  listPaymentMethods: ReturnType<typeof vi.fn>;
  listCategories: ReturnType<typeof vi.fn>;
  listCurrencies: ReturnType<typeof vi.fn>;
  createSubscription: ReturnType<typeof vi.fn>;
};
let created: CreateScheduleInput[];
let apiState: { baseCurrency: string | undefined; schedules: unknown[] };

beforeEach(() => {
  db = openDatabase(':memory:');
  userId = createUser(db, { email: 'a@example.test', passwordHash: null }).id;
  created = [];
  apiState = { baseCurrency: 'EUR', schedules: [] };
  wallos = {
    listSubscriptions: vi.fn(async () => [SUB]),
    listPaymentMethods: vi.fn(async () => []),
    listCategories: vi.fn(async () => []),
    listCurrencies: vi.fn(async () => CURRENCIES),
    createSubscription: vi.fn(async () => '99'),
  };
});

afterEach(() => {
  closeDatabase(db);
});

function deps(): CreateDeps {
  const api = {
    getPreferences: async () => ({ defaultCurrencyCode: apiState.baseCurrency }),
    getSchedules: async () => apiState.schedules,
    getAccounts: async () => [{ id: 'acc-1', name: 'Main' }],
    getPayees: async () => [{ id: 'p1', name: 'Payee' }],
    getCategories: async () => [{ id: 'cat-1', name: 'Cat' }],
  } as unknown as ActualApi;
  return {
    wallos: wallos as unknown as WallosClient,
    repoFor: (id) => createUserRepo(db, id),
    withActual: (_id, use) => use(api),
    createSchedule: async (_id, input) => {
      created.push(input);
      return { scheduleId: 's1', payeeId: 'p1', payeeCreated: false, categoryApplied: false };
    },
  };
}

const REQ = {
  wallosSubscriptionId: '7',
  accountId: 'acc-1',
  payee: { kind: 'existing', id: 'p1' } as const,
};

describe('createActualScheduleFromWallos', () => {
  it('converts to base cents (negative integer) and fetches the currency list once', async () => {
    const result = await createActualScheduleFromWallos(deps(), userId, REQ);
    expect(result.scheduleId).toBe('s1');
    expect(wallos.listCurrencies).toHaveBeenCalledTimes(1);
    expect(wallos.listSubscriptions).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    // 11.00 USD at 1.1 -> 10.00 EUR expense.
    expect(created[0]?.amountCents).toBe(-1000);
    expect(Number.isInteger(created[0]?.amountCents)).toBe(true);
    expect(created[0]?.accountId).toBe('acc-1');
    expect(created[0]?.startDate).toBe('2026-01-03');
    expect(created[0]?.categoryId).toBeUndefined();
  });

  it('passes the category through', async () => {
    await createActualScheduleFromWallos(deps(), userId, { ...REQ, categoryId: 'cat-1' });
    expect(created[0]?.categoryId).toBe('cat-1');
  });

  it('the manual override wins over the Wallos rate', async () => {
    createUserRepo(db, userId).upsertSubscriptionOverride('7', { rate: '2.2', now: new Date() });
    await createActualScheduleFromWallos(deps(), userId, REQ);
    expect(created[0]?.amountCents).toBe(-500);
  });

  it('rejects a missing base currency', async () => {
    apiState.baseCurrency = undefined;
    await expect(createActualScheduleFromWallos(deps(), userId, REQ)).rejects.toMatchObject({
      code: 'base_currency_missing',
    });
    expect(created).toHaveLength(0);
  });

  it('rejects an unknown subscription id', async () => {
    await expect(
      createActualScheduleFromWallos(deps(), userId, { ...REQ, wallosSubscriptionId: '8' }),
    ).rejects.toBeInstanceOf(CreateFlowError);
    expect(created).toHaveLength(0);
  });
});

describe('createActualScheduleFromWallos edited fields and owned ids (#135)', () => {
  const OWN = { ...REQ, payee: { kind: 'existing', id: 'p1' } as const, categoryId: 'cat-1' };

  it('omitted fields create exactly the prefill values', async () => {
    const prefill = await prefillActualScheduleFromWallos(deps(), userId, { wallosSubscriptionId: '7' });
    await createActualScheduleFromWallos(deps(), userId, REQ);
    expect(created[0]).toEqual({
      name: prefill.name,
      amountCents: prefill.amountCents,
      recurrence: prefill.recurrence,
      startDate: prefill.startDate,
      payee: REQ.payee,
      accountId: 'acc-1',
    });
  });

  it('applies the edited name, amount (base currency minor units, negative) and start date', async () => {
    await createActualScheduleFromWallos(deps(), userId, { ...REQ, name: 'Films', amount: '9.9', startDate: '2026-03-04' });
    expect(created[0]).toMatchObject({ name: 'Films', amountCents: -990, startDate: '2026-03-04' });
    // The frequency is never overridden.
    expect(created[0]?.recurrence).toEqual({ frequency: 'monthly', interval: 1 });
  });

  it('the edited amount is not converted again: it is already in the base currency', async () => {
    // The subscription is in USD at 1.1; an edited 11.00 stays 11.00 EUR.
    await createActualScheduleFromWallos(deps(), userId, { ...REQ, amount: '11' });
    expect(created[0]?.amountCents).toBe(-1100);
  });

  it('uses the base currency exponent: JPY has no decimals, and a decimal JPY amount is refused', async () => {
    apiState.baseCurrency = 'JPY';
    wallos.listCurrencies.mockResolvedValue([...CURRENCIES, { id: 3, code: 'JPY', rate: '160' }]);
    await createActualScheduleFromWallos(deps(), userId, { ...REQ, amount: '1250' });
    expect(created[0]?.amountCents).toBe(-1250);
    await expect(createActualScheduleFromWallos(deps(), userId, { ...REQ, amount: '12.5' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(created).toHaveLength(1);
  });

  it('refuses an amount with more decimals than the base currency has, with no Actual write', async () => {
    await expect(createActualScheduleFromWallos(deps(), userId, { ...REQ, amount: '9.999' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(created).toHaveLength(0);
  });

  it('accepts an account, existing payee and category from the caller own lists', async () => {
    await createActualScheduleFromWallos(deps(), userId, OWN);
    expect(created[0]).toMatchObject({ accountId: 'acc-1', payee: { kind: 'existing', id: 'p1' }, categoryId: 'cat-1' });
  });

  it.each([
    ['invalid_account', { accountId: 'acc-other' }],
    ['invalid_payee', { payee: { kind: 'existing', id: 'p-other' } as const }],
    ['invalid_category', { categoryId: 'cat-other' }],
  ])('refuses %s for an id not in the caller lists, with no Actual write', async (code, change) => {
    await expect(createActualScheduleFromWallos(deps(), userId, { ...OWN, ...change })).rejects.toMatchObject({ code });
    expect(created).toHaveLength(0);
  });

  it('a new payee is not checked against the payee list', async () => {
    await createActualScheduleFromWallos(deps(), userId, { ...REQ, payee: { kind: 'new', name: 'Fresh' } });
    expect(created[0]?.payee).toEqual({ kind: 'new', name: 'Fresh' });
  });
});

describe('createWallosSubscriptionFromActualSchedule', () => {
  function schedule(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'sch-1',
      name: 'Spotify',
      amount: -1250,
      amountOp: 'is',
      date: { frequency: 'monthly', interval: 2, start: '2026-02-01' },
      next_date: '2026-12-01',
      ...over,
    };
  }

  it('posts the payload with the base currency id, positive price and mapped cycle', async () => {
    apiState.schedules = [schedule()];
    const out = await createWallosSubscriptionFromActualSchedule(deps(), userId, {
      scheduleId: 'sch-1',
    });
    expect(out).toEqual({ wallosSubscriptionId: '99' });
    expect(wallos.listCurrencies).toHaveBeenCalledTimes(1);
    expect(wallos.createSubscription).toHaveBeenCalledWith(userId, {
      name: 'Spotify',
      price: '12.50',
      currency_id: '1',
      cycle: '3',
      frequency: '2',
      next_payment: '2026-12-01',
      start_date: '2026-02-01',
    });
  });

  describe('edited title, price, billing cycle and start date (#133)', () => {
    beforeEach(() => {
      apiState.schedules = [schedule()];
    });
    const sent = (): Record<string, unknown> => wallos.createSubscription.mock.calls[0]?.[1] as Record<string, unknown>;

    it('omitted fields send exactly the prefill payload', async () => {
      const prefill = await prefillWallosSubscriptionFromSchedule(deps(), userId, { scheduleId: 'sch-1' });
      await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1' });
      expect(sent()).toMatchObject({
        name: prefill.name,
        price: prefill.price,
        cycle: String(prefill.cycle),
        frequency: String(prefill.frequency),
        start_date: prefill.startDate,
        next_payment: prefill.nextPayment,
      });
      expect(Object.keys(sent()).sort()).toEqual(['currency_id', 'cycle', 'frequency', 'name', 'next_payment', 'price', 'start_date']);
    });

    it('maps the title, price (EUR minor units), cycle and start date onto the Wallos fields', async () => {
      await createWallosSubscriptionFromActualSchedule(deps(), userId, {
        scheduleId: 'sch-1',
        title: 'Music',
        price: '9.9',
        billingCycle: 'yearly',
        startDate: '2026-03-04',
      });
      expect(sent()).toEqual({
        name: 'Music',
        price: '9.90',
        currency_id: '1',
        cycle: '4',
        frequency: '2',
        next_payment: '2026-12-01',
        start_date: '2026-03-04',
      });
    });

    it.each([
      ['monthly', '3'],
      ['yearly', '4'],
      ['weekly', '2'],
      ['custom_days', '1'],
    ] as const)('billing cycle %s writes Wallos cycle %s and keeps the count', async (billingCycle, cycle) => {
      await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', billingCycle });
      expect(sent()).toMatchObject({ cycle, frequency: '2' });
    });

    it('uses the budget currency exponent: JPY has no decimals', async () => {
      apiState.baseCurrency = 'JPY';
      wallos.listCurrencies.mockResolvedValue([{ id: 3, code: 'JPY', rate: '160' }]);
      apiState.schedules = [schedule({ amount: -500 })];
      await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', price: '1250' });
      expect(sent()).toMatchObject({ currency_id: '3', price: '1250' });
    });

    it('refuses a price with more decimals than the currency has, with no Wallos write', async () => {
      await expect(
        createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', price: '9.999' }),
      ).rejects.toMatchObject({ code: 'invalid_request' });
      expect(wallos.createSubscription).not.toHaveBeenCalled();
    });

    it('moves the first payment to an edited start date that is later than it', async () => {
      await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', startDate: '2027-01-15' });
      expect(sent()).toMatchObject({ start_date: '2027-01-15', next_payment: '2027-01-15' });
    });

    it('the preview is unchanged by the overrides', async () => {
      const before = await prefillWallosSubscriptionFromSchedule(deps(), userId, { scheduleId: 'sch-1' });
      await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', title: 'Other', price: '1' });
      expect(await prefillWallosSubscriptionFromSchedule(deps(), userId, { scheduleId: 'sch-1' })).toEqual(before);
    });
  });

  describe('chosen payment method and category', () => {
    const OWN_METHODS = [{ id: '3', name: 'Card' }];
    const OWN_CATEGORIES = [{ id: '5', name: 'Streaming' }];
    beforeEach(() => {
      apiState.schedules = [schedule()];
      wallos.listPaymentMethods.mockResolvedValue(OWN_METHODS);
      wallos.listCategories.mockResolvedValue(OWN_CATEGORIES);
    });

    it('sends the chosen ids on the add payload when both are in the caller lists', async () => {
      await createWallosSubscriptionFromActualSchedule(deps(), userId, {
        scheduleId: 'sch-1',
        paymentMethodId: '3',
        categoryId: '5',
      });
      expect(wallos.listPaymentMethods).toHaveBeenCalledWith(userId);
      expect(wallos.listCategories).toHaveBeenCalledWith(userId);
      expect(wallos.createSubscription).toHaveBeenCalledTimes(1);
      expect(wallos.createSubscription.mock.calls[0]?.[1]).toMatchObject({
        payment_method_id: '3',
        category_id: '5',
      });
    });

    it('refuses a payment method id absent from the caller list and makes no Wallos write', async () => {
      await expect(
        createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', paymentMethodId: '99' }),
      ).rejects.toMatchObject({ code: 'invalid_payment_method' });
      expect(wallos.createSubscription).toHaveBeenCalledTimes(0);
    });

    it('refuses a category id that belongs only to another user and makes no Wallos write', async () => {
      // The fake answers per user: another account owns category 8, the caller does not.
      wallos.listCategories = vi.fn(async (id: string) =>
        id === userId ? OWN_CATEGORIES : [{ id: '8', name: 'Other' }],
      );
      await expect(
        createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', categoryId: '8' }),
      ).rejects.toMatchObject({ code: 'invalid_category' });
      expect(wallos.createSubscription).toHaveBeenCalledTimes(0);
    });

    it('refuses a disabled payment method id because the client list does not contain it', async () => {
      // listPaymentMethods drops enabled: 0 rows, so a disabled id (4) is simply not listed.
      await expect(
        createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', paymentMethodId: '4' }),
      ).rejects.toMatchObject({ code: 'invalid_payment_method' });
      expect(wallos.createSubscription).toHaveBeenCalledTimes(0);
    });

    it('refuses without a write when one id is valid and the other is foreign', async () => {
      await expect(
        createWallosSubscriptionFromActualSchedule(deps(), userId, {
          scheduleId: 'sch-1',
          paymentMethodId: '3',
          categoryId: '77',
        }),
      ).rejects.toMatchObject({ code: 'invalid_category' });
      expect(wallos.createSubscription).toHaveBeenCalledTimes(0);
    });

    it('does not read either list when no ids are sent, and the payload is unchanged', async () => {
      await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1' });
      expect(wallos.listPaymentMethods).not.toHaveBeenCalled();
      expect(wallos.listCategories).not.toHaveBeenCalled();
      const sent = wallos.createSubscription.mock.calls[0]?.[1] as Record<string, string>;
      expect(Object.keys(sent)).not.toContain('payment_method_id');
      expect(Object.keys(sent)).not.toContain('category_id');
    });

    it('reads only the list for the id that was sent', async () => {
      await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', categoryId: '5' });
      expect(wallos.listPaymentMethods).not.toHaveBeenCalled();
      expect(wallos.listCategories).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects a range schedule', async () => {
    apiState.schedules = [schedule({ amountOp: 'isbetween', amount: { num1: -100, num2: -200 } })];
    await expect(
      createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1' }),
    ).rejects.toMatchObject({ code: 'range_amount_unsupported' });
    expect(wallos.createSubscription).not.toHaveBeenCalled();
  });

  it('rejects a missing base currency', async () => {
    apiState.schedules = [schedule()];
    apiState.baseCurrency = undefined;
    await expect(
      createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1' }),
    ).rejects.toMatchObject({ code: 'base_currency_missing' });
  });

  it('rejects an unknown schedule', async () => {
    await expect(
      createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'nope' }),
    ).rejects.toMatchObject({ code: 'schedule_not_found' });
  });

  it('keeps the expense sign on the way out: a positive amount is refused by the builder', async () => {
    apiState.schedules = [schedule({ amount: 1250 })];
    await expect(
      createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1' }),
    ).rejects.toMatchObject({ name: 'WallosMappingError' });
  });
});

describe('pre-fill previews', () => {
  it('actual schedule preview equals what the submit would create, and writes nothing', async () => {
    const preview = await prefillActualScheduleFromWallos(deps(), userId, { wallosSubscriptionId: '7' });
    expect(created).toHaveLength(0);
    await createActualScheduleFromWallos(deps(), userId, REQ);
    expect(created[0]).toMatchObject({
      name: preview.name,
      amountCents: preview.amountCents,
      recurrence: preview.recurrence,
      startDate: preview.startDate,
    });
    expect(preview).toMatchObject({ amountCents: -1000, baseCurrency: 'EUR', startDate: '2026-01-03' });
    expect(preview.accounts).toEqual([{ id: 'acc-1', name: 'Main' }]);
    expect(preview.payees).toEqual([{ id: 'p1', name: 'Payee' }]);
    expect(preview.categories).toEqual([{ id: 'cat-1', name: 'Cat' }]);
  });

  it('actual schedule preview honours the override and rejects unknown ids and missing base', async () => {
    createUserRepo(db, userId).upsertSubscriptionOverride('7', { rate: '2.2', now: new Date() });
    const withOverride = await prefillActualScheduleFromWallos(deps(), userId, { wallosSubscriptionId: '7' });
    expect(withOverride.amountCents).toBe(-500);
    expect(withOverride.overrideRate).toBe('2.2');
    expect(withOverride.sourceCurrency).toEqual(expect.any(String));
    expect(withOverride.wallosRate === null || typeof withOverride.wallosRate === 'string').toBe(true);
    await expect(
      prefillActualScheduleFromWallos(deps(), userId, { wallosSubscriptionId: '9' }),
    ).rejects.toMatchObject({ code: 'wallos_subscription_not_found' });
    apiState.baseCurrency = undefined;
    await expect(
      prefillActualScheduleFromWallos(deps(), userId, { wallosSubscriptionId: '7' }),
    ).rejects.toMatchObject({ code: 'base_currency_missing' });
    expect(created).toHaveLength(0);
  });

  it('wallos preview equals the submit payload and does not call createSubscription', async () => {
    apiState.schedules = [
      { id: 'sch-1', name: 'Spotify', amount: -1250, amountOp: 'is', date: { frequency: 'monthly', interval: 2, start: '2026-02-01' }, next_date: '2026-12-01' },
    ];
    const preview = await prefillWallosSubscriptionFromSchedule(deps(), userId, { scheduleId: 'sch-1' });
    expect(wallos.createSubscription).not.toHaveBeenCalled();
    expect(preview).toEqual({
      name: 'Spotify',
      price: '12.50',
      currencyCode: 'EUR',
      cycle: 3,
      frequency: 2,
      startDate: '2026-02-01',
      nextPayment: '2026-12-01',
      paymentMethods: [],
      categories: [],
    });
    await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1' });
    const sent = wallos.createSubscription.mock.calls[0]?.[1] as Record<string, string>;
    expect(sent).toMatchObject({ name: preview.name, price: preview.price, next_payment: preview.nextPayment });
  });

  it('wallos preview returns the caller lists as id strings and names', async () => {
    apiState.schedules = [
      { id: 'sch-1', name: 'S', amount: -100, amountOp: 'is', date: { frequency: 'monthly', start: '2026-02-01' } },
    ];
    wallos.listPaymentMethods.mockResolvedValue([{ id: '3', name: 'Card' }]);
    wallos.listCategories.mockResolvedValue([{ id: '5', name: 'Streaming' }]);
    const preview = await prefillWallosSubscriptionFromSchedule(deps(), userId, { scheduleId: 'sch-1' });
    expect(preview.paymentMethods).toEqual([{ id: '3', name: 'Card' }]);
    expect(preview.categories).toEqual([{ id: '5', name: 'Streaming' }]);
  });

  it('wallos preview hides only the field whose list read failed and still succeeds', async () => {
    apiState.schedules = [
      { id: 'sch-1', name: 'S', amount: -100, amountOp: 'is', date: { frequency: 'monthly', start: '2026-02-01' } },
    ];
    wallos.listPaymentMethods.mockRejectedValue(new Error('down'));
    wallos.listCategories.mockResolvedValue([{ id: '5', name: 'Streaming' }]);
    const preview = await prefillWallosSubscriptionFromSchedule(deps(), userId, { scheduleId: 'sch-1' });
    expect(preview.paymentMethods).toEqual([]);
    expect(preview.categories).toEqual([{ id: '5', name: 'Streaming' }]);
    expect(wallos.createSubscription).not.toHaveBeenCalled();
  });

  it('no payment methods and only the default category id 1 give empty prefill lists, whatever its name', async () => {
    wallos.listPaymentMethods.mockResolvedValue([]);
    wallos.listCategories.mockResolvedValue([{ id: '1', name: 'Geen categorie' }]);
    await expect(readWallosChoices(deps(), userId)).resolves.toEqual({ paymentMethods: [], categories: [] });
  });

  it('payment methods present keep both lists even when the only category is id 1', async () => {
    wallos.listPaymentMethods.mockResolvedValue([{ id: '3', name: 'Card' }]);
    wallos.listCategories.mockResolvedValue([{ id: '1', name: 'No category' }]);
    await expect(readWallosChoices(deps(), userId)).resolves.toEqual({
      paymentMethods: [{ id: '3', name: 'Card' }],
      categories: [{ id: '1', name: 'No category' }],
    });
  });

  it('any category besides id 1 keeps the category list when payment methods are empty', async () => {
    wallos.listPaymentMethods.mockResolvedValue([]);
    wallos.listCategories.mockResolvedValue([
      { id: '1', name: 'No category' },
      { id: '5', name: 'Streaming' },
    ]);
    await expect(readWallosChoices(deps(), userId)).resolves.toEqual({
      paymentMethods: [],
      categories: [
        { id: '1', name: 'No category' },
        { id: '5', name: 'Streaming' },
      ],
    });
  });

  it('a failed payment method read does not hide the lone default category', async () => {
    wallos.listPaymentMethods.mockRejectedValue(new Error('down'));
    wallos.listCategories.mockResolvedValue([{ id: '1', name: 'No category' }]);
    await expect(readWallosChoices(deps(), userId)).resolves.toEqual({
      paymentMethods: [],
      categories: [{ id: '1', name: 'No category' }],
    });
  });

  it('an explicit category id 1 is still accepted when the prefill hid it', async () => {
    apiState.schedules = [
      { id: 'sch-1', name: 'S', amount: -100, amountOp: 'is', date: { frequency: 'monthly', start: '2026-02-01' } },
    ];
    wallos.listPaymentMethods.mockResolvedValue([]);
    wallos.listCategories.mockResolvedValue([{ id: '1', name: 'No category' }]);
    await expect(
      createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1', categoryId: '1' }),
    ).resolves.toEqual({ wallosSubscriptionId: '99' });
  });

  it('both list reads failing give empty choices and the create still proceeds with no ids', async () => {
    apiState.schedules = [
      { id: 'sch-1', name: 'S', amount: -100, amountOp: 'is', date: { frequency: 'monthly', start: '2026-02-01' } },
    ];
    wallos.listPaymentMethods.mockRejectedValue(new Error('down'));
    wallos.listCategories.mockRejectedValue(new Error('timeout'));
    await expect(readWallosChoices(deps(), userId)).resolves.toEqual({ paymentMethods: [], categories: [] });
    const out = await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1' });
    expect(out).toEqual({ wallosSubscriptionId: '99' });
    expect(wallos.createSubscription).toHaveBeenCalledTimes(1);
  });

  it('wallos preview rejects a range schedule and an unknown schedule', async () => {
    apiState.schedules = [
      { id: 'r', name: 'R', amount: { num1: -1, num2: -2 }, amountOp: 'isbetween', date: { frequency: 'monthly', start: '2026-01-01' } },
    ];
    await expect(
      prefillWallosSubscriptionFromSchedule(deps(), userId, { scheduleId: 'r' }),
    ).rejects.toMatchObject({ code: 'range_amount_unsupported' });
    await expect(
      prefillWallosSubscriptionFromSchedule(deps(), userId, { scheduleId: 'zz' }),
    ).rejects.toMatchObject({ code: 'schedule_not_found' });
    expect(wallos.createSubscription).not.toHaveBeenCalled();
  });
});

describe('round trip', () => {
  it('a Wallos price survives Wallos -> Actual -> Wallos within 1 cent', async () => {
    // Forward: 12.34 EUR subscription becomes a schedule amount, which is then posted back.
    wallos.listSubscriptions.mockResolvedValue([{ ...SUB, price: '12.34', currency_id: 1 }]);
    await createActualScheduleFromWallos(deps(), userId, REQ);
    const cents = created[0]?.amountCents ?? 0;
    expect(cents).toBe(-1234);
    apiState.schedules = [
      { id: 's', name: 'N', amount: cents, amountOp: 'is', date: { frequency: 'monthly', start: '2026-01-03' } },
    ];
    await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 's' });
    const payload = wallos.createSubscription.mock.calls[0]?.[1] as { price: string };
    expect(Math.abs(Number(payload.price) - 12.34)).toBeLessThanOrEqual(0.01);
  });

  it('a USD price converted to base and back to USD stays within 1 cent of the base value', () => {
    const payload = prepareWallosSubscriptionPayload(
      {
        name: 'N',
        priceCents: -1000,
        currencyId: '2',
        recurrence: { frequency: 'monthly' },
        startDate: null,
        nextPaymentDate: '2026-01-01',
      },
      CURRENCIES,
      'EUR',
    );
    expect(Math.abs(Number(payload.price) - 11)).toBeLessThanOrEqual(0.01);
  });
});

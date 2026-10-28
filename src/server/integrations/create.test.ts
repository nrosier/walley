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
    });
    await createWallosSubscriptionFromActualSchedule(deps(), userId, { scheduleId: 'sch-1' });
    const sent = wallos.createSubscription.mock.calls[0]?.[1] as Record<string, string>;
    expect(sent).toMatchObject({ name: preview.name, price: preview.price, next_payment: preview.nextPayment });
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

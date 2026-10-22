import { describe, expect, it, vi } from 'vitest';
import type { ActualApi } from './session.js';
import {
  listBudgets,
  readAccounts,
  readBaseCurrency,
  readCategories,
  readPayees,
  readSchedules,
} from './read.js';

/*
 * The library is replaced by a fake that answers the five read methods from fixtures. Each fixture
 * mirrors the shape the real API returns (APIScheduleEntity, APIAccountEntity, and so on).
 */

const scheduleFixture = [
  {
    id: 'sched-netflix',
    name: 'Netflix',
    rule: 'rule-1',
    next_date: '2026-11-03',
    completed: false,
    posts_transaction: false,
    payee: 'payee-netflix',
    account: 'acc-checking',
    amount: -1250,
    amountOp: 'is',
    date: { frequency: 'monthly', start: '2026-01-03', patterns: [] },
  },
];

const accountFixture = [
  {
    id: 'acc-checking',
    name: 'Checking',
    offbudget: false,
    closed: false,
    balance_current: 152375,
    account_group_id: null,
  },
  {
    id: 'acc-savings',
    name: 'Savings',
    offbudget: true,
    closed: true,
    balance_current: null,
    account_group_id: 'group-1',
  },
];

const payeeFixture = [
  { id: 'payee-netflix', name: 'Netflix', transfer_acct: null },
  { id: 'payee-transfer', name: 'Transfer to Savings', transfer_acct: 'acc-savings' },
];

const categoryFixture = [
  { id: 'cat-streaming', name: 'Streaming', is_income: false, hidden: false, group_id: 'group-bills' },
  { id: 'cat-hidden', name: 'Old', is_income: false, hidden: true, group_id: 'group-bills' },
];

function fakeApi(overrides: Partial<Record<keyof ActualApi, unknown>> = {}) {
  const fns = {
    getSchedules: vi.fn(async () => scheduleFixture),
    getAccounts: vi.fn(async () => accountFixture),
    getPayees: vi.fn(async () => payeeFixture),
    getCategories: vi.fn(async () => categoryFixture),
    getPreferences: vi.fn(async () => ({ defaultCurrencyCode: 'EUR' })),
    ...overrides,
  };
  return { api: fns as unknown as ActualApi, fns };
}

describe('readSchedules', () => {
  it('returns the schedules from getSchedules', async () => {
    const { api, fns } = fakeApi();
    const result = await readSchedules(api);
    expect(fns.getSchedules).toHaveBeenCalledOnce();
    expect(result).toEqual(scheduleFixture);
    expect(result[0]?.name).toBe('Netflix');
    expect(result[0]?.payee).toBe('payee-netflix');
  });

  it('keeps the schedule amount as integer cents', async () => {
    const { api } = fakeApi();
    const [schedule] = await readSchedules(api);
    expect(schedule?.amount).toBe(-1250);
    expect(Number.isInteger(schedule?.amount)).toBe(true);
  });
});

describe('readAccounts', () => {
  it('returns the accounts from getAccounts', async () => {
    const { api, fns } = fakeApi();
    const result = await readAccounts(api);
    expect(fns.getAccounts).toHaveBeenCalledOnce();
    expect(result).toEqual(accountFixture);
    expect(result.map((a) => a.name)).toEqual(['Checking', 'Savings']);
  });

  it('keeps the account balance as integer cents and passes null through', async () => {
    const { api } = fakeApi();
    const [checking, savings] = await readAccounts(api);
    expect(checking?.balance_current).toBe(152375);
    expect(Number.isInteger(checking?.balance_current)).toBe(true);
    expect(savings?.balance_current).toBeNull();
  });
});

describe('readPayees', () => {
  it('returns the payees from getPayees, including transfer accounts', async () => {
    const { api, fns } = fakeApi();
    const result = await readPayees(api);
    expect(fns.getPayees).toHaveBeenCalledOnce();
    expect(result).toEqual(payeeFixture);
    expect(result[1]?.transfer_acct).toBe('acc-savings');
  });
});

describe('readCategories', () => {
  it('returns the categories from getCategories with no filter', async () => {
    const { api, fns } = fakeApi();
    const result = await readCategories(api);
    expect(fns.getCategories).toHaveBeenCalledWith();
    expect(result).toEqual(categoryFixture);
    expect(result[0]?.group_id).toBe('group-bills');
  });
});

describe('readBaseCurrency', () => {
  it('returns defaultCurrencyCode from getPreferences', async () => {
    const { api, fns } = fakeApi();
    await expect(readBaseCurrency(api)).resolves.toBe('EUR');
    expect(fns.getPreferences).toHaveBeenCalledOnce();
  });

  it('returns null when the budget has no default currency set', async () => {
    const { api } = fakeApi({ getPreferences: vi.fn(async () => ({})) });
    await expect(readBaseCurrency(api)).resolves.toBeNull();
  });

  it('returns null for an empty currency code', async () => {
    const { api } = fakeApi({ getPreferences: vi.fn(async () => ({ defaultCurrencyCode: '' })) });
    await expect(readBaseCurrency(api)).resolves.toBeNull();
  });
});

describe('listBudgets', () => {
  it('maps to { id: groupId, name }, drops entries without a groupId and duplicates', async () => {
    const getBudgets = vi.fn().mockResolvedValue([
      { id: 'local-1', groupId: 'g-1', name: 'Home', owner: 'o', encryptKeyId: 'k' },
      { cloudFileId: 'cf-1', groupId: 'g-1', name: 'Home', state: 'remote' },
      { cloudFileId: 'cf-2', groupId: 'g-2', name: 'Work', state: 'remote' },
      { id: 'local-only', name: 'Unsynced' },
      { cloudFileId: 'cf-3', groupId: '', name: 'Blank' },
      null,
    ]);
    const result = await listBudgets({ getBudgets } as unknown as ActualApi);
    expect(result).toEqual([
      { id: 'g-1', name: 'Home' },
      { id: 'g-2', name: 'Work' },
    ]);
    expect(getBudgets).toHaveBeenCalledTimes(1);
  });
});

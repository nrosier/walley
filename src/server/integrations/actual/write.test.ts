import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const createdSchedules: unknown[] = [];
const createdPayees: unknown[] = [];
const createdRules: unknown[] = [];
let failSchedule = false;
let failRule = false;
let failSync = false;

vi.mock('@actual-app/api', () => ({
  init: vi.fn(async () => {
    calls.push('init');
  }),
  downloadBudget: vi.fn(async () => {
    calls.push('download');
  }),
  createPayee: vi.fn(async (payee: unknown) => {
    createdPayees.push(payee);
    return 'payee-new';
  }),
  createSchedule: vi.fn(async (schedule: unknown) => {
    if (failSchedule) {
      throw new Error('library boom');
    }
    createdSchedules.push(schedule);
    return 'sched-1';
  }),
  createRule: vi.fn(async (rule: unknown) => {
    if (failRule) {
      throw new Error('rule boom');
    }
    createdRules.push(rule);
    return { id: 'rule-1' };
  }),
  sync: vi.fn(async () => {
    calls.push('sync');
    if (failSync) {
      throw new Error('sync boom pw-secret-value');
    }
  }),
  shutdown: vi.fn(async () => {
    calls.push('shutdown');
  }),
}));

import { encryptSecret } from '../../crypto/secrets.js';
import { deriveUserKey } from '../../crypto/keys.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../../db/client.js';
import { createUserRepo } from '../../db/repo.js';
import { createUser } from '../../db/accounts.js';
import { convertPriceCents, selectRate } from '../../../lib/currency-convert.js';
import { toActualCents } from '../../../lib/money.js';
import { wallosToActual } from '../../../lib/frequency-mapper.js';
import { ActualWriteError, buildSchedulePayload, createActualSchedule, type CreateScheduleInput } from './write.js';

const APP_SECRET = 'a'.repeat(40);
let db: AppDatabase;
let dataDir: string;
let userId: string;

beforeEach(() => {
  calls.length = 0;
  createdSchedules.length = 0;
  createdPayees.length = 0;
  failSchedule = false;
  failRule = false;
  failSync = false;
  createdRules.length = 0;
  db = openDatabase(':memory:');
  dataDir = mkdtempSync(join(tmpdir(), 'walley-write-'));
  userId = createUser(db, { email: 'w@example.com', passwordHash: null }).id;
  const repo = createUserRepo(db, userId);
  const key = deriveUserKey(APP_SECRET, repo.getKeySalt() ?? Buffer.alloc(0), userId);
  repo.upsertConfig({
    actualUrl: 'https://actual.example.com',
    actualPasswordEnc: encryptSecret('pw-secret-value', key),
    actualBudgetId: 'budget-1',
  });
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dataDir, { recursive: true, force: true });
});

const deps = () => ({ db, appSecret: APP_SECRET, dataDir });

const base: CreateScheduleInput = {
  name: 'Netflix',
  amountCents: -1250,
  recurrence: { frequency: 'monthly', interval: 1 },
  startDate: '2026-11-03',
  payee: { kind: 'existing', id: 'payee-netflix' },
  accountId: 'acc-1',
  categoryId: 'cat-fun',
};

describe('buildSchedulePayload', () => {
  it('is pure and maps every field', () => {
    const a = buildSchedulePayload(base, 'payee-netflix');
    const b = buildSchedulePayload(base, 'payee-netflix');
    expect(a).toEqual(b);
    expect(a).toEqual({
      name: 'Netflix',
      posts_transaction: false,
      payee: 'payee-netflix',
      account: 'acc-1',
      amount: -1250,
      amountOp: 'is',
      date: { frequency: 'monthly', interval: 1, start: '2026-11-03' },
    });
  });

  it('preserves a negative sign and passes cents through unchanged', () => {
    expect(buildSchedulePayload({ ...base, amountCents: -1 }, 'p').amount).toBe(-1);
    expect(buildSchedulePayload({ ...base, amountCents: 500 }, 'p').amount).toBe(500);
  });

  it('requires an account and rejects bad input', () => {
    expect(buildSchedulePayload({ ...base, accountId: 'acc' }, 'p').account).toBe('acc');
    expect(() => buildSchedulePayload({ ...base, accountId: '' }, 'p')).toThrow(ActualWriteError);
    expect(() => buildSchedulePayload({ ...base, accountId: '  ' }, 'p')).toThrow(ActualWriteError);
    const noAccount: Partial<CreateScheduleInput> = { ...base, accountId: undefined };
    expect(() => buildSchedulePayload(noAccount as CreateScheduleInput, 'p')).toThrow(ActualWriteError);
    expect(() => buildSchedulePayload({ ...base, amountCents: 12.5 }, 'p')).toThrow();
    expect(() => buildSchedulePayload({ ...base, startDate: '03/11/2026' }, 'p')).toThrow();
    expect(() => buildSchedulePayload({ ...base, name: ' ' }, 'p')).toThrow();
  });
});

describe('createActualSchedule', () => {
  it('creates a schedule whose amount equals the converted cents', async () => {
    // 10.00 in a currency with rate 0.8 (override wins) converted to the base currency (rate 1).
    const fromRate = selectRate({ override: '0.8', wallosRate: '0.9' });
    const cents = convertPriceCents(toActualCents(10, { expense: true }), fromRate, 1);
    expect(cents).toBe(-1250);
    const recurrence = wallosToActual({ type: 'monthly', every: 1 });
    const result = await createActualSchedule(deps(), userId, {
      ...base,
      amountCents: cents,
      recurrence,
    });
    expect(result).toMatchObject({ scheduleId: 'sched-1', payeeId: 'payee-netflix', payeeCreated: false });
    expect(createdSchedules[0]).toMatchObject({ amount: cents, payee: 'payee-netflix' });
    expect(createdPayees).toHaveLength(0);
    expect(calls).toEqual(['init', 'download', 'sync', 'shutdown']);
  });

  it('creates a new payee by name and uses its id', async () => {
    const result = await createActualSchedule(deps(), userId, {
      ...base,
      payee: { kind: 'new', name: ' Spotify ' },
    });
    expect(createdPayees).toEqual([{ name: 'Spotify' }]);
    expect(result).toMatchObject({ payeeId: 'payee-new', payeeCreated: true, categoryApplied: true });
    expect(createdSchedules[0]).toMatchObject({ payee: 'payee-new' });
  });

  it('still closes the session when the library throws', async () => {
    failSchedule = true;
    await expect(createActualSchedule(deps(), userId, base)).rejects.toThrow('library boom');
    expect(calls).toEqual(['init', 'download', 'shutdown']);
  });

  it('rejects a missing account before any write and still closes the session', async () => {
    const noAccount: Partial<CreateScheduleInput> = { ...base, accountId: undefined };
    await expect(
      createActualSchedule(deps(), userId, noAccount as CreateScheduleInput),
    ).rejects.toThrow(ActualWriteError);
    expect(createdSchedules).toHaveLength(0);
    expect(createdRules).toHaveLength(0);
    expect(calls).toEqual(['init', 'download', 'shutdown']);
  });

  it('creates a standalone category rule with only the payee condition and set-category action', async () => {
    const result = await createActualSchedule(deps(), userId, base);
    expect(result.categoryApplied).toBe(true);
    expect(createdRules).toEqual([
      {
        stage: 'pre',
        conditionsOp: 'and',
        conditions: [{ field: 'payee', op: 'is', value: 'payee-netflix' }],
        actions: [{ field: 'category', op: 'set', value: 'cat-fun' }],
      },
    ]);
    expect(JSON.stringify(createdRules)).not.toContain('link-schedule');
    expect(createdSchedules[0]).toEqual({
      name: 'Netflix',
      posts_transaction: false,
      payee: 'payee-netflix',
      account: 'acc-1',
      amount: -1250,
      amountOp: 'is',
      date: { frequency: 'monthly', interval: 1, start: '2026-11-03' },
    });
  });

  it('uses the newly created payee id in the rule', async () => {
    await createActualSchedule(deps(), userId, { ...base, payee: { kind: 'new', name: 'Spotify' } });
    expect(createdRules[0]).toMatchObject({ conditions: [{ field: 'payee', value: 'payee-new' }] });
  });

  it('creates no rule when no category is given', async () => {
    const noCategory: CreateScheduleInput = { ...base, categoryId: undefined };
    const result = await createActualSchedule(deps(), userId, noCategory);
    expect(result.categoryApplied).toBe(false);
    expect(createdRules).toHaveLength(0);
    expect(createdSchedules).toHaveLength(1);
  });

  it('reports a rule failure instead of throwing and still closes the session', async () => {
    failRule = true;
    const result = await createActualSchedule(
      deps(),
      userId,
      { ...base, payee: { kind: 'new', name: 'Netflix' }, categoryId: 'cat-1' },
    );
    expect(result).toEqual({
      scheduleId: 'sched-1',
      payeeId: 'payee-new',
      payeeCreated: true,
      categoryApplied: false,
      categoryError: true,
    });
    expect(createdSchedules).toHaveLength(1);
    expect(calls).toEqual(['init', 'download', 'sync', 'shutdown']);
  });

  it('surfaces a sync failure as sync_failed and still closes the session', async () => {
    failSync = true;
    const err = await createActualSchedule(deps(), userId, base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActualWriteError);
    expect((err as ActualWriteError).code).toBe('sync_failed');
    expect((err as ActualWriteError).message).not.toContain('pw-secret-value');
    expect(calls).toEqual(['init', 'download', 'sync', 'shutdown']);
  });
});

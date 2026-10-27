import { afterEach, describe, expect, it, vi } from 'vitest';
import { CurrencyConversionError } from '../../lib/currency-convert.js';
import { FrequencyMappingError } from '../../lib/frequency-mapper.js';
import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import { ActualSessionError } from '../integrations/actual/session.js';
import { ActualWriteError } from '../integrations/actual/write.js';
import type { CreateDeps } from '../integrations/create.js';
import { CreateFlowError } from '../integrations/create.js';
import {
  WallosAuthError,
  WallosHttpError,
  WallosRejectedError,
  type WallosClient,
} from '../integrations/wallos/client.js';
import { WallosMappingError } from '../integrations/wallos/map.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';

const SECRETISH = /api[_-]?key|password|secret|https?:\/\/|netflix|spotify|12\.50/i;

const open: { close(): Promise<unknown>; db?: AppDatabase }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    if (a.db) closeDatabase(a.db);
  }
});

/** Two users, each with their own Wallos subscriptions and Actual schedules behind the mocks. */
function setup(overrides: Partial<CreateDeps> = {}, failMatchInsert = false) {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  const owned: Record<string, { subs: number[]; schedules: string[] }> = {};
  const createSchedule = vi.fn(async () => ({
    scheduleId: 's1',
    payeeId: 'p1',
    payeeCreated: true,
    categoryApplied: false,
  }));
  const createSubscription = vi.fn(async (userId: string) => {
    (owned[userId] ??= { subs: [], schedules: [] }).subs.push(55);
    return '55';
  });
  const wallos = {
    listSubscriptions: async (id: string) =>
      (owned[id]?.subs ?? []).map((n) => ({
        id: n,
        name: 'Netflix',
        price: '12.50',
        currency_id: 1,
        cycle: 3,
        frequency: 1,
        next_payment: '2026-11-03',
        inactive: 0,
      })),
    listCurrencies: async () => [{ id: 1, code: 'EUR', rate: '1' }],
    createSubscription,
  } as unknown as WallosClient;
  const deps: CreateDeps = {
    wallos,
    repoFor: (id) => {
      const repo = createUserRepo(t.db, id);
      if (!failMatchInsert) return repo;
      return {
        ...repo,
        insertMatch: () => {
          throw Object.assign(new Error('disk full 12.50 Netflix'), { code: 'SQLITE_FULL' });
        },
      };
    },
    withActual: (id, use) =>
      use({
        getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
        getAccounts: async () => [{ id: `acc-${id}`, name: 'Main' }],
        getPayees: async () => [{ id: `pay-${id}`, name: 'Payee' }],
        getCategories: async () => [{ id: `cat-${id}`, name: 'Cat' }],
        getSchedules: async () =>
          (owned[id]?.schedules ?? []).map((s) => ({
            id: s,
            name: 'Spotify',
            amount: -1250,
            amountOp: 'is',
            date: { frequency: 'monthly', start: '2026-01-01' },
          })),
      } as never),
    createSchedule,
    ...overrides,
  };
  // buildApp is called again with the integrations; reuse the same db and clock.
  const app = buildApp({
    db: t.db,
    integrations: deps,
    auth: {
      mode: 'local',
      secureCookies: false,
      allowRegistration: false,
      publicOrigin: t.publicOrigin,
      now: () => t.clock.now(),
    },
  });
  open.push({ close: () => app.close(), db: t.db });
  void t.app.close();
  const a = makeUser(t.db);
  const b = makeUser(t.db);
  owned[a] = { subs: [7], schedules: ['sch-a'] };
  owned[b] = { subs: [8], schedules: ['sch-b'] };
  const ctx = { db: t.db, clock: t.clock };
  return { app, a, b, sa: signIn(ctx, a), sb: signIn(ctx, b), createSchedule, createSubscription, db: t.db };
}


const SCHED_URL = '/api/integrations/actual-schedules';
const SUB_URL = '/api/integrations/wallos-subscriptions';
const SCHED_PREFILL = '/api/integrations/actual-schedules/prefill';
const SUB_PREFILL = '/api/integrations/wallos-subscriptions/prefill';
const SCHED_BODY = { wallosSubscriptionId: '7', accountId: 'acc', payee: { kind: 'new', name: 'N' } };

describe('auth gate and CSRF', () => {
  it.each([SCHED_URL, SUB_URL])('%s answers 401 without a session', async (url) => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url, payload: {}, headers: { origin: TEST_ORIGIN } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthenticated' });
  });

  it.each([SCHED_URL, SUB_URL])('%s rejects a session POST without the CSRF header', async (url) => {
    const { app, sa, createSchedule, createSubscription } = setup();
    const res = await app.inject({
      method: 'POST',
      url,
      payload: SCHED_BODY,
      headers: { origin: TEST_ORIGIN, cookie: sa.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(createSchedule).not.toHaveBeenCalled();
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('rejects a foreign Origin', async () => {
    const { app, sa, createSchedule } = setup();
    const res = await injectAs(app, sa, {
      method: 'POST',
      url: SCHED_URL,
      payload: SCHED_BODY,
      headers: { origin: 'http://evil.example' },
    });
    expect(res.statusCode).toBe(403);
    expect(createSchedule).not.toHaveBeenCalled();
  });
});

describe('POST /api/integrations/actual-schedules', () => {
  it('201 with ids, flags and the saved match', async () => {
    const { app, sa } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: SCHED_URL, payload: SCHED_BODY });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      scheduleId: 's1',
      payeeId: 'p1',
      payeeCreated: true,
      categoryApplied: false,
      matchId: expect.any(String) as string,
      matchCreated: true,
    });
  });

  it.each([
    {},
    { ...SCHED_BODY, wallosSubscriptionId: 7 },
    { ...SCHED_BODY, accountId: '' },
    { ...SCHED_BODY, payee: { kind: 'new', name: ' ' } },
    { ...SCHED_BODY, payee: { kind: 'other' } },
    { ...SCHED_BODY, categoryId: 5 },
  ])('400 invalid_request for a bad body %#', async (payload) => {
    const { app, sa, createSchedule } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: SCHED_URL, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("user A cannot use user B's subscription id", async () => {
    const { app, sa, createSchedule } = setup();
    const res = await injectAs(app, sa, {
      method: 'POST',
      url: SCHED_URL,
      payload: { ...SCHED_BODY, wallosSubscriptionId: '8' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'wallos_subscription_not_found' });
    expect(createSchedule).not.toHaveBeenCalled();
  });
});

describe('POST /api/integrations/wallos-subscriptions', () => {
  it('201 with the new id only', async () => {
    const { app, sa } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-a' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ wallosSubscriptionId: '55', matchCreated: true });
  });

  it('400 invalid_request for a bad body', async () => {
    const { app, sa } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 3 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it("user A cannot create from user B's schedule", async () => {
    const { app, sa, createSubscription } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-b' } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'schedule_not_found' });
    expect(createSubscription).not.toHaveBeenCalled();
  });
});

describe('pre-fill routes', () => {
  it('actual-schedules/prefill returns the converted preview and the lists, with no write', async () => {
    const { app, sa, a, createSchedule, createSubscription } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: SCHED_PREFILL, payload: { wallosSubscriptionId: '7' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: 'Netflix',
      amountCents: -1250,
      baseCurrency: 'EUR',
      sourceCurrency: 'EUR',
      wallosRate: '1',
      overrideRate: null,
      recurrence: { frequency: 'monthly', interval: 1 },
      startDate: '2026-11-03',
      accounts: [{ id: `acc-${a}`, name: 'Main' }],
      payees: [{ id: `pay-${a}`, name: 'Payee' }],
      categories: [{ id: `cat-${a}`, name: 'Cat' }],
    });
    expect(createSchedule).not.toHaveBeenCalled();
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('wallos-subscriptions/prefill returns the mapped fields, with no write', async () => {
    const { app, sa, createSchedule, createSubscription } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: SUB_PREFILL, payload: { scheduleId: 'sch-a' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: 'Spotify',
      price: '12.50',
      currencyCode: 'EUR',
      cycle: 3,
      frequency: 1,
      startDate: '2026-01-01',
      nextPayment: '2026-01-01',
    });
    expect(createSchedule).not.toHaveBeenCalled();
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it.each([SCHED_PREFILL, SUB_PREFILL])('%s answers 401 without a session', async (url) => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url, payload: {}, headers: { origin: TEST_ORIGIN } });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    [SCHED_PREFILL, {}],
    [SCHED_PREFILL, { wallosSubscriptionId: 7 }],
    [SUB_PREFILL, {}],
    [SUB_PREFILL, { scheduleId: 3 }],
  ])('%s rejects a bad body %#', async (url, payload) => {
    const { app, sa } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
  });

  it("404 for another user's subscription id, and Actual is never opened", async () => {
    const withActual = vi.fn();
    const { app, sa, createSchedule } = setup({ withActual });
    const res = await injectAs(app, sa, { method: 'POST', url: SCHED_PREFILL, payload: { wallosSubscriptionId: '8' } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'wallos_subscription_not_found' });
    expect(withActual).not.toHaveBeenCalled();
    expect(createSchedule).not.toHaveBeenCalled();
  });

  it("404 for another user's schedule id, with no Wallos currency read and no write", async () => {
    const { app, sa, createSubscription } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: SUB_PREFILL, payload: { scheduleId: 'sch-b' } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'schedule_not_found' });
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('range schedule answers 400 range_amount_unsupported', async () => {
    const { app, sa, createSubscription } = setup({
      withActual: (_id, use) =>
        use({
          getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
          getSchedules: async () => [
            { id: 'sch-a', name: 'S', amount: { num1: -1, num2: -2 }, amountOp: 'isbetween', date: { frequency: 'monthly', start: '2026-01-01' } },
          ],
        } as never),
    });
    const res = await injectAs(app, sa, { method: 'POST', url: SUB_PREFILL, payload: { scheduleId: 'sch-a' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'range_amount_unsupported' });
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('failures map to fixed codes without secret text', async () => {
    const { app, sa } = setup({ withActual: () => Promise.reject(new ActualSessionError('open_failed')) });
    for (const [url, payload] of [
      [SCHED_PREFILL, { wallosSubscriptionId: '7' }],
      [SUB_PREFILL, { scheduleId: 'sch-a' }],
    ] as const) {
      const res = await injectAs(app, sa, { method: 'POST', url, payload });
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({ error: 'actual_unavailable' });
    }
  });
});

describe('error mapping', () => {
  const SECRET_MESSAGE = 'api_key=abc https://wallos.example password Netflix 12.50';
  const cases: [string, Error, number, string][] = [
    ['range', new CreateFlowError('range_amount_unsupported'), 400, 'range_amount_unsupported'],
    ['base', new CreateFlowError('base_currency_missing'), 400, 'base_currency_missing'],
    ['write invalid', new ActualWriteError(SECRET_MESSAGE), 400, 'invalid_request'],
    ['write sync', new ActualWriteError(SECRET_MESSAGE, 'sync_failed'), 502, 'actual_sync_failed'],
    ['session none', new ActualSessionError('not_configured'), 400, 'actual_not_configured'],
    ['session open', new ActualSessionError('open_failed'), 502, 'actual_unavailable'],
    ['session timed out', new ActualSessionError('timed_out'), 502, 'actual_unavailable'],
    ['wallos auth', new WallosAuthError(), 502, 'wallos_auth_failed'],
    ['wallos rejected', new WallosRejectedError(SECRET_MESSAGE), 502, 'wallos_rejected'],
    ['wallos http', new WallosHttpError(500), 502, 'wallos_unavailable'],
    ['mapping', new WallosMappingError('invalid_price', 'price', SECRET_MESSAGE), 400, 'mapping_failed'],
    ['patterns', new FrequencyMappingError('patterns_unsupported', SECRET_MESSAGE), 400, 'patterns_unsupported'],
    ['conversion', new CurrencyConversionError('missing_rate', SECRET_MESSAGE), 400, 'currency_conversion_failed'],
    ['unknown', new Error(SECRET_MESSAGE), 500, 'internal_error'],
  ];

  it.each(cases)('%s maps to a fixed code with no secret text', async (_n, error, status, code) => {
    const { app, sa } = setup({
      createSchedule: () => Promise.reject(error),
      withActual: () => Promise.reject(error),
    });
    for (const [url, payload] of [
      [SCHED_URL, SCHED_BODY],
      [SUB_URL, { scheduleId: 'sch-a' }],
    ] as const) {
      const res = await injectAs(app, sa, { method: 'POST', url, payload });
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error: code });
      expect(res.body).not.toMatch(SECRETISH);
    }
  });
});

describe('create saves the pair as a LINKED match (#108)', () => {
  const HEX64 = /^[0-9a-f]{64}$/;

  it('actual-schedules: saves LINKED with server hashes, and the next sync check lists it as linked', async () => {
    const { app, sa, a, db } = setup({
      createSchedule: async () => ({ scheduleId: 'sch-a', payeeId: 'p1', payeeCreated: true, categoryApplied: false }),
    });
    const res = await injectAs(app, sa, { method: 'POST', url: SCHED_URL, payload: SCHED_BODY });
    expect(res.statusCode).toBe(201);
    const rows = createUserRepo(db, a).listMatches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ wallosId: '7', actualScheduleId: 'sch-a', status: 'LINKED' });
    expect(rows[0]?.lastKnownWallosHash).toMatch(HEX64);
    expect(rows[0]?.lastKnownActualHash).toMatch(HEX64);
    expect(res.json()).toMatchObject({ scheduleId: 'sch-a', matchId: rows[0]?.id, matchCreated: true });

    const check = await injectAs(app, sa, { method: 'POST', url: '/api/sync/check', payload: {} });
    expect(check.statusCode).toBe(200);
    const body = check.json<{ linked: unknown[]; unlinkedWallos: unknown[]; unlinkedActual: unknown[]; mismatches: unknown[] }>();
    expect(body.linked).toHaveLength(1);
    expect(body.unlinkedWallos).toHaveLength(0);
    expect(body.unlinkedActual).toHaveLength(0);
    expect(body.mismatches).toHaveLength(0);
  });

  it('wallos-subscriptions: saves LINKED with server hashes', async () => {
    const { app, sa, a, db } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-a' } });
    expect(res.statusCode).toBe(201);
    const rows = createUserRepo(db, a).listMatches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ wallosId: '55', actualScheduleId: 'sch-a', status: 'LINKED' });
    expect(rows[0]?.lastKnownWallosHash).toMatch(HEX64);
    expect(rows[0]?.lastKnownActualHash).toMatch(HEX64);
    expect(res.json()).toEqual({ wallosSubscriptionId: '55', matchId: rows[0]?.id, matchCreated: true });
  });

  it("two users: B's create never links A's rows, and A has no match", async () => {
    const { app, sb, a, b, db } = setup({
      createSchedule: async () => ({ scheduleId: 'sch-b', payeeId: 'p1', payeeCreated: true, categoryApplied: false }),
    });
    const res = await injectAs(app, sb, {
      method: 'POST',
      url: SCHED_URL,
      payload: { ...SCHED_BODY, wallosSubscriptionId: '8' },
    });
    expect(res.statusCode).toBe(201);
    expect(createUserRepo(db, a).listMatches()).toEqual([]);
    const rowsB = createUserRepo(db, b).listMatches();
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]).toMatchObject({ wallosId: '8', actualScheduleId: 'sch-b', status: 'LINKED' });

    // B asking for A's subscription is refused and writes no match for anyone.
    const foreign = await injectAs(app, sb, { method: 'POST', url: SCHED_URL, payload: { ...SCHED_BODY, wallosSubscriptionId: '7' } });
    expect(foreign.statusCode).toBe(404);
    expect(createUserRepo(db, a).listMatches()).toEqual([]);
    expect(createUserRepo(db, b).listMatches()).toHaveLength(1);
  });

  it('does not duplicate an existing match and reports matchCreated false', async () => {
    const { app, sa, a, db } = setup({
      createSchedule: async () => ({ scheduleId: 'sch-a', payeeId: 'p1', payeeCreated: true, categoryApplied: false }),
    });
    const existing = createUserRepo(db, a).insertMatch({ wallosId: '7', actualScheduleId: 'old', status: 'LINKED' });
    const res = await injectAs(app, sa, { method: 'POST', url: SCHED_URL, payload: SCHED_BODY });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ matchId: existing.id, matchCreated: false });
    const rows = createUserRepo(db, a).listMatches();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actualScheduleId).toBe('old');
  });

  it('a failed remote create saves no match', async () => {
    const { app, sa, a, db } = setup({ createSchedule: () => Promise.reject(new ActualWriteError('x', 'sync_failed')) });
    const res = await injectAs(app, sa, { method: 'POST', url: SCHED_URL, payload: SCHED_BODY });
    expect(res.statusCode).toBe(502);
    expect(createUserRepo(db, a).listMatches()).toEqual([]);
  });

  it('returns 201 with the created id when the match insert fails (actual-schedules)', async () => {
    const { app, sa, a, db } = setup({
      createSchedule: async () => ({ scheduleId: 'sch-a', payeeId: 'p1', payeeCreated: true, categoryApplied: false }),
    }, true);
    const res = await injectAs(app, sa, { method: 'POST', url: SCHED_URL, payload: SCHED_BODY });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['scheduleId']).toBe('sch-a');
    expect(body).not.toHaveProperty('matchId');
    expect(body['matchCreated']).toBe(false);
    expect(createUserRepo(db, a).listMatches()).toEqual([]);
  });

  it('returns 201 with the created id when the match insert fails (wallos-subscriptions)', async () => {
    const { app, sa, a, db } = setup({}, true);
    const res = await injectAs(app, sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-a' } });
    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body['wallosSubscriptionId']).toBe('55');
    expect(body).not.toHaveProperty('matchId');
    expect(body['matchCreated']).toBe(false);
    expect(createUserRepo(db, a).listMatches()).toEqual([]);
  });
});

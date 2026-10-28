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
function setup(overrides: Partial<CreateDeps> = {}, failMatchInsert: boolean | 'repoint' = false) {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  const owned: Record<string, { subs: number[]; schedules: string[] }> = {};
  // Per-user Wallos payment methods and categories (#111), keyed by user id. Empty unless seeded.
  type Named = { id: string; name: string }[];
  const choices: { methods: Record<string, Named>; categories: Record<string, Named> } = {
    methods: {},
    categories: {},
  };
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
    listPaymentMethods: async (id: string) => choices.methods[id] ?? [],
    listCategories: async (id: string) => choices.categories[id] ?? [],
    listCurrencies: async () => [{ id: 1, code: 'EUR', rate: '1' }],
    createSubscription,
  } as unknown as WallosClient;
  const deps: CreateDeps = {
    wallos,
    repoFor: (id) => {
      const repo = createUserRepo(t.db, id);
      if (failMatchInsert === false) return repo;
      if (failMatchInsert === 'repoint') return { ...repo, replaceMatchSide: () => false };
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
        // 'acc' is the account of SCHED_BODY, owned by every test user; `acc-<id>` is owned by that user only (#135).
        getAccounts: async () => [{ id: `acc-${id}`, name: 'Main' }, { id: 'acc', name: 'Shared' }],
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
  const seedChoices = (): void => {
    choices.methods[a] = [{ id: '3', name: 'Card' }];
    choices.categories[a] = [{ id: '4', name: 'Fun' }];
    choices.methods[b] = [{ id: '9', name: 'Cash' }];
    choices.categories[b] = [{ id: '8', name: 'Bills' }];
  };
  return { app, a, b, sa: signIn(ctx, a), sb: signIn(ctx, b), createSchedule, createSubscription, db: t.db, seedChoices };
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

describe('wallos-subscriptions payment method and category ids (#111)', () => {
  it('a valid digit-string pair reaches Wallos', async () => {
    const { app, a, sa, createSubscription, seedChoices } = setup();
    seedChoices();
    const res = await injectAs(app, sa, {
      method: 'POST',
      url: SUB_URL,
      payload: { scheduleId: 'sch-a', paymentMethodId: '3', categoryId: '4' },
    });
    expect(res.statusCode).toBe(201);
    expect(createSubscription).toHaveBeenCalledWith(
      a,
      expect.objectContaining({ payment_method_id: '3', category_id: '4' }),
    );
  });

  it('null ids mean not chosen and send neither field', async () => {
    const { app, sa, createSubscription } = setup();
    const res = await injectAs(app, sa, {
      method: 'POST',
      url: SUB_URL,
      payload: { scheduleId: 'sch-a', paymentMethodId: null, categoryId: null },
    });
    expect(res.statusCode).toBe(201);
    const payload = (createSubscription.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
    expect(payload).not.toHaveProperty('payment_method_id');
    expect(payload).not.toHaveProperty('category_id');
  });

  it.each([
    { paymentMethodId: 5 },
    { categoryId: 5 },
    { paymentMethodId: 5, categoryId: 5 },
    { paymentMethodId: 'abc' },
    { categoryId: '1a' },
    { paymentMethodId: '' },
    { categoryId: ' 4' },
    { paymentMethodId: '-1' },
    { categoryId: '1.5' },
    { paymentMethodId: ['3'] },
    { categoryId: {} },
    { paymentMethodId: '1'.repeat(201) },
  ])('400 invalid_request for %j, no Wallos call', async (extra) => {
    const { app, sa, createSubscription, seedChoices } = setup();
    seedChoices();
    const res = await injectAs(app, sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-a', ...extra } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("two users: A cannot use B's payment method or category, and nothing is written", async () => {
    const { app, sa, sb, b, createSubscription, seedChoices } = setup();
    seedChoices();
    const pm = await injectAs(app, sa, {
      method: 'POST',
      url: SUB_URL,
      payload: { scheduleId: 'sch-a', paymentMethodId: '9' },
    });
    expect(pm.statusCode).toBe(400);
    expect(pm.json()).toEqual({ error: 'invalid_payment_method' });
    const cat = await injectAs(app, sa, {
      method: 'POST',
      url: SUB_URL,
      payload: { scheduleId: 'sch-a', categoryId: '8' },
    });
    expect(cat.statusCode).toBe(400);
    expect(cat.json()).toEqual({ error: 'invalid_category' });
    expect(createSubscription).not.toHaveBeenCalled();
    // B's own ids still work for B, so the refusal above was about ownership.
    const ok = await injectAs(app, sb, {
      method: 'POST',
      url: SUB_URL,
      payload: { scheduleId: 'sch-b', paymentMethodId: '9', categoryId: '8' },
    });
    expect(ok.statusCode).toBe(201);
    expect(createSubscription).toHaveBeenCalledTimes(1);
    expect(createSubscription).toHaveBeenCalledWith(
      b,
      expect.objectContaining({ payment_method_id: '9', category_id: '8' }),
    );
  });
});

describe('wallos-subscriptions edited fields (#133)', () => {
  const sentPayload = (mock: ReturnType<typeof setup>['createSubscription']): Record<string, unknown> =>
    (mock.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
  const post = (ctx: ReturnType<typeof setup>, extra: Record<string, unknown>) =>
    injectAs(ctx.app, ctx.sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-a', ...extra } });

  it('title: a valid value is trimmed and written as name', async () => {
    const ctx = setup();
    expect((await post(ctx, { title: '  Music  ' })).statusCode).toBe(201);
    expect(sentPayload(ctx.createSubscription)).toMatchObject({ name: 'Music' });
  });

  it('price: a decimal string or number is written with the currency minor units', async () => {
    const ctx = setup();
    expect((await post(ctx, { price: '9.9' })).statusCode).toBe(201);
    expect(sentPayload(ctx.createSubscription)).toMatchObject({ price: '9.90' });
    const ctx2 = setup();
    expect((await post(ctx2, { price: 20 })).statusCode).toBe(201);
    expect(sentPayload(ctx2.createSubscription)).toMatchObject({ price: '20.00' });
  });

  it.each([
    ['monthly', '3'],
    ['yearly', '4'],
    ['weekly', '2'],
    ['custom_days', '1'],
  ])('billing cycle: %s is written as Wallos cycle %s', async (billingCycle, cycle) => {
    const ctx = setup();
    expect((await post(ctx, { billingCycle })).statusCode).toBe(201);
    expect(sentPayload(ctx.createSubscription)).toMatchObject({ cycle, frequency: '1' });
  });

  it('start date: a valid value is written as start_date', async () => {
    const ctx = setup();
    expect((await post(ctx, { startDate: '2026-03-04' })).statusCode).toBe(201);
    expect(sentPayload(ctx.createSubscription)).toMatchObject({ start_date: '2026-03-04' });
  });

  it('all four together reach Wallos and the match is still saved', async () => {
    const ctx = setup();
    const res = await post(ctx, { title: 'Music', price: '9.90', billingCycle: 'weekly', startDate: '2026-03-04' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ wallosSubscriptionId: '55', matchCreated: true });
    expect(sentPayload(ctx.createSubscription)).toMatchObject({
      name: 'Music',
      price: '9.90',
      cycle: '2',
      start_date: '2026-03-04',
    });
  });

  it.each([
    { title: '' },
    { title: '   ' },
    { title: 'x'.repeat(201) },
    { title: 5 },
    { price: '' },
    { price: 'abc' },
    { price: '-1' },
    { price: '0' },
    { price: '1e3' },
    { price: '9.999' },
    { price: 0 },
    { price: -3 },
    { price: {} },
    { billingCycle: 'daily' },
    { billingCycle: 'Monthly' },
    { billingCycle: 3 },
    { startDate: '2026-02-30' },
    { startDate: '2026-3-4' },
    { startDate: '04-03-2026' },
    { startDate: 20260304 },
  ])('400 invalid_request for %j, no Wallos call and no match', async (extra) => {
    const ctx = setup();
    const res = await post(ctx, extra);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(ctx.createSubscription).not.toHaveBeenCalled();
  });

  it('a body naming none of the four fields sends the same payload as before', async () => {
    const plain = setup();
    expect((await post(plain, {})).statusCode).toBe(201);
    const nulls = setup();
    expect((await post(nulls, { title: null, price: null, billingCycle: null, startDate: null })).statusCode).toBe(201);
    expect(sentPayload(nulls.createSubscription)).toEqual(sentPayload(plain.createSubscription));
    expect(sentPayload(plain.createSubscription)).toEqual({
      name: 'Spotify',
      price: '12.50',
      currency_id: '1',
      cycle: '3',
      frequency: '1',
      next_payment: '2026-01-01',
      start_date: '2026-01-01',
    });
  });

  it('two users: the edited values are written only through the caller own Wallos client', async () => {
    const { app, a, b, sa, sb, createSubscription } = setup();
    const edit = { title: 'Mine', price: '5', billingCycle: 'yearly', startDate: '2026-03-04' };
    const asA = await injectAs(app, sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-a', ...edit } });
    expect(asA.statusCode).toBe(201);
    expect(createSubscription.mock.calls.map((c) => c[0])).toEqual([a]);
    // A cannot aim the edited values at B's schedule: it is not found, and nothing is written.
    const cross = await injectAs(app, sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-b', ...edit } });
    expect(cross.statusCode).toBe(404);
    expect(createSubscription).toHaveBeenCalledTimes(1);
    // B's own create goes to B's client only.
    const asB = await injectAs(app, sb, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-b', title: 'Theirs' } });
    expect(asB.statusCode).toBe(201);
    expect(createSubscription.mock.calls.map((c) => c[0])).toEqual([a, b]);
    expect(sentPayload(createSubscription)).toMatchObject({ name: 'Mine' });
    expect((createSubscription.mock.calls as unknown[][])[1]?.[1]).toMatchObject({ name: 'Theirs' });
  });

  it('a price with too many decimals for the currency is a 400 before any Wallos call', async () => {
    const listCurrencies = vi.fn(async () => [{ id: 1, code: 'EUR', rate: '1' }]);
    const ctx = setup({ wallos: { listCurrencies } as unknown as WallosClient });
    const res = await post(ctx, { price: '9.999' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(listCurrencies).not.toHaveBeenCalled();
  });

  it('a 400 for a bad value is answered before the Wallos lists are read', async () => {
    const listCurrencies = vi.fn(async () => [{ id: 1, code: 'EUR', rate: '1' }]);
    const ctx = setup({ wallos: { listCurrencies } as unknown as WallosClient });
    const res = await post(ctx, { price: 'abc' });
    expect(res.statusCode).toBe(400);
    expect(listCurrencies).not.toHaveBeenCalled();
  });
});

describe('create-modal overrides on both create routes (#135)', () => {
  type Ctx = ReturnType<typeof setup>;
  const scheduleInput = (ctx: Ctx, call = 0): Record<string, unknown> =>
    (ctx.createSchedule.mock.calls[call] as unknown as [string, Record<string, unknown>])[1];
  const scheduleUser = (ctx: Ctx, call = 0): string =>
    (ctx.createSchedule.mock.calls[call] as unknown as [string])[0];
  const subPayload = (ctx: Ctx): Record<string, unknown> =>
    (ctx.createSubscription.mock.calls[0] as unknown as [string, Record<string, unknown>])[1];
  /** A's own ids, as A's Actual budget lists them. */
  const own = (ctx: Ctx) => ({
    wallosSubscriptionId: '7',
    accountId: `acc-${ctx.a}`,
    payee: { kind: 'existing', id: `pay-${ctx.a}` },
    categoryId: `cat-${ctx.a}`,
  });
  const postSched = (ctx: Ctx, payload: Record<string, unknown>, as: 'sa' | 'sb' = 'sa') =>
    injectAs(ctx.app, ctx[as], { method: 'POST', url: SCHED_URL, payload });

  it('Both create routes accept overrides and apply them', async () => {
    const ctx = setup();
    const res = await postSched(ctx, { ...own(ctx), name: '  Films  ', amount: '9.9', startDate: '2026-03-04' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ scheduleId: 's1', matchCreated: true });
    expect(scheduleInput(ctx)).toEqual({
      name: 'Films',
      amountCents: -990,
      recurrence: { frequency: 'monthly', interval: 1 },
      startDate: '2026-03-04',
      payee: { kind: 'existing', id: `pay-${ctx.a}` },
      accountId: `acc-${ctx.a}`,
      categoryId: `cat-${ctx.a}`,
    });
    // The Wallos route (#133) still applies its edited title, price and start date, and its owned category (#111).
    ctx.seedChoices();
    const sub = await injectAs(ctx.app, ctx.sa, {
      method: 'POST',
      url: SUB_URL,
      payload: { scheduleId: 'sch-a', title: 'Music', price: '9.90', startDate: '2026-03-04', categoryId: '4' },
    });
    expect(sub.statusCode).toBe(201);
    expect(subPayload(ctx)).toMatchObject({ name: 'Music', price: '9.90', start_date: '2026-03-04', category_id: '4' });
  });

  it('name: a valid value is trimmed and applied; omitted keeps the Wallos name', async () => {
    const ctx = setup();
    expect((await postSched(ctx, { ...SCHED_BODY, name: '  Films ' })).statusCode).toBe(201);
    expect(scheduleInput(ctx)).toMatchObject({ name: 'Films' });
    expect((await postSched(ctx, SCHED_BODY)).statusCode).toBe(201);
    expect(scheduleInput(ctx, 1)).toMatchObject({ name: 'Netflix' });
  });

  it('amount: a decimal string or number in the base currency becomes negative minor units; omitted keeps the converted amount', async () => {
    const ctx = setup();
    expect((await postSched(ctx, { ...SCHED_BODY, amount: '20.5' })).statusCode).toBe(201);
    expect((await postSched(ctx, { ...SCHED_BODY, amount: 7 })).statusCode).toBe(201);
    expect((await postSched(ctx, SCHED_BODY)).statusCode).toBe(201);
    expect([0, 1, 2].map((i) => scheduleInput(ctx, i)['amountCents'])).toEqual([-2050, -700, -1250]);
  });

  it('start date: a valid value is applied; omitted keeps the derived start', async () => {
    const ctx = setup();
    expect((await postSched(ctx, { ...SCHED_BODY, startDate: '2027-02-28' })).statusCode).toBe(201);
    expect((await postSched(ctx, SCHED_BODY)).statusCode).toBe(201);
    expect(scheduleInput(ctx)['startDate']).toBe('2027-02-28');
    expect(scheduleInput(ctx, 1)['startDate']).toBe('2026-11-03');
  });

  it('payee, account and category: the caller own ids are applied; a new payee and no category still work', async () => {
    const ctx = setup();
    expect((await postSched(ctx, own(ctx))).statusCode).toBe(201);
    expect(scheduleInput(ctx)).toMatchObject({
      accountId: `acc-${ctx.a}`,
      payee: { kind: 'existing', id: `pay-${ctx.a}` },
      categoryId: `cat-${ctx.a}`,
    });
    const noCategory = { wallosSubscriptionId: '7', accountId: `acc-${ctx.a}`, payee: { kind: 'new', name: 'Fresh' } };
    expect((await postSched(ctx, noCategory)).statusCode).toBe(201);
    expect(scheduleInput(ctx, 1)).not.toHaveProperty('categoryId');
    expect(scheduleInput(ctx, 1)['payee']).toEqual({ kind: 'new', name: 'Fresh' });
  });

  it.each([
    { name: '' },
    { name: '   ' },
    { name: 'x'.repeat(201) },
    { name: 5 },
    { amount: '' },
    { amount: 'abc' },
    { amount: '-1' },
    { amount: '0' },
    { amount: '1e3' },
    { amount: 0 },
    { amount: -3 },
    { amount: {} },
    { startDate: '2026-02-30' },
    { startDate: '2026-3-4' },
    { startDate: '04-03-2026' },
    { startDate: 20260304 },
    { accountId: 5 },
    { accountId: '' },
    { accountId: 'x'.repeat(201) },
    { payee: { kind: 'existing', id: '' } },
    { payee: { kind: 'existing', id: 7 } },
    { categoryId: 5 },
    { categoryId: '' },
  ])('Validation rejects bad values (name, amount, start date, ids) with 400: %j', async (extra) => {
    const ctx = setup();
    const res = await postSched(ctx, { ...SCHED_BODY, ...extra });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(ctx.createSchedule).not.toHaveBeenCalled();
  });

  it('Validation rejects bad values (name, amount, start date, ids) with 400: a bad shape is refused before Wallos or Actual is read', async () => {
    const listSubscriptions = vi.fn(async () => []);
    const withActual = vi.fn(() => Promise.reject(new Error('must not open')));
    const ctx = setup({ wallos: { listSubscriptions, listCurrencies: vi.fn() } as unknown as WallosClient, withActual });
    for (const extra of [{ name: ' ' }, { amount: 'abc' }, { startDate: '2026-13-01' }]) {
      expect((await postSched(ctx, { ...SCHED_BODY, ...extra })).statusCode).toBe(400);
    }
    expect(listSubscriptions).not.toHaveBeenCalled();
    expect(withActual).not.toHaveBeenCalled();
  });

  it('Validation rejects bad values (name, amount, start date, ids) with 400: an amount with more decimals than the base currency is refused with no write', async () => {
    const ctx = setup();
    const res = await postSched(ctx, { ...SCHED_BODY, amount: '9.999' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(ctx.createSchedule).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_account', { accountId: 'acc-unknown' }],
    ['invalid_payee', { payee: { kind: 'existing', id: 'pay-unknown' } }],
    ['invalid_category', { categoryId: 'cat-unknown' }],
  ])('Validation rejects bad values (name, amount, start date, ids) with 400: an id not in the caller lists is %s', async (code, change) => {
    const ctx = setup();
    const res = await postSched(ctx, { ...own(ctx), ...change });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: code });
    expect(ctx.createSchedule).not.toHaveBeenCalled();
    expect(createUserRepo(ctx.db, ctx.a).listMatches()).toEqual([]);
  });

  it("Two-user isolation test: user B cannot use user A's payee, category or account ids", async () => {
    const ctx = setup();
    const mine = { wallosSubscriptionId: '8', accountId: `acc-${ctx.b}`, payee: { kind: 'existing', id: `pay-${ctx.b}` }, categoryId: `cat-${ctx.b}` };
    const cases = [
      ['invalid_account', { accountId: `acc-${ctx.a}` }],
      ['invalid_payee', { payee: { kind: 'existing', id: `pay-${ctx.a}` } }],
      ['invalid_category', { categoryId: `cat-${ctx.a}` }],
    ] as const;
    for (const [code, change] of cases) {
      const res = await postSched(ctx, { ...mine, ...change }, 'sb');
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: code });
      expect(res.body).not.toContain(ctx.a);
    }
    // No remote write happened for anyone, and no match row was saved.
    expect(ctx.createSchedule).not.toHaveBeenCalled();
    expect(createUserRepo(ctx.db, ctx.a).listMatches()).toEqual([]);
    expect(createUserRepo(ctx.db, ctx.b).listMatches()).toEqual([]);
    // B's own ids, with edited values, go to B's create only.
    const ok = await postSched(ctx, { ...mine, name: 'Theirs', amount: '3' }, 'sb');
    expect(ok.statusCode).toBe(201);
    expect(ctx.createSchedule).toHaveBeenCalledTimes(1);
    expect(scheduleUser(ctx)).toBe(ctx.b);
    expect(scheduleInput(ctx)).toMatchObject({ name: 'Theirs', amountCents: -300, accountId: `acc-${ctx.b}` });
    // A cannot aim the edited values at B's subscription either: it is not found and nothing is written.
    const cross = await postSched(ctx, { ...own(ctx), wallosSubscriptionId: '8', name: 'Mine' });
    expect(cross.statusCode).toBe(404);
    expect(ctx.createSchedule).toHaveBeenCalledTimes(1);
  });

  it('Existing no-override requests are unchanged (regression test)', async () => {
    const plain = setup();
    expect((await postSched(plain, SCHED_BODY)).statusCode).toBe(201);
    const nulls = setup();
    expect((await postSched(nulls, { ...SCHED_BODY, name: null, amount: null, startDate: null })).statusCode).toBe(201);
    expect(scheduleInput(nulls)).toEqual(scheduleInput(plain));
    expect(scheduleInput(plain)).toEqual({
      name: 'Netflix',
      amountCents: -1250,
      recurrence: { frequency: 'monthly', interval: 1 },
      startDate: '2026-11-03',
      payee: { kind: 'new', name: 'N' },
      accountId: 'acc',
    });
    // The Wallos route without its edited fields is unchanged too.
    const sub = setup();
    expect((await injectAs(sub.app, sub.sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-a' } })).statusCode).toBe(201);
    expect(subPayload(sub)).toEqual({
      name: 'Spotify',
      price: '12.50',
      currency_id: '1',
      cycle: '3',
      frequency: '1',
      next_payment: '2026-01-01',
      start_date: '2026-01-01',
    });
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
      accounts: [{ id: `acc-${a}`, name: 'Main' }, { id: 'acc', name: 'Shared' }],
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
      paymentMethods: [],
      categories: [],
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

describe('Recreate an orphaned match side with matchId (#109)', () => {
  const NEW_SCHEDULE = { scheduleId: 'sch-a', payeeId: 'p1', payeeCreated: true, categoryApplied: false };
  // The read-back may store the H14 anchor on an existing row, so compare identity, not every column.
  const rowsOf = (db: AppDatabase, u: string) =>
    createUserRepo(db, u)
      .listMatches()
      .map(({ id, wallosId, actualScheduleId, status, lastKnownWallosHash, lastKnownActualHash }) => ({
        id, wallosId, actualScheduleId, status, lastKnownWallosHash, lastKnownActualHash,
      }));

  async function syncLinked(app: ReturnType<typeof setup>['app'], s: ReturnType<typeof setup>['sa']) {
    const check = await injectAs(app, s, { method: 'POST', url: '/api/sync/check', payload: {} });
    expect(check.statusCode).toBe(200);
    return check.json<{ linked: { matchId: string; orphan: string | null; status: string }[] }>().linked;
  }

  it('Recreate in Actual keeps the match id, and the next sync check shows it linked with orphan null', async () => {
    const t = setup({ createSchedule: async () => NEW_SCHEDULE });
    const row = createUserRepo(t.db, t.a).insertMatch({ wallosId: '7', actualScheduleId: 'gone', status: 'LINKED' });
    const res = await injectAs(t.app, t.sa, { method: 'POST', url: SCHED_URL, payload: { ...SCHED_BODY, matchId: row.id } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ scheduleId: 'sch-a', matchId: row.id, matchCreated: false, matchRelinked: true });
    const rows = rowsOf(t.db, t.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: row.id, wallosId: '7', actualScheduleId: 'sch-a', status: 'LINKED' });
    expect(rows[0]?.lastKnownActualHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await syncLinked(t.app, t.sa)).toEqual([expect.objectContaining({ matchId: row.id, orphan: null, status: 'LINKED' })]);
  });

  it('Recreate in Wallos keeps the match id, and the next sync check shows it linked with orphan null', async () => {
    const t = setup();
    const row = createUserRepo(t.db, t.a).insertMatch({ wallosId: '99', actualScheduleId: 'sch-a', status: 'MISMATCH_DETECTED' });
    const res = await injectAs(t.app, t.sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-a', matchId: row.id } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ wallosSubscriptionId: '55', matchId: row.id, matchCreated: false, matchRelinked: true });
    const rows = rowsOf(t.db, t.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: row.id, wallosId: '55', actualScheduleId: 'sch-a', status: 'LINKED' });
    expect(await syncLinked(t.app, t.sa)).toEqual([expect.objectContaining({ matchId: row.id, orphan: null, status: 'LINKED' })]);
  });

  it.each([
    ['a mismatched source id', { wallosId: '7', actual: 'gone', status: 'LINKED' as const, source: '8' }],
    ['orphaned_both', { wallosId: '99', actual: 'gone', status: 'LINKED' as const, source: '99' }],
    ['a non-orphan row', { wallosId: '7', actual: 'sch-a', status: 'LINKED' as const, source: '7' }],
    ['an IGNORED row', { wallosId: '7', actual: 'gone', status: 'IGNORED_WALLOS' as const, source: '7' }],
  ])('Recreate in Actual refuses %s with 400 and creates nothing', async (_name, c) => {
    const t = setup({ createSchedule: vi.fn(async () => NEW_SCHEDULE) });
    const row = createUserRepo(t.db, t.a).insertMatch({ wallosId: c.wallosId, actualScheduleId: c.actual, status: c.status });
    const before = rowsOf(t.db, t.a);
    const res = await injectAs(t.app, t.sa, {
      method: 'POST',
      url: SCHED_URL,
      payload: { ...SCHED_BODY, wallosSubscriptionId: c.source, matchId: row.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_state' });
    expect(t.createSubscription).not.toHaveBeenCalled();
    expect(rowsOf(t.db, t.a)).toEqual(before);
  });

  it.each([
    ['a mismatched source id', { wallosId: 'x', actual: 'sch-a', status: 'LINKED' as const, source: 'sch-other' }],
    ['orphaned_both', { wallosId: 'x', actual: 'gone', status: 'LINKED' as const, source: 'gone' }],
    ['a non-orphan row', { wallosId: '7', actual: 'sch-a', status: 'LINKED' as const, source: 'sch-a' }],
    ['an IGNORED row', { wallosId: 'x', actual: 'sch-a', status: 'IGNORED_ACTUAL' as const, source: 'sch-a' }],
  ])('Recreate in Wallos refuses %s with 400 and creates nothing', async (_name, c) => {
    const createSchedule = vi.fn(async () => NEW_SCHEDULE);
    const t = setup({ createSchedule });
    const row = createUserRepo(t.db, t.a).insertMatch({ wallosId: c.wallosId, actualScheduleId: c.actual, status: c.status });
    const before = rowsOf(t.db, t.a);
    const res = await injectAs(t.app, t.sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: c.source, matchId: row.id } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_state' });
    expect(t.createSubscription).not.toHaveBeenCalled();
    expect(createSchedule).not.toHaveBeenCalled();
    expect(rowsOf(t.db, t.a)).toEqual(before);
  });

  it("two users: B sending A's matchId gets 404, no create runs and A's row is unchanged", async () => {
    const createSchedule = vi.fn(async () => NEW_SCHEDULE);
    const t = setup({ createSchedule });
    const row = createUserRepo(t.db, t.a).insertMatch({ wallosId: '7', actualScheduleId: 'gone', status: 'LINKED' });
    const before = rowsOf(t.db, t.a);
    const r1 = await injectAs(t.app, t.sb, { method: 'POST', url: SCHED_URL, payload: { ...SCHED_BODY, wallosSubscriptionId: '8', matchId: row.id } });
    const r2 = await injectAs(t.app, t.sb, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-b', matchId: row.id } });
    for (const r of [r1, r2]) {
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ error: 'match_not_found' });
    }
    expect(createSchedule).not.toHaveBeenCalled();
    expect(t.createSubscription).not.toHaveBeenCalled();
    expect(rowsOf(t.db, t.a)).toEqual(before);
    expect(rowsOf(t.db, t.b)).toEqual([]);
  });

  it('an unknown matchId answers 404 match_not_found', async () => {
    const t = setup();
    const res = await injectAs(t.app, t.sa, { method: 'POST', url: SUB_URL, payload: { scheduleId: 'sch-a', matchId: 'nope' } });
    expect(res.statusCode).toBe(404);
    expect(t.createSubscription).not.toHaveBeenCalled();
  });

  it('when the repoint fails the create still answers 201 with matchRelinked false and no extra row', async () => {
    const t = setup({ createSchedule: async () => NEW_SCHEDULE }, 'repoint');
    const row = createUserRepo(t.db, t.a).insertMatch({ wallosId: '7', actualScheduleId: 'gone', status: 'LINKED' });
    const res = await injectAs(t.app, t.sa, { method: 'POST', url: SCHED_URL, payload: { ...SCHED_BODY, matchId: row.id } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ scheduleId: 'sch-a', matchId: row.id, matchCreated: false, matchRelinked: false });
    const rows = rowsOf(t.db, t.a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: row.id, actualScheduleId: 'gone' });
  });
});

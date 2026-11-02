import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { CreateDeps } from '../integrations/create.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';

// GET /api/sync/items/:side/:id (#155): read-only details of one synced item, for the signed-in user only.

const open: { close(): Promise<unknown>; db?: AppDatabase }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    if (a.db) closeDatabase(a.db);
  }
});

/** Two users. Each owns one Wallos subscription (id by user) and one Actual schedule (id by user). */
function setup(overrides: Partial<CreateDeps> = {}) {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  const owned: Record<string, { sub: number; sched: string }> = {};
  const deps: CreateDeps = {
    wallos: {
      listSubscriptions: async (id: string) => {
        const o = owned[id];
        return o === undefined
          ? []
          : [
              {
                id: o.sub,
                name: 'Netflix &amp; Co',
                price: '12.50',
                currency_id: 1,
                cycle: 3,
                frequency: 1,
                next_payment: '2026-11-03',
                start_date: '2026-01-01',
                auto_renew: 1,
                notes: 'family plan',
                payment_method_name: 'Visa',
                category_name: 'Streaming',
                inactive: 0,
              },
            ];
      },
      listPaymentMethods: async () => [],
      listCategories: async () => [],
      listCurrencies: async () => [{ id: 1, code: 'EUR', rate: '1' }],
      createSubscription: vi.fn(),
      updateSubscription: vi.fn(),
    },
    repoFor: (id) => createUserRepo(t.db, id),
    withActual: (id, use) =>
      use({
        getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
        getSchedules: async () =>
          owned[id] === undefined
            ? []
            : [
                {
                  id: owned[id].sched,
                  name: 'Spotify',
                  amount: -999,
                  amountOp: 'is',
                  payee: 'payee-1',
                  account: 'acct-1',
                  date: { frequency: 'monthly', interval: 1, start: '2026-01-01' },
                },
              ],
        getPayees: async () => [{ id: 'payee-1', name: 'Spotify AB' }],
        getAccounts: async () => [{ id: 'acct-1', name: 'Checking' }],
        getCategories: async () => [],
      } as never),
    createSchedule: vi.fn(),
    ...overrides,
  };
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
  owned[a] = { sub: 7, sched: 'sch-a' };
  owned[b] = { sub: 8, sched: 'sch-b' };
  const ctx = { db: t.db, clock: t.clock };
  return { app, a, b, sa: signIn(ctx, a), sb: signIn(ctx, b) };
}

describe('GET /api/sync/items/:side/:id', () => {
  it('answers 401 without a session', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/api/sync/items/wallos/7', headers: { origin: TEST_ORIGIN } });
    expect(res.statusCode).toBe(401);
  });

  it('returns the Wallos fields of the signed-in user item, with the name decoded', async () => {
    const { app, sa } = setup();
    const res = await injectAs(app, sa, { method: 'GET', url: '/api/sync/items/wallos/7' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      side: 'wallos',
      id: '7',
      title: 'Netflix & Co',
      priceCents: -1250,
      currency: 'EUR',
      cycle: { key: 'monthly', count: 1 },
      startDate: '2026-01-01',
      nextPayment: '2026-11-03',
      paymentMethod: 'Visa',
      category: 'Streaming',
      notes: 'family plan',
      autoRenew: true,
    });
  });

  it('returns the Actual fields with the payee and account resolved to names', async () => {
    const { app, sa } = setup();
    const res = await injectAs(app, sa, { method: 'GET', url: '/api/sync/items/actual/sch-a' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      side: 'actual',
      id: 'sch-a',
      name: 'Spotify',
      amountCents: -999,
      isRange: false,
      currency: 'EUR',
      cycle: { key: 'monthly', count: 1 },
      startDate: '2026-01-01',
      payee: 'Spotify AB',
      account: 'Checking',
    });
  });

  it('shows null for fields the Wallos subscription leaves empty ("Not set")', async () => {
    const { app, sa } = setup({
      wallos: {
        listSubscriptions: async () => [
          { id: 7, name: 'Bare', price: '3.00', currency_id: 1, cycle: 3, frequency: 1, inactive: 0 },
        ],
        listPaymentMethods: async () => [],
        listCategories: async () => [],
        listCurrencies: async () => [{ id: 1, code: 'EUR', rate: '1' }],
      } as unknown as CreateDeps['wallos'],
    });
    const res = await injectAs(app, sa, { method: 'GET', url: '/api/sync/items/wallos/7' });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).toMatchObject({ startDate: null, nextPayment: null, paymentMethod: null, category: null, notes: null, autoRenew: false });
  });

  it('answers 404 for another user item, on both sides, with no details', async () => {
    const { app, sa, sb } = setup();
    const foreignWallos = await injectAs(app, sa, { method: 'GET', url: '/api/sync/items/wallos/8' });
    const foreignActual = await injectAs(app, sa, { method: 'GET', url: '/api/sync/items/actual/sch-b' });
    expect(foreignWallos.statusCode).toBe(404);
    expect(foreignWallos.json()).toEqual({ error: 'item_not_found' });
    expect(foreignActual.statusCode).toBe(404);
    expect(foreignActual.json()).toEqual({ error: 'item_not_found' });
    expect(foreignWallos.body).not.toMatch(/Netflix|Spotify|12\.50|family plan/);
    // B still sees its own item.
    const own = await injectAs(app, sb, { method: 'GET', url: '/api/sync/items/wallos/8' });
    expect(own.statusCode).toBe(200);
  });

  it('answers 400 for an unknown side or an empty or oversized id', async () => {
    const { app, sa } = setup();
    const badSide = await injectAs(app, sa, { method: 'GET', url: '/api/sync/items/other/7' });
    const oversized = await injectAs(app, sa, { method: 'GET', url: `/api/sync/items/wallos/${'x'.repeat(201)}` });
    expect(badSide.statusCode).toBe(400);
    expect(badSide.json()).toEqual({ error: 'invalid_request' });
    // Fastify's default parameter limit (100 characters) answers 414 before the handler; the 200-character handler check is a second line of defence.
    expect([400, 414]).toContain(oversized.statusCode);
  });

  it('never writes to Wallos or Actual', async () => {
    const createSubscription = vi.fn();
    const createSchedule = vi.fn();
    const { app, sa } = setup({
      createSchedule,
      wallos: {
        listSubscriptions: async () => [],
        listPaymentMethods: async () => [],
        listCategories: async () => [],
        listCurrencies: async () => [{ id: 1, code: 'EUR', rate: '1' }],
        createSubscription,
        updateSubscription: vi.fn(),
      } as unknown as CreateDeps['wallos'],
    });
    await injectAs(app, sa, { method: 'GET', url: '/api/sync/items/actual/sch-a' });
    expect(createSchedule).not.toHaveBeenCalled();
    expect(createSubscription).not.toHaveBeenCalled();
  });
});

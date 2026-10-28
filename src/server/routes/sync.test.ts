import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { CreateDeps } from '../integrations/create.js';
import { WallosAuthError, type WallosClient } from '../integrations/wallos/client.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';

const SECRETISH = /api[_-]?key|password|secret|https?:\/\/|netflix|spotify|12\.50/i;
const URL = '/api/sync/check';

const open: { close(): Promise<unknown>; db?: AppDatabase }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    if (a.db) closeDatabase(a.db);
  }
});

function setup(overrides: Partial<CreateDeps> = {}) {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  const owned: Record<
    string,
    { sub: number; sched: string; subName: string; schedName: string; cycle: number; every: number; recur: { frequency: string; interval?: number } }
  > = {};
  const createSchedule = vi.fn();
  const createSubscription = vi.fn();
  const deps: CreateDeps = {
    wallos: {
      listSubscriptions: async (id: string) => [
        {
          id: owned[id]?.sub ?? 0,
          name: owned[id]?.subName ?? 'Netflix',
          price: '12.50',
          currency_id: 1,
          cycle: owned[id]?.cycle ?? 3,
          frequency: owned[id]?.every ?? 1,
          next_payment: '2026-11-03',
          start_date: '2026-01-01',
          inactive: 0,
        },
      ],
      listPaymentMethods: async () => [],
      listCategories: async () => [],
      listCurrencies: async () => [{ id: 1, code: 'EUR', rate: '1' }],
      createSubscription,
      updateSubscription: vi.fn(),
    },
    repoFor: (id) => createUserRepo(t.db, id),
    withActual: (id, use) =>
      use({
        getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
        getSchedules: async () => [
          {
            id: owned[id]?.sched ?? '',
            name: owned[id]?.schedName ?? 'Spotify',
            amount: -999,
            amountOp: 'is',
            date: { ...(owned[id]?.recur ?? { frequency: 'monthly' }), start: '2026-01-01' },
          },
        ],
      } as never),
    createSchedule,
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
  // A: every 7 days (Wallos) and yearly (Actual). B: every 2 weeks (Wallos) and every 3 months (Actual).
  owned[a] = { sub: 7, sched: 'sch-a', subName: 'Netflix', schedName: 'Spotify', cycle: 1, every: 7, recur: { frequency: 'yearly' } };
  owned[b] = { sub: 8, sched: 'sch-b', subName: 'Bravoflix', schedName: 'Bravotunes', cycle: 2, every: 2, recur: { frequency: 'monthly', interval: 3 } };
  const ctx = { db: t.db, clock: t.clock };
  return { app, db: t.db, a, b, sa: signIn(ctx, a), sb: signIn(ctx, b), createSchedule, createSubscription };
}

describe('POST /api/sync/check', () => {
  it('answers 401 without a session', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: URL, payload: {}, headers: { origin: TEST_ORIGIN } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a session POST without the CSRF header', async () => {
    const { app, sa } = setup();
    const res = await app.inject({ method: 'POST', url: URL, headers: { origin: TEST_ORIGIN, cookie: sa.cookie } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a foreign Origin', async () => {
    const { app, sa } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: URL, headers: { origin: 'http://evil.example' } });
    expect(res.statusCode).toBe(403);
  });

  it('returns the response shape and never writes to Wallos or Actual', async () => {
    const { app, sa, createSchedule, createSubscription } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: URL });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(
      [
        'baseCurrency',
        'candidates',
        'checkedAt',
        'ignored',
        'linked',
        'mismatches',
        'orphaned',
        'unlinkedActual',
        'unlinkedWallos',
        'unmappable',
      ].sort(),
    );
    expect(createSchedule).not.toHaveBeenCalled();
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it('isolates two users: no foreign ids, no foreign rows updated', async () => {
    const { app, db, a, b, sa } = setup();
    const repoB = createUserRepo(db, b);
    const mb = repoB.insertMatch({
      wallosId: '8',
      actualScheduleId: 'sch-b',
      status: 'LINKED',
      lastKnownWallosHash: 'x'.repeat(64),
      lastKnownActualHash: 'y'.repeat(64),
    });
    const ib = repoB.insertMatch({ wallosId: null, actualScheduleId: 'sch-b-ignored', status: 'IGNORED_ACTUAL' });
    const ma = createUserRepo(db, a).insertMatch({ wallosId: '7', actualScheduleId: 'sch-a', status: 'LINKED' });
    const res = await injectAs(app, sa, { method: 'POST', url: URL, payload: { userId: b } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/"8"|sch-b|Bravo/);
    expect(res.body).not.toContain(mb.id);
    expect(res.body).not.toContain(ib.id);
    const body = res.json<{ baseCurrency: string; linked: { matchId: string }[]; ignored: unknown[] }>();
    expect(body.baseCurrency).toBe('EUR');
    expect(body.linked.map((l) => l.matchId)).toEqual([ma.id]);
    expect(body.ignored).toEqual([]);
    expect(repoB.getMatch(mb.id)).toMatchObject({
      status: 'LINKED',
      lastKnownWallosHash: 'x'.repeat(64),
      lastKnownActualHash: 'y'.repeat(64),
    });
    // A's own row got its baseline.
    expect(createUserRepo(db, a).getMatch(ma.id)?.lastKnownWallosHash).not.toBeNull();
  });

  it('maps a Wallos auth failure to 502 wallos_auth_failed with no secret text', async () => {
    const { app, sa } = setup({
      wallos: {
        listSubscriptions: () => Promise.reject(new WallosAuthError()),
        listPaymentMethods: async () => [],
        listCategories: async () => [],
        listCurrencies: () => Promise.resolve([]),
      } as unknown as WallosClient,
    });
    const res = await injectAs(app, sa, { method: 'POST', url: URL });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'wallos_auth_failed' });
    expect(res.body).not.toMatch(SECRETISH);
  });

  it('maps an unknown failure to a fixed 500 with no message', async () => {
    const { app, sa } = setup({
      withActual: () => Promise.reject(new Error('api_key=abc https://wallos.example Netflix 12.50')),
    });
    const res = await injectAs(app, sa, { method: 'POST', url: URL });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error' });
    expect(res.body).not.toMatch(SECRETISH);
  });
});

interface Item {
  id: string;
  cycle?: { key: string; count: number };
}
interface Body {
  unlinkedWallos: Item[];
  unlinkedActual: Item[];
  linked: Record<string, unknown>[];
  ignored: Record<string, unknown>[];
}

describe('POST /api/sync/check billing cycle (#136)', () => {
  it('includes a billing cycle for each unlinked Wallos subscription and Actual schedule', async () => {
    const { app, sa } = setup();
    const res = await injectAs(app, sa, { method: 'POST', url: URL });
    expect(res.statusCode).toBe(200);
    const body = res.json<Body>();
    expect(body.unlinkedWallos).toEqual([expect.objectContaining({ id: '7', cycle: { key: 'custom_days', count: 7 } })]);
    expect(body.unlinkedActual).toEqual([expect.objectContaining({ id: 'sch-a', cycle: { key: 'yearly', count: 1 } })]);
  });

  it('keeps user B\'s sync result free of user A\'s items and carries only B\'s cycles', async () => {
    const { app, sb } = setup();
    const res = await injectAs(app, sb, { method: 'POST', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/"7"|sch-a|Netflix|Spotify/);
    const body = res.json<Body>();
    expect(body.unlinkedWallos.map((i) => [i.id, i.cycle])).toEqual([['8', { key: 'weekly', count: 2 }]]);
    expect(body.unlinkedActual.map((i) => [i.id, i.cycle])).toEqual([['sch-b', { key: 'monthly', count: 3 }]]);
  });

  it('leaves linked and ignored rows without a cycle field', async () => {
    const { app, db, a, sa } = setup();
    const repo = createUserRepo(db, a);
    repo.insertMatch({ wallosId: '7', actualScheduleId: null, status: 'IGNORED_WALLOS' });
    repo.insertMatch({ wallosId: null, actualScheduleId: 'sch-a', status: 'IGNORED_ACTUAL' });
    const res = await injectAs(app, sa, { method: 'POST', url: URL });
    const body = res.json<Body>();
    expect(body.unlinkedWallos).toEqual([]);
    expect(body.unlinkedActual).toEqual([]);
    expect(body.ignored).toHaveLength(2);
    for (const row of body.ignored) expect(Object.keys(row)).not.toContain('cycle');
  });
});

import { afterAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, HTTPMethods, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { CreateDeps } from '../integrations/create.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn, type SignedIn } from '../test/auth-helpers.js';

/*
 * Route-level tenant isolation (#55). User A is signed in and aims at user B's configs, matches and
 * sessions. Every /api route that exists at runtime must have a case below or an explicit exemption.
 * The route list is read from Fastify's onRoute hook, never typed out, so a new route without a case
 * fails "every registered /api route is covered". The repo-level suite is db/tenant-isolation.test.ts.
 */

// ---------------------------------------------------------------------------------------------
// Runtime world: two users, B's data, fakes that record which user every outside call was for.
// ---------------------------------------------------------------------------------------------

const B_SUB_ID = 90210;
const B_SCHEDULE_ID = 'sch-b-secret';
const B_WALLOS_URL = 'https://wallos-b-secret.example.com';
const B_ACTUAL_URL = 'https://actual-b-secret.example.com';
const B_ISSUER = 'https://issuer-b-secret.example.com';
const B_SUBJECT = 'subject-b-secret';
const HASH_B1 = 'e'.repeat(64);
const HASH_B2 = 'f'.repeat(64);

interface Route {
  readonly method: string;
  readonly url: string;
  readonly isPublic: boolean;
}

function wallosSub(id: number) {
  return {
    id,
    name: 'B-Secret-Netflix',
    price: '12.50',
    currency_id: 1,
    cycle: 3,
    frequency: 1,
    next_payment: '2026-11-03',
    start_date: '2026-01-01',
    inactive: 0,
  };
}

/** Builds the real app with every optional route group on, and records the routes it registers. */
function buildEnv() {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  void t.app.close();
  const { db } = t;

  const a = makeUser(db, 'user-a@example.test');
  const b = makeUser(db, 'user-b-secret@example.test');

  /** Every user id an outside call (Wallos or Actual) was made for. */
  const remoteCalls: string[] = [];
  const writes = { createSchedule: vi.fn(), createSubscription: vi.fn() };
  const actualApi = (userId: string) => ({
    getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }),
    getBudgets: async () => [{ groupId: `sync-${userId}`, name: `Budget of ${userId}` }],
    getSchedules: async () =>
      userId === b
        ? [
            {
              id: B_SCHEDULE_ID,
              name: 'B-Secret-Netflix',
              amount: -1250,
              amountOp: 'is',
              date: { frequency: 'monthly', interval: 1, start: '2026-01-01' },
            },
          ]
        : [],
  });
  const withActual = (userId: string, use: (api: never) => Promise<unknown>) => {
    remoteCalls.push(userId);
    return use(actualApi(userId) as never);
  };
  const wallos = {
    listSubscriptions: async (userId: string) => {
      remoteCalls.push(userId);
      return userId === b ? [wallosSub(B_SUB_ID)] : [];
    },
    listCurrencies: async (userId: string) => {
      remoteCalls.push(userId);
      return [{ id: 1, code: 'EUR', rate: '1' }];
    },
    createSubscription: writes.createSubscription,
  };
  const repoFor = (id: string) => createUserRepo(db, id);
  const integrations = {
    wallos,
    repoFor,
    withActual,
    createSchedule: writes.createSchedule,
  } as unknown as CreateDeps;

  const app = buildApp({
    db,
    integrations,
    settings: {
      repoFor,
      wallos,
      appSecret: 'test-app-secret-value-0123456789abcdef',
      actual: { withActualServer: withActual as never, withActual: withActual as never },
    },
    auth: {
      mode: 'local',
      secureCookies: false,
      allowRegistration: false,
      publicOrigin: t.publicOrigin,
      now: () => t.clock.now(),
    },
  });

  // Added before the first ready(), so plugin-registered routes inherit it.
  const routes: Route[] = [];
  app.addHook('onRoute', (route) => {
    const methods: HTTPMethods[] = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      routes.push({ method, url: route.url, isPublic: route.config?.public === true });
    }
  });

  // B's data. A owns nothing.
  const repoB = repoFor(b);
  repoB.upsertConfig({
    wallosUrl: B_WALLOS_URL,
    wallosApiKeyEnc: 'v1:b-wallos-key-ciphertext',
    actualUrl: B_ACTUAL_URL,
    actualPasswordEnc: 'v1:b-actual-pass-ciphertext',
    actualSyncKeyEnc: 'v1:b-actual-sync-ciphertext',
    actualBudgetId: 'b-budget-secret',
    tolerancePercent: 17,
  });
  const matchOf = (
    status: 'LINKED' | 'MISMATCH_DETECTED' | 'IGNORED_WALLOS' | 'IGNORED_ACTUAL',
    wallosId: string | null,
    actualScheduleId: string | null,
  ) =>
    repoB.insertMatch({
      wallosId,
      actualScheduleId,
      status,
      lastKnownWallosHash: wallosId === null ? null : HASH_B1,
      lastKnownActualHash: actualScheduleId === null ? null : HASH_B2,
    });
  const linked = matchOf('LINKED', String(B_SUB_ID), B_SCHEDULE_ID);
  const mismatch = matchOf('MISMATCH_DETECTED', '90211', 'sch-b-2');
  const ignoredWallos = matchOf('IGNORED_WALLOS', '90212', null);
  const ignoredActual = matchOf('IGNORED_ACTUAL', null, 'sch-b-4');
  repoB.linkIdentity(B_ISSUER, B_SUBJECT);
  repoB.upsertSubscriptionOverride(String(B_SUB_ID), { rate: '1.0850', now: new Date(0) });
  const sb1 = signIn(t, b);
  const sb2 = signIn(t, b);
  const sa = signIn(t, a);

  const leakMarkers = [
    'b-secret',
    B_WALLOS_URL,
    B_ACTUAL_URL,
    B_ISSUER,
    B_SUBJECT,
    B_SCHEDULE_ID,
    String(B_SUB_ID),
    'b-budget-secret',
    'ciphertext',
    HASH_B1,
    HASH_B2,
    linked.id,
    mismatch.id,
    ignoredWallos.id,
    ignoredActual.id,
    sb1.token,
    sb1.csrfToken,
    sb2.token,
    sb2.csrfToken,
    b,
  ];

  return {
    app,
    db,
    a,
    b,
    sa,
    routes,
    remoteCalls,
    writes,
    leakMarkers,
    matches: { linked, mismatch, ignoredWallos, ignoredActual },
  };
}

type Env = ReturnType<typeof buildEnv>;

const B_TABLES = [
  ['users', 'id'],
  ['user_configs', 'user_id'],
  ['matches', 'user_id'],
  ['sessions', 'user_id'],
  ['user_identities', 'user_id'],
  ['email_verifications', 'user_id'],
  ['subscription_overrides', 'user_id'],
  ['overwrite_snapshots', 'user_id'],
] as const;

/** Every row B owns, as the raw database holds it. Includes session rows and password hashes. */
function snapshotOf(db: AppDatabase, userId: string): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [table, column] of B_TABLES) {
    out[table] = db.$client.prepare(`select * from ${table} where ${column} = ? order by 1`).all(userId);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The case table. Keys are "METHOD pattern" exactly as Fastify reports them.
// ---------------------------------------------------------------------------------------------

interface Attempt {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly url: string;
  readonly payload?: object;
  /** Allowed statuses. A tenant breach shows up as a different one (a 200, 409, 400 invalid_state). */
  readonly status: readonly number[];
  /** Exact `error` code the body must carry, when there is one. */
  readonly error?: string;
  /** Extra checks on the parsed response. */
  readonly verify?: (res: LightMyRequestResponse, env: Env) => void;
}

interface Case {
  /** Why A's request cannot reach B's data. */
  readonly why: string;
  readonly attempts: (env: Env) => Attempt[];
  /** Runs after all attempts, with A's and B's state. */
  readonly after?: (env: Env) => void;
}

const NOT_FOUND = [404] as const;

const CASES: Record<string, Case> = {
  'GET /api/account': {
    why: 'view is built from the session user; B email and identities must not appear',
    attempts: () => [
      {
        method: 'GET',
        url: '/api/account',
        status: [200],
        verify: (res) => {
          expect(res.json()).toEqual({
            email: 'user-a@example.test',
            mode: 'local',
            hasPassword: false,
            identities: [],
          });
        },
      },
    ],
  },
  'PUT /api/account/password': {
    why: 'password is read and written for the session user only; a userId in the body is ignored',
    attempts: ({ b }) => [
      {
        method: 'PUT',
        url: '/api/account/password',
        payload: { currentPassword: 'whatever-long-password', newPassword: 'another-long-password', userId: b },
        status: [401],
        error: 'invalid_credentials',
      },
    ],
  },
  'GET /api/auth/me': {
    why: 'answers for the session user only',
    attempts: () => [
      {
        method: 'GET',
        url: '/api/auth/me',
        status: [200],
        verify: (res) => {
          expect(res.json()).toEqual({ email: 'user-a@example.test', authMethod: 'local' });
        },
      },
    ],
  },
  'POST /api/auth/logout': {
    why: 'deletes the caller session only; there is no way to name another session',
    attempts: ({ b }) => [
      { method: 'POST', url: '/api/auth/logout', payload: { userId: b }, status: [204] },
    ],
    after: ({ db, a }) => {
      const left = db.$client.prepare('select count(*) as n from sessions where user_id = ?').get(a) as {
        n: number;
      };
      expect(left.n).toBe(0);
    },
  },
  'GET /api/settings/wallos': {
    why: 'config is read by session user id; A has none, so the view is empty',
    attempts: () => [
      {
        method: 'GET',
        url: '/api/settings/wallos',
        status: [200],
        verify: (res) => {
          expect(res.json()).toEqual({ wallosUrl: '', hasWallosApiKey: false });
        },
      },
    ],
  },
  'PUT /api/settings/wallos': {
    why: 'upsert is bound to the session user; a userId in the body is ignored',
    attempts: ({ b }) => [
      {
        method: 'PUT',
        url: '/api/settings/wallos',
        payload: { wallosUrl: 'https://wallos-a.example.com', apiKey: 'a-key', userId: b },
        status: [200],
        verify: (res) => {
          expect(res.json()).toEqual({ wallosUrl: 'https://wallos-a.example.com', hasWallosApiKey: true });
        },
      },
    ],
  },
  'POST /api/settings/wallos/test': {
    why: 'tests the saved credentials of the session user; the Wallos client gets that id',
    attempts: () => [{ method: 'POST', url: '/api/settings/wallos/test', status: [200] }],
  },
  'GET /api/settings/matching': {
    why: 'tolerance is read for the session user; A sees the default, not B (17)',
    attempts: () => [
      {
        method: 'GET',
        url: '/api/settings/matching',
        status: [200],
        verify: (res) => {
          expect(res.json()).toEqual({ tolerancePercent: 5 });
        },
      },
    ],
  },
  'PUT /api/settings/matching': {
    why: 'upsert is bound to the session user',
    attempts: ({ b }) => [
      {
        method: 'PUT',
        url: '/api/settings/matching',
        payload: { tolerancePercent: 9, userId: b },
        status: [200],
        verify: (res) => {
          expect(res.json()).toEqual({ tolerancePercent: 9 });
        },
      },
    ],
  },
  'GET /api/settings/actual': {
    why: 'config is read for the session user; A has none',
    attempts: () => [
      {
        method: 'GET',
        url: '/api/settings/actual',
        status: [200],
        verify: (res) => {
          expect(res.json()).toEqual({
            actualUrl: '',
            actualBudgetId: null,
            hasActualPassword: false,
            hasActualSyncKey: false,
          });
        },
      },
    ],
  },
  'PUT /api/settings/actual': {
    why: 'upsert is bound to the session user; a userId or B budget id in the body does not reach B',
    attempts: ({ b }) => [
      {
        method: 'PUT',
        url: '/api/settings/actual',
        payload: { actualUrl: 'https://actual-a.example.com', password: 'a-pass', actualBudgetId: 'a-budget', userId: b },
        status: [200],
      },
    ],
  },
  'POST /api/settings/actual/budgets': {
    why: 'opens the server of the session user only',
    attempts: () => [{ method: 'POST', url: '/api/settings/actual/budgets', status: [200] }],
  },
  'POST /api/settings/actual/base-currency': {
    why: 'opens the budget of the session user only',
    attempts: () => [{ method: 'POST', url: '/api/settings/actual/base-currency', status: [200] }],
  },
  'POST /api/integrations/actual-schedules': {
    why: "A's Wallos list does not hold B's subscription, so it is not found and nothing is created",
    attempts: () => [
      {
        method: 'POST',
        url: '/api/integrations/actual-schedules',
        payload: { wallosSubscriptionId: String(B_SUB_ID), accountId: 'acc', payee: { kind: 'new', name: 'x' } },
        status: NOT_FOUND,
        error: 'wallos_subscription_not_found',
      },
    ],
    after: ({ writes }) => {
      expect(writes.createSchedule).not.toHaveBeenCalled();
    },
  },
  'POST /api/integrations/wallos-subscriptions': {
    why: "A's budget does not hold B's schedule, so it is not found and nothing is created",
    attempts: () => [
      {
        method: 'POST',
        url: '/api/integrations/wallos-subscriptions',
        payload: { scheduleId: B_SCHEDULE_ID },
        status: NOT_FOUND,
        error: 'schedule_not_found',
      },
    ],
    after: ({ writes }) => {
      expect(writes.createSubscription).not.toHaveBeenCalled();
    },
  },
  'POST /api/integrations/actual-schedules/prefill': {
    why: "A's Wallos list does not hold B's subscription: not found, read-only, no write client called",
    attempts: () => [
      {
        method: 'POST',
        url: '/api/integrations/actual-schedules/prefill',
        payload: { wallosSubscriptionId: String(B_SUB_ID) },
        status: NOT_FOUND,
        error: 'wallos_subscription_not_found',
      },
    ],
    after: ({ writes }) => {
      expect(writes.createSchedule).not.toHaveBeenCalled();
      expect(writes.createSubscription).not.toHaveBeenCalled();
    },
  },
  'POST /api/integrations/wallos-subscriptions/prefill': {
    why: "A's budget does not hold B's schedule: not found, read-only, no write client called",
    attempts: () => [
      {
        method: 'POST',
        url: '/api/integrations/wallos-subscriptions/prefill',
        payload: { scheduleId: B_SCHEDULE_ID },
        status: NOT_FOUND,
        error: 'schedule_not_found',
      },
    ],
    after: ({ writes }) => {
      expect(writes.createSchedule).not.toHaveBeenCalled();
      expect(writes.createSubscription).not.toHaveBeenCalled();
    },
  },
  'POST /api/sync/check': {
    why: "runs for the session user; B's matches and remote items never appear in A's result",
    attempts: () => [
      {
        method: 'POST',
        url: '/api/sync/check',
        status: [200],
        verify: (res) => {
          const body = res.json<Record<string, unknown>>();
          for (const key of [
            'unlinkedWallos',
            'unlinkedActual',
            'candidates',
            'mismatches',
            'unmappable',
            'orphaned',
            'linked',
            'ignored',
          ]) {
            expect(body[key], key).toEqual([]);
          }
        },
      },
    ],
  },
  'POST /api/matches': {
    why: "the 409 pre-check is scoped, then A's remote lacks B's items: item_not_found, never already_matched",
    attempts: () => [
      {
        method: 'POST',
        url: '/api/matches',
        payload: { wallosId: String(B_SUB_ID), actualScheduleId: B_SCHEDULE_ID },
        // 400 item_not_found: the ids do not exist in A's Wallos or budget. 409 would mean B's row leaked.
        status: [400],
        error: 'item_not_found',
      },
    ],
  },
  'POST /api/matches/ignore': {
    why: "the 409 pre-check is scoped: B's row on the same item does not block A, and the new row is A's",
    attempts: ({ a }) => [
      ...(['wallos', 'actual'] as const).map((side) => ({
        method: 'POST' as const,
        url: '/api/matches/ignore',
        payload: { side, itemId: side === 'wallos' ? String(B_SUB_ID) : B_SCHEDULE_ID },
        status: [201],
        verify: (res: LightMyRequestResponse, env: Env) => {
          const { id } = res.json<{ id: string }>();
          const owner = env.db.$client.prepare('select user_id as u from matches where id = ?').get(id) as {
            u: string;
          };
          expect(owner.u).toBe(a);
        },
      })),
    ],
  },
  'POST /api/matches/:id/resolve': {
    why: "the row lookup is id AND user_id: B's ids give 404 match_not_found, not invalid_state",
    attempts: ({ matches: m }) => [
      {
        method: 'POST',
        url: `/api/matches/${m.mismatch.id}/resolve`,
        payload: { action: 'ignore_diff' },
        status: NOT_FOUND,
        error: 'match_not_found',
      },
      {
        method: 'POST',
        url: `/api/matches/${m.mismatch.id}/resolve`,
        payload: { action: 'unlink', confirm: true },
        status: NOT_FOUND,
        error: 'match_not_found',
      },
      ...(['overwrite_wallos', 'overwrite_actual'] as const).map((action) => ({
        method: 'POST' as const,
        url: `/api/matches/${m.mismatch.id}/resolve`,
        payload: { action, confirm: true },
        status: NOT_FOUND,
        error: 'match_not_found',
      })),
      {
        method: 'POST',
        url: `/api/matches/${m.linked.id}/resolve`,
        payload: { action: 'unlink', confirm: true },
        status: NOT_FOUND,
        error: 'match_not_found',
      },
      {
        method: 'POST',
        url: `/api/matches/${m.ignoredWallos.id}/resolve`,
        payload: { action: 'unlink', confirm: true },
        status: NOT_FOUND,
        error: 'match_not_found',
      },
    ],
  },
  'POST /api/matches/:id/relink': {
    why: "the row lookup is id AND user_id: B's ids give 404 match_not_found before any remote read",
    attempts: ({ matches: m }) => [
      {
        method: 'POST',
        url: `/api/matches/${m.linked.id}/relink`,
        payload: { itemId: String(B_SUB_ID) },
        status: NOT_FOUND,
        error: 'match_not_found',
      },
      {
        method: 'POST',
        url: `/api/matches/${m.mismatch.id}/relink`,
        payload: { itemId: B_SCHEDULE_ID },
        status: NOT_FOUND,
        error: 'match_not_found',
      },
    ],
  },
  'GET /api/overrides/:wallosSubscriptionId': {
    why: "the override lookup is user_id AND wallos id: B's subscription id gives 404 for A",
    attempts: () => [
      {
        method: 'GET',
        url: `/api/overrides/${String(B_SUB_ID)}`,
        status: NOT_FOUND,
        error: 'not_found',
      },
    ],
  },
  'PUT /api/overrides/:wallosSubscriptionId': {
    why: "the save and the hash reset are bound to the session user; B's override and LINKED hashes stay as they were (same-id cross-user PUT is in overrides.test.ts, where echoing the id is not a leak)",
    attempts: () => [
      {
        method: 'PUT',
        url: '/api/overrides/a-own-sub',
        payload: { rate: '3.5' },
        status: [200],
        verify: (res) => {
          expect(res.json()).toEqual({ wallosSubscriptionId: 'a-own-sub', rate: '3.5', resetMatches: 0 });
        },
      },
    ],
  },
  'DELETE /api/overrides/:wallosSubscriptionId': {
    why: "the delete is user_id AND wallos id: B's override is not A's to remove, 404 and B's row is kept",
    attempts: () => [
      {
        method: 'DELETE',
        url: `/api/overrides/${String(B_SUB_ID)}`,
        status: NOT_FOUND,
        error: 'not_found',
      },
    ],
  },
  'DELETE /api/matches/:id': {
    why: "the row lookup is id AND user_id: B's ids give 404, even for a LINKED row (which would be invalid_state)",
    attempts: ({ matches: m }) =>
      [m.ignoredWallos, m.ignoredActual, m.linked, m.mismatch].map((row) => ({
        method: 'DELETE' as const,
        url: `/api/matches/${row.id}`,
        status: NOT_FOUND,
        error: 'match_not_found',
      })),
  },
};

/** Routes that are public on purpose: no session, so no user whose data they could return. */
const EXEMPT: Record<string, string> = {
  'GET /api/health': 'liveness probe; constant body, reads no user data',
  'GET /api/auth/config': 'login page bootstrap; returns server mode and registration flag only',
  'POST /api/auth/register': 'pre-session sign-up; always answers 202 or 403, covered by auth-local.test.ts',
  'POST /api/auth/verify-email': 'pre-session link; token is the credential, covered by auth-verify.test.ts',
  'POST /api/auth/login': 'pre-session sign-in; identical 401s, covered by auth-local.test.ts',
  'GET /api/auth/oidc/login': 'pre-session redirect to the identity provider; covered by oidc.test.ts',
  'GET /api/auth/oidc/callback': 'pre-session callback; identity mapping covered by oidc.test.ts',
};

// ---------------------------------------------------------------------------------------------
// Discovery. Runs once when the file loads, against the real app.
// ---------------------------------------------------------------------------------------------

const keyOf = (r: Pick<Route, 'method' | 'url'>) => `${r.method} ${r.url}`;

const discovery = buildEnv();
await discovery.app.ready();
const discovered = [...discovery.routes];
await discovery.app.close();
closeDatabase(discovery.db);

/**
 * Fastify adds HEAD for every GET and OPTIONS is not used. A HEAD twin runs its GET's handler and
 * sends no body, so the GET case covers it. Anything else under /api is a real route.
 */
const apiRoutes = new Map<string, Route>();
for (const r of discovered) {
  if (!r.url.startsWith('/api')) continue;
  if (r.method === 'HEAD' && discovered.some((g) => g.method === 'GET' && g.url === r.url)) continue;
  apiRoutes.set(keyOf(r), r);
}

const open: Env[] = [];
afterAll(async () => {
  for (const env of open.splice(0)) {
    await env.app.close();
    closeDatabase(env.db);
  }
});

async function fire(app: FastifyInstance, session: SignedIn, attempt: Attempt) {
  return injectAs(app, session, {
    method: attempt.method,
    url: attempt.url,
    ...(attempt.payload === undefined ? {} : { payload: attempt.payload }),
  });
}

describe('route-level tenant isolation', () => {
  it('discovers routes at runtime', () => {
    expect(apiRoutes.size).toBeGreaterThan(0);
    // Sanity: the groups registered by buildApp's optional options are all present.
    for (const key of ['GET /api/health', 'POST /api/matches', 'PUT /api/settings/actual', 'POST /api/sync/check']) {
      expect(apiRoutes.has(key), key).toBe(true);
    }
  });

  it('every registered /api route has a case or an explicit exemption', () => {
    const missing = [...apiRoutes.keys()].filter((k) => !(k in CASES) && !(k in EXEMPT));
    expect(missing, 'routes with no tenant isolation case: add a CASES entry (or an EXEMPT reason)').toEqual([]);
  });

  it('no case or exemption is stale, and no route is both', () => {
    const stale = [...Object.keys(CASES), ...Object.keys(EXEMPT)].filter((k) => !apiRoutes.has(k));
    expect(stale, 'cases or exemptions for routes that no longer exist').toEqual([]);
    expect(Object.keys(CASES).filter((k) => k in EXEMPT)).toEqual([]);
  });

  it('exemptions are exactly the routes marked config.public', () => {
    const publicRoutes = [...apiRoutes.values()].filter((r) => r.isPublic).map(keyOf).sort();
    expect(Object.keys(EXEMPT).sort()).toEqual(publicRoutes);
    for (const [key, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, key).toBeGreaterThan(10);
    }
  });

  describe.each([...apiRoutes.values()].filter((r) => !r.isPublic).map(keyOf))('%s', (key) => {
    it("user A cannot read or change user B's rows", async () => {
      const spec = CASES[key];
      expect(spec, `no tenant isolation case for ${key}`).toBeDefined();
      if (spec === undefined) return;

      const env = buildEnv();
      open.push(env);
      await env.app.ready();
      const before = snapshotOf(env.db, env.b);
      expect(before['sessions']?.length).toBe(2);
      expect(before['matches']?.length).toBe(4);

      const attempts = spec.attempts(env);
      expect(attempts.length).toBeGreaterThan(0);
      for (const attempt of attempts) {
        const label = `${attempt.method} ${attempt.url}`;
        // The case must target the route it is filed under.
        const pattern = key.slice(key.indexOf(' ') + 1).replace(/:[^/]+/g, '[^/]+');
        expect(attempt.method, label).toBe(key.slice(0, key.indexOf(' ')));
        expect(attempt.url, label).toMatch(new RegExp(`^${pattern}$`));

        const res = await fire(env.app, env.sa, attempt);
        expect(attempt.status, `${label} -> ${String(res.statusCode)} ${res.body}`).toContain(res.statusCode);
        if (attempt.error !== undefined) {
          expect(res.json(), label).toEqual({ error: attempt.error });
        }
        const body = res.body.toLowerCase();
        for (const marker of env.leakMarkers) {
          expect(body.includes(marker.toLowerCase()), `${label} leaked ${marker}`).toBe(false);
        }
        attempt.verify?.(res, env);
      }
      spec.after?.(env);

      // Every Wallos or Actual call, and so every credential lookup behind it, was for A.
      expect(env.remoteCalls.filter((id) => id !== env.a)).toEqual([]);
      // B's rows are byte for byte what they were: configs, matches, sessions, identities, hash.
      expect(snapshotOf(env.db, env.b)).toEqual(before);
    });
  });
});

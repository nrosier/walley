import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { ActualApi } from '../integrations/actual/session.js';
import { injectAs, makeClock, makeUser, signIn, type SignedIn, TEST_ORIGIN } from '../test/auth-helpers.js';

// Fake secrets, easy to search for. None of them may appear in any settings or account response.
const WALLOS_KEY = 'sekret-wallos-key-AAAA-1234567890';
const ACTUAL_PASSWORD = 'sekret-actual-pass-BBBB-0987654321';
const ACTUAL_SYNC_KEY = 'sekret-actual-sync-CCCC-5555666677';
const WALLOS_URL = 'https://wallos.example.com';
const ACTUAL_URL = 'https://actual.example.com';
const APP_SECRET = 'test-app-secret-value-0123456789abcdef';
const PLAIN_SECRETS = [WALLOS_KEY, ACTUAL_PASSWORD, ACTUAL_SYNC_KEY, 'sekret'];

const open: { close(): Promise<unknown>; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    closeDatabase(a.db);
  }
});

function setup() {
  const db = openDatabase(':memory:');
  const clock = makeClock();
  const api = {
    getBudgets: vi.fn().mockResolvedValue([]),
    getPreferences: vi.fn().mockResolvedValue({ defaultCurrencyCode: 'EUR' }),
  } as unknown as ActualApi;
  const app = buildApp({
    db,
    auth: {
      mode: 'local',
      secureCookies: false,
      allowRegistration: false,
      publicOrigin: 'http://localhost:3000',
      now: () => clock.now(),
    },
    settings: {
      repoFor: (id) => createUserRepo(db, id),
      wallos: { listCurrencies: vi.fn().mockResolvedValue([]) },
      appSecret: APP_SECRET,
      actual: {
        withActualServer: vi.fn((_userId: string, use: (a: ActualApi) => Promise<unknown>) => use(api)) as never,
        withActual: vi.fn((_userId: string, use: (a: ActualApi) => Promise<unknown>) => use(api)) as never,
      },
    },
  });
  open.push({ close: () => app.close(), db });
  const userId = makeUser(db);
  const session: SignedIn = signIn({ db, clock }, userId);
  return { app, db, userId, session };
}

type S = ReturnType<typeof setup>;

/** Seeds one user with real-looking secrets through the PUT routes, then returns the stored ciphertexts. */
async function seed(s: S) {
  const wallos = await injectAs(s.app, s.session, {
    method: 'PUT',
    url: '/api/settings/wallos',
    payload: { wallosUrl: WALLOS_URL, apiKey: WALLOS_KEY },
  });
  const actual = await injectAs(s.app, s.session, {
    method: 'PUT',
    url: '/api/settings/actual',
    payload: {
      actualUrl: ACTUAL_URL,
      password: ACTUAL_PASSWORD,
      syncKey: ACTUAL_SYNC_KEY,
      actualBudgetId: 'budget-1',
    },
  });
  expect(wallos.statusCode).toBe(200);
  expect(actual.statusCode).toBe(200);
  const config = createUserRepo(s.db, s.userId).getConfig();
  const ciphertexts = [
    config?.wallosApiKeyEnc,
    config?.actualPasswordEnc,
    config?.actualSyncKeyEnc,
  ].filter((v): v is string => typeof v === 'string');
  // The stored values must be real ciphertext, or the audit below proves nothing.
  expect(ciphertexts).toHaveLength(3);
  for (const c of ciphertexts) expect(c.startsWith('v1:')).toBe(true);
  return ciphertexts;
}

function expectNoSecrets(label: string, body: string, ciphertexts: string[]): void {
  for (const secret of PLAIN_SECRETS) {
    expect(body, `${label} leaked a plain secret`).not.toContain(secret);
  }
  expect(body, `${label} leaked a v1: ciphertext prefix`).not.toContain('v1:');
  for (const c of ciphertexts) {
    expect(body, `${label} leaked a stored ciphertext`).not.toContain(c);
  }
}

describe('response audit: no secret values in settings or account responses', () => {
  it('every authenticated GET and PUT for settings or account has no secret or v1: prefix', async () => {
    const s = setup();
    const ciphertexts = await seed(s);

    const requests = [
      { label: 'GET /api/settings/wallos', method: 'GET' as const, url: '/api/settings/wallos' },
      { label: 'PUT /api/settings/wallos', method: 'PUT' as const, url: '/api/settings/wallos', payload: { wallosUrl: WALLOS_URL, apiKey: WALLOS_KEY } },
      { label: 'GET /api/settings/actual', method: 'GET' as const, url: '/api/settings/actual' },
      { label: 'PUT /api/settings/actual', method: 'PUT' as const, url: '/api/settings/actual', payload: { actualUrl: ACTUAL_URL, password: ACTUAL_PASSWORD, syncKey: ACTUAL_SYNC_KEY, actualBudgetId: 'budget-1' } },
      { label: 'GET /api/settings/matching', method: 'GET' as const, url: '/api/settings/matching' },
      { label: 'PUT /api/settings/matching', method: 'PUT' as const, url: '/api/settings/matching', payload: { tolerancePercent: 5 } },
      { label: 'GET /api/account', method: 'GET' as const, url: '/api/account' },
      { label: 'PUT /api/account/password', method: 'PUT' as const, url: '/api/account/password', payload: { currentPassword: 'sekret-current-pass-DDDD', newPassword: 'sekret-new-pass-EEEE-1234' } },
    ];

    for (const r of requests) {
      const res = await injectAs(s.app, s.session, {
        method: r.method,
        url: r.url,
        headers: { origin: TEST_ORIGIN },
        ...(r.payload === undefined ? {} : { payload: r.payload }),
      });
      // Only the status and body are audited; a non-2xx would still have to be secret-free.
      expectNoSecrets(r.label, res.body, ciphertexts);
    }
  });
});

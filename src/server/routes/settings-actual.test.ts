import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import { ActualSessionError, type ActualApi } from '../integrations/actual/session.js';
import { injectAs, makeAuthApp, makeUser, signIn, TEST_ORIGIN, type AuthApp } from '../test/auth-helpers.js';
import { settingsActualRoutes } from './settings-actual.js';

const PW_A = 'sekret-pass-AAAA-1234567890';
const PW_B = 'sekret-pass-BBBB-0987654321';
const SK_A = 'sekret-sync-AAAA-1234567890';
const SK_A2 = 'sekret-sync-AAAA-second-key';
const URL_A = 'https://actual-a.example.com';
const URL_B = 'https://actual-b.example.com';
const PATH = '/api/settings/actual';
const SECRETS = [PW_A, PW_B, SK_A, SK_A2, 'sekret', 'v1:'];

const created: AuthApp[] = [];
afterEach(async () => {
  for (const t of created.splice(0)) {
    await t.app.close();
    closeDatabase(t.db);
  }
});

type Use = (api: ActualApi) => Promise<unknown>;

async function setup() {
  const t = makeAuthApp();
  const getBudgets = vi.fn().mockResolvedValue([
    { id: 'local-1', groupId: 'sync-1', name: 'Home', owner: 'secret-owner', encryptKeyId: 'k1' },
    { cloudFileId: 'cf-1', groupId: 'sync-1', name: 'Home', state: 'remote' },
    { cloudFileId: 'cf-2', groupId: 'sync-2', name: 'Work', state: 'remote' },
    { id: 'local-only', name: 'No sync' },
  ]);
  const getPreferences = vi.fn().mockResolvedValue({ defaultCurrencyCode: 'EUR' });
  const api = { getBudgets, getPreferences } as unknown as ActualApi;
  const withActualServer = vi.fn((_userId: string, use: Use) => use(api));
  const withActual = vi.fn((_userId: string, use: Use) => use(api));
  // Registered after buildApp, so the session, deny and CSRF hooks apply to it.
  void t.app.register(settingsActualRoutes, {
    prefix: '/api',
    deps: {
      repoFor: (id) => createUserRepo(t.db, id),
      appSecret: 'test-app-secret-value-0123456789abcdef',
      withActualServer: withActualServer as never,
      withActual: withActual as never,
    },
  });
  await t.app.ready();
  created.push(t);
  const a = makeUser(t.db);
  const b = makeUser(t.db);
  return {
    ...t,
    a,
    b,
    sa: signIn(t, a),
    sb: signIn(t, b),
    withActualServer,
    withActual,
    getBudgets,
    getPreferences,
  };
}

type S = Awaited<ReturnType<typeof setup>>;

const put = (s: S, who: 'sa' | 'sb', payload: unknown) =>
  injectAs(s.app, s[who], { method: 'PUT', url: PATH, payload: payload as never });
const post = (s: S, who: 'sa' | 'sb', sub: 'budgets' | 'base-currency') =>
  injectAs(s.app, s[who], { method: 'POST', url: `${PATH}/${sub}` });
const config = (s: S, id: string) => createUserRepo(s.db, id).getConfig();

function expectNoSecrets(body: string): void {
  for (const secret of SECRETS) expect(body).not.toContain(secret);
}

describe('settings-actual routes', () => {
  it('401 without a session', async () => {
    const s = await setup();
    for (const [method, url] of [
      ['GET', PATH],
      ['PUT', PATH],
      ['POST', `${PATH}/budgets`],
      ['POST', `${PATH}/base-currency`],
    ] as const) {
      const res = await s.app.inject({ method, url, headers: { origin: TEST_ORIGIN } });
      expect(res.statusCode).toBe(401);
    }
    expect(s.withActualServer).not.toHaveBeenCalled();
    expect(s.withActual).not.toHaveBeenCalled();
  });

  it('403 without CSRF or with a foreign Origin', async () => {
    const s = await setup();
    const noCsrf = await s.app.inject({
      method: 'PUT',
      url: PATH,
      headers: { origin: TEST_ORIGIN, cookie: s.sa.cookie },
      payload: { actualUrl: URL_A, password: PW_A },
    });
    expect(noCsrf.statusCode).toBe(403);
    for (const sub of ['budgets', 'base-currency']) {
      const noToken = await s.app.inject({
        method: 'POST',
        url: `${PATH}/${sub}`,
        headers: { origin: TEST_ORIGIN, cookie: s.sa.cookie },
      });
      expect(noToken.statusCode).toBe(403);
      const foreign = await injectAs(s.app, s.sa, {
        method: 'POST',
        url: `${PATH}/${sub}`,
        headers: { origin: 'https://evil.example' },
      });
      expect(foreign.statusCode).toBe(403);
    }
    const foreignPut = await injectAs(s.app, s.sa, {
      method: 'PUT',
      url: PATH,
      headers: { origin: 'https://evil.example' },
      payload: { actualUrl: URL_A, password: PW_A },
    });
    expect(foreignPut.statusCode).toBe(403);
    expect(s.withActualServer).not.toHaveBeenCalled();
    expect(s.withActual).not.toHaveBeenCalled();
    expect(config(s, s.a)).toBeUndefined();
  });

  it('GET and PUT return only the url, budget id and booleans', async () => {
    const s = await setup();
    const empty = await injectAs(s.app, s.sa, { method: 'GET', url: PATH });
    expect(empty.json()).toEqual({
      actualUrl: '',
      actualBudgetId: null,
      hasActualPassword: false,
      hasActualSyncKey: false,
    });
    const saved = await put(s, 'sa', { actualUrl: URL_A, password: PW_A, syncKey: SK_A });
    expect(saved.statusCode).toBe(200);
    await put(s, 'sa', { actualUrl: URL_A, actualBudgetId: 'sync-1' });
    const res = await injectAs(s.app, s.sa, { method: 'GET', url: PATH });
    expect(res.json()).toEqual({
      actualUrl: URL_A,
      actualBudgetId: 'sync-1',
      hasActualPassword: true,
      hasActualSyncKey: true,
    });
    expect(Object.keys(res.json<object>()).sort()).toEqual(
      ['actualBudgetId', 'actualUrl', 'hasActualPassword', 'hasActualSyncKey'],
    );
    for (const body of [saved.body, res.body]) expectNoSecrets(body);
    const stored = config(s, s.a);
    for (const enc of [stored?.actualPasswordEnc ?? '', stored?.actualSyncKeyEnc ?? '']) {
      expect(enc.startsWith('v1:')).toBe(true);
      expect(enc).not.toContain(PW_A);
      expect(enc).not.toContain(SK_A);
    }
  });

  it('blank or missing secrets keep the stored values', async () => {
    const s = await setup();
    await put(s, 'sa', { actualUrl: URL_A, password: PW_A, syncKey: SK_A });
    const before = config(s, s.a);
    for (const payload of [
      { actualUrl: URL_A },
      { actualUrl: URL_A, password: '', syncKey: '' },
      { actualUrl: URL_A, password: '   ', syncKey: null },
      { actualUrl: URL_A, clearSyncKey: false },
    ]) {
      const res = await put(s, 'sa', payload);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ hasActualPassword: true, hasActualSyncKey: true });
    }
    const after = config(s, s.a);
    expect(after?.actualPasswordEnc).toBe(before?.actualPasswordEnc);
    expect(after?.actualSyncKeyEnc).toBe(before?.actualSyncKeyEnc);
    await put(s, 'sa', { actualUrl: URL_A, syncKey: SK_A2 });
    expect(config(s, s.a)?.actualSyncKeyEnc).not.toBe(before?.actualSyncKeyEnc);
    expect(config(s, s.a)?.actualPasswordEnc).toBe(before?.actualPasswordEnc);
  });

  it('clearSyncKey nulls the sync key and keeps the password', async () => {
    const s = await setup();
    await put(s, 'sa', { actualUrl: URL_A, password: PW_A, syncKey: SK_A });
    const res = await put(s, 'sa', { actualUrl: URL_A, clearSyncKey: true });
    expect(res.json()).toMatchObject({ hasActualPassword: true, hasActualSyncKey: false });
    expect(config(s, s.a)?.actualSyncKeyEnc).toBeNull();
    expect(config(s, s.a)?.actualPasswordEnc).toBeTruthy();
    // Clearing and setting in one request is contradictory.
    const both = await put(s, 'sa', { actualUrl: URL_A, clearSyncKey: true, syncKey: SK_A });
    expect(both.statusCode).toBe(400);
    expect((await put(s, 'sa', { actualUrl: URL_A, clearSyncKey: 'yes' })).statusCode).toBe(400);
  });

  it('a URL change clears the budget id and needs the password again', async () => {
    const s = await setup();
    await put(s, 'sa', { actualUrl: URL_A, password: PW_A, actualBudgetId: 'sync-1' });
    expect(config(s, s.a)?.actualBudgetId).toBeNull();
    await put(s, 'sa', { actualUrl: URL_A, actualBudgetId: 'sync-1' });
    expect(config(s, s.a)?.actualBudgetId).toBe('sync-1');

    // The saved password is not sent to a new host unless re-entered.
    const noPw = await put(s, 'sa', { actualUrl: URL_B });
    expect(noPw.statusCode).toBe(400);
    expect(noPw.json()).toEqual({ error: 'password_required' });
    expect(config(s, s.a)).toMatchObject({ actualUrl: URL_A, actualBudgetId: 'sync-1' });

    const moved = await put(s, 'sa', { actualUrl: URL_B, password: PW_B, actualBudgetId: 'sync-2' });
    expect(moved.json()).toMatchObject({ actualUrl: URL_B, actualBudgetId: null });

    // Same URL with an empty budget id clears it.
    await put(s, 'sa', { actualUrl: URL_B, actualBudgetId: 'sync-2' });
    await put(s, 'sa', { actualUrl: URL_B, actualBudgetId: '' });
    expect(config(s, s.a)?.actualBudgetId).toBeNull();
  });

  it('rejects an invalid URL or body with 400 and writes nothing', async () => {
    const s = await setup();
    for (const actualUrl of [
      'http://example.com',
      'ftp://example.com',
      'not a url',
      '',
      'https://u:p@example.com',
      'https://example.com/?x=1',
      'https://example.com/#x',
      42,
      undefined,
    ]) {
      const res = await put(s, 'sa', { actualUrl, password: PW_A });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_url' });
      expectNoSecrets(res.body);
    }
    expect((await put(s, 'sa', null)).statusCode).toBe(400);
    expect((await put(s, 'sa', [])).statusCode).toBe(400);
    for (const bad of [
      { password: 5 },
      { syncKey: {} },
      { password: 'x'.repeat(1001) },
      { actualBudgetId: 7 },
    ]) {
      const res = await put(s, 'sa', { actualUrl: URL_A, ...bad });
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }
    expect(config(s, s.a)).toBeUndefined();
    for (const actualUrl of ['http://localhost:5006', 'http://127.0.0.1:5006', 'http://[::1]:5006']) {
      expect((await put(s, 'sa', { actualUrl, password: PW_A })).statusCode).toBe(200);
    }
  });

  it('budgets lists the saved server budgets by sync id', async () => {
    const s = await setup();
    const res = await post(s, 'sa', 'budgets');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      budgets: [
        { id: 'sync-1', name: 'Home' },
        { id: 'sync-2', name: 'Work' },
      ],
    });
    expect(res.body).not.toContain('secret-owner');
    expect(s.withActualServer).toHaveBeenCalledTimes(1);
    expect(s.withActualServer.mock.calls[0]?.[0]).toBe(s.a);
    expect(s.withActual).not.toHaveBeenCalled();
  });

  it('base-currency reads the budget currency and stores nothing', async () => {
    const s = await setup();
    await put(s, 'sa', { actualUrl: URL_A, password: PW_A });
    const before = config(s, s.a);
    const res = await post(s, 'sa', 'base-currency');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ currency: 'EUR' });
    s.getPreferences.mockResolvedValueOnce({});
    expect((await post(s, 'sa', 'base-currency')).json()).toEqual({ currency: null });
    expect(s.withActual.mock.calls.map((c) => c[0])).toEqual([s.a, s.a]);
    expect(s.withActualServer).not.toHaveBeenCalled();
    expect(config(s, s.a)).toEqual(before);
  });

  it('maps failures to fixed codes without secret or URL text', async () => {
    const s = await setup();
    await put(s, 'sa', { actualUrl: URL_A, password: PW_A, syncKey: SK_A });
    const leak = `boom ${PW_A} ${SK_A} ${URL_A}`;
    const cases: [ReturnType<typeof vi.fn>, () => void, 'budgets' | 'base-currency', number, string][] = [
      [s.withActualServer, () => s.withActualServer.mockRejectedValueOnce(new ActualSessionError('not_configured')), 'budgets', 400, 'actual_not_configured'],
      [s.withActualServer, () => s.withActualServer.mockRejectedValueOnce(new ActualSessionError('open_failed')), 'budgets', 502, 'actual_unavailable'],
      [s.withActual, () => s.withActual.mockRejectedValueOnce(new ActualSessionError('not_configured')), 'base-currency', 400, 'actual_not_configured'],
      [s.withActual, () => s.withActual.mockRejectedValueOnce(new ActualSessionError('close_failed')), 'base-currency', 502, 'actual_unavailable'],
      // An api call failing inside the session carries library text; it becomes actual_unavailable.
      [s.getBudgets, () => s.getBudgets.mockRejectedValueOnce(new Error(leak)), 'budgets', 502, 'actual_unavailable'],
      [s.getPreferences, () => s.getPreferences.mockRejectedValueOnce(new Error(leak)), 'base-currency', 502, 'actual_unavailable'],
      // Anything else outside the api is an internal error.
      [s.withActual, () => s.withActual.mockRejectedValueOnce(new Error(leak)), 'base-currency', 500, 'internal_error'],
    ];
    for (const [, arrange, sub, status, code] of cases) {
      arrange();
      const res = await post(s, 'sa', sub);
      expect(res.statusCode).toBe(status);
      expect(res.json()).toEqual({ error: code });
      expectNoSecrets(res.body);
      expect(res.body).not.toContain('actual-a');
    }
  });

  it('isolates two users', async () => {
    const s = await setup();
    await put(s, 'sa', { actualUrl: URL_A, password: PW_A, syncKey: SK_A });
    await put(s, 'sb', { actualUrl: URL_B, password: PW_B });
    const a = await injectAs(s.app, s.sa, { method: 'GET', url: PATH });
    const b = await injectAs(s.app, s.sb, { method: 'GET', url: PATH });
    expect(a.json()).toMatchObject({ actualUrl: URL_A, hasActualSyncKey: true });
    expect(b.json()).toMatchObject({ actualUrl: URL_B, hasActualSyncKey: false });
    // A body user id is ignored, and B's writes never touch A's row.
    const aBefore = config(s, s.a);
    await put(s, 'sb', { actualUrl: URL_B, clearSyncKey: true, actualBudgetId: 'sync-x', userId: s.a, user_id: s.a });
    expect(config(s, s.a)).toEqual(aBefore);
    expect(config(s, s.b)?.actualBudgetId).toBe('sync-x');
    // Encrypted values are bound to each user's key, so they differ even for one plaintext.
    expect(config(s, s.b)?.actualPasswordEnc).not.toBe(aBefore?.actualPasswordEnc);
    await post(s, 'sb', 'budgets');
    await post(s, 'sb', 'base-currency');
    expect(s.withActualServer).toHaveBeenLastCalledWith(s.b, expect.any(Function));
    expect(s.withActual).toHaveBeenLastCalledWith(s.b, expect.any(Function));
  });
});

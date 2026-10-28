import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Actual library is faked at the module edge, so the real session code (credential
// resolution, decryption, per-user data dir) runs against the real in-memory database.
const inits: { serverURL?: string; password?: string; dataDir?: string }[] = [];
let failInit = false;
vi.mock('@actual-app/api', () => ({
  init: vi.fn((config: { serverURL?: string; password?: string; dataDir?: string }) => {
    inits.push(config);
    return failInit ? Promise.reject(new Error(`boom ${config.password ?? ''} ${config.serverURL ?? ''}`)) : Promise.resolve();
  }),
  getBudgets: vi.fn(() => Promise.resolve([{ cloudFileId: 'cf-1', groupId: 'sync-1', name: 'Home', state: 'remote' }])),
  downloadBudget: vi.fn(() => Promise.resolve()),
  shutdown: vi.fn(() => Promise.resolve()),
}));

import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import { withActualServer, withActualSession } from '../integrations/actual/session.js';
import { createWallosClient } from '../integrations/wallos/client.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';
import { TYPED_TEST_MAX_PER_IP, TYPED_TEST_MAX_PER_USER } from './typed-test-limit.js';

const APP_SECRET = 'test-app-secret-value-0123456789abcdef';
const W_URL_A = 'https://wallos-a.example.com';
const W_URL_B = 'https://wallos-b.example.com';
const W_URL_TYPED = 'https://wallos-typed.example.com';
const W_KEY_A = 'sekret-wallos-key-AAAA-111111';
const W_KEY_B = 'sekret-wallos-key-BBBB-222222';
const W_KEY_TYPED = 'sekret-wallos-key-TYPED-333333';
const A_URL_A = 'https://actual-a.example.com';
const A_URL_B = 'https://actual-b.example.com';
const A_URL_TYPED = 'https://actual-typed.example.com';
const A_PW_A = 'sekret-actual-pw-AAAA-111111';
const A_PW_B = 'sekret-actual-pw-BBBB-222222';
const A_PW_TYPED = 'sekret-actual-pw-TYPED-333333';
const A_SYNC_TYPED = 'sekret-actual-sync-TYPED-444444';
const SECRETS = [W_KEY_A, W_KEY_B, W_KEY_TYPED, A_PW_A, A_PW_B, A_PW_TYPED, A_SYNC_TYPED, 'sekret', 'v1:'];

const WALLOS_TEST = '/api/settings/wallos/test';
const ACTUAL_BUDGETS = '/api/settings/actual/budgets';

interface FetchCall {
  url: string;
  form: URLSearchParams;
}

const open: { close(): Promise<unknown>; db: AppDatabase; dir: string }[] = [];
beforeEach(() => {
  inits.length = 0;
  failInit = false;
});
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    closeDatabase(a.db);
    rmSync(a.dir, { recursive: true, force: true });
  }
});

function setup(opts: { logStream?: NodeJS.WritableStream; fetchFails?: boolean } = {}) {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  void t.app.close();
  const dir = mkdtempSync(join(tmpdir(), 'walley-typed-'));
  const calls: FetchCall[] = [];
  const fakeFetch = ((url: string, init?: RequestInit) => {
    calls.push({ url, form: new URLSearchParams(typeof init?.body === 'string' ? init.body : '') });
    if (opts.fetchFails === true) {
      return Promise.reject(new Error(`network down ${W_KEY_TYPED} ${W_URL_TYPED}`));
    }
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, currencies: [{ id: 1, code: 'EUR' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  const repoFor = (id: string) => createUserRepo(t.db, id);
  const actualDeps = { db: t.db, appSecret: APP_SECRET, dataDir: dir };
  const app = buildApp({
    db: t.db,
    ...(opts.logStream === undefined ? {} : { logger: { stream: opts.logStream } }),
    auth: {
      mode: 'local',
      secureCookies: false,
      allowRegistration: false,
      publicOrigin: t.publicOrigin,
      now: () => t.clock.now(),
    },
    settings: {
      repoFor,
      wallos: createWallosClient(repoFor, APP_SECRET, { fetch: fakeFetch }),
      appSecret: APP_SECRET,
      actual: {
        withActualServer: (userId, use, override) => withActualServer(actualDeps, userId, use, override),
        withActual: (userId, use) => withActualSession(actualDeps, userId, use),
      },
    },
  });
  open.push({ close: () => app.close(), db: t.db, dir });
  const a = makeUser(t.db);
  const b = makeUser(t.db);
  const ctx = { db: t.db, clock: t.clock };
  return { app, db: t.db, ctx, a, b, sa: signIn(ctx, a), sb: signIn(ctx, b), calls };
}

type S = ReturnType<typeof setup>;
type Who = 'sa' | 'sb';

const putWallos = (s: S, who: Who, payload: unknown) =>
  injectAs(s.app, s[who], { method: 'PUT', url: '/api/settings/wallos', payload: payload as never });
const putActual = (s: S, who: Who, payload: unknown) =>
  injectAs(s.app, s[who], { method: 'PUT', url: '/api/settings/actual', payload: payload as never });
const testWallos = (s: S, who: Who, payload?: unknown) =>
  injectAs(s.app, s[who], { method: 'POST', url: WALLOS_TEST, ...(payload === undefined ? {} : { payload: payload as never }) });
const loadBudgets = (s: S, who: Who, payload?: unknown) =>
  injectAs(s.app, s[who], { method: 'POST', url: ACTUAL_BUDGETS, ...(payload === undefined ? {} : { payload: payload as never }) });

/** Every table that can hold a typed value, plus the connection's change counter. */
function snapshot(db: AppDatabase): { configs: unknown[]; changes: number } {
  return {
    configs: db.$client.prepare('select * from user_configs order by user_id').all(),
    changes: (db.$client.prepare('select total_changes() as n').get() as { n: number }).n,
  };
}

function expectNoSecrets(text: string): void {
  for (const secret of SECRETS) expect(text, secret).not.toContain(secret);
}

async function saveBoth(s: S): Promise<void> {
  await putWallos(s, 'sa', { wallosUrl: W_URL_A, apiKey: W_KEY_A });
  await putWallos(s, 'sb', { wallosUrl: W_URL_B, apiKey: W_KEY_B });
  await putActual(s, 'sa', { actualUrl: A_URL_A, password: A_PW_A });
  await putActual(s, 'sb', { actualUrl: A_URL_B, password: A_PW_B });
}

describe('Wallos Test connection with typed values (issue 134)', () => {
  it('Endpoint accepts a typed URL/key without saving it', async () => {
    const s = setup();
    // Nothing saved at all: the typed values alone are enough.
    const before = snapshot(s.db);
    const res = await testWallos(s, 'sa', { wallosUrl: W_URL_TYPED, apiKey: W_KEY_TYPED });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]?.url).toBe(`${W_URL_TYPED}/api/currencies/get_currencies.php`);
    expect(s.calls[0]?.form.get('api_key')).toBe(W_KEY_TYPED);
    expect(snapshot(s.db)).toEqual(before);
    expect(createUserRepo(s.db, s.a).getConfig()).toBeUndefined();

    // With a saved config the typed values win and the saved row stays as it was.
    await saveBoth(s);
    const saved = snapshot(s.db);
    s.calls.length = 0;
    expect((await testWallos(s, 'sa', { wallosUrl: W_URL_TYPED, apiKey: W_KEY_TYPED })).statusCode).toBe(200);
    expect(s.calls[0]?.url).toContain(W_URL_TYPED);
    expect(s.calls[0]?.form.get('api_key')).toBe(W_KEY_TYPED);
    expect(snapshot(s.db)).toEqual(saved);
    expect(createUserRepo(s.db, s.a).getConfig()?.wallosUrl).toBe(W_URL_A);
  });

  it('Omitted fields fall back to the saved, decrypted value of the caller only', async () => {
    const s = setup();
    await saveBoth(s);
    s.calls.length = 0;
    // Nothing typed: unchanged behaviour, saved URL and key.
    expect((await testWallos(s, 'sa')).statusCode).toBe(200);
    expect((await testWallos(s, 'sa', {})).statusCode).toBe(200);
    expect((await testWallos(s, 'sa', { wallosUrl: '', apiKey: '  ' })).statusCode).toBe(200);
    for (const call of s.calls) {
      expect(call.url).toBe(`${W_URL_A}/api/currencies/get_currencies.php`);
      expect(call.form.get('api_key')).toBe(W_KEY_A);
    }
    // Only a key typed: the saved URL is used. Only the saved URL typed: the saved key is used.
    s.calls.length = 0;
    await testWallos(s, 'sa', { apiKey: W_KEY_TYPED });
    await testWallos(s, 'sa', { wallosUrl: W_URL_A });
    expect(s.calls[0]).toMatchObject({ url: `${W_URL_A}/api/currencies/get_currencies.php` });
    expect(s.calls[0]?.form.get('api_key')).toBe(W_KEY_TYPED);
    expect(s.calls[1]?.form.get('api_key')).toBe(W_KEY_A);
  });

  it('a different typed URL without a typed key is refused so the saved key is not sent to another host', async () => {
    const s = setup();
    await saveBoth(s);
    s.calls.length = 0;
    const res = await testWallos(s, 'sa', { wallosUrl: W_URL_TYPED });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'api_key_required' });
    expect(s.calls).toEqual([]);
  });

  it('rejects a bad typed body with a fixed error and makes no outside call', async () => {
    const s = setup();
    await saveBoth(s);
    s.calls.length = 0;
    for (const [payload, error] of [
      [{ wallosUrl: 'http://example.com', apiKey: W_KEY_TYPED }, 'invalid_url'],
      [{ wallosUrl: 42 }, 'invalid_url'],
      [{ apiKey: 5 }, 'invalid_request'],
      [{ apiKey: 'x'.repeat(1001) }, 'invalid_request'],
      [[W_KEY_TYPED], 'invalid_request'],
    ] as const) {
      const res = await testWallos(s, 'sa', payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error });
      expectNoSecrets(res.body);
    }
    expect(s.calls).toEqual([]);
  });

  it('Response never includes the key', async () => {
    const s = setup({ fetchFails: true });
    await saveBoth(s);
    const typed = { wallosUrl: W_URL_TYPED, apiKey: W_KEY_TYPED };
    const failed = await testWallos(s, 'sa', typed);
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ error: 'wallos_unavailable' });
    const missing = await testWallos(s, 'sb', { apiKey: ' ' });
    for (const res of [failed, missing]) {
      expectNoSecrets(res.body);
      expect(res.body).not.toContain('wallos-typed');
      expect(Object.keys(res.json<object>())).toEqual(['error']);
    }
    const ok = setup();
    const res = await testWallos(ok, 'sa', typed);
    expect(res.json()).toEqual({ ok: true });
    expectNoSecrets(res.body);
    expect(JSON.stringify(res.headers)).not.toContain(W_KEY_TYPED);
  });

  it('Test connection is read-only: no database write', async () => {
    const s = setup();
    await saveBoth(s);
    const before = snapshot(s.db);
    await testWallos(s, 'sa', { wallosUrl: W_URL_TYPED, apiKey: W_KEY_TYPED });
    await testWallos(s, 'sa');
    await testWallos(s, 'sa', { wallosUrl: 'nope' });
    expect(snapshot(s.db)).toEqual(before);
  });
});

describe('Actual Load budgets with typed values (issue 134)', () => {
  it('Endpoint accepts a typed URL/key without saving it', async () => {
    const s = setup();
    const before = snapshot(s.db);
    // Nothing saved: typed server URL and password are enough to list budgets.
    const res = await loadBudgets(s, 'sa', { actualUrl: A_URL_TYPED, password: A_PW_TYPED, syncKey: A_SYNC_TYPED, actualBudgetId: 'sync-1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ budgets: [{ id: 'sync-1', name: 'Home' }] });
    expect(inits).toHaveLength(1);
    expect(inits[0]).toMatchObject({ serverURL: A_URL_TYPED, password: A_PW_TYPED });
    expect(snapshot(s.db)).toEqual(before);
    expect(createUserRepo(s.db, s.a).getConfig()).toBeUndefined();

    // With a saved config the typed values win and the saved row stays as it was.
    await saveBoth(s);
    const saved = snapshot(s.db);
    inits.length = 0;
    expect((await loadBudgets(s, 'sa', { actualUrl: A_URL_TYPED, password: A_PW_TYPED })).statusCode).toBe(200);
    expect(inits[0]).toMatchObject({ serverURL: A_URL_TYPED, password: A_PW_TYPED });
    expect(snapshot(s.db)).toEqual(saved);
    expect(createUserRepo(s.db, s.a).getConfig()?.actualUrl).toBe(A_URL_A);
  });

  it('Omitted fields fall back to the saved, decrypted value of the caller only', async () => {
    const s = setup();
    await saveBoth(s);
    inits.length = 0;
    for (const payload of [undefined, {}, { actualUrl: '', password: '  ' }]) {
      const res = await loadBudgets(s, 'sa', payload);
      expect(res.statusCode).toBe(200);
    }
    for (const init of inits) expect(init).toMatchObject({ serverURL: A_URL_A, password: A_PW_A });
    // Only a password typed: the saved URL is used. Only the saved URL typed: the saved password is used.
    inits.length = 0;
    await loadBudgets(s, 'sa', { password: A_PW_TYPED });
    await loadBudgets(s, 'sa', { actualUrl: A_URL_A });
    expect(inits[0]).toMatchObject({ serverURL: A_URL_A, password: A_PW_TYPED });
    expect(inits[1]).toMatchObject({ serverURL: A_URL_A, password: A_PW_A });
    // Nothing typed and nothing saved: a fixed not-configured answer.
    const none = await loadBudgets(s, 'sa', {});
    expect(none.statusCode).toBe(200);
    const empty = setup();
    const missing = await loadBudgets(empty, 'sa');
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: 'actual_not_configured' });
  });

  it('a different typed URL without a typed password is refused so the saved password is not sent to another host', async () => {
    const s = setup();
    await saveBoth(s);
    inits.length = 0;
    const res = await loadBudgets(s, 'sa', { actualUrl: A_URL_TYPED });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'password_required' });
    expect(inits).toEqual([]);
  });

  it('rejects a bad typed body with a fixed error and never signs in', async () => {
    const s = setup();
    await saveBoth(s);
    inits.length = 0;
    for (const [payload, error] of [
      [{ actualUrl: 'http://example.com', password: A_PW_TYPED }, 'invalid_url'],
      [{ actualUrl: 7 }, 'invalid_url'],
      [{ password: 5 }, 'invalid_request'],
      [{ syncKey: {} }, 'invalid_request'],
      [{ password: 'x'.repeat(1001) }, 'invalid_request'],
      [{ actualBudgetId: 9 }, 'invalid_request'],
      [[A_PW_TYPED], 'invalid_request'],
    ] as const) {
      const res = await loadBudgets(s, 'sa', payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error });
      expectNoSecrets(res.body);
    }
    const malformed = await injectAs(s.app, s.sa, {
      method: 'POST',
      url: ACTUAL_BUDGETS,
      headers: { 'content-type': 'application/json' },
      payload: `{"password":"${A_PW_TYPED}"`,
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ error: 'invalid_request' });
    expectNoSecrets(malformed.body);
    expect(inits).toEqual([]);
  });

  it('Response never includes the key', async () => {
    const s = setup();
    await saveBoth(s);
    failInit = true;
    const failed = await loadBudgets(s, 'sa', { actualUrl: A_URL_TYPED, password: A_PW_TYPED, syncKey: A_SYNC_TYPED });
    expect(failed.statusCode).toBe(502);
    expect(failed.json()).toEqual({ error: 'actual_unavailable' });
    expectNoSecrets(failed.body);
    expect(failed.body).not.toContain('actual-typed');
    failInit = false;
    const ok = await loadBudgets(s, 'sa', { actualUrl: A_URL_TYPED, password: A_PW_TYPED, syncKey: A_SYNC_TYPED });
    expect(Object.keys(ok.json<object>())).toEqual(['budgets']);
    expectNoSecrets(ok.body);
    expect(JSON.stringify(ok.headers)).not.toContain(A_PW_TYPED);
  });

  it('Load budgets is read-only: no database write', async () => {
    const s = setup();
    await saveBoth(s);
    const before = snapshot(s.db);
    await loadBudgets(s, 'sa', { actualUrl: A_URL_TYPED, password: A_PW_TYPED, syncKey: A_SYNC_TYPED, actualBudgetId: 'sync-1' });
    await loadBudgets(s, 'sa');
    await loadBudgets(s, 'sa', { actualUrl: 'nope' });
    expect(snapshot(s.db)).toEqual(before);
  });
});

describe('Typed-value routes: rate limit (issue 134)', () => {
  it('Rate-limit test', async () => {
    const s = setup();
    await saveBoth(s);
    // Per user: the limit is reached, then 429 with the fixed code and a Retry-After.
    for (let i = 0; i < TYPED_TEST_MAX_PER_USER; i += 1) {
      expect((await testWallos(s, 'sa', { apiKey: W_KEY_TYPED })).statusCode).toBe(200);
    }
    const refused = await testWallos(s, 'sa', { apiKey: W_KEY_TYPED });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toEqual({ error: 'rate_limited' });
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expectNoSecrets(refused.body);
    const callsAtLimit = s.calls.length;
    await testWallos(s, 'sa', { apiKey: W_KEY_TYPED });
    expect(s.calls).toHaveLength(callsAtLimit);

    // Wallos and Actual have separate counters, and another user has their own.
    expect((await loadBudgets(s, 'sa', { password: A_PW_TYPED })).statusCode).toBe(200);
    expect((await testWallos(s, 'sb')).statusCode).toBe(200);

    // The same route is limited for the Actual load too.
    for (let i = 1; i < TYPED_TEST_MAX_PER_USER; i += 1) await loadBudgets(s, 'sa', { password: A_PW_TYPED });
    const budgetsRefused = await loadBudgets(s, 'sa', { password: A_PW_TYPED });
    expect(budgetsRefused.statusCode).toBe(429);
    expect(budgetsRefused.json()).toEqual({ error: 'rate_limited' });

    // The key is separate from login: the exhausted user can still reach the login route
    // (answered 401 for bad credentials, not 429).
    const login = await s.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: TEST_ORIGIN },
      payload: { email: 'nobody@example.test', password: 'wrong-password-123456' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('a per-IP limit applies across users on one address', async () => {
    const s = setup();
    const extra = Array.from({ length: Math.ceil(TYPED_TEST_MAX_PER_IP / TYPED_TEST_MAX_PER_USER) + 1 }, () =>
      signIn(s.ctx, makeUser(s.db)),
    );
    let refusedAt = -1;
    let count = 0;
    for (const session of extra) {
      for (let i = 0; i < TYPED_TEST_MAX_PER_USER; i += 1) {
        const res = await injectAs(s.app, session, { method: 'POST', url: WALLOS_TEST, payload: { apiKey: W_KEY_TYPED } });
        count += 1;
        if (res.statusCode === 429 && refusedAt < 0) refusedAt = count;
      }
    }
    // No user reached the per-user limit before the shared IP budget ran out.
    expect(refusedAt).toBe(TYPED_TEST_MAX_PER_IP + 1);
  });
});

describe('Typed-value routes: log redaction (issue 134)', () => {
  it('Log-redaction test', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const s = setup({ logStream: stream, fetchFails: true });
    await saveBoth(s);
    failInit = true;
    // Success, outside failure, bad body and refusal paths all carry typed secrets.
    await testWallos(s, 'sa', { wallosUrl: W_URL_TYPED, apiKey: W_KEY_TYPED });
    await testWallos(s, 'sa', { wallosUrl: 'http://example.com', apiKey: W_KEY_TYPED });
    await testWallos(s, 'sa', { wallosUrl: W_URL_TYPED });
    await loadBudgets(s, 'sa', { actualUrl: A_URL_TYPED, password: A_PW_TYPED, syncKey: A_SYNC_TYPED });
    await loadBudgets(s, 'sa', { actualUrl: 'http://example.com', password: A_PW_TYPED });
    failInit = false;
    await loadBudgets(s, 'sa', { actualUrl: A_URL_TYPED, password: A_PW_TYPED, syncKey: A_SYNC_TYPED });
    await injectAs(s.app, s.sa, {
      method: 'POST',
      url: ACTUAL_BUDGETS,
      headers: { 'content-type': 'application/json' },
      payload: `{"password":"${A_PW_TYPED}"`,
    });
    for (let i = 0; i < TYPED_TEST_MAX_PER_USER; i += 1) await testWallos(s, 'sa', { apiKey: W_KEY_TYPED });
    const output = lines.join('');
    expect(output.length).toBeGreaterThan(0);
    for (const secret of SECRETS) expect(output, secret).not.toContain(secret);
    expect(output).not.toContain('wallos-typed');
    expect(output).not.toContain('actual-typed');
  });
});

describe('Typed-value routes: tenant scope (issue 134)', () => {
  it("Two-user isolation test (typed values never touch another user's config)", async () => {
    const s = setup();
    await saveBoth(s);
    const aWallos = createUserRepo(s.db, s.a).getConfig();
    const bWallos = createUserRepo(s.db, s.b).getConfig();

    // B types a value for one field only. The omitted field is B's saved secret, never A's.
    s.calls.length = 0;
    await testWallos(s, 'sb', { wallosUrl: W_URL_B });
    await testWallos(s, 'sb', { apiKey: W_KEY_TYPED });
    await testWallos(s, 'sb', { userId: s.a, user_id: s.a, wallosUrl: W_URL_B });
    expect(s.calls[0]?.form.get('api_key')).toBe(W_KEY_B);
    expect(s.calls[1]?.url).toContain(W_URL_B);
    expect(s.calls[2]?.form.get('api_key')).toBe(W_KEY_B);
    for (const call of s.calls) {
      expect(call.url).not.toContain('wallos-a');
      expect(call.form.get('api_key')).not.toBe(W_KEY_A);
    }

    inits.length = 0;
    await loadBudgets(s, 'sb', { actualUrl: A_URL_B });
    await loadBudgets(s, 'sb', { password: A_PW_TYPED, userId: s.a });
    await loadBudgets(s, 'sb');
    expect(inits[0]).toMatchObject({ serverURL: A_URL_B, password: A_PW_B });
    expect(inits[1]).toMatchObject({ serverURL: A_URL_B, password: A_PW_TYPED });
    expect(inits[2]).toMatchObject({ serverURL: A_URL_B, password: A_PW_B });
    for (const init of inits) {
      expect(init.password).not.toBe(A_PW_A);
      expect(init.serverURL).not.toBe(A_URL_A);
      expect(init.dataDir).toContain(s.b);
    }

    // A user with nothing saved never resolves to anyone else's secret.
    const c = makeUser(s.db);
    const sc = signIn(s.ctx, c);
    s.calls.length = 0;
    inits.length = 0;
    const noWallos = await injectAs(s.app, sc, { method: 'POST', url: WALLOS_TEST, payload: { wallosUrl: W_URL_A } });
    expect(noWallos.statusCode).toBe(400);
    expect(noWallos.json()).toEqual({ error: 'wallos_not_configured' });
    const noActual = await injectAs(s.app, sc, { method: 'POST', url: ACTUAL_BUDGETS, payload: { actualUrl: A_URL_A } });
    expect(noActual.statusCode).toBe(400);
    expect(noActual.json()).toEqual({ error: 'actual_not_configured' });
    expect(s.calls).toEqual([]);
    expect(inits).toEqual([]);

    // Neither user's stored config changed.
    expect(createUserRepo(s.db, s.a).getConfig()).toEqual(aWallos);
    expect(createUserRepo(s.db, s.b).getConfig()).toEqual(bWallos);
  });
});

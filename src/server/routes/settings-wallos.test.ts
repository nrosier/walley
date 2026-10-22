import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { closeDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import { WallosAuthError, WallosNetworkError } from '../integrations/wallos/client.js';
import { createCapturingMailer } from '../mail/index.js';
import { injectAs, makeAuthApp, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';
import { settingsWallosRoutes } from './settings-wallos.js';

const KEY_A = 'sekret-key-AAAA-1234567890';
const KEY_B = 'sekret-key-BBBB-0987654321';
const URL_A = 'https://wallos-a.example.com';
const URL_B = 'https://wallos-b.example.com';
const PATH = '/api/settings/wallos';

const open: { close(): Promise<unknown>; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    closeDatabase(a.db);
  }
});

function setup() {
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  void t.app.close();
  const listCurrencies = vi.fn().mockResolvedValue([]);
  const app = buildApp({
    db: t.db,
    auth: {
      mode: 'local',
      secureCookies: false,
      allowRegistration: false,
      publicOrigin: t.publicOrigin,
      now: () => t.clock.now(),
    },
  });
  void app.register(settingsWallosRoutes, {
    prefix: '/api',
    deps: {
      repoFor: (id) => createUserRepo(t.db, id),
      wallos: { listCurrencies },
      appSecret: 'test-app-secret-value-0123456789abcdef',
    },
  });
  open.push({ close: () => app.close(), db: t.db });
  const a = makeUser(t.db);
  const b = makeUser(t.db);
  const ctx = { db: t.db, clock: t.clock };
  return { app, db: t.db, a, b, sa: signIn(ctx, a), sb: signIn(ctx, b), listCurrencies };
}

const put = (s: ReturnType<typeof setup>, who: 'sa' | 'sb', payload: unknown) =>
  injectAs(s.app, s[who], { method: 'PUT', url: PATH, payload: payload as never });

describe('settings-wallos routes', () => {
  it('401 without a session', async () => {
    const s = setup();
    for (const [method, url] of [['GET', PATH], ['PUT', PATH], ['POST', `${PATH}/test`]] as const) {
      const res = await s.app.inject({ method, url, headers: { origin: TEST_ORIGIN } });
      expect(res.statusCode).toBe(401);
    }
  });

  it('403 without CSRF or with a foreign Origin', async () => {
    const s = setup();
    const noCsrf = await s.app.inject({
      method: 'PUT',
      url: PATH,
      headers: { origin: TEST_ORIGIN, cookie: s.sa.cookie },
      payload: { wallosUrl: URL_A, apiKey: KEY_A },
    });
    expect(noCsrf.statusCode).toBe(403);
    const foreign = await injectAs(s.app, s.sa, {
      method: 'POST',
      url: `${PATH}/test`,
      headers: { origin: 'https://evil.example' },
    });
    expect(foreign.statusCode).toBe(403);
    expect(s.listCurrencies).not.toHaveBeenCalled();
    expect(createUserRepo(s.db, s.a).getConfig()).toBeUndefined();
  });

  it('GET returns only the url and a boolean, never the key', async () => {
    const s = setup();
    const empty = await injectAs(s.app, s.sa, { method: 'GET', url: PATH });
    expect(empty.json()).toEqual({ wallosUrl: '', hasWallosApiKey: false });
    const saved = await put(s, 'sa', { wallosUrl: URL_A, apiKey: KEY_A });
    expect(saved.statusCode).toBe(200);
    const res = await injectAs(s.app, s.sa, { method: 'GET', url: PATH });
    expect(res.json()).toEqual({ wallosUrl: URL_A, hasWallosApiKey: true });
    for (const body of [saved.body, res.body]) {
      expect(body).not.toContain(KEY_A);
      expect(body).not.toContain('sekret');
      expect(body).not.toContain('v1:');
    }
    const stored = createUserRepo(s.db, s.a).getConfig()?.wallosApiKeyEnc ?? '';
    expect(stored).not.toContain(KEY_A);
    expect(stored.startsWith('v1:')).toBe(true);
  });

  it('PUT with an empty or missing apiKey keeps the stored key', async () => {
    const s = setup();
    await put(s, 'sa', { wallosUrl: URL_A, apiKey: KEY_A });
    const before = createUserRepo(s.db, s.a).getConfig()?.wallosApiKeyEnc;
    for (const payload of [
      { wallosUrl: URL_B, apiKey: '' },
      { wallosUrl: URL_B },
      { wallosUrl: URL_B, apiKey: '   ' },
    ]) {
      const res = await put(s, 'sa', payload);
      expect(res.json()).toEqual({ wallosUrl: URL_B, hasWallosApiKey: true });
    }
    expect(createUserRepo(s.db, s.a).getConfig()?.wallosApiKeyEnc).toBe(before);
    await put(s, 'sa', { wallosUrl: URL_B, apiKey: KEY_B });
    expect(createUserRepo(s.db, s.a).getConfig()?.wallosApiKeyEnc).not.toBe(before);
  });

  it('validates the URL', async () => {
    const s = setup();
    for (const wallosUrl of [
      'http://example.com',
      'ftp://example.com',
      'not a url',
      '',
      'https://u:p@example.com',
      'https://example.com/?x=1',
      42,
    ]) {
      const res = await put(s, 'sa', { wallosUrl, apiKey: KEY_A });
      expect(res.statusCode).toBe(400);
      expect(res.body).not.toContain(KEY_A);
    }
    expect((await put(s, 'sa', null)).statusCode).toBe(400);
    expect((await put(s, 'sa', { wallosUrl: URL_A, apiKey: 5 })).statusCode).toBe(400);
    for (const wallosUrl of [
      'https://example.com/wallos',
      'http://localhost:8282',
      'http://127.0.0.1:8282',
      'http://[::1]:8282',
    ]) {
      expect((await put(s, 'sa', { wallosUrl, apiKey: KEY_A })).statusCode).toBe(200);
    }
    expect(createUserRepo(s.db, s.b).getConfig()).toBeUndefined();
  });

  it('test uses saved credentials and maps failures to fixed codes', async () => {
    const s = setup();
    await put(s, 'sa', { wallosUrl: URL_A, apiKey: KEY_A });
    const ok = await injectAs(s.app, s.sa, { method: 'POST', url: `${PATH}/test` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    expect(s.listCurrencies).toHaveBeenCalledWith(s.a);

    s.listCurrencies.mockRejectedValueOnce(new WallosAuthError());
    const auth = await injectAs(s.app, s.sa, { method: 'POST', url: `${PATH}/test` });
    expect(auth.statusCode).toBe(502);
    expect(auth.json()).toEqual({ error: 'wallos_auth_failed' });

    s.listCurrencies.mockRejectedValueOnce(new WallosNetworkError());
    const net = await injectAs(s.app, s.sa, { method: 'POST', url: `${PATH}/test` });
    expect(net.json()).toEqual({ error: 'wallos_unavailable' });

    s.listCurrencies.mockRejectedValueOnce(new Error(`boom ${KEY_A} ${URL_A}`));
    const other = await injectAs(s.app, s.sa, { method: 'POST', url: `${PATH}/test` });
    expect(other.json()).toEqual({ error: 'internal_error' });
    for (const r of [auth, net, other]) {
      expect(r.body).not.toContain(KEY_A);
      expect(r.body).not.toContain('wallos-a');
    }
  });

  it('isolates two users', async () => {
    const s = setup();
    await put(s, 'sa', { wallosUrl: URL_A, apiKey: KEY_A });
    await put(s, 'sb', { wallosUrl: URL_B, apiKey: KEY_B });
    const a = await injectAs(s.app, s.sa, { method: 'GET', url: PATH });
    const b = await injectAs(s.app, s.sb, { method: 'GET', url: PATH });
    expect(a.json()).toEqual({ wallosUrl: URL_A, hasWallosApiKey: true });
    expect(b.json()).toEqual({ wallosUrl: URL_B, hasWallosApiKey: true });
    // A keeps its key when B edits; a body user id is ignored.
    const keyA = createUserRepo(s.db, s.a).getConfig()?.wallosApiKeyEnc;
    await put(s, 'sb', { wallosUrl: URL_B, userId: s.a, user_id: s.a });
    expect(createUserRepo(s.db, s.a).getConfig()).toMatchObject({ wallosUrl: URL_A, wallosApiKeyEnc: keyA });
    await injectAs(s.app, s.sb, { method: 'POST', url: `${PATH}/test` });
    expect(s.listCurrencies).toHaveBeenLastCalledWith(s.b);
  });
});

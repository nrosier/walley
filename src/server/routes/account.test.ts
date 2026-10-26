import { afterEach, describe, expect, it } from 'vitest';
import type { AuthMode } from '../../lib/auth-mode.js';
import { hashPassword } from '../auth/passwords.js';
import { SIGN_IN_MAX_PER_EMAIL, SIGN_IN_MAX_PER_IP } from '../auth/rate-limit.js';
import { hashToken } from '../auth/sessions.js';
import { createUser } from '../db/accounts.js';
import { closeDatabase } from '../db/client.js';
import { findSessionByIdHash } from '../db/lookup.js';
import { createUserRepo } from '../db/repo.js';
import { makeAuthApp, injectAs, signIn, verifyEmail, TEST_ORIGIN, type AuthApp } from '../test/auth-helpers.js';

const OLD = 'correct horse battery staple';
const NEW = 'a brand new long passphrase';
const created: AuthApp[] = [];

afterEach(async () => {
  for (const t of created.splice(0)) {
    await t.app.close();
    closeDatabase(t.db);
  }
});

async function setup(mode: AuthMode = 'local'): Promise<AuthApp> {
  // buildApp registers accountRoutes whenever auth is set.
  const t = makeAuthApp({ mode });
  await t.app.ready();
  created.push(t);
  return t;
}

async function addUser(t: AuthApp, email: string, password: string | null = OLD) {
  const user = createUser(t.db, {
    email,
    passwordHash: password === null ? null : await hashPassword(password),
  });
  verifyEmail(t.db, email);
  return user.id;
}

const put = (t: AuthApp, s: ReturnType<typeof signIn>, payload: unknown) =>
  injectAs(t.app, s, { method: 'PUT', url: '/api/account/password', payload: payload as object });

const login = (t: AuthApp, email: string, password: string) =>
  t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password }, headers: { origin: TEST_ORIGIN } });

describe('account routes', () => {
  it('401 without a session', async () => {
    const t = await setup();
    expect((await t.app.inject({ method: 'GET', url: '/api/account' })).statusCode).toBe(401);
    const res = await t.app.inject({ method: 'PUT', url: '/api/account/password', payload: {}, headers: { origin: TEST_ORIGIN } });
    expect(res.statusCode).toBe(401);
  });

  it('403 without CSRF token or with a foreign Origin', async () => {
    const t = await setup();
    const s = signIn(t, await addUser(t, 'a@example.test'));
    const body = { currentPassword: OLD, newPassword: NEW };
    const noToken = await t.app.inject({
      method: 'PUT', url: '/api/account/password', payload: body,
      headers: { origin: TEST_ORIGIN, cookie: s.cookie },
    });
    expect(noToken.statusCode).toBe(403);
    const foreign = await injectAs(t.app, s, {
      method: 'PUT', url: '/api/account/password', payload: body, headers: { origin: 'http://evil.test' },
    });
    expect(foreign.statusCode).toBe(403);
    expect((await login(t, 'a@example.test', NEW)).statusCode).not.toBe(200);
  });

  it('GET returns email, mode, hasPassword and identities, never the hash', async () => {
    const t = await setup();
    const id = await addUser(t, 'a@example.test');
    createUserRepo(t.db, id).linkIdentity('https://idp.test', 'sub-1');
    const res = await injectAs(t.app, signIn(t, id), { method: 'GET', url: '/api/account' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      email: 'a@example.test', mode: 'local', hasPassword: true,
      identities: [{ issuer: 'https://idp.test', subject: 'sub-1' }],
    });
    expect(res.body).not.toContain('argon2');
  });

  it('wrong current password gives 401 invalid_credentials and changes nothing', async () => {
    const t = await setup();
    const s = signIn(t, await addUser(t, 'a@example.test'));
    const res = await put(t, s, { currentPassword: 'not the right password', newPassword: NEW });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'invalid_credentials' });
    expect((await login(t, 'a@example.test', OLD)).statusCode).toBe(200);
  });

  it('rejects bad bodies and short new passwords with 400', async () => {
    const t = await setup();
    const s = signIn(t, await addUser(t, 'a@example.test'));
    for (const payload of [{}, { currentPassword: OLD }, { currentPassword: OLD, newPassword: 'short' }, { currentPassword: 1, newPassword: NEW }]) {
      const res = await put(t, s, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }
  });

  it('malformed JSON body gives a fixed 400 that never echoes the input', async () => {
    const t = await setup();
    const s = signIn(t, await addUser(t, 'a@example.test'));
    const raw = `{"currentPassword":"${OLD}"`;
    const res = await injectAs(t.app, s, {
      method: 'PUT',
      url: '/api/account/password',
      headers: { 'content-type': 'application/json' },
      payload: raw,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_request' });
    expect(res.body).not.toContain(raw);
    expect(res.body).not.toContain(OLD);
  });

  it('success: 204, new password logs in, old fails, other sessions deleted, current kept', async () => {
    const t = await setup();
    const id = await addUser(t, 'a@example.test');
    const current = signIn(t, id);
    const other = signIn(t, id);
    const res = await put(t, current, { currentPassword: OLD, newPassword: NEW });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect((await login(t, 'a@example.test', NEW)).statusCode).toBe(200);
    expect((await login(t, 'a@example.test', OLD)).statusCode).toBe(401);
    expect(findSessionByIdHash(t.db, hashToken(current.token))).toBeDefined();
    expect(findSessionByIdHash(t.db, hashToken(other.token))).toBeUndefined();
    expect((await injectAs(t.app, current, { method: 'GET', url: '/api/account' })).statusCode).toBe(200);
    expect((await injectAs(t.app, other, { method: 'GET', url: '/api/account' })).statusCode).toBe(401);
  });

  it('OIDC mode: 403 local_auth_disabled, GET shows identities', async () => {
    const t = await setup('oidc');
    const id = await addUser(t, 'a@example.test', null);
    createUserRepo(t.db, id).linkIdentity('https://idp.test', 'sub-1');
    const s = signIn(t, id, 'oidc');
    const res = await put(t, s, { currentPassword: OLD, newPassword: NEW });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'local_auth_disabled' });
    const get = await injectAs(t.app, s, { method: 'GET', url: '/api/account' });
    expect(get.json()).toMatchObject({ mode: 'oidc', hasPassword: false, identities: [{ issuer: 'https://idp.test', subject: 'sub-1' }] });
  });

  it('two users: A cannot change B or see B identities or lose B sessions', async () => {
    const t = await setup();
    const a = await addUser(t, 'a@example.test');
    const b = await addUser(t, 'b@example.test', 'b has a different long password');
    createUserRepo(t.db, b).linkIdentity('https://idp.test', 'sub-b');
    const sa = signIn(t, a);
    const sb = signIn(t, b);
    const get = await injectAs(t.app, sa, { method: 'GET', url: '/api/account' });
    expect(get.json()).toMatchObject({ email: 'a@example.test', identities: [] });
    expect(get.body).not.toContain('sub-b');
    // A's own password is required; B's password does not work for A.
    const bad = await put(t, sa, { currentPassword: 'b has a different long password', newPassword: NEW });
    expect(bad.statusCode).toBe(401);
    expect((await put(t, sa, { currentPassword: OLD, newPassword: NEW })).statusCode).toBe(204);
    expect(findSessionByIdHash(t.db, hashToken(sb.token))).toBeDefined();
    expect((await login(t, 'b@example.test', 'b has a different long password')).statusCode).toBe(200);
  });

  it('no response body contains a password hash', async () => {
    const t = await setup();
    const s = signIn(t, await addUser(t, 'a@example.test'));
    const bodies = [
      (await injectAs(t.app, s, { method: 'GET', url: '/api/account' })).body,
      (await put(t, s, { currentPassword: 'wrong wrong wrong wrong', newPassword: NEW })).body,
      (await put(t, s, {})).body,
      (await put(t, s, { currentPassword: OLD, newPassword: NEW })).body,
    ];
    for (const body of bodies) expect(body).not.toMatch(/argon2|\$v=/i);
  });

  it('returns 429 after the per-user limit and does not run the change', async () => {
    const t = await setup();
    const userId = await addUser(t, 'rl@example.test');
    const s = signIn(t, userId);
    const wrong = { currentPassword: 'not the password', newPassword: NEW };
    for (let i = 0; i < SIGN_IN_MAX_PER_EMAIL; i++) {
      expect((await put(t, s, wrong)).statusCode).toBe(401);
    }
    const limited = await put(t, s, { currentPassword: OLD, newPassword: NEW });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'rate_limited' });
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Another user is not affected.
    const other = signIn(t, await addUser(t, 'rl2@example.test'));
    expect((await put(t, other, wrong)).statusCode).toBe(401);
  });

  it('returns 429 after the per-IP limit across users', async () => {
    const t = await setup();
    const wrong = { currentPassword: 'not the password', newPassword: NEW };
    for (let i = 0; i < SIGN_IN_MAX_PER_IP; i++) {
      const s = signIn(t, await addUser(t, `ip${String(i)}@example.test`));
      expect((await put(t, s, wrong)).statusCode).toBe(401);
    }
    const s = signIn(t, await addUser(t, 'ip-last@example.test'));
    expect((await put(t, s, wrong)).statusCode).toBe(429);
  });
});

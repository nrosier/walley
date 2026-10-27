import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthMode } from '../../lib/auth-mode.js';
import { buildApp } from '../app.js';
import { isAdminEmail } from '../auth/registration.js';
import { SIGN_IN_MAX_PER_IP } from '../auth/rate-limit.js';
import { getRegistrationEnabled } from '../db/app-settings.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createCapturingMailer, type CapturingMailer } from '../mail/index.js';
import { injectAs, makeClock, makeUser, signIn, TEST_ORIGIN } from '../test/auth-helpers.js';

const ADMIN = 'admin@example.test';
const PASSWORD = 'correct horse battery staple';

interface Env {
  app: FastifyInstance;
  db: AppDatabase;
  mailer: CapturingMailer;
  clock: ReturnType<typeof makeClock>;
}

const envs: Env[] = [];
const dirs: string[] = [];

function build(db: AppDatabase, ceiling: boolean, mode: AuthMode = 'local'): Env {
  const clock = makeClock();
  const mailer = createCapturingMailer();
  const app = buildApp({
    db,
    auth: {
      mode,
      secureCookies: false,
      allowRegistration: ceiling,
      adminEmails: [ADMIN],
      publicOrigin: TEST_ORIGIN,
      now: () => clock.now(),
      mailer,
    },
  });
  const env = { app, db, mailer, clock };
  envs.push(env);
  return env;
}

/** A fresh in-memory app. The stored toggle is left at its default (off). */
function setup(ceiling: boolean, mode: AuthMode = 'local'): Env {
  return build(openDatabase(':memory:'), ceiling, mode);
}

afterEach(async () => {
  for (const env of envs.splice(0)) {
    await env.app.close();
    try {
      closeDatabase(env.db);
    } catch {
      // Already closed by the test (restart case).
    }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const config = async (env: Env): Promise<{ mode: string; registration: boolean }> =>
  (await env.app.inject({ method: 'GET', url: '/api/auth/config' })).json<{ mode: string; registration: boolean }>();
const register = (env: Env, email = 'new@example.test') =>
  env.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: PASSWORD },
    headers: { origin: TEST_ORIGIN },
  });
const adminSession = (env: Env) => signIn(env, makeUser(env.db, ADMIN));
const userSession = (env: Env) => signIn(env, makeUser(env.db, 'plain@example.test'));
const setToggle = (env: Env, s: ReturnType<typeof signIn>, enabled: unknown) =>
  injectAs(env.app, s, { method: 'PUT', url: '/api/admin/registration', payload: { enabled } });
const userCount = (env: Env) =>
  (env.db.$client.prepare('select count(*) as n from users').get() as { n: number }).n;

describe('stored toggle', () => {
  it('defaults to off on a fresh database', () => {
    expect(getRegistrationEnabled(openDatabase(':memory:'))).toBe(false);
  });
});

describe('effective state in GET /api/auth/config', () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('ceiling %s and toggle %s report registration %s with no new keys', async (ceiling, toggle, expected) => {
    const env = setup(ceiling);
    if (toggle) {
      expect((await setToggle(env, adminSession(env), true)).statusCode).toBe(200);
    }
    expect(await config(env)).toEqual({ mode: 'local', registration: expected });
  });

  it('defaults to off with the ceiling on and the toggle never touched', async () => {
    expect(await config(setup(true))).toEqual({ mode: 'local', registration: false });
  });

  it('follows a runtime flip with no restart', async () => {
    const env = setup(true);
    const admin = adminSession(env);
    expect((await config(env)).registration).toBe(false);
    await setToggle(env, admin, true);
    expect((await config(env)).registration).toBe(true);
    await setToggle(env, admin, false);
    expect((await config(env)).registration).toBe(false);
  });
});

describe('POST /api/auth/register', () => {
  it('toggle off with the ceiling on: 403 registration_disabled, no mail, no user', async () => {
    const env = setup(true);
    const res = await register(env);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'registration_disabled' });
    expect(env.mailer.sent).toHaveLength(0);
    expect(userCount(env)).toBe(0);
  });

  it('ceiling off with the toggle on: 403 registration_disabled', async () => {
    const env = setup(false);
    env.db.$client.prepare("insert into app_settings (key, value) values ('registration_enabled', 'true')").run();
    const res = await register(env);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'registration_disabled' });
    expect(env.mailer.sent).toHaveLength(0);
  });

  it('toggle off, ADMIN_EMAILS email, ceiling on: 202 and one mail', async () => {
    const env = setup(true);
    const res = await register(env, ADMIN);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'verification_sent' });
    expect(env.mailer.sent).toHaveLength(1);
  });

  it('toggle off, email not in ADMIN_EMAILS: 403 registration_disabled', async () => {
    const env = setup(true);
    const res = await register(env, 'other@example.test');
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'registration_disabled' });
    expect(env.mailer.sent).toHaveLength(0);
  });

  it('toggle off, ADMIN_EMAILS email, ceiling off: 403 registration_disabled', async () => {
    const env = setup(false);
    const res = await register(env, ADMIN);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'registration_disabled' });
    expect(env.mailer.sent).toHaveLength(0);
    expect(userCount(env)).toBe(0);
  });

  it('toggle off: the ADMIN_EMAILS match is case-insensitive', async () => {
    const env = setup(true);
    expect((await register(env, '  Admin@Example.TEST ')).statusCode).toBe(202);
  });

  it('refusal comes before the rate limit: more attempts than the IP limit are all 403, never 429', async () => {
    const env = setup(true);
    for (let i = 0; i < SIGN_IN_MAX_PER_IP + 5; i += 1) {
      expect((await register(env, `n${String(i)}@example.test`)).statusCode).toBe(403);
    }
    // The refused attempts used no budget: after the flip the first attempt is accepted.
    await setToggle(env, adminSession(env), true);
    expect((await register(env)).statusCode).toBe(202);
  });

  it('toggle on with the ceiling on: 202 verification_sent and one mail', async () => {
    const env = setup(true);
    await setToggle(env, adminSession(env), true);
    const res = await register(env);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'verification_sent' });
    expect(env.mailer.sent).toHaveLength(1);
  });

  it('a runtime flip off closes registration again with no restart', async () => {
    const env = setup(true);
    const admin = adminSession(env);
    await setToggle(env, admin, true);
    expect((await register(env, 'one@example.test')).statusCode).toBe(202);
    await setToggle(env, admin, false);
    const res = await register(env, 'two@example.test');
    expect(res.statusCode).toBe(403);
    expect(env.mailer.sent).toHaveLength(1);
  });
});

describe('/api/admin/registration', () => {
  it('401 without a session', async () => {
    const env = setup(true);
    expect((await env.app.inject({ method: 'GET', url: '/api/admin/registration' })).statusCode).toBe(401);
  });

  it('a signed-in non-admin gets 403 on GET and PUT, and the toggle does not change', async () => {
    const env = setup(true);
    const user = userSession(env);
    const get = await injectAs(env.app, user, { method: 'GET', url: '/api/admin/registration' });
    expect(get.statusCode).toBe(403);
    expect(get.json()).toEqual({ error: 'forbidden' });
    const put = await setToggle(env, user, true);
    expect(put.statusCode).toBe(403);
    expect(put.json()).toEqual({ error: 'forbidden' });
    expect(getRegistrationEnabled(env.db)).toBe(false);
    expect((await register(env)).statusCode).toBe(403);
  });

  it('with ADMIN_EMAILS empty nobody can change it', async () => {
    const db = openDatabase(':memory:');
    const clock = makeClock();
    const app = buildApp({
      db,
      auth: {
        mode: 'local',
        secureCookies: false,
        allowRegistration: true,
        publicOrigin: TEST_ORIGIN,
        now: () => clock.now(),
        mailer: createCapturingMailer(),
      },
    });
    envs.push({ app, db, mailer: createCapturingMailer(), clock });
    const res = await setToggle({ app, db, mailer: createCapturingMailer(), clock }, signIn({ db, clock }, makeUser(db, ADMIN)), true);
    expect(res.statusCode).toBe(403);
    expect(getRegistrationEnabled(db)).toBe(false);
  });

  it('isAdminEmail compares case-insensitively and an empty list matches nobody', () => {
    expect(isAdminEmail([ADMIN], 'Admin@Example.Test ')).toBe(true);
    expect(isAdminEmail([ADMIN], 'other@example.test')).toBe(false);
    expect(isAdminEmail([], ADMIN)).toBe(false);
  });

  it('an admin reads the state and sets it, getting enabled, ceiling and effective', async () => {
    const env = setup(true);
    const admin = adminSession(env);
    const before = await injectAs(env.app, admin, { method: 'GET', url: '/api/admin/registration' });
    expect(before.json()).toEqual({ enabled: false, ceiling: true, effective: false });
    const on = await setToggle(env, admin, true);
    expect(on.statusCode).toBe(200);
    expect(on.json()).toEqual({ enabled: true, ceiling: true, effective: true });
  });

  it('with the ceiling off the toggle is stored but effective stays off', async () => {
    const env = setup(false);
    const res = await setToggle(env, adminSession(env), true);
    expect(res.json()).toEqual({ enabled: true, ceiling: false, effective: false });
    expect((await config(env)).registration).toBe(false);
  });

  it.each([undefined, 'true', 1, null])('rejects a non-boolean enabled (%s) with 400 and no change', async (bad) => {
    const env = setup(true);
    const res = await setToggle(env, adminSession(env), bad);
    expect(res.statusCode).toBe(400);
    expect(getRegistrationEnabled(env.db)).toBe(false);
  });

  it('403 without the CSRF token', async () => {
    const env = setup(true);
    const admin = adminSession(env);
    const res = await env.app.inject({
      method: 'PUT',
      url: '/api/admin/registration',
      payload: { enabled: true },
      headers: { origin: TEST_ORIGIN, cookie: admin.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(getRegistrationEnabled(env.db)).toBe(false);
  });

  it('survives a restart: a new app on the same database file sees the stored value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'walley-toggle-'));
    dirs.push(dir);
    const path = join(dir, 'walley.db');
    const first = build(openDatabase(path), true);
    await setToggle(first, adminSession(first), true);
    expect((await config(first)).registration).toBe(true);
    await first.app.close();
    closeDatabase(first.db);

    const second = build(openDatabase(path), true);
    expect((await config(second)).registration).toBe(true);
    expect((await register(second)).statusCode).toBe(202);
  });

  it('GET /api/account reports isAdmin only for an admin', async () => {
    const env = setup(true);
    const admin = await injectAs(env.app, adminSession(env), { method: 'GET', url: '/api/account' });
    expect(admin.json()).toMatchObject({ isAdmin: true });
    const user = await injectAs(env.app, userSession(env), { method: 'GET', url: '/api/account' });
    expect(user.json()).toMatchObject({ isAdmin: false });
  });
});

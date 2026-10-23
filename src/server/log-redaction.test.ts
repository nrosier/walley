import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createUserRepo } from './db/repo.js';
import { closeDatabase, type AppDatabase } from './db/client.js';
import { createCapturingMailer } from './mail/index.js';
import { makeAuthApp, makeUser, signIn, injectAs, TEST_ORIGIN } from './test/auth-helpers.js';

const SECRETS = {
  apiKey: 'FAKE-APIKEY-7f3a91',
  password: 'FAKE-PASSWORD-2b8c44',
  syncKey: 'FAKE-SYNCKEY-9d1e07',
  cookie: 'FAKE-COOKIE-5a6b32',
  bearer: 'FAKE-BEARER-c4d8e1',
  nested: 'FAKE-NESTED-e0f1a2',
  enc: 'FAKE-ENC-1a2b3c',
  smtp: 'FAKE-SMTPPASS-8e8e8e',
  oidc: 'FAKE-OIDCCODE-4c4c4c',
};

const open: { close(): Promise<unknown>; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const a of open.splice(0)) {
    await a.close();
    closeDatabase(a.db);
  }
});

function setup() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const t = makeAuthApp({ mailer: createCapturingMailer() });
  void t.app.close();
  const app = buildApp({
    db: t.db,
    logger: { stream },
    auth: {
      mode: 'local',
      secureCookies: false,
      allowRegistration: false,
      publicOrigin: t.publicOrigin,
      now: () => t.clock.now(),
    },
    settings: {
      repoFor: (id) => createUserRepo(t.db, id),
      wallos: { listCurrencies: () => Promise.resolve([]) },
      appSecret: 'test-app-secret-value-0123456789abcdef',
    },
  });
  open.push({ close: () => app.close(), db: t.db });
  const session = signIn({ db: t.db, clock: t.clock }, makeUser(t.db));
  return { app, session, output: () => lines.join('') };
}

function expectNoSecrets(output: string): void {
  expect(output.length).toBeGreaterThan(0);
  for (const secret of Object.values(SECRETS)) {
    expect(output, secret).not.toContain(secret);
  }
}

describe('log redaction', () => {
  it('keeps secrets out of the log for bodies, headers, query and error paths', async () => {
    const s = setup();
    await injectAs(s.app, s.session, {
      method: 'PUT',
      url: '/api/settings/wallos',
      headers: { authorization: `Bearer ${SECRETS.bearer}` },
      payload: { wallosUrl: 'https://wallos.example.com', apiKey: SECRETS.apiKey },
    });
    await injectAs(s.app, s.session, {
      method: 'PUT',
      url: '/api/settings/actual',
      payload: { password: SECRETS.password, syncKey: SECRETS.syncKey },
    });
    // Malformed JSON: a parser error message can quote the input.
    await injectAs(s.app, s.session, {
      method: 'PUT',
      url: '/api/settings/wallos',
      headers: { 'content-type': 'application/json' },
      payload: `{"apiKey":"${SECRETS.apiKey}"`,
    });
    await injectAs(s.app, s.session, {
      method: 'POST',
      url: '/api/account/nope',
      payload: { nested: { password: SECRETS.nested } },
    });
    await s.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: TEST_ORIGIN, cookie: `other=${SECRETS.cookie}`, authorization: `Basic ${SECRETS.bearer}` },
      payload: { email: 'nobody@example.test', password: SECRETS.password },
    });
    await s.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/callback?code=${SECRETS.oidc}&state=${SECRETS.oidc}`,
    });
    expectNoSecrets(s.output());
  });

  it('replaces the cookie and authorization values and keeps the header names', async () => {
    const s = setup();
    await s.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { cookie: `a=${SECRETS.cookie}`, authorization: `Bearer ${SECRETS.bearer}` },
    });
    const out = s.output();
    expectNoSecrets(out);
    const req = out
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { req?: { headers?: Record<string, string> } })
      .find((l) => l.req?.headers !== undefined);
    expect(req?.req?.headers).toEqual({ cookie: '[Redacted]', authorization: '[Redacted]' });
  });

  it('redacts secret field names logged as objects, at any listed depth', () => {
    const s = setup();
    s.app.log.info(
      {
        apiKey: SECRETS.apiKey,
        api_key: SECRETS.apiKey,
        password: SECRETS.password,
        syncKey: SECRETS.syncKey,
        smtpUrl: SECRETS.smtp,
        clientSecret: SECRETS.smtp,
        wallos_api_key_enc: SECRETS.enc,
        actual_sync_key_enc: SECRETS.enc,
        body: { password: SECRETS.nested, deeper: { syncKey: SECRETS.nested, apiKey: SECRETS.nested } },
      },
      'probe',
    );
    const out = s.output();
    expectNoSecrets(out);
    expect(out).toContain('[Redacted]');
  });
});

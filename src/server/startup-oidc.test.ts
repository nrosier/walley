import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { createOidcProvider, type OidcRuntime } from './auth/oidc.js';
import { loadConfig } from './config.js';
import { deriveFlowKey } from './crypto/keys.js';
import { closeDatabase, openDatabase, type AppDatabase } from './db/client.js';

// index.ts runs main() on import, so this builds the app with the same options index.ts builds.
const BASE_ENV = {
  APP_SECRET: 'a'.repeat(40),
  PUBLIC_ORIGIN: 'http://localhost:3000',
  DATABASE_PATH: ':memory:',
  DATA_DIR: './data/test-data',
};
const OIDC_ENV = {
  OIDC_ISSUER: 'https://idp.example.test',
  OIDC_CLIENT_ID: 'walley',
  OIDC_CLIENT_SECRET: 'client-secret-value',
  OIDC_CALLBACK_URL: 'http://localhost:3000/api/auth/oidc/callback',
};

const open: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const t of open.splice(0)) {
    await t.app.close();
    closeDatabase(t.db);
  }
});

function startup(env: Record<string, string>): FastifyInstance {
  const config = loadConfig(env);
  let oidc: OidcRuntime | undefined;
  if (config.authMode === 'oidc') {
    const failingFetch = () => Promise.reject(new Error('discovery stubbed to fail'));
    oidc = {
      provider: createOidcProvider(config.oidc, failingFetch),
      flowKey: deriveFlowKey(config.appSecret),
      callbackUrl: config.oidc.callbackUrl,
    };
  }
  const db = openDatabase(':memory:');
  const app = buildApp({
    db,
    trustProxy: config.trustProxy,
    auth: {
      mode: config.authMode,
      secureCookies: config.secureCookies,
      allowRegistration: config.allowRegistration,
      publicOrigin: config.publicOrigin,
      ...(oidc === undefined ? {} : { oidc }),
    },
  });
  open.push({ app, db });
  return app;
}

describe('startup wiring of OIDC', () => {
  it('registers the login route in OIDC mode', async () => {
    const app = startup({ ...BASE_ENV, ...OIDC_ENV });
    const res = await app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('/login?error=oidc_failed');
  });

  it('leaves the login route at 404 in local mode', async () => {
    const app = startup({ ...BASE_ENV });
    const res = await app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
    expect(res.statusCode).toBe(404);
  });
});

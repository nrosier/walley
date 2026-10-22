import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { closeDatabase, openDatabase } from './db/client.js';

describe('buildApp', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('GET /api/health returns status ok as JSON', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"status":"ok"}');
    expect(res.headers['content-type']).toContain('application/json');
  });

  it('GET /api/nope returns 401 unauthenticated', async () => {
    app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('{"error":"unauthenticated"}');
  });

  it('exposes the db option on app.db', () => {
    const db = openDatabase(':memory:');
    try {
      app = buildApp({ db });
      expect(app.db).toBe(db);
    } finally {
      closeDatabase(db);
    }
  });

  it('refuses local registration without a mailer, before listening', () => {
    const db = openDatabase(':memory:');
    try {
      expect(() =>
        buildApp({
          db,
          auth: { mode: 'local', secureCookies: false, allowRegistration: true, publicOrigin: 'http://localhost:3000' },
        }),
      ).toThrow('Local registration needs a mailer. Startup is aborted.');
    } finally {
      closeDatabase(db);
    }
  });

  it('builds without a mailer when registration is off or the mode is OIDC', () => {
    const db = openDatabase(':memory:');
    const base = { secureCookies: false, publicOrigin: 'http://localhost:3000' };
    try {
      expect(() =>
        buildApp({ db, auth: { ...base, mode: 'local', allowRegistration: false } }).close(),
      ).not.toThrow();
      expect(() =>
        buildApp({ db, auth: { ...base, mode: 'oidc', allowRegistration: true } }).close(),
      ).not.toThrow();
    } finally {
      closeDatabase(db);
    }
  });
});

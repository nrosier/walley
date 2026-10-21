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
});

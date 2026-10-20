import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

const INDEX = '<!doctype html><div id="root"></div>';
const ASSET = 'console.log("fixture");';
const IMMUTABLE = 'public, max-age=31536000, immutable';

describe('buildApp with a web root', () => {
  let dir: string;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'walley-web-'));
    writeFileSync(join(dir, 'index.html'), INDEX);
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app-abc.js'), ASSET);
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    rmSync(dir, { recursive: true, force: true });
  });

  function build(): FastifyInstance {
    app = buildApp({ webRoot: dir });
    return app;
  }

  it.each(['/', '/some/client/route', '/some/client/route?x=1.5'])(
    'GET %s returns index.html with no-cache',
    async (url) => {
      const res = await build().inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(INDEX);
      expect(res.headers['cache-control']).toBe('no-cache');
    },
  );

  it('serves /index.html with no-cache', async () => {
    const res = await build().inject({ method: 'GET', url: '/index.html' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('serves files under /assets/ as immutable', async () => {
    const res = await build().inject({ method: 'GET', url: '/assets/app-abc.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(ASSET);
    expect(res.headers['cache-control']).toBe(IMMUTABLE);
  });

  it.each(['/assets/missing.js', '/foo.txt', '/some/dir/file.css'])(
    'GET %s returns 404, not index.html',
    async (url) => {
      const res = await build().inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('id="root"');
    },
  );

  it.each(['/api/nope', '/api', '/api/', '/%61pi/nope', '/API/nope', '/Api'])(
    'GET %s returns the JSON 404',
    async (url) => {
      const res = await build().inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/json');
      expect(res.body).not.toContain('id="root"');
    },
  );

  it('never serves index.html for a path that does not decode', async () => {
    const res = await build().inject({ method: 'GET', url: '/%E0%A4%A' });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.body).not.toContain('id="root"');
  });

  it.each(['POST', 'PUT', 'DELETE'] as const)('%s /anything returns 404', async (method) => {
    const res = await build().inject({ method, url: '/anything' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('id="root"');
  });

  it('HEAD /some/route returns 200', async () => {
    const res = await build().inject({ method: 'HEAD', url: '/some/route' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  // Encoded slashes and backslashes survive routing, so the guard sees them.
  // %2e%2e is collapsed by the router before any handler runs, so it is not
  // covered here; it reaches the same file lookup as any unknown path, and
  // @fastify/static is confined to the web root.
  it.each([
    '/..%2f..%2fetc/passwd',
    '/..%5c..%5cetc',
    '/a/..%2f..%2fsecret',
  ])('answers %s with 404, never the SPA shell', async (url) => {
    const res = await build().inject({ method: 'GET', url });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('root:');
    expect(res.body).not.toBe(INDEX);
  });

  it('keeps GET /api/health as JSON', async () => {
    const res = await build().inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('{"status":"ok"}');
  });
});

describe('buildApp without a usable web root', () => {
  it('serves nothing at / when no web root is given', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('throws when the web root has no index.html', () => {
    const dir = mkdtempSync(join(tmpdir(), 'walley-web-empty-'));
    try {
      expect(() => buildApp({ webRoot: dir })).toThrow('Web root has no index.html');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

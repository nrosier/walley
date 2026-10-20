import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  readonly logger?: boolean;
  /** Absolute path to the built web folder. When omitted, no static files are served. */
  readonly webRoot?: string;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

/** True when a missing path should fall back to the SPA shell. */
function isSpaRoute(method: string, rawUrl: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }
  const rawPath = rawUrl.split('?')[0] ?? '';
  let path: string;
  try {
    path = decodeURIComponent(rawPath).toLowerCase();
  } catch {
    return false;
  }
  if (path === '/api' || path.startsWith('/api/')) {
    return false;
  }
  // A decoded traversal sequence is never a client route, even without a dot in the last segment.
  if (path.split(/[/\\]/).includes('..') || path.includes('\\')) {
    return false;
  }
  const lastSegment = path.slice(path.lastIndexOf('/') + 1);
  return !lastSegment.includes('.');
}

export function buildApp(opts?: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: opts?.logger ?? false });
  void app.register(healthRoutes, { prefix: '/api' });

  const webRoot = opts?.webRoot;
  if (webRoot !== undefined) {
    if (!existsSync(join(webRoot, 'index.html'))) {
      throw new Error('Web root has no index.html');
    }
    const assetsDir = resolve(webRoot, 'assets') + sep;
    void app.register(fastifyStatic, {
      root: webRoot,
      wildcard: false,
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        const immutable = resolve(filePath).startsWith(assetsDir);
        void reply.header('Cache-Control', immutable ? IMMUTABLE : NO_CACHE);
      },
    });
    app.setNotFoundHandler((request, reply) => {
      if (isSpaRoute(request.method, request.url)) {
        return reply.header('Cache-Control', NO_CACHE).sendFile('index.html');
      }
      return reply.code(404).send({
        message: `Route ${request.method}:${request.url} not found`,
        error: 'Not Found',
        statusCode: 404,
      });
    });
  }

  return app;
}

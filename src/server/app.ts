import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { AuthMode } from '../lib/auth-mode.js';
import {
  SESSION_COOKIE,
  clearSessionCookies,
  deleteSession,
  findSession,
  type SessionContext,
} from './auth/sessions.js';
import type { AppDatabase } from './db/client.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';

export interface AuthOptions {
  readonly mode: AuthMode;
  readonly secureCookies: boolean;
  /** Whether new accounts may be created. Reported by GET /api/auth/config. */
  readonly allowRegistration: boolean;
  /** Clock in ms since the epoch. Tests inject one; the default is Date.now. */
  readonly now?: () => number;
}

export interface BuildAppOptions {
  readonly logger?: boolean;
  /** Absolute path to the built web folder. When omitted, no static files are served. */
  readonly webRoot?: string;
  /** Open database handle. The caller owns it and closes it. */
  readonly db?: AppDatabase;
  /** Turns on cookie sessions. Requires `db`. */
  readonly auth?: AuthOptions;
}

declare module 'fastify' {
  interface FastifyInstance {
    db: AppDatabase | null;
  }
  interface FastifyRequest {
    auth: SessionContext | null;
  }
  interface FastifyContextConfig {
    /** Marks an /api route that may be reached without a session. */
    public?: boolean;
  }
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

/** True for `/api` and `/api/...`, after percent-decoding, ignoring case. Undecodable paths count as API. */
function isApiPath(rawUrl: string): boolean {
  const rawPath = rawUrl.split('?')[0] ?? '';
  // Absolute-form targets are routed to /api, so they count as API paths. Fail closed.
  if (!rawPath.startsWith('/')) return true;
  let path: string;
  try {
    path = decodeURIComponent(rawPath).toLowerCase();
  } catch {
    return true;
  }
  return path === '/api' || path.startsWith('/api/');
}

/** Default deny: an /api request needs a session unless its route is marked public. */
function denyHook(request: FastifyRequest, reply: FastifyReply, done: () => void): void {
  if (!isApiPath(request.url) || request.routeOptions.config.public === true || request.auth !== null) {
    done();
    return;
  }
  void reply.code(401).send({ error: 'unauthenticated' });
}

function registerAuth(app: FastifyInstance, db: AppDatabase, auth: AuthOptions): void {
  const clock = auth.now ?? Date.now;
  void app.register(fastifyCookie);
  // buildApp is synchronous, so the cookie plugin has not loaded yet. A plain addHook here
  // would be queued ahead of the plugin's own onRequest hook and would see no request.cookies.
  // `after` runs once the plugin is loaded, so this hook is registered behind it.
  app.after(() => {
    app.addHook('onRequest', (request, reply, done) => {
      if (isApiPath(request.url)) {
        const token = request.cookies[SESSION_COOKIE];
        request.auth = findSession(db, token, auth.mode, clock());
        if (token !== undefined && request.auth === null) {
          clearSessionCookies(reply, auth.secureCookies);
        }
      }
      done();
    });
    //
    // slot 4: CSRF hook (#20)
    //
    void app.register(authRoutes, {
      prefix: '/api',
      db,
      mode: auth.mode,
      allowRegistration: auth.allowRegistration,
    });
    app.post('/api/auth/logout', (request, reply) => {
      if (request.auth === null) {
        return reply.code(401).send({ error: 'unauthenticated' });
      }
      deleteSession(db, request.auth);
      clearSessionCookies(reply, auth.secureCookies);
      return reply.code(204).send();
    });
  });
}

export function buildApp(opts?: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: opts?.logger ?? false });
  app.decorate('db', opts?.db ?? null);
  app.decorateRequest('auth', null);
  void app.register(healthRoutes, { prefix: '/api' });

  const auth = opts?.auth;
  if (auth !== undefined) {
    const db = opts?.db;
    if (db === undefined) {
      throw new Error('auth requires db');
    }
    registerAuth(app, db, auth);
  }
  // Queued behind the session hook, which registerAuth adds inside its own `after`.
  app.after(() => {
    app.addHook('onRequest', denyHook);
  });

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

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
import { createCsrfHook } from './auth/csrf.js';
import type { OidcRuntime } from './auth/oidc.js';
import type { AppDatabase } from './db/client.js';
import type { Mailer } from './mail/index.js';
import { accountRoutes } from './routes/account.js';
import { authRoutes } from './routes/auth.js';
import type { CreateDeps } from './integrations/create.js';
import { healthRoutes } from './routes/health.js';
import { integrationRoutes } from './routes/integrations.js';
import { registerOidcRoutes } from './routes/oidc.js';
import { matchesRoutes } from './routes/matches.js';
import { settingsActualRoutes, type SettingsActualDeps } from './routes/settings-actual.js';
import { overridesRoutes } from './routes/overrides.js';
import { settingsMatchingRoutes } from './routes/settings-matching.js';
import { settingsWallosRoutes, type SettingsWallosDeps } from './routes/settings-wallos.js';
import { syncRoutes } from './routes/sync.js';

export interface AuthOptions {
  readonly mode: AuthMode;
  readonly secureCookies: boolean;
  /** Whether new accounts may be created. Reported by GET /api/auth/config. */
  readonly allowRegistration: boolean;
  /** The origin browsers use to reach Walley, without a trailing slash. The CSRF hook compares Origin to it. */
  readonly publicOrigin: string;
  /** Clock in ms since the epoch. Tests inject one; the default is Date.now. */
  readonly now?: () => number;
  /** The OIDC provider runtime. Used in OIDC mode only; in local mode the OIDC routes answer 404. */
  readonly oidc?: OidcRuntime;
  /** Sends verification mail. Required when local registration is on; buildApp refuses to start without it. */
  readonly mailer?: Mailer;
}

export interface BuildAppOptions {
  /** True logs to stdout. Tests pass `{ stream }` to capture the output. */
  readonly logger?: boolean | { readonly stream: NodeJS.WritableStream };
  /** Absolute path to the built web folder. When omitted, no static files are served. */
  readonly webRoot?: string;
  /** Open database handle. The caller owns it and closes it. */
  readonly db?: AppDatabase;
  /** Turns on cookie sessions. Requires `db`. */
  readonly auth?: AuthOptions;
  /** Wallos and Actual clients for the create routes. Needs `auth`; without it no integration route exists. */
  readonly integrations?: CreateDeps;
  /**
   * Dependencies of the per-user settings routes (Wallos, Actual and matching). Needs `auth`; without
   * it no settings route exists. `appSecret` encrypts saved credentials and never leaves the server.
   * `actual` (the Actual sign-in and budget readers) is needed for the Actual settings routes.
   */
  readonly settings?: SettingsWallosDeps & {
    readonly actual?: Omit<SettingsActualDeps, 'repoFor' | 'appSecret'>;
  };
  /** Addresses or CIDR ranges of the reverse proxies whose X-Forwarded-For is trusted. Default false. */
  readonly trustProxy?: string[] | false;
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

const REDACTED = '[Redacted]';

/** Field names that hold a secret. Redacted at the top level and one and two levels down. */
const SECRET_KEYS = [
  'apiKey',
  'api_key',
  'password',
  'syncKey',
  'smtpUrl',
  'clientSecret',
  'wallos_api_key_enc',
  'actual_password_enc',
  'actual_sync_key_enc',
  'wallosApiKeyEnc',
  'actualPasswordEnc',
  'actualSyncKeyEnc',
] as const;

/** Pino redact paths. A wildcard covers one level, so each name is listed at three depths. */
export const LOG_REDACT_PATHS: readonly string[] = [
  ...SECRET_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]),
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];

/**
 * Logs the method and the path, plus the cookie and authorization header names with their
 * values replaced. The query string can hold secrets, such as the OIDC authorisation code and
 * state on the callback, so it never reaches the log. No other header is logged.
 */
function serializeRequest(request: {
  method: string;
  url: string;
  headers?: Record<string, unknown>;
}): {
  method: string;
  path: string;
  headers: Record<string, string>;
} {
  const queryStart = request.url.indexOf('?');
  const headers: Record<string, string> = {};
  for (const name of ['cookie', 'authorization']) {
    if (request.headers?.[name] !== undefined) headers[name] = REDACTED;
  }
  return {
    method: request.method,
    path: queryStart === -1 ? request.url : request.url.slice(0, queryStart),
    headers,
  };
}

/** Placeholder for apps where registration is off or OIDC is on: no route can reach a send. */
const NO_MAILER: Mailer = { send: () => undefined };

const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

/**
 * The 404 reply. It never echoes the request URL and never logs: the query string can hold
 * secrets, such as the OIDC code and state on a callback that has no route in local mode.
 */
function sendNotFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ message: 'Not Found', error: 'Not Found', statusCode: 404 });
}

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

function registerAuth(
  app: FastifyInstance,
  db: AppDatabase,
  auth: AuthOptions,
  integrations: CreateDeps | undefined,
  settings: BuildAppOptions['settings'],
): void {
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
    void app.register(authRoutes, {
      prefix: '/api',
      db,
      mode: auth.mode,
      allowRegistration: auth.allowRegistration,
      secureCookies: auth.secureCookies,
      now: clock,
      mailer: auth.mailer ?? NO_MAILER,
      publicOrigin: auth.publicOrigin,
    });
    registerOidcRoutes(app, {
      db,
      secureCookies: auth.secureCookies,
      allowRegistration: auth.allowRegistration,
      now: clock,
      oidc: auth.mode === 'oidc' ? (auth.oidc ?? null) : null,
    });
    void app.register(accountRoutes, { prefix: '/api', db, mode: auth.mode });
    if (settings !== undefined) {
      void app.register(settingsWallosRoutes, { prefix: '/api', deps: settings });
      void app.register(settingsMatchingRoutes, { prefix: '/api', deps: { repoFor: settings.repoFor } });
      void app.register(overridesRoutes, { prefix: '/api', deps: { repoFor: settings.repoFor, now: clock } });
      if (settings.actual !== undefined) {
        void app.register(settingsActualRoutes, {
          prefix: '/api',
          deps: {
            repoFor: settings.repoFor,
            appSecret: settings.appSecret,
            withActualServer: settings.actual.withActualServer,
            withActual: settings.actual.withActual,
          },
        });
      }
    }
    if (integrations !== undefined) {
      void app.register(integrationRoutes, { prefix: '/api', deps: integrations });
      void app.register(matchesRoutes, {
        prefix: '/api',
        deps: { wallos: integrations.wallos, repoFor: integrations.repoFor, withActual: integrations.withActual },
      });
      void app.register(syncRoutes, {
        prefix: '/api',
        deps: {
          wallos: integrations.wallos,
          repoFor: integrations.repoFor,
          withActual: integrations.withActual,
          now: clock,
        },
      });
    }
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
  const logger = opts?.logger ?? false;
  const app = Fastify({
    logger:
      logger === false
        ? false
        : {
            serializers: { req: serializeRequest },
            redact: { paths: [...LOG_REDACT_PATHS], censor: REDACTED },
            ...(logger === true ? {} : { stream: logger.stream }),
          },
    trustProxy: opts?.trustProxy ?? false,
  });
  app.decorate('db', opts?.db ?? null);
  app.decorateRequest('auth', null);
  void app.register(healthRoutes, { prefix: '/api' });

  const auth = opts?.auth;
  if (auth !== undefined) {
    const db = opts?.db;
    if (db === undefined) {
      throw new Error('auth requires db');
    }
    if (auth.mode === 'local' && auth.allowRegistration && auth.mailer === undefined) {
      // Fixed text: never print config values.
      throw new Error('Local registration needs a mailer. Startup is aborted.');
    }
    registerAuth(app, db, auth, opts?.integrations, opts?.settings);
  }
  // Queued behind the session hook, which registerAuth adds inside its own `after`.
  app.after(() => {
    app.addHook('onRequest', denyHook);
    if (auth !== undefined) {
      app.addHook('onRequest', createCsrfHook(auth.publicOrigin));
    }
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
      return sendNotFound(reply);
    });
  } else {
    // Fastify's default handler logs the full URL, query string included. Replace it everywhere.
    app.setNotFoundHandler((_request, reply) => sendNotFound(reply));
  }

  return app;
}

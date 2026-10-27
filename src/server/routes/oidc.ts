import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  SIGN_IN_MAX_KEYS,
  SIGN_IN_MAX_PER_EMAIL,
  SIGN_IN_MAX_PER_IP,
  SIGN_IN_WINDOW_MS,
  createRateLimiter,
  ipRateKey,
} from '../auth/rate-limit.js';
import { OIDC_FLOW_COOKIE, OIDC_FLOW_TTL_MS, openFlow, sealFlow } from '../auth/oidc-flow.js';
import { resolveOidcLogin } from '../auth/oidc-link.js';
import { isRegistrationOpen } from '../auth/registration.js';
import type { OidcRuntime } from '../auth/oidc.js';
import { OidcError } from '../auth/oidc.js';
import { createSession, deleteSession, setSessionCookies } from '../auth/sessions.js';
import type { AppDatabase } from '../db/client.js';

export interface OidcRoutesOptions {
  readonly db: AppDatabase;
  readonly secureCookies: boolean;
  /** The ALLOW_REGISTRATION ceiling; first-login creation also needs the stored admin toggle. */
  readonly allowRegistration: boolean;
  /** Clock in ms since the epoch, the same one the session hook uses. */
  readonly now: () => number;
  /** Null in local mode: both routes answer 404. */
  readonly oidc: OidcRuntime | null;
}

const FLOW_PATH = '/api/auth/oidc';
const FAILED = '/login?error=oidc_failed';
const NOT_LINKED = '/login?error=account_not_linked';
const CALLBACK_MAX_PER_IP = 20;
const CALLBACK_WINDOW_MS = 15 * 60 * 1000;

/** Registers GET /api/auth/oidc/login and /api/auth/oidc/callback. Both are public. */
export function registerOidcRoutes(app: FastifyInstance, options: OidcRoutesOptions): void {
  const { db, secureCookies, allowRegistration, now, oidc } = options;

  // Its own limiter instance, so OIDC login starts never share counters with password login.
  const limiter = createRateLimiter({
    now,
    maxPerEmail: SIGN_IN_MAX_PER_EMAIL,
    maxPerIp: SIGN_IN_MAX_PER_IP,
    windowMs: SIGN_IN_WINDOW_MS,
    maxKeys: SIGN_IN_MAX_KEYS,
  });
  // A separate instance again, so callbacks share no counter with login starts or password login.
  const callbackLimiter = createRateLimiter({
    now,
    maxPerEmail: SIGN_IN_MAX_PER_EMAIL,
    maxPerIp: CALLBACK_MAX_PER_IP,
    windowMs: CALLBACK_WINDOW_MS,
    maxKeys: SIGN_IN_MAX_KEYS,
  });

  function rateLimited(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
    return reply
      .header('Retry-After', String(retryAfterSeconds))
      .header('Cache-Control', 'no-store')
      .code(429)
      .send({ error: 'rate_limited' });
  }

  function flowCookieOptions(maxAge: number) {
    return {
      path: FLOW_PATH,
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: secureCookies,
      maxAge,
    };
  }

  /** Sends the 302 and returns the reply, which an async handler may return as is. */
  function go(reply: FastifyReply, location: string | URL): FastifyReply {
    void reply
      .header('Cache-Control', 'no-store')
      .redirect(typeof location === 'string' ? location : location.href, 302);
    return reply;
  }

  app.get(
    '/api/auth/oidc/login',
    { config: { public: true }, exposeHeadRoute: false },
    async (request, reply) => {
      if (oidc === null) {
        reply.callNotFound();
        return reply;
      }
      // Before discovery or any provider call.
      const limit = limiter.take(`ip:${ipRateKey(request.ip)}`);
      if (!limit.allowed) {
        return rateLimited(reply, limit.retryAfterSeconds);
      }
      try {
        const { url, flow } = await oidc.provider.start();
        void reply.setCookie(
          OIDC_FLOW_COOKIE,
          sealFlow(flow, oidc.flowKey, now()),
          flowCookieOptions(OIDC_FLOW_TTL_MS / 1000),
        );
        return await go(reply, url);
      } catch (error) {
        request.log.warn(
          error instanceof OidcError
            ? { stage: error.stage, code: error.code }
            : { stage: 'start', code: 'UNKNOWN' },
          'oidc login failed',
        );
        return await go(reply, FAILED);
      }
    },
  );

  app.get(
    '/api/auth/oidc/callback',
    { config: { public: true }, exposeHeadRoute: false },
    async (request, reply) => {
      if (oidc === null) {
        reply.callNotFound();
        return reply;
      }
      // Cleared on every outcome, before anything can fail.
      void reply.setCookie(OIDC_FLOW_COOKIE, '', flowCookieOptions(0));
      // Before the flow cookie is opened and before any token request.
      const limit = callbackLimiter.take(`ip:${ipRateKey(request.ip)}`);
      if (!limit.allowed) {
        return rateLimited(reply, limit.retryAfterSeconds);
      }
      try {
        const flow = openFlow(request.cookies[OIDC_FLOW_COOKIE], oidc.flowKey, now());
        if (flow === null) {
          return await go(reply, FAILED);
        }
        // Built from the stored callback URL, never from the Host header.
        const currentUrl = new URL(oidc.callbackUrl);
        const queryStart = request.url.indexOf('?');
        currentUrl.search = queryStart === -1 ? '' : request.url.slice(queryStart);
        const identity = await oidc.provider.finish(currentUrl, flow);
        const result = resolveOidcLogin(db, identity, {
          allowRegistration: isRegistrationOpen(db, allowRegistration),
        });
        if (result.kind === 'refused') {
          request.log.info({ outcome: 'refused' }, 'oidc sign-in refused');
          return await go(reply, NOT_LINKED);
        }
        if (request.auth !== null) {
          deleteSession(db, request.auth);
        }
        setSessionCookies(reply, createSession(db, result.userId, 'oidc', now()), secureCookies);
        request.log.info({ via: result.via, userId: result.userId }, 'oidc sign-in');
        return await go(reply, '/');
      } catch (error) {
        request.log.warn(
          error instanceof OidcError
            ? { stage: error.stage, code: error.code }
            : { stage: 'finish', code: 'UNKNOWN' },
          'oidc callback failed',
        );
        return await go(reply, FAILED);
      }
    },
  );
}

import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthMode } from '../../lib/auth-mode.js';
import { CSRF_HEADER, hashToken } from './sessions.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function tokenMatches(token: string, storedHash: string): boolean {
  const given = Buffer.from(hashToken(token), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  return given.length === stored.length && timingSafeEqual(given, stored);
}

/**
 * Rejects an unsafe request on any path (so path encoding cannot bypass it) unless its Origin equals the public origin and, when it
 * carries a session, its X-CSRF-Token matches the session's stored hash. Never logs headers.
 */
export function createCsrfHook(
  publicOrigin: string,
  mode: AuthMode = 'local',
): (request: FastifyRequest, reply: FastifyReply, done: () => void) => void {
  return (request, reply, done) => {
    if (!UNSAFE_METHODS.has(request.method)) {
      done();
      return;
    }
    // Local password routes are disabled in OIDC mode and answer 403 local_auth_disabled themselves,
    // before any body or database work. They change nothing, so skipping the check here weakens nothing.
    if (mode === 'oidc' && request.routeOptions.config.localAuthOnly === true) {
      done();
      return;
    }
    const fail = (): void => {
      void reply.code(403).send({ error: 'csrf_failed' });
    };
    if (request.headers.origin !== publicOrigin) {
      fail();
      return;
    }
    if (request.auth === null) {
      done();
      return;
    }
    const token = request.headers[CSRF_HEADER];
    if (typeof token !== 'string' || token === '' || !tokenMatches(token, request.auth.csrfHash)) {
      fail();
      return;
    }
    done();
  };
}

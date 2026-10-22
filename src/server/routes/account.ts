import type { FastifyError, FastifyPluginAsync } from 'fastify';
import type { AuthMode } from '../../lib/auth-mode.js';
import {
  isAcceptablePasswordLength,
  isWithinRawLimit,
  hashPassword,
  normalisePassword,
  verifyAgainstDummy,
  verifyPassword,
} from '../auth/passwords.js';
import type { AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';

export interface AccountRoutesOptions {
  readonly db: AppDatabase;
  readonly mode: AuthMode;
}

/**
 * GET /api/account and PUT /api/account/password. Both read the user from the session only.
 * The password hash is read inside the PUT handler and never leaves it. A successful change
 * deletes the user's other sessions and keeps the current one.
 */
export const accountRoutes: FastifyPluginAsync<AccountRoutesOptions> = async (app, opts) => {
  const { db, mode } = opts;

  // Body parse failures (malformed JSON, empty body, wrong media type) get a fixed body.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/account', (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const repo = createUserRepo(db, request.auth.userId);
    const email = repo.getEmail();
    if (email === undefined) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return {
      email,
      mode,
      hasPassword: repo.getPasswordHash() !== null,
      identities: repo.listIdentities(),
    };
  });

  app.put('/account/password', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    if (mode === 'oidc') {
      return reply.code(403).send({ error: 'local_auth_disabled' });
    }
    const body: unknown = request.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const { currentPassword, newPassword } = body as Record<string, unknown>;
    if (
      typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' ||
      !isWithinRawLimit(newPassword)
    ) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const next = normalisePassword(newPassword);
    if (!isAcceptablePasswordLength(next)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const repo = createUserRepo(db, request.auth.userId);
    const stored = repo.getPasswordHash();
    let ok: boolean;
    if (stored === null || !isWithinRawLimit(currentPassword)) {
      ok = await verifyAgainstDummy('');
    } else {
      const current = normalisePassword(currentPassword);
      ok = isAcceptablePasswordLength(current)
        ? await verifyPassword(current, stored)
        : await verifyAgainstDummy('');
    }
    if (!ok) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    if (!repo.setPasswordHash(await hashPassword(next))) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    repo.deleteOtherSessions(request.auth.idHash);
    return reply.code(204).send();
  });
};

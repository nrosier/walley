import type { FastifyError, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { isAdminEmail, isRegistrationOpen } from '../auth/registration.js';
import type { AppDatabase } from '../db/client.js';
import { getRegistrationEnabled, setRegistrationEnabled } from '../db/app-settings.js';
import { createUserRepo } from '../db/repo.js';

export interface AdminRoutesOptions {
  readonly db: AppDatabase;
  /** The ALLOW_REGISTRATION ceiling. */
  readonly allowRegistration: boolean;
  /** Lowercased ADMIN_EMAILS. Empty: nobody can change the toggle. */
  readonly adminEmails: readonly string[];
}

/**
 * GET and PUT /api/admin/registration. The toggle is server-wide, so this is the only place it
 * changes. The caller is an admin when the session user's email is in ADMIN_EMAILS; anyone else
 * gets 403 forbidden. The check reads the email from the session user, never from the request.
 */
export const adminRoutes: FastifyPluginAsync<AdminRoutesOptions> = async (app, opts) => {
  const { db, allowRegistration, adminEmails } = opts;

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    return reply.code(500).send({ error: 'internal_error' });
  });

  /** Sends 401 or 403 and returns false unless the session user is an admin. */
  function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
    if (request.auth === null) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return false;
    }
    const email = createUserRepo(db, request.auth.userId).getEmail();
    if (email === undefined) {
      void reply.code(401).send({ error: 'unauthenticated' });
      return false;
    }
    if (!isAdminEmail(adminEmails, email)) {
      void reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  /** enabled: the stored toggle. ceiling: ALLOW_REGISTRATION. effective: both on. */
  const state = () => ({
    enabled: getRegistrationEnabled(db),
    ceiling: allowRegistration,
    effective: isRegistrationOpen(db, allowRegistration),
  });

  app.get('/admin/registration', (request, reply) => {
    if (!requireAdmin(request, reply)) {
      return reply;
    }
    return state();
  });

  app.put('/admin/registration', (request, reply) => {
    if (!requireAdmin(request, reply)) {
      return reply;
    }
    const body: unknown = request.body;
    const enabled =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['enabled'] : undefined;
    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    setRegistrationEnabled(db, enabled);
    return state();
  });
};

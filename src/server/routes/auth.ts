import type { FastifyPluginAsync } from 'fastify';
import type { AuthMode } from '../../lib/auth-mode.js';
import type { AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';

export interface AuthRoutesOptions {
  readonly db: AppDatabase;
  readonly mode: AuthMode;
  readonly allowRegistration: boolean;
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, opts) => {
  const { db, mode, allowRegistration } = opts;

  app.get('/auth/config', { config: { public: true } }, () => ({
    mode,
    registration: allowRegistration,
  }));

  app.get('/auth/me', (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const email = createUserRepo(db, request.auth.userId).getEmail();
    if (email === undefined) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    return { email, authMethod: request.auth.authMethod };
  });
};

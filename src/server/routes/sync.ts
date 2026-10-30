import type { FastifyPluginAsync } from 'fastify';
import { runSyncCheck, type SyncCheckDeps } from '../matching/sync-check.js';
import { sendFailure } from './integrations.js';

export interface SyncRoutesOptions {
  readonly deps: SyncCheckDeps;
}

/**
 * POST /api/sync/check: runs the matching steps for the signed-in user only. The user id comes
 * from the session, never from the request. Errors use the same fixed codes as the create routes.
 */
export const syncRoutes: FastifyPluginAsync<SyncRoutesOptions> = async (app, opts) => {
  app.post('/sync/check', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    // refresh: true skips the cache (the Run Sync Check button). Absent means false.
    const body: unknown = request.body;
    let refresh = false;
    if (body !== undefined && body !== null) {
      if (typeof body !== 'object' || Array.isArray(body)) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const flag = (body as Record<string, unknown>)['refresh'];
      if (flag !== undefined) {
        if (typeof flag !== 'boolean') return reply.code(400).send({ error: 'invalid_request' });
        refresh = flag;
      }
    }
    try {
      return await reply.code(200).send(await runSyncCheck(opts.deps, request.auth.userId, { refresh }));
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });
};

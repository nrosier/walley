import type { FastifyPluginAsync } from 'fastify';
import { runSyncCheck, type SyncCheckDeps } from '../matching/sync-check.js';
import { readItemDetails, type ItemSide } from '../matching/item-details.js';
import { sendFailure } from './integrations.js';

const MAX_ITEM_ID_LENGTH = 200;

function isItemSide(value: unknown): value is ItemSide {
  return value === 'wallos' || value === 'actual';
}

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

  /**
   * GET /api/sync/items/:side/:id (#155): read-only details of one synced item on one side, for the
   * signed-in user only. An item the user does not own, or a disabled or completed one, is 404.
   */
  app.get<{ Params: { side: string; id: string } }>('/sync/items/:side/:id', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const { side, id } = request.params;
    if (!isItemSide(side) || id.trim() === '' || id.length > MAX_ITEM_ID_LENGTH) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    try {
      const details = await readItemDetails(opts.deps, request.auth.userId, side, id);
      if (details === null) return await reply.code(404).send({ error: 'item_not_found' });
      return await reply.code(200).send(details);
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });
};

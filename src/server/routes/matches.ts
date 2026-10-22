import type { FastifyPluginAsync } from 'fastify';
import type { CreateDeps } from '../integrations/create.js';
import { hashMatchFields } from '../matching/hash.js';
import { readCurrentSides } from '../matching/sync-check.js';
import { sendFailure } from './integrations.js';

export interface MatchesRoutesOptions {
  readonly deps: Pick<CreateDeps, 'wallos' | 'repoFor' | 'withActual'>;
}

const MAX_ID_LENGTH = 200;

/**
 * POST /api/matches/:id/resolve. Only the two actions that write Walley's own data are built:
 * `ignore_diff` and `unlink`. Every other action (including the held `overwrite_wallos` and
 * `overwrite_actual`) answers 400 `unsupported_action` before anything is read or written. No
 * Wallos or Actual client is reachable from here. The match is looked up through the signed-in
 * user's repo only, so another user's id is a 404. Responses carry fixed codes, never ids.
 */
export const matchesRoutes: FastifyPluginAsync<MatchesRoutesOptions> = async (app, opts) => {
  app.post<{ Params: { id: string } }>('/matches/:id/resolve', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const id = request.params.id;
    const body: unknown = request.body;
    if (
      typeof id !== 'string' ||
      id.trim() === '' ||
      id.length > MAX_ID_LENGTH ||
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body)
    ) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const action = (body as Record<string, unknown>)['action'];
    const confirm = (body as Record<string, unknown>)['confirm'];
    if (action !== 'ignore_diff' && action !== 'unlink') {
      return reply.code(400).send({ error: 'unsupported_action' });
    }
    if (action === 'unlink' && confirm !== true) {
      return reply.code(400).send({ error: 'confirmation_required' });
    }
    try {
      const repo = opts.deps.repoFor(request.auth.userId);
      const match = repo.getMatch(id);
      if (match === undefined) {
        return await reply.code(404).send({ error: 'match_not_found' });
      }
      if (action === 'ignore_diff') {
        if (match.status !== 'MISMATCH_DETECTED') {
          return await reply.code(400).send({ error: 'invalid_state' });
        }
        if (match.wallosId === null || match.actualScheduleId === null) {
          return await reply.code(400).send({ error: 'invalid_state' });
        }
        const current = await readCurrentSides(opts.deps, request.auth.userId);
        const wallosFields = current.wallosSides.get(match.wallosId)?.fields ?? null;
        const actualFields = current.actualSides.get(match.actualScheduleId)?.fields ?? null;
        const wallosHash = wallosFields === null ? null : hashMatchFields(wallosFields);
        const actualHash = actualFields === null ? null : hashMatchFields(actualFields);
        // A missing or unhashable side (pattern schedule, unmappable item): write nothing.
        if (wallosHash === null || actualHash === null) {
          return await reply.code(400).send({ error: 'invalid_state' });
        }
        repo.updateMatch(id, { status: 'LINKED', lastKnownWallosHash: wallosHash, lastKnownActualHash: actualHash });
        return await reply.code(200).send({ status: 'LINKED' });
      }
      if (match.status !== 'LINKED' && match.status !== 'MISMATCH_DETECTED') {
        return await reply.code(400).send({ error: 'invalid_state' });
      }
      repo.deleteMatch(id);
      return await reply.code(200).send({ status: 'UNLINKED' });
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });
};

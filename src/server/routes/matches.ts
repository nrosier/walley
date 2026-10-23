import type { FastifyPluginAsync } from 'fastify';
import type { CreateDeps } from '../integrations/create.js';
import { DEFAULT_TOLERANCE_PERCENT } from '../../lib/amount-match.js';
import { hashMatchFields } from '../matching/hash.js';
import { OverwriteReadbackError, overwriteActual, overwriteWallos } from '../matching/overwrite.js';
import { isCandidate, readCurrentSides } from '../matching/sync-check.js';
import { sendFailure } from './integrations.js';

export interface MatchesRoutesOptions {
  readonly deps: Pick<CreateDeps, 'wallos' | 'repoFor' | 'withActual'>;
}

const MAX_ID_LENGTH = 200;

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_ID_LENGTH;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a SQLite unique-index violation (better-sqlite3 sets `code`). */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

const ALREADY_MATCHED = { error: 'already_matched' } as const;

/**
 * POST /api/matches links a candidate pair, POST /api/matches/ignore ignores one item, DELETE
 * /api/matches/:id restores an ignored item. These write only Walley's own matches table; the
 * link route reads both sides through readCurrentSides, the other two read nothing remote.
 *
 * POST /api/matches/:id/resolve. `ignore_diff` and `unlink` write only Walley's own data.
 * `overwrite_wallos` and `overwrite_actual` write to the remote side (see matching/overwrite.ts):
 * they need `confirm: true` and a MISMATCH_DETECTED match, snapshot the target record first, and
 * store server-computed hashes read back after the write. Any other action answers 400
 * `unsupported_action` before anything is read or written. The match is looked up through the
 * signed-in user's repo only, so another user's id is a 404 with no remote call. Responses carry
 * fixed codes, never ids.
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
    if (
      action !== 'ignore_diff' &&
      action !== 'unlink' &&
      action !== 'overwrite_wallos' &&
      action !== 'overwrite_actual'
    ) {
      return reply.code(400).send({ error: 'unsupported_action' });
    }
    if (action !== 'ignore_diff' && confirm !== true) {
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
      if (action === 'overwrite_wallos' || action === 'overwrite_actual') {
        if (match.status !== 'MISMATCH_DETECTED') {
          return await reply.code(400).send({ error: 'invalid_state' });
        }
        const run = action === 'overwrite_wallos' ? overwriteWallos : overwriteActual;
        const outcome = await run(opts.deps, request.auth.userId, match, new Date());
        if (outcome === 'no_change_needed') {
          // Nothing differed, so nothing was written and the match is still MISMATCH_DETECTED.
          return await reply.code(200).send({ status: 'MISMATCH_DETECTED', outcome: 'no_change_needed' });
        }
        return await reply.code(200).send({ status: 'LINKED' });
      }
      if (match.status !== 'LINKED' && match.status !== 'MISMATCH_DETECTED') {
        return await reply.code(400).send({ error: 'invalid_state' });
      }
      repo.deleteMatch(id);
      return await reply.code(200).send({ status: 'UNLINKED' });
    } catch (error: unknown) {
      if (error instanceof OverwriteReadbackError) {
        return reply.code(502).send({ error: 'overwrite_unverified' });
      }
      return sendFailure(reply, error);
    }
  });

  app.post('/matches', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const body: unknown = request.body;
    if (!isRecord(body) || !isId(body['wallosId']) || !isId(body['actualScheduleId'])) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const wallosId = body['wallosId'];
    const actualScheduleId = body['actualScheduleId'];
    const userId = request.auth.userId;
    try {
      const repo = opts.deps.repoFor(userId);
      // Checked before any remote read, so an already matched item costs no Wallos or Actual call.
      if (repo.findMatchByItem('wallos', wallosId) !== undefined || repo.findMatchByItem('actual', actualScheduleId) !== undefined) {
        return await reply.code(409).send(ALREADY_MATCHED);
      }
      const current = await readCurrentSides(opts.deps, userId);
      const w = current.wallosSides.get(wallosId);
      const a = current.actualSides.get(actualScheduleId);
      if (w === undefined || a === undefined) {
        return await reply.code(400).send({ error: 'item_not_found' });
      }
      const tolerance = repo.getConfig()?.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT;
      const wallosHash = w.fields === null ? null : hashMatchFields(w.fields);
      const actualHash = a.fields === null ? null : hashMatchFields(a.fields);
      if (wallosHash === null || actualHash === null || isCandidate(w, a, tolerance) === null) {
        return await reply.code(400).send({ error: 'not_candidate' });
      }
      let row;
      try {
        row = repo.insertMatch({
          wallosId,
          actualScheduleId,
          status: 'LINKED',
          lastKnownWallosHash: wallosHash,
          lastKnownActualHash: actualHash,
        });
      } catch (error: unknown) {
        // A concurrent request linked or ignored one of the items after the check above.
        if (isUniqueViolation(error)) return await reply.code(409).send(ALREADY_MATCHED);
        throw error;
      }
      return await reply.code(201).send({ id: row.id, status: 'LINKED' });
    } catch (error: unknown) {
      return sendFailure(reply, error);
    }
  });

  app.post('/matches/ignore', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const body: unknown = request.body;
    if (!isRecord(body) || (body['side'] !== 'wallos' && body['side'] !== 'actual') || !isId(body['itemId'])) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const side = body['side'];
    const itemId = body['itemId'];
    try {
      const repo = opts.deps.repoFor(request.auth.userId);
      if (repo.findMatchByItem(side, itemId) !== undefined) return await reply.code(409).send(ALREADY_MATCHED);
      const status = side === 'wallos' ? 'IGNORED_WALLOS' : 'IGNORED_ACTUAL';
      let row;
      try {
        row = repo.insertMatch({
          wallosId: side === 'wallos' ? itemId : null,
          actualScheduleId: side === 'actual' ? itemId : null,
          status,
          lastKnownWallosHash: null,
          lastKnownActualHash: null,
        });
      } catch (error: unknown) {
        if (isUniqueViolation(error)) return await reply.code(409).send(ALREADY_MATCHED);
        throw error;
      }
      return await reply.code(201).send({ id: row.id, status });
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });

  app.delete<{ Params: { id: string } }>('/matches/:id', async (request, reply) => {
    if (request.auth === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    const id = request.params.id;
    if (!isId(id)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    try {
      const repo = opts.deps.repoFor(request.auth.userId);
      const match = repo.getMatch(id);
      if (match === undefined) {
        return await reply.code(404).send({ error: 'match_not_found' });
      }
      if (match.status !== 'IGNORED_WALLOS' && match.status !== 'IGNORED_ACTUAL') {
        return await reply.code(400).send({ error: 'invalid_state' });
      }
      repo.deleteMatch(id);
      return await reply.code(204).send();
    } catch (error: unknown) {
      return await Promise.resolve(sendFailure(reply, error));
    }
  });
};

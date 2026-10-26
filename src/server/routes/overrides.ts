import type { FastifyError, FastifyPluginAsync } from 'fastify';
import { parseRate } from '../../lib/currency-convert.js';
import type { UserRepo } from '../db/repo.js';

export interface OverridesDeps {
  readonly repoFor: (userId: string) => UserRepo;
  /** Epoch milliseconds, the same clock the session hook uses. */
  readonly now: () => number;
}

export interface OverridesOptions {
  readonly deps: OverridesDeps;
}

/** Same id cap as the link routes in matches.ts. */
const MAX_ID_LENGTH = 200;

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_ID_LENGTH ? value : null;
}

/**
 * #28: per-subscription currency rate overrides. The user id comes from the session only. Saving a
 * changed rate, or clearing one, resets that user's LINKED Wallos hashes inside the repo
 * transaction. No Wallos or Actual call is made. Errors use fixed codes.
 */
export const overridesRoutes: FastifyPluginAsync<OverridesOptions> = async (app, opts) => {
  const { deps } = opts;

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/overrides/:wallosSubscriptionId', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const id = readId((request.params as Record<string, unknown>)['wallosSubscriptionId']);
    if (id === null) return reply.code(400).send({ error: 'invalid_request' });
    const row = deps.repoFor(request.auth.userId).getSubscriptionOverride(id);
    if (row === undefined) return reply.code(404).send({ error: 'not_found' });
    return reply.code(200).send({ wallosSubscriptionId: id, rate: row.rate });
  });

  app.put('/overrides/:wallosSubscriptionId', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const id = readId((request.params as Record<string, unknown>)['wallosSubscriptionId']);
    const body: unknown = request.body;
    if (id === null || typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const rate = (body as Record<string, unknown>)['rate'];
    if (typeof rate !== 'string') return reply.code(400).send({ error: 'invalid_request' });
    try {
      parseRate(rate);
    } catch {
      return reply.code(400).send({ error: 'invalid_rate' });
    }
    try {
      const saved = deps
        .repoFor(request.auth.userId)
        .saveSubscriptionOverride(id, { rate, now: new Date(deps.now()) });
      return await reply.code(200).send({
        wallosSubscriptionId: id,
        rate: saved.override.rate,
        resetMatches: saved.resetMatchIds.length,
      });
    } catch {
      return reply.code(500).send({ error: 'internal_error' });
    }
  });

  app.delete('/overrides/:wallosSubscriptionId', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const id = readId((request.params as Record<string, unknown>)['wallosSubscriptionId']);
    if (id === null) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const result = deps.repoFor(request.auth.userId).clearSubscriptionOverride(id);
      if (!result.deleted) return await reply.code(404).send({ error: 'not_found' });
      return await reply.code(204).send();
    } catch {
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
};

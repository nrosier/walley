import type { FastifyError, FastifyPluginAsync } from 'fastify';
import type { UserRepo } from '../db/repo.js';

export interface SettingsMatchingDeps {
  readonly repoFor: (userId: string) => UserRepo;
}

export interface SettingsMatchingOptions {
  readonly deps: SettingsMatchingDeps;
}

/** Used when the user has no config row yet. Matches the column default. */
export const DEFAULT_TOLERANCE_PERCENT = 5;
export const MIN_TOLERANCE_PERCENT = 0;
export const MAX_TOLERANCE_PERCENT = 50;

export type ToleranceCheck =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: 'invalid_request' | 'out_of_range' };

/** A number that is finite and within 0 to 50 inclusive. Any other type is invalid_request. */
export function checkTolerance(raw: unknown): ToleranceCheck {
  if (typeof raw !== 'number') return { ok: false, error: 'invalid_request' };
  if (!Number.isFinite(raw) || raw < MIN_TOLERANCE_PERCENT || raw > MAX_TOLERANCE_PERCENT) {
    return { ok: false, error: 'out_of_range' };
  }
  // Store -0 as 0.
  return { ok: true, value: raw === 0 ? 0 : raw };
}

/**
 * Per-user matching settings. The user id comes from the session only; a user id in the body is
 * ignored. Errors use fixed codes and never echo the request.
 */
export const settingsMatchingRoutes: FastifyPluginAsync<SettingsMatchingOptions> = async (app, opts) => {
  const { deps } = opts;

  // Body parse failures (malformed JSON, empty body, wrong media type) get a fixed body.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/settings/matching', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const config = deps.repoFor(request.auth.userId).getConfig();
    return reply.code(200).send({
      tolerancePercent: config?.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT,
    });
  });

  app.put('/settings/matching', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const body: unknown = request.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const checked = checkTolerance((body as Record<string, unknown>)['tolerancePercent']);
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    let saved: number;
    try {
      saved = deps.repoFor(request.auth.userId).upsertConfig({ tolerancePercent: checked.value })
        .tolerancePercent;
    } catch {
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(200).send({ tolerancePercent: saved });
  });
};

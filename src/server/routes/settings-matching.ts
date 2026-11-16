import type { FastifyError, FastifyPluginAsync } from 'fastify';
import {
  CURRENCY_DRIFT_STEP,
  DEFAULT_CURRENCY_DRIFT_PERCENT,
  MAX_CURRENCY_DRIFT_PERCENT,
  MIN_CURRENCY_DRIFT_PERCENT,
} from '../../lib/amount-match.js';
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

export type CurrencyDriftCheck = ToleranceCheck;

/**
 * A number that is finite, within 0 to 10 inclusive and a multiple of 0.5. Any other type is
 * invalid_request (#229).
 */
export function checkCurrencyDrift(raw: unknown): CurrencyDriftCheck {
  if (typeof raw !== 'number') return { ok: false, error: 'invalid_request' };
  if (
    !Number.isFinite(raw) ||
    raw < MIN_CURRENCY_DRIFT_PERCENT ||
    raw > MAX_CURRENCY_DRIFT_PERCENT ||
    raw % CURRENCY_DRIFT_STEP !== 0
  ) {
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
      currencyDriftPercent: config?.currencyDriftPercent ?? DEFAULT_CURRENCY_DRIFT_PERCENT,
    });
  });

  app.put('/settings/matching', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const body: unknown = request.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const record = body as Record<string, unknown>;
    const hasTolerance = Object.hasOwn(record, 'tolerancePercent');
    const hasDrift = Object.hasOwn(record, 'currencyDriftPercent');
    if (!hasTolerance && !hasDrift) return reply.code(400).send({ error: 'invalid_request' });
    // Validate every present key before anything is written.
    const input: { tolerancePercent?: number; currencyDriftPercent?: number } = {};
    if (hasTolerance) {
      const checked = checkTolerance(record['tolerancePercent']);
      if (!checked.ok) return reply.code(400).send({ error: checked.error });
      input.tolerancePercent = checked.value;
    }
    if (hasDrift) {
      const checked = checkCurrencyDrift(record['currencyDriftPercent']);
      if (!checked.ok) return reply.code(400).send({ error: checked.error });
      input.currencyDriftPercent = checked.value;
    }
    let saved: { tolerancePercent: number; currencyDriftPercent: number };
    try {
      const row = deps.repoFor(request.auth.userId).upsertConfig(input);
      saved = { tolerancePercent: row.tolerancePercent, currencyDriftPercent: row.currencyDriftPercent };
    } catch {
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(200).send(saved);
  });
};

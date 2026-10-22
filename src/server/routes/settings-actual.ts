import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { deriveUserKey } from '../crypto/keys.js';
import { encryptSecret } from '../crypto/secrets.js';
import type { UserConfigInput, UserRepo } from '../db/repo.js';
import { listBudgets, readBaseCurrency } from '../integrations/actual/read.js';
import { ActualSessionError, type ActualApi } from '../integrations/actual/session.js';
import { sendFailure } from './integrations.js';
import { validateServiceUrl } from './service-url.js';

type WithActual = <T>(userId: string, use: (api: ActualApi) => Promise<T>) => Promise<T>;

export interface SettingsActualDeps {
  readonly repoFor: (userId: string) => UserRepo;
  readonly appSecret: string;
  /** Signs in to the user's Actual server without opening a budget (withActualServer). */
  readonly withActualServer: WithActual;
  /** Runs `use` inside the user's open Actual budget (withActualSession). */
  readonly withActual: WithActual;
}

export interface SettingsActualOptions {
  readonly deps: SettingsActualDeps;
}

const MAX_SECRET_LENGTH = 1000;
const MAX_ID_LENGTH = 200;
const INVALID = { error: 'invalid_request' } as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** undefined: field absent or blank (keep stored). null: wrong type or too long. */
function readSecret(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > MAX_SECRET_LENGTH) return null;
  return value.trim() === '' ? undefined : value;
}

function view(repo: UserRepo) {
  const config = repo.getConfig();
  return {
    actualUrl: config?.actualUrl ?? '',
    actualBudgetId: config?.actualBudgetId ?? null,
    hasActualPassword: Boolean(config?.actualPasswordEnc),
    hasActualSyncKey: Boolean(config?.actualSyncKeyEnc),
  };
}

/** Errors raised by the api inside `use` carry library text; replace them with a fixed one. */
async function readOnly<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    throw new ActualSessionError('open_failed');
  }
}

/**
 * Per-user Actual Budget settings. The user id comes from the session. The server password and
 * sync key are write-only: encrypted on save, never returned in any form, and never echoed in an
 * error. Nothing here writes to Actual.
 */
export const settingsActualRoutes: FastifyPluginAsync<SettingsActualOptions> = async (app, opts) => {
  const { deps } = opts;

  app.get('/settings/actual', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    return reply.code(200).send(view(deps.repoFor(request.auth.userId)));
  });

  app.put('/settings/actual', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const body: unknown = request.body;
    if (!isRecord(body)) return reply.code(400).send(INVALID);
    const actualUrl = validateServiceUrl(body['actualUrl']);
    if (actualUrl === null) return reply.code(400).send({ error: 'invalid_url' });
    const password = readSecret(body['password']);
    const syncKey = readSecret(body['syncKey']);
    const clearSyncKey = body['clearSyncKey'];
    const rawBudgetId = body['actualBudgetId'];
    if (
      password === null ||
      syncKey === null ||
      (clearSyncKey !== undefined && typeof clearSyncKey !== 'boolean') ||
      (clearSyncKey === true && syncKey !== undefined) ||
      (rawBudgetId !== undefined &&
        rawBudgetId !== null &&
        (typeof rawBudgetId !== 'string' || rawBudgetId.length > MAX_ID_LENGTH))
    ) {
      return reply.code(400).send(INVALID);
    }

    const userId = request.auth.userId;
    const repo = deps.repoFor(userId);
    const stored = repo.getConfig();
    const urlChanged = (stored?.actualUrl ?? null) !== actualUrl;
    // The stored password is sent to whatever server the URL names. A new URL needs the password
    // re-entered, so a stolen session cannot point the saved secret at another host.
    if (urlChanged && stored?.actualPasswordEnc && password === undefined) {
      return reply.code(400).send({ error: 'password_required' });
    }

    const update: UserConfigInput = { actualUrl };
    if (urlChanged) {
      // The budget id belongs to the old server.
      update.actualBudgetId = null;
    } else if (rawBudgetId !== undefined) {
      const budgetId = typeof rawBudgetId === 'string' ? rawBudgetId.trim() : '';
      update.actualBudgetId = budgetId === '' ? null : budgetId;
    }
    if (clearSyncKey === true) update.actualSyncKeyEnc = null;

    try {
      if (password !== undefined || syncKey !== undefined) {
        const salt = repo.getKeySalt();
        if (salt === undefined) return await reply.code(500).send({ error: 'internal_error' });
        const key = deriveUserKey(deps.appSecret, salt, userId);
        if (password !== undefined) update.actualPasswordEnc = encryptSecret(password, key);
        if (syncKey !== undefined) update.actualSyncKeyEnc = encryptSecret(syncKey, key);
      }
      repo.upsertConfig(update);
    } catch {
      return reply.code(500).send({ error: 'internal_error' });
    }
    return reply.code(200).send(view(repo));
  });

  const run = async <T>(reply: FastifyReply, task: () => Promise<T>): Promise<FastifyReply> => {
    try {
      return await reply.code(200).send(await task());
    } catch (error: unknown) {
      return sendFailure(reply, error);
    }
  };

  // Saved credentials only; no body is read.
  app.post('/settings/actual/budgets', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const userId = request.auth.userId;
    return run(reply, async () => ({
      budgets: await deps.withActualServer(userId, (api) => readOnly(() => listBudgets(api))),
    }));
  });

  // Opens the saved budget and reads its currency. The result is not stored.
  app.post('/settings/actual/base-currency', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const userId = request.auth.userId;
    return run(reply, async () => ({
      currency: await deps.withActual(userId, (api) => readOnly(() => readBaseCurrency(api))),
    }));
  });
};

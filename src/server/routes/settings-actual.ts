import type { FastifyError, FastifyPluginAsync, FastifyReply } from 'fastify';
import { deriveUserKey } from '../crypto/keys.js';
import { encryptSecret } from '../crypto/secrets.js';
import type { UserConfigInput, UserRepo } from '../db/repo.js';
import { listBudgets, readBaseCurrency } from '../integrations/actual/read.js';
import {
  ActualSessionError,
  type ActualApi,
  type ActualServerOverride,
} from '../integrations/actual/session.js';
import { sendFailure } from './integrations.js';
import { validateServiceUrl } from './service-url.js';
import { createTypedTestGuard } from './typed-test-limit.js';

type WithActual = <T>(userId: string, use: (api: ActualApi) => Promise<T>) => Promise<T>;
type WithActualServer = <T>(
  userId: string,
  use: (api: ActualApi) => Promise<T>,
  override?: ActualServerOverride,
) => Promise<T>;

export interface SettingsActualDeps {
  readonly repoFor: (userId: string) => UserRepo;
  readonly appSecret: string;
  /** Signs in to the user's Actual server without opening a budget (withActualServer). */
  readonly withActualServer: WithActualServer;
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
  // Own limiter for the typed-value budget load: a separate counter from login and every other route.
  const loadGuard = createTypedTestGuard();

  // Body parse failures (malformed JSON, wrong media type) get a fixed body that never echoes input.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    const status = error.statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(400).send(INVALID);
    }
    return reply.code(500).send({ error: 'internal_error' });
  });

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

  // READ only; nothing is written. The optional body carries the typed, unsaved actualUrl, password,
  // syncKey and actualBudgetId. A field that is absent or blank falls back to the caller's own saved
  // value. Listing budgets signs in with the URL and password only; the sync key and budget id are
  // checked for shape and not used. The body is never logged and no response carries a secret.
  app.post('/settings/actual/budgets', async (request, reply) => {
    if (request.auth === null) return reply.code(401).send({ error: 'unauthenticated' });
    const userId = request.auth.userId;
    // Before the body is read or any outside call.
    if (loadGuard(request, reply, userId)) return reply;
    const body: unknown = request.body;
    if (body !== undefined && body !== null && !isRecord(body)) return reply.code(400).send(INVALID);
    const fields = isRecord(body) ? body : {};
    const rawUrl = fields['actualUrl'];
    const password = readSecret(fields['password']);
    const syncKey = readSecret(fields['syncKey']);
    const rawBudgetId = fields['actualBudgetId'];
    let serverURL: string | undefined;
    if (rawUrl !== undefined && rawUrl !== null && !(typeof rawUrl === 'string' && rawUrl.trim() === '')) {
      const checked = validateServiceUrl(rawUrl);
      if (checked === null) return reply.code(400).send({ error: 'invalid_url' });
      serverURL = checked;
    }
    if (
      password === null ||
      syncKey === null ||
      (rawBudgetId !== undefined &&
        rawBudgetId !== null &&
        (typeof rawBudgetId !== 'string' || rawBudgetId.length > MAX_ID_LENGTH))
    ) {
      return reply.code(400).send(INVALID);
    }
    // The saved password is sent to whatever server the URL names. As on save, a different URL
    // needs the password typed, so a stolen session cannot point the saved secret at another host.
    if (serverURL !== undefined && password === undefined) {
      const saved = deps.repoFor(userId).getConfig();
      if (saved?.actualPasswordEnc && saved.actualUrl !== serverURL) {
        return reply.code(400).send({ error: 'password_required' });
      }
    }
    const override: { serverURL?: string; password?: string } = {};
    if (serverURL !== undefined) override.serverURL = serverURL;
    if (password !== undefined) override.password = password;
    const hasOverride = override.serverURL !== undefined || override.password !== undefined;
    return run(reply, async () => ({
      budgets: await (hasOverride
        ? deps.withActualServer(userId, (api) => readOnly(() => listBudgets(api)), override)
        : deps.withActualServer(userId, (api) => readOnly(() => listBudgets(api)))),
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

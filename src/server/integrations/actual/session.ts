import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import * as actualApi from '@actual-app/api';
import { decryptSecret } from '../../crypto/secrets.js';
import { deriveUserKey } from '../../crypto/keys.js';
import type { AppDatabase } from '../../db/client.js';
import { createUserRepo } from '../../db/repo.js';

/** The open @actual-app/api module, handed to the caller while the budget is loaded. */
export type ActualApi = typeof actualApi;

export interface ActualSessionDeps {
  readonly db: AppDatabase;
  /** APP_SECRET, used only to derive the user's key. */
  readonly appSecret: string;
  /** Config DATA_DIR. The user's folder is DATA_DIR/actual/<userId>. */
  readonly dataDir: string;
}

export type ActualSessionErrorCode = 'not_configured' | 'open_failed' | 'close_failed';

const MESSAGES: Record<ActualSessionErrorCode, string> = {
  not_configured: 'Actual Budget is not configured for this user',
  open_failed: 'Could not open the Actual Budget session',
  close_failed: 'Could not close the Actual Budget session',
};

/** Fixed messages only. It never carries a credential, a URL or the underlying error. */
export class ActualSessionError extends Error {
  readonly code: ActualSessionErrorCode;

  constructor(code: ActualSessionErrorCode) {
    super(MESSAGES[code]);
    this.name = 'ActualSessionError';
    this.code = code;
  }
}

/**
 * @actual-app/api holds one process-wide session (init, the loaded budget, shutdown), so the whole
 * open, use and close lifecycle of every user runs behind this chain, one at a time.
 */
let tail: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task, task);
  tail = run.catch(() => undefined);
  return run;
}

interface ServerCredentials {
  readonly serverURL: string;
  readonly password: string;
}

interface Credentials extends ServerCredentials {
  readonly budgetId: string;
  readonly syncKey: string | undefined;
}

/** Decrypts the server password and, when `withBudget`, the budget id and optional sync key. */
function loadCredentials(deps: ActualSessionDeps, userId: string, withBudget: true): Credentials;
function loadCredentials(deps: ActualSessionDeps, userId: string, withBudget: false): ServerCredentials;
function loadCredentials(
  deps: ActualSessionDeps,
  userId: string,
  withBudget: boolean,
): Credentials | ServerCredentials {
  const repo = createUserRepo(deps.db, userId);
  const config = repo.getConfig();
  const keySalt = repo.getKeySalt();
  if (
    config === undefined ||
    keySalt === undefined ||
    !config.actualUrl ||
    !config.actualPasswordEnc ||
    (withBudget && !config.actualBudgetId)
  ) {
    throw new ActualSessionError('not_configured');
  }
  try {
    const key = deriveUserKey(deps.appSecret, keySalt, userId);
    const server: ServerCredentials = {
      serverURL: config.actualUrl,
      password: decryptSecret(config.actualPasswordEnc, key),
    };
    if (!withBudget) return server;
    return {
      ...server,
      budgetId: config.actualBudgetId ?? '',
      syncKey: config.actualSyncKeyEnc ? decryptSecret(config.actualSyncKeyEnc, key) : undefined,
    };
  } catch {
    throw new ActualSessionError('open_failed');
  }
}

/**
 * One serialized lifecycle: init with the server credentials, run `afterInit` (for example a
 * budget download), then `use`, and always shut down. Any init or `afterInit` failure becomes a
 * fixed open_failed error; a shutdown failure only surfaces when nothing failed before it.
 */
function runSession<C extends ServerCredentials, T>(
  deps: ActualSessionDeps,
  userId: string,
  load: () => C,
  afterInit: (credentials: C) => Promise<void>,
  use: (api: ActualApi) => Promise<T>,
): Promise<T> {
  return serialize(async () => {
    const credentials = load();
    const dataDir = join(deps.dataDir, 'actual', userId);
    let result: T | undefined;
    let failure: { readonly error: unknown } | undefined;
    try {
      await mkdir(dataDir, { recursive: true });
      try {
        await actualApi.init({
          dataDir,
          serverURL: credentials.serverURL,
          password: credentials.password,
        });
        await afterInit(credentials);
      } catch {
        throw new ActualSessionError('open_failed');
      }
      result = await use(actualApi);
    } catch (error: unknown) {
      failure = { error };
    }
    try {
      await actualApi.shutdown();
    } catch {
      failure ??= { error: new ActualSessionError('close_failed') };
    }
    if (failure !== undefined) {
      throw failure.error;
    }
    return result as T;
  });
}

/**
 * Opens the user's budget, runs `use`, and always shuts the session down. Calls are serialized
 * across all users. The user's own config row is the only one read. The Actual server password
 * signs in to the server; the optional sync key is the budget's end-to-end encryption password.
 * Credentials never leave this function: not in the result, not in any error.
 */
export function withActualSession<T>(
  deps: ActualSessionDeps,
  userId: string,
  use: (api: ActualApi) => Promise<T>,
): Promise<T> {
  return runSession(
    deps,
    userId,
    () => loadCredentials(deps, userId, true),
    async (c) => {
      await actualApi.downloadBudget(
        c.budgetId,
        c.syncKey === undefined ? undefined : { password: c.syncKey },
      );
    },
    use,
  );
}

/**
 * Signs in to the user's Actual server without opening a budget (for listing budgets), runs
 * `use`, and always shuts down. Shares the serialization chain with withActualSession. Reads
 * only the server URL and password; the budget id and sync key are not loaded or decrypted.
 */
export function withActualServer<T>(
  deps: ActualSessionDeps,
  userId: string,
  use: (api: ActualApi) => Promise<T>,
): Promise<T> {
  return runSession(
    deps,
    userId,
    () => loadCredentials(deps, userId, false),
    () => Promise.resolve(),
    use,
  );
}

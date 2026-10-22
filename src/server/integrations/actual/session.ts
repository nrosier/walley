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

interface Credentials {
  readonly serverURL: string;
  readonly password: string;
  readonly budgetId: string;
  readonly syncKey: string | undefined;
}

function loadCredentials(deps: ActualSessionDeps, userId: string): Credentials {
  const repo = createUserRepo(deps.db, userId);
  const config = repo.getConfig();
  const keySalt = repo.getKeySalt();
  if (
    config === undefined ||
    keySalt === undefined ||
    !config.actualUrl ||
    !config.actualBudgetId ||
    !config.actualPasswordEnc
  ) {
    throw new ActualSessionError('not_configured');
  }
  try {
    const key = deriveUserKey(deps.appSecret, keySalt, userId);
    return {
      serverURL: config.actualUrl,
      password: decryptSecret(config.actualPasswordEnc, key),
      budgetId: config.actualBudgetId,
      syncKey: config.actualSyncKeyEnc ? decryptSecret(config.actualSyncKeyEnc, key) : undefined,
    };
  } catch {
    throw new ActualSessionError('open_failed');
  }
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
  return serialize(async () => {
    const credentials = loadCredentials(deps, userId);
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
        await actualApi.downloadBudget(
          credentials.budgetId,
          credentials.syncKey === undefined ? undefined : { password: credentials.syncKey },
        );
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

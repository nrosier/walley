import { deriveUserKey } from '../../crypto/keys.js';
import { decryptSecret } from '../../crypto/secrets.js';
import type { UserRepo } from '../../db/repo.js';
import type { WallosSubscription } from './types.js';

/** Request header that carries the Wallos API key; confirmed from the Wallos API docs. */
export const WALLOS_API_KEY_HEADER = 'x-api-key';

const SUBSCRIPTIONS_PATH = '/api/subscriptions';
const DEFAULT_TIMEOUT_MS = 10000;

/** No config row, or an empty, unreadable or unsafe URL or key. */
export class WallosConfigMissing extends Error {
  constructor() {
    super('Wallos is not configured');
    this.name = 'WallosConfigMissing';
  }
}

/** HTTP 401 or 403 from Wallos. */
export class WallosAuthError extends Error {
  constructor() {
    super('Wallos rejected the API key');
    this.name = 'WallosAuthError';
  }
}

/** Any other non-2xx answer, or an answer that is not a subscription list. */
export class WallosHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Wallos returned HTTP ${String(status)}`);
    this.name = 'WallosHttpError';
    this.status = status;
  }
}

/** The request threw or timed out. Carries no inner message. */
export class WallosNetworkError extends Error {
  constructor() {
    super('Wallos could not be reached');
    this.name = 'WallosNetworkError';
  }
}

export interface WallosClientOptions {
  fetch?: typeof fetch;
  /** Milliseconds. Default 10000. */
  timeoutMs?: number;
}

export interface WallosClient {
  listSubscriptions(userId: string): Promise<WallosSubscription[]>;
}

function buildEndpoint(stored: string): URL {
  let url: URL;
  try {
    url = new URL(stored.trim());
  } catch {
    throw new WallosConfigMissing();
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    stored.includes('?') ||
    stored.includes('#')
  ) {
    throw new WallosConfigMissing();
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + SUBSCRIPTIONS_PATH;
  return url;
}

function extractList(body: unknown): unknown[] | undefined {
  // TODO: response envelope unconfirmed; accept a bare array or { subscriptions: [...] }.
  if (Array.isArray(body)) return body as unknown[];
  if (typeof body === 'object' && body !== null) {
    const inner = (body as { subscriptions?: unknown }).subscriptions;
    if (Array.isArray(inner)) return inner as unknown[];
  }
  return undefined;
}

/** Returns the repo bound to one user, e.g. `(id) => createUserRepo(db, id)`. */
export type UserRepoFor = (userId: string) => UserRepo;

/**
 * Each call reads only the config row and key salt of the user it is given. The decrypted
 * API key lives only inside that call.
 */
export function createWallosClient(
  repoFor: UserRepoFor,
  appSecret: string,
  options: WallosClientOptions = {},
): WallosClient {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async listSubscriptions(userId) {
      const repo = repoFor(userId);
      if (repo.userId !== userId) {
        throw new WallosConfigMissing();
      }
      const config = repo.getConfig();
      const storedUrl = config?.wallosUrl;
      const storedKey = config?.wallosApiKeyEnc;
      if (!storedUrl || !storedKey) {
        throw new WallosConfigMissing();
      }
      const endpoint = buildEndpoint(storedUrl);

      const keySalt = repo.getKeySalt();
      if (keySalt === undefined) {
        throw new WallosConfigMissing();
      }
      let apiKey: string;
      try {
        apiKey = decryptSecret(storedKey, deriveUserKey(appSecret, keySalt, userId));
      } catch {
        throw new WallosConfigMissing();
      }
      if (apiKey.length === 0) {
        throw new WallosConfigMissing();
      }

      const headers: Record<string, string> = {
        accept: 'application/json',
        [WALLOS_API_KEY_HEADER]: apiKey,
      };

      let response: Response;
      try {
        response = await doFetch(endpoint.toString(), {
          method: 'GET',
          headers,
          // Never follow a redirect: it could carry the key to another host.
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new WallosNetworkError();
      }

      if (response.status === 401 || response.status === 403) {
        throw new WallosAuthError();
      }
      if (response.status < 200 || response.status > 299) {
        throw new WallosHttpError(response.status);
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new WallosHttpError(response.status);
      }
      const list = extractList(body);
      if (list === undefined) {
        throw new WallosHttpError(response.status);
      }
      return list as WallosSubscription[];
    },
  };
}

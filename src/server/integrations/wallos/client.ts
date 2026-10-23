import { deriveUserKey } from '../../crypto/keys.js';
import { decryptSecret } from '../../crypto/secrets.js';
import type { UserRepo } from '../../db/repo.js';
import {
  WALLOS_SUBSCRIPTION_FIELDS,
  type WallosCurrency,
  type WallosSubscription,
} from './types.js';
import type { WallosSubscriptionPayload, WallosSubscriptionUpdate } from './write.js';

// Wallos reads api_key only from $_REQUEST['api_key'] ?? $_REQUEST['apiKey'] (query or form
// body, never a header): ellite/Wallos api/subscriptions/get_subscriptions.php. We send it
// as a POST form field so it stays out of URLs and access logs.
const SUBSCRIPTIONS_PATH = '/api/subscriptions/get_subscriptions.php';
// Same auth as above: ellite/Wallos api/currencies/get_currencies.php.
const CURRENCIES_PATH = '/api/currencies/get_currencies.php';
// Same auth as above: ellite/Wallos api/subscriptions/set_subscriptions.php, action=add.
const CREATE_SUBSCRIPTION_PATH = '/api/subscriptions/set_subscriptions.php';
const DEFAULT_TIMEOUT_MS = 10000;
// `title` values Wallos sends with HTTP 200 and success:false when the api_key is refused.
const AUTH_REJECTION_TITLES: ReadonlySet<string> = new Set(['Unauthorized', 'Missing API key']);

/** No config row, or an empty, unreadable or unsafe URL or key. */
export class WallosConfigMissing extends Error {
  constructor() {
    super('Wallos is not configured');
    this.name = 'WallosConfigMissing';
  }
}

/** HTTP 401 or 403 from Wallos, or HTTP 200 with `success: false`. */
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

/**
 * HTTP 200 with `success: false` for a write Wallos refused for a reason other than the key,
 * e.g. "Invalid currency ID". `title` is Wallos's own short reason.
 */
export class WallosRejectedError extends Error {
  readonly title: string;
  constructor(title: string) {
    super('Wallos rejected the subscription');
    this.name = 'WallosRejectedError';
    this.title = title;
  }
}

export interface WallosClientOptions {
  fetch?: typeof fetch;
  /** Milliseconds. Default 10000. */
  timeoutMs?: number;
}

export interface WallosClient {
  listSubscriptions(userId: string): Promise<WallosSubscription[]>;
  /** The user's own Wallos currency list, the only source of currency codes. */
  listCurrencies(userId: string): Promise<WallosCurrency[]>;
  /** Creates a subscription in the user's Wallos. Resolves to the new Wallos id. */
  createSubscription(userId: string, payload: WallosSubscriptionPayload): Promise<string>;
  /**
   * Edits one subscription in the user's Wallos (action=edit). Only the fields in `fields` change.
   * `id` must be a string of digits.
   */
  updateSubscription(userId: string, id: string, fields: WallosSubscriptionUpdate): Promise<void>;
}

function buildEndpoint(stored: string, path: string): URL {
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
  url.pathname = url.pathname.replace(/\/+$/, '') + path;
  return url;
}

/** Copies only the documented fields; anything else Wallos sends is dropped. */
function mapSubscription(raw: unknown): WallosSubscription | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  if (typeof src['id'] !== 'number' && typeof src['id'] !== 'string') return undefined;
  const out: Record<string, unknown> = {};
  for (const field of WALLOS_SUBSCRIPTION_FIELDS) {
    if (src[field] !== undefined) out[field] = src[field];
  }
  return out as unknown as WallosSubscription;
}

/** Copies only id, code, name and rate. Returns undefined when id or code is unusable. */
function mapCurrency(raw: unknown): WallosCurrency | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const src = raw as Record<string, unknown>;
  if (typeof src['id'] !== 'number' && typeof src['id'] !== 'string') return undefined;
  if (typeof src['code'] !== 'string' || src['code'].trim() === '') return undefined;
  const out: WallosCurrency = { id: src['id'], code: src['code'] };
  if (typeof src['name'] === 'string') out.name = src['name'];
  if (typeof src['rate'] === 'string' || typeof src['rate'] === 'number') {
    out.rate = String(src['rate']);
  }
  return out;
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

  /** Shared request: config, decrypt, POST, status and envelope checks. Returns the body. */
  async function request(
    userId: string,
    path: string,
    fields: Readonly<Record<string, string>> = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
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
    const endpoint = buildEndpoint(storedUrl, path);

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

    // api_key is set last so a caller-supplied field can never replace it.
    const form = new URLSearchParams({ ...fields, api_key: apiKey });

    let response: Response;
    try {
      response = await doFetch(endpoint.toString(), {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
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
    if (typeof body !== 'object' || body === null) {
      throw new WallosHttpError(response.status);
    }
    return { status: response.status, body: body as Record<string, unknown> };
  }

  return {
    async listSubscriptions(userId) {
      const { status, body } = await request(userId, SUBSCRIPTIONS_PATH);
      const envelope = body as { success?: unknown; subscriptions?: unknown };
      if (typeof envelope.success !== 'boolean') {
        throw new WallosHttpError(status);
      }
      if (!envelope.success) {
        throw new WallosAuthError();
      }
      if (!Array.isArray(envelope.subscriptions)) {
        throw new WallosHttpError(status);
      }
      const subscriptions: WallosSubscription[] = [];
      for (const item of envelope.subscriptions as unknown[]) {
        const mapped = mapSubscription(item);
        if (mapped === undefined) throw new WallosHttpError(status);
        subscriptions.push(mapped);
      }
      return subscriptions;
    },

    async listCurrencies(userId) {
      const { status, body } = await request(userId, CURRENCIES_PATH);
      const envelope = body as { success?: unknown; currencies?: unknown };
      if (typeof envelope.success !== 'boolean') throw new WallosHttpError(status);
      if (!envelope.success) throw new WallosAuthError();
      if (!Array.isArray(envelope.currencies)) throw new WallosHttpError(status);
      const currencies: WallosCurrency[] = [];
      for (const item of envelope.currencies as unknown[]) {
        const mapped = mapCurrency(item);
        if (mapped === undefined) throw new WallosHttpError(status);
        currencies.push(mapped);
      }
      return currencies;
    },

    async updateSubscription(userId, id, fields) {
      if (!/^\d+$/.test(id)) throw new WallosRejectedError('Invalid subscription ID');
      // id and action follow the fields, so a field can never replace them; api_key stays last.
      const { status, body } = await request(userId, CREATE_SUBSCRIPTION_PATH, {
        ...fields,
        action: 'edit',
        id,
      });
      const envelope = body as { success?: unknown; title?: unknown };
      if (typeof envelope.success !== 'boolean') throw new WallosHttpError(status);
      if (!envelope.success) {
        const title = typeof envelope.title === 'string' ? envelope.title : '';
        if (AUTH_REJECTION_TITLES.has(title)) throw new WallosAuthError();
        throw new WallosRejectedError(title);
      }
    },

    async createSubscription(userId, payload) {
      const { status, body } = await request(userId, CREATE_SUBSCRIPTION_PATH, {
        ...payload,
        action: 'add',
      });
      const envelope = body as { success?: unknown; title?: unknown; subscriptionId?: unknown };
      if (typeof envelope.success !== 'boolean') throw new WallosHttpError(status);
      if (!envelope.success) {
        const title = typeof envelope.title === 'string' ? envelope.title : '';
        if (AUTH_REJECTION_TITLES.has(title)) throw new WallosAuthError();
        throw new WallosRejectedError(title);
      }
      const id = envelope.subscriptionId;
      if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) return String(id);
      if (typeof id === 'string' && /^\d+$/.test(id) && Number(id) > 0) return String(Number(id));
      throw new WallosHttpError(status);
    },
  };
}

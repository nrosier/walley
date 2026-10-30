/**
 * Per-user, in-memory cache for data read from Wallos and Actual Budget. Entries live for five
 * minutes. Keys are always `userId` plus a fixed source name, so one user can never read another
 * user's entry. Only fetched data is stored: callers pass the result of an upstream read, never a
 * URL, API key, password or sync key. Nothing is written to disk and nothing is logged.
 *
 * Walley's own writes call `invalidate(userId)`. Every invalidate also bumps the user's generation,
 * so a read that started before the write cannot store its (now stale) result afterwards.
 */

export const UPSTREAM_CACHE_TTL_MS = 300_000;

export type UpstreamSource =
  | 'wallos-subscriptions'
  | 'wallos-currencies'
  | 'actual-schedules'
  | 'actual-budget-meta';

interface Entry {
  readonly value: unknown;
  readonly expiresAt: number;
}

export interface UpstreamCacheOptions {
  /** Entry lifetime in ms. Defaults to five minutes. */
  readonly ttlMs?: number;
  /** Clock in ms since the epoch. Defaults to Date.now. */
  readonly now?: () => number;
}

export interface UpstreamCache {
  /** The live entry for this user and source, or undefined when missing or expired. */
  peek(userId: string, source: UpstreamSource): unknown;
  /**
   * Stores a fetched value. With `readAt` (the generation read before the fetch started), the value
   * is dropped when the user was invalidated since then.
   */
  put(userId: string, source: UpstreamSource, value: unknown, readAt?: number): void;
  /** Changes on every invalidate(userId). Read it before a fetch and pass it to put. */
  generation(userId: string): number;
  /**
   * Returns the live entry unless `refresh` is set. Otherwise runs `fetch` and stores the result
   * (a refresh replaces the entry). A failed fetch stores nothing and rethrows.
   */
  getOrFetch<T>(
    userId: string,
    source: UpstreamSource,
    fetch: () => Promise<T>,
    options?: { readonly refresh?: boolean },
  ): Promise<T>;
  /** Drops every entry of this user and voids reads that started before this call. */
  invalidate(userId: string): void;
}

export function createUpstreamCache(options: UpstreamCacheOptions = {}): UpstreamCache {
  const ttlMs = options.ttlMs ?? UPSTREAM_CACHE_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const byUser = new Map<string, Map<UpstreamSource, Entry>>();
  const generations = new Map<string, number>();

  const generation = (userId: string): number => generations.get(userId) ?? 0;

  const peek = (userId: string, source: UpstreamSource): unknown => {
    const entries = byUser.get(userId);
    const entry = entries?.get(source);
    if (entries === undefined || entry === undefined) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(source);
      if (entries.size === 0) byUser.delete(userId);
      return undefined;
    }
    return entry.value;
  };

  const put = (userId: string, source: UpstreamSource, value: unknown, readAt?: number): void => {
    if (readAt !== undefined && readAt !== generation(userId)) return;
    let entries = byUser.get(userId);
    if (entries === undefined) {
      entries = new Map();
      byUser.set(userId, entries);
    }
    entries.set(source, { value, expiresAt: now() + ttlMs });
  };

  return {
    peek,
    put,
    generation,
    async getOrFetch<T>(
      userId: string,
      source: UpstreamSource,
      fetch: () => Promise<T>,
      opts?: { readonly refresh?: boolean },
    ): Promise<T> {
      if (opts?.refresh !== true) {
        const hit: unknown = peek(userId, source);
        if (hit !== undefined) return hit as T;
      }
      const readAt = generation(userId);
      const value = await fetch();
      put(userId, source, value, readAt);
      return value;
    },
    invalidate(userId) {
      generations.set(userId, generation(userId) + 1);
      byUser.delete(userId);
    },
  };
}

/**
 * Runs a Walley write that may change Wallos or Actual data and drops the user's cache afterwards,
 * whether the write succeeded or failed (the remote side may have changed part way).
 */
export async function afterWrite<T>(
  cache: Pick<UpstreamCache, 'invalidate'> | undefined,
  userId: string,
  write: () => Promise<T>,
): Promise<T> {
  try {
    return await write();
  } finally {
    cache?.invalidate(userId);
  }
}

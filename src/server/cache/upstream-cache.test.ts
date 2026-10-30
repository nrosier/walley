import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterWrite, createUpstreamCache, UPSTREAM_CACHE_TTL_MS } from './upstream-cache.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

const counted = <T>(value: T) => {
  const fetch = vi.fn(async () => value);
  return fetch;
};

describe('createUpstreamCache', () => {
  it('uses a five minute TTL by default', () => {
    expect(UPSTREAM_CACHE_TTL_MS).toBe(300_000);
  });

  it('a cache hit within the TTL does not call the upstream fetch', async () => {
    const cache = createUpstreamCache();
    const fetch = counted(['sub']);
    expect(await cache.getOrFetch('u1', 'wallos-subscriptions', fetch)).toEqual(['sub']);
    vi.advanceTimersByTime(UPSTREAM_CACHE_TTL_MS - 1);
    expect(await cache.getOrFetch('u1', 'wallos-subscriptions', fetch)).toEqual(['sub']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('after the TTL expires the upstream fetch runs again', async () => {
    const cache = createUpstreamCache();
    const fetch = counted(['sub']);
    await cache.getOrFetch('u1', 'wallos-subscriptions', fetch);
    vi.advanceTimersByTime(UPSTREAM_CACHE_TTL_MS);
    await cache.getOrFetch('u1', 'wallos-subscriptions', fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refresh true bypasses a live entry and stores the fresh value', async () => {
    const cache = createUpstreamCache();
    let n = 0;
    const fetch = vi.fn(async () => {
      n += 1;
      return n;
    });
    expect(await cache.getOrFetch('u1', 'wallos-currencies', fetch)).toBe(1);
    expect(await cache.getOrFetch('u1', 'wallos-currencies', fetch, { refresh: true })).toBe(2);
    expect(await cache.getOrFetch('u1', 'wallos-currencies', fetch)).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('invalidate forces a refetch, for that user only', async () => {
    const cache = createUpstreamCache();
    const a = counted('a');
    const b = counted('b');
    await cache.getOrFetch('u1', 'actual-schedules', a);
    await cache.getOrFetch('u2', 'actual-schedules', b);
    cache.invalidate('u1');
    await cache.getOrFetch('u1', 'actual-schedules', a);
    await cache.getOrFetch('u2', 'actual-schedules', b);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a read that started before invalidate does not store its stale result', async () => {
    const cache = createUpstreamCache();
    let release: (v: string) => void = () => undefined;
    const slow = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const pending = cache.getOrFetch('u1', 'wallos-subscriptions', slow);
    cache.invalidate('u1');
    release('stale');
    expect(await pending).toBe('stale');
    expect(cache.peek('u1', 'wallos-subscriptions')).toBeUndefined();
  });

  it('a failed fetch stores nothing and rethrows', async () => {
    const cache = createUpstreamCache();
    const fail = vi.fn(async () => {
      throw new Error('upstream down');
    });
    await expect(cache.getOrFetch('u1', 'wallos-subscriptions', fail)).rejects.toThrow('upstream down');
    expect(cache.peek('u1', 'wallos-subscriptions')).toBeUndefined();
    const ok = counted('fine');
    expect(await cache.getOrFetch('u1', 'wallos-subscriptions', ok)).toBe('fine');
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it('never returns a value cached for a different user, even with the same source', async () => {
    const cache = createUpstreamCache();
    await cache.getOrFetch('alice', 'actual-budget-meta', counted('EUR'));
    const bob = counted('USD');
    expect(await cache.getOrFetch('bob', 'actual-budget-meta', bob)).toBe('USD');
    expect(bob).toHaveBeenCalledTimes(1);
    expect(cache.peek('alice', 'actual-budget-meta')).toBe('EUR');
  });

  it('afterWrite invalidates on success and on failure', async () => {
    const cache = createUpstreamCache();
    await cache.getOrFetch('u1', 'wallos-subscriptions', counted(1));
    await afterWrite(cache, 'u1', async () => 'ok');
    expect(cache.peek('u1', 'wallos-subscriptions')).toBeUndefined();

    await cache.getOrFetch('u1', 'wallos-subscriptions', counted(2));
    await expect(
      afterWrite(cache, 'u1', async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(cache.peek('u1', 'wallos-subscriptions')).toBeUndefined();
  });

  it('stores only the fetched value, never credentials passed alongside it', async () => {
    const cache = createUpstreamCache();
    const secrets = { apiKey: 'WALLOS-KEY-123', password: 'ACTUAL-PW-456', syncKey: 'SYNC-789' };
    // The caller passes the fetched data; the credentials stay in the caller's closure.
    const fetched = [{ id: 1, name: 'Netflix', price: '12.50' }];
    const fetchUpstream = async () => fetched;
    await cache.getOrFetch('u1', 'wallos-subscriptions', fetchUpstream);
    const stored = JSON.stringify(cache.peek('u1', 'wallos-subscriptions'));
    expect(stored).toBe(JSON.stringify(fetched));
    for (const secret of Object.values(secrets)) expect(stored).not.toContain(secret);
  });
});

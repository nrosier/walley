import { isIP } from 'node:net';

/** Key kinds the limiter knows. Each kind has its own map and its own limit. */
export type RateLimitKey = `email:${string}` | `ip:${string}` | `token:${string}`;

export type RateLimitResult = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface RateLimiterOptions {
  /** Clock in ms since the epoch. */
  readonly now: () => number;
  /** Also the limit per `token:` key, which has its own map and follows the email rules. */
  readonly maxPerEmail: number;
  readonly maxPerIp: number;
  readonly windowMs: number;
  /**
   * Most keys kept per kind. IP keys: the oldest key is evicted first. Email keys: live keys
   * are never evicted; a new email key at the cap is refused until the oldest one expires.
   */
  readonly maxKeys: number;
}

export interface RateLimiter {
  /** Counts one attempt for the key, unless it is refused. Refused attempts are not counted. */
  take(key: RateLimitKey): RateLimitResult;
  /** Forgets every counted attempt for the key. */
  clear(key: RateLimitKey): void;
}

/** Project convention for sign-in limits: 15 minute sliding window. */
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
/** Project convention: at most 5 attempts per email per window. */
export const SIGN_IN_MAX_PER_EMAIL = 5;
/** Project convention: at most 20 attempts per client IP per window. */
export const SIGN_IN_MAX_PER_IP = 20;
/** Project convention: memory cap of 10,000 keys per kind (IP: oldest-first eviction; email: refuse new keys). */
export const SIGN_IN_MAX_KEYS = 10_000;

/**
 * Sliding-window limiter. Each map holds key -> timestamps of counted attempts, oldest first.
 * A key is moved to the end of its map whenever it is counted, so map order is by latest
 * attempt: expired keys sit at the front and the sweep stops at the first live one.
 */
export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { now, maxPerEmail, maxPerIp, windowMs, maxKeys } = opts;
  const maps = {
    email: new Map<string, number[]>(),
    ip: new Map<string, number[]>(),
    token: new Map<string, number[]>(),
  };

  function split(key: RateLimitKey): { map: Map<string, number[]>; id: string; max: number } {
    if (key.startsWith('token:')) {
      return { map: maps.token, id: key.slice('token:'.length), max: maxPerEmail };
    }
    return key.startsWith('email:')
      ? { map: maps.email, id: key.slice('email:'.length), max: maxPerEmail }
      : { map: maps.ip, id: key.slice('ip:'.length), max: maxPerIp };
  }

  function sweep(map: Map<string, number[]>, cutoff: number): void {
    for (const [id, times] of map) {
      const newest = times[times.length - 1];
      if (newest !== undefined && newest > cutoff) {
        return;
      }
      map.delete(id);
    }
  }

  return {
    take(key) {
      const t = now();
      const cutoff = t - windowMs;
      sweep(maps.email, cutoff);
      sweep(maps.ip, cutoff);
      sweep(maps.token, cutoff);
      const { map, id, max } = split(key);
      if (map !== maps.ip && !map.has(id) && map.size >= maxKeys) {
        // Email keys are never evicted, so flooding cannot reset a victim's counter. Refuse the
        // new key until the oldest live key expires. Map order is by latest attempt.
        const oldestTimes = map.values().next();
        const newest = oldestTimes.done === true ? undefined : oldestTimes.value[oldestTimes.value.length - 1];
        const expiresAt = (newest ?? t) + windowMs;
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - t) / 1000)) };
      }
      const times = (map.get(id) ?? []).filter((at) => at > cutoff);
      if (times.length >= max) {
        // Refusals are not counted. times is non-empty here because max is at least 1.
        const oldest = times[0] ?? t;
        map.set(id, times);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - t) / 1000)) };
      }
      times.push(t);
      map.delete(id);
      map.set(id, times);
      while (map === maps.ip && map.size > maxKeys) {
        const first = map.keys().next();
        if (first.done === true) break;
        map.delete(first.value);
      }
      return { allowed: true };
    },
    clear(key) {
      const { map, id } = split(key);
      map.delete(id);
    },
  };
}

/** Expands an IPv6 address to eight 16-bit groups, or null when it does not parse. */
function expandIpv6(address: string): number[] | null {
  let text = address;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = tail.split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) {
    return null;
  }
  const parse = (part: string | undefined): number[] =>
    part === undefined || part === '' ? [] : part.split(':').map((g) => parseInt(g, 16));
  const head = parse(halves[0]);
  const rest = parse(halves[1]);
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) {
    return null;
  }
  const groups = [...head, ...new Array<number>(halves.length === 2 ? fill : 0).fill(0), ...rest];
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * The per-IP bucket for a client address. IPv4 is used as is, an IPv4-mapped IPv6 address
 * counts as its IPv4 address, and any other IPv6 address is reduced to its /64 prefix in
 * canonical compressed form. Fails closed: an address that cannot be parsed is used raw,
 * so the limit still applies.
 */
export function ipRateKey(ip: string | undefined): string {
  // request.ip can be undefined in some test setups: key on a fixed value, so the limit still applies.
  if (ip === undefined) {
    return 'unknown';
  }
  const address = ip.split('%')[0] ?? ip;
  const family = isIP(address);
  if (family === 4) {
    return address;
  }
  const groups = family === 6 ? expandIpv6(address) : null;
  if (groups === null) {
    return ip;
  }
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const hi = groups[6] ?? 0;
    const lo = groups[7] ?? 0;
    return `${String(hi >> 8)}.${String(hi & 255)}.${String(lo >> 8)}.${String(lo & 255)}`;
  }
  const prefix = [...groups.slice(0, 4), 0, 0, 0, 0];
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (prefix[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && prefix[j] === 0) j += 1;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = (gs: number[]): string => gs.map((g) => g.toString(16)).join(':');
  if (bestLen < 2) {
    return hex(prefix);
  }
  return `${hex(prefix.slice(0, bestStart))}::${hex(prefix.slice(bestStart + bestLen))}`;
}

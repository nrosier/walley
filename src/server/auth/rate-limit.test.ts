import { describe, expect, it } from 'vitest';
import { makeClock } from '../test/auth-helpers.js';
import { createRateLimiter, ipRateKey, type RateLimiterOptions } from './rate-limit.js';

const WINDOW = 15 * 60 * 1000;

function setup(overrides: Partial<RateLimiterOptions> = {}) {
  const clock = makeClock();
  const limiter = createRateLimiter({
    now: () => clock.now(),
    maxPerEmail: 5,
    maxPerIp: 20,
    windowMs: WINDOW,
    maxKeys: 10_000,
    ...overrides,
  });
  return { clock, limiter };
}

describe('createRateLimiter', () => {
  it('allows the 5th email attempt in 15 minutes and refuses the 6th', () => {
    const { clock, limiter } = setup();
    for (let i = 1; i <= 5; i += 1) {
      expect(limiter.take('email:a@example.test'), `attempt ${String(i)}`).toEqual({ allowed: true });
      clock.advance(60_000);
    }
    const sixth = limiter.take('email:a@example.test');
    expect(sixth.allowed).toBe(false);
  });

  it('allows the 20th IP attempt and refuses the 21st', () => {
    const { limiter } = setup();
    for (let i = 0; i < 20; i += 1) {
      expect(limiter.take('ip:10.0.0.1').allowed).toBe(true);
    }
    expect(limiter.take('ip:10.0.0.1').allowed).toBe(false);
  });

  it('gives a whole Retry-After above zero, rounded up to when the oldest attempt leaves', () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 5; i += 1) {
      limiter.take('email:a@example.test');
    }
    clock.advance(1500);
    const res = limiter.take('email:a@example.test');
    if (res.allowed) throw new Error('expected refusal');
    expect(Number.isInteger(res.retryAfterSeconds)).toBe(true);
    expect(res.retryAfterSeconds).toBeGreaterThan(0);
    // 900 s window minus 1.5 s elapsed is 898.5 s, rounded up.
    expect(res.retryAfterSeconds).toBe(899);
  });

  it('reopens the window after 15 minutes', () => {
    const { clock, limiter } = setup();
    for (let i = 0; i < 5; i += 1) {
      limiter.take('email:a@example.test');
    }
    expect(limiter.take('email:a@example.test').allowed).toBe(false);
    clock.advance(WINDOW - 1);
    expect(limiter.take('email:a@example.test').allowed).toBe(false);
    clock.advance(1);
    expect(limiter.take('email:a@example.test').allowed).toBe(true);
  });

  it('slides: only attempts inside the window count', () => {
    const { clock, limiter } = setup();
    limiter.take('email:a@example.test');
    clock.advance(10 * 60_000);
    for (let i = 0; i < 4; i += 1) {
      limiter.take('email:a@example.test');
    }
    expect(limiter.take('email:a@example.test').allowed).toBe(false);
    clock.advance(5 * 60_000);
    // The first attempt has left the window; one slot is free.
    expect(limiter.take('email:a@example.test').allowed).toBe(true);
    expect(limiter.take('email:a@example.test').allowed).toBe(false);
  });

  it('removes expired entries on each call', () => {
    const { clock, limiter } = setup({ maxKeys: 2 });
    for (let i = 0; i < 5; i += 1) {
      limiter.take('email:old@example.test');
    }
    clock.advance(WINDOW);
    // old has expired; two new keys fit under maxKeys only if it was swept.
    expect(limiter.take('email:b@example.test').allowed).toBe(true);
    expect(limiter.take('email:c@example.test').allowed).toBe(true);
    expect(limiter.take('email:old@example.test').allowed).toBe(false);
  });

  it('refuses a new email key at the cap and never resets a live counter', () => {
    const { clock, limiter } = setup({ maxKeys: 3, maxPerEmail: 1 });
    for (const k of ['victim', 'b', 'c'] as const) {
      expect(limiter.take(`email:${k}`).allowed).toBe(true);
      clock.advance(1000);
    }
    // Flooding with new keys is refused, with a Retry-After from the oldest live key.
    for (const k of ['x', 'y', 'z'] as const) {
      const res = limiter.take(`email:${k}`);
      if (res.allowed) throw new Error('expected refusal');
      expect(res.retryAfterSeconds).toBe(WINDOW / 1000 - 3);
    }
    // The victim's counter is intact, and existing keys are still handled normally.
    expect(limiter.take('email:victim').allowed).toBe(false);
    expect(limiter.take('email:b').allowed).toBe(false);
    // Once the oldest key expires, capacity returns.
    clock.advance(WINDOW - 3000);
    expect(limiter.take('email:x').allowed).toBe(true);
  });

  it('lets an existing email key proceed when the map is full', () => {
    const { limiter } = setup({ maxKeys: 2, maxPerEmail: 2 });
    limiter.take('email:a');
    limiter.take('email:b');
    expect(limiter.take('email:a').allowed).toBe(true);
    expect(limiter.take('email:a').allowed).toBe(false);
    expect(limiter.take('email:c').allowed).toBe(false);
  });

  it('gives a minimum Retry-After of 1 second when refusing a new email key', () => {
    const { clock, limiter } = setup({ maxKeys: 1 });
    limiter.take('email:a');
    clock.advance(WINDOW - 1);
    const res = limiter.take('email:b');
    if (res.allowed) throw new Error('expected refusal');
    expect(res.retryAfterSeconds).toBe(1);
  });

  it('evicts ip keys oldest-first and keeps the newest maxKeys entries', () => {
    const { limiter } = setup({ maxKeys: 3, maxPerIp: 1 });
    for (const k of ['a', 'b', 'c', 'd'] as const) {
      expect(limiter.take(`ip:${k}`).allowed).toBe(true);
    }
    // a was evicted, so it is allowed again; b, c and d are still counted.
    expect(limiter.take('ip:b').allowed).toBe(false);
    expect(limiter.take('ip:c').allowed).toBe(false);
    expect(limiter.take('ip:d').allowed).toBe(false);
    expect(limiter.take('ip:a').allowed).toBe(true);
  });

  it('clear forgets the key, and keeps email and ip keys apart', () => {
    const { limiter } = setup({ maxPerEmail: 1, maxPerIp: 1 });
    limiter.take('email:x');
    expect(limiter.take('ip:x').allowed).toBe(true);
    expect(limiter.take('email:x').allowed).toBe(false);
    limiter.clear('email:x');
    expect(limiter.take('email:x').allowed).toBe(true);
    expect(limiter.take('ip:x').allowed).toBe(false);
  });

  it('isolates users: A exhausting its email limit does not block B', () => {
    const { limiter } = setup();
    for (let i = 0; i < 6; i += 1) limiter.take('email:a@example.test');
    expect(limiter.take('email:a@example.test').allowed).toBe(false);
    expect(limiter.take('email:b@example.test').allowed).toBe(true);
  });
});

describe('ipRateKey', () => {
  it('shares one key across an IPv6 /64 and separates other prefixes', () => {
    expect(ipRateKey('2001:db8::1')).toBe(ipRateKey('2001:db8::2'));
    expect(ipRateKey('2001:db8:0:0:ffff::1')).toBe(ipRateKey('2001:db8::1'));
    expect(ipRateKey('2001:db9::1')).not.toBe(ipRateKey('2001:db8::1'));
    expect(ipRateKey('2001:db8:0:1::1')).not.toBe(ipRateKey('2001:db8::1'));
    expect(ipRateKey('2001:db8::1')).toBe('2001:db8::');
  });

  it('treats an IPv4-mapped address as IPv4 and keeps IPv4 per address', () => {
    expect(ipRateKey('::ffff:192.0.2.1')).toBe(ipRateKey('192.0.2.1'));
    expect(ipRateKey('::ffff:c000:201')).toBe('192.0.2.1');
    expect(ipRateKey('192.0.2.1')).not.toBe(ipRateKey('192.0.2.2'));
  });

  it('uses one fixed key when the address is undefined', () => {
    expect(ipRateKey(undefined)).toBe('unknown');
    expect(ipRateKey(undefined)).toBe(ipRateKey(undefined));
  });

  it('drops an IPv6 zone ID', () => {
    expect(ipRateKey('fe80::1%eth0')).toBe('fe80::');
  });

  it('falls back to the raw value when the address cannot be parsed', () => {
    expect(ipRateKey('undefined')).toBe('undefined');
    expect(ipRateKey('')).toBe('');
  });
});

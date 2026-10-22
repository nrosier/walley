import { describe, expect, it } from 'vitest';
import { parseRoute } from './route';

describe('parseRoute', () => {
  it('maps known hashes and defaults to sync', () => {
    expect(parseRoute('#/matches')).toBe('matches');
    expect(parseRoute('#/settings')).toBe('settings');
    expect(parseRoute('#/login')).toBe('login');
    expect(parseRoute('')).toBe('sync');
    expect(parseRoute('#/nope')).toBe('sync');
  });
});

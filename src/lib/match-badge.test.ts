import { describe, expect, it } from 'vitest';
import { MATCH_BADGES, matchBadge } from './match-badge.js';
import { MATCH_STATUSES } from './match-status.js';

describe('match badges', () => {
  it('has a badge for every status and no others', () => {
    expect(Object.keys(MATCH_BADGES).sort()).toEqual([...MATCH_STATUSES].sort());
    for (const status of MATCH_STATUSES) {
      expect(matchBadge(status).label.length).toBeGreaterThan(0);
    }
  });

  it('includes MISMATCH_DETECTED in the status list', () => {
    expect(MATCH_STATUSES).toContain('MISMATCH_DETECTED');
  });

  it('maps LINKED to Synced, MISMATCH_DETECTED to Mismatch and ignored to a neutral badge', () => {
    expect(matchBadge('LINKED')).toEqual({ label: 'Synced', tone: 'matched' });
    expect(matchBadge('MISMATCH_DETECTED')).toEqual({ label: 'Mismatch', tone: 'mismatch' });
    expect(matchBadge('IGNORED_WALLOS')).toEqual({ label: 'Ignored', tone: 'neutral' });
    expect(matchBadge('IGNORED_ACTUAL')).toEqual({ label: 'Ignored', tone: 'neutral' });
  });
});

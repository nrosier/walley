import { describe, expect, it } from 'vitest';
import { MATCH_BADGES, matchBadge, pairBadge, type PairBadgeKind } from './match-badge.js';
import { MATCH_STATUSES, type MatchStatus } from './match-status.js';
import type { SyncOrphanKind } from './sync-check-types.js';

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

describe('pairBadge truth table', () => {
  const orphanKinds: SyncOrphanKind[] = ['orphaned_wallos', 'orphaned_actual', 'orphaned_both'];
  const rows: [MatchStatus, PairBadgeKind][] = [
    ['LINKED', 'synced'],
    ['MISMATCH_DETECTED', 'mismatch'],
    ['IGNORED_WALLOS', 'ignored'],
    ['IGNORED_ACTUAL', 'ignored'],
  ];

  for (const [status, expected] of rows) {
    it(`maps ${status} with no orphan to ${expected}`, () => {
      expect(pairBadge({ status, orphan: null })).toBe(expected);
    });

    for (const orphan of orphanKinds) {
      it(`maps ${status} with ${orphan} to orphaned`, () => {
        expect(pairBadge({ status, orphan })).toBe('orphaned');
      });
    }
  }

  it('lets an orphan beat MISMATCH_DETECTED', () => {
    expect(pairBadge({ status: 'MISMATCH_DETECTED', orphan: 'orphaned_both' })).toBe('orphaned');
  });
});

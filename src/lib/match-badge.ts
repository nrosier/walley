import type { MatchStatus } from './match-status.js';
import type { SyncOrphanKind } from './sync-check-types.js';

/** Badge tone: green for synced pairs, amber for drift, gray for ignored items. */
export type MatchBadgeTone = 'matched' | 'mismatch' | 'neutral';

export interface MatchBadge {
  readonly label: string;
  readonly tone: MatchBadgeTone;
}

/** Display badge for every match status (#37). LINKED with no drift shows as "Synced". */
export const MATCH_BADGES: Readonly<Record<MatchStatus, MatchBadge>> = {
  LINKED: { label: 'Synced', tone: 'matched' },
  MISMATCH_DETECTED: { label: 'Mismatch', tone: 'mismatch' },
  IGNORED_WALLOS: { label: 'Ignored', tone: 'neutral' },
  IGNORED_ACTUAL: { label: 'Ignored', tone: 'neutral' },
};

export function matchBadge(status: MatchStatus): MatchBadge {
  return MATCH_BADGES[status];
}

/** Four display kinds for a sync pair (#M7). `orphaned` is shown whenever a side has vanished. */
export type PairBadgeKind = 'synced' | 'mismatch' | 'ignored' | 'orphaned';

/** Any orphan kind wins over the match status. Otherwise status decides: LINKED is synced, MISMATCH_DETECTED is mismatch, IGNORED_* is ignored. */
export function pairBadge(input: { status: MatchStatus; orphan: SyncOrphanKind | null }): PairBadgeKind {
  if (input.orphan !== null) return 'orphaned';
  switch (input.status) {
    case 'LINKED':
      return 'synced';
    case 'MISMATCH_DETECTED':
      return 'mismatch';
    case 'IGNORED_WALLOS':
    case 'IGNORED_ACTUAL':
      return 'ignored';
  }
}

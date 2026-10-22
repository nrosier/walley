import type { MatchStatus } from './match-status.js';

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

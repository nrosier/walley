export const MATCH_STATUSES = [
  'LINKED',
  'MISMATCH_DETECTED',
  'IGNORED_WALLOS',
  'IGNORED_ACTUAL',
] as const;

export type MatchStatus = (typeof MATCH_STATUSES)[number];

export function isMatchStatus(value: unknown): value is MatchStatus {
  return typeof value === 'string' && (MATCH_STATUSES as readonly string[]).includes(value);
}

import type { SyncLinked } from '../../lib/sync-check-types';

/**
 * A linked pair differs when both amounts are known and unequal in the displayed (base) currency, or when
 * the check flagged drift (MISMATCH_DETECTED, which can come from fields other than the amount). The row
 * cue and the counts line on the Matches page both use this one rule.
 */
export function rowDiffers(row: Pick<SyncLinked, 'status' | 'wallosAmountCents' | 'actualAmountCents'>): boolean {
  if (row.status === 'MISMATCH_DETECTED') return true;
  return row.wallosAmountCents !== null && row.actualAmountCents !== null && row.wallosAmountCents !== row.actualAmountCents;
}

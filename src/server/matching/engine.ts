import type { MatchStatus } from "../../lib/match-status.js";

/** One saved matches row, as the caller read it. Pure function: the caller has already scoped these rows to one user. */
export interface SavedMatch {
  wallosId: string | null;
  actualScheduleId: string | null;
  status: MatchStatus;
}

export type PairClassification =
  "linked" | "orphaned_wallos" | "orphaned_actual" | "orphaned_both";

export interface ClassifiedPair {
  wallosId: string;
  actualScheduleId: string;
  /** Computed on each sync, never stored. The stored status is kept as-is. */
  classification: PairClassification;
  savedStatus: MatchStatus;
}

export interface ClassifySavedPairsResult {
  pairs: ClassifiedPair[];
  /** IGNORED_WALLOS and IGNORED_ACTUAL rows, preserved untouched and never auto-linked. */
  ignored: SavedMatch[];
  unlinkedWallosIds: string[];
  unlinkedActualIds: string[];
}

/**
 * Classifies a user's saved matches against the current item ids. No I/O: it only sees the
 * input it is given, so the caller must pass one user's rows and ids.
 * ORPHANED is a computed result (a side vanished), not a stored match status.
 */
export function classifySavedPairs(
  savedMatches: readonly SavedMatch[],
  wallosIds: readonly string[],
  actualIds: readonly string[],
): ClassifySavedPairsResult {
  const wallosPresent = new Set(wallosIds);
  const actualPresent = new Set(actualIds);
  const usedWallos = new Set<string>();
  const usedActual = new Set<string>();
  const pairs: ClassifiedPair[] = [];
  const ignored: SavedMatch[] = [];

  for (const m of savedMatches) {
    if (m.wallosId !== null) usedWallos.add(m.wallosId);
    if (m.actualScheduleId !== null) usedActual.add(m.actualScheduleId);

    if (m.status === "IGNORED_WALLOS" || m.status === "IGNORED_ACTUAL") {
      ignored.push(m);
      continue;
    }
    if (m.wallosId === null || m.actualScheduleId === null) continue; // violates the DB side check
    const hasWallos = wallosPresent.has(m.wallosId);
    const hasActual = actualPresent.has(m.actualScheduleId);
    const classification: PairClassification =
      hasWallos && hasActual
        ? "linked"
        : !hasWallos && !hasActual
          ? "orphaned_both"
          : !hasWallos
            ? "orphaned_wallos"
            : "orphaned_actual";
    pairs.push({
      wallosId: m.wallosId,
      actualScheduleId: m.actualScheduleId,
      classification,
      savedStatus: m.status,
    });
  }

  return {
    pairs,
    ignored,
    unlinkedWallosIds: wallosIds.filter((id) => !usedWallos.has(id)),
    unlinkedActualIds: actualIds.filter((id) => !usedActual.has(id)),
  };
}

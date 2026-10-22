import type { MatchFieldsInput } from "../../lib/match-fields.js";
import type { MatchStatus } from "../../lib/match-status.js";
import { hashMatchFields } from "./hash.js";

/** One saved matches row with its stored hashes. The caller has already scoped these rows to one user. */
export interface MismatchSavedRow {
  wallosId: string | null;
  actualScheduleId: string | null;
  status: MatchStatus;
  lastKnownWallosHash: string | null;
  lastKnownActualHash: string | null;
}

export type DriftStatus = Extract<MatchStatus, "LINKED" | "MISMATCH_DETECTED">;

export interface MismatchResult {
  wallosId: string;
  actualScheduleId: string;
  previousStatus: DriftStatus;
  nextStatus: DriftStatus;
  /** Value to write to matches.last_known_wallos_hash. */
  wallosHash: string;
  /** Value to write to matches.last_known_actual_hash. */
  actualHash: string;
  /** Hashes of the current values, for the diff view. Equal to the stored ones unless drift was found. */
  currentWallosHash: string;
  currentActualHash: string;
  /** True when at least one stored hash was null and was set from the current value. */
  baseline: boolean;
  wallosDrift: boolean;
  actualDrift: boolean;
}

export interface UnmappablePair {
  wallosId: string;
  actualScheduleId: string;
  /** Which side has no hash (a pattern schedule). */
  side: "wallos" | "actual" | "both";
}

export interface DetectMismatchesResult {
  results: MismatchResult[];
  /** Pairs not compared because a side cannot be hashed. Status and stored hashes stay as they are. */
  unmappable: UnmappablePair[];
}

/**
 * Detects drift since the last sync for a user's saved pairs. Pure: no DB access.
 *
 * Rules:
 * - Ignored rows (IGNORED_WALLOS, IGNORED_ACTUAL) are skipped and never flagged.
 * - Pairs with a side missing from the current values are orphaned. That is not drift; they are
 *   skipped here and reported by classifySavedPairs (engine.ts).
 * - A pair with a side that cannot be hashed (pattern schedule) is not compared. It is listed in
 *   `unmappable` and its status and stored hashes are left alone.
 * - A null stored hash sets the baseline from the current value and is not drift on that side.
 * - Drift on either side sets MISMATCH_DETECTED. The stored hashes are NOT advanced on drift:
 *   they stay the last-synced baseline, so the mismatch persists across syncs until the user
 *   resolves it (overwrite, ignore diff or unlink), which writes new hashes.
 * - Drift that is gone: a MISMATCH_DETECTED row whose current hashes equal the stored ones again
 *   (the values went back to what was last synced) returns to LINKED. Status always reflects
 *   drift at this sync, never past drift.
 */
export function detectMismatches(
  savedRows: readonly MismatchSavedRow[],
  currentByWallosId: ReadonlyMap<string, MatchFieldsInput>,
  currentByActualId: ReadonlyMap<string, MatchFieldsInput>,
): DetectMismatchesResult {
  const results: MismatchResult[] = [];
  const unmappable: UnmappablePair[] = [];

  for (const row of savedRows) {
    if (row.status !== "LINKED" && row.status !== "MISMATCH_DETECTED") continue;
    if (row.wallosId === null || row.actualScheduleId === null) continue;
    const wallos = currentByWallosId.get(row.wallosId);
    const actual = currentByActualId.get(row.actualScheduleId);
    if (wallos === undefined || actual === undefined) continue; // orphaned, not drift

    const currentWallosHash = hashMatchFields(wallos);
    const currentActualHash = hashMatchFields(actual);
    if (currentWallosHash === null || currentActualHash === null) {
      unmappable.push({
        wallosId: row.wallosId,
        actualScheduleId: row.actualScheduleId,
        side:
          currentWallosHash === null && currentActualHash === null
            ? "both"
            : currentWallosHash === null
              ? "wallos"
              : "actual",
      });
      continue;
    }

    const storedWallos = row.lastKnownWallosHash ?? currentWallosHash;
    const storedActual = row.lastKnownActualHash ?? currentActualHash;
    const wallosDrift = storedWallos !== currentWallosHash;
    const actualDrift = storedActual !== currentActualHash;
    const drift = wallosDrift || actualDrift;

    results.push({
      wallosId: row.wallosId,
      actualScheduleId: row.actualScheduleId,
      previousStatus: row.status,
      nextStatus: drift ? "MISMATCH_DETECTED" : "LINKED",
      wallosHash: storedWallos,
      actualHash: storedActual,
      currentWallosHash,
      currentActualHash,
      baseline: row.lastKnownWallosHash === null || row.lastKnownActualHash === null,
      wallosDrift,
      actualDrift,
    });
  }

  return { results, unmappable };
}

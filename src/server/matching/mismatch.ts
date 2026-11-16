import type { MatchFieldsInput } from "../../lib/match-fields.js";
import type { MatchStatus } from "../../lib/match-status.js";
import { rateMarginUnits, withinRateMargin } from "../../lib/amount-match.js";
import type { SyncRateMargin } from "../../lib/sync-check-types.js";
import { hashMatchFields } from "./hash.js";

/** One saved matches row with its stored hashes. The caller has already scoped these rows to one user. */
export interface MismatchSavedRow {
  wallosId: string | null;
  actualScheduleId: string | null;
  status: MatchStatus;
  lastKnownWallosHash: string | null;
  lastKnownActualHash: string | null;
  /** #229 baseline columns; absent or null for a row with no baseline yet (exact comparison). */
  lastKnownWallosAmountCents?: number | null;
  lastKnownWallosPriceMinor?: number | null;
  lastKnownWallosCurrency?: string | null;
}

/** #229: the Wallos subscription's own price (signed minor units, like Actual) and currency code. */
export interface WallosOwn {
  readonly priceMinor: number;
  readonly currencyCode: string;
}

export interface DetectMismatchesOptions {
  readonly wallosOwnById?: ReadonlyMap<string, WallosOwn>;
  /** The user's currency_drift_percent (0..10). Default 0: no margin, exact comparison as before #229. */
  readonly currencyDriftPercent?: number;
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
  /** True when the stored Wallos hash was the pre-entity-decode (0.2.0) hash: re-baselined, not drift. */
  wallosRebaselined: boolean;
  wallosDrift: boolean;
  actualDrift: boolean;
  /** #229: LINKED only because a rate-only Wallos difference is inside the margin. Hashes and baseline are not advanced. */
  withinMargin: boolean;
  /** #229: display data, see SyncMismatch.rateMargin / SyncLinked.rateMargin. Absent when not applicable. */
  rateMargin?: SyncRateMargin & { sourceChanged: boolean };
  /**
   * #229 baseline columns: 'set' writes them with the hash (null or re-baselined hash), 'fill' writes
   * them only if still null and the stored hash equals the current one, 'none' leaves them.
   */
  wallosBaselineWrite: "none" | "set" | "fill";
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
 * - Entity re-baseline: when the stored Wallos hash differs from the current one but equals the
 *   legacy hash (`legacyByWallosId`, the 0.2.0 raw-name hash), the change is only the HTML entity
 *   decode. The Wallos side is not drift and its baseline advances to the current hash.
 */
export function detectMismatches(
  savedRows: readonly MismatchSavedRow[],
  currentByWallosId: ReadonlyMap<string, MatchFieldsInput>,
  currentByActualId: ReadonlyMap<string, MatchFieldsInput>,
  legacyByWallosId: ReadonlyMap<string, MatchFieldsInput> = new Map(),
  options: DetectMismatchesOptions = {},
): DetectMismatchesResult {
  const pct = options.currencyDriftPercent ?? 0;
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

    let storedWallos = row.lastKnownWallosHash ?? currentWallosHash;
    const storedActual = row.lastKnownActualHash ?? currentActualHash;
    let wallosDrift = storedWallos !== currentWallosHash;
    const actualDrift = storedActual !== currentActualHash;
    let wallosRebaselined = false;
    let baselineWrite: MismatchResult["wallosBaselineWrite"] = row.lastKnownWallosHash === null ? "set" : "none";
    if (wallosDrift) {
      const legacy = legacyByWallosId.get(row.wallosId);
      if (legacy !== undefined && storedWallos === hashMatchFields(legacy)) {
        // Only the HTML entity decode changed the name: advance the baseline silently.
        wallosRebaselined = true;
        wallosDrift = false;
        storedWallos = currentWallosHash;
        baselineWrite = "set";
      }
    }

    // #229 rate margin. Only a rate-only Wallos difference can be absorbed; everything else stays exact.
    const own = options.wallosOwnById?.get(row.wallosId);
    const baseAmount = row.lastKnownWallosAmountCents ?? null;
    const basePrice = row.lastKnownWallosPriceMinor ?? null;
    const baseCurrency = row.lastKnownWallosCurrency ?? null;
    const hasBaseline = baseAmount !== null && basePrice !== null && baseCurrency !== null;
    const foreignNow =
      own !== undefined && own.currencyCode.toUpperCase() !== wallos.currency.trim().toUpperCase();
    let withinMargin = false;
    if (
      wallosDrift &&
      !actualDrift &&
      pct > 0 &&
      hasBaseline &&
      own !== undefined &&
      foreignNow &&
      own.currencyCode === baseCurrency &&
      own.priceMinor === basePrice &&
      actual.amount.kind === "single" &&
      wallos.amount.kind === "single" &&
      hashMatchFields({ ...wallos, amount: { kind: "single", cents: baseAmount } }) === storedWallos &&
      withinRateMargin(wallos.amount.cents, actual.amount.cents, pct)
    ) {
      withinMargin = true;
      wallosDrift = false;
    }

    let rateMargin: MismatchResult["rateMargin"];
    if (
      pct > 0 &&
      hasBaseline &&
      baselineWrite !== "set" &&
      own !== undefined &&
      foreignNow &&
      actual.amount.kind === "single" &&
      wallos.amount.kind === "single"
    ) {
      const marginCents = rateMarginUnits(actual.amount.cents, pct);
      if (marginCents !== null) {
        rateMargin = {
          differenceCents: Math.abs(wallos.amount.cents - actual.amount.cents),
          marginCents,
          marginPercent: pct,
          sourceChanged: own.priceMinor !== basePrice || own.currencyCode !== baseCurrency,
        };
      }
    }

    const drift = wallosDrift || actualDrift;
    if (
      baselineWrite === "none" &&
      !withinMargin &&
      currentWallosHash === storedWallos &&
      row.lastKnownWallosAmountCents == null &&
      row.lastKnownWallosPriceMinor == null &&
      row.lastKnownWallosCurrency == null
    ) {
      baselineWrite = "fill";
    }

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
      wallosRebaselined,
      wallosDrift,
      actualDrift,
      withinMargin,
      ...(rateMargin === undefined ? {} : { rateMargin }),
      wallosBaselineWrite: baselineWrite,
    });
  }

  return { results, unmappable };
}

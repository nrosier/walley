/**
 * Response types of POST /api/sync/check, shared by the server (`src/server/matching/sync-check.ts`)
 * and the web app. Types only, browser-safe.
 */
import type { BillingCycle } from './billing-cycle.js';
import type { MatchAmount } from './match-fields.js';
import type { MatchStatus } from './match-status.js';

export type UnmappableReason =
  | 'patterns_unsupported'
  | 'no_recurrence'
  | 'invalid_recurrence'
  | 'invalid_amount'
  | 'mapping_failed'
  | 'currency_conversion_failed';

/** A saved pair with a vanished side. Computed on each run, never stored. */
export type SyncOrphanKind = 'orphaned_wallos' | 'orphaned_actual' | 'orphaned_both';

/** An item on one side. `amountCents` is in the base currency (range: the midpoint), null when unmappable. */
export interface SyncItem {
  readonly id: string;
  /** Display text only. */
  readonly name: string;
  readonly amountCents: number | null;
  readonly isRange: boolean;
  readonly reason: UnmappableReason | null;
  /**
   * Billing cycle of an unlinked item (#136), from the shared mapping for both sides. Absent when
   * the item is unmappable and on every linked or ignored row, so those shapes are unchanged.
   */
  readonly cycle?: BillingCycle;
}

export interface SyncCandidate {
  readonly wallosId: string;
  readonly actualScheduleId: string;
  readonly nameScore: number;
  readonly wallosName: string;
  readonly actualName: string;
  readonly wallosAmountCents: number;
  readonly actualAmountCents: number;
  readonly isRange: boolean;
}

/** One side's compared fields on a mismatch. Amount is in the base currency (range: both bounds). */
export interface SyncMismatchFields {
  readonly frequency: string;
  /** Repeat every N units; a missing interval is folded to 1. */
  readonly interval: number;
  readonly startDate: string | null;
  readonly currency: string;
  readonly amount: MatchAmount;
}

export interface SyncMismatch {
  readonly matchId: string;
  readonly wallosId: string;
  readonly actualScheduleId: string;
  readonly wallosName: string;
  readonly actualName: string;
  readonly wallosAmountCents: number;
  readonly actualAmountCents: number;
  readonly isRange: boolean;
  readonly wallosDrift: boolean;
  readonly actualDrift: boolean;
  readonly wallosFields: SyncMismatchFields;
  readonly actualFields: SyncMismatchFields;
}

export interface SyncUnmappable {
  readonly side: 'wallos' | 'actual';
  readonly id: string;
  readonly name: string;
  readonly reason: UnmappableReason;
}

export interface SyncOrphaned {
  readonly wallosId: string;
  readonly actualScheduleId: string;
  readonly classification: SyncOrphanKind;
  readonly status: MatchStatus;
}

/** One LINKED or MISMATCH_DETECTED row. Fields of a missing side are null. */
export interface SyncLinked {
  readonly matchId: string;
  readonly wallosId: string;
  readonly actualScheduleId: string;
  readonly status: Extract<MatchStatus, 'LINKED' | 'MISMATCH_DETECTED'>;
  readonly orphan: SyncOrphanKind | null;
  readonly wallosName: string | null;
  readonly actualName: string | null;
  readonly wallosAmountCents: number | null;
  readonly actualAmountCents: number | null;
  /** True when the Actual schedule is a range (amount is the midpoint). */
  readonly isRange: boolean;
  /**
   * Unlinked items on the missing side that pass the candidate rule against the surviving side at
   * the user's tolerance, best name score first. Empty when orphan is null or orphaned_both.
   */
  relinkCandidateIds: string[];
}

/** One IGNORED_WALLOS or IGNORED_ACTUAL row. Display fields are null when the item is gone. */
export interface SyncIgnored {
  readonly matchId: string;
  readonly side: 'wallos' | 'actual';
  readonly itemId: string;
  readonly name: string | null;
  readonly amountCents: number | null;
  readonly isRange: boolean;
  /** The item's unmappable reason, if any. */
  readonly reason: UnmappableReason | null;
}

export interface SyncCheckResult {
  readonly checkedAt: string;
  /** Actual base currency code (trimmed, upper case); every amountCents is in this currency. */
  readonly baseCurrency: string;
  readonly unlinkedWallos: SyncItem[];
  readonly unlinkedActual: SyncItem[];
  readonly candidates: SyncCandidate[];
  readonly mismatches: SyncMismatch[];
  readonly unmappable: SyncUnmappable[];
  readonly orphaned: SyncOrphaned[];
  readonly linked: SyncLinked[];
  readonly ignored: SyncIgnored[];
}

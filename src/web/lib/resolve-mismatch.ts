import type { SyncCheckResult, SyncMismatch, SyncMismatchFields } from '../../lib/sync-check-types';
import { ApiError } from './api';
import { resolveMatch, type ResolveAction } from './matches.api';

export type FieldKey = 'frequency' | 'interval' | 'startDate' | 'currency' | 'amount';

const KEYS: readonly FieldKey[] = ['amount', 'currency', 'frequency', 'interval', 'startDate'];

/** The compared fields whose Wallos and Actual values differ. */
export function driftedFields(wallos: SyncMismatchFields, actual: SyncMismatchFields): FieldKey[] {
  return KEYS.filter((k) => JSON.stringify(wallos[k]) !== JSON.stringify(actual[k]));
}

/** Optimistic resolve: the row leaves mismatches[]; Ignore Diff makes it LINKED, Unlink drops it from linked[]. */
export function applyResolve(result: SyncCheckResult, matchId: string, action: ResolveAction): SyncCheckResult {
  const mismatches = result.mismatches.filter((m) => m.matchId !== matchId);
  const linked =
    action === 'unlink'
      ? result.linked.filter((l) => l.matchId !== matchId)
      : result.linked.map((l) => (l.matchId === matchId ? { ...l, status: 'LINKED' as const } : l));
  return { ...result, mismatches, linked };
}

/** Undo one resolve on the current result, touching only that match's rows. */
export function rollbackResolve(current: SyncCheckResult, snapshot: SyncCheckResult, matchId: string): SyncCheckResult {
  const mismatch: SyncMismatch | undefined = snapshot.mismatches.find((m) => m.matchId === matchId);
  const linkedRow = snapshot.linked.find((l) => l.matchId === matchId);
  const mismatches = current.mismatches.some((m) => m.matchId === matchId)
    ? current.mismatches
    : mismatch === undefined
      ? current.mismatches
      : [...current.mismatches, mismatch];
  let linked = current.linked;
  if (linkedRow !== undefined) {
    linked = linked.some((l) => l.matchId === matchId)
      ? linked.map((l) => (l.matchId === matchId ? linkedRow : l))
      : [...linked, linkedRow];
  }
  return { ...current, mismatches, linked };
}

export type ResolveOutcome = { readonly ok: true } | { readonly ok: false; readonly code: string };

/**
 * Applies the resolve to the shared result at once, then sends it. A failure restores only this
 * match's rows (as performAction does) and returns the server code. `refresh` runs after success.
 */
export async function performResolve(
  get: () => SyncCheckResult | null,
  set: (result: SyncCheckResult) => void,
  matchId: string,
  action: ResolveAction,
  refresh: () => Promise<void>,
  fetchImpl?: typeof fetch,
): Promise<ResolveOutcome> {
  const snapshot = get();
  if (snapshot === null) return { ok: false, code: 'request_failed' };
  set(applyResolve(snapshot, matchId, action));
  try {
    await resolveMatch(matchId, action, fetchImpl);
  } catch (error: unknown) {
    set(rollbackResolve(get() ?? snapshot, snapshot, matchId));
    return { ok: false, code: error instanceof ApiError ? error.code : 'request_failed' };
  }
  await refresh();
  return { ok: true };
}

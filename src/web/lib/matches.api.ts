import { apiRequest } from './api';

export interface MatchCreated {
  id: string;
  status: string;
}

/** POST /api/matches. Throws ApiError with the server code (already_matched, not_candidate, item_not_found, invalid_request). */
export function linkPair(wallosId: string, actualScheduleId: string, fetchImpl?: typeof fetch): Promise<MatchCreated> {
  return apiRequest<MatchCreated>('/api/matches', { method: 'POST', body: { wallosId, actualScheduleId }, fetchImpl });
}

/** POST /api/matches/ignore. Throws ApiError with the server code. */
export function ignoreItem(side: 'wallos' | 'actual', itemId: string, fetchImpl?: typeof fetch): Promise<MatchCreated> {
  return apiRequest<MatchCreated>('/api/matches/ignore', { method: 'POST', body: { side, itemId }, fetchImpl });
}

/** DELETE /api/matches/:id (204). Throws ApiError with the server code (match_not_found, invalid_state). */
export function restoreMatch(matchId: string, fetchImpl?: typeof fetch): Promise<void> {
  return apiRequest(`/api/matches/${encodeURIComponent(matchId)}`, { method: 'DELETE', fetchImpl }).then(() => undefined);
}

/** `overwrite_wallos_currency` (#223) sets the Wallos currency to the budget currency; the server refuses it when Wallos lacks that currency. */
export type OverwriteAction = 'overwrite_wallos' | 'overwrite_actual' | 'overwrite_wallos_currency';
export type ResolveAction = 'ignore_diff' | 'unlink' | OverwriteAction;

/**
 * What a 200 answer says beyond success: `no_change_needed` (nothing was written, the pair stays a mismatch) and
 * `currency_changed_other_fields_differ` (`overwrite_wallos_currency` wrote the currency and price, but another field
 * still differs, so the pair stays a mismatch). `undefined`: the pair is resolved.
 */
export type ResolveAnswer = 'no_change_needed' | 'currency_changed_other_fields_differ' | undefined;

/**
 * POST /api/matches/:id/resolve (204 or JSON). Unlink and the two overwrite actions send
 * `confirm: true`; callers must only use them after the user confirmed. Throws ApiError with the
 * server code (match_not_found, invalid_state, confirmation_required, overwrite_unverified,
 * range_amount_unsupported, patterns_unsupported, wallos_currency_missing, currency_conversion_failed).
 */
export function resolveMatch(
  matchId: string,
  action: ResolveAction,
  fetchImpl?: typeof fetch,
): Promise<ResolveAnswer> {
  const body = action === 'ignore_diff' ? { action } : { action, confirm: true };
  return apiRequest<{ outcome?: unknown } | undefined>(`/api/matches/${encodeURIComponent(matchId)}/resolve`, {
    method: 'POST',
    body,
    fetchImpl,
  }).then((data) =>
    data?.outcome === 'no_change_needed' || data?.outcome === 'currency_changed_other_fields_differ' ? data.outcome : undefined,
  );
}

/**
 * POST /api/matches/:id/relink. Points an orphaned match's missing side at an unlinked item; the server derives the
 * side. Throws ApiError with the server code (match_not_found, invalid_state, already_matched, item_not_found).
 */
export function relinkMatch(matchId: string, itemId: string, fetchImpl?: typeof fetch): Promise<MatchCreated> {
  return apiRequest<MatchCreated>(`/api/matches/${encodeURIComponent(matchId)}/relink`, {
    method: 'POST',
    body: { itemId },
    fetchImpl,
  });
}

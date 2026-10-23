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

export type OverwriteAction = 'overwrite_wallos' | 'overwrite_actual';
export type ResolveAction = 'ignore_diff' | 'unlink' | OverwriteAction;

/**
 * POST /api/matches/:id/resolve (204 or JSON). Unlink and the two overwrite actions send
 * `confirm: true`; callers must only use them after the user confirmed. Throws ApiError with the
 * server code (match_not_found, invalid_state, confirmation_required, overwrite_unverified,
 * range_amount_unsupported, patterns_unsupported).
 */
export function resolveMatch(
  matchId: string,
  action: ResolveAction,
  fetchImpl?: typeof fetch,
): Promise<'no_change_needed' | undefined> {
  const body = action === 'ignore_diff' ? { action } : { action, confirm: true };
  return apiRequest<{ outcome?: unknown } | undefined>(`/api/matches/${encodeURIComponent(matchId)}/resolve`, {
    method: 'POST',
    body,
    fetchImpl,
  }).then((data) => (data?.outcome === 'no_change_needed' ? 'no_change_needed' : undefined));
}

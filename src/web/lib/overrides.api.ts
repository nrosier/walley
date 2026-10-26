import { apiRequest } from './api';

export interface SubscriptionOverride {
  wallosSubscriptionId: string;
  rate: string;
}

/** GET /api/overrides/:id. Throws ApiError (404 not_found when none is saved). */
export function getOverride(wallosSubscriptionId: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<SubscriptionOverride> {
  return apiRequest<SubscriptionOverride>(`/api/overrides/${encodeURIComponent(wallosSubscriptionId)}`, { fetchImpl, signal });
}

/** PUT /api/overrides/:id. Throws ApiError, for example invalid_rate. */
export function saveOverride(
  wallosSubscriptionId: string,
  rate: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<SubscriptionOverride & { resetMatches: number }> {
  return apiRequest<SubscriptionOverride & { resetMatches: number }>(
    `/api/overrides/${encodeURIComponent(wallosSubscriptionId)}`,
    { method: 'PUT', body: { rate }, fetchImpl, signal },
  );
}

/** DELETE /api/overrides/:id (204). Throws ApiError, for example not_found. */
export function clearOverride(wallosSubscriptionId: string, fetchImpl?: typeof fetch, signal?: AbortSignal): Promise<undefined> {
  return apiRequest<undefined>(`/api/overrides/${encodeURIComponent(wallosSubscriptionId)}`, { method: 'DELETE', fetchImpl, signal });
}

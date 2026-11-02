import type { SyncItemDetails } from '../../lib/sync-item-details';
import { apiRequest } from './api';

/** GET /api/sync/items/:side/:id (#155). Read-only. Throws ApiError with the server code (item_not_found, invalid_request). */
export function fetchItemDetails(
  side: 'wallos' | 'actual',
  id: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<SyncItemDetails> {
  return apiRequest<SyncItemDetails>(`/api/sync/items/${side}/${encodeURIComponent(id)}`, { fetchImpl, signal });
}

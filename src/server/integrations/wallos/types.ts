/**
 * A subscription as the Wallos API returns it.
 *
 * TODO: no Wallos fixture or API documentation is available offline, so the field names
 * are unconfirmed. Only `id` is declared, because the client does not read any other
 * field. Add fields here from a real response or the Wallos docs, not from memory.
 */
export interface WallosSubscription {
  id: number | string;
  [field: string]: unknown;
}

/**
 * Read-only details of one synced item on one side (#155), returned by GET /api/sync/items/:side/:id.
 * Browser-safe types only; the server builds the value (src/server/matching/item-details.ts).
 * Amounts are integer cents in the item's own currency (Wallos `price`, Actual `amount` in the base
 * currency). A null field means the source has no value for it.
 */
import type { BillingCycle } from './billing-cycle.js';

export interface WallosItemDetails {
  readonly side: 'wallos';
  readonly id: string;
  readonly title: string;
  /** Price in the subscription's own currency, integer minor units. */
  readonly priceCents: number;
  /** ISO code of the subscription's own currency. */
  readonly currency: string;
  readonly cycle: BillingCycle | null;
  readonly startDate: string | null;
  readonly nextPayment: string | null;
  readonly paymentMethod: string | null;
  readonly category: string | null;
  readonly notes: string | null;
  readonly autoRenew: boolean;
}

export interface ActualItemDetails {
  readonly side: 'actual';
  readonly id: string;
  readonly name: string;
  /** Amount in the budget's base currency, integer cents; the midpoint for a range. */
  readonly amountCents: number | null;
  readonly isRange: boolean;
  /** ISO code of the base currency. */
  readonly currency: string;
  readonly cycle: BillingCycle | null;
  readonly startDate: string | null;
  readonly payee: string | null;
  readonly account: string | null;
}

export type SyncItemDetails = WallosItemDetails | ActualItemDetails;

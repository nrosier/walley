import type { Side } from './sync-check.js';

export interface WallosBaseline {
  readonly lastKnownWallosAmountCents: number | null;
  readonly lastKnownWallosPriceMinor: number | null;
  readonly lastKnownWallosCurrency: string | null;
}

const NONE: WallosBaseline = {
  lastKnownWallosAmountCents: null,
  lastKnownWallosPriceMinor: null,
  lastKnownWallosCurrency: null,
};

/**
 * #229: the Wallos baseline columns for one side: the amount inside the hashed fields and the
 * subscription's own price and currency. All null when the side, its fields, its own price or a
 * single amount is missing (a range or pattern schedule cannot be baselined). Every write site
 * uses this so the columns always describe the amount inside the stored hash.
 */
export function wallosBaselineOf(side: Pick<Side, 'fields' | 'own'> | undefined): WallosBaseline {
  const amount = side?.fields?.amount;
  if (side === undefined || amount === undefined || amount.kind !== 'single' || side.own === undefined) return NONE;
  return {
    lastKnownWallosAmountCents: amount.cents,
    lastKnownWallosPriceMinor: side.own.priceMinor,
    lastKnownWallosCurrency: side.own.currencyCode,
  };
}

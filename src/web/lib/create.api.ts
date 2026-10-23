import { apiRequest } from './api';

export interface NamedEntity {
  id: string;
  name: string;
}

export interface ActualSchedulePrefill {
  name: string;
  /** Converted integer cents in the budget's base currency, negative for an expense. */
  amountCents: number;
  baseCurrency: string;
  recurrence: { frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval?: number };
  startDate: string;
  accounts: NamedEntity[];
  payees: NamedEntity[];
  categories: NamedEntity[];
}

export interface WallosSubscriptionPrefill {
  name: string;
  /** Positive decimal string in `currencyCode`. */
  price: string;
  currencyCode: string;
  /** Wallos cycle unit: 1 days, 2 weeks, 3 months, 4 years. */
  cycle: number;
  frequency: number;
  startDate: string | null;
  nextPayment: string;
}

/** POST /api/integrations/actual-schedules/prefill (read-only preview). Throws ApiError with the server code. */
export function prefillActualSchedule(
  wallosSubscriptionId: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<ActualSchedulePrefill> {
  return apiRequest<ActualSchedulePrefill>('/api/integrations/actual-schedules/prefill', {
    method: 'POST',
    body: { wallosSubscriptionId },
    fetchImpl,
    signal,
  });
}

/** POST /api/integrations/wallos-subscriptions/prefill (read-only preview). Throws ApiError with the server code. */
export function prefillWallosSubscription(
  scheduleId: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<WallosSubscriptionPrefill> {
  return apiRequest<WallosSubscriptionPrefill>('/api/integrations/wallos-subscriptions/prefill', {
    method: 'POST',
    body: { scheduleId },
    fetchImpl,
    signal,
  });
}

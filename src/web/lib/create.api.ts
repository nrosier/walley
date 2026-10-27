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
  /** Wallos currency code of the subscription. */
  sourceCurrency: string;
  /** Wallos rate of that currency (Wallos scale), or null. */
  wallosRate: string | null;
  /** Saved manual rate, or null. `amountCents` already reflects it. */
  overrideRate: string | null;
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

export type PayeeChoice = { kind: 'existing'; id: string } | { kind: 'new'; name: string };

export interface CreateActualScheduleInput {
  wallosSubscriptionId: string;
  accountId: string;
  payee: PayeeChoice;
  categoryId?: string;
  /** Orphaned match to repoint to the new schedule instead of creating a second row. */
  matchId?: string;
}

export interface CreateActualScheduleResult {
  scheduleId: string;
  payeeId: string;
  payeeCreated: boolean;
  categoryApplied: boolean;
  categoryError?: boolean;
}

/** POST /api/integrations/actual-schedules (live write). Throws ApiError with the server code. */
export function createActualSchedule(
  input: CreateActualScheduleInput,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
): Promise<CreateActualScheduleResult> {
  return apiRequest<CreateActualScheduleResult>('/api/integrations/actual-schedules', {
    method: 'POST',
    body: input,
    fetchImpl,
    signal,
  });
}

/** POST /api/integrations/wallos-subscriptions (live write). `matchId` repoints an orphaned match. Throws ApiError with the server code. */
export function createWallosSubscription(
  scheduleId: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal,
  matchId?: string,
): Promise<{ wallosSubscriptionId: string }> {
  return apiRequest<{ wallosSubscriptionId: string }>('/api/integrations/wallos-subscriptions', {
    method: 'POST',
    body: matchId === undefined ? { scheduleId } : { scheduleId, matchId },
    fetchImpl,
    signal,
  });
}

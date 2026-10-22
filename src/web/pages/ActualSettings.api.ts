/** Calls for the Actual Budget settings section. Kept out of the .tsx so the component file only exports components. */
import { apiRequest } from '@/lib/api';

/** The server never returns a secret: only whether one is stored. */
export interface ActualSettingsData {
  actualUrl: string;
  actualBudgetId: string | null;
  hasActualPassword: boolean;
  hasActualSyncKey: boolean;
}

export interface BudgetOption {
  id: string;
  name: string;
}

export interface SaveInput {
  url: string;
  password: string;
  syncKey: string;
  clearSyncKey: boolean;
}

type Fetcher = typeof fetch | undefined;

/** Blank secrets are omitted so the server keeps the stored value. */
export function saveActualSettings(input: SaveInput, fetchImpl?: Fetcher): Promise<ActualSettingsData> {
  const body: Record<string, unknown> = { actualUrl: input.url };
  if (input.password.trim() !== '') body['password'] = input.password;
  if (input.syncKey.trim() !== '') body['syncKey'] = input.syncKey;
  else if (input.clearSyncKey) body['clearSyncKey'] = true;
  return apiRequest<ActualSettingsData>('/api/settings/actual', { method: 'PUT', body, fetchImpl });
}

export function saveBudgetChoice(savedUrl: string, budgetId: string, fetchImpl?: Fetcher): Promise<ActualSettingsData> {
  return apiRequest<ActualSettingsData>('/api/settings/actual', {
    method: 'PUT',
    body: { actualUrl: savedUrl, actualBudgetId: budgetId },
    fetchImpl,
  });
}

export async function fetchBudgets(fetchImpl?: Fetcher): Promise<BudgetOption[]> {
  const data = await apiRequest<{ budgets: BudgetOption[] }>('/api/settings/actual/budgets', { method: 'POST', fetchImpl });
  return data.budgets;
}

export async function fetchBaseCurrency(fetchImpl?: Fetcher): Promise<string | null> {
  const data = await apiRequest<{ currency: string | null }>('/api/settings/actual/base-currency', { method: 'POST', fetchImpl });
  return data.currency;
}

/** The fields the form keeps from a settings response. Anything else (never a secret) is dropped. */
export function viewStateFrom(data: ActualSettingsData): ActualSettingsData {
  return {
    actualUrl: data.actualUrl,
    actualBudgetId: data.actualBudgetId,
    hasActualPassword: data.hasActualPassword,
    hasActualSyncKey: data.hasActualSyncKey,
  };
}


import type {
  APIAccountEntity,
  APICategoryEntity,
  APIPayeeEntity,
  APIScheduleEntity,
  Preferences,
} from '@actual-app/api/models';
import type { ActualApi } from './session.js';

/**
 * Read-only queries against an open Actual budget. Each function takes the module handed out by
 * `withActualSession` and returns plain data. Amounts are passed through as integer cents
 * (e.g. -1250 for EUR 12.50); no float conversion happens here.
 */

/** Schedules, including the underlying rule, next date and amount in integer cents. */
export function readSchedules(api: ActualApi): Promise<APIScheduleEntity[]> {
  return api.getSchedules();
}

/** Accounts with balance_current (integer cents, may be null), off-budget and closed flags. */
export function readAccounts(api: ActualApi): Promise<APIAccountEntity[]> {
  return api.getAccounts();
}

/** Payees, including the transfer account id for transfer payees. */
export function readPayees(api: ActualApi): Promise<APIPayeeEntity[]> {
  return api.getPayees();
}

/** Categories, flat, each with its group id. Called with no options, so the hidden filter is unset. */
export function readCategories(api: ActualApi): Promise<APICategoryEntity[]> {
  return api.getCategories();
}

/**
 * Base currency from the budget's synced preferences (`defaultCurrencyCode`, see
 * @actual-app/core/src/types/prefs.ts). Resolves to null when the budget does not set one.
 */
export async function readBaseCurrency(api: ActualApi): Promise<string | null> {
  const prefs: Preferences = await api.getPreferences();
  const code = prefs.defaultCurrencyCode;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

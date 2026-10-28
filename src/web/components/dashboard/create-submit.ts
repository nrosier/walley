import { ApiError } from '@/lib/api';
import type { CreateActualScheduleInput, WallosCreateChoices, WallosSubscriptionPrefill } from '@/lib/create.api';
import { currencyExponent } from '../../../lib/currency-exponent';
import { billingCycleFor, type CycleUnit } from './create-modal-shared';

export const NEW_PAYEE = '__new__';

/** Actual Submit needs an account and no request in flight. */
export function actualSubmitDisabled(account: string, pending: boolean): boolean {
  return account === '' || pending;
}

export type ActualDisabledReason = 'account' | 'payeeName';

/** Why Create is off before sending, in the order the form shows it; null when nothing is missing. */
export function actualDisabledReason(account: string, payee: string, newName: string): ActualDisabledReason | null {
  if (account === '') return 'account';
  if (payee === NEW_PAYEE && newName.trim() === '') return 'payeeName';
  return null;
}

/** Wallos Submit needs no request in flight (the form only renders once the pre-fill has loaded). */
export function wallosSubmitDisabled(pending: boolean): boolean {
  return pending;
}

/** The four editable Wallos fields as the form holds them (strings, as typed). */
export interface WallosFormFields {
  title: string;
  price: string;
  unit: CycleUnit;
  startDate: string;
}

export type WallosDisabledReason = 'title' | 'price' | 'startDate';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A price as typed: a comma is accepted as the decimal mark, surrounding space is dropped. */
export function normalizePrice(value: string): string {
  return value.trim().replace(',', '.');
}

function validDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (m === null) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** Positive decimal with no more places than the currency has (currency-exponent.ts). Mirrors the server's check. */
export function validPrice(value: string, currencyCode: string): boolean {
  const price = normalizePrice(value);
  const m = /^\d{1,12}(?:\.(\d{1,8}))?$/.exec(price);
  if (m === null || !/[1-9]/.test(price)) return false;
  return (m[1] ?? '').replace(/0+$/, '').length <= currencyExponent(currencyCode);
}

/** Why Create is off before sending, in the order the form shows it; null when the four fields are usable. */
export function wallosDisabledReason(fields: WallosFormFields, currencyCode: string): WallosDisabledReason | null {
  if (fields.title.trim() === '' || fields.title.trim().length > 200) return 'title';
  if (!validPrice(fields.price, currencyCode)) return 'price';
  if (!validDate(fields.startDate)) return 'startDate';
  return null;
}

/**
 * The edited values to send (#133): only the fields that differ from the pre-fill, so an untouched form
 * posts what it always did. The start date is compared with the pre-filled start (or the next payment
 * when Wallos has no start date), and an untouched cycle sends nothing.
 */
export function wallosEdits(
  prefill: WallosSubscriptionPrefill,
  fields: WallosFormFields,
  prefillUnit: CycleUnit,
): Pick<WallosCreateChoices, 'title' | 'price' | 'billingCycle' | 'startDate'> {
  const edits: Pick<WallosCreateChoices, 'title' | 'price' | 'billingCycle' | 'startDate'> = {};
  const title = fields.title.trim();
  if (title !== prefill.name.trim()) edits.title = title;
  const price = normalizePrice(fields.price);
  if (price !== prefill.price) edits.price = price;
  if (fields.unit !== prefillUnit) edits.billingCycle = billingCycleFor(fields.unit);
  if (fields.startDate !== (prefill.startDate ?? prefill.nextPayment)) edits.startDate = fields.startDate;
  return edits;
}

export type CreateOutcome<T> = { ok: true; result: T } | { ok: false; code: string };

/** Runs the create call, then the dashboard refresh on success. Failures become a fixed error code. */
export async function performCreate<T>(call: () => Promise<T>, refresh: () => Promise<void> | void): Promise<CreateOutcome<T>> {
  let result: T;
  try {
    result = await call();
  } catch (err: unknown) {
    return { ok: false, code: err instanceof ApiError ? err.code : 'request_failed' };
  }
  await refresh();
  return { ok: true, result };
}

/** Builds the create body from the form choices. */
export function buildActualBody(
  wallosId: string,
  account: string,
  payee: string,
  newName: string,
  category: string,
  matchId?: string,
): CreateActualScheduleInput {
  return {
    wallosSubscriptionId: wallosId,
    accountId: account,
    payee: payee === NEW_PAYEE ? { kind: 'new', name: newName } : { kind: 'existing', id: payee },
    ...(category === '' ? {} : { categoryId: category }),
    ...(matchId === undefined ? {} : { matchId }),
  };
}

/**
 * Submits a create: runs the call and the dashboard refresh, then `onCreated` with the result (the modal closes
 * and shows its notices there) or `onFailed` with the error code (the modal stays open and shows it).
 */
export async function submitCreate<T>(
  call: () => Promise<T>,
  refresh: () => Promise<void> | void,
  handlers: { onCreated: (result: T) => void; onFailed: (code: string) => void },
): Promise<void> {
  const outcome = await performCreate(call, refresh);
  if (outcome.ok) handlers.onCreated(outcome.result);
  else handlers.onFailed(outcome.code);
}

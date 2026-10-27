import { ApiError } from '@/lib/api';
import type { CreateActualScheduleInput } from '@/lib/create.api';

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
): CreateActualScheduleInput {
  return {
    wallosSubscriptionId: wallosId,
    accountId: account,
    payee: payee === NEW_PAYEE ? { kind: 'new', name: newName } : { kind: 'existing', id: payee },
    ...(category === '' ? {} : { categoryId: category }),
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

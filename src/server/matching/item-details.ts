/**
 * Read-only details of one synced item on one side (#155). Reads one Wallos subscription or one
 * Actual schedule on demand, for the signed-in user only. Nothing is written. A missing item, a
 * disabled Wallos item and a completed Actual schedule all return null (the route answers 404).
 * No error or log carries a name or an amount.
 */
import { billingCycleOf } from '../../lib/billing-cycle.js';
import type { SyncItemDetails } from '../../lib/sync-item-details.js';
import { CreateFlowError, type CreateDeps } from '../integrations/create.js';
import { readAccounts, readBaseCurrency, readPayees, readSchedules } from '../integrations/actual/read.js';
import { buildCurrencyMap, decodeWallosName, mapWallosSubscription, resolveCurrencyCode } from '../integrations/wallos/map.js';
import type { WallosSubscription } from '../integrations/wallos/types.js';
import { rangeMidpointCents } from '../../lib/amount-match.js';

export type ItemSide = 'wallos' | 'actual';

export type ItemDetailsDeps = Pick<CreateDeps, 'wallos' | 'withActual'>;

/** Wallos: the one subscription with this id, mapped to the card fields; null when absent. */
async function wallosDetails(deps: ItemDetailsDeps, userId: string, id: string): Promise<SyncItemDetails | null> {
  const subscriptions = await deps.wallos.listSubscriptions(userId);
  const raw: WallosSubscription | undefined = subscriptions.find((s) => String(s.id) === id);
  if (raw === undefined) return null;
  const currencies = await deps.wallos.listCurrencies(userId);
  const currencyMap = buildCurrencyMap(currencies);
  const mapped = mapWallosSubscription(raw, currencyMap);
  const currency = resolveCurrencyCode(currencyMap, mapped.currencyId);
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);
  const cycle = billingCycleOf(mapped.recurrence.frequency, mapped.recurrence.interval);
  return {
    side: 'wallos',
    id: mapped.wallosId,
    title: mapped.name,
    priceCents: mapped.priceCents,
    currency,
    cycle,
    startDate: mapped.startDate,
    nextPayment: mapped.nextPaymentDate,
    paymentMethod: text(raw.payment_method_name),
    category: text(raw.category_name),
    notes: text(raw.notes) === null ? null : decodeWallosName(raw.notes as string),
    autoRenew: raw.auto_renew === true || raw.auto_renew === 1,
  };
}

/** Actual: the one schedule with this id, its payee and account resolved to names; null when absent. */
async function actualDetails(deps: ItemDetailsDeps, userId: string, id: string): Promise<SyncItemDetails | null> {
  const read = await deps.withActual(userId, async (api) => {
    const [schedules, payees, accounts, baseCode] = await Promise.all([
      readSchedules(api),
      readPayees(api),
      readAccounts(api),
      readBaseCurrency(api),
    ]);
    return { schedule: schedules.find((s) => s.id === id), payees, accounts, baseCode };
  });
  const { schedule } = read;
  if (schedule === undefined) return null;
  if (read.baseCode === null) throw new CreateFlowError('base_currency_missing');
  const recurrence: Exclude<typeof schedule.date, string> | null = typeof schedule.date === 'object' ? schedule.date : null;
  const amount: unknown = schedule.amount;
  let amountCents: number | null = null;
  let isRange = false;
  if (typeof amount === 'number' && Number.isSafeInteger(amount)) amountCents = amount;
  else if (typeof amount === 'object' && amount !== null) {
    const { num1, num2 } = amount as { num1?: unknown; num2?: unknown };
    if (Number.isSafeInteger(num1) && Number.isSafeInteger(num2)) {
      amountCents = rangeMidpointCents(num1 as number, num2 as number);
      isRange = true;
    }
  }
  const frequency = recurrence?.frequency;
  const interval = recurrence?.interval;
  const cycle = typeof frequency === 'string' ? billingCycleOf(frequency, interval) : null;
  const nameOf = (list: readonly { id: string; name: string }[], itemId: unknown): string | null =>
    typeof itemId === 'string' ? (list.find((x) => x.id === itemId)?.name ?? null) : null;
  return {
    side: 'actual',
    id: schedule.id,
    // The schedule name is optional in the Actual type; a schedule with no name shows as an empty name.
    name: schedule.name ?? '',
    amountCents,
    isRange,
    currency: read.baseCode,
    cycle,
    startDate: typeof recurrence?.start === 'string' ? recurrence.start : null,
    payee: nameOf(read.payees, schedule.payee),
    account: nameOf(read.accounts, schedule.account),
  };
}

/** The details of one item on one side for this user, or null when that user does not own it. */
export function readItemDetails(deps: ItemDetailsDeps, userId: string, side: ItemSide, id: string): Promise<SyncItemDetails | null> {
  return side === 'wallos' ? wallosDetails(deps, userId, id) : actualDetails(deps, userId, id);
}

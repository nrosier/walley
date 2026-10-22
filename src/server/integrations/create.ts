/**
 * Create flows (#28, #29, #30): orchestration only, no HTTP. Every dependency is injected so the
 * flows run against mocks. Nothing here logs; errors carry fixed text, never names or amounts.
 */
import type { APIScheduleEntity } from '@actual-app/api/models';
import { actualToWallos, FrequencyMappingError } from '../../lib/frequency-mapper.js';
import type { UserRepoFor, WallosClient } from './wallos/client.js';
import { createActualSchedule, type CreateScheduleResult, type PayeeChoice } from './actual/write.js';
import { readBaseCurrency, readSchedules } from './actual/read.js';
import { withActualSession, type ActualApi, type ActualSessionDeps } from './actual/session.js';
import { prepareActualScheduleInput, prepareWallosSubscriptionPayload } from './prepare.js';
import { buildCurrencyMap, mapWallosSubscription, WallosMappingError } from './wallos/map.js';
import type { CreateScheduleInput } from './actual/write.js';

export type CreateFlowErrorCode =
  | 'range_amount_unsupported'
  | 'base_currency_missing'
  | 'wallos_subscription_not_found'
  | 'schedule_not_found';

const MESSAGES: Record<CreateFlowErrorCode, string> = {
  range_amount_unsupported: 'A schedule with an amount range cannot be created in Wallos',
  base_currency_missing: 'The Actual budget has no base currency set',
  wallos_subscription_not_found: 'The Wallos subscription was not found',
  schedule_not_found: 'The Actual schedule was not found',
};

/** Fixed messages only. */
export class CreateFlowError extends Error {
  readonly code: CreateFlowErrorCode;
  constructor(code: CreateFlowErrorCode) {
    super(MESSAGES[code]);
    this.name = 'CreateFlowError';
    this.code = code;
  }
}

export interface CreateDeps {
  readonly wallos: WallosClient;
  readonly repoFor: UserRepoFor;
  /** Runs `use` inside the user's open Actual budget (withActualSession). */
  readonly withActual: <T>(userId: string, use: (api: ActualApi) => Promise<T>) => Promise<T>;
  /** Creates the schedule in the user's budget and syncs it (createActualSchedule). */
  readonly createSchedule: (userId: string, input: CreateScheduleInput) => Promise<CreateScheduleResult>;
}

/** Production wiring: the real session and write layer. */
export function realCreateDeps(
  wallos: WallosClient,
  repoFor: UserRepoFor,
  actual: ActualSessionDeps,
): CreateDeps {
  return {
    wallos,
    repoFor,
    withActual: (userId, use) => withActualSession(actual, userId, use),
    createSchedule: (userId, input) => createActualSchedule(actual, userId, input),
  };
}

export interface CreateActualScheduleRequest {
  readonly wallosSubscriptionId: string;
  readonly accountId: string;
  readonly payee: PayeeChoice;
  readonly categoryId?: string;
}

/**
 * #28/#29: Wallos subscription -> Actual schedule. Fetches the subscriptions and the currency
 * list once, applies the per-subscription override, converts into the budget's base currency.
 */
export async function createActualScheduleFromWallos(
  deps: CreateDeps,
  userId: string,
  request: CreateActualScheduleRequest,
): Promise<CreateScheduleResult> {
  const [subscriptions, currencies] = await Promise.all([
    deps.wallos.listSubscriptions(userId),
    deps.wallos.listCurrencies(userId),
  ]);
  const raw = subscriptions.find((s) => String(s.id) === request.wallosSubscriptionId);
  if (raw === undefined) {
    throw new CreateFlowError('wallos_subscription_not_found');
  }
  const mapped = mapWallosSubscription(raw);
  const override = deps.repoFor(userId).getSubscriptionOverride(request.wallosSubscriptionId);

  const baseCode = await deps.withActual(userId, (api) => readBaseCurrency(api));
  if (baseCode === null) {
    throw new CreateFlowError('base_currency_missing');
  }
  const prepared = prepareActualScheduleInput(mapped, currencies, baseCode, override?.rate);
  return deps.createSchedule(userId, {
    ...prepared,
    payee: request.payee,
    accountId: request.accountId,
    ...(request.categoryId === undefined ? {} : { categoryId: request.categoryId }),
  });
}

/** What the schedule read returns for one schedule; the amount is never copied beyond this scope. */
interface ScheduleRead {
  readonly schedule: APIScheduleEntity | undefined;
  readonly baseCode: string | null;
}

/**
 * #30: Actual schedule -> Wallos subscription. The new subscription is created in the Wallos
 * currency whose code is the budget's base currency, so the amount needs no rate and keeps its
 * cents. Range schedules are rejected, not guessed.
 */
export async function createWallosSubscriptionFromActualSchedule(
  deps: CreateDeps,
  userId: string,
  request: { readonly scheduleId: string },
): Promise<{ readonly wallosSubscriptionId: string }> {
  const read = await deps.withActual<ScheduleRead>(userId, async (api) => ({
    schedule: (await readSchedules(api)).find((s) => s.id === request.scheduleId),
    baseCode: await readBaseCurrency(api),
  }));
  const schedule = read.schedule;
  if (schedule === undefined) {
    throw new CreateFlowError('schedule_not_found');
  }
  const amount: unknown = schedule.amount;
  if (schedule.amountOp === 'isbetween' || typeof amount !== 'number') {
    // A range (or an amount object) is never guessed; a missing amount cannot be priced either.
    throw new CreateFlowError('range_amount_unsupported');
  }
  if (read.baseCode === null) {
    throw new CreateFlowError('base_currency_missing');
  }
  const recurrence = typeof schedule.date === 'string' ? undefined : schedule.date;
  if (recurrence === undefined) {
    throw new WallosMappingError('unsupported_cycle', 'cycle', 'schedule has no recurrence rule');
  }
  // Validates the frequency early with the mapper inverse; the payload builder repeats it.
  try {
    actualToWallos({
      frequency: recurrence.frequency,
      ...(recurrence.interval === undefined ? {} : { interval: recurrence.interval }),
      ...(recurrence.patterns === undefined ? {} : { patterns: recurrence.patterns }),
    });
  } catch (err) {
    // Patterns are refused, not mapped: let the typed error reach the route.
    if (err instanceof FrequencyMappingError && err.code !== 'patterns_unsupported') {
      throw new WallosMappingError('unsupported_cycle', 'cycle', err.message);
    }
    throw err;
  }

  const currencies = await deps.wallos.listCurrencies(userId);
  const baseUpper = read.baseCode.trim().toUpperCase();
  const baseEntry = currencies.find((c) => c.code.trim().toUpperCase() === baseUpper);
  if (baseEntry === undefined) {
    throw new WallosMappingError('unknown_currency', 'currency_id', 'base currency is not in Wallos');
  }
  // Same lookup the converter uses; keeps the id a plain string of digits.
  const currencyId = [...buildCurrencyMap([baseEntry]).keys()][0] ?? '';

  const payload = prepareWallosSubscriptionPayload(
    {
      name: schedule.name ?? '',
      priceCents: amount,
      currencyId,
      recurrence: {
        frequency: recurrence.frequency,
        ...(recurrence.interval === undefined ? {} : { interval: recurrence.interval }),
        ...(recurrence.patterns === undefined ? {} : { patterns: recurrence.patterns }),
      },
      startDate: recurrence.start,
      nextPaymentDate: schedule.next_date ?? recurrence.start,
    },
    currencies,
    read.baseCode,
  );
  const wallosSubscriptionId = await deps.wallos.createSubscription(userId, payload);
  return { wallosSubscriptionId };
}

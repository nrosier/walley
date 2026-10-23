/**
 * Create flows (#28, #29, #30): orchestration only, no HTTP. Every dependency is injected so the
 * flows run against mocks. Nothing here logs; errors carry fixed text, never names or amounts.
 */
import type {
  APIAccountEntity,
  APICategoryEntity,
  APIPayeeEntity,
  APIScheduleEntity,
} from '@actual-app/api/models';
import { actualToWallos, FrequencyMappingError } from '../../lib/frequency-mapper.js';
import type { UserRepoFor, WallosClient } from './wallos/client.js';
import { createActualSchedule, type CreateScheduleResult, type PayeeChoice } from './actual/write.js';
import { readAccounts, readBaseCurrency, readCategories, readPayees, readSchedules } from './actual/read.js';
import { withActualSession, type ActualApi, type ActualSessionDeps } from './actual/session.js';
import {
  prepareActualScheduleInput,
  prepareWallosSubscriptionPayload,
  type PreparedScheduleInput,
} from './prepare.js';
import type { WallosSubscriptionPayload } from './wallos/write.js';
import { buildCurrencyMap, mapWallosSubscription, WallosMappingError } from './wallos/map.js';
import type { CreateScheduleInput } from './actual/write.js';

export type CreateFlowErrorCode =
  | 'range_amount_unsupported'
  | 'base_currency_missing'
  | 'wallos_subscription_not_found'
  | 'schedule_not_found'
  | 'invalid_state';

const MESSAGES: Record<CreateFlowErrorCode, string> = {
  range_amount_unsupported: 'A schedule with an amount range cannot be created in Wallos',
  base_currency_missing: 'The Actual budget has no base currency set',
  wallos_subscription_not_found: 'The Wallos subscription was not found',
  schedule_not_found: 'The Actual schedule was not found',
  invalid_state: 'The match is no longer in a state that allows this action',
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

/** Everything the Wallos -> Actual direction derives, before the user's own choices are added. */
export interface ActualSchedulePlan<T> {
  readonly prepared: PreparedScheduleInput;
  readonly baseCurrency: string;
  /** Result of the optional `extra` read, taken in the same Actual session as the base currency. */
  readonly extra: T;
}

/**
 * Shared by the submit and the pre-fill preview, so the two cannot drift apart. Fetches the
 * subscriptions and the currency list once, applies the per-subscription override and converts
 * into the budget's base currency. An unknown subscription id stops here, before Actual is opened.
 * `extra` runs inside the same Actual session (the preview reads accounts, payees, categories).
 */
export async function planActualScheduleFromWallos<T = undefined>(
  deps: CreateDeps,
  userId: string,
  wallosSubscriptionId: string,
  extra?: (api: ActualApi) => Promise<T>,
): Promise<ActualSchedulePlan<T>> {
  const [subscriptions, currencies] = await Promise.all([
    deps.wallos.listSubscriptions(userId),
    deps.wallos.listCurrencies(userId),
  ]);
  const raw = subscriptions.find((s) => String(s.id) === wallosSubscriptionId);
  if (raw === undefined) {
    throw new CreateFlowError('wallos_subscription_not_found');
  }
  const mapped = mapWallosSubscription(raw);
  const override = deps.repoFor(userId).getSubscriptionOverride(wallosSubscriptionId);

  const read = await deps.withActual(userId, async (api) => ({
    baseCode: await readBaseCurrency(api),
    extra: extra === undefined ? (undefined as T) : await extra(api),
  }));
  if (read.baseCode === null) {
    throw new CreateFlowError('base_currency_missing');
  }
  return {
    prepared: prepareActualScheduleInput(mapped, currencies, read.baseCode, override?.rate),
    baseCurrency: read.baseCode,
    extra: read.extra,
  };
}

/** #28/#29: Wallos subscription -> Actual schedule. */
export async function createActualScheduleFromWallos(
  deps: CreateDeps,
  userId: string,
  request: CreateActualScheduleRequest,
): Promise<CreateScheduleResult> {
  const { prepared } = await planActualScheduleFromWallos(deps, userId, request.wallosSubscriptionId);
  return deps.createSchedule(userId, {
    ...prepared,
    payee: request.payee,
    accountId: request.accountId,
    ...(request.categoryId === undefined ? {} : { categoryId: request.categoryId }),
  });
}

export interface ActualSchedulePrefill {
  readonly name: string;
  readonly amountCents: number;
  readonly baseCurrency: string;
  readonly recurrence: PreparedScheduleInput['recurrence'];
  readonly startDate: string;
  readonly accounts: APIAccountEntity[];
  readonly payees: APIPayeeEntity[];
  readonly categories: APICategoryEntity[];
}

/** Read-only preview for the create-schedule modal. Calls no create or update client. */
export async function prefillActualScheduleFromWallos(
  deps: CreateDeps,
  userId: string,
  request: { readonly wallosSubscriptionId: string },
): Promise<ActualSchedulePrefill> {
  const plan = await planActualScheduleFromWallos(deps, userId, request.wallosSubscriptionId, async (api) => ({
    accounts: await readAccounts(api),
    payees: await readPayees(api),
    categories: await readCategories(api),
  }));
  return { ...plan.prepared, baseCurrency: plan.baseCurrency, ...plan.extra };
}

/** What the schedule read returns for one schedule; the amount is never copied beyond this scope. */
interface ScheduleRead {
  readonly schedule: APIScheduleEntity | undefined;
  readonly baseCode: string | null;
}

/** Result of the Actual -> Wallos derivation: the exact `add` payload and the currency code it is priced in. */
export interface WallosSubscriptionPlan {
  readonly payload: WallosSubscriptionPayload;
  readonly currencyCode: string;
}

/**
 * Shared by the submit and the pre-fill preview. Actual schedule -> Wallos `add` payload. The new
 * subscription is created in the Wallos currency whose code is the budget's base currency, so the
 * amount needs no rate and keeps its cents. Range schedules are rejected, not guessed.
 */
export async function planWallosSubscriptionFromSchedule(
  deps: CreateDeps,
  userId: string,
  scheduleId: string,
): Promise<WallosSubscriptionPlan> {
  const read = await deps.withActual<ScheduleRead>(userId, async (api) => ({
    schedule: (await readSchedules(api)).find((s) => s.id === scheduleId),
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
  return { payload, currencyCode: baseEntry.code };
}

/** #30: Actual schedule -> Wallos subscription. */
export async function createWallosSubscriptionFromActualSchedule(
  deps: CreateDeps,
  userId: string,
  request: { readonly scheduleId: string },
): Promise<{ readonly wallosSubscriptionId: string }> {
  const { payload } = await planWallosSubscriptionFromSchedule(deps, userId, request.scheduleId);
  const wallosSubscriptionId = await deps.wallos.createSubscription(userId, payload);
  return { wallosSubscriptionId };
}

export interface WallosSubscriptionPrefill {
  readonly name: string;
  /** Positive decimal string in `currencyCode`, e.g. "12.50". */
  readonly price: string;
  readonly currencyCode: string;
  /** Wallos cycle unit: 1 days, 2 weeks, 3 months, 4 years. */
  readonly cycle: number;
  readonly frequency: number;
  readonly startDate: string | null;
  readonly nextPayment: string;
}

/** Read-only preview for the create-subscription modal. Calls no create client. */
export async function prefillWallosSubscriptionFromSchedule(
  deps: CreateDeps,
  userId: string,
  request: { readonly scheduleId: string },
): Promise<WallosSubscriptionPrefill> {
  const { payload, currencyCode } = await planWallosSubscriptionFromSchedule(deps, userId, request.scheduleId);
  return {
    name: payload.name,
    price: payload.price,
    currencyCode,
    cycle: Number(payload.cycle),
    frequency: Number(payload.frequency),
    startDate: payload.start_date ?? null,
    nextPayment: payload.next_payment,
  };
}


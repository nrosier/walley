import type { ActualRecurrence } from '../../../lib/frequency-mapper.js';
import { withActualSession, type ActualApi, type ActualSessionDeps } from './session.js';

/**
 * Write path for Actual Budget. Uses the real @actual-app/api calls (methods.d.ts):
 *   createSchedule(schedule: Omit<APIScheduleEntity, 'id'>): Promise<string>  (line 122)
 *   createPayee(payee: Omit<APIPayeeEntity, 'id'>): Promise<string>           (line 103)
 *   createRule(rule: Omit<APIRuleEntity, 'id'>): Promise<{id} & NewRuleEntity> (line 113)
 * Rule shape (@actual-app/core types/models/rule.ts): NewRuleEntity lines 3-9 {stage 'pre'|null|'post',
 * conditionsOp, conditions, actions}; SetRuleActionEntity lines 141-151 {field, op:'set', value}.
 * The category rule is standalone: no link-schedule action, because createSchedule already makes its own
 * schedule-linked rule and a second link-schedule action would overwrite its schedules_json_paths.
 * The amount is integer cents, already converted by the caller (negative for an expense).
 */

export type PayeeChoice =
  | { readonly kind: 'existing'; readonly id: string }
  | { readonly kind: 'new'; readonly name: string };

export interface CreateScheduleInput {
  readonly name: string;
  /** Converted integer cents, negative for an expense. */
  readonly amountCents: number;
  /** Output of wallosToActual (shape pending verification in #32). */
  readonly recurrence: ActualRecurrence;
  /** First occurrence, YYYY-MM-DD. */
  readonly startDate: string;
  readonly payee: PayeeChoice;
  /** Account id the schedule posts to. Required. */
  readonly accountId: string;
  /** Optional category id, applied through a standalone payee category rule. */
  readonly categoryId?: string;
}

export interface SchedulePayload {
  readonly name: string;
  readonly posts_transaction: false;
  readonly payee: string;
  readonly account: string;
  readonly amount: number;
  readonly amountOp: 'is';
  readonly date: {
    readonly frequency: ActualRecurrence['frequency'];
    readonly interval?: number;
    readonly start: string;
  };
}

export class ActualWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActualWriteError';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Pure: builds the createSchedule argument. Validates cents, date and name. */
export function buildSchedulePayload(input: CreateScheduleInput, payeeId: string): SchedulePayload {
  if (!Number.isInteger(input.amountCents)) {
    throw new ActualWriteError('Amount must be integer cents');
  }
  if (!DATE_RE.test(input.startDate)) {
    throw new ActualWriteError('Start date must be YYYY-MM-DD');
  }
  if (input.name.trim() === '') {
    throw new ActualWriteError('Schedule name is required');
  }
  if (typeof input.accountId !== 'string' || input.accountId.trim() === '') {
    throw new ActualWriteError('Account is required');
  }
  return {
    name: input.name,
    posts_transaction: false,
    payee: payeeId,
    account: input.accountId,
    amount: input.amountCents,
    amountOp: 'is',
    date: {
      frequency: input.recurrence.frequency,
      ...(input.recurrence.interval === undefined ? {} : { interval: input.recurrence.interval }),
      start: input.startDate,
    },
  };
}

export interface CreateScheduleResult {
  readonly scheduleId: string;
  readonly payeeId: string;
  readonly payeeCreated: boolean;
  /** True only when the category rule was created. */
  readonly categoryApplied: boolean;
}

export interface CategoryRulePayload {
  readonly stage: 'pre';
  readonly conditionsOp: 'and';
  readonly conditions: { field: 'payee'; op: 'is'; value: string }[];
  readonly actions: { field: 'category'; op: 'set'; value: string }[];
}

/** Pure: standalone rule "payee is X -> set category", with no link-schedule action. */
export function buildCategoryRulePayload(payeeId: string, categoryId: string): CategoryRulePayload {
  return {
    stage: 'pre',
    conditionsOp: 'and',
    conditions: [{ field: 'payee', op: 'is', value: payeeId }],
    actions: [{ field: 'category', op: 'set', value: categoryId }],
  };
}

/** Creates the payee when asked and then the schedule, on an open session. */
export async function createScheduleOnApi(
  api: ActualApi,
  input: CreateScheduleInput,
): Promise<CreateScheduleResult> {
  let payeeId: string;
  let payeeCreated = false;
  if (input.payee.kind === 'existing') {
    payeeId = input.payee.id;
  } else {
    const name = input.payee.name.trim();
    if (name === '') {
      throw new ActualWriteError('Payee name is required');
    }
    payeeId = await api.createPayee({ name });
    payeeCreated = true;
  }
  const scheduleId = await api.createSchedule(buildSchedulePayload(input, payeeId));
  let categoryApplied = false;
  if (input.categoryId !== undefined && input.categoryId !== '') {
    await api.createRule(buildCategoryRulePayload(payeeId, input.categoryId));
    categoryApplied = true;
  }
  return { scheduleId, payeeId, payeeCreated, categoryApplied };
}

/** Opens the user's budget, creates the schedule, and always closes the session. */
export function createActualSchedule(
  deps: ActualSessionDeps,
  userId: string,
  input: CreateScheduleInput,
): Promise<CreateScheduleResult> {
  return withActualSession(deps, userId, (api) => createScheduleOnApi(api, input));
}

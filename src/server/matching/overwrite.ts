/**
 * Overwrite actions for a drifted pair (#54, #223): `overwrite_wallos` writes the Actual schedule's values
 * into the Wallos subscription, `overwrite_actual` writes the Wallos subscription's values into the
 * Actual schedule. Orchestration only, no HTTP. Wallos, Actual and the repo are injected so tests
 * use mocks.
 *
 * Order, for both: read both sides, refuse range and pattern schedules, build the changed fields,
 * SNAPSHOT the target record in overwrite_snapshots, write, re-read both sides and store
 * server-computed hashes with status LINKED. Nothing from the client is used except the match id.
 * Amounts are converted between float and integer cents here and in the helpers it calls, never in
 * the browser. Nothing logs, and no error carries a name, an amount or a credential.
 */
import type { APIScheduleEntity } from '@actual-app/api/models';
import { actualToWallos, FrequencyMappingError } from '../../lib/frequency-mapper.js';
import { currencyExponent } from '../../lib/currency-exponent.js';
import { toActualCents } from '../../lib/money.js';
import type { UserRepo } from '../db/repo.js';
import { CreateFlowError, type CreateDeps } from '../integrations/create.js';
import { ActualWriteError } from '../integrations/actual/write.js';
import { readBaseCurrency, readSchedules } from '../integrations/actual/read.js';
import {
  prepareActualScheduleInput,
  prepareWallosSubscriptionPayload,
} from '../integrations/prepare.js';
import { buildCurrencyMap, mapWallosSubscription, resolveCurrencyCode } from '../integrations/wallos/map.js';
import type { WallosSubscriptionUpdate } from '../integrations/wallos/write.js';
import { normalizeMatchFields, type MatchFieldsInput } from '../../lib/match-fields.js';
import { hashMatchFields } from './hash.js';
import { readCurrentSides } from './sync-check.js';

type MatchRow = NonNullable<ReturnType<UserRepo['getMatch']>>;

export type OverwriteDeps = Pick<CreateDeps, 'wallos' | 'repoFor' | 'withActual'>;

/** The re-read after the write could not be hashed. The write has happened; the match is left as it was. */
export class OverwriteReadbackError extends Error {
  constructor() {
    super('Could not verify the pair after the overwrite');
    this.name = 'OverwriteReadbackError';
  }
}

/**
 * `written`: the target was changed and the match is LINKED. `no_change_needed`: nothing differed,
 * nothing was written, the match is untouched. `currency_changed_other_fields_differ` (#223, only
 * `overwrite_wallos_currency`): currency and price were written but another compared field still
 * differs, so the match stays MISMATCH_DETECTED.
 */
export type OverwriteOutcome = 'written' | 'no_change_needed' | 'currency_changed_other_fields_differ';

// Per-process guard only: a multi-process deployment would need a DB-level guard (e.g. a conditional status update).
/** Matches with an overwrite in progress in this process, so a double confirm cannot run twice. */
const inFlight = new Set<string>();

/**
 * Runs `body` only if no overwrite of this match is running, and only while the match is still
 * MISMATCH_DETECTED. The status is re-read here, not taken from the caller's earlier read.
 */
async function guarded(
  deps: OverwriteDeps,
  userId: string,
  matchId: string,
  body: () => Promise<OverwriteOutcome>,
): Promise<OverwriteOutcome> {
  const key = `${userId}:${matchId}`;
  if (inFlight.has(key)) throw new CreateFlowError('invalid_state');
  inFlight.add(key);
  try {
    // A confirm that arrives after another one finished sees LINKED here, before any read or write.
    requireMismatch(deps.repoFor(userId), matchId);
    return await body();
  } finally {
    inFlight.delete(key);
  }
}

/** Throws invalid_state unless the match is still MISMATCH_DETECTED. Called right before each snapshot. */
function requireMismatch(repo: ReturnType<OverwriteDeps['repoFor']>, matchId: string): void {
  if (repo.getMatch(matchId)?.status !== 'MISMATCH_DETECTED') throw new CreateFlowError('invalid_state');
}

interface PairIds {
  readonly wallosId: string;
  readonly actualScheduleId: string;
}

function pairOf(match: MatchRow): PairIds {
  if (match.wallosId === null || match.actualScheduleId === null) {
    throw new CreateFlowError('schedule_not_found');
  }
  return { wallosId: match.wallosId, actualScheduleId: match.actualScheduleId };
}

/** Refuses range and pattern schedules, returns the recurrence and the integer-cent amount. */
function requireSingleAmountSchedule(schedule: APIScheduleEntity): {
  amount: number;
  recurrence: Exclude<APIScheduleEntity['date'], string>;
} {
  const amount: unknown = schedule.amount;
  if (schedule.amountOp === 'isbetween' || typeof amount !== 'number' || !Number.isSafeInteger(amount)) {
    throw new CreateFlowError('range_amount_unsupported');
  }
  const date: unknown = schedule.date;
  if (typeof date !== 'object' || date === null) {
    throw new FrequencyMappingError('invalid_frequency', 'schedule has no recurrence rule');
  }
  const recurrence = schedule.date as Exclude<APIScheduleEntity['date'], string>;
  // Throws FrequencyMappingError('patterns_unsupported') for a pattern schedule.
  actualToWallos({
    frequency: recurrence.frequency,
    ...(recurrence.interval === undefined ? {} : { interval: recurrence.interval }),
    ...(recurrence.patterns === undefined ? {} : { patterns: recurrence.patterns }),
  });
  return { amount, recurrence };
}

/** Re-reads both sides, hashes them on the server and stores LINKED. Never uses client values. */
async function rehashAndLink(deps: OverwriteDeps, userId: string, match: MatchRow): Promise<void> {
  const { wallosId, actualScheduleId } = pairOf(match);
  const current = await readCurrentSides(deps, userId);
  const wf = current.wallosSides.get(wallosId)?.fields ?? null;
  const af = current.actualSides.get(actualScheduleId)?.fields ?? null;
  const wallosHash = wf === null ? null : hashMatchFields(wf);
  const actualHash = af === null ? null : hashMatchFields(af);
  if (wallosHash === null || actualHash === null) throw new OverwriteReadbackError();
  deps
    .repoFor(userId)
    .updateMatch(match.id, { status: 'LINKED', lastKnownWallosHash: wallosHash, lastKnownActualHash: actualHash });
}

interface ActualRead {
  readonly schedule: APIScheduleEntity | undefined;
  readonly baseCode: string | null;
}

function readActual(deps: OverwriteDeps, userId: string, scheduleId: string): Promise<ActualRead> {
  return deps.withActual(userId, async (api) => ({
    schedule: (await readSchedules(api)).find((s) => s.id === scheduleId),
    baseCode: await readBaseCurrency(api),
  }));
}

/** Actual -> Wallos. Sends `id`, `next_payment` (the stored one) and only the fields that differ. */
export function overwriteWallos(deps: OverwriteDeps, userId: string, match: MatchRow, now: Date): Promise<OverwriteOutcome> {
  return guarded(deps, userId, match.id, () => doOverwriteWallos(deps, userId, match, now));
}

async function doOverwriteWallos(deps: OverwriteDeps, userId: string, match: MatchRow, now: Date): Promise<OverwriteOutcome> {
  const { wallosId, actualScheduleId } = pairOf(match);
  const repo = deps.repoFor(userId);
  const [subscriptions, currencies, actual] = await Promise.all([
    deps.wallos.listSubscriptions(userId),
    deps.wallos.listCurrencies(userId),
    readActual(deps, userId, actualScheduleId),
  ]);
  const raw = subscriptions.find((s) => String(s.id) === wallosId);
  if (raw === undefined) throw new CreateFlowError('wallos_subscription_not_found');
  if (actual.schedule === undefined) throw new CreateFlowError('schedule_not_found');
  if (actual.baseCode === null) throw new CreateFlowError('base_currency_missing');
  const { amount, recurrence } = requireSingleAmountSchedule(actual.schedule);

  const currencyMap = buildCurrencyMap(currencies);
  const current = mapWallosSubscription(raw, currencyMap);
  const exponent = currencyExponent(resolveCurrencyCode(currencyMap, current.currencyId));
  const override = repo.getSubscriptionOverride(wallosId);
  // The subscription keeps its own currency; the Actual cents are converted into it.
  const desired = prepareWallosSubscriptionPayload(
    {
      name: actual.schedule.name ?? '',
      priceCents: amount,
      currencyId: current.currencyId,
      recurrence: {
        frequency: recurrence.frequency,
        ...(recurrence.interval === undefined ? {} : { interval: recurrence.interval }),
      },
      startDate: recurrence.start,
      nextPaymentDate: current.nextPaymentDate,
    },
    currencies,
    actual.baseCode,
    override?.rate,
  );

  const storedCents = toActualCents(Number(raw.price), { expense: true, exponent });
  const desiredCents = toActualCents(Number(desired.price), { expense: true, exponent });
  const changed: { -readonly [K in keyof WallosSubscriptionUpdate]: WallosSubscriptionUpdate[K] } = {
    next_payment: desired.next_payment,
  };
  if (desired.name !== current.name.trim()) changed.name = desired.name;
  if (desiredCents !== storedCents) changed.price = desired.price;
  if (Number(desired.cycle) !== Number(raw.cycle)) changed.cycle = desired.cycle;
  if (Number(desired.frequency) !== Number(raw.frequency)) changed.frequency = desired.frequency;
  if (desired.start_date !== undefined && desired.start_date !== raw.start_date) {
    changed.start_date = desired.start_date;
  }

  // Only next_payment left: nothing differs, so nothing is written, no snapshot, and the match stays as it is.
  if (Object.keys(changed).length <= 1) return 'no_change_needed';
  requireMismatch(repo, match.id);
  repo.insertOverwriteSnapshot({
    matchId: match.id,
    target: 'wallos',
    targetId: wallosId,
    valuesJson: JSON.stringify(raw),
    now,
  });
  await deps.wallos.updateSubscription(userId, wallosId, changed);
  await rehashAndLink(deps, userId, match);
  return 'written';
}

/** Wallos -> Actual. Sends only the schedule fields that differ, then syncs. */
export function overwriteActual(deps: OverwriteDeps, userId: string, match: MatchRow, now: Date): Promise<OverwriteOutcome> {
  return guarded(deps, userId, match.id, () => doOverwriteActual(deps, userId, match, now));
}

async function doOverwriteActual(deps: OverwriteDeps, userId: string, match: MatchRow, now: Date): Promise<OverwriteOutcome> {
  const { wallosId, actualScheduleId } = pairOf(match);
  const repo = deps.repoFor(userId);
  const [subscriptions, currencies] = await Promise.all([
    deps.wallos.listSubscriptions(userId),
    deps.wallos.listCurrencies(userId),
  ]);
  const raw = subscriptions.find((s) => String(s.id) === wallosId);
  if (raw === undefined) throw new CreateFlowError('wallos_subscription_not_found');
  const override = repo.getSubscriptionOverride(wallosId);

  const changedAny = await deps.withActual(userId, async (api): Promise<boolean> => {
    const schedule = (await readSchedules(api)).find((s) => s.id === actualScheduleId);
    const baseCode = await readBaseCurrency(api);
    if (schedule === undefined) throw new CreateFlowError('schedule_not_found');
    if (baseCode === null) throw new CreateFlowError('base_currency_missing');
    const { amount, recurrence } = requireSingleAmountSchedule(schedule);

    const desired = prepareActualScheduleInput(mapWallosSubscription(raw, buildCurrencyMap(currencies)), currencies, baseCode, override?.rate);
    const fields: Partial<APIScheduleEntity> = {};
    if (desired.name !== schedule.name) fields.name = desired.name;
    if (desired.amountCents !== amount) fields.amount = desired.amountCents;
    const wantInterval = desired.recurrence.interval ?? 1;
    if (
      desired.recurrence.frequency !== recurrence.frequency ||
      wantInterval !== (recurrence.interval ?? 1) ||
      desired.startDate !== recurrence.start
    ) {
      // The date condition is replaced whole, so keep the keys we do not manage (skipWeekend, end mode).
      fields.date = {
        ...recurrence,
        frequency: desired.recurrence.frequency,
        interval: wantInterval,
        start: desired.startDate,
      };
    }
    if (Object.keys(fields).length === 0) return false;

    requireMismatch(repo, match.id);
    repo.insertOverwriteSnapshot({
      matchId: match.id,
      target: 'actual',
      targetId: actualScheduleId,
      valuesJson: JSON.stringify(schedule),
      now,
    });
    try {
      // A changed start date or frequency needs the next due date recomputed.
      if (fields.date === undefined) await api.updateSchedule(actualScheduleId, fields);
      else await api.updateSchedule(actualScheduleId, fields, true);
    } catch {
      // For example a name another schedule already uses. The library message is never passed on.
      throw new ActualWriteError('Could not update the Actual schedule');
    }
    try {
      await api.sync();
    } catch {
      throw new ActualWriteError('Could not sync the schedule to the Actual server', 'sync_failed');
    }
    return true;
  });
  if (!changedAny) return 'no_change_needed';
  await rehashAndLink(deps, userId, match);
  return 'written';
}

/**
 * #223 Actual -> Wallos, currency too. Sets the subscription's `currency_id` to the Wallos id of the
 * Actual BUDGET currency and its price to the Actual amount in that currency (no rate is involved:
 * the amount is already in that currency, so a rate change cannot move it). Nothing is written to
 * Actual. Refuses before any write, with no snapshot, when the budget currency is not in the
 * user's Wallos currency list (`wallos_currency_missing`; Walley never adds a currency) or has no
 * Wallos rate (CurrencyConversionError, since the re-read could not convert the pair). Like the
 * other overwrites, a snapshot of the unchanged record stays if the Wallos write itself fails.
 */
export function overwriteWallosCurrency(deps: OverwriteDeps, userId: string, match: MatchRow, now: Date): Promise<OverwriteOutcome> {
  return guarded(deps, userId, match.id, () => doOverwriteWallosCurrency(deps, userId, match, now));
}

async function doOverwriteWallosCurrency(deps: OverwriteDeps, userId: string, match: MatchRow, now: Date): Promise<OverwriteOutcome> {
  const { wallosId, actualScheduleId } = pairOf(match);
  const repo = deps.repoFor(userId);
  const [subscriptions, currencies, actual] = await Promise.all([
    deps.wallos.listSubscriptions(userId),
    deps.wallos.listCurrencies(userId),
    readActual(deps, userId, actualScheduleId),
  ]);
  const raw = subscriptions.find((s) => String(s.id) === wallosId);
  if (raw === undefined) throw new CreateFlowError('wallos_subscription_not_found');
  if (actual.schedule === undefined) throw new CreateFlowError('schedule_not_found');
  if (actual.baseCode === null) throw new CreateFlowError('base_currency_missing');
  const { amount, recurrence } = requireSingleAmountSchedule(actual.schedule);

  const baseCode = actual.baseCode.trim().toUpperCase();
  const target = currencies.filter((c) => c.code.trim().toUpperCase() === baseCode).at(-1);
  if (target === undefined) throw new CreateFlowError('wallos_currency_missing');
  const targetId = String(target.id);

  const currencyMap = buildCurrencyMap(currencies);
  const current = mapWallosSubscription(raw, currencyMap);
  // Identity conversion (budget currency to itself). Throws CurrencyConversionError('missing_rate')
  // when the budget currency has no Wallos rate, before anything is written.
  const desired = prepareWallosSubscriptionPayload(
    {
      name: current.name,
      priceCents: amount,
      currencyId: targetId,
      recurrence: {
        frequency: recurrence.frequency,
        ...(recurrence.interval === undefined ? {} : { interval: recurrence.interval }),
      },
      startDate: recurrence.start,
      nextPaymentDate: current.nextPaymentDate,
    },
    currencies,
    baseCode,
  );

  // Same code on an earlier duplicate id counts as the budget currency: no needless currency rewrite.
  const sameCurrency = currencyMap.get(current.currencyId) === baseCode;
  const exponent = currencyExponent(baseCode);
  const samePrice =
    sameCurrency && toActualCents(Number(raw.price), { expense: true, exponent }) === toActualCents(Number(desired.price), { expense: true, exponent });
  if (samePrice) return 'no_change_needed';

  requireMismatch(repo, match.id);
  repo.insertOverwriteSnapshot({
    matchId: match.id,
    target: 'wallos',
    targetId: wallosId,
    valuesJson: JSON.stringify(raw),
    now,
  });
  await deps.wallos.updateSubscription(userId, wallosId, {
    next_payment: desired.next_payment,
    ...(sameCurrency ? {} : { currency_id: desired.currency_id }),
    price: desired.price,
  });
  return rehashAfterCurrency(deps, userId, match);
}

/** Compared fields other than the amount whose canonical values differ (name, currency, frequency, interval, start date). */
function otherFieldsDiffering(w: MatchFieldsInput, a: MatchFieldsInput): (keyof MatchFieldsInput)[] {
  const wn = normalizeMatchFields(w);
  const an = normalizeMatchFields(a);
  if (wn === null || an === null) return ['patterns'];
  const keys = ['name', 'currency', 'frequency', 'interval', 'startDate'] as const;
  return keys.filter((k) => wn[k] !== an[k]);
}

/**
 * After the currency write: re-read both sides. If every compared field but the amount agrees, store
 * both server hashes and LINKED (as the other overwrites). Otherwise the pair stays MISMATCH_DETECTED
 * and only the Wallos hash moves, to a baseline that is the re-read Wallos fields with each
 * still-differing field set to the Actual value. The Actual hash is untouched. At the next check:
 * the currency and amount change is not drift (it is in the baseline), the still-differing field is
 * (current Wallos hash differs from that baseline), and the pair stays a mismatch until the user
 * fixes that field (then current equals baseline and it returns to LINKED) or resolves it.
 * Storing the plain current Wallos hash instead would hide a difference that only Wallos drifted.
 */
async function rehashAfterCurrency(deps: OverwriteDeps, userId: string, match: MatchRow): Promise<OverwriteOutcome> {
  const { wallosId, actualScheduleId } = pairOf(match);
  const current = await readCurrentSides(deps, userId);
  const wf = current.wallosSides.get(wallosId)?.fields ?? null;
  const af = current.actualSides.get(actualScheduleId)?.fields ?? null;
  if (wf === null || af === null) throw new OverwriteReadbackError();
  const differing = otherFieldsDiffering(wf, af);
  if (differing.length === 0) {
    const wallosHash = hashMatchFields(wf);
    const actualHash = hashMatchFields(af);
    if (wallosHash === null || actualHash === null) throw new OverwriteReadbackError();
    deps
      .repoFor(userId)
      .updateMatch(match.id, { status: 'LINKED', lastKnownWallosHash: wallosHash, lastKnownActualHash: actualHash });
    return 'written';
  }
  const baseline: MatchFieldsInput = { ...wf };
  const mutable = baseline as { -readonly [K in keyof MatchFieldsInput]: MatchFieldsInput[K] };
  for (const k of differing) {
    if (k === 'name') mutable.name = af.name;
    else if (k === 'currency') mutable.currency = af.currency;
    else if (k === 'frequency') mutable.frequency = af.frequency;
    else if (k === 'interval') mutable.interval = af.interval ?? 1;
    else if (k === 'startDate') mutable.startDate = af.startDate;
  }
  const wallosHash = hashMatchFields(baseline);
  if (wallosHash === null) throw new OverwriteReadbackError();
  deps.repoFor(userId).updateMatch(match.id, { status: 'MISMATCH_DETECTED', lastKnownWallosHash: wallosHash });
  return 'currency_changed_other_fields_differ';
}

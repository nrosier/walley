/**
 * Sync Check (#39), with auto-link of saved pairs (#35) and mismatch detection (#38).
 * Orchestration only, no HTTP. Wallos, Actual, the repo and the clock are injected so tests use
 * fakes. Every read and write goes through the caller's user-scoped repo. Nothing here logs, and
 * no error carries a name or an amount.
 */
import { actualToWallos, FrequencyMappingError } from '../../lib/frequency-mapper.js';
import { CurrencyConversionError } from '../../lib/currency-convert.js';
import { amountWithinTolerance, DEFAULT_TOLERANCE_PERCENT, rangeMidpointCents } from '../../lib/amount-match.js';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { NAME_MATCH_THRESHOLD, nameScore } from '../../lib/name-match.js';
import type { MatchStatus } from '../../lib/match-status.js';
import type { MatchPatch } from '../db/repo.js';
import { CreateFlowError, type CreateDeps } from '../integrations/create.js';
import { readBaseCurrency, readSchedules } from '../integrations/actual/read.js';
import { prepareActualScheduleInput } from '../integrations/prepare.js';
import { mapWallosSubscription, WallosMappingError } from '../integrations/wallos/map.js';
import { classifySavedPairs, type PairClassification } from './engine.js';
import { detectMismatches } from './mismatch.js';

export interface SyncCheckDeps extends Pick<CreateDeps, 'wallos' | 'repoFor' | 'withActual'> {
  /** Clock in ms since the epoch. */
  readonly now: () => number;
}

export type UnmappableReason =
  | 'patterns_unsupported'
  | 'no_recurrence'
  | 'invalid_recurrence'
  | 'invalid_amount'
  | 'mapping_failed'
  | 'currency_conversion_failed';

/** An item on one side. `amountCents` is in the base currency (range: the midpoint), null when unmappable. */
export interface SyncItem {
  readonly id: string;
  /** Display text only. */
  readonly name: string;
  readonly amountCents: number | null;
  readonly isRange: boolean;
  readonly reason: UnmappableReason | null;
}

export interface SyncCandidate {
  readonly wallosId: string;
  readonly actualScheduleId: string;
  readonly nameScore: number;
  readonly wallosName: string;
  readonly actualName: string;
  readonly wallosAmountCents: number;
  readonly actualAmountCents: number;
  readonly isRange: boolean;
}

export interface SyncMismatch {
  readonly wallosId: string;
  readonly actualScheduleId: string;
  readonly wallosName: string;
  readonly actualName: string;
  readonly wallosAmountCents: number;
  readonly actualAmountCents: number;
  readonly isRange: boolean;
  readonly wallosDrift: boolean;
  readonly actualDrift: boolean;
}

export interface SyncUnmappable {
  readonly side: 'wallos' | 'actual';
  readonly id: string;
  readonly name: string;
  readonly reason: UnmappableReason;
}

export interface SyncOrphaned {
  readonly wallosId: string;
  readonly actualScheduleId: string;
  readonly classification: Exclude<PairClassification, 'linked'>;
  readonly status: MatchStatus;
}

export interface SyncCheckResult {
  readonly checkedAt: string;
  readonly unlinkedWallos: SyncItem[];
  readonly unlinkedActual: SyncItem[];
  readonly candidates: SyncCandidate[];
  readonly mismatches: SyncMismatch[];
  readonly unmappable: SyncUnmappable[];
  readonly orphaned: SyncOrphaned[];
}

interface Side extends SyncItem {
  readonly fields: MatchFieldsInput | null;
}

function mapActual(
  schedule: Awaited<ReturnType<typeof readSchedules>>[number],
  baseCode: string,
): Side {
  const name = schedule.name ?? '';
  const bad = (reason: UnmappableReason, isRange = false): Side => ({
    id: schedule.id,
    name,
    amountCents: null,
    isRange,
    reason,
    fields: null,
  });
  const date: unknown = schedule.date;
  if (typeof date !== 'object' || date === null) return bad('no_recurrence');
  const recurrence = schedule.date as Exclude<typeof schedule.date, string>;
  try {
    actualToWallos({
      frequency: recurrence.frequency,
      ...(recurrence.interval === undefined ? {} : { interval: recurrence.interval }),
      ...(recurrence.patterns === undefined ? {} : { patterns: recurrence.patterns }),
    });
  } catch (error: unknown) {
    if (error instanceof FrequencyMappingError) {
      return bad(error.code === 'patterns_unsupported' ? 'patterns_unsupported' : 'invalid_recurrence');
    }
    throw error;
  }
  const amount: unknown = schedule.amount;
  let match: MatchFieldsInput['amount'];
  let cents: number;
  let isRange = false;
  if (typeof amount === 'number' && Number.isSafeInteger(amount)) {
    match = { kind: 'single', cents: amount };
    cents = amount;
  } else if (typeof amount === 'object' && amount !== null) {
    const { num1, num2 } = amount as { num1?: unknown; num2?: unknown };
    if (!Number.isSafeInteger(num1) || !Number.isSafeInteger(num2)) return bad('invalid_amount');
    match = { kind: 'range', num1: num1 as number, num2: num2 as number };
    cents = rangeMidpointCents(num1 as number, num2 as number);
    isRange = true;
  } else {
    return bad('invalid_amount');
  }
  return {
    id: schedule.id,
    name,
    amountCents: cents,
    isRange,
    reason: null,
    fields: {
      name,
      amount: match,
      frequency: recurrence.frequency,
      ...(recurrence.interval === undefined ? {} : { interval: recurrence.interval }),
      currency: baseCode,
      startDate: recurrence.start,
    },
  };
}

export async function runSyncCheck(deps: SyncCheckDeps, userId: string): Promise<SyncCheckResult> {
  const repo = deps.repoFor(userId);
  const tolerance = repo.getConfig()?.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT;
  const rows = repo.listMatches();
  const overrides = new Map(repo.listSubscriptionOverrides().map((o) => [o.wallosSubscriptionId, o.rate]));

  const [subscriptions, currencies] = await Promise.all([
    deps.wallos.listSubscriptions(userId),
    deps.wallos.listCurrencies(userId),
  ]);
  const actual = await deps.withActual(userId, async (api) => ({
    schedules: await readSchedules(api),
    baseCode: await readBaseCurrency(api),
  }));
  if (actual.baseCode === null) throw new CreateFlowError('base_currency_missing');
  const baseCode = actual.baseCode.trim().toUpperCase();

  const wallosSides = new Map<string, Side>();
  for (const raw of subscriptions) {
    const id = String(raw.id);
    let side: Side;
    try {
      const mapped = mapWallosSubscription(raw);
      const prepared = prepareActualScheduleInput(mapped, currencies, baseCode, overrides.get(id));
      side = {
        id,
        name: mapped.name,
        amountCents: prepared.amountCents,
        isRange: false,
        reason: null,
        fields: {
          name: mapped.name,
          amount: { kind: 'single', cents: prepared.amountCents },
          frequency: prepared.recurrence.frequency,
          ...(prepared.recurrence.interval === undefined ? {} : { interval: prepared.recurrence.interval }),
          currency: baseCode,
          startDate: prepared.startDate,
        },
      };
    } catch (error: unknown) {
      if (!(error instanceof WallosMappingError || error instanceof CurrencyConversionError)) throw error;
      const name = typeof raw.name === 'string' ? raw.name : '';
      side = {
        id,
        name,
        amountCents: null,
        isRange: false,
        reason: error instanceof WallosMappingError ? 'mapping_failed' : 'currency_conversion_failed',
        fields: null,
      };
    }
    wallosSides.set(id, side);
  }
  const actualSides = new Map<string, Side>();
  for (const schedule of actual.schedules) {
    actualSides.set(schedule.id, mapActual(schedule, baseCode));
  }

  // #35: saved pairs are classified on every run; nothing about them needs user action.
  const classified = classifySavedPairs(
    rows.map((r) => ({ wallosId: r.wallosId, actualScheduleId: r.actualScheduleId, status: r.status })),
    [...wallosSides.keys()],
    [...actualSides.keys()],
  );

  // #38: only hashable sides are compared; the rest keep status and stored hashes.
  const fieldsOf = (sides: Map<string, Side>): Map<string, MatchFieldsInput> => {
    const out = new Map<string, MatchFieldsInput>();
    for (const [id, s] of sides) if (s.fields !== null) out.set(id, s.fields);
    return out;
  };
  const drift = detectMismatches(rows, fieldsOf(wallosSides), fieldsOf(actualSides));
  const rowByPair = new Map(rows.map((r) => [`${r.wallosId ?? ''}\u0000${r.actualScheduleId ?? ''}`, r]));
  const mismatches: SyncMismatch[] = [];
  for (const r of drift.results) {
    const row = rowByPair.get(`${r.wallosId}\u0000${r.actualScheduleId}`);
    if (row === undefined) continue;
    const patch: MatchPatch = {};
    if (r.nextStatus !== row.status) patch.status = r.nextStatus;
    if (r.wallosHash !== row.lastKnownWallosHash) patch.lastKnownWallosHash = r.wallosHash;
    if (r.actualHash !== row.lastKnownActualHash) patch.lastKnownActualHash = r.actualHash;
    if (Object.keys(patch).length > 0) repo.updateMatch(row.id, patch);
    const w = wallosSides.get(r.wallosId);
    const a = actualSides.get(r.actualScheduleId);
    if (r.nextStatus === 'MISMATCH_DETECTED' && w !== undefined && a !== undefined) {
      mismatches.push({
        wallosId: r.wallosId,
        actualScheduleId: r.actualScheduleId,
        wallosName: w.name,
        actualName: a.name,
        wallosAmountCents: w.amountCents ?? 0,
        actualAmountCents: a.amountCents ?? 0,
        isRange: a.isRange,
        wallosDrift: r.wallosDrift,
        actualDrift: r.actualDrift,
      });
    }
  }

  const unlinkedWallos = classified.unlinkedWallosIds.flatMap((id) => wallosSides.get(id) ?? []);
  const unlinkedActual = classified.unlinkedActualIds.flatMap((id) => actualSides.get(id) ?? []);
  const toItem = ({ id, name, amountCents, isRange, reason }: Side): SyncItem => ({
    id,
    name,
    amountCents,
    isRange,
    reason,
  });

  // A candidate must pass BOTH the name and the amount rule.
  const candidates: SyncCandidate[] = [];
  for (const w of unlinkedWallos) {
    if (w.amountCents === null) continue;
    for (const a of unlinkedActual) {
      if (a.amountCents === null) continue;
      const score = nameScore(w.name, a.name);
      if (score < NAME_MATCH_THRESHOLD) continue;
      if (!amountWithinTolerance(w.amountCents, a.amountCents, tolerance)) continue;
      candidates.push({
        wallosId: w.id,
        actualScheduleId: a.id,
        nameScore: score,
        wallosName: w.name,
        actualName: a.name,
        wallosAmountCents: w.amountCents,
        actualAmountCents: a.amountCents,
        isRange: a.isRange,
      });
    }
  }
  candidates.sort((x, y) => y.nameScore - x.nameScore);

  const unmappable: SyncUnmappable[] = [];
  for (const [side, sides] of [['wallos', wallosSides], ['actual', actualSides]] as const) {
    for (const s of sides.values()) {
      if (s.reason !== null) unmappable.push({ side, id: s.id, name: s.name, reason: s.reason });
    }
  }

  const orphaned: SyncOrphaned[] = classified.pairs.flatMap((p) =>
    p.classification === 'linked'
      ? []
      : [
          {
            wallosId: p.wallosId,
            actualScheduleId: p.actualScheduleId,
            classification: p.classification,
            status: p.savedStatus,
          },
        ],
  );

  return {
    checkedAt: new Date(deps.now()).toISOString(),
    unlinkedWallos: unlinkedWallos.map(toItem),
    unlinkedActual: unlinkedActual.map(toItem),
    candidates,
    mismatches,
    unmappable,
    orphaned,
  };
}

/**
 * Sync Check (#39), with auto-link of saved pairs (#35) and mismatch detection (#38).
 * Orchestration only, no HTTP. Wallos, Actual, the repo and the clock are injected so tests use
 * fakes. Every read and write goes through the caller's user-scoped repo. Nothing here logs, and
 * no error carries a name or an amount.
 */
import { billingCycleOf } from '../../lib/billing-cycle.js';
import { actualToWallos, FrequencyMappingError } from '../../lib/frequency-mapper.js';
import { CurrencyConversionError } from '../../lib/currency-convert.js';
import { amountWithinTolerance, DEFAULT_TOLERANCE_PERCENT, rangeMidpointCents } from '../../lib/amount-match.js';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { NAME_MATCH_THRESHOLD, nameScore } from '../../lib/name-match.js';
import type {
  SyncCandidate,
  SyncCheckResult,
  SyncIgnored,
  SyncItem,
  SyncLinked,
  SyncMismatch,
  SyncMismatchFields,
  SyncOrphanKind,
  SyncOrphaned,
  SyncUnmappable,
  UnmappableReason,
} from '../../lib/sync-check-types.js';
import type { MatchPatch } from '../db/repo.js';
import { CreateFlowError, type CreateDeps } from '../integrations/create.js';
import type { WallosClient } from '../integrations/wallos/client.js';
import { readBaseCurrency, readSchedules } from '../integrations/actual/read.js';
import { prepareActualScheduleInput } from '../integrations/prepare.js';
import {
  buildCurrencyMap,
  decodeWallosName,
  legacyWallosNameFields,
  mapWallosSubscription,
  WallosMappingError,
} from '../integrations/wallos/map.js';
import type { UpstreamCache } from '../cache/upstream-cache.js';
import { classifySavedPairs } from './engine.js';
import { detectMismatches } from './mismatch.js';

export interface SyncCheckDeps extends Pick<CreateDeps, 'wallos' | 'repoFor' | 'withActual'> {
  /** Clock in ms since the epoch. */
  readonly now: () => number;
  /** Per-user cache of upstream reads (five minutes). Absent: every read is live. */
  readonly cache?: UpstreamCache;
}

/** Options for a read. Only the sync check passes a cache; every write path reads live. */
export interface CurrentSidesOptions {
  /** When set, Wallos and Actual reads go through this cache. Writes never pass it. */
  readonly cache?: UpstreamCache;
  /** With `cache`: ignore cached data and store the fresh read in its place. */
  readonly refresh?: boolean;
}

export type {
  SyncCandidate,
  SyncCheckResult,
  SyncIgnored,
  SyncItem,
  SyncLinked,
  SyncMismatch,
  SyncOrphaned,
  SyncOrphanKind,
  SyncUnmappable,
  UnmappableReason,
} from '../../lib/sync-check-types.js';

export interface Side extends SyncItem {
  readonly fields: MatchFieldsInput | null;
  /** Wallos sides only: the fields as 0.2.0 hashed them (raw, still-escaped name). See legacyWallosNameFields. */
  readonly legacyFields?: MatchFieldsInput | null;
  /**
   * Wallos sides only: the next_payment date used as the hash start date because Wallos has no
   * start_date and no anchor was stored yet. A caller that creates the match row stores it as the
   * anchor. Null or absent when start_date or a stored anchor was used.
   */
  readonly anchorDate?: string | null;
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

export interface CurrentSides {
  readonly wallosSides: Map<string, Side>;
  readonly actualSides: Map<string, Side>;
  /** Actual base currency code, trimmed and upper case. */
  readonly baseCode: string;
}

/** Keeps only the sides that can be hashed (no pattern schedules, no unmappable Wallos items). */
export function fieldInputsOf(sides: ReadonlyMap<string, Side>): Map<string, MatchFieldsInput> {
  const out = new Map<string, MatchFieldsInput>();
  for (const [id, s] of sides) if (s.fields !== null) out.set(id, s.fields);
  return out;
}

function mismatchFieldsOf(f: MatchFieldsInput): SyncMismatchFields {
  return {
    frequency: f.frequency,
    interval: f.interval ?? 1,
    startDate: f.startDate,
    currency: f.currency,
    amount: f.amount,
  };
}

/**
 * Lists Wallos subscriptions and currencies and reads Actual schedules and the base currency,
 * then maps every item to its current comparable fields. Shared by the Sync Check and by
 * ignore_diff so both hash exactly the same values. The only write is the H14 anchor: a match row
 * whose Wallos item has no start_date and no anchor yet gets its first next_payment stored.
 */
type ActualRead = { readonly schedules: Awaited<ReturnType<typeof readSchedules>>; readonly baseCode: string | null };

/**
 * Reads Wallos (subscriptions, then currencies) and then Actual (one session: schedules and base
 * currency), in the same order as before the cache existed. With a cache, a live entry is used
 * as is; a refresh or a miss reads live and stores the result. A cold Actual read still opens the
 * budget once.
 */
async function readUpstream(
  deps: Pick<SyncCheckDeps, 'wallos' | 'withActual'>,
  userId: string,
  options: CurrentSidesOptions,
): Promise<{
  readonly subscriptions: Awaited<ReturnType<WallosClient['listSubscriptions']>>;
  readonly currencies: Awaited<ReturnType<WallosClient['listCurrencies']>>;
  readonly actual: ActualRead;
}> {
  const cache = options.cache;
  if (cache === undefined) {
    const subscriptions = await deps.wallos.listSubscriptions(userId);
    const currencies = await deps.wallos.listCurrencies(userId);
    const actual = await deps.withActual(userId, async (api) => ({
      schedules: await readSchedules(api),
      baseCode: await readBaseCurrency(api),
    }));
    return { subscriptions, currencies, actual };
  }
  const refresh = options.refresh === true;
  const subscriptions = await cache.getOrFetch(userId, 'wallos-subscriptions', () => deps.wallos.listSubscriptions(userId), { refresh });
  const currencies = await cache.getOrFetch(userId, 'wallos-currencies', () => deps.wallos.listCurrencies(userId), { refresh });
  const cachedSchedules = refresh ? undefined : (cache.peek(userId, 'actual-schedules') as ActualRead['schedules'] | undefined);
  const cachedBase = refresh ? undefined : (cache.peek(userId, 'actual-budget-meta') as string | null | undefined);
  let actual: ActualRead;
  if (cachedSchedules !== undefined && cachedBase !== undefined) {
    actual = { schedules: cachedSchedules, baseCode: cachedBase };
  } else {
    const readAt = cache.generation(userId);
    actual = await deps.withActual(userId, async (api) => ({
      schedules: await readSchedules(api),
      baseCode: await readBaseCurrency(api),
    }));
    cache.put(userId, 'actual-schedules', actual.schedules, readAt);
    cache.put(userId, 'actual-budget-meta', actual.baseCode, readAt);
  }
  return { subscriptions, currencies, actual };
}

export async function readCurrentSides(
  deps: Pick<SyncCheckDeps, 'wallos' | 'repoFor' | 'withActual'>,
  userId: string,
  options: CurrentSidesOptions = {},
): Promise<CurrentSides> {
  const repo = deps.repoFor(userId);
  const anchorRows = new Map<string, { id: string; anchor: string | null }>();
  for (const row of repo.listMatches()) {
    if (row.wallosId !== null) anchorRows.set(row.wallosId, { id: row.id, anchor: row.firstSeenNextPayment });
  }
  const overrides = new Map(
    deps.repoFor(userId).listSubscriptionOverrides().map((o) => [o.wallosSubscriptionId, o.rate]),
  );

  const { subscriptions, currencies, actual } = await readUpstream(deps, userId, options);
  if (actual.baseCode === null) throw new CreateFlowError('base_currency_missing');
  const baseCode = actual.baseCode.trim().toUpperCase();

  const currencyMap = buildCurrencyMap(currencies);
  const wallosSides = new Map<string, Side>();
  for (const raw of subscriptions) {
    const id = String(raw.id);
    let side: Side;
    try {
      const mapped = mapWallosSubscription(raw, currencyMap);
      // H14: with no start_date the hash uses the first next_payment seen (stored on the match
      // row) so it does not move each cycle. A row with no anchor yet gets it written here; an
      // item with no row uses next_payment for this read and the link step stores it.
      let anchorDate: string | null = null;
      let source = mapped;
      if (mapped.startDate === null) {
        const known = anchorRows.get(id);
        if (known?.anchor != null) {
          source = { ...mapped, startDate: known.anchor };
        } else if (mapped.nextPaymentDate !== null) {
          if (known !== undefined && repo.setFirstSeenNextPayment(known.id, mapped.nextPaymentDate)) {
            known.anchor = mapped.nextPaymentDate;
          } else {
            anchorDate = mapped.nextPaymentDate;
          }
        }
      }
      const prepared = prepareActualScheduleInput(source, currencies, baseCode, overrides.get(id));
      const fields: MatchFieldsInput = {
        name: mapped.name,
        amount: { kind: 'single', cents: prepared.amountCents },
        frequency: prepared.recurrence.frequency,
        ...(prepared.recurrence.interval === undefined ? {} : { interval: prepared.recurrence.interval }),
        currency: baseCode,
        startDate: prepared.startDate,
      };
      side = {
        anchorDate,
        id,
        name: mapped.name,
        amountCents: prepared.amountCents,
        isRange: false,
        reason: null,
        fields,
        legacyFields: legacyWallosNameFields(fields, raw.name ?? ''),
      };
    } catch (error: unknown) {
      if (!(error instanceof WallosMappingError || error instanceof CurrencyConversionError)) throw error;
      const name = typeof raw.name === 'string' ? decodeWallosName(raw.name) : '';
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
  return { wallosSides, actualSides, baseCode };
}

/**
 * The candidate rule: both items have an amount, the name score reaches NAME_MATCH_THRESHOLD and
 * the amounts are within `tolerance` percent. Pure. Returns the candidate, or null.
 */
export function isCandidate(
  w: Pick<SyncItem, 'id' | 'name' | 'amountCents'>,
  a: Pick<SyncItem, 'id' | 'name' | 'amountCents' | 'isRange'>,
  tolerance: number,
): SyncCandidate | null {
  if (w.amountCents === null || a.amountCents === null) return null;
  const score = nameScore(w.name, a.name);
  if (score < NAME_MATCH_THRESHOLD) return null;
  if (!amountWithinTolerance(w.amountCents, a.amountCents, tolerance)) return null;
  return {
    wallosId: w.id,
    actualScheduleId: a.id,
    nameScore: score,
    wallosName: w.name,
    actualName: a.name,
    wallosAmountCents: w.amountCents,
    actualAmountCents: a.amountCents,
    isRange: a.isRange,
  };
}

/**
 * Relink candidates for an orphaned row: unlinked items on the missing side that pass isCandidate
 * against the surviving side, best name score first. Empty for linked rows and orphaned_both.
 * Pure; uses only the sides the sync check already read.
 */
function relinkCandidateIdsOf(
  orphan: SyncOrphanKind | null,
  survivorWallos: Side | undefined,
  survivorActual: Side | undefined,
  unlinkedWallos: readonly Side[],
  unlinkedActual: readonly Side[],
  tolerance: number,
): string[] {
  if (orphan === 'orphaned_wallos' && survivorActual !== undefined) {
    const found: SyncCandidate[] = [];
    for (const w of unlinkedWallos) {
      const c = isCandidate(w, survivorActual, tolerance);
      if (c !== null) found.push(c);
    }
    return found.sort((x, y) => y.nameScore - x.nameScore).map((c) => c.wallosId);
  }
  if (orphan === 'orphaned_actual' && survivorWallos !== undefined) {
    const found: SyncCandidate[] = [];
    for (const a of unlinkedActual) {
      const c = isCandidate(survivorWallos, a, tolerance);
      if (c !== null) found.push(c);
    }
    return found.sort((x, y) => y.nameScore - x.nameScore).map((c) => c.actualScheduleId);
  }
  return [];
}

export interface RunSyncCheckOptions {
  /** True bypasses the cache and stores a fresh read. False (default) uses cached upstream data. */
  readonly refresh?: boolean;
}

export async function runSyncCheck(
  deps: SyncCheckDeps,
  userId: string,
  options: RunSyncCheckOptions = {},
): Promise<SyncCheckResult> {
  const repo = deps.repoFor(userId);
  const tolerance = repo.getConfig()?.tolerancePercent ?? DEFAULT_TOLERANCE_PERCENT;
  const rows = repo.listMatches();
  const { wallosSides, actualSides, baseCode } = await readCurrentSides(deps, userId, {
    ...(deps.cache === undefined ? {} : { cache: deps.cache }),
    refresh: options.refresh === true,
  });

  // #35: saved pairs are classified on every run; nothing about them needs user action.
  const classified = classifySavedPairs(
    rows.map((r) => ({ wallosId: r.wallosId, actualScheduleId: r.actualScheduleId, status: r.status })),
    [...wallosSides.keys()],
    [...actualSides.keys()],
  );

  // #38: only hashable sides are compared; the rest keep status and stored hashes.
  const wallosFields = fieldInputsOf(wallosSides);
  const actualFields = fieldInputsOf(actualSides);
  const legacyWallosFields = new Map<string, MatchFieldsInput>();
  for (const [id, s] of wallosSides) if (s.legacyFields) legacyWallosFields.set(id, s.legacyFields);
  const drift = detectMismatches(rows, wallosFields, actualFields, legacyWallosFields);
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
    const wf = wallosFields.get(r.wallosId);
    const af = actualFields.get(r.actualScheduleId);
    if (r.nextStatus === 'MISMATCH_DETECTED' && w !== undefined && a !== undefined && wf !== undefined && af !== undefined) {
      mismatches.push({
        matchId: row.id,
        wallosId: r.wallosId,
        actualScheduleId: r.actualScheduleId,
        wallosName: w.name,
        actualName: a.name,
        wallosAmountCents: w.amountCents ?? 0,
        actualAmountCents: a.amountCents ?? 0,
        isRange: a.isRange,
        wallosDrift: r.wallosDrift,
        actualDrift: r.actualDrift,
        wallosFields: mismatchFieldsOf(wf),
        actualFields: mismatchFieldsOf(af),
      });
    }
  }

  const unlinkedWallos = classified.unlinkedWallosIds.flatMap((id) => wallosSides.get(id) ?? []);
  const unlinkedActual = classified.unlinkedActualIds.flatMap((id) => actualSides.get(id) ?? []);
  // #136: unlinked items only. Both sides reach the same mapping through their hashed fields.
  const toItem = ({ id, name, amountCents, isRange, reason, fields }: Side): SyncItem => {
    const cycle = fields === null ? null : billingCycleOf(fields.frequency, fields.interval);
    return { id, name, amountCents, isRange, reason, ...(cycle === null ? {} : { cycle }) };
  };

  // A candidate must pass BOTH the name and the amount rule.
  const candidates: SyncCandidate[] = [];
  for (const w of unlinkedWallos) {
    for (const a of unlinkedActual) {
      const c = isCandidate(w, a, tolerance);
      if (c !== null) candidates.push(c);
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

  // Read-only display lists. The status is the one just written (or kept) above.
  const nextStatusById = new Map<string, SyncLinked['status']>();
  for (const r of drift.results) {
    const row = rowByPair.get(`${r.wallosId}\u0000${r.actualScheduleId}`);
    if (row !== undefined) nextStatusById.set(row.id, r.nextStatus);
  }
  const classByPair = new Map(classified.pairs.map((p) => [`${p.wallosId}\u0000${p.actualScheduleId}`, p.classification]));
  const linked: SyncLinked[] = [];
  const ignored: SyncIgnored[] = [];
  for (const row of rows) {
    if (row.status === 'LINKED' || row.status === 'MISMATCH_DETECTED') {
      if (row.wallosId === null || row.actualScheduleId === null) continue; // violates the DB side check
      const classification = classByPair.get(`${row.wallosId}\u0000${row.actualScheduleId}`);
      const w = wallosSides.get(row.wallosId);
      const a = actualSides.get(row.actualScheduleId);
      const orphan = classification === undefined || classification === 'linked' ? null : classification;
      linked.push({
        matchId: row.id,
        wallosId: row.wallosId,
        actualScheduleId: row.actualScheduleId,
        status: nextStatusById.get(row.id) ?? row.status,
        orphan,
        wallosName: w?.name ?? null,
        actualName: a?.name ?? null,
        wallosAmountCents: w?.amountCents ?? null,
        actualAmountCents: a?.amountCents ?? null,
        isRange: a?.isRange ?? false,
        relinkCandidateIds: relinkCandidateIdsOf(orphan, w, a, unlinkedWallos, unlinkedActual, tolerance),
      });
    } else {
      const side = row.status === 'IGNORED_WALLOS' ? 'wallos' : 'actual';
      const itemId = side === 'wallos' ? row.wallosId : row.actualScheduleId;
      if (itemId === null) continue; // violates the DB side check
      const item = (side === 'wallos' ? wallosSides : actualSides).get(itemId);
      ignored.push({
        matchId: row.id,
        side,
        itemId,
        name: item?.name ?? null,
        amountCents: item?.amountCents ?? null,
        isRange: item?.isRange ?? false,
        reason: item?.reason ?? null,
      });
    }
  }

  return {
    checkedAt: new Date(deps.now()).toISOString(),
    baseCurrency: baseCode,
    unlinkedWallos: unlinkedWallos.map(toItem),
    unlinkedActual: unlinkedActual.map(toItem),
    candidates,
    mismatches,
    unmappable,
    orphaned,
    linked,
    ignored,
  };
}

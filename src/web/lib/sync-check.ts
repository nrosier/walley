import { useSyncExternalStore } from 'react';
import type {
  SyncCandidate,
  SyncCheckResult,
  SyncIgnored,
  SyncItem,
  UnmappableReason,
} from '../../lib/sync-check-types';
import { ApiError, apiRequest } from './api';
import { ignoreItem, linkPair, restoreMatch } from './matches.api';

export type Side = 'wallos' | 'actual';

/** POST /api/sync/check. Throws ApiError or a network error. */
export function runSyncCheck(fetchImpl?: typeof fetch): Promise<SyncCheckResult> {
  return apiRequest<SyncCheckResult>('/api/sync/check', { method: 'POST', body: {}, fetchImpl });
}

// ---- store: the one place that holds the last result ----

export interface SyncStoreState {
  readonly status: 'idle' | 'loading' | 'ready' | 'error';
  readonly result: SyncCheckResult | null;
  readonly errorCode: string | null;
}

export interface SyncStore {
  getState: () => SyncStoreState;
  subscribe: (listener: () => void) => () => void;
  run: () => Promise<void>;
  setResult: (result: SyncCheckResult) => void;
}

export function createSyncStore(fetchImpl?: typeof fetch): SyncStore {
  let state: SyncStoreState = { status: 'idle', result: null, errorCode: null };
  let runId = 0;
  const listeners = new Set<() => void>();
  const set = (next: SyncStoreState) => {
    state = next;
    listeners.forEach((l) => {
      l();
    });
  };
  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setResult: (result) => {
      set({ status: 'ready', result, errorCode: null });
    },
    run: async () => {
      if (state.status === 'loading') return;
      const id = ++runId;
      set({ ...state, status: 'loading', errorCode: null });
      try {
        const result = await runSyncCheck(fetchImpl);
        if (id === runId) set({ status: 'ready', result, errorCode: null });
      } catch (error: unknown) {
        if (id === runId) {
          set({ ...state, status: 'error', errorCode: error instanceof ApiError ? error.code : 'request_failed' });
        }
      }
    },
  };
}

export const syncStore: SyncStore = createSyncStore();

export function useSyncCheck(store: SyncStore = syncStore): SyncStoreState & Pick<SyncStore, 'run' | 'setResult'> {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  return { ...state, run: store.run, setResult: store.setResult };
}

// ---- pure list logic ----

export interface RowModel {
  readonly id: string;
  readonly name: string;
  readonly amountCents: number | null;
  readonly isRange: boolean;
  readonly reason: UnmappableReason | null;
  readonly ignored: boolean;
  /** Id of the ignore record; null on rows that are not ignored. */
  readonly matchId: string | null;
}

const fromItem = (item: SyncItem): RowModel => ({
  id: item.id,
  name: item.name,
  amountCents: item.amountCents,
  isRange: item.isRange,
  reason: item.reason,
  ignored: false,
  matchId: null,
});

const fromIgnored = (row: SyncIgnored): RowModel => ({
  id: row.itemId,
  name: row.name ?? row.itemId,
  amountCents: row.amountCents,
  isRange: row.isRange,
  reason: row.reason,
  ignored: true,
  matchId: row.matchId,
});

/** Case-insensitive name filter; a blank query keeps every row. */
export function filterRows(rows: readonly RowModel[], query: string): RowModel[] {
  const q = query.trim().toLowerCase();
  return q === '' ? [...rows] : rows.filter((r) => r.name.toLowerCase().includes(q));
}

/** Rows of one column: unlinked items, then ignored ones when asked, filtered by the query. */
export function buildRows(result: SyncCheckResult, side: Side, query: string, showIgnored: boolean): RowModel[] {
  const items = (side === 'wallos' ? result.unlinkedWallos : result.unlinkedActual).map(fromItem);
  const ignored = showIgnored ? result.ignored.filter((r) => r.side === side).map(fromIgnored) : [];
  return filterRows([...items, ...ignored], query);
}

/** Candidates that name this item. Only items with at least one candidate may be linked. */
export function candidatesFor(result: SyncCheckResult, side: Side, id: string): SyncCandidate[] {
  return result.candidates.filter((c) => (side === 'wallos' ? c.wallosId === id : c.actualScheduleId === id));
}

const PENDING = 'pending';

/** Optimistic Link: both items leave the unlinked lists and their candidates go away. */
export function applyLink(result: SyncCheckResult, wallosId: string, actualScheduleId: string): SyncCheckResult {
  const wallos = result.unlinkedWallos.find((i) => i.id === wallosId);
  const actual = result.unlinkedActual.find((i) => i.id === actualScheduleId);
  return {
    ...result,
    unlinkedWallos: result.unlinkedWallos.filter((i) => i.id !== wallosId),
    unlinkedActual: result.unlinkedActual.filter((i) => i.id !== actualScheduleId),
    candidates: result.candidates.filter((c) => c.wallosId !== wallosId && c.actualScheduleId !== actualScheduleId),
    linked: [
      ...result.linked,
      {
        matchId: PENDING,
        wallosId,
        actualScheduleId,
        status: 'LINKED',
        orphan: null,
        wallosName: wallos?.name ?? null,
        actualName: actual?.name ?? null,
        wallosAmountCents: wallos?.amountCents ?? null,
        actualAmountCents: actual?.amountCents ?? null,
        isRange: actual?.isRange ?? false,
      },
    ],
  };
}

/** Optimistic Ignore: the item moves from its unlinked list to ignored[]. */
export function applyIgnore(result: SyncCheckResult, side: Side, itemId: string): SyncCheckResult {
  const list = side === 'wallos' ? result.unlinkedWallos : result.unlinkedActual;
  const item = list.find((i) => i.id === itemId);
  const rest = list.filter((i) => i.id !== itemId);
  return {
    ...result,
    ...(side === 'wallos' ? { unlinkedWallos: rest } : { unlinkedActual: rest }),
    candidates: result.candidates.filter((c) => (side === 'wallos' ? c.wallosId : c.actualScheduleId) !== itemId),
    ignored: [
      ...result.ignored,
      {
        matchId: PENDING,
        side,
        itemId,
        name: item?.name ?? null,
        amountCents: item?.amountCents ?? null,
        isRange: item?.isRange ?? false,
        reason: item?.reason ?? null,
      },
    ],
  };
}

/** Optimistic Restore: the ignored row leaves ignored[] and returns to its unlinked column. */
export function applyRestore(result: SyncCheckResult, matchId: string): SyncCheckResult {
  const row = result.ignored.find((r) => r.matchId === matchId);
  if (row === undefined) return result;
  const item: SyncItem = {
    id: row.itemId,
    name: row.name ?? row.itemId,
    amountCents: row.amountCents,
    isRange: row.isRange,
    reason: row.reason,
  };
  const ignored = result.ignored.filter((r) => r.matchId !== matchId);
  return row.side === 'wallos'
    ? { ...result, ignored, unlinkedWallos: [...result.unlinkedWallos, item] }
    : { ...result, ignored, unlinkedActual: [...result.unlinkedActual, item] };
}

/** Undo an optimistic change by returning the snapshot taken before it. */
export function rollback(_current: SyncCheckResult, snapshot: SyncCheckResult): SyncCheckResult {
  return snapshot;
}

const candidateKey = (c: SyncCandidate) => `${c.wallosId}|${c.actualScheduleId}`;

/** Current rows plus the snapshot rows `want` selects, in snapshot order, then rows only the current list has. */
function mergeBack<T>(
  current: readonly T[],
  snapshot: readonly T[],
  key: (row: T) => string,
  want: (row: T) => boolean,
): T[] {
  const have = new Set(current.map(key));
  const snapKeys = new Set(snapshot.map(key));
  return [
    ...snapshot.filter((r) => have.has(key(r)) || want(r)),
    ...current.filter((r) => !snapKeys.has(key(r))),
  ];
}

/**
 * Undo one action on the current result, touching only the rows that action changed.
 * Changes made by other actions in the meantime stay in place. `snapshot` supplies the
 * original rows.
 */
export function rollbackAction(current: SyncCheckResult, snapshot: SyncCheckResult, action: RowAction): SyncCheckResult {
  const itemKey = (i: SyncItem) => i.id;
  if (action.kind === 'link') {
    const { wallosId, actualScheduleId } = action;
    return {
      ...current,
      unlinkedWallos: mergeBack(current.unlinkedWallos, snapshot.unlinkedWallos, itemKey, (i) => i.id === wallosId),
      unlinkedActual: mergeBack(current.unlinkedActual, snapshot.unlinkedActual, itemKey, (i) => i.id === actualScheduleId),
      candidates: mergeBack(
        current.candidates,
        snapshot.candidates,
        candidateKey,
        (c) => c.wallosId === wallosId || c.actualScheduleId === actualScheduleId,
      ),
      linked: current.linked.filter((l) => !(l.wallosId === wallosId && l.actualScheduleId === actualScheduleId)),
    };
  }
  if (action.kind === 'ignore') {
    const { side, itemId } = action;
    const ignored = current.ignored.filter((r) => !(r.side === side && r.itemId === itemId));
    const candidates = mergeBack(
      current.candidates,
      snapshot.candidates,
      candidateKey,
      (c) => (side === 'wallos' ? c.wallosId : c.actualScheduleId) === itemId,
    );
    return side === 'wallos'
      ? { ...current, ignored, candidates, unlinkedWallos: mergeBack(current.unlinkedWallos, snapshot.unlinkedWallos, itemKey, (i) => i.id === itemId) }
      : { ...current, ignored, candidates, unlinkedActual: mergeBack(current.unlinkedActual, snapshot.unlinkedActual, itemKey, (i) => i.id === itemId) };
  }
  const row = snapshot.ignored.find((r) => r.matchId === action.matchId);
  if (row === undefined) return current;
  const ignored = mergeBack(current.ignored, snapshot.ignored, (r) => r.matchId, (r) => r.matchId === row.matchId);
  return row.side === 'wallos'
    ? { ...current, ignored, unlinkedWallos: current.unlinkedWallos.filter((i) => i.id !== row.itemId) }
    : { ...current, ignored, unlinkedActual: current.unlinkedActual.filter((i) => i.id !== row.itemId) };
}

/** The row to focus after an action removes `id`: the next one, else the previous one, else null. */
export function nextRowId(ids: readonly string[], id: string): string | null {
  const at = ids.indexOf(id);
  if (at === -1) return null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}

export type RowAction =
  | { readonly kind: 'link'; readonly wallosId: string; readonly actualScheduleId: string }
  | { readonly kind: 'ignore'; readonly side: Side; readonly itemId: string }
  | { readonly kind: 'restore'; readonly matchId: string };

export type ActionOutcome = { readonly ok: true } | { readonly ok: false; readonly code: string };

/**
 * Applies the action to the list at once, then sends it. A failure undoes only the rows this
 * action touched and returns the server code. `get` and `set` must read and write the shared
 * store, so overlapping actions see each other's changes.
 */
export async function performAction(
  get: () => SyncCheckResult | null,
  set: (result: SyncCheckResult) => void,
  action: RowAction,
  fetchImpl?: typeof fetch,
): Promise<ActionOutcome> {
  const snapshot = get();
  if (snapshot === null) return { ok: false, code: 'request_failed' };
  if (action.kind === 'link') set(applyLink(snapshot, action.wallosId, action.actualScheduleId));
  else if (action.kind === 'ignore') set(applyIgnore(snapshot, action.side, action.itemId));
  else set(applyRestore(snapshot, action.matchId));
  try {
    if (action.kind === 'link') await linkPair(action.wallosId, action.actualScheduleId, fetchImpl);
    else if (action.kind === 'restore') await restoreMatch(action.matchId, fetchImpl);
    else {
      const created = await ignoreItem(action.side, action.itemId, fetchImpl);
      // Give the optimistic row its real id so it can be restored without a refetch.
      const now = get();
      if (now !== null && typeof created.id === 'string') {
        set({
          ...now,
          ignored: now.ignored.map((r) =>
            r.matchId === PENDING && r.side === action.side && r.itemId === action.itemId
              ? { ...r, matchId: created.id }
              : r,
          ),
        });
      }
    }
    return { ok: true };
  } catch (error: unknown) {
    set(rollbackAction(get() ?? snapshot, snapshot, action));
    return { ok: false, code: error instanceof ApiError ? error.code : 'request_failed' };
  }
}

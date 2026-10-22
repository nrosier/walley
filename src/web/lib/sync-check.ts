import { useSyncExternalStore } from 'react';
import type {
  SyncCandidate,
  SyncCheckResult,
  SyncIgnored,
  SyncItem,
  UnmappableReason,
} from '../../lib/sync-check-types';
import { ApiError, apiRequest } from './api';
import { ignoreItem, linkPair } from './matches.api';

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
}

const fromItem = (item: SyncItem): RowModel => ({
  id: item.id,
  name: item.name,
  amountCents: item.amountCents,
  isRange: item.isRange,
  reason: item.reason,
  ignored: false,
});

const fromIgnored = (row: SyncIgnored): RowModel => ({
  id: row.itemId,
  name: row.name ?? row.itemId,
  amountCents: row.amountCents,
  isRange: row.isRange,
  reason: row.reason,
  ignored: true,
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

/** Undo an optimistic change by returning the snapshot taken before it. */
export function rollback(_current: SyncCheckResult, snapshot: SyncCheckResult): SyncCheckResult {
  return snapshot;
}

/** The row to focus after an action removes `id`: the next one, else the previous one, else null. */
export function nextRowId(ids: readonly string[], id: string): string | null {
  const at = ids.indexOf(id);
  if (at === -1) return null;
  return ids[at + 1] ?? ids[at - 1] ?? null;
}

export type RowAction =
  | { readonly kind: 'link'; readonly wallosId: string; readonly actualScheduleId: string }
  | { readonly kind: 'ignore'; readonly side: Side; readonly itemId: string };

export type ActionOutcome = { readonly ok: true } | { readonly ok: false; readonly code: string };

/**
 * Applies the action to the list at once, then sends it. A failure restores the snapshot and
 * returns the server code. `get` and `set` read and write the shared result.
 */
export async function performAction(
  get: () => SyncCheckResult | null,
  set: (result: SyncCheckResult) => void,
  action: RowAction,
  fetchImpl?: typeof fetch,
): Promise<ActionOutcome> {
  const snapshot = get();
  if (snapshot === null) return { ok: false, code: 'request_failed' };
  set(
    action.kind === 'link'
      ? applyLink(snapshot, action.wallosId, action.actualScheduleId)
      : applyIgnore(snapshot, action.side, action.itemId),
  );
  try {
    if (action.kind === 'link') await linkPair(action.wallosId, action.actualScheduleId, fetchImpl);
    else await ignoreItem(action.side, action.itemId, fetchImpl);
    return { ok: true };
  } catch (error: unknown) {
    set(rollback(get() ?? snapshot, snapshot));
    return { ok: false, code: error instanceof ApiError ? error.code : 'request_failed' };
  }
}

import { pairBadge, type PairBadgeKind } from '../../lib/match-badge';
import type { SyncCandidate, SyncCheckResult, SyncItem, SyncLinked } from '../../lib/sync-check-types';
import { fromItem, type RowModel, type Side } from './sync-check';

/** Which group a dashboard row belongs to; rows are ordered linked, suggested, wallos, actual. */
export type PairKind = 'linked' | 'suggested' | 'wallos' | 'actual';

/** One dashboard row: a Wallos cell on the left, an Actual cell on the right. A null side is an empty placeholder. */
export interface PairRow {
  readonly key: string;
  readonly kind: PairKind;
  readonly wallos: RowModel | null;
  readonly actual: RowModel | null;
  /** Status badge of a linked row; null on every other row. */
  readonly badge: PairBadgeKind | null;
  /** The candidate a suggested row pairs; null on every other row. */
  readonly candidate: SyncCandidate | null;
  /** A linked row whose two known amounts differ (the cue and the counts line); false on every other row. */
  readonly differs: boolean;
  /** The check's linked pair behind a linked row (match id, status, orphan); null on every other row. */
  readonly link: SyncLinked | null;
}

/**
 * The dashboard rows in match order: linked pairs, then suggested pairs by name score (highest
 * first), then Wallos items with no partner, then Actual items with no partner. Suggested pairs are
 * taken greedily in score order and skip any item already paired, so each item appears in one row.
 * The query keeps a row when either side's name contains it; the pairing is decided before filtering.
 */
export function buildPairRows(result: SyncCheckResult, query: string): PairRow[] {
  const linked: PairRow[] = [];
  for (const l of result.linked) {
    const wallos: RowModel | null =
      l.wallosName === null
        ? null
        : { id: l.wallosId, name: l.wallosName, amountCents: l.wallosAmountCents, isRange: false, reason: null, ignored: false, matchId: null };
    const actual: RowModel | null =
      l.actualName === null
        ? null
        : { id: l.actualScheduleId, name: l.actualName, amountCents: l.actualAmountCents, isRange: l.isRange, reason: null, ignored: false, matchId: null };
    if (wallos === null && actual === null) continue;
    linked.push({
      key: `linked:${l.wallosId}|${l.actualScheduleId}`,
      kind: 'linked',
      wallos,
      actual,
      badge: pairBadge({ status: l.status, orphan: l.orphan }),
      candidate: null,
      link: l,
      differs:
        wallos !== null && actual !== null && wallos.amountCents !== null && actual.amountCents !== null && wallos.amountCents !== actual.amountCents,
    });
  }

  const wallosById = new Map<string, SyncItem>(result.unlinkedWallos.map((i) => [i.id, i]));
  const actualById = new Map<string, SyncItem>(result.unlinkedActual.map((i) => [i.id, i]));
  const usedWallos = new Set<string>();
  const usedActual = new Set<string>();
  const suggested: PairRow[] = [];
  for (const c of [...result.candidates].sort((a, b) => b.nameScore - a.nameScore)) {
    const w = wallosById.get(c.wallosId);
    const a = actualById.get(c.actualScheduleId);
    if (w === undefined || a === undefined || usedWallos.has(w.id) || usedActual.has(a.id)) continue;
    usedWallos.add(w.id);
    usedActual.add(a.id);
    suggested.push({ key: `suggested:${w.id}|${a.id}`, kind: 'suggested', wallos: fromItem(w), actual: fromItem(a), badge: null, candidate: c, differs: false, link: null });
  }

  const wallosOnly: PairRow[] = result.unlinkedWallos
    .filter((i) => !usedWallos.has(i.id))
    .map((i) => ({ key: `wallos:${i.id}`, kind: 'wallos', wallos: fromItem(i), actual: null, badge: null, candidate: null, differs: false, link: null }));
  const actualOnly: PairRow[] = result.unlinkedActual
    .filter((i) => !usedActual.has(i.id))
    .map((i) => ({ key: `actual:${i.id}`, kind: 'actual', wallos: null, actual: fromItem(i), badge: null, candidate: null, differs: false, link: null }));

  const q = query.trim().toLowerCase();
  const matches = (r: RowModel | null) => r !== null && r.name.toLowerCase().includes(q);
  const rows = [...linked, ...suggested, ...wallosOnly, ...actualOnly];
  return q === '' ? rows : rows.filter((r) => matches(r.wallos) || matches(r.actual));
}

/** The cells of one side, in row order, skipping placeholders. */
export function cellsOf(rows: readonly PairRow[], side: Side): RowModel[] {
  return rows.flatMap((r) => {
    const cell = side === 'wallos' ? r.wallos : r.actual;
    return cell === null ? [] : [cell];
  });
}

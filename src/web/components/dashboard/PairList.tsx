import { useState } from 'react';
import type { SyncCandidate } from '../../../lib/sync-check-types';
import { formatMoney } from '../../../lib/format-money';
import { useT } from '@/i18n';
import type { PairKind, PairRow } from '@/lib/pair-rows';
import type { RowModel, Side } from '@/lib/sync-check';
import type { SyncLinked } from '../../../lib/sync-check-types';
import { diffModalMessages } from '../matches/DiffModal.messages';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { StatusBadge } from '../StatusBadge';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Disclosure } from '../ui/disclosure';
import { MoreActionsMenu, type MoreActionsItem } from '../ui/more-actions-menu';
import { ItemRow } from './ItemRow';

export interface PairListProps {
  rows: readonly PairRow[];
  /** The side shown below 768px; the other side's cells hide there. */
  pane: Side;
  baseCurrency: string;
  candidates: readonly SyncCandidate[];
  /** Message when no row has a cell on the active side (shown below 768px) or no row exists. */
  emptyText: string;
  wallosTitle: string;
  actualTitle: string;
  wallosCount: number;
  actualCount: number;
  /** Linked pairs before the search filter; the counts line reads "N of M pairs". */
  linkedTotal: number;
  busyId?: string | null;
  errorRowId?: string | null;
  errorText?: string | null;
  onLink?: (wallosId: string, actualScheduleId: string, side: Side) => void;
  onIgnore?: (side: Side, itemId: string) => void;
  onRestore?: (side: Side, matchId: string, itemId: string) => void;
  onRetry?: () => void;
  /** Unlink a LINKED, non-orphan pair (opens the confirmation dialog). Offered once per pair, on its first cell. */
  onUnlink?: (row: SyncLinked) => void;
  /** Recreate the missing side of a single-side orphan (opens the create modal). Offered on the surviving side's cell. */
  onRecreate?: (row: SyncLinked) => void;
  /** Link a single-side orphan to another unlinked item (opens the relink dialog). Offered on the surviving side's cell. */
  onRelink?: (row: SyncLinked) => void;
  /** Opens the diff modal for a MISMATCH_DETECTED pair by its match id. Offered on the pair's Wallos cell. */
  onReview?: (matchId: string) => void;
}

/** A linked pair's side: name, amount, the pair's status badge and, when offered, its actions menu. */
function LinkedCell({
  row,
  side,
  badge,
  baseCurrency,
  differs,
  actions,
  review,
}: {
  row: RowModel;
  side: Side;
  badge: NonNullable<PairRow['badge']>;
  baseCurrency: string;
  differs: boolean;
  /** The menu items for this pair's surviving cell; null hides the menu. */
  actions: MoreActionsItem[] | null;
  /** The Review button for a mismatch pair's cell; null hides it. */
  review: { matchId: string; onReview: (matchId: string) => void } | null;
}) {
  const { t, locale } = useT(syncDashboardMessages);
  return (
    <div data-row-id={row.id} data-side={side} data-linked="" tabIndex={-1} className="flex h-full items-center gap-x-3 px-3 py-1.5 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium" title={row.name}>
        {row.name}
      </span>
      {row.isRange ? (
        <Badge variant="mismatch" title={t('row.rangeHint')}>
          {t('row.range')}
        </Badge>
      ) : null}
      <StatusBadge kind={badge} />
      {review !== null ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-(--control-h)"
          data-review-for={review.matchId}
          aria-label={t('reviewLabel', { name: row.name })}
          onClick={() => { review.onReview(review.matchId); }}
        >
          {t('review')}
        </Button>
      ) : null}
      <span className="text-right">
        {row.amountCents === null ? (
          <span className="text-muted">{t('row.noAmount')}</span>
        ) : (
          <span className={`font-mono ${differs ? 'font-bold' : ''}`}>{formatMoney(row.amountCents, baseCurrency, locale)}</span>
        )}
        {differs ? <span className="sr-only"> {t('differs')}</span> : null}
      </span>
      {actions !== null ? <MoreActionsMenu name={row.name} className="-my-1" items={actions} /> : null}
    </div>
  );
}

/** Empty side of a row. It keeps the grid aligned and is hidden from assistive technology. */
function Placeholder({ side, className }: { side: Side; className: string }) {
  return <div aria-hidden="true" data-placeholder={side} className={className} />;
}

/** The order of the group boxes; rows arrive in this order from buildPairRows. */
const GROUP_KINDS: readonly PairKind[] = ['linked', 'suggested', 'wallos', 'actual'];

/**
 * The dashboard rows, one grid row each: Wallos cell left, Actual cell right at md and up. Below
 * 768px only the active side's cells show, and a row with no cell on that side hides. The rows sit
 * in one foldable box per kind (linked, suggested, Wallos only, Actual only); an empty group has no box.
 */
export function PairList(props: PairListProps) {
  const { t } = useT(syncDashboardMessages);
  const unlinkLabel = useT(diffModalMessages).t('unlink');
  const [folded, setFolded] = useState<ReadonlySet<PairKind>>(() => new Set());
  const createLabel = (side: Side) => (side === 'wallos' ? t('row.createInActual') : t('row.createInWallos'));
  const hide = (side: Side) => (props.pane === side ? '' : 'max-md:hidden');
  const hasCell = (side: Side) => props.rows.some((r) => (side === 'wallos' ? r.wallos : r.actual) !== null);
  const linkedActions = (link: SyncLinked): MoreActionsItem[] | null => {
    if (link.orphan === 'orphaned_wallos' || link.orphan === 'orphaned_actual') {
      return [
        {
          id: 'recreate',
          label: t(link.orphan === 'orphaned_wallos' ? 'orphan.recreateWallos' : 'orphan.recreateActual'),
          onSelect: () => { props.onRecreate?.(link); },
        },
        { id: 'relink', label: t('orphan.link'), onSelect: () => { props.onRelink?.(link); } },
      ];
    }
    if (link.status === 'LINKED' && link.orphan === null && props.onUnlink !== undefined) {
      return [{ id: 'unlink', label: unlinkLabel, destructive: true, onSelect: () => { props.onUnlink?.(link); } }];
    }
    return null;
  };
  const cellOf = (r: PairRow, side: Side) => {
    const cell = side === 'wallos' ? r.wallos : r.actual;
    const base = `min-w-0 ${hide(side)} ${side === 'actual' ? 'md:border-l' : ''}`;
    if (cell === null) return <Placeholder key={side} side={side} className={`${base} max-md:hidden`} />;
    if (r.kind === 'linked' && r.badge !== null) {
      // One menu per pair, on its first cell: the surviving side for an orphan, the Wallos cell otherwise.
      const menuHere = side === (r.wallos !== null ? 'wallos' : 'actual');
      return (
        <div key={side} className={base}>
          <LinkedCell
            row={cell}
            side={side}
            badge={r.badge}
            baseCurrency={props.baseCurrency}
            differs={r.differs}
            actions={menuHere && r.link !== null ? linkedActions(r.link) : null}
            review={
              menuHere && r.link !== null && r.link.status === 'MISMATCH_DETECTED' && props.onReview !== undefined
                ? { matchId: r.link.matchId, onReview: props.onReview }
                : null
            }
          />
        </div>
      );
    }
    return (
      <div key={side} className={base}>
        <ItemRow
          cell
          row={cell}
          side={side}
          baseCurrency={props.baseCurrency}
          candidates={props.candidates}
          suggestion={r.kind === 'suggested' ? r.candidate : null}
          createLabel={createLabel(side)}
          disabled={props.busyId === cell.id}
          error={props.errorRowId === cell.id ? props.errorText : null}
          onLink={props.onLink}
          onIgnore={props.onIgnore}
          onRestore={props.onRestore}
          onRetry={props.onRetry}
        />
      </div>
    );
  };
  const linkedRows = props.rows.filter((r) => r.kind === 'linked');
  const differingCount = linkedRows.filter((r) => r.differs).length;
  const rowOf = (r: PairRow) => {
    const cell = props.pane === 'wallos' ? r.wallos : r.actual;
    return (
      <li
        key={r.key}
        data-pair={r.kind}
        className={`grid grid-cols-1 border-b last:border-b-0 md:grid-cols-2 ${cell === null ? 'max-md:hidden' : ''}`}
      >
        {cellOf(r, 'wallos')}
        {cellOf(r, 'actual')}
      </li>
    );
  };
  const groupOf = (kind: PairKind) => {
    const rows = props.rows.filter((r) => r.kind === kind);
    if (rows.length === 0) return null;
    const onPane = rows.some((r) => (props.pane === 'wallos' ? r.wallos : r.actual) !== null);
    return (
      <section key={kind} data-group={kind} className={`min-w-0 rounded-lg border bg-card ${onPane ? '' : 'max-md:hidden'}`}>
        <Disclosure
          className="px-3"
          title={t(`groups.${kind}`, { count: rows.length })}
          open={!folded.has(kind)}
          onOpenChange={(open) => {
            setFolded((prev) => {
              const next = new Set(prev);
              if (open) next.delete(kind);
              else next.add(kind);
              return next;
            });
          }}
        >
          <ul className="-mx-3 border-t">{rows.map(rowOf)}</ul>
        </Disclosure>
      </section>
    );
  };
  return (
    <div data-pairs="" tabIndex={-1} className="min-w-0 outline-none">
      {/* Desktop only: the column titles stay at the top while the rows scroll. Below 768px the pane switch replaces this. */}
      <div data-column-header="" className="grid grid-cols-1 bg-card md:sticky md:top-0 md:z-20 md:grid-cols-2">
        <h2 id="col-wallos" className={`px-3 py-1.5 text-sm font-semibold ${hide('wallos')}`}>
          {props.wallosTitle} <span className="font-mono text-xs font-normal text-muted">{props.wallosCount}</span>
        </h2>
        <h2 id="col-actual" className={`px-3 py-1.5 text-sm font-semibold md:border-l ${hide('actual')}`}>
          {props.actualTitle} <span className="font-mono text-xs font-normal text-muted">{props.actualCount}</span>
        </h2>
      </div>
      {props.rows.length === 0 ? (
        <p className="rounded-lg border bg-card px-3 py-1.5 text-sm text-muted">{props.emptyText}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {linkedRows.length > 0 ? (
            <p className="text-xs text-muted" role="status">
              {t('counts', { shown: linkedRows.length, total: props.linkedTotal, differing: differingCount })}
            </p>
          ) : null}
          {GROUP_KINDS.map(groupOf)}
          {hasCell(props.pane) ? null : <p className="px-3 py-1.5 text-sm text-muted md:hidden">{props.emptyText}</p>}
        </div>
      )}
    </div>
  );
}

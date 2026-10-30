import { useState } from 'react';
import type { SyncCandidate } from '../../../lib/sync-check-types';
import { formatMoney } from '../../../lib/format-money';
import { useT } from '@/i18n';
import type { PairKind, PairRow } from '@/lib/pair-rows';
import type { RowModel, Side } from '@/lib/sync-check';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { StatusBadge } from '../StatusBadge';
import { Badge } from '../ui/badge';
import { Disclosure } from '../ui/disclosure';
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
}

/** A linked pair's side: name, amount and the pair's status badge. No actions, so linked state cannot change here. */
function LinkedCell({
  row,
  side,
  badge,
  baseCurrency,
  differs,
}: {
  row: RowModel;
  side: Side;
  badge: NonNullable<PairRow['badge']>;
  baseCurrency: string;
  differs: boolean;
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
      <span className="text-right">
        {row.amountCents === null ? (
          <span className="text-muted">{t('row.noAmount')}</span>
        ) : (
          <span className={`font-mono ${differs ? 'font-bold' : ''}`}>{formatMoney(row.amountCents, baseCurrency, locale)}</span>
        )}
        {differs ? <span className="sr-only"> {t('differs')}</span> : null}
      </span>
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
  const [folded, setFolded] = useState<ReadonlySet<PairKind>>(() => new Set());
  const createLabel = (side: Side) => (side === 'wallos' ? t('row.createInActual') : t('row.createInWallos'));
  const hide = (side: Side) => (props.pane === side ? '' : 'max-md:hidden');
  const hasCell = (side: Side) => props.rows.some((r) => (side === 'wallos' ? r.wallos : r.actual) !== null);
  const cellOf = (r: PairRow, side: Side) => {
    const cell = side === 'wallos' ? r.wallos : r.actual;
    const base = `min-w-0 ${hide(side)} ${side === 'actual' ? 'md:border-l' : ''}`;
    if (cell === null) return <Placeholder key={side} side={side} className={`${base} max-md:hidden`} />;
    if (r.kind === 'linked' && r.badge !== null) {
      return (
        <div key={side} className={base}>
          <LinkedCell row={cell} side={side} badge={r.badge} baseCurrency={props.baseCurrency} differs={r.differs} />
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
      <div className="grid grid-cols-1 md:grid-cols-2">
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

import { useState, type ReactNode } from 'react';
import type { SyncCandidate } from '../../../lib/sync-check-types';
import { formatMoney } from '../../../lib/format-money';
import { useT } from '@/i18n';
import { type RowModel, type Side } from '@/lib/sync-check';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { StatusBadge } from '../StatusBadge';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';

export interface ItemRowProps {
  row: RowModel;
  side: Side;
  baseCurrency: string;
  /** All candidates of the last check; the row picks its own. */
  candidates: readonly SyncCandidate[];
  disabled?: boolean;
  error?: string | null;
  createLabel: string;
  onLink?: (wallosId: string, actualScheduleId: string, side: Side) => void;
  onIgnore?: (side: Side, itemId: string) => void;
}

const CELL = 'px-3 py-1.5 text-sm';

/** One item. Link only exists for items with candidates; unmappable items show their reason. */
export function ItemRow(props: ItemRowProps) {
  const { row, side } = props;
  const { t, locale } = useT(syncDashboardMessages);
  const mine = props.candidates.filter((c) =>
    side === 'wallos' ? c.wallosId === row.id : c.actualScheduleId === row.id,
  );
  const [chosen, setChosen] = useState(0);
  const pick = mine[Math.min(chosen, mine.length - 1)];
  const otherName = (c: SyncCandidate) => (side === 'wallos' ? c.actualName : c.wallosName);
  const otherCents = (c: SyncCandidate) => (side === 'wallos' ? c.actualAmountCents : c.wallosAmountCents);
  const canAct = !row.ignored && props.disabled !== true;

  let amount: ReactNode;
  if (row.reason !== null) {
    amount = <span className="text-warning">{t(`reason.${row.reason}`)}</span>;
  } else if (row.amountCents === null) {
    amount = <span className="text-muted-foreground">{t('row.noAmount')}</span>;
  } else {
    amount = <span className="font-mono">{formatMoney(row.amountCents, props.baseCurrency, locale)}</span>;
  }

  return (
    <li
      data-row-id={row.id}
      tabIndex={-1}
      className="border-b outline-none last:border-b-0 focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${CELL}`}>
        <span className="min-w-0 flex-1 truncate font-medium" title={row.name}>
          {row.name}
        </span>
        {row.isRange ? (
          <Badge variant="mismatch" title={t('row.rangeHint')}>
            {t('row.range')}
          </Badge>
        ) : null}
        {row.ignored ? <StatusBadge kind="ignored" /> : null}
        <span className="text-right">{amount}</span>
      </div>
      {canAct ? (
        <div className={`flex flex-wrap items-center gap-2 pt-0 ${CELL}`}>
          {pick !== undefined && row.reason === null ? (
            <>
              <select
                aria-label={t('row.linkTo', { name: row.name })}
                value={Math.min(chosen, mine.length - 1)}
                onChange={(e) => {
                  setChosen(Number(e.target.value));
                }}
                className="h-6 max-w-48 rounded-md border bg-background px-1 text-xs"
              >
                {mine.map((c, i) => (
                  <option key={`${c.wallosId}:${c.actualScheduleId}`} value={i}>
                    {otherName(c)} ({formatMoney(otherCents(c), props.baseCurrency, locale)})
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="xs"
                onClick={() => props.onLink?.(pick.wallosId, pick.actualScheduleId, side)}
              >
                {t('row.link')}
              </Button>
            </>
          ) : null}
          <span title={t('row.held')}>
            <Button type="button" size="xs" variant="outline" disabled aria-label={`${props.createLabel}. ${t('row.held')}`}>
              {props.createLabel}
            </Button>
          </span>
          <Button type="button" size="xs" variant="ghost" onClick={() => props.onIgnore?.(side, row.id)}>
            {t('row.ignore')}
          </Button>
        </div>
      ) : null}
      {props.error != null ? (
        <p role="alert" className={`text-xs text-warning ${CELL}`}>
          {props.error}
        </p>
      ) : null}
    </li>
  );
}

export interface ItemColumnProps {
  side: Side;
  title: string;
  rows: readonly RowModel[];
  baseCurrency: string;
  candidates: readonly SyncCandidate[];
  createLabel: string;
  /** Message for an empty column. */
  emptyText: string;
  busyId?: string | null;
  errorRowId?: string | null;
  errorText?: string | null;
  onLink?: (wallosId: string, actualScheduleId: string, side: Side) => void;
  onIgnore?: (side: Side, itemId: string) => void;
}

/** Shared column body used by WallosColumn and ActualColumn. */
export function ItemColumn(props: ItemColumnProps) {
  const headingId = `col-${props.side}`;
  return (
    <section aria-labelledby={headingId} data-column={props.side} tabIndex={-1} className="min-w-0 rounded-lg border bg-card outline-none">
      <h2 id={headingId} className="border-b px-3 py-1.5 text-sm font-semibold">
        {props.title}{' '}
        <span className="font-mono text-xs font-normal text-muted-foreground">{props.rows.length}</span>
      </h2>
      {props.rows.length === 0 ? (
        <p className="px-3 py-1.5 text-sm text-muted-foreground">{props.emptyText}</p>
      ) : (
        <ul>
          {props.rows.map((row) => (
            <ItemRow
              key={row.id}
              row={row}
              side={props.side}
              baseCurrency={props.baseCurrency}
              candidates={props.candidates}
              createLabel={props.createLabel}
              disabled={props.busyId === row.id}
              error={props.errorRowId === row.id ? props.errorText : null}
              onLink={props.onLink}
              onIgnore={props.onIgnore}
            />
          ))}
        </ul>
      )}
    </section>
  );
}


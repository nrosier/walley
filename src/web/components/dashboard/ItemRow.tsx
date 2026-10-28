import { useState, type ReactNode } from 'react';
import type { SyncCandidate } from '../../../lib/sync-check-types';
import { formatMoney } from '../../../lib/format-money';
import { useT } from '@/i18n';
import { cycleLabel } from '@/lib/billing-cycle-label';
import { type RowModel, type Side } from '@/lib/sync-check';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';
import { StatusBadge } from '../StatusBadge';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Disclosure } from '../ui/disclosure';
import { MoreActionsMenu, type MoreActionsItem } from '../ui/more-actions-menu';
import { CreateActualModal } from './CreateActualModal';
import { CreateWallosModal } from './CreateWallosModal';

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
  onRestore?: (side: Side, matchId: string, itemId: string) => void;
  /** Repeats the action that just failed on this row. */
  onRetry?: () => void;
}

const CELL = 'px-3 py-1.5 text-sm';
const ACTION = 'min-h-(--control-h) shrink-0';

/**
 * One item on one line: name, amount, one primary action, More actions.
 * The primary action is Link (with a "Suggested match" line) when a candidate exists, otherwise Create.
 * Ignore and Restore live only in More actions.
 */
export function ItemRow(props: ItemRowProps) {
  const { row, side } = props;
  const { t, locale } = useT(syncDashboardMessages);
  const [creating, setCreating] = useState(false);
  const mine = props.candidates
    .filter((c) => (side === 'wallos' ? c.wallosId === row.id : c.actualScheduleId === row.id))
    .sort((a, b) => b.nameScore - a.nameScore);
  const best = row.reason === null ? mine[0] : undefined;
  const otherName = (c: SyncCandidate) => (side === 'wallos' ? c.actualName : c.wallosName);
  const busy = props.disabled === true;

  let amount: ReactNode;
  if (row.reason !== null) {
    amount = <span className="text-warning">{t(`reason.${row.reason}`)}</span>;
  } else if (row.amountCents === null) {
    amount = <span className="text-muted">{t('row.noAmount')}</span>;
  } else {
    amount = <span className="font-mono">{formatMoney(row.amountCents, props.baseCurrency, locale)}</span>;
  }

  const menu: MoreActionsItem[] = [];
  if (row.ignored) {
    if (row.matchId !== null) {
      const matchId = row.matchId;
      menu.push({
        id: 'restore',
        label: t('row.restoreNamed', { name: row.name }),
        disabled: busy,
        onSelect: () => props.onRestore?.(side, matchId, row.id),
      });
    }
  } else {
    // Other candidates stay reachable here so the suggestion is not the only way to link.
    for (const c of mine.slice(best === undefined ? 0 : 1)) {
      if (row.reason !== null) break;
      menu.push({
        id: `link:${c.wallosId}:${c.actualScheduleId}`,
        label: t('row.linkNamed', { name: row.name, other: otherName(c) }),
        disabled: busy,
        onSelect: () => props.onLink?.(c.wallosId, c.actualScheduleId, side),
      });
    }
    menu.push({
      id: 'ignore',
      label: t('row.ignoreNamed', { name: row.name }),
      disabled: busy,
      onSelect: () => props.onIgnore?.(side, row.id),
    });
  }

  return (
    <li
      data-row-id={row.id}
      tabIndex={-1}
      className="border-b outline-none last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <div className={`flex items-center gap-x-3 ${CELL}`}>
        <div className="min-w-0 flex-1">
          <span className="block truncate font-medium" title={row.name}>
            {row.name}
          </span>
          {best !== undefined && !row.ignored ? (
            <span className="block truncate text-xs text-muted">{t('row.suggested', { name: otherName(best) })}</span>
          ) : null}
        </div>
        {row.isRange ? (
          <Badge variant="mismatch" title={t('row.rangeHint')}>
            {t('row.range')}
          </Badge>
        ) : null}
        {row.ignored ? <StatusBadge kind="ignored" /> : null}
        <span className="flex flex-wrap items-baseline justify-end gap-x-2 text-right">
          {amount}
          {row.cycle === undefined || row.ignored ? null : (
            <span className="text-xs text-muted" data-cycle={row.cycle.key}>
              {cycleLabel(t, row.cycle)}
            </span>
          )}
        </span>
        {row.ignored ? null : best !== undefined ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={ACTION}
            disabled={busy}
            aria-label={t('row.linkNamed', { name: row.name, other: otherName(best) })}
            onClick={() => props.onLink?.(best.wallosId, best.actualScheduleId, side)}
          >
            {t('row.link')}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={ACTION}
            disabled={busy}
            aria-label={t(side === 'wallos' ? 'row.createInActualNamed' : 'row.createInWallosNamed', { name: row.name })}
            onClick={() => {
              setCreating(true);
            }}
          >
            {props.createLabel}
          </Button>
        )}
        {menu.length > 0 ? <MoreActionsMenu items={menu} name={row.name} /> : null}
      </div>
      {creating && side === 'wallos' ? (
        <CreateActualModal
          wallosId={row.id}
          wallosName={row.name}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
      {creating && side === 'actual' ? (
        <CreateWallosModal
          scheduleId={row.id}
          scheduleName={row.name}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
      {props.error != null ? (
        <div className="px-3 pb-2">
          <Alert variant="error">
            {props.error} {t('row.nothingChanged')}
            {props.onRetry === undefined ? null : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-2 min-h-(--control-h)"
                aria-label={t('row.tryAgainNamed', { name: row.name })}
                onClick={props.onRetry}
              >
                {t('row.tryAgain')}
              </Button>
            )}
          </Alert>
        </div>
      ) : null}
    </li>
  );
}

export interface ItemColumnProps {
  side: Side;
  title: string;
  rows: readonly RowModel[];
  /** Ignored rows of this column; shown in a disclosure. */
  ignoredRows?: readonly RowModel[];
  ignoredOpen?: boolean;
  onIgnoredOpenChange?: (open: boolean) => void;
  baseCurrency: string;
  candidates: readonly SyncCandidate[];
  createLabel: string;
  /** Message for an empty column. */
  emptyText: string;
  busyId?: string | null;
  errorRowId?: string | null;
  errorText?: string | null;
  className?: string;
  onLink?: (wallosId: string, actualScheduleId: string, side: Side) => void;
  onIgnore?: (side: Side, itemId: string) => void;
  onRestore?: (side: Side, matchId: string, itemId: string) => void;
  onRetry?: () => void;
}

/** Shared column body used by WallosColumn and ActualColumn. */
export function ItemColumn(props: ItemColumnProps) {
  const { t } = useT(syncDashboardMessages);
  const headingId = `col-${props.side}`;
  const renderRow = (row: RowModel) => (
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
      onRestore={props.onRestore}
      onRetry={props.onRetry}
    />
  );
  const ignored = props.ignoredRows ?? [];
  return (
    <section
      aria-labelledby={headingId}
      data-column={props.side}
      tabIndex={-1}
      className={`min-w-0 rounded-lg border bg-card outline-none ${props.className ?? ''}`}
    >
      <h2 id={headingId} className="border-b px-3 py-1.5 text-sm font-semibold">
        {props.title} <span className="font-mono text-xs font-normal text-muted">{props.rows.length}</span>
      </h2>
      {props.rows.length === 0 ? (
        <p className="px-3 py-1.5 text-sm text-muted">{props.emptyText}</p>
      ) : (
        <ul>{props.rows.map(renderRow)}</ul>
      )}
      {ignored.length > 0 ? (
        <Disclosure
          className="border-t px-3"
          title={t('ignoredTitle', { count: ignored.length })}
          open={props.ignoredOpen}
          onOpenChange={props.onIgnoredOpenChange}
        >
          <ul className="-mx-3">{ignored.map(renderRow)}</ul>
        </Disclosure>
      ) : null}
    </section>
  );
}

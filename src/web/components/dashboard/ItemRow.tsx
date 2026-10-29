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
  /**
   * The candidate this row is paired with in the dashboard. A candidate makes it the primary Link;
   * null means the row is unpaired (Create is primary, other candidates stay in More actions);
   * undefined picks the best candidate of the item.
   */
  suggestion?: SyncCandidate | null;
  /** Render a cell inside a pair row (a div with no list styling) instead of a list item. */
  cell?: boolean;
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
  const picked = props.suggestion === undefined ? mine[0] : (props.suggestion ?? undefined);
  const best = row.reason === null ? picked : undefined;
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
    for (const c of mine.filter((m) => best === undefined || m.wallosId !== best.wallosId || m.actualScheduleId !== best.actualScheduleId)) {
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

  const Tag = props.cell === true ? 'div' : 'li';
  return (
    <Tag
      data-row-id={row.id}
      data-side={side}
      tabIndex={-1}
      className={`${props.cell === true ? 'h-full' : 'border-b last:border-b-0'} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring`}
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
    </Tag>
  );
}

export interface IgnoredSectionProps {
  side: Side;
  title: string;
  /** Ignored rows of this side; the section renders nothing when empty. */
  rows: readonly RowModel[];
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  baseCurrency: string;
  createLabel: string;
  busyId?: string | null;
  errorRowId?: string | null;
  errorText?: string | null;
  className?: string;
  onLink?: (wallosId: string, actualScheduleId: string, side: Side) => void;
  onIgnore?: (side: Side, itemId: string) => void;
  onRestore?: (side: Side, matchId: string, itemId: string) => void;
  onRetry?: () => void;
}

/** The ignored items of one side in a collapsed disclosure. */
export function IgnoredSection(props: IgnoredSectionProps) {
  const { t } = useT(syncDashboardMessages);
  if (props.rows.length === 0) return null;
  return (
    <section
      aria-labelledby={`col-${props.side}`}
      data-column={props.side}
      className={`min-w-0 rounded-lg border bg-card ${props.className ?? ''}`}
    >
      <Disclosure
        className="px-3"
        title={t('ignoredTitle', { count: props.rows.length })}
        open={props.open}
        onOpenChange={props.onOpenChange}
      >
        <ul className="-mx-3">
          {props.rows.map((row) => (
            <ItemRow
              key={row.id}
              row={row}
              side={props.side}
              baseCurrency={props.baseCurrency}
              candidates={[]}
              createLabel={props.createLabel}
              disabled={props.busyId === row.id}
              error={props.errorRowId === row.id ? props.errorText : null}
              onLink={props.onLink}
              onIgnore={props.onIgnore}
              onRestore={props.onRestore}
              onRetry={props.onRetry}
            />
          ))}
        </ul>
      </Disclosure>
    </section>
  );
}

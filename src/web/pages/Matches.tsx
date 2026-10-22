import { useState, type ReactNode } from 'react';
import type { SyncCheckResult, SyncIgnored, SyncLinked } from '../../lib/sync-check-types';
import { formatMoney } from '../../lib/format-money';
import { pairBadge } from '../../lib/match-badge';
import { useT } from '@/i18n';
import { nextRowId, performAction, useSyncCheck } from '@/lib/sync-check';
import { cn } from '@/lib/utils';
import { StatusBadge } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { matchesMessages } from './Matches.messages';

export interface MatchesViewProps {
  /** Last sync check result, or null when no check has run yet. */
  result: SyncCheckResult | null;
  /** Drives the "Ignored items" section. */
  showIgnored: boolean;
  onShowIgnoredChange?: (on: boolean) => void;
  /** Restore an ignored row by its match id. */
  onRestore?: (matchId: string) => void;
  /** Match id of the row being restored, and of the row whose restore failed. */
  busyId?: string | null;
  errorId?: string | null;
  /** Resolved text of the last failed restore. */
  errorMessage?: string | null;
}

const CELL = 'px-3 py-1.5 text-sm';
const HEAD = 'px-3 py-1.5 text-left text-xs font-medium text-muted-foreground';
const DASH = '—';

/** Renders a name or amount; a missing value (`muted`) shows the em dash in the muted colour. */
function Value({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <span className={muted ? 'text-muted-foreground' : undefined}>{children}</span>;
}

/** Linked subscription pairs and, when switched on, the ignored items with a Restore action. */
export function MatchesView({
  result,
  showIgnored,
  onShowIgnoredChange,
  onRestore,
  busyId,
  errorId,
  errorMessage,
}: MatchesViewProps) {
  const { t, locale } = useT(matchesMessages);
  const money = (cents: number | null, currency: string): string =>
    cents === null ? DASH : formatMoney(cents, currency, locale);
  const baseCurrency = result?.baseCurrency ?? '';
  const linked: readonly SyncLinked[] = result?.linked ?? [];
  const ignored: readonly SyncIgnored[] = result?.ignored ?? [];

  let body: ReactNode;
  if (linked.length === 0) {
    body = <p className="text-sm text-muted-foreground">{t('empty')}</p>;
  } else {
    body = (
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table aria-label={t('table.label')} className="w-full border-collapse">
          <thead className="border-b">
            <tr>
              <th scope="col" className={HEAD}>{t('table.wallos')}</th>
              <th scope="col" className={HEAD}>{t('table.actual')}</th>
              <th scope="col" className={cn(HEAD, 'text-right')}>{t('table.wallosAmount')}</th>
              <th scope="col" className={cn(HEAD, 'text-right')}>{t('table.actualAmount')}</th>
              <th scope="col" className={HEAD}>{t('table.status')}</th>
            </tr>
          </thead>
          <tbody>
            {linked.map((row) => {
              const kind = pairBadge({ status: row.status, orphan: row.orphan });
              return (
                <tr key={`${row.wallosId}:${row.actualScheduleId}`} data-match-row className="border-b last:border-b-0">
                  <td className={cn(CELL, 'font-medium')}>
                    <Value muted={row.wallosName === null}>{row.wallosName ?? DASH}</Value>
                  </td>
                  <td className={CELL}>
                    <Value muted={row.actualName === null}>{row.actualName ?? DASH}</Value>
                    {row.isRange ? (
                      <Badge variant="mismatch" className="ml-2" title={t('rangeHint')}>
                        {t('range')}
                      </Badge>
                    ) : null}
                  </td>
                  <td className={cn(CELL, 'text-right font-mono')}>
                    <Value muted={row.wallosAmountCents === null}>{money(row.wallosAmountCents, baseCurrency)}</Value>
                  </td>
                  <td className={cn(CELL, 'text-right font-mono')}>
                    <Value muted={row.actualAmountCents === null}>{money(row.actualAmountCents, baseCurrency)}</Value>
                  </td>
                  <td className={CELL}>
                    <StatusBadge kind={kind} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section aria-labelledby="matches-title">
      <h1 id="matches-title" className="mb-3 text-lg font-semibold">
        {t('title')}
      </h1>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <button
            type="button"
            role="switch"
            aria-checked={showIgnored}
            onClick={() => onShowIgnoredChange?.(!showIgnored)}
            className={cn(
              'relative h-5 w-9 shrink-0 rounded-full border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              showIgnored ? 'bg-primary' : 'bg-neutral-bg',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-0.5 size-3.5 rounded-full bg-background transition-all',
                showIgnored ? 'left-[18px]' : 'left-0.5',
              )}
            />
          </button>
          <span>{t('ignored.toggle')}</span>
        </label>
      </div>
      {body}
      {showIgnored && result !== null ? (
        <section aria-labelledby="matches-ignored-title" className="mt-6">
          <h2 id="matches-ignored-title" tabIndex={-1} data-ignored-heading className="mb-2 text-sm font-semibold outline-none">
            {t('ignored.title')}
          </h2>
          {ignored.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('ignored.none')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table aria-labelledby="matches-ignored-title" className="w-full border-collapse">
                <thead className="border-b">
                  <tr>
                    <th scope="col" className={HEAD}>{t('ignored.name')}</th>
                    <th scope="col" className={HEAD}>{t('ignored.side')}</th>
                    <th scope="col" className={cn(HEAD, 'text-right')}>{t('ignored.amount')}</th>
                    <th scope="col" className={HEAD}>{t('table.status')}</th>
                    <th scope="col" className={HEAD}>{t('ignored.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {ignored.map((row) => (
                    <tr key={`${row.side}:${row.itemId}`} data-ignored-row data-match-id={row.matchId} tabIndex={-1} className="border-b outline-none last:border-b-0 focus-visible:ring-[3px] focus-visible:ring-ring/50">
                      <td className={cn(CELL, 'font-medium')}>
                        <Value muted={row.name === null}>{row.name ?? DASH}</Value>
                      </td>
                      <td className={CELL}>{t(`ignored.sides.${row.side}`)}</td>
                      <td className={cn(CELL, 'text-right font-mono')}>
                        <Value muted={row.amountCents === null}>{money(row.amountCents, result.baseCurrency)}</Value>
                      </td>
                      <td className={CELL}>
                        <StatusBadge kind="ignored" />
                      </td>
                      <td className={CELL}>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          disabled={busyId === row.matchId}
                          aria-label={t('ignored.restoreLabel')}
                          onClick={() => onRestore?.(row.matchId)}
                        >
                          {t('ignored.restore')}
                        </Button>
                        {errorId === row.matchId && errorMessage != null ? (
                          <p role="alert" className="mt-1 text-xs text-warning">
                            {errorMessage}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
}

function focusAfter(matchId: string | null) {
  requestAnimationFrame(() => {
    const row = matchId === null ? null : document.querySelector<HTMLElement>(`[data-match-id="${CSS.escape(matchId)}"]`);
    (row ?? document.querySelector<HTMLElement>('[data-ignored-heading]'))?.focus();
  });
}

/** Matches page: reads the shared sync result and holds the ignored-switch state. */
export function Matches() {
  const { t, errorText } = useT(matchesMessages);
  const sync = useSyncCheck();
  const [showIgnored, setShowIgnored] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);

  const restore = (matchId: string) => {
    const result = sync.result;
    if (result === null) return;
    const next = nextRowId(
      result.ignored.map((r) => r.matchId),
      matchId,
    );
    const name = result.ignored.find((r) => r.matchId === matchId)?.name ?? matchId;
    setBusyId(matchId);
    setFailed(null);
    let latest = result;
    void performAction(
      () => latest,
      (r) => {
        latest = r;
        sync.setResult(r);
      },
      { kind: 'restore', matchId },
    ).then((outcome) => {
      setBusyId(null);
      if (outcome.ok) {
        focusAfter(next);
      } else {
        setFailed({ id: matchId, text: `${t('ignored.failed', { name })} ${errorText(outcome.code)}` });
        focusAfter(matchId);
      }
    });
  };

  return (
    <MatchesView
      result={sync.result}
      showIgnored={showIgnored}
      onShowIgnoredChange={setShowIgnored}
      onRestore={restore}
      busyId={busyId}
      errorId={failed?.id ?? null}
      errorMessage={failed?.text ?? null}
    />
  );
}

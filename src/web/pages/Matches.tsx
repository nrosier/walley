import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type { SyncCheckResult, SyncIgnored, SyncLinked, SyncMismatch } from '../../lib/sync-check-types';
import { formatMoney } from '../../lib/format-money';
import { pairBadge } from '../../lib/match-badge';
import { useT } from '@/i18n';
import type { ResolveAction } from '@/lib/matches.api';
import { performResolve } from '@/lib/resolve-mismatch';
import { followInApp } from '@/lib/route';
import { checkIfEmpty, nextRowId, restoreAndRecheck, syncStore, useSyncCheck } from '@/lib/sync-check';
import { cn } from '@/lib/utils';
import { StatusBadge } from '../components/StatusBadge';
import { Badge } from '../components/ui/badge';
import { CreateActualModal } from '../components/dashboard/CreateActualModal';
import { CreateWallosModal } from '../components/dashboard/CreateWallosModal';
import { NoticeToast } from '../components/dashboard/NoticeToast';
import { RelinkDialog } from '../components/matches/RelinkDialog';
import { DiffModal } from '../components/matches/DiffModal';
import { UnlinkDialog } from '../components/matches/UnlinkDialog';
import { unlinkDialogMessages } from '../components/matches/UnlinkDialog.messages';
import { diffModalMessages, isOverwriteErrorCode } from '../components/matches/DiffModal.messages';
import { Button } from '../components/ui/button';
import { MoreActionsMenu } from '../components/ui/more-actions-menu';
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
  /** Opens the diff modal for a mismatch row by its match id. */
  onReview?: (matchId: string) => void;
  /** Recreate the missing side of a single-side orphan (opens the create modal with its match id). */
  onRecreate?: (row: SyncLinked) => void;
  /** Link a single-side orphan to another unlinked item. */
  onRelink?: (row: SyncLinked) => void;
  /** Unlink a Synced pair (opens the confirmation dialog). */
  onUnlink?: (row: SyncLinked) => void;
  /** Resolved text of the last failed unlink. */
  unlinkErrorMessage?: string | null;
  /** Case-insensitive name filter over both sides of a pair. */
  query?: string;
  onQueryChange?: (query: string) => void;
  /** Starts a sync check (the Run Sync Check button and the empty state). */
  onRun?: () => void;
  /** A sync check is running: shows the "Updating sync status" line. */
  checking?: boolean;
  /** Resolved text of the failed check, and the Retry handler. */
  checkErrorMessage?: string | null;
  onRetryCheck?: () => void;
}

const CELL = 'px-3 py-1.5 text-sm';
const HEAD = 'px-3 py-1.5 text-left text-xs font-medium text-muted';
/** Sticky header cells: level 1 at the top, level 2 below it (level 1 is h-8), both opaque. */
const STICKY_1 = 'sticky top-0 z-20 h-8 bg-card';
const STICKY_2 = 'sticky top-8 z-20 bg-card';
/** First column stays visible when the table scrolls sideways. */
const STICKY_COL = 'sticky left-0 z-10 bg-card';
const DASH = '—';

/** Renders a name or amount; a missing value (`muted`) shows the em dash in the muted colour. */
function Value({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <span className={muted ? 'text-muted' : undefined}>{children}</span>;
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
  onReview,
  onRecreate,
  onRelink,
  onUnlink,
  unlinkErrorMessage,
  query = '',
  onQueryChange,
  onRun,
  checking = false,
  checkErrorMessage,
  onRetryCheck,
}: MatchesViewProps) {
  const { t, locale } = useT(matchesMessages);
  const unlinkLabel = useT(diffModalMessages).t('unlink');
  const money = (cents: number | null, currency: string): string =>
    cents === null ? DASH : formatMoney(cents, currency, locale);
  const baseCurrency = result?.baseCurrency ?? '';
  const linked: readonly SyncLinked[] = result?.linked ?? [];
  const ignored: readonly SyncIgnored[] = result?.ignored ?? [];

  const q = query.trim().toLowerCase();
  const shown = q === '' ? linked : linked.filter((r) => `${r.wallosName ?? ''} ${r.actualName ?? ''}`.toLowerCase().includes(q));
  const differing = linked.filter((r) => r.status === 'MISMATCH_DETECTED').length;
  const amountsDiffer = (r: SyncLinked) =>
    r.wallosAmountCents !== null && r.actualAmountCents !== null && r.wallosAmountCents !== r.actualAmountCents;
  /** Amount cell: bold with a hidden "differs" when the two sides disagree, so colour is not the only cue. */
  const amountCell = (cents: number | null, differs: boolean) => (
    <td className={cn(CELL, 'border-b border-r text-right font-mono', differs && 'font-bold')}>
      <Value muted={cents === null}>{money(cents, baseCurrency)}</Value>
      {differs ? <span className="sr-only"> {t('differs')}</span> : null}
    </td>
  );

  const running = checking;
  const runButton = (label: string) => (
    <Button type="button" className="min-h-(--control-h) max-md:w-full" disabled={running} aria-busy={running} onClick={() => onRun?.()}>
      {running ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {label}
    </Button>
  );

  let body: ReactNode;
  if (linked.length === 0) {
    body = (
      <div className="rounded-lg border bg-card p-4">
        <p className="mb-3 text-sm text-muted">{t('empty')}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/sync"
            onClick={(e) => {
              followInApp(e, '/sync');
            }}
            className="inline-flex min-h-(--control-h) items-center rounded-md border border-input-border px-3 text-sm font-medium hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t('emptyActions.dashboard')}
          </a>
          {runButton(running ? t('emptyActions.running') : t('emptyActions.run'))}
        </div>
      </div>
    );
  } else if (shown.length === 0) {
    body = (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted">{t('noMatches')}</p>
        <Button
          type="button"
          variant="outline"
          className="min-h-(--control-h)"
          onClick={() => {
            onQueryChange?.('');
            document.querySelector<HTMLElement>('input[type="search"]')?.focus();
          }}
        >
          {t('clearSearch')}
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="rounded-lg border bg-card max-md:max-h-[70vh] max-md:overflow-auto">
        <table aria-label={t('table.label')} className="w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th scope="colgroup" colSpan={2} className={cn(HEAD, STICKY_1, STICKY_COL, 'z-30 border-b border-r')}>{t('table.wallosGroup')}</th>
              <th scope="colgroup" colSpan={2} className={cn(HEAD, STICKY_1, 'border-b border-r')}>{t('table.actualGroup')}</th>
              <th scope="col" rowSpan={2} className={cn(HEAD, STICKY_1, 'border-b')}>{t('table.status')}</th>
            </tr>
            <tr>
              <th scope="col" className={cn(HEAD, STICKY_2, STICKY_COL, 'z-30 border-b')}>{t('table.name')}</th>
              <th scope="col" className={cn(HEAD, STICKY_2, 'border-b border-r text-right')}>{t('table.amount')}</th>
              <th scope="col" className={cn(HEAD, STICKY_2, 'border-b')}>{t('table.name')}</th>
              <th scope="col" className={cn(HEAD, STICKY_2, 'border-b border-r text-right')}>{t('table.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => {
              const kind = pairBadge({ status: row.status, orphan: row.orphan });
              const differs = amountsDiffer(row);
              const label = row.wallosName ?? row.actualName ?? DASH;
              return (
                <tr key={`${row.wallosId}:${row.actualScheduleId}`} data-match-row data-linked-id={row.matchId} className="group">
                  <td className={cn(CELL, 'border-b font-medium', STICKY_COL)}>
                    <Value muted={row.wallosName === null}>{row.wallosName ?? DASH}</Value>
                  </td>
                  {amountCell(row.wallosAmountCents, differs)}
                  <td className={cn(CELL, 'border-b')}>
                    <Value muted={row.actualName === null}>{row.actualName ?? DASH}</Value>
                    {row.isRange ? (
                      <Badge variant="mismatch" className="ml-2" title={t('rangeHint')}>
                        {t('range')}
                      </Badge>
                    ) : null}
                  </td>
                  {amountCell(row.actualAmountCents, differs)}
                  <td className={cn(CELL, 'border-b')}>
                    <StatusBadge kind={kind} />
                    {row.status === 'MISMATCH_DETECTED' && onReview !== undefined ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="ml-2 min-h-(--control-h)"
                        data-review-for={row.matchId}
                        aria-label={t('reviewLabel', { name: label })}
                        onClick={() => { onReview(row.matchId); }}
                      >
                        {t('review')}
                      </Button>
                    ) : null}
                    {row.orphan === 'orphaned_wallos' || row.orphan === 'orphaned_actual' ? (
                      <MoreActionsMenu
                        name={label}
                        className="ml-1 align-middle"
                        items={[
                          {
                            id: 'recreate',
                            label: t(row.orphan === 'orphaned_wallos' ? 'orphan.recreateWallos' : 'orphan.recreateActual'),
                            onSelect: () => onRecreate?.(row),
                          },
                          { id: 'relink', label: t('orphan.link'), onSelect: () => onRelink?.(row) },
                        ]}
                      />
                    ) : null}
                    {row.status === 'LINKED' && row.orphan === null ? (
                      <MoreActionsMenu
                        name={label}
                        className="ml-1 align-middle"
                        items={[{ id: 'unlink', label: unlinkLabel, destructive: true, onSelect: () => onUnlink?.(row) }]}
                      />
                    ) : null}
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
        <input
          type="search"
          value={query}
          aria-label={t('search')}
          placeholder={t('searchPlaceholder')}
          onChange={(e) => onQueryChange?.(e.target.value)}
          className="min-h-(--control-h) w-56 rounded-md border border-input-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:w-full"
        />
        <label className="flex min-h-(--control-h) items-center gap-2 text-sm">
          <button
            type="button"
            role="switch"
            aria-checked={showIgnored}
            onClick={() => onShowIgnoredChange?.(!showIgnored)}
            className={cn(
              'relative h-5 w-9 shrink-0 rounded-full border border-input-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
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
        <div className="ml-auto max-md:w-full">{linked.length === 0 ? null : runButton(running ? t('emptyActions.running') : t('emptyActions.run'))}</div>
      </div>
      {linked.length === 0 ? null : (
        <p className="mb-2 text-xs text-muted">{t('counts', { shown: shown.length, total: linked.length, differing })}</p>
      )}
      <div role="status" aria-live="polite" className="mb-2 text-xs text-muted">
        {checking ? t('checking') : null}
      </div>
      {checkErrorMessage != null && !checking ? (
        <p role="alert" className="mb-2 flex flex-wrap items-center gap-2 text-xs text-warning">
          <span>{checkErrorMessage}</span>
          <Button type="button" size="xs" variant="outline" onClick={() => onRetryCheck?.()}>
            {t('retry')}
          </Button>
        </p>
      ) : null}
      {unlinkErrorMessage != null ? (
        <p role="alert" className="mb-2 text-xs text-warning">
          {unlinkErrorMessage}
        </p>
      ) : null}
      {body}
      {showIgnored && result !== null ? (
        <section aria-labelledby="matches-ignored-title" className="mt-6">
          <h2 id="matches-ignored-title" tabIndex={-1} data-ignored-heading className="mb-2 text-sm font-semibold outline-none">
            {t('ignored.title')}
          </h2>
          {ignored.length === 0 ? (
            <p className="text-sm text-muted">{t('ignored.none')}</p>
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
                    <tr key={`${row.side}:${row.itemId}`} data-ignored-row data-match-id={row.matchId} tabIndex={-1} className="border-b last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
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
                        <MoreActionsMenu
                          name={row.name ?? row.itemId}
                          items={[
                            {
                              id: 'restore',
                              label: t('ignored.restoreNamed', { name: row.name ?? row.itemId }),
                              disabled: busyId === row.matchId,
                              onSelect: () => onRestore?.(row.matchId),
                            },
                          ]}
                        />
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
  const [query, setQuery] = useState('');
  // The mismatch under review is held here, not looked up in the result: the optimistic resolve removes it
  // from the result at once, and the modal must stay open ("Working...") until the server answers.
  const [reviewing, setReviewing] = useState<SyncMismatch | null>(null);
  const [working, setWorking] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const modalT = useT(diffModalMessages).t;
  const [unlinking, setUnlinking] = useState<SyncLinked | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const unlinkT = useT(unlinkDialogMessages).t;
  const [orphanAction, setOrphanAction] = useState<{ kind: 'recreate' | 'relink'; row: SyncLinked } | null>(null);

  // Opening Matches with no result starts a check; the Dashboard never does this.
  useEffect(() => {
    checkIfEmpty(syncStore);
  }, []);

  const resolve = (matchId: string, action: ResolveAction) => {
    const name = reviewing?.wallosName ?? matchId;
    setWorking(true);
    setResolveError(null);
    void performResolve(() => syncStore.getState().result, syncStore.setResult, matchId, action, syncStore.requestRun).then((outcome) => {
      setWorking(false);
      if (outcome.ok) {
        setReviewing(null);
        return;
      }
      const reason =
        action.startsWith('overwrite_') && isOverwriteErrorCode(outcome.code)
          ? modalT(`overwriteErrors.${outcome.code}`)
          : errorText(outcome.code);
      setResolveError(`${modalT('failed', { name })} ${reason}`);
    });
  };

  /** Unlink a Synced pair after the confirmation. The server deletes only Walley's match row; the check then lists both items as unlinked. */
  const unlink = (row: SyncLinked) => {
    const name = row.wallosName ?? row.actualName ?? row.matchId;
    setUnlinkError(null);
    void performResolve(() => syncStore.getState().result, syncStore.setResult, row.matchId, 'unlink', syncStore.requestRun).then((outcome) => {
      if (outcome.ok) return;
      const stale = outcome.code === 'invalid_state' || outcome.code === 'match_not_found';
      setUnlinkError(`${unlinkT('failed', { name })} ${stale ? unlinkT('stale') : errorText(outcome.code)}`);
      // The pair changed elsewhere: show the current state.
      if (stale) void syncStore.requestRun();
    });
  };

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
    void restoreAndRecheck(syncStore, matchId).then((outcome) => {
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
    <>
    <MatchesView
      result={sync.result}
      showIgnored={showIgnored}
      onShowIgnoredChange={setShowIgnored}
      onRestore={restore}
      busyId={busyId}
      errorId={failed?.id ?? null}
      errorMessage={failed?.text ?? null}
      query={query}
      onQueryChange={setQuery}
      onRun={() => void sync.run()}
      onReview={(id) => {
        setResolveError(null);
        setReviewing(sync.result?.mismatches.find((m) => m.matchId === id) ?? null);
      }}
      checking={sync.status === 'loading'}
      checkErrorMessage={
        sync.status === 'error'
          ? t(sync.result === null ? 'loadFailed' : 'refreshFailed', { reason: errorText(sync.errorCode ?? 'request_failed') })
          : null
      }
      onRetryCheck={() => { void syncStore.requestRun(); }}
      onRecreate={(row) => { setOrphanAction({ kind: 'recreate', row }); }}
      onRelink={(row) => { setOrphanAction({ kind: 'relink', row }); }}
      onUnlink={(row) => { setUnlinking(row); }}
      unlinkErrorMessage={unlinkError}
    />
    <UnlinkDialog
      row={unlinking}
      onConfirm={unlink}
      onCancel={() => { setUnlinking(null); }}
    />
    {orphanAction?.kind === 'recreate' && orphanAction.row.orphan === 'orphaned_actual' ? (
      <CreateActualModal
        wallosId={orphanAction.row.wallosId}
        wallosName={orphanAction.row.wallosName ?? orphanAction.row.wallosId}
        matchId={orphanAction.row.matchId}
        onClose={() => { setOrphanAction(null); }}
      />
    ) : null}
    {orphanAction?.kind === 'recreate' && orphanAction.row.orphan === 'orphaned_wallos' ? (
      <CreateWallosModal
        scheduleId={orphanAction.row.actualScheduleId}
        scheduleName={orphanAction.row.actualName ?? orphanAction.row.actualScheduleId}
        matchId={orphanAction.row.matchId}
        onClose={() => { setOrphanAction(null); }}
      />
    ) : null}
    {orphanAction?.kind === 'relink' && (orphanAction.row.orphan === 'orphaned_wallos' || orphanAction.row.orphan === 'orphaned_actual') ? (
      <RelinkDialog
        matchId={orphanAction.row.matchId}
        name={(orphanAction.row.orphan === 'orphaned_actual' ? orphanAction.row.wallosName : orphanAction.row.actualName) ?? DASH}
        missingSide={orphanAction.row.orphan === 'orphaned_actual' ? 'actual' : 'wallos'}
        items={(orphanAction.row.orphan === 'orphaned_actual' ? sync.result?.unlinkedActual : sync.result?.unlinkedWallos) ?? []}
        candidateIds={orphanAction.row.relinkCandidateIds}
        baseCurrency={sync.result?.baseCurrency ?? ''}
        onClose={() => { setOrphanAction(null); }}
        onLinked={() => { void syncStore.requestRun(); }}
      />
    ) : null}
    <NoticeToast />
    <DiffModal
      mismatch={reviewing}
      baseCurrency={sync.result?.baseCurrency ?? ''}
      working={working}
      error={resolveError}
      onClose={() => { setReviewing(null); }}
      onIgnoreDiff={(id) => { resolve(id, 'ignore_diff'); }}
      onOverwrite={resolve}
      onUnlink={(id) => { resolve(id, 'unlink'); }}
    />
    </>
  );
}

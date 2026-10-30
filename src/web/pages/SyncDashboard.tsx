import { useCallback, useState } from 'react';
import { UnlinkDialog } from '@/components/matches/UnlinkDialog';
import { unlinkDialogMessages } from '@/components/matches/UnlinkDialog.messages';
import { NoticeToast } from '@/components/dashboard/NoticeToast';
import { IgnoredSection } from '@/components/dashboard/ItemRow';
import { PairList } from '@/components/dashboard/PairList';
import { HealthStatus } from '@/components/HealthStatus';
import { Toolbar } from '@/components/dashboard/Toolbar';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { useT } from '@/i18n';
import { buildPairRows, cellsOf } from '@/lib/pair-rows';
import { followInApp } from '@/lib/route';
import { failedSide, NOT_CONFIGURED_CODES } from '@/lib/sync-failure';
import {
  buildRows,
  nextRowId,
  performAction,
  syncStore,
  useSyncCheck,
  type RowAction,
  type RowModel,
  type Side,
  type SyncStoreState,
} from '@/lib/sync-check';
import { performResolve } from '@/lib/resolve-mismatch';
import type { SyncLinked } from '../../lib/sync-check-types';
import { syncDashboardMessages } from './SyncDashboard.messages';

export interface SyncDashboardViewProps {
  state: SyncStoreState;
  query: string;
  /** Ignored rows live in a disclosure; kept for callers that still pass it. Not a toolbar control any more. */
  showIgnored?: boolean;
  busyId?: string | null;
  errorRowId?: string | null;
  /** Resolved text of the last failed row action. */
  rowError?: string | null;
  /** Resolved text of the last failed unlink. */
  unlinkErrorMessage?: string | null;
  onQueryChange?: (query: string) => void;
  onRun?: () => void;
  onLink?: (wallosId: string, actualScheduleId: string, side: Side) => void;
  onIgnore?: (side: Side, itemId: string) => void;
  onRestore?: (side: Side, matchId: string, itemId: string) => void;
  /** Repeats the failed row action. */
  onRetryRow?: () => void;
  /** Opens the Unlink confirmation for a LINKED pair. */
  onUnlink?: (row: SyncLinked) => void;
}

function Skeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <span className="sr-only">{label}</span>
      {[0, 1].map((col) => (
        <div key={col} aria-hidden="true" className="rounded-lg border bg-card">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0">
              <div className="h-3 flex-1 animate-pulse rounded bg-surface-2" />
              <div className="h-3 w-14 animate-pulse rounded bg-surface-2" />
              <div className="h-7 w-16 animate-pulse rounded bg-surface-2" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Presentational dashboard: one toolbar, Wallos on the left, Actual on the right (a segmented switch below 768px). */
export function SyncDashboardView(props: SyncDashboardViewProps) {
  const { t, errorText } = useT(syncDashboardMessages);
  const [pane, setPane] = useState<Side>('wallos');
  const [ignoredOpen, setIgnoredOpen] = useState(false);
  const { state } = props;
  const result = state.result;
  const running = state.status === 'loading';
  const code = state.errorCode ?? 'request_failed';
  const notConfigured = state.status === 'error' && NOT_CONFIGURED_CODES.has(code);
  const failed = state.status === 'error' && !notConfigured;
  const side = failedSide(state.errorCode);

  let body;
  if (result === null) {
    if (state.status === 'loading') body = <Skeleton label={t('states.loading')} />;
    else if (state.status === 'error') body = null;
    else body = <p className="text-sm text-muted">{t('states.idle')}</p>;
  } else {
    const filtering = props.query.trim() !== '';
    const emptyText = filtering ? t('states.noMatches') : t('states.empty');
    const ignoredFor = (s: Side): RowModel[] => buildRows(result, s, props.query, true).filter((r) => r.ignored);
    const pairRows = buildPairRows(result, props.query);
    const wallosCount = cellsOf(pairRows, 'wallos').length;
    const actualCount = cellsOf(pairRows, 'actual').length;
    const errorInIgnored = props.errorRowId != null && [...ignoredFor('wallos'), ...ignoredFor('actual')].some((r) => r.id === props.errorRowId);
    const ignoredCommon = {
      baseCurrency: result.baseCurrency,
      busyId: props.busyId,
      errorRowId: props.errorRowId,
      errorText: props.rowError,
      open: ignoredOpen || errorInIgnored,
      onOpenChange: setIgnoredOpen,
      onLink: props.onLink,
      onIgnore: props.onIgnore,
      onRestore: props.onRestore,
      onRetry: props.onRetryRow,
    };
    body = (
      <div aria-busy={running}>
        {failed ? (
          <p className="mb-2">
            <Badge variant="mismatch">{t('failure.stale')}</Badge>{' '}
            <span className="text-xs text-muted">{t('failure.staleNote')}</span>
          </p>
        ) : null}
        <SegmentedControl
          className="mb-3 flex w-full md:hidden"
          aria-label={t('panes.label')}
          value={pane}
          onValueChange={(v) => {
            setPane(v === 'actual' ? 'actual' : 'wallos');
          }}
          options={[
            { value: 'wallos', label: t('panes.wallos', { count: wallosCount }) },
            { value: 'actual', label: t('panes.actual', { count: actualCount }) },
          ]}
        />
        <PairList
          rows={pairRows}
          pane={pane}
          baseCurrency={result.baseCurrency}
          candidates={result.candidates}
          emptyText={emptyText}
          wallosTitle={t('columns.wallos')}
          actualTitle={t('columns.actual')}
          wallosCount={wallosCount}
          actualCount={actualCount}
          linkedTotal={result.linked.length}
          busyId={props.busyId}
          errorRowId={props.errorRowId}
          errorText={props.rowError}
          onLink={props.onLink}
          onIgnore={props.onIgnore}
          onRestore={props.onRestore}
          onRetry={props.onRetryRow}
          onUnlink={props.onUnlink}
        />
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <IgnoredSection
            {...ignoredCommon}
            side="wallos"
            title={t('columns.wallos')}
            createLabel={t('row.createInActual')}
            rows={ignoredFor('wallos')}
            className={pane === 'wallos' ? '' : 'max-md:hidden'}
          />
          <IgnoredSection
            {...ignoredCommon}
            side="actual"
            title={t('columns.actual')}
            createLabel={t('row.createInWallos')}
            rows={ignoredFor('actual')}
            className={pane === 'actual' ? '' : 'max-md:hidden'}
          />
        </div>
      </div>
    );
  }

  const settingsLink = (
    <a
      href="/settings"
      onClick={(e) => {
        followInApp(e, '/settings');
      }}
      className="inline-flex min-h-(--control-h) items-center rounded-md border border-input-border px-3 text-sm font-medium hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {t('failure.checkSettings')}
    </a>
  );

  return (
    <section aria-labelledby="sync-title">
      <h1 id="sync-title" className="mb-3 text-lg font-semibold">
        {t('title')}
      </h1>
      <Toolbar query={props.query} running={running} onQueryChange={props.onQueryChange} onRun={props.onRun} />
      {state.status === 'loading' && result !== null ? (
        <p role="status" className="mb-2 text-xs text-muted">
          {t('states.loading')}
        </p>
      ) : null}
      {notConfigured ? (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Alert variant="warning" className="flex-1">
            {errorText(code)}
          </Alert>
          {settingsLink}
        </div>
      ) : null}
      {failed ? (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Alert variant="error" className="flex-1">
            {side === null ? t('states.errorTitle') : t(`failure.${side}`)} {errorText(code)}
          </Alert>
          <Button type="button" variant="outline" className="min-h-(--control-h)" onClick={props.onRun}>
            {t('failure.retry')}
          </Button>
          {settingsLink}
        </div>
      ) : null}
      {props.unlinkErrorMessage != null ? (
        <p role="alert" className="mb-2 text-xs text-danger">
          {props.unlinkErrorMessage}
        </p>
      ) : null}
      {body}
      <HealthStatus />
    </section>
  );
}

function focusAfter(side: Side, id: string | null) {
  requestAnimationFrame(() => {
    const target =
      id === null ? null : document.querySelector<HTMLElement>(`[data-side="${side}"][data-row-id="${CSS.escape(id)}"]`);
    (target ?? document.querySelector<HTMLElement>('[data-pairs]'))?.focus();
  });
}

/** Sync Dashboard page. It never runs the check on mount; the user or Manual Refresh does. */
export function SyncDashboard() {
  const { t, errorText } = useT(syncDashboardMessages);
  const sync = useSyncCheck();
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; side: Side; action: RowAction; text: string } | null>(null);
  const [unlinking, setUnlinking] = useState<SyncLinked | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const unlinkT = useT(unlinkDialogMessages).t;

  /** Unlink a pair after the confirmation. The server deletes only Walley's match row; the check then lists both items as unlinked. */
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

  const act = useCallback(
    (side: Side, id: string, action: RowAction) => {
      const result = sync.result;
      if (result === null) return;
      const ids = [
        ...cellsOf(buildPairRows(result, query), side).map((r) => r.id),
        ...buildRows(result, side, query, true).filter((r) => r.ignored).map((r) => r.id),
      ];
      const next = nextRowId(ids, id);
      setBusyId(id);
      setFailed(null);
      void performAction(() => syncStore.getState().result, syncStore.setResult, action).then((outcome) => {
        setBusyId(null);
        if (outcome.ok) {
          focusAfter(side, next);
        } else {
          const name = buildRows(result, side, '', true).find((r) => r.id === id)?.name ?? id;
          setFailed({ id, side, action, text: `${t('row.actionFailed', { name })} ${errorText(outcome.code)}` });
          focusAfter(side, id);
        }
      });
    },
    [sync, query, t, errorText],
  );

  return (
    <>
    <SyncDashboardView
      state={sync}
      query={query}
      busyId={busyId}
      errorRowId={failed?.id ?? null}
      rowError={failed?.text ?? null}
      unlinkErrorMessage={unlinkError}
      onUnlink={(row) => { setUnlinking(row); }}
      onQueryChange={setQuery}
      onRun={() => void sync.run()}
      onRetryRow={failed === null ? undefined : () => {
        act(failed.side, failed.id, failed.action);
      }}
      onLink={(w, a, side) => {
        act(side, side === 'wallos' ? w : a, { kind: 'link', wallosId: w, actualScheduleId: a });
      }}
      onIgnore={(side, id) => {
        act(side, id, { kind: 'ignore', side, itemId: id });
      }}
      onRestore={(side, matchId, id) => {
        act(side, id, { kind: 'restore', matchId });
      }}
    />
    <UnlinkDialog
      row={unlinking}
      onConfirm={(row) => {
        setUnlinking(null);
        unlink(row);
      }}
      onCancel={() => { setUnlinking(null); }}
    />
    <NoticeToast />
    </>
  );
}

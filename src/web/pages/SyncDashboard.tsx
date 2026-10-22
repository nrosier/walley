import { useCallback, useState } from 'react';
import { ActualColumn } from '@/components/dashboard/ActualColumn';
import { HealthStatus } from '@/components/HealthStatus';
import { Toolbar } from '@/components/dashboard/Toolbar';
import { WallosColumn } from '@/components/dashboard/WallosColumn';
import { useT } from '@/i18n';
import {
  buildRows,
  nextRowId,
  performAction,
  useSyncCheck,
  type RowAction,
  type Side,
  type SyncStoreState,
} from '@/lib/sync-check';
import { syncDashboardMessages } from './SyncDashboard.messages';

export interface SyncDashboardViewProps {
  state: SyncStoreState;
  query: string;
  showIgnored: boolean;
  busyId?: string | null;
  errorRowId?: string | null;
  /** Resolved text of the last failed row action. */
  rowError?: string | null;
  onQueryChange?: (query: string) => void;
  onShowIgnoredChange?: (on: boolean) => void;
  onRun?: () => void;
  onLink?: (wallosId: string, actualScheduleId: string, side: Side) => void;
  onIgnore?: (side: Side, itemId: string) => void;
}

/** Presentational dashboard: one toolbar, Wallos on the left, Actual on the right. */
export function SyncDashboardView(props: SyncDashboardViewProps) {
  const { t, errorText } = useT(syncDashboardMessages);
  const { state } = props;
  const result = state.result;
  const running = state.status === 'loading';

  let body;
  if (result === null) {
    if (state.status === 'loading') {
      body = (
        <p role="status" className="text-sm text-muted-foreground">
          {t('states.loading')}
        </p>
      );
    } else if (state.status === 'error') {
      body = null;
    } else {
      body = <p className="text-sm text-muted-foreground">{t('states.idle')}</p>;
    }
  } else {
    const filtering = props.query.trim() !== '';
    const emptyText = filtering ? t('states.noMatches') : t('states.empty');
    const common = {
      baseCurrency: result.baseCurrency,
      candidates: result.candidates,
      emptyText,
      busyId: props.busyId,
      errorRowId: props.errorRowId,
      errorText: props.rowError,
      onLink: props.onLink,
      onIgnore: props.onIgnore,
    };
    body = (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-busy={running}>
        <WallosColumn {...common} rows={buildRows(result, 'wallos', props.query, props.showIgnored)} />
        <ActualColumn {...common} rows={buildRows(result, 'actual', props.query, props.showIgnored)} />
      </div>
    );
  }

  return (
    <section aria-labelledby="sync-title">
      <h1 id="sync-title" className="mb-3 text-lg font-semibold">
        {t('title')}
      </h1>
      <Toolbar
        query={props.query}
        showIgnored={props.showIgnored}
        running={running}
        onQueryChange={props.onQueryChange}
        onShowIgnoredChange={props.onShowIgnoredChange}
        onRun={props.onRun}
      />
      {state.status === 'loading' && result !== null ? (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          {t('states.loading')}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p role="alert" className="mb-3 text-sm text-warning">
          {t('states.errorTitle')} {errorText(state.errorCode ?? 'request_failed')}
        </p>
      ) : null}
      {body}
      <HealthStatus />
    </section>
  );
}

function focusAfter(side: Side, id: string | null) {
  requestAnimationFrame(() => {
    const col = document.querySelector<HTMLElement>(`[data-column="${side}"]`);
    const target = id === null ? null : col?.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(id)}"]`);
    (target ?? col)?.focus();
  });
}

/** Sync Dashboard page. It never runs the check on mount; the user or Manual Refresh does. */
export function SyncDashboard() {
  const { t, errorText } = useT(syncDashboardMessages);
  const sync = useSyncCheck();
  const [query, setQuery] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ id: string; text: string } | null>(null);

  const act = useCallback(
    (side: Side, id: string, action: RowAction) => {
      const result = sync.result;
      if (result === null) return;
      const ids = buildRows(result, side, query, showIgnored).map((r) => r.id);
      const next = nextRowId(ids, id);
      setBusyId(id);
      setFailed(null);
      let latest = result;
      void performAction(
        () => latest,
        (r) => {
          latest = r;
          sync.setResult(r);
        },
        action,
      ).then((outcome) => {
        setBusyId(null);
        if (outcome.ok) {
          focusAfter(side, next);
        } else {
          const name = buildRows(result, side, '', true).find((r) => r.id === id)?.name ?? id;
          setFailed({ id, text: `${t('row.actionFailed', { name })} ${errorText(outcome.code)}` });
          focusAfter(side, id);
        }
      });
    },
    [sync, query, showIgnored, t, errorText],
  );

  return (
    <SyncDashboardView
      state={sync}
      query={query}
      showIgnored={showIgnored}
      busyId={busyId}
      errorRowId={failed?.id ?? null}
      rowError={failed?.text ?? null}
      onQueryChange={setQuery}
      onShowIgnoredChange={setShowIgnored}
      onRun={() => void sync.run()}
      onLink={(w, a, side) => {
        act(side, side === 'wallos' ? w : a, { kind: 'link', wallosId: w, actualScheduleId: a });
      }}
      onIgnore={(side, id) => {
        act(side, id, { kind: 'ignore', side, itemId: id });
      }}
    />
  );
}

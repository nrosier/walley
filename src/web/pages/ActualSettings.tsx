import { useEffect, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { ApiError, apiRequest } from '@/lib/api';
import {
  fetchBaseCurrency,
  fetchBudgets,
  saveActualSettings,
  saveBudgetChoice,
  viewStateFrom,
  type ActualSettingsData,
  type BudgetOption,
} from './ActualSettings.api';
import { actualSettingsMessages } from './ActualSettings.messages';
import { settingsPageMessages } from './SettingsPage.messages';

const FIELD =
  'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

type Status = { kind: 'none' } | { kind: 'busy'; text: 'saving' | 'loadingBudgets' } | { kind: 'ok'; text: 'saved' | 'budgetSaved' } | { kind: 'error'; code: string };

export interface ActualSettingsViewProps {
  url: string;
  password: string;
  syncKey: string;
  clearSyncKey: boolean;
  hasPassword: boolean;
  hasSyncKey: boolean;
  budgetId: string | null;
  /** null: budgets not loaded yet. */
  budgets: BudgetOption[] | null;
  /** undefined: not detected; null: detected but no currency. */
  currency?: string | null;
  detecting?: boolean;
  status?: Status;
  onUrl?: (value: string) => void;
  onPassword?: (value: string) => void;
  onSyncKey?: (value: string) => void;
  onClearSyncKey?: (value: boolean) => void;
  onSave?: () => void;
  onLoadBudgets?: () => void;
  onPickBudget?: (id: string) => void;
}

/** Presentational form. Secret inputs only ever hold what the user types. */
export function ActualSettingsView(props: ActualSettingsViewProps) {
  const { t, errorText } = useT(actualSettingsMessages);
  const { t: tPage } = useT(settingsPageMessages);
  const status = props.status ?? { kind: 'none' };
  const busy = status.kind === 'busy';
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    props.onSave?.();
  };
  let statusText = '';
  if (status.kind === 'busy' || status.kind === 'ok') statusText = t(status.text);
  if (status.kind === 'error') {
    if (status.code === 'password_required') statusText = t('errors.password_required');
    else if (status.code === 'load_failed') statusText = t('loadFailed');
    else statusText = errorText(status.code);
  }
  return (
    <form onSubmit={submit} className="max-w-md space-y-3" aria-labelledby="actual-settings-heading">
      <h2 id="actual-settings-heading" className="text-sm font-semibold">
        {tPage('sections.actual')}
      </h2>
      <div className="space-y-1">
        <label htmlFor="actual-url" className="text-xs font-medium">
          {t('url')}
        </label>
        <input
          id="actual-url"
          name="actualUrl"
          type="url"
          className={FIELD}
          value={props.url}
          onChange={(e) => props.onUrl?.(e.target.value)}
          autoComplete="off"
          required
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="actual-password" className="text-xs font-medium">
          {t('password')}
          {props.hasPassword ? <span className="ml-2 text-success">{t('savedBadge')}</span> : null}
        </label>
        <input
          id="actual-password"
          name="password"
          type="password"
          className={FIELD}
          value={props.password}
          onChange={(e) => props.onPassword?.(e.target.value)}
          placeholder={props.hasPassword ? t('savedKeep') : ''}
          autoComplete="new-password"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="actual-sync-key" className="text-xs font-medium">
          {t('syncKey')}
          {props.hasSyncKey ? <span className="ml-2 text-success">{t('savedBadge')}</span> : null}
        </label>
        <input
          id="actual-sync-key"
          name="syncKey"
          type="password"
          className={FIELD}
          value={props.syncKey}
          onChange={(e) => props.onSyncKey?.(e.target.value)}
          placeholder={props.hasSyncKey ? t('savedKeep') : ''}
          autoComplete="new-password"
        />
        {props.hasSyncKey ? (
          <label htmlFor="actual-clear-sync-key" className="flex items-center gap-2 text-xs">
            <input
              id="actual-clear-sync-key"
              name="clearSyncKey"
              type="checkbox"
              checked={props.clearSyncKey}
              disabled={props.syncKey.trim() !== ''}
              onChange={(e) => props.onClearSyncKey?.(e.target.checked)}
            />
            {t('clearSyncKey')}
          </label>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {status.kind === 'busy' && status.text === 'saving' ? t('saving') : t('save')}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={props.onLoadBudgets}>
          {t('loadBudgets')}
        </Button>
      </div>
      {props.budgets !== null ? (
        props.budgets.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('noBudgets')}</p>
        ) : (
          <div className="space-y-1">
            <label htmlFor="actual-budget" className="text-xs font-medium">
              {t('budget')}
            </label>
            <select
              id="actual-budget"
              name="actualBudgetId"
              className={FIELD}
              value={props.budgetId ?? ''}
              disabled={busy}
              onChange={(e) => props.onPickBudget?.(e.target.value)}
            >
              <option value="" disabled>
                {t('budgetChoose')}
              </option>
              {props.budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )
      ) : null}
      {props.budgetId !== null ? (
        <p className="text-xs">
          <span className="text-muted-foreground">{t('baseCurrency')}: </span>
          {props.detecting === true ? (
            <span className="text-muted-foreground">{t('detecting')}</span>
          ) : props.currency === undefined ? null : props.currency === null ? (
            <span className="text-muted-foreground">{t('notSet')}</span>
          ) : (
            <span className="font-mono">{props.currency}</span>
          )}
        </p>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={`min-h-4 text-xs ${status.kind === 'error' ? 'text-warning' : status.kind === 'ok' ? 'text-success' : ''}`}
      >
        {statusText}
      </p>
    </form>
  );
}

export function ActualSettings() {
  const [url, setUrl] = useState('');
  const [savedUrl, setSavedUrl] = useState('');
  const [password, setPassword] = useState('');
  const [syncKey, setSyncKey] = useState('');
  const [clearSyncKey, setClearSyncKey] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [hasSyncKey, setHasSyncKey] = useState(false);
  const [budgetId, setBudgetId] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<BudgetOption[] | null>(null);
  const [currency, setCurrency] = useState<string | null | undefined>(undefined);
  const [detecting, setDetecting] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'none' });

  /** Copies only the non-secret fields and the saved flags from a response. */
  const apply = (response: ActualSettingsData) => {
    const data = viewStateFrom(response);
    setUrl(data.actualUrl);
    setSavedUrl(data.actualUrl);
    setBudgetId(data.actualBudgetId);
    setHasPassword(data.hasActualPassword);
    setHasSyncKey(data.hasActualSyncKey);
  };
  const fail = (error: unknown) => {
    setStatus({ kind: 'error', code: error instanceof ApiError ? error.code : 'request_failed' });
  };

  const detect = () => {
    setDetecting(true);
    setCurrency(undefined);
    fetchBaseCurrency()
      .then(setCurrency)
      .catch(fail)
      .finally(() => {
        setDetecting(false);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<ActualSettingsData>('/api/settings/actual', { signal: controller.signal })
      .then((data) => {
        apply(data);
        if (data.actualBudgetId !== null) detect();
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus({ kind: 'error', code: 'load_failed' });
      });
    return () => {
      controller.abort();
    };
    // Runs once on mount; apply and detect only call state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    setStatus({ kind: 'busy', text: 'saving' });
    saveActualSettings({ url, password, syncKey, clearSyncKey })
      .then((data) => {
        const urlChanged = data.actualUrl !== savedUrl;
        apply(data);
        setPassword('');
        setSyncKey('');
        setClearSyncKey(false);
        if (urlChanged) {
          setBudgets(null);
          setCurrency(undefined);
        }
        setStatus({ kind: 'ok', text: 'saved' });
      })
      .catch(fail);
  };

  const loadBudgets = () => {
    setStatus({ kind: 'busy', text: 'loadingBudgets' });
    fetchBudgets()
      .then((list) => {
        setBudgets(list);
        setStatus({ kind: 'none' });
      })
      .catch(fail);
  };

  const pickBudget = (id: string) => {
    setStatus({ kind: 'busy', text: 'saving' });
    saveBudgetChoice(savedUrl, id)
      .then((data) => {
        apply(data);
        setStatus({ kind: 'ok', text: 'budgetSaved' });
        detect();
      })
      .catch(fail);
  };

  return (
    <ActualSettingsView
      url={url}
      password={password}
      syncKey={syncKey}
      clearSyncKey={clearSyncKey}
      hasPassword={hasPassword}
      hasSyncKey={hasSyncKey}
      budgetId={budgetId}
      budgets={budgets}
      currency={currency}
      detecting={detecting}
      status={status}
      onUrl={setUrl}
      onPassword={setPassword}
      onSyncKey={setSyncKey}
      onClearSyncKey={setClearSyncKey}
      onSave={save}
      onLoadBudgets={loadBudgets}
      onPickBudget={pickBudget}
    />
  );
}

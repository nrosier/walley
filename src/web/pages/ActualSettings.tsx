import { useEffect, useState, type SyntheticEvent } from 'react';
import { SaveFooter, SettingsCard } from '@/components/settings/SettingsCard';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { ApiError, apiRequest } from '@/lib/api';
import { syncStore } from '@/lib/sync-check';
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
  'min-h-(--control-h) w-full rounded-md border border-input-border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

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
  /** Anything in the card (URL, a typed secret, sync-key removal, budget pick) differs from what is saved. */
  dirty?: boolean;
  /** The picked budget is not saved yet. */
  budgetDirty?: boolean;
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
    <SettingsCard
      id="settings-actual"
      headingId="actual-settings-heading"
      title={tPage('sections.actual')}
      scope="account"
      footer={
        <SaveFooter
          formId="actual-settings-form"
          dirty={props.dirty === true}
          busy={busy}
          label={status.kind === 'busy' && status.text === 'saving' ? t('saving') : t('save')}
        />
      }
    >
    <form id="actual-settings-form" onSubmit={submit} className="max-w-md space-y-3" aria-labelledby="actual-settings-heading">
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
      <Button type="button" variant="outline" className="min-h-(--control-h)" disabled={busy} onClick={props.onLoadBudgets}>
        {t('loadBudgets')}
      </Button>
      {props.budgets !== null ? (
        props.budgets.length === 0 ? (
          <p className="text-xs text-muted">{t('noBudgets')}</p>
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
            {props.budgetDirty === true ? <p className="text-xs text-muted">{t('budgetPending')}</p> : null}
          </div>
        )
      ) : null}
      {props.budgetId !== null ? (
        <p className="text-xs">
          <span className="text-muted">{t('baseCurrency')}: </span>
          {props.detecting === true ? (
            <span className="text-muted">{t('detecting')}</span>
          ) : props.currency === undefined ? null : props.currency === null ? (
            <span className="text-muted">{t('notSet')}</span>
          ) : (
            <span className="font-mono">{props.currency}</span>
          )}
        </p>
      ) : null}
      <p
        role="status"
        aria-live="polite"
        className={`min-h-4 text-xs ${status.kind === 'error' ? 'text-danger' : status.kind === 'ok' ? 'text-success' : ''}`}
      >
        {statusText}
      </p>
    </form>
    </SettingsCard>
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
  const [savedBudgetId, setSavedBudgetId] = useState<string | null>(null);
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
    setSavedBudgetId(data.actualBudgetId);
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

  const credentialsDirty = url !== savedUrl || password !== '' || syncKey !== '' || clearSyncKey;
  const budgetDirty = budgetId !== savedBudgetId;

  /** Saves the picked budget through the existing budget-choice request, then re-detects the currency. */
  const saveBudget = (id: string) =>
    saveBudgetChoice(savedUrl, id).then((data) => {
      apply(data);
      detect();
    });

  /**
   * The card's one Save. Credentials go through the settings PUT; a changed budget pick goes through the
   * budget-choice PUT (both existing request shapes). A new URL clears the budget on the server, so the pick
   * is only sent while the URL is unchanged.
   */
  const save = () => {
    setStatus({ kind: 'busy', text: 'saving' });
    const pick = budgetDirty && budgetId !== null && url === savedUrl ? budgetId : null;
    const credentials = credentialsDirty || pick === null
      ? saveActualSettings({ url, password, syncKey, clearSyncKey }).then((data) => {
          const urlChanged = data.actualUrl !== savedUrl;
          apply(data);
          setPassword('');
          setSyncKey('');
          setClearSyncKey(false);
          if (urlChanged) {
            setBudgets(null);
            setCurrency(undefined);
          }
        })
      : Promise.resolve();
    credentials
      .then(() => (pick === null ? undefined : saveBudget(pick)))
      .then(() => {
        setStatus({ kind: 'ok', text: pick === null ? 'saved' : 'budgetSaved' });
        // The dashboard shows the last check (maybe "not set up"); refresh it for the new settings.
        void syncStore.requestRun();
      })
      .catch(fail);
  };

  const loadBudgets = () => {
    setStatus({ kind: 'busy', text: 'loadingBudgets' });
    fetchBudgets({ url, password, syncKey })
      .then((list) => {
        setBudgets(list);
        setStatus({ kind: 'none' });
      })
      .catch(fail);
  };

  // A pick only changes the form; the card's Save sends it.
  const pickBudget = (id: string) => {
    setBudgetId(id);
    setStatus({ kind: 'none' });
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
      dirty={credentialsDirty || budgetDirty}
      budgetDirty={budgetDirty}
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

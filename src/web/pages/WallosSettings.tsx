import { useEffect, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { ApiError, apiRequest } from '@/lib/api';
import { wallosSettingsMessages } from './WallosSettings.messages';

interface WallosSettingsData {
  wallosUrl: string;
  hasWallosApiKey: boolean;
}

export type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'error'; code: string };

/** A status line for the live region. Tone picks the theme colour. */
export interface Notice {
  tone: 'success' | 'warning';
  text: string;
}

const FIELD =
  'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** Only url and hasKey are taken from a response. The key itself is never read back. */
// Exported for tests; the module is otherwise a component file.
// eslint-disable-next-line react-refresh/only-export-components
export function loadedSettings(data: WallosSettingsData): { url: string; hasKey: boolean } {
  return { url: data.wallosUrl, hasKey: data.hasWallosApiKey };
}

/** Calls the test endpoint, which uses the saved credentials only, and maps the outcome to a TestState. */
// eslint-disable-next-line react-refresh/only-export-components
export async function runConnectionTest(fetchImpl?: typeof fetch): Promise<TestState> {
  try {
    await apiRequest('/api/settings/wallos/test', { method: 'POST', fetchImpl });
    return { kind: 'ok' };
  } catch (error: unknown) {
    return { kind: 'error', code: error instanceof ApiError ? error.code : 'request_failed' };
  }
}

export interface WallosSettingsViewProps {
  url: string;
  apiKey: string;
  hasKey: boolean;
  saving?: boolean;
  saveNotice?: Notice | null;
  test?: TestState;
  onUrl?: (value: string) => void;
  onApiKey?: (value: string) => void;
  onSave?: () => void;
  onTest?: () => void;
}

/** Presentational form. The key input is never prefilled: it only ever holds what the user types. */
export function WallosSettingsView(props: WallosSettingsViewProps) {
  const { t, errorText } = useT(wallosSettingsMessages);
  const test = props.test ?? { kind: 'idle' };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    props.onSave?.();
  };
  const testNotice: Notice | null =
    test.kind === 'ok'
      ? { tone: 'success', text: t('status.testOk') }
      : test.kind === 'error'
        ? { tone: 'warning', text: errorText(test.code) }
        : null;
  return (
    <form onSubmit={submit} className="max-w-md space-y-3" aria-labelledby="wallos-settings-title">
      <h2 id="wallos-settings-title" className="text-sm font-semibold">
        {t('title')}
      </h2>
      <div className="space-y-1">
        <label htmlFor="wallos-url" className="text-xs font-medium">
          {t('fields.url')}
        </label>
        <input
          id="wallos-url"
          name="wallosUrl"
          type="url"
          className={FIELD}
          value={props.url}
          onChange={(e) => props.onUrl?.(e.target.value)}
          autoComplete="off"
          required
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="wallos-api-key" className="text-xs font-medium">
          {t('fields.apiKey')}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="wallos-api-key"
            name="apiKey"
            type="password"
            className={FIELD}
            value={props.apiKey}
            onChange={(e) => props.onApiKey?.(e.target.value)}
            autoComplete="new-password"
          />
          {props.hasKey && props.apiKey === '' ? (
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{t('apiKeySaved')}</span>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('help')}</p>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={props.saving === true}>
          {props.saving === true ? t('actions.saving') : t('actions.save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={test.kind === 'testing'}
          onClick={props.onTest}
        >
          {test.kind === 'testing' ? t('actions.testing') : t('actions.test')}
        </Button>
      </div>
      <div role="status" aria-live="polite" className="min-h-4 space-y-1 text-xs">
        {props.saveNotice ? <p className={noticeClass(props.saveNotice)}>{props.saveNotice.text}</p> : null}
        {testNotice ? <p className={noticeClass(testNotice)}>{testNotice.text}</p> : null}
      </div>
    </form>
  );
}

function noticeClass(notice: Notice): string {
  return notice.tone === 'success' ? 'text-success' : 'text-warning';
}

export function WallosSettings() {
  const { t, errorText } = useT(wallosSettingsMessages);
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<Notice | null>(null);
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<WallosSettingsData>('/api/settings/wallos', { signal: controller.signal })
      .then((data) => {
        const loaded = loadedSettings(data);
        setUrl(loaded.url);
        setHasKey(loaded.hasKey);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSaveNotice({ tone: 'warning', text: t('status.loadFailed') });
      });
    return () => {
      controller.abort();
    };
    // The message lookup is stable for the active locale; reload is not wanted on language change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    setSaving(true);
    setSaveNotice(null);
    setTest({ kind: 'idle' });
    apiRequest<WallosSettingsData>('/api/settings/wallos', {
      method: 'PUT',
      body: { wallosUrl: url, apiKey },
    })
      .then((data) => {
        const loaded = loadedSettings(data);
        setUrl(loaded.url);
        setHasKey(loaded.hasKey);
        setApiKey('');
        setSaveNotice({ tone: 'success', text: t('status.saved') });
      })
      .catch((error: unknown) => {
        const code = error instanceof ApiError ? error.code : '';
        setSaveNotice({
          tone: 'warning',
          text: code === 'invalid_url' ? errorText(code) : t('status.saveFailed'),
        });
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const runTest = () => {
    setTest({ kind: 'testing' });
    void runConnectionTest().then(setTest);
  };

  return (
    <WallosSettingsView
      url={url}
      apiKey={apiKey}
      hasKey={hasKey}
      saving={saving}
      saveNotice={saveNotice}
      test={test}
      onUrl={setUrl}
      onApiKey={setApiKey}
      onSave={save}
      onTest={runTest}
    />
  );
}

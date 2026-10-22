import { useEffect, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError, apiRequest } from '@/lib/api';

interface WallosSettingsData {
  wallosUrl: string;
  hasWallosApiKey: boolean;
}

export type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'error'; code: string };

const TEST_MESSAGES: Record<string, string> = {
  wallos_auth_failed: 'Wallos rejected the API key.',
  wallos_unavailable: 'Wallos could not be reached.',
  wallos_not_configured: 'Save a Wallos URL and API key first.',
};

const SAVE_MESSAGES: Record<string, string> = {
  invalid_url: 'Use an https URL (http only for localhost) without credentials or a query.',
};

const FIELD =
  'h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

export interface WallosSettingsViewProps {
  url: string;
  apiKey: string;
  hasKey: boolean;
  saving?: boolean;
  saveMessage?: string;
  test?: TestState;
  onUrl?: (value: string) => void;
  onApiKey?: (value: string) => void;
  onSave?: () => void;
  onTest?: () => void;
}

/** Presentational form. The key input is never prefilled: it only ever holds what the user types. */
export function WallosSettingsView(props: WallosSettingsViewProps) {
  const test = props.test ?? { kind: 'idle' };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    props.onSave?.();
  };
  return (
    <form onSubmit={submit} className="max-w-md space-y-3" aria-labelledby="wallos-settings-title">
      <h2 id="wallos-settings-title" className="text-sm font-semibold">
        Wallos
      </h2>
      <div className="space-y-1">
        <label htmlFor="wallos-url" className="text-xs font-medium">
          Wallos URL
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
          Wallos API key
        </label>
        <input
          id="wallos-api-key"
          name="apiKey"
          type="password"
          className={FIELD}
          value={props.apiKey}
          onChange={(e) => props.onApiKey?.(e.target.value)}
          placeholder={props.hasKey ? 'Saved - leave blank to keep' : ''}
          autoComplete="new-password"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={props.saving === true}>
          {props.saving === true ? 'Saving...' : 'Save'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={test.kind === 'testing'}
          onClick={props.onTest}
        >
          {test.kind === 'testing' ? 'Testing...' : 'Test Connection'}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs">
        {props.saveMessage ?? ''}
        {test.kind === 'ok' ? ' Connection OK.' : ''}
        {test.kind === 'error' ? ` ${TEST_MESSAGES[test.code] ?? 'Connection test failed.'}` : ''}
      </p>
    </form>
  );
}

export function WallosSettings() {
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<WallosSettingsData>('/api/settings/wallos', { signal: controller.signal })
      .then((data) => {
        setUrl(data.wallosUrl);
        setHasKey(data.hasWallosApiKey);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSaveMessage('Could not load settings.');
      });
    return () => {
      controller.abort();
    };
  }, []);

  const save = () => {
    setSaving(true);
    setSaveMessage('');
    setTest({ kind: 'idle' });
    apiRequest<WallosSettingsData>('/api/settings/wallos', {
      method: 'PUT',
      body: { wallosUrl: url, apiKey },
    })
      .then((data) => {
        setUrl(data.wallosUrl);
        setHasKey(data.hasWallosApiKey);
        setApiKey('');
        setSaveMessage('Saved.');
      })
      .catch((error: unknown) => {
        const code = error instanceof ApiError ? error.code : '';
        setSaveMessage(SAVE_MESSAGES[code] ?? 'Could not save settings.');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const runTest = () => {
    setTest({ kind: 'testing' });
    apiRequest('/api/settings/wallos/test', { method: 'POST' })
      .then(() => {
        setTest({ kind: 'ok' });
      })
      .catch((error: unknown) => {
        setTest({ kind: 'error', code: error instanceof ApiError ? error.code : 'request_failed' });
      });
  };

  return (
    <WallosSettingsView
      url={url}
      apiKey={apiKey}
      hasKey={hasKey}
      saving={saving}
      saveMessage={saveMessage}
      test={test}
      onUrl={setUrl}
      onApiKey={setApiKey}
      onSave={save}
      onTest={runTest}
    />
  );
}

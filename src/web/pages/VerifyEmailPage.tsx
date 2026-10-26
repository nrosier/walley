import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { apiRequest, ApiError } from '@/lib/api';
import { verifyEmailPageMessages } from './VerifyEmailPage.messages';

export type VerifyState =
  | { kind: 'form'; wrongPassword?: boolean }
  | { kind: 'verifying' }
  | { kind: 'success' }
  | { kind: 'invalid' }
  | { kind: 'legacy' }
  | { kind: 'disabled' }
  | { kind: 'missing' }
  | { kind: 'error'; code: string };

/** Reads the token from a hash such as `#token=abc`. Returns null when absent or empty. */
function readToken(hash: string): string | null {
  const token = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('token');
  return token === null || token === '' ? null : token;
}

/** Takes the token from the hash and clears the hash. The token is only ever held in memory afterwards. */
// eslint-disable-next-line react-refresh/only-export-components
export function takeToken(hash: string, clearHash: () => void): string | null {
  const token = readToken(hash);
  clearHash();
  return token;
}

export interface VerifyOptions {
  token: string;
  /** The password chosen at registration. The server checks it against the hash the token carries. */
  password: string;
  fetchImpl?: typeof fetch;
}

/**
 * POSTs the token and password to /api/auth/verify-email. A 401 invalid_password keeps the form so the owner can retry.
 * The token and password are never logged, rendered or kept in the returned state.
 * Exported for tests (no DOM in the test environment); the page is the only caller.
 */
// eslint-disable-next-line react-refresh/only-export-components
export async function runVerification(opts: VerifyOptions): Promise<VerifyState> {
  try {
    await apiRequest('/api/auth/verify-email', {
      method: 'POST',
      body: { token: opts.token, password: opts.password },
      fetchImpl: opts.fetchImpl,
    });
    return { kind: 'success' };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401 && err.code === 'invalid_password') return { kind: 'form', wrongPassword: true };
      if (err.status === 400 && err.code === 'token_without_password') return { kind: 'legacy' };
      if (err.status === 400 && err.code === 'invalid_token') return { kind: 'invalid' };
      if (err.status === 403 && err.code === 'local_auth_disabled') return { kind: 'disabled' };
      if (err.status === 429) return { kind: 'error', code: 'rate_limited' };
      return { kind: 'error', code: err.code };
    }
    return { kind: 'error', code: 'request_failed' };
  }
}

/** Replaces the current history entry with the same path and query but no hash. */
function clearLocationHash(): void {
  if (window.location.hash === '') return;
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
}

const inputClass =
  'w-full rounded-md border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';
const buttonClass =
  'w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50';

/** Renders one verification state. `onSubmit` receives the password typed into the form. */
export function VerifyEmailView({
  state,
  onSubmit,
}: {
  state: VerifyState;
  onSubmit?: (password: string) => void;
}) {
  const { t, errorText } = useT(verifyEmailPageMessages);
  const [password, setPassword] = useState('');
  let message: string | null = null;
  let isError = true;
  switch (state.kind) {
    case 'form':
      message = state.wrongPassword === true ? t('wrongPassword') : null;
      break;
    case 'verifying':
      message = t('verifying');
      isError = false;
      break;
    case 'success':
      message = t('success');
      isError = false;
      break;
    case 'invalid':
      message = t('invalid');
      break;
    case 'legacy':
      message = t('legacy');
      break;
    case 'disabled':
      message = t('disabled');
      break;
    case 'missing':
      message = t('missing');
      break;
    case 'error':
      message = errorText(state.code);
      break;
  }
  const showForm = state.kind === 'form' || state.kind === 'verifying';
  return (
    <div className="mx-auto max-w-sm space-y-4 rounded-lg border bg-card p-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      {showForm ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit?.(password);
          }}
        >
          <p className="text-sm text-muted-foreground">{t('prompt')}</p>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">{t('password')}</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              className={inputClass}
            />
          </label>
          {message === null ? null : isError ? (
            <p role="alert" className="text-sm text-warning">
              {message}
            </p>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          )}
          <button type="submit" disabled={state.kind === 'verifying'} className={buttonClass}>
            {t('submit')}
          </button>
        </form>
      ) : isError ? (
        <p role="alert" className="text-sm text-warning">
          {message}
        </p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {showForm ? null : (
        <a href="/login" className="block text-center text-sm text-foreground underline">
          {t('signIn')}
        </a>
      )}
    </div>
  );
}

/** Verify-email page at /verify-email#token=...: asks for the registration password, then confirms the address once. */
export function VerifyEmailPage() {
  const token = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<VerifyState>({ kind: 'form' });

  useEffect(() => {
    // StrictMode runs this twice; the first run clears the hash, so only the first read keeps the token.
    if (token.current !== undefined) return;
    token.current = takeToken(window.location.hash, clearLocationHash);
    if (token.current === null) setState({ kind: 'missing' });
  }, []);

  const submit = (password: string) => {
    if (token.current === null || token.current === undefined) return;
    setState({ kind: 'verifying' });
    void runVerification({ token: token.current, password }).then(setState);
  };

  return <VerifyEmailView state={state} onSubmit={submit} />;
}

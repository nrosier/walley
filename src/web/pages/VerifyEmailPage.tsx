import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { apiRequest, ApiError } from '@/lib/api';
import { verifyEmailPageMessages } from './VerifyEmailPage.messages';

export type VerifyState =
  | { kind: 'verifying' }
  | { kind: 'success' }
  | { kind: 'invalid' }
  | { kind: 'disabled' }
  | { kind: 'missing' }
  | { kind: 'error'; code: string };

/** Reads the token from a hash such as `#token=abc`. Returns null when absent or empty. */
function readToken(hash: string): string | null {
  const token = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('token');
  return token === null || token === '' ? null : token;
}

export interface VerifyOptions {
  /** Current location hash, e.g. `#token=abc`. */
  hash: string;
  /** Removes the hash from the address bar and history entry. Called before any request. */
  clearHash: () => void;
  fetchImpl?: typeof fetch;
}

/**
 * Takes the token from the hash, clears the hash, then POSTs it to /api/auth/verify-email. With no token no request is
 * sent. The token is never logged, rendered or kept in the returned state.
 * Exported for tests (no DOM in the test environment); the page is the only caller.
 */
// eslint-disable-next-line react-refresh/only-export-components
export async function runVerification(opts: VerifyOptions): Promise<VerifyState> {
  const token = readToken(opts.hash);
  opts.clearHash();
  if (token === null) return { kind: 'missing' };
  try {
    await apiRequest('/api/auth/verify-email', { method: 'POST', body: { token }, fetchImpl: opts.fetchImpl });
    return { kind: 'success' };
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 400) return { kind: 'invalid' };
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

/** Renders one verification state. */
export function VerifyEmailView({ state }: { state: VerifyState }) {
  const { t, errorText } = useT(verifyEmailPageMessages);
  let message: string;
  let isError = true;
  switch (state.kind) {
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
  return (
    <div className="mx-auto max-w-sm space-y-4 rounded-lg border bg-card p-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>
      {isError ? (
        <p role="alert" className="text-sm text-warning">
          {message}
        </p>
      ) : (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {state.kind === 'verifying' ? null : (
        <a href="/login" className="block text-center text-sm text-foreground underline">
          {t('signIn')}
        </a>
      )}
    </div>
  );
}

/** Verify-email page at /verify-email#token=...: confirms the address once, then shows the result. */
export function VerifyEmailPage() {
  const [state, setState] = useState<VerifyState>({ kind: 'verifying' });
  // The token is single use: the ref keeps StrictMode's second effect run from sending it again.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runVerification({ hash: window.location.hash, clearHash: clearLocationHash }).then(setState);
  }, []);

  return <VerifyEmailView state={state} />;
}

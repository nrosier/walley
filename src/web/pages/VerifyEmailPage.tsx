import { useEffect, useRef, useState } from 'react';
import { AUTH_BUTTON, AuthCard } from '@/components/auth/AuthCard';
import { Alert } from '@/components/ui/alert';
import { useT } from '@/i18n';
import { apiRequest, ApiError } from '@/lib/api';
import { verifyEmailPageMessages } from './VerifyEmailPage.messages';

export type VerifyState =
  | { kind: 'form' }
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
  fetchImpl?: typeof fetch;
}

/**
 * POSTs `{ token }` to /api/auth/verify-email. The link is the proof of inbox ownership, so no password is sent.
 * The token is never logged, rendered or kept in the returned state.
 * Exported for tests (no DOM in the test environment); the page is the only caller.
 */
// eslint-disable-next-line react-refresh/only-export-components
export async function runVerification(opts: VerifyOptions): Promise<VerifyState> {
  try {
    await apiRequest('/api/auth/verify-email', {
      method: 'POST',
      body: { token: opts.token },
      fetchImpl: opts.fetchImpl,
    });
    return { kind: 'success' };
  } catch (err) {
    if (err instanceof ApiError) {
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

const buttonClass = AUTH_BUTTON;

/** Renders one verification state. `onSubmit` is called when the owner clicks Confirm. */
export function VerifyEmailView({
  state,
  onSubmit,
}: {
  state: VerifyState;
  onSubmit?: () => void;
}) {
  const { t, errorText } = useT(verifyEmailPageMessages);
  let message: string | null = null;
  let isError = true;
  switch (state.kind) {
    case 'form':
      message = null;
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
    <AuthCard title={t('title')}>
      {showForm ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit?.();
          }}
        >
          {message === null ? null : <Alert variant={isError ? 'error' : 'info'}>{message}</Alert>}
          <button type="submit" disabled={state.kind === 'verifying'} aria-busy={state.kind === 'verifying'} className={buttonClass}>
            {t('submit')}
          </button>
        </form>
      ) : (
        <Alert variant={isError ? 'error' : state.kind === 'success' ? 'success' : 'info'}>{message}</Alert>
      )}
      {showForm ? null : (
        <a
          href="/login"
          className="flex min-h-11 items-center justify-center rounded-md text-center text-sm text-foreground underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('signIn')}
        </a>
      )}
    </AuthCard>
  );
}

/**
 * Verify-email page at /verify-email#token=...: shows a Confirm button and posts the token only when it is clicked
 * (issue 132, M2). Nothing is posted on mount; the mount effect only moves the token from the hash into memory.
 */
export function VerifyEmailPage() {
  const token = useRef<string | null | undefined>(undefined);
  // Set on the first click, so a second click before the re-render cannot post again.
  const inFlight = useRef(false);
  const [state, setState] = useState<VerifyState>({ kind: 'form' });

  useEffect(() => {
    // StrictMode runs this twice; the first run clears the hash, so only the first read keeps the token.
    if (token.current !== undefined) return;
    token.current = takeToken(window.location.hash, clearLocationHash);
    if (token.current === null) setState({ kind: 'missing' });
  }, []);

  const confirm = () => {
    if (inFlight.current || token.current === null || token.current === undefined) return;
    inFlight.current = true;
    setState({ kind: 'verifying' });
    void runVerification({ token: token.current }).then(setState);
  };

  return <VerifyEmailView state={state} onSubmit={confirm} />;
}

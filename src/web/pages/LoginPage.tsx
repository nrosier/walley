import { useEffect, useState, type SyntheticEvent } from 'react';
import { apiRequest, ApiError } from '@/lib/api';

export interface AuthConfig {
  mode: 'local' | 'oidc';
  registration: boolean;
}

export const ACCOUNT_NOT_LINKED_MESSAGE = 'No Walley account is linked to this identity.';
export const OIDC_FAILED_MESSAGE = 'Sign-in failed. Try again or contact the person who runs this Walley instance.';
export const LOGIN_FAILED_MESSAGE = 'Invalid email or password.';
export const LOGIN_ERROR_MESSAGE = 'Sign-in could not be completed. Try again later.';
export const REGISTER_SENT_MESSAGE = 'If this address can be registered, check your email.';
export const REGISTER_FAILED_MESSAGE = 'Registration could not be completed. Try again later.';

/** Maps the `error` query parameter to the message shown on the login page. Unknown codes show nothing. */
function errorMessageFor(code: string | null): string | null {
  switch (code) {
    case 'account_not_linked':
      return ACCOUNT_NOT_LINKED_MESSAGE;
    case 'oidc_failed':
      return OIDC_FAILED_MESSAGE;
    default:
      return null;
  }
}

/** Reads the `error` query parameter from a search string such as `?error=oidc_failed`. */
function readErrorCode(search: string): string | null {
  return new URLSearchParams(search).get('error');
}

const inputClass =
  'w-full rounded-md border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';
const buttonClass =
  'w-full rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50';

export interface LoginFormProps {
  config: AuthConfig;
  errorCode: string | null;
}

/** Renders the sign-in UI for a known auth mode. Local mode shows the password form; OIDC mode shows only SSO. */
export function LoginForm({ config, errorCode }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);

  const pageError = errorMessageFor(errorCode);

  if (config.mode === 'oidc') {
    return (
      <div className="mx-auto max-w-sm space-y-4 rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Sign in to Walley</h1>
        {pageError !== null ? (
          <p role="alert" className="text-sm text-amber-500">
            {pageError}
          </p>
        ) : null}
        <a href="/api/auth/oidc/login" className={buttonClass + ' block text-center'}>
          Sign in with SSO
        </a>
      </div>
    );
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    if (registering) {
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: { email, password },
      })
        .then(() => {
          setNotice(REGISTER_SENT_MESSAGE);
        })
        .catch(() => {
          setError(REGISTER_FAILED_MESSAGE);
        })
        .finally(() => {
          setBusy(false);
        });
      return;
    }
    apiRequest('/api/auth/login', { method: 'POST', body: { email, password } })
      .then(() => {
        window.location.hash = '#/sync';
      })
      .catch((err: unknown) => {
        const unauthorized = err instanceof ApiError && err.status === 401;
        setError(unauthorized ? LOGIN_FAILED_MESSAGE : LOGIN_ERROR_MESSAGE);
        setBusy(false);
      });
  };

  return (
    <div className="mx-auto max-w-sm space-y-4 rounded-lg border bg-card p-6">
      <h1 className="text-lg font-semibold">{registering ? 'Create account' : 'Sign in to Walley'}</h1>
      {pageError !== null ? (
        <p role="alert" className="text-sm text-amber-500">
          {pageError}
        </p>
      ) : null}
      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Email</span>
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Password</span>
          <input
            type="password"
            name="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            className={inputClass}
          />
        </label>
        {error !== null ? (
          <p role="alert" className="text-sm text-amber-500">
            {error}
          </p>
        ) : null}
        {notice !== null ? (
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        <button type="submit" disabled={busy} className={buttonClass}>
          {registering ? 'Create account' : 'Sign in'}
        </button>
      </form>
      {config.registration ? (
        <button
          type="button"
          onClick={() => {
            setRegistering((value) => !value);
            setError(null);
            setNotice(null);
          }}
          className="w-full text-center text-sm text-primary hover:underline"
        >
          {registering ? 'Back to sign in' : 'Create an account'}
        </button>
      ) : null}
    </div>
  );
}

type ConfigState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; config: AuthConfig };

/** Login page: loads the auth mode from GET /api/auth/config and renders the matching sign-in UI. */
export function LoginPage() {
  const [state, setState] = useState<ConfigState>({ status: 'loading' });
  const [errorCode] = useState<string | null>(() => readErrorCode(window.location.search));

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<AuthConfig>('/api/auth/config', { signal: controller.signal })
      .then((config) => {
        setState({ status: 'ready', config });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (state.status === 'loading') {
    return <p className="text-sm text-muted-foreground">Loading sign-in options...</p>;
  }
  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-amber-500">
        Could not load sign-in options. Reload the page to try again.
      </p>
    );
  }
  return <LoginForm config={state.config} errorCode={errorCode} />;
}

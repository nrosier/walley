import { useEffect, useState, type SyntheticEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { AUTH_BUTTON, AUTH_INPUT, AuthCard } from '@/components/auth/AuthCard';
import { Alert } from '@/components/ui/alert';
import { errorText, LanguageSelect, useT, type Locale } from '@/i18n';
import { commonMessages } from '@/i18n/common.messages';
import { apiRequest, ApiError } from '@/lib/api';
import { navigate } from '@/lib/route';
import { loginPageMessages } from './LoginPage.messages';
import { checkRegistration, registerErrorMessage } from './LoginPage.register';

export interface AuthConfig {
  mode: 'local' | 'oidc';
  registration: boolean;
}

type PageErrorCode = keyof typeof loginPageMessages.en.pageErrors;

/**
 * Maps the `error` query parameter to the message shown on the login page. Page codes (account_not_linked, oidc_failed)
 * have their own text; known server codes (for example rate_limited) go through errorText. Unknown codes show nothing,
 * so a crafted link cannot put arbitrary or generic error text on the page.
 */
function pageErrorMessage(code: string | null, locale: Locale): string | null {
  if (code === null || code === '') return null;
  const pageErrors = loginPageMessages[locale].pageErrors;
  if (Object.hasOwn(pageErrors, code)) return pageErrors[code as PageErrorCode];
  if (Object.hasOwn(commonMessages[locale].errors, code)) return errorText(code, locale);
  return null;
}

/** Reads the `error` query parameter from a search string such as `?error=oidc_failed`. */
function readErrorCode(search: string): string | null {
  return new URLSearchParams(search).get('error');
}

/** Error code for a failed login or register call. A login 401 is always invalid_credentials. */
function failureCode(err: unknown, login: boolean): string {
  if (err instanceof ApiError) {
    if (login && err.status === 401) return 'invalid_credentials';
    if (err.status === 429) return 'rate_limited';
    return err.code;
  }
  return 'request_failed';
}

const inputClass = AUTH_INPUT;
const buttonClass = AUTH_BUTTON;

export interface LoginFormProps {
  config: AuthConfig;
  errorCode: string | null;
  /** Starts in register mode. Used by tests, because static markup cannot click the toggle. */
  initialRegistering?: boolean;
}

/** Base of the card: a subtle divider, then the one language picker. */
function LanguageFooter() {
  return (
    <div className="border-t pt-4">
      <LanguageSelect />
    </div>
  );
}

/** Renders the sign-in UI for a known auth mode. Local mode shows the password form; OIDC mode shows only SSO. */
export function LoginForm({ config, errorCode, initialRegistering = false }: LoginFormProps) {
  const { t, errorText: errorFor, locale } = useT(loginPageMessages);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(initialRegistering);

  const pageError = pageErrorMessage(errorCode, locale);

  if (config.mode === 'oidc') {
    return (
      <AuthCard title={t('title')}>
        {pageError !== null ? <Alert variant="error">{pageError}</Alert> : null}
        <div role="separator" className="flex items-center gap-3 text-xs text-muted">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          <span>{t('ssoDivider')}</span>
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
        <a href="/api/auth/oidc/login" className={`${buttonClass} gap-2`}>
          <KeyRound className="size-4" aria-hidden="true" />
          {t('sso')}
        </a>
        <LanguageFooter />
      </AuthCard>
    );
  }

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFailure(null);
    setSent(false);
    if (registering) {
      const check = checkRegistration(email, password, confirm);
      if (check !== null) {
        setFailure(check);
        return;
      }
      setBusy(true);
      apiRequest('/api/auth/register', {
        method: 'POST',
        body: { email, password },
      })
        .then(() => {
          setSent(true);
        })
        .catch((err: unknown) => {
          setFailure(failureCode(err, false));
        })
        .finally(() => {
          setBusy(false);
        });
      return;
    }
    setBusy(true);
    apiRequest('/api/auth/login', { method: 'POST', body: { email, password } })
      .then(() => {
        navigate('/sync');
      })
      .catch((err: unknown) => {
        setFailure(failureCode(err, true));
        setBusy(false);
      });
  };

  return (
    <AuthCard title={registering ? t('registerTitle') : t('title')}>
      {pageError !== null ? <Alert variant="error">{pageError}</Alert> : null}
      <form className="space-y-3" onSubmit={onSubmit}>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">{t('email')}</span>
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
          <span className="mb-1 block text-muted">{t('password')}</span>
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
        {registering ? (
          <label className="block text-sm">
            <span className="mb-1 block text-muted">{t('confirmPassword')}</span>
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
              }}
              className={inputClass}
            />
          </label>
        ) : null}
        {failure !== null ? (
          <Alert variant="error">{registering ? registerErrorMessage(failure, locale) : errorFor(failure)}</Alert>
        ) : null}
        {sent ? <Alert variant="info">{t('registerSent')}</Alert> : null}
        <button type="submit" disabled={busy} aria-busy={busy} className={buttonClass}>
          {registering ? (busy ? t('creatingAccount') : t('createAccount')) : busy ? t('signingIn') : t('signIn')}
        </button>
      </form>
      {config.registration ? (
        <button
          type="button"
          onClick={() => {
            setRegistering((value) => !value);
            setFailure(null);
            setSent(false);
          }}
          className="flex min-h-11 w-full items-center justify-center rounded-md text-center text-sm text-foreground underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {registering ? t('backToSignIn') : t('showRegister')}
        </button>
      ) : null}
      <LanguageFooter />
    </AuthCard>
  );
}

type ConfigState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; config: AuthConfig };

/** Login page: loads the auth mode from GET /api/auth/config and renders the matching sign-in UI. */
export function LoginPage() {
  const { t } = useT(loginPageMessages);
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
    return (
      <AuthCard title={t('title')}>
        <p role="status" className="text-sm text-muted">
          {t('loading')}
        </p>
      </AuthCard>
    );
  }
  if (state.status === 'error') {
    return (
      <AuthCard title={t('title')}>
        <Alert variant="error">{t('configFailed')}</Alert>
      </AuthCard>
    );
  }
  return <LoginForm config={state.config} errorCode={errorCode} />;
}

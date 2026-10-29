import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { apiRequest, ApiError } from '@/lib/api';
import { useT } from '@/i18n';
import { SettingsCard } from '@/components/settings/SettingsCard';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { PASSWORD_MIN_CODE_POINTS } from '../../lib/password-policy';
import { accountSettingsMessages } from './AccountSettings.messages';

export interface AccountInfo {
  email: string;
  mode: 'local' | 'oidc';
  hasPassword: boolean;
  identities: { issuer: string; subject: string }[];
  /** True when the email is in ADMIN_EMAILS. Only then is the registration toggle shown. */
  isAdmin: boolean;
}

/** GET and PUT /api/admin/registration: the stored toggle, the ALLOW_REGISTRATION ceiling and their AND. */
export interface RegistrationState {
  enabled: boolean;
  ceiling: boolean;
  effective: boolean;
}

/** Saves the registration toggle. Returns the new state, or the server error code. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests with a fake fetch
export async function saveRegistration(
  enabled: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; state: RegistrationState } | { ok: false; code: string }> {
  try {
    const state = await apiRequest<RegistrationState>('/api/admin/registration', {
      method: 'PUT',
      body: { enabled },
      fetchImpl,
    });
    return { ok: true, state };
  } catch (err: unknown) {
    return { ok: false, code: err instanceof ApiError ? err.code : 'request_failed' };
  }
}

export type PasswordChangeResult = { ok: true } | { ok: false; code: string };

/**
 * Calls PUT /api/account/password. Returns the server error code on failure so the caller can
 * translate it. Passwords are sent in the request body only and are never logged.
 */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests with a fake fetch
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PasswordChangeResult> {
  try {
    await apiRequest('/api/account/password', {
      method: 'PUT',
      body: { currentPassword, newPassword },
      fetchImpl,
    });
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, code: err instanceof ApiError ? err.code : 'request_failed' };
  }
}

const inputClass =
  'min-h-(--control-h) w-full rounded-md border border-input-border bg-background px-3 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const buttonClass =
  'min-h-(--control-h) rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50';

function PasswordForm() {
  const { t, errorText } = useT(accountSettingsMessages);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (next !== confirm) {
      setError(t('password.mismatch'));
      return;
    }
    setBusy(true);
    void changePassword(current, next)
      .then((result) => {
        if (result.ok) {
          setCurrent('');
          setNext('');
          setConfirm('');
          setNotice(t('password.changed'));
        } else {
          setError(errorText(result.code));
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form className="max-w-sm space-y-3" onSubmit={onSubmit}>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">{t('password.current')}</span>
        <input type="password" name="currentPassword" autoComplete="current-password" required value={current} onChange={(e) => { setCurrent(e.target.value); }} className={inputClass} />
      </label>
      {/* minLength matches the server limit in src/lib/password-policy.ts (also used by src/server/auth/passwords.ts). */}
      <label className="block text-sm">
        <span className="mb-1 block text-muted">{t('password.next')}</span>
        <input type="password" name="newPassword" autoComplete="new-password" required minLength={PASSWORD_MIN_CODE_POINTS} value={next} onChange={(e) => { setNext(e.target.value); }} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">{t('password.confirm')}</span>
        <input type="password" name="confirmPassword" autoComplete="new-password" required value={confirm} onChange={(e) => { setConfirm(e.target.value); }} className={inputClass} />
      </label>
      <div aria-live="polite" role="status">
        {error !== null ? <p className="text-sm text-warning">{error}</p> : null}
        {notice !== null ? <p className="text-sm text-success">{notice}</p> : null}
      </div>
      <button type="submit" disabled={busy} className={buttonClass}>{t('password.submit')}</button>
    </form>
  );
}

/** Admin only: the server-wide switch for new accounts. Applies at once and says so. */
function RegistrationToggle() {
  const { t, errorText } = useT(accountSettingsMessages);
  const [state, setState] = useState<RegistrationState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest<RegistrationState>('/api/admin/registration', { signal: controller.signal })
      .then(setState)
      .catch(() => {
        if (!controller.signal.aborted) setLoadFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, []);

  const onChange = (value: string) => {
    setError(null);
    setSaved(false);
    setBusy(true);
    void saveRegistration(value === 'on')
      .then((result) => {
        if (result.ok) {
          setState(result.state);
          setSaved(true);
        } else {
          setError(errorText(result.code));
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <div data-testid="registration-toggle" className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-medium">{t('registration.heading')}</h3>
      <p className="text-sm text-muted">{t('registration.help')}</p>
      {loadFailed ? <p role="alert" className="text-sm text-warning">{t('registration.loadError')}</p> : null}
      {state !== null ? (
        <>
          <SegmentedControl
            aria-label={t('registration.label')}
            value={state.enabled ? 'on' : 'off'}
            onValueChange={busy ? () => undefined : onChange}
            options={[
              { value: 'on', label: t('registration.on') },
              { value: 'off', label: t('registration.off') },
            ]}
          />
          {!state.ceiling ? <p className="text-sm text-warning">{t('registration.ceilingOff')}</p> : null}
        </>
      ) : null}
      <div aria-live="polite" role="status">
        {error !== null ? <p className="text-sm text-warning">{error}</p> : null}
        {saved ? <p className="text-sm text-success">{t('registration.saved')}</p> : null}
      </div>
    </div>
  );
}

function AccountCard({ children }: { children: ReactNode }) {
  const { t } = useT(accountSettingsMessages);
  return (
    <SettingsCard id="settings-account" headingId="account-heading" title={t('heading')} scope="account">
      {children}
    </SettingsCard>
  );
}

/** Renders the account section for a known account. Local mode: change-password form. OIDC mode: note and identities. */
export function AccountSettingsView({ account }: { account: AccountInfo }) {
  const { t } = useT(accountSettingsMessages);
  return (
    <AccountCard>
      <div className="space-y-3">
        <p className="text-sm text-muted">{t('signedInAs', { email: account.email })}</p>
        {account.mode === 'local' ? <PasswordForm /> : <p className="text-sm">{t('oidcNote')}</p>}
        {account.isAdmin ? <RegistrationToggle /> : null}
        {account.identities.length > 0 ? (
          <div>
            <h3 className="mb-1 text-sm font-medium">{t('identities.heading')}</h3>
            <ul className="space-y-1 text-xs">
              {account.identities.map((identity) => (
                <li key={`${identity.issuer}\n${identity.subject}`} className="font-mono">
                  <span className="text-muted">{t('identities.issuer')}</span> {identity.issuer}{' '}
                  <span className="text-muted">{t('identities.subject')}</span> {identity.subject}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </AccountCard>
  );
}

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; account: AccountInfo };

/** Loads GET /api/account and renders the matching view. */
export function AccountSettings() {
  const { t } = useT(accountSettingsMessages);
  const [state, setState] = useState<State>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    apiRequest<AccountInfo>('/api/account', { signal: controller.signal })
      .then((account) => {
        setState({ status: 'ready', account });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => {
      controller.abort();
    };
  }, []);
  if (state.status === 'loading') return <AccountCard><p className="text-sm text-muted">{t('loading')}</p></AccountCard>;
  if (state.status === 'error') return <AccountCard><p role="alert" className="text-sm text-warning">{t('loadError')}</p></AccountCard>;
  return <AccountSettingsView account={state.account} />;
}

import { useEffect, useState, type SyntheticEvent } from 'react';
import { apiRequest, ApiError } from '@/lib/api';
import { useT } from '@/i18n';
import { PASSWORD_MIN_CODE_POINTS } from '../../lib/password-policy';
import { accountSettingsMessages } from './AccountSettings.messages';

export interface AccountInfo {
  email: string;
  mode: 'local' | 'oidc';
  hasPassword: boolean;
  identities: { issuer: string; subject: string }[];
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
  'w-full rounded-md border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';
const buttonClass =
  'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50';

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
        <span className="mb-1 block text-muted-foreground">{t('password.current')}</span>
        <input type="password" name="currentPassword" autoComplete="current-password" required value={current} onChange={(e) => { setCurrent(e.target.value); }} className={inputClass} />
      </label>
      {/* minLength matches the server limit in src/lib/password-policy.ts (also used by src/server/auth/passwords.ts). */}
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">{t('password.next')}</span>
        <input type="password" name="newPassword" autoComplete="new-password" required minLength={PASSWORD_MIN_CODE_POINTS} value={next} onChange={(e) => { setNext(e.target.value); }} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">{t('password.confirm')}</span>
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

/** Renders the account section for a known account. Local mode: change-password form. OIDC mode: note and identities. */
export function AccountSettingsView({ account }: { account: AccountInfo }) {
  const { t } = useT(accountSettingsMessages);
  return (
    <section aria-labelledby="account-heading" className="space-y-3">
      <h2 id="account-heading" className="text-base font-semibold">{t('heading')}</h2>
      <p className="text-sm text-muted-foreground">{t('signedInAs', { email: account.email })}</p>
      {account.mode === 'local' ? <PasswordForm /> : <p className="text-sm">{t('oidcNote')}</p>}
      {account.identities.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-medium">{t('identities.heading')}</h3>
          <ul className="space-y-1 text-xs">
            {account.identities.map((identity) => (
              <li key={`${identity.issuer}\n${identity.subject}`} className="font-mono">
                <span className="text-muted-foreground">{t('identities.issuer')}</span> {identity.issuer}{' '}
                <span className="text-muted-foreground">{t('identities.subject')}</span> {identity.subject}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
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
  if (state.status === 'loading') return <p className="text-sm text-muted-foreground">{t('loading')}</p>;
  if (state.status === 'error') return <p role="alert" className="text-sm text-warning">{t('loadError')}</p>;
  return <AccountSettingsView account={state.account} />;
}

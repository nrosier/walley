import { useEffect, useState, type SyntheticEvent } from 'react';
import { apiRequest, ApiError } from '@/lib/api';

export interface AccountInfo {
  email: string;
  mode: 'local' | 'oidc';
  hasPassword: boolean;
  identities: { issuer: string; subject: string }[];
}

export const PASSWORD_MISMATCH_MESSAGE = 'The new passwords do not match.';
export const WRONG_PASSWORD_MESSAGE = 'The current password is incorrect.';
export const PASSWORD_INVALID_MESSAGE = 'The new password must be 15 to 256 characters.';
export const PASSWORD_FAILED_MESSAGE = 'The password could not be changed. Try again later.';
export const PASSWORD_CHANGED_MESSAGE = 'Password changed. Your other sessions were signed out.';
export const OIDC_PASSWORD_NOTE = 'Your password is managed by your identity provider.';

const inputClass =
  'w-full rounded-md border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';
const buttonClass =
  'rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50';

function PasswordForm() {
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
      setError(PASSWORD_MISMATCH_MESSAGE);
      return;
    }
    setBusy(true);
    apiRequest('/api/account/password', {
      method: 'PUT',
      body: { currentPassword: current, newPassword: next },
    })
      .then(() => {
        setCurrent('');
        setNext('');
        setConfirm('');
        setNotice(PASSWORD_CHANGED_MESSAGE);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) setError(WRONG_PASSWORD_MESSAGE);
        else if (err instanceof ApiError && err.status === 400) setError(PASSWORD_INVALID_MESSAGE);
        else setError(PASSWORD_FAILED_MESSAGE);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <form className="max-w-sm space-y-3" onSubmit={onSubmit}>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Current password</span>
        <input type="password" name="currentPassword" autoComplete="current-password" required value={current} onChange={(e) => { setCurrent(e.target.value); }} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">New password</span>
        <input type="password" name="newPassword" autoComplete="new-password" required minLength={15} value={next} onChange={(e) => { setNext(e.target.value); }} className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Confirm new password</span>
        <input type="password" name="confirmPassword" autoComplete="new-password" required value={confirm} onChange={(e) => { setConfirm(e.target.value); }} className={inputClass} />
      </label>
      {error !== null ? <p role="alert" className="text-sm text-amber-500">{error}</p> : null}
      {notice !== null ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      <button type="submit" disabled={busy} className={buttonClass}>Change password</button>
    </form>
  );
}

/** Renders the account section for a known account. Local mode: change-password form. OIDC mode: note and identities. */
export function AccountSettingsView({ account }: { account: AccountInfo }) {
  return (
    <section aria-labelledby="account-heading" className="space-y-3">
      <h2 id="account-heading" className="text-base font-semibold">Account / Security</h2>
      <p className="text-sm text-muted-foreground">Signed in as {account.email}</p>
      {account.mode === 'local' ? <PasswordForm /> : <p className="text-sm">{OIDC_PASSWORD_NOTE}</p>}
      {account.identities.length > 0 ? (
        <div>
          <h3 className="mb-1 text-sm font-medium">Linked identities</h3>
          <ul className="space-y-1 text-xs">
            {account.identities.map((identity) => (
              <li key={`${identity.issuer}\n${identity.subject}`} className="font-mono">
                <span className="text-muted-foreground">Issuer:</span> {identity.issuer}{' '}
                <span className="text-muted-foreground">Subject:</span> {identity.subject}
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
  if (state.status === 'loading') return <p className="text-sm text-muted-foreground">Loading account...</p>;
  if (state.status === 'error') return <p role="alert" className="text-sm text-amber-500">Could not load the account. Reload the page to try again.</p>;
  return <AccountSettingsView account={state.account} />;
}

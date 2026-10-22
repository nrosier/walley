import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, createT, errorText, type Locale } from '@/i18n';
import { accountSettingsMessages } from './AccountSettings.messages';
import { PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS } from '../../lib/password-policy';
import { appMessages } from '../App.messages';
import { requestLogout } from '../App';
import { AccountSettingsView, changePassword, type AccountInfo } from './AccountSettings';

const render = (account: AccountInfo, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <AccountSettingsView account={account} />
    </I18nProvider>,
  );
const local: AccountInfo = { email: 'a@example.test', mode: 'local', hasPassword: true, identities: [] };
const oidc: AccountInfo = {
  email: 'a@example.test',
  mode: 'oidc',
  hasPassword: false,
  identities: [{ issuer: 'https://idp.example.test', subject: 'sub-123' }],
};
const en = createT(accountSettingsMessages, 'en');
const OIDC_NOTE = en('oidcNote');

/** A fake fetch that answers every call with the given status and JSON body. */
type FakeCall = { url: string; method?: string; body?: string };

function fakeFetch(status: number, body?: unknown): { fetchImpl: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    calls.push({ url: href, method: init?.method, body: typeof init?.body === 'string' ? init.body : undefined });
    const response = body === undefined ? new Response(null, { status }) : Response.json(body, { status });
    return Promise.resolve(response);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('AccountSettings local mode', () => {
  it('renders the three labelled password fields', () => {
    const html = render(local);
    for (const label of ['Current password', 'New password', 'Confirm new password']) expect(html).toContain(label);
    expect(html.match(/type="password"/g)).toHaveLength(3);
    expect(html).not.toContain(OIDC_NOTE);
  });
  it('never prefills a password field', () => {
    const html = render(local);
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]/);
    expect(html).not.toMatch(/value="[^"]+"[^>]*type="password"/);
  });
  it('renders the Account / Security heading as h2 and a polite live region', () => {
    const html = render(local);
    expect(html).toMatch(/<h2[^>]*>Account \/ Security<\/h2>/);
    expect(html).toContain('aria-live="polite"');
  });
  it('sets the new-password minLength to the shared server minimum', () => {
    const html = render(local);
    expect(PASSWORD_MIN_CODE_POINTS).toBe(15);
    expect(PASSWORD_MAX_CODE_POINTS).toBe(256);
    const newPasswordInput = html.match(/<input[^>]*name="newPassword"[^>]*>/)?.[0] ?? '';
    expect(newPasswordInput).toMatch(new RegExp(`minlength="${String(PASSWORD_MIN_CODE_POINTS)}"`, 'i'));
  });
  it('renders the Dutch labels', () => {
    const html = render(local, 'nl');
    expect(html).toContain('Huidig wachtwoord');
    expect(html).toMatch(/<h2[^>]*>Account \/ Beveiliging<\/h2>/);
  });
});

describe('AccountSettings oidc mode', () => {
  it('shows the note and identities with no password form', () => {
    const html = render(oidc);
    expect(html).toContain(OIDC_NOTE);
    expect(html).toContain('https://idp.example.test');
    expect(html).toContain('sub-123');
    expect(html).toMatch(/class="font-mono"/);
    expect(html).not.toContain('type="password"');
  });
});

describe('requestLogout', () => {
  it('posts to /api/auth/logout and resolves true on success', async () => {
    const { fetchImpl, calls } = fakeFetch(204);
    await expect(requestLogout(fetchImpl)).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/auth/logout');
    expect(calls[0]?.method).toBe('POST');
  });
  it('resolves false when the server answers with an error', async () => {
    const { fetchImpl } = fakeFetch(500, { error: 'internal_error' });
    await expect(requestLogout(fetchImpl)).resolves.toBe(false);
  });
  it('resolves false when the network call throws', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    await expect(requestLogout(fetchImpl)).resolves.toBe(false);
  });
  it('has a translated logout failure notice in en and nl', () => {
    expect(appMessages.en.logoutFailed).toBe('Could not sign you out. Check your connection and try again.');
    expect(appMessages.nl.logoutFailed).toBe('Afmelden is niet gelukt. Controleer uw verbinding en probeer het opnieuw.');
  });
});

describe('changePassword', () => {
  it('reports success after a 200 and sends the passwords in a PUT body', async () => {
    const { fetchImpl, calls } = fakeFetch(200, { ok: true });
    const result = await changePassword('old-password-value', 'new-password-value-long', fetchImpl);
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/account/password');
    expect(calls[0]?.method).toBe('PUT');
    expect(JSON.parse(calls[0]?.body ?? 'null')).toEqual({
      currentPassword: 'old-password-value',
      newPassword: 'new-password-value-long',
    });
  });
  it('returns invalid_credentials on a wrong current password, which errorText maps to a message', async () => {
    const { fetchImpl } = fakeFetch(401, { error: 'invalid_credentials' });
    const result = await changePassword('wrong-password-value', 'new-password-value-long', fetchImpl);
    expect(result).toEqual({ ok: false, code: 'invalid_credentials' });
    if (result.ok) throw new Error('expected failure');
    expect(errorText(result.code, 'en')).toBe(
      'Email or password is incorrect, or the email address is not verified yet.',
    );
  });
  it('falls back to request_failed when the network call throws', async () => {
    const fetchImpl = (() => Promise.reject(new TypeError('offline'))) as unknown as typeof fetch;
    const result = await changePassword('a', 'b', fetchImpl);
    expect(result).toEqual({ ok: false, code: 'request_failed' });
  });
});

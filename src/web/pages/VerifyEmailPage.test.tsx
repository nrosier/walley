import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { runVerification, takeToken, VerifyEmailView, type VerifyState } from './VerifyEmailPage';

const TOKEN = 'abc123SECRETtoken';

function fakeFetch(status: number, body?: unknown, onCall?: (init: RequestInit | undefined) => void) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = ((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    onCall?.(init);
    return Promise.resolve(
      status === 204
        ? new Response(null, { status })
        : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
  }) as typeof fetch;
  return { impl, calls };
}

const render = (state: VerifyState, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <VerifyEmailView state={state} />
    </I18nProvider>,
  );

const PASSWORD = 'correct horse battery staple';
const run = (impl: typeof fetch) => runVerification({ token: TOKEN, password: PASSWORD, fetchImpl: impl });

describe('takeToken', () => {
  it('returns the token and clears the hash', () => {
    let cleared = 0;
    expect(takeToken(`#token=${TOKEN}`, () => cleared++)).toBe(TOKEN);
    expect(cleared).toBe(1);
  });

  it('returns null for a missing token but still clears the hash', () => {
    for (const hash of ['', '#', '#token=', '#other=1']) {
      let cleared = 0;
      expect(takeToken(hash, () => cleared++)).toBeNull();
      expect(cleared).toBe(1);
    }
  });
});

describe('runVerification', () => {
  it('posts the token and password once, then reports success on 204', async () => {
    const { impl, calls } = fakeFetch(204);
    const state = await run(impl);
    expect(state).toEqual({ kind: 'success' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/auth/verify-email');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ token: TOKEN, password: PASSWORD }));
    expect(JSON.stringify(state)).not.toContain(TOKEN);
    expect(JSON.stringify(state)).not.toContain(PASSWORD);
  });

  it('keeps the form with a wrong-password flag on 401 invalid_password', async () => {
    const { impl } = fakeFetch(401, { error: 'invalid_password' });
    expect(await run(impl)).toEqual({ kind: 'form', wrongPassword: true });
  });

  it('reports an expired link on 400 invalid_token', async () => {
    const { impl } = fakeFetch(400, { error: 'invalid_token' });
    expect(await run(impl)).toEqual({ kind: 'invalid' });
  });

  it('reports a legacy link on 400 token_without_password', async () => {
    const { impl } = fakeFetch(400, { error: 'token_without_password' });
    expect(await run(impl)).toEqual({ kind: 'legacy' });
  });

  it('reports disabled sign-in on 403 local_auth_disabled', async () => {
    const { impl } = fakeFetch(403, { error: 'local_auth_disabled' });
    expect(await run(impl)).toEqual({ kind: 'disabled' });
  });

  it('maps 429 to rate_limited and other failures to their code', async () => {
    expect(await run(fakeFetch(429, { error: 'rate_limited' }).impl)).toEqual({ kind: 'error', code: 'rate_limited' });
    expect(await run(fakeFetch(500, { error: 'internal' }).impl)).toEqual({ kind: 'error', code: 'internal' });
  });
});

describe('VerifyEmailView', () => {
  it('asks for the password with a password input', () => {
    const html = render({ kind: 'form' });
    expect(html).toContain('type="password"');
    expect(html).toContain('Enter the password you chose');
    expect(html).not.toContain('role="alert"');
  });
  it('shows the wrong-password message and keeps the form', () => {
    const html = render({ kind: 'form', wrongPassword: true });
    expect(html).toContain('type="password"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('not the password this link was requested with');
  });
  it('shows the legacy-link message', () => {
    expect(render({ kind: 'legacy' })).toContain('older version');
  });
  it('shows success with a sign-in link', () => {
    const html = render({ kind: 'success' });
    expect(html).toContain('Your email address is confirmed.');
    expect(html).toContain('href="/login"');
    expect(html).toContain('text-foreground');
  });
  it('shows the expiry message for an invalid token', () => {
    const html = render({ kind: 'invalid' });
    expect(html).toContain('24 hours');
    expect(html).toContain('data-variant="error"');
  });
  it('shows the disabled message', () => {
    expect(render({ kind: 'disabled' })).toContain('Password sign-in is turned off');
  });
  it('shows the missing-token message', () => {
    expect(render({ kind: 'missing' })).toContain('This link is incomplete.');
  });
  it('shows no sign-in link while verifying', () => {
    expect(render({ kind: 'verifying' })).not.toContain('href=');
  });
  it('renders in Dutch', () => {
    expect(render({ kind: 'form' }, 'nl')).toContain('Voer het wachtwoord in');
    expect(render({ kind: 'success' }, 'nl')).toContain('Uw e-mailadres is bevestigd.');
    expect(render({ kind: 'invalid' }, 'nl')).toContain('24 uur');
  });
});

describe('VerifyEmailView styling', () => {
  it('uses the same centred auth card, brand mark, 44px controls and alert as the login page', () => {
    const html = render({ kind: 'form', wrongPassword: true });
    expect(html).toContain('min-h-dvh items-center justify-center');
    expect(html).toMatch(/data-slot="brand-mark"[^>]*>W</);
    expect(html).toMatch(/<input[^>]*class="h-11 /);
    expect(html).toMatch(/<button type="submit"[^>]*class="[^"]*h-11/);
    expect(html.indexOf('data-slot="alert"')).toBeLessThan(html.indexOf('type="submit"'));
    expect(render({ kind: 'success' })).toContain('data-variant="success"');
  });
});

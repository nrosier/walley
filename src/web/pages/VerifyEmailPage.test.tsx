import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { runVerification, VerifyEmailView, type VerifyState } from './VerifyEmailPage';

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

describe('runVerification', () => {
  it('clears the hash before the request is made, then reports success on 204', async () => {
    const events: string[] = [];
    const { impl, calls } = fakeFetch(204, undefined, () => events.push('fetch'));
    const state = await runVerification({
      hash: `#token=${TOKEN}`,
      clearHash: () => events.push('clear'),
      fetchImpl: impl,
    });
    expect(events).toEqual(['clear', 'fetch']);
    expect(state).toEqual({ kind: 'success' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/auth/verify-email');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ token: TOKEN }));
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  it('reports an expired link on 400 invalid_token', async () => {
    const { impl } = fakeFetch(400, { error: 'invalid_token' });
    expect(await runVerification({ hash: `#token=${TOKEN}`, clearHash: () => undefined, fetchImpl: impl })).toEqual({
      kind: 'invalid',
    });
  });

  it('reports disabled sign-in on 403 local_auth_disabled', async () => {
    const { impl } = fakeFetch(403, { error: 'local_auth_disabled' });
    expect(await runVerification({ hash: `#token=${TOKEN}`, clearHash: () => undefined, fetchImpl: impl })).toEqual({
      kind: 'disabled',
    });
  });

  it('maps 429 to rate_limited and other failures to their code', async () => {
    const limited = fakeFetch(429, { error: 'rate_limited' });
    expect(await runVerification({ hash: `#token=${TOKEN}`, clearHash: () => undefined, fetchImpl: limited.impl })).toEqual({
      kind: 'error',
      code: 'rate_limited',
    });
    const broken = fakeFetch(500, { error: 'internal' });
    expect(await runVerification({ hash: `#token=${TOKEN}`, clearHash: () => undefined, fetchImpl: broken.impl })).toEqual({
      kind: 'error',
      code: 'internal',
    });
  });

  it('sends no request without a token but still clears the hash', async () => {
    for (const hash of ['', '#', '#token=', '#other=1']) {
      let cleared = 0;
      const { impl, calls } = fakeFetch(204);
      const state = await runVerification({ hash, clearHash: () => cleared++, fetchImpl: impl });
      expect(state).toEqual({ kind: 'missing' });
      expect(calls).toHaveLength(0);
      expect(cleared).toBe(1);
    }
  });
});

describe('VerifyEmailView', () => {
  it('shows success with a sign-in link', () => {
    const html = render({ kind: 'success' });
    expect(html).toContain('Your email address is confirmed.');
    expect(html).toContain('href="/login"');
    expect(html).toContain('text-foreground');
  });
  it('shows the expiry message for an invalid token', () => {
    const html = render({ kind: 'invalid' });
    expect(html).toContain('24 hours');
    expect(html).toContain('text-warning');
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
    expect(render({ kind: 'success' }, 'nl')).toContain('Uw e-mailadres is bevestigd.');
    expect(render({ kind: 'invalid' }, 'nl')).toContain('24 uur');
  });
});

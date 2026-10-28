import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { runVerification, takeToken, VerifyEmailView, type VerifyState } from './VerifyEmailPage';
import pageSource from './VerifyEmailPage.tsx?raw';

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

const run = (impl: typeof fetch) => runVerification({ token: TOKEN, fetchImpl: impl });

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
  it('posts {token} only, once, then reports success on 204', async () => {
    const { impl, calls } = fakeFetch(204);
    const state = await run(impl);
    expect(state).toEqual({ kind: 'success' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/auth/verify-email');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ token: TOKEN }));
    expect(JSON.stringify(state)).not.toContain(TOKEN);
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
  it('M2: renders a Confirm button and no password field', () => {
    const html = render({ kind: 'form' });
    expect(html).toMatch(/<button type="submit"[^>]*>Confirm email<\/button>/);
    expect(html).not.toContain('<input');
    expect(html).not.toContain('type="password"');
    expect(html.toLowerCase()).not.toContain('password');
    expect(html).not.toContain('role="alert"');
  });
  it('M2: disables the Confirm button while verifying', () => {
    expect(render({ kind: 'verifying' })).toMatch(/<button type="submit" disabled=""/);
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
    expect(render({ kind: 'form' }, 'nl')).toContain('E-mail bevestigen');
    expect(render({ kind: 'success' }, 'nl')).toContain('Uw e-mailadres is bevestigd.');
    expect(render({ kind: 'invalid' }, 'nl')).toContain('24 uur');
  });
});

describe('VerifyEmailView styling', () => {
  it('uses the same centred auth card, brand mark, 44px controls and alert as the login page', () => {
    const html = render({ kind: 'verifying' });
    expect(html).toContain('min-h-dvh items-center justify-center');
    expect(html).toMatch(/data-slot="brand-mark"[^>]*>W</);
    expect(html).toMatch(/<button type="submit"[^>]*class="[^"]*h-11/);
    expect(html.indexOf('data-slot="alert"')).toBeLessThan(html.indexOf('type="submit"'));
    expect(render({ kind: 'success' })).toContain('data-variant="success"');
  });
});

describe('VerifyEmailPage does not post on mount (M2)', () => {
  const source = ts.createSourceFile('VerifyEmailPage.tsx', pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  /** The source text of every callback passed to useEffect / useLayoutEffect in the file. */
  const effectBodies = (): string[] => {
    const bodies: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^use(Layout)?Effect$/.test(node.expression.text)) {
        const callback = node.arguments[0];
        if (callback !== undefined) bodies.push(callback.getText(source));
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return bodies;
  };

  it('has no fetch, verification or submit call in any effect', () => {
    const bodies = effectBodies();
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toMatch(/runVerification|apiRequest|fetch|confirm\(|submit|onSubmit|requestSubmit/);
    }
  });

  it('calls runVerification only from the click handler, with the token only', () => {
    const calls = pageSource.match(/runVerification\(\{[^}]*\}\)/g) ?? [];
    expect(calls).toEqual(['runVerification({ token: token.current })']);
    expect(pageSource).toMatch(/const confirm = \(\) => \{[\s\S]*?runVerification\(/);
    expect(pageSource).toContain('onSubmit={confirm}');
    // A second click before the re-render does not post again.
    expect(pageSource).toMatch(/if \(inFlight\.current[^)]*\) return;\s*inFlight\.current = true;/);
  });
});

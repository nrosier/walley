import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { LoginForm } from './LoginPage';

const NOT_LINKED_EN =
  'Your sign-in worked, but no Walley account is linked to it. Ask the person who runs this Walley instance for access.';

const render = (
  mode: 'local' | 'oidc',
  registration: boolean,
  errorCode: string | null = null,
  locale: Locale = 'en',
) =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <LoginForm config={{ mode, registration }} errorCode={errorCode} />
    </I18nProvider>,
  );

describe('LoginPage local mode', () => {
  it('renders email and password fields and no SSO button', () => {
    const html = render('local', false);
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('Sign in with SSO');
    expect(html).not.toContain('/api/auth/oidc/login');
  });

  it('hides the register link when registration is off', () => {
    expect(render('local', false)).not.toContain('Create an account');
  });

  it('shows the register link when registration is on', () => {
    expect(render('local', true)).toContain('Create an account');
  });
});

describe('LoginPage oidc mode', () => {
  it('renders only the SSO link with no password field', () => {
    const html = render('oidc', false);
    expect(html).toContain('Sign in with SSO');
    expect(html).toContain('href="/api/auth/oidc/login"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('type="email"');
  });

  it('never shows a register link, even when registration is on', () => {
    expect(render('oidc', true)).not.toContain('Create an account');
  });
});

describe('LoginPage error messages', () => {
  it('renders the account_not_linked message exactly (en)', () => {
    const html = render('oidc', false, 'account_not_linked');
    expect(html).toContain(NOT_LINKED_EN);
    expect(html).toContain('text-warning');
  });

  it('renders account_not_linked in Dutch', () => {
    const html = render('oidc', false, 'account_not_linked', 'nl');
    expect(html).toContain('Uw aanmelding is gelukt, maar er is geen Walley-account aan gekoppeld.');
    expect(html).not.toContain(NOT_LINKED_EN);
    expect(render('local', false, null, 'nl')).toContain('Inloggen bij Walley');
  });

  it('renders oidc_failed in local mode too', () => {
    expect(render('local', false, 'oidc_failed')).toContain('Sign-in failed.');
  });

  it('gives rate_limited its own message', () => {
    expect(render('oidc', false, 'rate_limited')).toContain('Too many attempts. Wait a moment and try again.');
    expect(render('oidc', false, 'rate_limited', 'nl')).toContain('Te veel pogingen.');
  });

  it('shows nothing for unknown, inherited-property or missing codes', () => {
    for (const code of ['something_else', 'constructor', '__proto__', '', null]) {
      expect(render('oidc', false, code)).not.toContain('role="alert"');
    }
  });
});

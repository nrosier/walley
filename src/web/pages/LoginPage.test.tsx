import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_NOT_LINKED_MESSAGE, LoginForm, OIDC_FAILED_MESSAGE } from './LoginPage';

const render = (mode: 'local' | 'oidc', registration: boolean, errorCode: string | null = null) =>
  renderToStaticMarkup(<LoginForm config={{ mode, registration }} errorCode={errorCode} />);

describe('LoginPage local mode', () => {
  it('renders email and password fields and no SSO button', () => {
    const html = render('local', false);
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('Sign in with SSO');
    expect(html).not.toContain('/api/auth/oidc/login');
  });

  it('hides the register link when registration is off', () => {
    const html = render('local', false);
    expect(html).not.toContain('Create an account');
  });

  it('shows the register link when registration is on', () => {
    const html = render('local', true);
    expect(html).toContain('Create an account');
  });
});

describe('LoginPage oidc mode', () => {
  it('renders only the SSO button with no password field', () => {
    const html = render('oidc', false);
    expect(html).toContain('Sign in with SSO');
    expect(html).toContain('href="/api/auth/oidc/login"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('type="email"');
  });

  it('never shows a register link, even when registration is on', () => {
    const html = render('oidc', true);
    expect(html).not.toContain('Create an account');
  });
});

describe('LoginPage error messages', () => {
  it('renders the account_not_linked message exactly', () => {
    const html = render('oidc', false, 'account_not_linked');
    expect(html).toContain('No Walley account is linked to this identity.');
    expect(html).toContain(ACCOUNT_NOT_LINKED_MESSAGE);
  });

  it('renders the oidc_failed message in local mode too', () => {
    const html = render('local', false, 'oidc_failed');
    expect(html).toContain(OIDC_FAILED_MESSAGE);
  });

  it('shows no error message for unknown or missing codes', () => {
    expect(render('oidc', false, 'something_else')).not.toContain('role="alert"');
    expect(render('oidc', false, null)).not.toContain('role="alert"');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { errorText, I18nProvider, type Locale } from '@/i18n';
import { PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS } from '../../lib/password-policy';
import { LoginForm } from './LoginPage';
import loginSrc from './LoginPage.tsx?raw';
import { loginPageMessages } from './LoginPage.messages';
import { checkRegistration, registerErrorMessage } from './LoginPage.register';

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
    expect(html).toContain('data-slot="alert" data-variant="error"');
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

describe('LoginPage register form', () => {
  const renderRegister = (locale: Locale = 'en') =>
    renderToStaticMarkup(
      <I18nProvider initialLocale={locale}>
        <LoginForm config={{ mode: 'local', registration: true }} errorCode={null} initialRegistering />
      </I18nProvider>,
    );

  it('renders the confirm field in register mode', () => {
    const html = renderRegister();
    expect(html).toContain('name="confirmPassword"');
    expect(html).toContain('Confirm password');
    expect(renderRegister('nl')).toContain('Bevestig wachtwoord');
  });

  it('does not render the confirm field in sign-in mode', () => {
    expect(render('local', true)).not.toContain('name="confirmPassword"');
  });

  it('has Confirm password labels in en and nl', () => {
    expect(loginPageMessages.en.confirmPassword).toBe('Confirm password');
    expect(loginPageMessages.nl.confirmPassword).toBe('Bevestig wachtwoord');
  });

  it('keeps register error keys identical in en and nl', () => {
    expect(Object.keys(loginPageMessages.nl.registerErrors).sort()).toEqual(
      Object.keys(loginPageMessages.en.registerErrors).sort(),
    );
  });

  it('checks email, length and confirmation before sending', () => {
    const good = 'x'.repeat(PASSWORD_MIN_CODE_POINTS);
    expect(checkRegistration('', good, good)).toBe('email_invalid');
    expect(checkRegistration('nope', good, good)).toBe('email_invalid');
    expect(checkRegistration('a@b.nl', 'x'.repeat(PASSWORD_MIN_CODE_POINTS - 1), 'x')).toBe('password_too_short');
    const long = 'x'.repeat(PASSWORD_MAX_CODE_POINTS + 1);
    expect(checkRegistration('a@b.nl', long, long)).toBe('password_too_long');
    expect(checkRegistration('a@b.nl', good, good + 'y')).toBe('password_mismatch');
    expect(checkRegistration('a@b.nl', good, good)).toBeNull();
  });

  it('shows mismatch and too-short messages with the limits in en and nl', () => {
    expect(registerErrorMessage('password_mismatch', 'en')).toBe('The passwords do not match.');
    expect(registerErrorMessage('password_mismatch', 'nl')).toBe('De wachtwoorden komen niet overeen.');
    expect(registerErrorMessage('password_too_short', 'en')).toContain(`at least ${String(PASSWORD_MIN_CODE_POINTS)}`);
    expect(registerErrorMessage('password_too_short', 'nl')).toContain(`minimaal ${String(PASSWORD_MIN_CODE_POINTS)}`);
    expect(registerErrorMessage('password_too_long', 'en')).toContain(`at most ${String(PASSWORD_MAX_CODE_POINTS)}`);
  });

  it('maps every register server code to its own message, with no placeholders left', () => {
    const codes = ['invalid_request', 'registration_disabled', 'rate_limited', 'local_auth_disabled', 'internal', 'request_failed'];
    for (const locale of ['en', 'nl'] as const) {
      const seen = new Set<string>();
      for (const code of codes) {
        const message = registerErrorMessage(code, locale);
        expect(message).not.toBe(errorText('definitely_unknown', locale));
        expect(message).not.toMatch(/[{}]/);
        seen.add(message);
      }
      expect(seen.size).toBe(codes.length);
    }
  });

  it('falls back to the generic message for unknown codes', () => {
    expect(registerErrorMessage('nonsense', 'en')).toBe('Something went wrong. Try again.');
    expect(registerErrorMessage('constructor', 'en')).toBe('Something went wrong. Try again.');
  });
});

describe('LoginPage layout', () => {
  it('is a vertically centred card with the W brand mark, in both modes', () => {
    for (const mode of ['local', 'oidc'] as const) {
      const html = render(mode, false);
      expect(html).toContain('min-h-dvh items-center justify-center');
      expect(html).toMatch(/data-slot="brand-mark"[^>]*>W</);
    }
  });
  it('uses 44px inputs and button', () => {
    const html = render('local', true);
    expect(html.match(/<input[^>]*class="h-11 /g)).toHaveLength(2);
    expect(html).toMatch(/<button type="submit"[^>]*class="[^"]*h-11/);
  });
  it('puts the error alert above the submit button', () => {
    const html = render('local', false, 'oidc_failed');
    expect(html.indexOf('data-slot="alert"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-slot="alert"')).toBeLessThan(html.indexOf('type="submit"'));
    expect(loginSrc.indexOf("failure !== null ? (")).toBeLessThan(loginSrc.indexOf('<button type="submit"'));
  });
  it('has a "Signing in..." busy label in en and nl, used while the request runs', () => {
    expect(loginPageMessages.en.signingIn).toBe('Signing in...');
    expect(loginPageMessages.nl.signingIn).not.toBe(loginPageMessages.en.signingIn);
    expect(loginSrc).toContain("busy ? t('signingIn') : t('signIn')");
  });
});

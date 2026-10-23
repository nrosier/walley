import { PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS } from '../../lib/password-policy';
import type { Locale } from '@/i18n';
import { createT, errorText } from '@/i18n';
import { loginPageMessages } from './LoginPage.messages';

/** Codes produced by the client-side register checks. */
export type RegisterCheckCode = 'email_invalid' | 'password_too_short' | 'password_too_long' | 'password_mismatch';

type RegisterErrorCode = keyof typeof loginPageMessages.en.registerErrors;

/** Counts Unicode code points after NFKC normalisation, like the server (src/server/auth/passwords.ts). */
function codePoints(value: string): number {
  return Array.from(value.normalize('NFKC')).length;
}

/**
 * Checks the register form before any request is sent. Returns the first failing check, or null when all pass.
 * Limits come from src/lib/password-policy.ts; the server stays the authority and applies them again.
 */
export function checkRegistration(email: string, password: string, confirm: string): RegisterCheckCode | null {
  const trimmed = email.trim();
  if (trimmed === '' || !trimmed.includes('@')) return 'email_invalid';
  const length = codePoints(password);
  if (length < PASSWORD_MIN_CODE_POINTS) return 'password_too_short';
  if (length > PASSWORD_MAX_CODE_POINTS) return 'password_too_long';
  if (confirm !== password) return 'password_mismatch';
  return null;
}

/**
 * Message for a register failure: a client check code or a server code. Codes without a register-specific
 * message fall back to the shared error text, which ends in the generic message.
 */
export function registerErrorMessage(code: string, locale: Locale): string {
  const registerErrors = loginPageMessages[locale].registerErrors;
  if (!Object.hasOwn(registerErrors, code)) return errorText(code, locale);
  const t = createT(loginPageMessages, locale);
  return t(`registerErrors.${code as RegisterErrorCode}`, {
    min: PASSWORD_MIN_CODE_POINTS,
    max: PASSWORD_MAX_CODE_POINTS,
  });
}

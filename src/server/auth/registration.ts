import type { AppDatabase } from '../db/client.js';
import { getRegistrationEnabled } from '../db/app-settings.js';

/**
 * Whether new accounts may be created right now: the ALLOW_REGISTRATION ceiling AND the stored
 * admin toggle. Reads the toggle each call, so a flip applies at once. Used by the register
 * route, GET /api/auth/config and OIDC first login.
 */
export function isRegistrationOpen(db: AppDatabase, ceiling: boolean): boolean {
  return ceiling && getRegistrationEnabled(db);
}

/** True when the email is in ADMIN_EMAILS (already lowercased). Empty list: nobody. */
export function isAdminEmail(adminEmails: readonly string[], email: string): boolean {
  return adminEmails.includes(email.trim().toLowerCase());
}

/**
 * Whether this email may register right now: registration is open, or the ceiling is on and the
 * email is in ADMIN_EMAILS (so a fresh install can always create its first admin). The ceiling
 * is never bypassed. Used by the register route.
 */
export function canRegisterEmail(
  db: AppDatabase,
  ceiling: boolean,
  adminEmails: readonly string[],
  email: string,
): boolean {
  return isRegistrationOpen(db, ceiling) || (ceiling && isAdminEmail(adminEmails, email));
}

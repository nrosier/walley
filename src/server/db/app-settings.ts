/**
 * Server-wide settings in `app_settings`. The one documented exception to the user_id scoping
 * rule: these rows belong to the installation, not to a user, so there is no user to bind.
 * Only the registration toggle exists today. Nothing else may be exported from this module;
 * `exports.test.ts` pins the list. Callers must have checked that the caller is an admin.
 */
import { eq } from 'drizzle-orm';
import type { AppDatabase } from './client.js';
import { appSettings } from './schema.js';

const REGISTRATION_KEY = 'registration_enabled';

/** The stored registration toggle. A missing row, or any value but 'true', is off. */
export function getRegistrationEnabled(db: AppDatabase): boolean {
  const row = db.select().from(appSettings).where(eq(appSettings.key, REGISTRATION_KEY)).get();
  return row?.value === 'true';
}

/** Stores the registration toggle. Read on every request, so it applies without a restart. */
export function setRegistrationEnabled(db: AppDatabase, enabled: boolean): void {
  const value = enabled ? 'true' : 'false';
  db.insert(appSettings)
    .values({ key: REGISTRATION_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

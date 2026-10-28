/**
 * In-app cleanup of abandoned local registrations (issue 132, owner decision). The scheduler in
 * `../pending-cleanup-job.ts` calls it on a long interval.
 *
 * It deletes across every user with no `user_id` scope, because it has no request and no
 * owner: it is a maintenance exception to the user_id scoping rule, like `cleanup-unverified.ts`.
 * It removes only
 *   - verification tokens that have expired, and
 *   - users who are unverified, older than the verification window, hold no live token and
 *     have no linked identity (so they never held a session and never had any data).
 * A verified user is never touched. Nothing else may be exported from this module besides the
 * result type.
 */
import { and, isNull, lte, notExists, eq, sql } from 'drizzle-orm';
import type { AppDatabase } from './client.js';
import { emailVerifications, userIdentities, users } from './schema.js';

export interface PendingCleanupResult {
  readonly expiredTokens: number;
  readonly unverifiedUsers: number;
}

/**
 * Deletes expired tokens, then unverified users older than `windowMs` with no token left and no
 * identity, in one transaction. A user with a live token is kept even when old, because a later
 * registration for the same address issues a fresh token.
 */
export function deleteExpiredPendingRegistrations(
  db: AppDatabase,
  now: Date,
  windowMs: number,
): PendingCleanupResult {
  const cutoff = new Date(now.getTime() - windowMs);
  return db.transaction((tx) => {
    const expiredTokens = tx
      .delete(emailVerifications)
      .where(lte(emailVerifications.expiresAt, now))
      .run().changes;
    const unverifiedUsers = tx
      .delete(users)
      .where(
        and(
          isNull(users.emailVerifiedAt),
          lte(users.createdAt, cutoff),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(emailVerifications)
              .where(eq(emailVerifications.userId, users.id)),
          ),
          notExists(
            tx
              .select({ one: sql`1` })
              .from(userIdentities)
              .where(eq(userIdentities.userId, users.id)),
          ),
        ),
      )
      .run().changes;
    return { expiredTokens, unverifiedUsers };
  });
}

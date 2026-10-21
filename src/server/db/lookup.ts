/**
 * Pre-authentication reads (decision O2, approved by the owner).
 *
 * At sign-in there is no user id yet: finding it is the point of the query. These four
 * functions are the only unscoped reads in the data layer. They are read-only; every
 * session and identity write goes through `createUserRepo`, scoped to a user.
 * Nothing else may be exported from this module.
 */
import { and, eq, notExists, sql } from 'drizzle-orm';
import type { AppDatabase } from './client.js';
import { sessions, userIdentities, users, type SessionRow } from './schema.js';

/** Looks a session up by the hex SHA-256 of its token (the primary key). */
export function findSessionByIdHash(db: AppDatabase, idHash: string): SessionRow | undefined {
  return db.select().from(sessions).where(eq(sessions.id, idHash)).get();
}

/** Looks a user up by email for local sign-in. Trims and lowercases, as stored. */
export function findLoginByEmail(
  db: AppDatabase,
  email: string,
): { userId: string; passwordHash: string | null } | undefined {
  return db
    .select({ userId: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .get();
}

/** Returns the user id mapped to this (issuer, subject), if any. */
export function findUserIdByIdentity(
  db: AppDatabase,
  issuer: string,
  subject: string,
): string | undefined {
  return db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(and(eq(userIdentities.issuer, issuer), eq(userIdentities.subject, subject)))
    .get()?.userId;
}

/**
 * Returns the user with this email (case-insensitive) who has no identity at this issuer.
 * Used to link a local account to a first OIDC login.
 */
export function findLinkCandidate(
  db: AppDatabase,
  email: string,
  issuer: string,
): string | undefined {
  return db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(sql`lower(${users.email})`, email.trim().toLowerCase()),
        notExists(
          db
            .select({ one: sql`1` })
            .from(userIdentities)
            .where(and(eq(userIdentities.userId, users.id), eq(userIdentities.issuer, issuer))),
        ),
      ),
    )
    .get()?.id;
}

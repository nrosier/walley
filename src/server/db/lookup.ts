/**
 * Pre-authentication reads (decision O2, approved by the owner).
 *
 * At sign-in there is no user id yet: finding it is the point of the query. These five
 * functions are the only unscoped reads in the data layer: `findSessionByIdHash`,
 * `findEmailVerificationUserId` (the only token-keyed read), `findLoginByEmail`,
 * `findUserIdByIdentity` and `findLinkCandidate`. They are read-only; every session,
 * identity and verification write goes through `createUserRepo`, scoped to a user.
 * Nothing else may be exported from this module.
 */
import { and, eq, gt, notExists, sql } from 'drizzle-orm';
import type { AppDatabase } from './client.js';
import {
  emailVerifications,
  sessions,
  userIdentities,
  users,
  type SessionRow,
} from './schema.js';

/** Looks a session up by the hex SHA-256 of its token (the primary key). */
export function findSessionByIdHash(db: AppDatabase, idHash: string): SessionRow | undefined {
  return db.select().from(sessions).where(eq(sessions.id, idHash)).get();
}

/**
 * Returns the owner of an unexpired email verification token, given the hex SHA-256 of the
 * token. This is the only token-keyed read: the caller then consumes the token through
 * `createUserRepo(db, owner)`, whose delete is also bound to that owner.
 */
export function findEmailVerificationUserId(
  db: AppDatabase,
  idHash: string,
  now: Date,
): string | undefined {
  return db
    .select({ userId: emailVerifications.userId })
    .from(emailVerifications)
    .where(and(eq(emailVerifications.id, idHash), gt(emailVerifications.expiresAt, now)))
    .get()?.userId;
}

/** Looks a user up by email for local sign-in. Trims and lowercases, as stored. */
export function findLoginByEmail(
  db: AppDatabase,
  email: string,
): { userId: string; passwordHash: string | null; emailVerified: boolean } | undefined {
  const row = db
    .select({
      userId: users.id,
      passwordHash: users.passwordHash,
      verifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .get();
  if (row === undefined) return undefined;
  return { userId: row.userId, passwordHash: row.passwordHash, emailVerified: row.verifiedAt !== null };
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
 * Returns the user with this email (case-insensitive) who has no identity at this issuer,
 * and whether that user's email is verified. Used to link a local account to a first OIDC
 * login.
 */
export function findLinkCandidate(
  db: AppDatabase,
  email: string,
  issuer: string,
): { id: string; emailVerified: boolean } | undefined {
  const row = db
    .select({ id: users.id, verifiedAt: users.emailVerifiedAt })
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
    .get();
  return row === undefined ? undefined : { id: row.id, emailVerified: row.verifiedAt !== null };
}

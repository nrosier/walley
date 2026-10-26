/**
 * One-off cleanup of legacy unverified rows, run by `scripts/cleanup-unverified-passwords.ts`
 * (`npm run db:cleanup-unverified`). It is NOT part of the migration chain and the app never
 * calls it. It works on a raw handle and touches every user, so it is a maintenance exception
 * to the user_id scoping rule.
 */
import type Database from 'better-sqlite3';

export interface CleanupCounts {
  /** Users with `email_verified_at` null and a non-null `password_hash`. */
  readonly unverifiedWithPassword: number;
  /** Verification tokens with a null `pending_password_hash`. */
  readonly tokensWithoutPending: number;
}

function count(sqlite: Database.Database, sql: string): number {
  return (sqlite.prepare(sql).get() as { n: number }).n;
}

export function countLegacyRows(sqlite: Database.Database): CleanupCounts {
  return {
    unverifiedWithPassword: count(
      sqlite,
      'select count(*) as n from users where email_verified_at is null and password_hash is not null',
    ),
    tokensWithoutPending: count(
      sqlite,
      'select count(*) as n from email_verifications where pending_password_hash is null',
    ),
  };
}

/**
 * Counts the legacy rows. With `apply` true it also nulls the password hash of every
 * unverified user and deletes every token with a null pending hash, in one transaction.
 * Without it nothing is written.
 */
export function cleanupUnverifiedPasswords(
  sqlite: Database.Database,
  apply: boolean,
): { before: CleanupCounts; after: CleanupCounts } {
  const run = sqlite.transaction(() => {
    const before = countLegacyRows(sqlite);
    if (apply) {
      sqlite.prepare('update users set password_hash = null where email_verified_at is null').run();
      sqlite.prepare('delete from email_verifications where pending_password_hash is null').run();
    }
    return { before, after: countLegacyRows(sqlite) };
  });
  return run();
}

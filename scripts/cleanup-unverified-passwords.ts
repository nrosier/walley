/**
 * ONE-OFF, DESTRUCTIVE when run with --apply. Dry run by default: prints the counts and writes
 * nothing. With --apply, in one transaction, it sets users.password_hash to null where
 * email_verified_at is null and deletes email_verifications rows whose pending_password_hash
 * is null. Not part of the migration chain; back up the database first.
 *
 * Run: npm run db:cleanup-unverified -- <path-to-walley.db> [--apply]
 *      (the path may also come from DATABASE_PATH)
 */
import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { cleanupUnverifiedPasswords, type CleanupCounts } from '../src/server/db/cleanup-unverified.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const path = args.find((arg) => !arg.startsWith('--')) ?? process.env['DATABASE_PATH'];

if (path === undefined || path === '' || path === ':memory:' || !existsSync(path)) {
  console.error('Give the path of an existing database file as an argument or in DATABASE_PATH.');
  process.exit(1);
}

const print = (label: string, c: CleanupCounts): void => {
  console.log(
    `${label}: unverified users with a password_hash = ${String(c.unverifiedWithPassword)}, ` +
      `tokens with a null pending hash = ${String(c.tokensWithoutPending)}`,
  );
};

const sqlite = new Database(path);
try {
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const { before, after } = cleanupUnverifiedPasswords(sqlite, apply);
  print('before', before);
  print('after ', after);
  console.log(apply ? 'Applied.' : 'Dry run: nothing written. Re-run with --apply to write.');
} finally {
  sqlite.close();
}

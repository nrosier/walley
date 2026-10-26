import { afterEach, describe, expect, it } from 'vitest';
import { cleanupUnverifiedPasswords, countLegacyRows } from './cleanup-unverified.js';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import { createUserRepo } from './repo.js';

let db: AppDatabase | undefined;

afterEach(() => {
  if (db !== undefined) closeDatabase(db);
  db = undefined;
});

function seed(): AppDatabase {
  const d = openDatabase(':memory:');
  db = d;
  const legacy = createUser(d, { email: 'legacy@example.test', passwordHash: 'legacy-hash' });
  const fresh = createUser(d, { email: 'fresh@example.test', passwordHash: null });
  const verified = createUser(d, { email: 'ok@example.test', passwordHash: 'ok-hash', verifiedAt: new Date(1000) });
  const expiresAt = new Date(Date.now() + 60_000);
  const now = new Date();
  createUserRepo(d, legacy.id).createEmailVerification({ idHash: 'a'.repeat(64), now, expiresAt, pendingPasswordHash: 'p' });
  createUserRepo(d, fresh.id).createEmailVerification({ idHash: 'b'.repeat(64), now, expiresAt, pendingPasswordHash: 'p' });
  createUserRepo(d, verified.id).createEmailVerification({ idHash: 'c'.repeat(64), now, expiresAt, pendingPasswordHash: 'p' });
  d.$client.prepare("update email_verifications set pending_password_hash = null where id = ?").run('a'.repeat(64));
  return d;
}

const hashes = (d: AppDatabase) =>
  d.$client.prepare('select email, password_hash as h from users order by email').all();

describe('cleanupUnverifiedPasswords', () => {
  it('dry run reports the counts and writes nothing', () => {
    const d = seed();
    const rowsBefore = hashes(d);
    const result = cleanupUnverifiedPasswords(d.$client, false);
    expect(result.before).toEqual({ unverifiedWithPassword: 1, tokensWithoutPending: 1 });
    expect(result.after).toEqual(result.before);
    expect(hashes(d)).toEqual(rowsBefore);
    expect(countLegacyRows(d.$client)).toEqual(result.before);
  });

  it('apply nulls unverified hashes and deletes null-pending tokens only', () => {
    const d = seed();
    const result = cleanupUnverifiedPasswords(d.$client, true);
    expect(result.before).toEqual({ unverifiedWithPassword: 1, tokensWithoutPending: 1 });
    expect(result.after).toEqual({ unverifiedWithPassword: 0, tokensWithoutPending: 0 });
    expect(hashes(d)).toEqual([
      { email: 'fresh@example.test', h: null },
      { email: 'legacy@example.test', h: null },
      { email: 'ok@example.test', h: 'ok-hash' },
    ]);
    const tokens = d.$client.prepare('select count(*) as n from email_verifications').get() as { n: number };
    expect(tokens.n).toBe(2);
  });
});

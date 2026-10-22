import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import { createUserRepo } from './repo.js';

describe('createUser', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('lowercases and trims the email', () => {
    const user = createUser(db, { email: '  Alice@Example.COM ', passwordHash: 'hash' });
    expect(user.email).toBe('alice@example.com');
    expect(user.id).not.toBe('');
    const stored = db.$client
      .prepare('SELECT email FROM users WHERE id = ?')
      .get(user.id) as { email: string };
    expect(stored.email).toBe('alice@example.com');
  });

  it('gives two users different 32-byte salts', () => {
    const a = createUser(db, { email: 'a@example.com', passwordHash: null });
    const b = createUser(db, { email: 'b@example.com', passwordHash: null });
    const saltA = createUserRepo(db, a.id).getKeySalt();
    const saltB = createUserRepo(db, b.id).getKeySalt();
    expect(saltA?.length).toBe(32);
    expect(saltB?.length).toBe(32);
    expect(saltA?.equals(saltB as Buffer)).toBe(false);
  });

  it('writes a local registration unverified and an OIDC user verified', () => {
    const local = createUser(db, { email: 'l@example.com', passwordHash: 'h' });
    const sso = createUser(db, {
      email: 's@example.com',
      passwordHash: null,
      identity: { issuer: 'https://idp', subject: 's1' },
    });
    const at = (id: string) =>
      (db.$client.prepare('SELECT email_verified_at AS v FROM users WHERE id = ?').get(id) as {
        v: number | null;
      }).v;
    expect(at(local.id)).toBeNull();
    expect(at(sso?.id ?? '')).toBeGreaterThan(0);
  });

  it('accepts an explicit verifiedAt', () => {
    const user = createUser(db, {
      email: 'v@example.com',
      passwordHash: 'h',
      verifiedAt: new Date(7_000),
    });
    const row = db.$client
      .prepare('SELECT email_verified_at AS v FROM users WHERE id = ?')
      .get(user.id) as { v: number };
    expect(row.v).toBe(7_000);
  });

  it('accepts a null passwordHash', () => {
    const user = createUser(db, { email: 'sso@example.com', passwordHash: null });
    const stored = db.$client
      .prepare('SELECT password_hash AS h FROM users WHERE id = ?')
      .get(user.id) as { h: string | null };
    expect(stored.h).toBeNull();
  });
});

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, closeDatabase, openDatabase, type AppDatabase } from './client.js';

interface NameRow {
  name: string;
}

function tableNames(db: AppDatabase): string[] {
  const rows = db.$client
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as NameRow[];
  return rows.map((row) => row.name).sort();
}

function journalCount(db: AppDatabase): number {
  const row = db.$client.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as {
    n: number;
  };
  return row.n;
}

describe('openDatabase', () => {
  let dir: string;
  const open: AppDatabase[] = [];

  function track(db: AppDatabase): AppDatabase {
    open.push(db);
    return db;
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'walley-db-'));
  });

  afterEach(() => {
    for (const db of open.splice(0)) {
      if (db.$client.open) {
        closeDatabase(db);
      }
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates the folder, the file and every table', () => {
    const path = join(dir, 'nested', 'deeper', 'walley.db');
    const db = track(openDatabase(path));
    expect(existsSync(path)).toBe(true);
    expect(tableNames(db)).toEqual([
      '__drizzle_migrations',
      'email_verifications',
      'matches',
      'overwrite_snapshots',
      'sessions',
      'subscription_overrides',
      'user_configs',
      'user_identities',
      'users',
    ]);
  });

  it('upgrades a database at 0001 and marks its existing users verified', () => {
    // Build a migrations folder holding only 0000 and 0001, as an older release shipped it.
    const old = join(dir, 'old-migrations');
    cpSync(MIGRATIONS_FOLDER, old, { recursive: true });
    const journalPath = join(old, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 2);
    writeFileSync(journalPath, JSON.stringify(journal));

    const path = join(dir, 'walley.db');
    const raw = new Database(path);
    migrate(drizzle(raw), { migrationsFolder: old });
    raw
      .prepare('INSERT INTO users (id, email, key_salt, created_at) VALUES (?, ?, ?, ?)')
      .run('u1', 'a@example.com', Buffer.alloc(32, 1), 1234);
    raw.close();

    const db = track(openDatabase(path));
    expect(journalCount(db)).toBe(8);
    const row = db.$client
      .prepare("SELECT email_verified_at AS v FROM users WHERE id = 'u1'")
      .get() as { v: number | null };
    expect(row.v).toBe(1234);
    // A user registered after the upgrade starts unverified.
    db.$client
      .prepare('INSERT INTO users (id, email, key_salt) VALUES (?, ?, ?)')
      .run('u2', 'b@example.com', Buffer.alloc(32, 2));
    const fresh = db.$client
      .prepare("SELECT email_verified_at AS v FROM users WHERE id = 'u2'")
      .get() as { v: number | null };
    expect(fresh.v).toBeNull();
  });

  it('gives an email_verifications row from before 0007 failed_attempts 0', () => {
    const old = join(dir, 'old-migrations-0006');
    cpSync(MIGRATIONS_FOLDER, old, { recursive: true });
    const journalPath = join(old, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 7);
    writeFileSync(journalPath, JSON.stringify(journal));

    const path = join(dir, 'walley.db');
    const raw = new Database(path);
    migrate(drizzle(raw), { migrationsFolder: old });
    raw.prepare('INSERT INTO users (id, email, key_salt, created_at) VALUES (?, ?, ?, ?)').run('u1', 'a@example.com', Buffer.alloc(32, 1), 1234);
    raw
      .prepare('INSERT INTO email_verifications (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run('a'.repeat(64), 'u1', 99, 1);
    raw.close();

    const db = track(openDatabase(path));
    expect(journalCount(db)).toBe(8);
    const row = db.$client.prepare('SELECT failed_attempts AS n FROM email_verifications').get() as { n: number };
    expect(row.n).toBe(0);
  });

  it('is idempotent and keeps data across a second open', () => {
    const path = join(dir, 'walley.db');
    const first = openDatabase(path);
    first.$client
      .prepare('INSERT INTO users (id, email, key_salt) VALUES (?, ?, ?)')
      .run('u1', 'a@example.com', Buffer.alloc(32, 1));
    expect(journalCount(first)).toBe(8);
    closeDatabase(first);

    const second = track(openDatabase(path));
    expect(journalCount(second)).toBe(8);
    const users = second.$client.prepare('SELECT id FROM users').all() as { id: string }[];
    expect(users).toEqual([{ id: 'u1' }]);
  });

  it('turns foreign keys on', () => {
    const db = track(openDatabase(join(dir, 'walley.db')));
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('uses WAL for a file database', () => {
    const db = track(openDatabase(join(dir, 'walley.db')));
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('opens an in-memory database with migrations applied', () => {
    const db = track(openDatabase(':memory:'));
    expect(tableNames(db)).toContain('users');
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('throws for a path under a file', () => {
    const file = join(dir, 'plain-file');
    writeFileSync(file, 'x');
    expect(() => openDatabase(join(file, 'walley.db'))).toThrow();
  });

  it('throws when the migrations cannot be applied', () => {
    const path = join(dir, 'walley.db');
    const first = openDatabase(path);
    // With no journal, the first migration runs again and fails on the existing tables.
    first.$client.exec('DROP TABLE __drizzle_migrations');
    closeDatabase(first);
    expect(() => openDatabase(path)).toThrow();
  });
});

describe('closeDatabase', () => {
  it('closes the underlying handle', () => {
    const db = openDatabase(':memory:');
    closeDatabase(db);
    expect(db.$client.open).toBe(false);
  });
});

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
      'app_settings',
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
    expect(journalCount(db)).toBe(14);
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

  it('voids email_verifications rows from before 0011, keeps their users and drops failed_attempts', () => {
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
    expect(journalCount(db)).toBe(14);
    const tokens = db.$client.prepare('SELECT count(*) AS n FROM email_verifications').get() as { n: number };
    expect(tokens.n).toBe(0);
    const user = db.$client.prepare("SELECT email_verified_at AS v FROM users WHERE id = 'u1'").get() as { v: number | null };
    expect(user.v).toBeNull();
    const cols = db.$client.prepare("pragma table_info('email_verifications')").all() as { name: string }[];
    expect(cols.map((c) => c.name)).not.toContain('failed_attempts');
  });

  it('adds first_seen_next_payment on 0008 and keeps existing match rows with a null anchor', () => {
    const old = join(dir, 'old-migrations-0007');
    cpSync(MIGRATIONS_FOLDER, old, { recursive: true });
    const journalPath = join(old, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, 8);
    writeFileSync(journalPath, JSON.stringify(journal));

    const path = join(dir, 'walley.db');
    const raw = new Database(path);
    migrate(drizzle(raw), { migrationsFolder: old });
    raw.prepare('INSERT INTO users (id, email, key_salt, created_at) VALUES (?, ?, ?, ?)').run('u1', 'a@example.com', Buffer.alloc(32, 1), 1234);
    raw
      .prepare("INSERT INTO matches (id, user_id, wallos_id, actual_schedule_id, status, last_known_wallos_hash) VALUES ('m1', 'u1', 'w1', 'a1', 'LINKED', 'hw')")
      .run();
    raw.close();

    const db = track(openDatabase(path));
    expect(journalCount(db)).toBe(14);
    const row = db.$client
      .prepare("SELECT first_seen_next_payment AS f, last_known_wallos_hash AS h, status FROM matches WHERE id = 'm1'")
      .get() as { f: string | null; h: string; status: string };
    expect(row).toEqual({ f: null, h: 'hw', status: 'LINKED' });
  });

  function oldDb(name: string, entries: number): string {
    const old = join(dir, name);
    cpSync(MIGRATIONS_FOLDER, old, { recursive: true });
    const journalPath = join(old, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: unknown[] };
    journal.entries = journal.entries.slice(0, entries);
    writeFileSync(journalPath, JSON.stringify(journal));
    const path = join(dir, `${name}.db`);
    const raw = new Database(path);
    migrate(drizzle(raw), { migrationsFolder: old });
    raw.prepare('INSERT INTO users (id, email, key_salt, created_at) VALUES (?, ?, ?, ?)').run('u1', 'a@example.com', Buffer.alloc(32, 1), 1234);
    raw
      .prepare("INSERT INTO matches (id, user_id, wallos_id, actual_schedule_id, status, last_known_wallos_hash, last_known_actual_hash) VALUES ('m1', 'u1', 'w1', 'a1', 'LINKED', 'hw', 'ha')")
      .run();
    raw
      .prepare("INSERT INTO user_configs (user_id, wallos_url, wallos_api_key_enc, actual_url, actual_password_enc, actual_sync_key_enc, actual_budget_id, tolerance_percent) VALUES ('u1', 'https://w', 'enc-w', 'https://a', 'enc-p', 'enc-s', 'b1', 7)")
      .run();
    raw.close();
    return path;
  }

  const CONFIG_SQL = 'SELECT * FROM user_configs WHERE user_id = ?';
  const MATCH_SQL =
    "SELECT status, last_known_wallos_hash AS hw, last_known_actual_hash AS ha, last_known_wallos_amount_cents AS c, last_known_wallos_price_minor AS p, last_known_wallos_currency AS cur FROM matches WHERE id = 'm1'";

  it('upgrades 0011 to the rate-margin columns and keeps every config column byte-identical', () => {
    const path = oldDb('old-migrations-0011', 12);
    const before = new Database(path);
    const configBefore = before.prepare(CONFIG_SQL).get('u1') as Record<string, unknown>;
    before.close();

    const db = track(openDatabase(path));
    expect(journalCount(db)).toBe(14);
    expect(db.$client.prepare(MATCH_SQL).get()).toEqual({
      status: 'LINKED', hw: 'hw', ha: 'ha', c: null, p: null, cur: null,
    });
    const configAfter = db.$client.prepare(CONFIG_SQL).get('u1') as Record<string, unknown>;
    expect(configAfter.currency_drift_percent).toBe(2);
    const rest = { ...configAfter };
    delete rest.currency_drift_percent;
    expect(rest).toEqual(configBefore);
    expect(rest.tolerance_percent).toBe(7);
    expect(rest.wallos_api_key_enc).toBe('enc-w');
  });

  it('upgrades 0012 to 0013 with an existing row and keeps a stored drift value', () => {
    const path = oldDb('old-migrations-0012', 13);
    const raw = new Database(path);
    raw.prepare("UPDATE user_configs SET currency_drift_percent = 4.5 WHERE user_id = 'u1'").run();
    raw.close();

    const db = track(openDatabase(path));
    expect(journalCount(db)).toBe(14);
    const row = db.$client.prepare(CONFIG_SQL).get('u1') as Record<string, unknown>;
    expect(row.currency_drift_percent).toBe(4.5);
    expect(row.actual_sync_key_enc).toBe('enc-s');
  });

  it('refuses a currency_drift_percent outside 0..10 and accepts the bounds', () => {
    const db = track(openDatabase(join(dir, 'walley.db')));
    db.$client.prepare('INSERT INTO users (id, email, key_salt) VALUES (?, ?, ?)').run('u1', 'a@example.com', Buffer.alloc(32, 1));
    const insert = db.$client.prepare('INSERT INTO user_configs (user_id, currency_drift_percent) VALUES (?, ?)');
    expect(() => insert.run('u1', 10.5)).toThrow(/CHECK/i);
    expect(() => insert.run('u1', -0.5)).toThrow(/CHECK/i);
    expect(() => insert.run('u1', 10)).not.toThrow();
    expect(() => db.$client.prepare("UPDATE user_configs SET currency_drift_percent = 0 WHERE user_id = 'u1'").run()).not.toThrow();
    expect(() => db.$client.prepare("UPDATE user_configs SET currency_drift_percent = 11 WHERE user_id = 'u1'").run()).toThrow(/CHECK/i);
  });

  it('is idempotent and keeps data across a second open', () => {
    const path = join(dir, 'walley.db');
    const first = openDatabase(path);
    first.$client
      .prepare('INSERT INTO users (id, email, key_salt) VALUES (?, ?, ?)')
      .run('u1', 'a@example.com', Buffer.alloc(32, 1));
    expect(journalCount(first)).toBe(14);
    closeDatabase(first);

    const second = track(openDatabase(path));
    expect(journalCount(second)).toBe(14);
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

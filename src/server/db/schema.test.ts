import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MATCH_STATUSES, isMatchStatus, type MatchStatus } from '../../lib/match-status.js';
import * as schema from './schema.js';
import { matches, userConfigs, userIdentities, users } from './schema.js';

const migrationsFolder = fileURLToPath(new URL('./migrations/', import.meta.url));

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

function addUser(id: string, email = `${id}@example.com`, salt: Buffer = randomBytes(32)): void {
  db.insert(users).values({ id, email, passwordHash: 'hash', keySalt: salt }).run();
}

let seq = 0;
function addMatch(
  userId: string,
  wallosId: string | null,
  actualScheduleId: string | null,
  status: MatchStatus = 'LINKED',
): void {
  db.insert(matches)
    .values({ id: `m${String((seq += 1))}`, userId, wallosId, actualScheduleId, status })
    .run();
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  addUser('u1');
  addUser('u2');
});

afterEach(() => {
  sqlite.close();
});

describe('migration', () => {
  it('creates users, user_identities, user_configs and matches', () => {
    const rows = sqlite
      .prepare("select name from sqlite_master where type = 'table' and name not like '%migrations' order by name")
      .all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(['matches', 'user_configs', 'user_identities', 'users']);
  });
});

describe('isMatchStatus', () => {
  it('accepts every status and rejects anything else', () => {
    for (const s of MATCH_STATUSES) expect(isMatchStatus(s)).toBe(true);
    expect(isMatchStatus('BAD')).toBe(false);
    expect(isMatchStatus(undefined)).toBe(false);
  });
});

describe('matches', () => {
  it('rejects a second match with the same user_id and wallos_id', () => {
    addMatch('u1', 'w1', 'a1');
    expect(() => { addMatch('u1', 'w1', 'a2'); }).toThrow(/UNIQUE/);
  });

  it('rejects a second match with the same user_id and actual_schedule_id', () => {
    addMatch('u1', 'w1', 'a1');
    expect(() => { addMatch('u1', 'w2', 'a1'); }).toThrow(/UNIQUE/);
  });

  it('allows the same wallos_id for two different users', () => {
    addMatch('u1', 'w1', 'a1');
    expect(() => { addMatch('u2', 'w1', 'a1'); }).not.toThrow();
  });

  it('accepts every status that satisfies the side rule', () => {
    addMatch('u1', 'w1', 'a1', 'LINKED');
    addMatch('u1', 'w2', 'a2', 'MISMATCH_DETECTED');
    addMatch('u1', 'w3', null, 'IGNORED_WALLOS');
    addMatch('u1', null, 'a4', 'IGNORED_ACTUAL');
    expect(db.select().from(matches).all()).toHaveLength(4);
  });

  it('rejects a status outside the enum', () => {
    expect(() =>
      sqlite
        .prepare("insert into matches (id, user_id, wallos_id, actual_schedule_id, status) values ('mx', 'u1', 'w1', 'a1', 'BAD')")
        .run(),
    ).toThrow(/CHECK/);
  });

  it('rejects a match whose status and sides disagree', () => {
    expect(() => { addMatch('u1', 'w1', null, 'LINKED'); }).toThrow(/CHECK/);
    expect(() => { addMatch('u1', null, 'a1', 'MISMATCH_DETECTED'); }).toThrow(/CHECK/);
    expect(() => { addMatch('u1', null, 'a1', 'IGNORED_WALLOS'); }).toThrow(/CHECK/);
    expect(() => { addMatch('u1', 'w1', null, 'IGNORED_ACTUAL'); }).toThrow(/CHECK/);
  });
});

describe('cascade', () => {
  it('deleting a user deletes their identities, config and matches', () => {
    db.insert(userIdentities).values({ id: 'i1', userId: 'u1', issuer: 'https://idp', subject: 's1' }).run();
    db.insert(userConfigs).values({ userId: 'u1' }).run();
    addMatch('u1', 'w1', 'a1');
    addMatch('u2', 'w1', 'a1');

    db.delete(users).where(eq(users.id, 'u1')).run();

    expect(db.select().from(userIdentities).all()).toHaveLength(0);
    expect(db.select().from(userConfigs).all()).toHaveLength(0);
    const left = db.select().from(matches).all();
    expect(left).toHaveLength(1);
    expect(left[0]?.userId).toBe('u2');
  });
});

describe('users', () => {
  it('rejects a key_salt that is not 32 bytes', () => {
    expect(() => { addUser('u3', 'u3@example.com', randomBytes(16)); }).toThrow(/CHECK/);
    expect(() => { addUser('u4', 'u4@example.com', randomBytes(33)); }).toThrow(/CHECK/);
  });

  it('stores key_salt as a 32-byte Buffer', () => {
    const salt = randomBytes(32);
    addUser('u3', 'u3@example.com', salt);
    const row = db.select().from(users).where(eq(users.id, 'u3')).get();
    expect(Buffer.isBuffer(row?.keySalt)).toBe(true);
    expect(row?.keySalt.equals(salt)).toBe(true);
  });

  it('accepts a user with a null password_hash', () => {
    expect(() =>
      db.insert(users).values({ id: 'u3', email: 'u3@example.com', passwordHash: null, keySalt: randomBytes(32) }).run(),
    ).not.toThrow();
  });

  it('rejects a duplicate email', () => {
    expect(() => { addUser('u3', 'u1@example.com'); }).toThrow(/UNIQUE/);
  });

  it('rejects a mixed-case email', () => {
    expect(() => { addUser('u3', 'Mixed@Example.com'); }).toThrow(/CHECK/);
  });

  it('sets created_at by default', () => {
    const row = db.select().from(users).where(eq(users.id, 'u1')).get();
    expect(row?.createdAt.getTime()).toBeGreaterThan(0);
  });
});

describe('user_identities', () => {
  it('rejects a duplicate (issuer, subject)', () => {
    db.insert(userIdentities).values({ id: 'i1', userId: 'u1', issuer: 'https://idp', subject: 's1' }).run();
    expect(() =>
      db.insert(userIdentities).values({ id: 'i2', userId: 'u2', issuer: 'https://idp', subject: 's1' }).run(),
    ).toThrow(/UNIQUE/);
  });

  it('rejects a second identity for one user at one issuer', () => {
    db.insert(userIdentities).values({ id: 'i1', userId: 'u1', issuer: 'https://idp', subject: 's1' }).run();
    expect(() =>
      db.insert(userIdentities).values({ id: 'i2', userId: 'u1', issuer: 'https://idp', subject: 's2' }).run(),
    ).toThrow(/UNIQUE/);
  });
});

describe('user_configs', () => {
  it('defaults tolerance_percent to 5', () => {
    db.insert(userConfigs).values({ userId: 'u1' }).run();
    const row = db.select().from(userConfigs).where(eq(userConfigs.userId, 'u1')).get();
    expect(row?.tolerancePercent).toBe(5);
  });

  it('rejects tolerance_percent above 100 and below 0', () => {
    expect(() => db.insert(userConfigs).values({ userId: 'u1', tolerancePercent: 100.5 }).run()).toThrow(/CHECK/);
    expect(() => db.insert(userConfigs).values({ userId: 'u2', tolerancePercent: -1 }).run()).toThrow(/CHECK/);
  });
});

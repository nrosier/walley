import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import { createUserRepo, type UserRepo } from './repo.js';

describe('tenant isolation', () => {
  let db: AppDatabase;
  let a: UserRepo;
  let b: UserRepo;

  beforeEach(() => {
    db = openDatabase(':memory:');
    a = createUserRepo(db, createUser(db, { email: 'a@example.com', passwordHash: null }).id);
    b = createUserRepo(db, createUser(db, { email: 'b@example.com', passwordHash: null }).id);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('A cannot read B config', () => {
    b.upsertConfig({ wallosUrl: 'https://b.test', wallosApiKeyEnc: 'v1:b' });
    expect(a.getConfig()).toBeUndefined();
    expect(b.getConfig()?.wallosUrl).toBe('https://b.test');
  });

  it('A listMatches excludes B rows', () => {
    const mine = a.insertMatch({ wallosId: 'w1', actualScheduleId: 'a1', status: 'LINKED' });
    b.insertMatch({ wallosId: 'w1', actualScheduleId: 'a1', status: 'LINKED' });
    b.insertMatch({ wallosId: 'w2', actualScheduleId: 'a2', status: 'LINKED' });
    expect(a.listMatches().map((m) => m.id)).toEqual([mine.id]);
    expect(b.listMatches()).toHaveLength(2);
  });

  it('A getMatch of a B match id is undefined', () => {
    const theirs = b.insertMatch({ wallosId: 'w1', actualScheduleId: 'a1', status: 'LINKED' });
    expect(a.getMatch(theirs.id)).toBeUndefined();
    expect(b.getMatch(theirs.id)).toEqual(theirs);
  });

  it('A updateMatch of a B match id returns false and leaves the row unchanged', () => {
    const theirs = b.insertMatch({ wallosId: 'w1', actualScheduleId: 'a1', status: 'LINKED' });
    expect(a.updateMatch(theirs.id, { status: 'MISMATCH_DETECTED', lastKnownWallosHash: 'x' })).toBe(
      false,
    );
    expect(b.getMatch(theirs.id)).toEqual(theirs);
  });

  it('A deleteMatch of a B match id returns false and the row still exists', () => {
    const theirs = b.insertMatch({ wallosId: 'w1', actualScheduleId: 'a1', status: 'LINKED' });
    expect(a.deleteMatch(theirs.id)).toBe(false);
    expect(b.getMatch(theirs.id)).toEqual(theirs);
  });

  it('A upsertConfig leaves B config unchanged', () => {
    const before = b.upsertConfig({ wallosUrl: 'https://b.test', tolerancePercent: 7 });
    a.upsertConfig({ wallosUrl: 'https://a.test', tolerancePercent: 1 });
    expect(b.getConfig()).toEqual(before);
    expect(a.getConfig()?.wallosUrl).toBe('https://a.test');
  });
});

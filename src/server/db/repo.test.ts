import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import { createUserRepo, type MatchInput, type MatchPatch } from './repo.js';

describe('createUserRepo', () => {
  let db: AppDatabase;
  let userId: string;
  let otherId: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    userId = createUser(db, { email: 'a@example.com', passwordHash: null }).id;
    otherId = createUser(db, { email: 'b@example.com', passwordHash: null }).id;
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('throws TypeError for an empty userId', () => {
    expect(() => createUserRepo(db, '')).toThrow(TypeError);
  });

  it('getKeySalt returns the salt, or undefined for an unknown user', () => {
    expect(createUserRepo(db, userId).getKeySalt()?.length).toBe(32);
    expect(createUserRepo(db, 'no-such-user').getKeySalt()).toBeUndefined();
  });

  it('insertMatch ignores a userId or id key in the input', () => {
    const input = {
      wallosId: 'w1',
      actualScheduleId: 'a1',
      status: 'LINKED',
      userId: otherId,
      id: 'forced-id',
    } as MatchInput;
    const row = createUserRepo(db, userId).insertMatch(input);
    expect(row.userId).toBe(userId);
    expect(row.id).not.toBe('forced-id');
    const stored = db.$client
      .prepare('SELECT user_id AS u FROM matches WHERE id = ?')
      .get(row.id) as { u: string };
    expect(stored.u).toBe(userId);
    expect(createUserRepo(db, otherId).listMatches()).toEqual([]);
  });

  it('updateMatch ignores a userId or id key in the patch', () => {
    const repo = createUserRepo(db, userId);
    const row = repo.insertMatch({ wallosId: 'w1', actualScheduleId: 'a1', status: 'LINKED' });
    const patch = { status: 'MISMATCH_DETECTED', userId: otherId, id: 'forced-id' } as MatchPatch;
    expect(repo.updateMatch(row.id, patch)).toBe(true);
    const updated = repo.getMatch(row.id);
    expect(updated?.userId).toBe(userId);
    expect(updated?.id).toBe(row.id);
    expect(updated?.status).toBe('MISMATCH_DETECTED');
  });

  it('upsertConfig ignores a userId key and merges partial updates', () => {
    const repo = createUserRepo(db, userId);
    repo.upsertConfig({
      wallosUrl: 'https://wallos.test',
      userId: otherId,
    } as Parameters<typeof repo.upsertConfig>[0]);
    const row = repo.upsertConfig({ tolerancePercent: 10 });
    expect(row.userId).toBe(userId);
    expect(row.wallosUrl).toBe('https://wallos.test');
    expect(row.tolerancePercent).toBe(10);
    expect(createUserRepo(db, otherId).getConfig()).toBeUndefined();
  });

  it('upsertConfig with an empty input creates a default row', () => {
    const row = createUserRepo(db, userId).upsertConfig({});
    expect(row.tolerancePercent).toBe(5);
  });

  it('updateMatch with an empty patch reports whether the row exists', () => {
    const repo = createUserRepo(db, userId);
    const row = repo.insertMatch({ wallosId: 'w1', actualScheduleId: null, status: 'IGNORED_WALLOS' });
    expect(repo.updateMatch(row.id, {})).toBe(true);
    expect(repo.updateMatch('missing', {})).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import { findSessionByIdHash } from './lookup.js';
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

  it('getEmail returns the stored lowercase email, or undefined for an unknown user', () => {
    expect(createUserRepo(db, userId).getEmail()).toBe('a@example.com');
    expect(createUserRepo(db, 'no-such-user').getEmail()).toBeUndefined();
  });

  describe('sessions', () => {
    const csrfHash = 'c'.repeat(64);
    const t0 = new Date(1_000_000);

    function create(repo: ReturnType<typeof createUserRepo>, ch: string, expiresAt: Date, now = t0) {
      repo.createSession({ idHash: ch.repeat(64), authMethod: 'local', csrfHash, now, expiresAt });
    }

    it('createSession then findSessionByIdHash returns the row', () => {
      const repo = createUserRepo(db, userId);
      const expiresAt = new Date(t0.getTime() + 43_200_000);
      repo.createSession({ idHash: 'a'.repeat(64), authMethod: 'oidc', csrfHash, now: t0, expiresAt });
      expect(findSessionByIdHash(db, 'a'.repeat(64))).toEqual({
        id: 'a'.repeat(64),
        userId,
        authMethod: 'oidc',
        csrfHash,
        createdAt: t0,
        lastSeenAt: t0,
        expiresAt,
      });
      expect(findSessionByIdHash(db, 'f'.repeat(64))).toBeUndefined();
    });

    it('createSession prunes this user expired rows and leaves another user rows alone', () => {
      const mine = createUserRepo(db, userId);
      const theirs = createUserRepo(db, otherId);
      const later = new Date(t0.getTime() + 10_000);
      create(mine, 'a', new Date(t0.getTime() + 1_000)); // expired by `later`
      create(mine, 'b', new Date(t0.getTime() + 100_000)); // still live
      create(theirs, 'c', new Date(t0.getTime() + 1_000)); // other user, expired
      create(mine, 'd', new Date(later.getTime() + 100_000), later);
      expect(findSessionByIdHash(db, 'a'.repeat(64))).toBeUndefined();
      expect(findSessionByIdHash(db, 'b'.repeat(64))).toBeDefined();
      expect(findSessionByIdHash(db, 'c'.repeat(64))).toBeDefined();
      expect(findSessionByIdHash(db, 'd'.repeat(64))).toBeDefined();
    });

    it('createSession prunes a session that expires exactly now', () => {
      const mine = createUserRepo(db, userId);
      create(mine, 'a', t0);
      create(mine, 'b', new Date(t0.getTime() + 100_000));
      expect(findSessionByIdHash(db, 'a'.repeat(64))).toBeUndefined();
    });

    it('createSession with a duplicate id throws and keeps the existing row', () => {
      const mine = createUserRepo(db, userId);
      create(mine, 'a', new Date(t0.getTime() + 100_000));
      expect(() => { create(createUserRepo(db, otherId), 'a', new Date(t0.getTime() + 100_000)); }).toThrow(/UNIQUE|PRIMARY/);
      expect(findSessionByIdHash(db, 'a'.repeat(64))?.userId).toBe(userId);
    });

    it('touchSession sets last_seen_at and deleteSession removes the row', () => {
      const repo = createUserRepo(db, userId);
      create(repo, 'a', new Date(t0.getTime() + 100_000));
      const seen = new Date(t0.getTime() + 5_000);
      expect(repo.touchSession('a'.repeat(64), seen)).toBe(true);
      expect(findSessionByIdHash(db, 'a'.repeat(64))?.lastSeenAt).toEqual(seen);
      expect(repo.touchSession('f'.repeat(64), seen)).toBe(false);
      expect(repo.deleteSession('a'.repeat(64))).toBe(true);
      expect(repo.deleteSession('a'.repeat(64))).toBe(false);
    });
  });

  describe('email verification', () => {
    const t0 = new Date(1_000_000);
    const live = new Date(t0.getTime() + 86_400_000);
    const tok = (c: string) => c.repeat(64);
    const verifiedAt = (id: string) =>
      (db.$client.prepare('SELECT email_verified_at AS v FROM users WHERE id = ?').get(id) as {
        v: number | null;
      }).v;
    const tokenCount = (id: string) =>
      (db.$client
        .prepare('SELECT count(*) AS n FROM email_verifications WHERE user_id = ?')
        .get(id) as { n: number }).n;

    it('consume is single-use and marks the user verified', () => {
      const repo = createUserRepo(db, userId);
      repo.createEmailVerification({ idHash: tok('a'), now: t0, expiresAt: live });
      expect(repo.consumeEmailVerification(tok('a'), t0)).toBe(true);
      expect(verifiedAt(userId)).toBe(t0.getTime());
      expect(repo.consumeEmailVerification(tok('a'), t0)).toBe(false);
      expect(tokenCount(userId)).toBe(0);
    });

    it('rejects an expired token and leaves the user unverified', () => {
      const repo = createUserRepo(db, userId);
      repo.createEmailVerification({ idHash: tok('a'), now: t0, expiresAt: live });
      expect(repo.consumeEmailVerification(tok('a'), live)).toBe(false);
      expect(verifiedAt(userId)).toBeNull();
      expect(tokenCount(userId)).toBe(1);
    });

    it('rejects a token that belongs to another user', () => {
      createUserRepo(db, userId).createEmailVerification({ idHash: tok('a'), now: t0, expiresAt: live });
      expect(createUserRepo(db, otherId).consumeEmailVerification(tok('a'), t0)).toBe(false);
      expect(verifiedAt(otherId)).toBeNull();
      expect(tokenCount(userId)).toBe(1);
    });

    it('createEmailVerification prunes only this user expired tokens', () => {
      const mine = createUserRepo(db, userId);
      const theirs = createUserRepo(db, otherId);
      mine.createEmailVerification({ idHash: tok('a'), now: t0, expiresAt: new Date(t0.getTime() + 1_000) });
      theirs.createEmailVerification({ idHash: tok('b'), now: t0, expiresAt: new Date(t0.getTime() + 1_000) });
      const later = new Date(t0.getTime() + 5_000);
      mine.createEmailVerification({ idHash: tok('c'), now: later, expiresAt: live });
      expect(tokenCount(userId)).toBe(1);
      expect(tokenCount(otherId)).toBe(1);
    });

    it('consume applies the pending hash of the token used, only while the user is unverified', () => {
      const repo = createUserRepo(db, userId);
      const hashOf = () =>
        (db.$client.prepare('SELECT password_hash AS h FROM users WHERE id = ?').get(userId) as { h: string | null }).h;
      repo.createEmailVerification({ idHash: tok('a'), now: t0, expiresAt: live, pendingPasswordHash: 'hash-first' });
      repo.createEmailVerification({ idHash: tok('b'), now: t0, expiresAt: live, pendingPasswordHash: 'hash-second' });
      expect(repo.consumeEmailVerification(tok('b'), t0)).toBe(true);
      expect(hashOf()).toBe('hash-second');
      expect(repo.consumeEmailVerification(tok('a'), t0)).toBe(true);
      expect(hashOf()).toBe('hash-second');
    });

    it('markEmailVerified clears the hash on request and is a no-op for an already verified user', () => {
      const repo = createUserRepo(db, userId);
      expect(repo.markEmailVerified(t0, { clearPasswordHash: true })).toBe(true);
      expect(
        (db.$client.prepare('SELECT password_hash AS h FROM users WHERE id = ?').get(userId) as { h: string | null }).h,
      ).toBeNull();
      expect(repo.markEmailVerified(new Date(t0.getTime() + 1), { clearPasswordHash: true })).toBe(false);
      expect(verifiedAt(userId)).toBe(t0.getTime());
    });
  });

  describe('linkIdentity', () => {
    it('links once, then returns false for a duplicate (issuer, subject)', () => {
      expect(createUserRepo(db, userId).linkIdentity('https://idp', 's1')).toBe(true);
      expect(createUserRepo(db, otherId).linkIdentity('https://idp', 's1')).toBe(false);
    });

    it('returns false when the user already has an identity at that issuer', () => {
      const repo = createUserRepo(db, userId);
      expect(repo.linkIdentity('https://idp', 's1')).toBe(true);
      expect(repo.linkIdentity('https://idp', 's2')).toBe(false);
      expect(repo.linkIdentity('https://other', 's2')).toBe(true);
    });
  });
});

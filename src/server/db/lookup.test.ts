import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import {
  findLinkCandidate,
  findLoginByEmail,
  findSessionByIdHash,
  findUserIdByIdentity,
} from './lookup.js';
import { createUserRepo } from './repo.js';

describe('lookup', () => {
  let db: AppDatabase;
  let aliceId: string;
  let bobId: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    aliceId = createUser(db, { email: 'alice@example.com', passwordHash: 'hash-a' }).id;
    bobId = createUser(db, { email: 'bob@example.com', passwordHash: null }).id;
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe('findLoginByEmail', () => {
    it('trims and lowercases the input', () => {
      expect(findLoginByEmail(db, '  Alice@Example.COM \n')).toEqual({
        userId: aliceId,
        passwordHash: 'hash-a',
      });
    });

    it('returns a null password hash for an OIDC-created user', () => {
      expect(findLoginByEmail(db, 'bob@example.com')).toEqual({ userId: bobId, passwordHash: null });
    });

    it('returns undefined for an unknown email', () => {
      expect(findLoginByEmail(db, 'nobody@example.com')).toBeUndefined();
    });
  });

  describe('findSessionByIdHash', () => {
    it('finds a session by its id hash only', () => {
      const idHash = 'a'.repeat(64);
      const now = new Date(1_000);
      createUserRepo(db, aliceId).createSession({
        idHash,
        authMethod: 'local',
        csrfHash: 'c'.repeat(64),
        now,
        expiresAt: new Date(5_000),
      });
      expect(findSessionByIdHash(db, idHash)?.userId).toBe(aliceId);
      expect(findSessionByIdHash(db, 'b'.repeat(64))).toBeUndefined();
      expect(findSessionByIdHash(db, '')).toBeUndefined();
    });
  });

  describe('findUserIdByIdentity', () => {
    it('maps (issuer, subject) to the user and nothing else', () => {
      createUserRepo(db, aliceId).linkIdentity('https://idp', 's1');
      expect(findUserIdByIdentity(db, 'https://idp', 's1')).toBe(aliceId);
      expect(findUserIdByIdentity(db, 'https://idp', 's2')).toBeUndefined();
      expect(findUserIdByIdentity(db, 'https://other', 's1')).toBeUndefined();
    });
  });

  describe('findLinkCandidate', () => {
    it('finds Alice case-insensitively until she has an identity at the issuer', () => {
      expect(findLinkCandidate(db, 'Alice@Example.com', 'https://idp')).toBe(aliceId);
      expect(findLinkCandidate(db, ' alice@example.com ', 'https://idp')).toBe(aliceId);
      createUserRepo(db, aliceId).linkIdentity('https://idp', 's1');
      expect(findLinkCandidate(db, 'Alice@Example.com', 'https://idp')).toBeUndefined();
    });

    it('still finds her at a different issuer', () => {
      createUserRepo(db, aliceId).linkIdentity('https://idp', 's1');
      expect(findLinkCandidate(db, 'alice@example.com', 'https://other')).toBe(aliceId);
    });

    it('is not affected by another user having an identity at the issuer', () => {
      createUserRepo(db, bobId).linkIdentity('https://idp', 's2');
      expect(findLinkCandidate(db, 'alice@example.com', 'https://idp')).toBe(aliceId);
    });

    it('returns undefined for an unknown email', () => {
      expect(findLinkCandidate(db, 'nobody@example.com', 'https://idp')).toBeUndefined();
    });
  });

  it('never writes', () => {
    const before = db.$client.prepare('select total_changes() as n').get() as { n: number };
    findLoginByEmail(db, 'alice@example.com');
    findSessionByIdHash(db, 'a'.repeat(64));
    findUserIdByIdentity(db, 'https://idp', 's1');
    findLinkCandidate(db, 'alice@example.com', 'https://idp');
    const after = db.$client.prepare('select total_changes() as n').get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});

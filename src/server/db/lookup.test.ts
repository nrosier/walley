import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import {
  findEmailVerification,
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
        emailVerified: false,
      });
    });

    it('returns a null password hash for an OIDC-created user', () => {
      expect(findLoginByEmail(db, 'bob@example.com')).toEqual({
        userId: bobId,
        passwordHash: null,
        emailVerified: false,
      });
    });

    it('reports emailVerified true once the email is verified', () => {
      createUserRepo(db, aliceId).markEmailVerified(new Date());
      expect(findLoginByEmail(db, 'alice@example.com')?.emailVerified).toBe(true);
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
      expect(findLinkCandidate(db, 'Alice@Example.com', 'https://idp')).toEqual({
        id: aliceId,
        emailVerified: false,
      });
      expect(findLinkCandidate(db, ' alice@example.com ', 'https://idp')?.id).toBe(aliceId);
      createUserRepo(db, aliceId).linkIdentity('https://idp', 's1');
      expect(findLinkCandidate(db, 'Alice@Example.com', 'https://idp')).toBeUndefined();
    });

    it('still finds her at a different issuer', () => {
      createUserRepo(db, aliceId).linkIdentity('https://idp', 's1');
      expect(findLinkCandidate(db, 'alice@example.com', 'https://other')?.id).toBe(aliceId);
    });

    it('is not affected by another user having an identity at the issuer', () => {
      createUserRepo(db, bobId).linkIdentity('https://idp', 's2');
      expect(findLinkCandidate(db, 'alice@example.com', 'https://idp')?.id).toBe(aliceId);
    });

    it('exposes the verified state', () => {
      createUserRepo(db, aliceId).markEmailVerified(new Date());
      expect(findLinkCandidate(db, 'alice@example.com', 'https://idp')?.emailVerified).toBe(true);
    });

    it('returns undefined for an unknown email', () => {
      expect(findLinkCandidate(db, 'nobody@example.com', 'https://idp')).toBeUndefined();
    });
  });

  describe('findEmailVerification', () => {
    it('returns the owner of a live token only', () => {
      const now = new Date(10_000);
      createUserRepo(db, aliceId).createEmailVerification({
        idHash: 'e'.repeat(64),
        now,
        expiresAt: new Date(20_000),
        pendingPasswordHash: 'h',
      });
      expect(findEmailVerification(db, 'e'.repeat(64), now)?.userId).toBe(aliceId);
      expect(findEmailVerification(db, 'e'.repeat(64), new Date(20_000))).toBeUndefined();
      expect(findEmailVerification(db, 'f'.repeat(64), now)).toBeUndefined();
    });
  });

  it('never writes', () => {
    const before = db.$client.prepare('select total_changes() as n').get() as { n: number };
    findLoginByEmail(db, 'alice@example.com');
    findSessionByIdHash(db, 'a'.repeat(64));
    findUserIdByIdentity(db, 'https://idp', 's1');
    findLinkCandidate(db, 'alice@example.com', 'https://idp');
    findEmailVerification(db, 'e'.repeat(64), new Date());
    const after = db.$client.prepare('select total_changes() as n').get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});

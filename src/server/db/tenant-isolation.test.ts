import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CurrencyConversionError } from '../../lib/currency-convert.js';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import { findSessionByIdHash } from './lookup.js';
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

  it('A findMatchByItem of B wallos or actual id is undefined', () => {
    const theirs = b.insertMatch({ wallosId: 'w1', actualScheduleId: 'a1', status: 'LINKED' });
    expect(a.findMatchByItem('wallos', 'w1')).toBeUndefined();
    expect(a.findMatchByItem('actual', 'a1')).toBeUndefined();
    expect(b.findMatchByItem('wallos', 'w1')).toEqual(theirs);
    expect(b.findMatchByItem('actual', 'a1')).toEqual(theirs);
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

  describe('email verification', () => {
    const now = new Date(1_000_000);
    const expiresAt = new Date(now.getTime() + 86_400_000);
    const count = (id: string) =>
      (db.$client
        .prepare('SELECT count(*) AS n FROM email_verifications WHERE user_id = ?')
        .get(id) as { n: number }).n;

    it('A cannot consume B tokens, or verify B', () => {
      b.createEmailVerification({ idHash: 'd'.repeat(64), now, expiresAt });
      expect(a.consumeEmailVerification('d'.repeat(64), now)).toBe(false);
      expect(count(b.userId)).toBe(1);
      expect(a.markEmailVerified(now)).toBe(true);
      const bRow = db.$client
        .prepare('SELECT email_verified_at AS v FROM users WHERE id = ?')
        .get(b.userId) as { v: number | null };
      expect(bRow.v).toBeNull();
    });
  });

  describe('subscription overrides', () => {
    const now = new Date(1_000_000);
    const later = new Date(2_000_000);

    it('A cannot read B override for the same Wallos subscription id', () => {
      b.upsertSubscriptionOverride('w1', { rate: '1.0850', now });
      expect(a.getSubscriptionOverride('w1')).toBeUndefined();
      expect(a.listSubscriptionOverrides()).toEqual([]);
      expect(b.getSubscriptionOverride('w1')?.rate).toBe('1.0850');
    });

    it('A and B can each hold an override for the same Wallos subscription id', () => {
      a.upsertSubscriptionOverride('w1', { rate: '1.1000', now });
      b.upsertSubscriptionOverride('w1', { rate: '2.2000', now });
      expect(a.getSubscriptionOverride('w1')?.rate).toBe('1.1000');
      expect(b.getSubscriptionOverride('w1')?.rate).toBe('2.2000');
      expect(a.listSubscriptionOverrides()).toHaveLength(1);
      expect(b.listSubscriptionOverrides()).toHaveLength(1);
    });

    it('A upsert does not change B override', () => {
      const before = b.upsertSubscriptionOverride('w1', { rate: '1.0850', now });
      a.upsertSubscriptionOverride('w1', { rate: '9.0000', now: later });
      expect(b.getSubscriptionOverride('w1')).toEqual(before);
    });

    it('A delete of a B override returns false and leaves it in place', () => {
      b.upsertSubscriptionOverride('w1', { rate: '1.0850', now });
      expect(a.deleteSubscriptionOverride('w1')).toBe(false);
      expect(b.getSubscriptionOverride('w1')?.rate).toBe('1.0850');
      expect(b.deleteSubscriptionOverride('w1')).toBe(true);
      expect(b.getSubscriptionOverride('w1')).toBeUndefined();
    });

    it('upsert replaces the rate for the same user and subscription', () => {
      a.upsertSubscriptionOverride('w1', { rate: '1.0000', now });
      const updated = a.upsertSubscriptionOverride('w1', { rate: '1.2500', now: later });
      expect(updated.rate).toBe('1.2500');
      expect(updated.updatedAt).toEqual(later);
      expect(a.listSubscriptionOverrides()).toHaveLength(1);
    });

    it('rejects an invalid rate and stores nothing', () => {
      expect(() => a.upsertSubscriptionOverride('w1', { rate: '0', now })).toThrow(
        CurrencyConversionError,
      );
      expect(a.getSubscriptionOverride('w1')).toBeUndefined();
    });
  });

  describe('sessions', () => {
    const idHash = 'b'.repeat(64);
    const now = new Date(1_000_000);
    const later = new Date(2_000_000);

    beforeEach(() => {
      b.createSession({
        idHash,
        authMethod: 'local',
        csrfHash: 'c'.repeat(64),
        now,
        expiresAt: new Date(now.getTime() + 3_600_000),
      });
    });

    it('A touchSession of a B session id returns false and leaves the row unchanged', () => {
      const before = findSessionByIdHash(db, idHash);
      expect(a.touchSession(idHash, later)).toBe(false);
      expect(findSessionByIdHash(db, idHash)).toEqual(before);
      expect(b.touchSession(idHash, later)).toBe(true);
      expect(findSessionByIdHash(db, idHash)?.lastSeenAt).toEqual(later);
    });

    it('A deleteSession of a B session id returns false and the row still exists', () => {
      const before = findSessionByIdHash(db, idHash);
      expect(a.deleteSession(idHash)).toBe(false);
      expect(findSessionByIdHash(db, idHash)).toEqual(before);
      expect(b.deleteSession(idHash)).toBe(true);
      expect(findSessionByIdHash(db, idHash)).toBeUndefined();
    });

    it('A linkIdentity does not affect B and the same identity cannot be linked twice', () => {
      expect(a.linkIdentity('https://idp', 's1')).toBe(true);
      expect(b.linkIdentity('https://idp', 's1')).toBe(false);
      expect(b.linkIdentity('https://idp', 's2')).toBe(true);
    });

    it('A getEmail returns only A email', () => {
      expect(a.getEmail()).toBe('a@example.com');
      expect(b.getEmail()).toBe('b@example.com');
    });
  });
});

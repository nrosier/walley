import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import { deleteExpiredPendingRegistrations } from './pending-cleanup.js';
import { createUserRepo } from './repo.js';
import { startPendingCleanup } from '../pending-cleanup-job.js';

const HOUR = 60 * 60 * 1000;
const WINDOW = 24 * HOUR;
const NOW = new Date(10 * WINDOW);

let db: AppDatabase | undefined;

afterEach(() => {
  vi.useRealTimers();
  if (db !== undefined) closeDatabase(db);
  db = undefined;
});

function open(): AppDatabase {
  db = openDatabase(':memory:');
  return db;
}

/** Inserts a user with an explicit creation time. */
function user(d: AppDatabase, email: string, ageMs: number, verified = false): string {
  const created = createUser(d, { email, passwordHash: null, verifiedAt: verified ? new Date(1000) : null });
  d.$client.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(NOW.getTime() - ageMs, created.id);
  return created.id;
}

function token(d: AppDatabase, userId: string, c: string, expiresAt: Date): void {
  createUserRepo(d, userId).createEmailVerification({
    idHash: c.repeat(64),
    now: new Date(NOW.getTime() - WINDOW),
    expiresAt,
    pendingPasswordHash: 'h',
  });
}

const emails = (d: AppDatabase) =>
  (d.$client.prepare('SELECT email FROM users ORDER BY email').all() as { email: string }[]).map((r) => r.email);
const tokenCount = (d: AppDatabase) =>
  (d.$client.prepare('SELECT count(*) AS n FROM email_verifications').get() as { n: number }).n;

describe('deleteExpiredPendingRegistrations', () => {
  it('removes an expired token and the old unverified user it leaves without a token', () => {
    const d = open();
    const stale = user(d, 'stale@example.test', 2 * WINDOW);
    token(d, stale, 'a', new Date(NOW.getTime() - 1));
    const result = deleteExpiredPendingRegistrations(d, NOW, WINDOW);
    expect(result).toEqual({ expiredTokens: 1, unverifiedUsers: 1 });
    expect(tokenCount(d)).toBe(0);
    expect(emails(d)).toEqual([]);
  });

  it('removes a token that expires exactly now', () => {
    const d = open();
    const stale = user(d, 'stale@example.test', 2 * WINDOW);
    token(d, stale, 'a', NOW);
    expect(deleteExpiredPendingRegistrations(d, NOW, WINDOW).expiredTokens).toBe(1);
  });

  it('keeps a live token and its unverified user, even when the user is old', () => {
    const d = open();
    const pending = user(d, 'pending@example.test', 3 * WINDOW);
    token(d, pending, 'a', new Date(NOW.getTime() + HOUR));
    const result = deleteExpiredPendingRegistrations(d, NOW, WINDOW);
    expect(result).toEqual({ expiredTokens: 0, unverifiedUsers: 0 });
    expect(tokenCount(d)).toBe(1);
    expect(emails(d)).toEqual(['pending@example.test']);
  });

  it('keeps an unverified user younger than the window, with or without a token', () => {
    const d = open();
    user(d, 'fresh@example.test', HOUR);
    const withExpired = user(d, 'fresh2@example.test', HOUR);
    token(d, withExpired, 'a', new Date(NOW.getTime() - 1));
    const result = deleteExpiredPendingRegistrations(d, NOW, WINDOW);
    expect(result).toEqual({ expiredTokens: 1, unverifiedUsers: 0 });
    expect(emails(d)).toEqual(['fresh2@example.test', 'fresh@example.test']);
  });

  it('never removes a verified user, whatever its age and tokens', () => {
    const d = open();
    const verified = user(d, 'ok@example.test', 5 * WINDOW, true);
    token(d, verified, 'a', new Date(NOW.getTime() - 1));
    const result = deleteExpiredPendingRegistrations(d, NOW, WINDOW);
    expect(result).toEqual({ expiredTokens: 1, unverifiedUsers: 0 });
    expect(emails(d)).toEqual(['ok@example.test']);
  });

  it('never removes an unverified user that has a linked identity', () => {
    const d = open();
    const id = user(d, 'linked@example.test', 5 * WINDOW);
    expect(createUserRepo(d, id).linkIdentity('https://idp.example.test', 'sub-1')).toBe(true);
    expect(deleteExpiredPendingRegistrations(d, NOW, WINDOW).unverifiedUsers).toBe(0);
    expect(emails(d)).toEqual(['linked@example.test']);
  });

  it('removes only the stale registrations in a mixed set', () => {
    const d = open();
    const stale = user(d, 'a-stale@example.test', 2 * WINDOW);
    token(d, stale, 'a', new Date(NOW.getTime() - HOUR));
    const pending = user(d, 'b-pending@example.test', 2 * WINDOW);
    token(d, pending, 'b', new Date(NOW.getTime() + HOUR));
    user(d, 'c-verified@example.test', 2 * WINDOW, true);
    const result = deleteExpiredPendingRegistrations(d, NOW, WINDOW);
    expect(result).toEqual({ expiredTokens: 1, unverifiedUsers: 1 });
    expect(emails(d)).toEqual(['b-pending@example.test', 'c-verified@example.test']);
    expect(tokenCount(d)).toBe(1);
  });
});

describe('startPendingCleanup', () => {
  it('runs once at start and then on the interval, and stops when told', () => {
    vi.useFakeTimers();
    const d = open();
    let clock = NOW.getTime();
    const stale = user(d, 'stale@example.test', 2 * WINDOW);
    token(d, stale, 'a', new Date(NOW.getTime() - 1));
    const stop = startPendingCleanup(d, { now: () => clock, intervalMs: HOUR });
    expect(emails(d)).toEqual([]);

    const later = user(d, 'later@example.test', 2 * WINDOW);
    token(d, later, 'b', new Date(NOW.getTime() - 1));
    clock += HOUR;
    vi.advanceTimersByTime(HOUR);
    expect(emails(d)).toEqual([]);

    stop();
    const last = user(d, 'last@example.test', 2 * WINDOW);
    token(d, last, 'c', new Date(NOW.getTime() - 1));
    vi.advanceTimersByTime(3 * HOUR);
    expect(emails(d)).toEqual(['last@example.test']);
  });

  it('survives a failing run and reports it with fixed text', () => {
    vi.useFakeTimers();
    const d = open();
    closeDatabase(d);
    const onError = vi.fn();
    const stop = startPendingCleanup(d, { intervalMs: HOUR, onError });
    expect(onError).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HOUR);
    expect(onError).toHaveBeenCalledTimes(2);
    stop();
    db = undefined;
  });
});

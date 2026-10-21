import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { AuthMethod, AuthMode } from '../../lib/auth-mode.js';
import type { AppDatabase } from '../db/client.js';
import { findSessionByIdHash } from '../db/lookup.js';
import { createUserRepo } from '../db/repo.js';

export const SESSION_COOKIE = 'walley_session';
export const CSRF_COOKIE = 'walley_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Absolute lifetime of a session: 12 hours from creation. */
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
/** A session idle for this long is expired: 30 minutes. */
const IDLE_MS = 30 * 60 * 1000;
/** last_seen_at is written at most this often: once a minute. */
const TOUCH_MS = 60 * 1000;
/** Cookie Max-Age in seconds. Derived from the constant, never from Date.now(). */
const COOKIE_MAX_AGE_S = ABSOLUTE_MS / 1000;

export interface IssuedSession {
  /** The raw session token. It goes into the cookie and nowhere else. */
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface SessionContext {
  idHash: string;
  userId: string;
  authMethod: AuthMethod;
  csrfHash: string;
}

/** Lowercase hex SHA-256 of the UTF-8 token string. This is the stored session id. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Creates a session for the user and returns the raw tokens. Only their hashes are stored. */
export function createSession(
  db: AppDatabase,
  userId: string,
  method: AuthMethod,
  now: number,
): IssuedSession {
  const token = newToken();
  const csrfToken = newToken();
  const expiresAt = new Date(now + ABSOLUTE_MS);
  createUserRepo(db, userId).createSession({
    idHash: hashToken(token),
    authMethod: method,
    csrfHash: hashToken(csrfToken),
    now: new Date(now),
    expiresAt,
  });
  return { token, csrfToken, expiresAt };
}

/**
 * Resolves a session cookie value to a session, or null. An expired, idle or wrong-method
 * session is deleted. A live session has last_seen_at refreshed at most once a minute.
 */
export function findSession(
  db: AppDatabase,
  token: string | undefined,
  mode: AuthMode,
  now: number,
): SessionContext | null {
  if (token === undefined) {
    return null;
  }
  const idHash = hashToken(token);
  const row = findSessionByIdHash(db, idHash);
  if (row === undefined) {
    return null;
  }
  const repo = createUserRepo(db, row.userId);
  const idleFor = now - row.lastSeenAt.getTime();
  if (row.expiresAt.getTime() <= now || idleFor >= IDLE_MS || row.authMethod !== mode) {
    repo.deleteSession(idHash);
    return null;
  }
  if (idleFor >= TOUCH_MS) {
    repo.touchSession(idHash, new Date(now));
  }
  return {
    idHash,
    userId: row.userId,
    authMethod: row.authMethod,
    csrfHash: row.csrfHash,
  };
}

export function deleteSession(db: AppDatabase, s: SessionContext): void {
  createUserRepo(db, s.userId).deleteSession(s.idHash);
}

/** Sets the session cookie (HttpOnly) and the CSRF cookie (readable by the page). */
export function setSessionCookies(
  reply: FastifyReply,
  session: IssuedSession,
  secure: boolean,
): void {
  void reply.setCookie(SESSION_COOKIE, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: COOKIE_MAX_AGE_S,
  });
  void reply.setCookie(CSRF_COOKIE, session.csrfToken, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge: COOKIE_MAX_AGE_S,
  });
}

/** Expires both cookies with the same Path, SameSite and Secure they were set with. */
export function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  void reply.setCookie(SESSION_COOKIE, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: 0,
  });
  void reply.setCookie(CSRF_COOKIE, '', {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure,
    maxAge: 0,
  });
}

import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import type { AuthMethod, AuthMode } from '../../lib/auth-mode.js';
import { buildApp } from '../app.js';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, createSession } from '../auth/sessions.js';
import { createUser } from '../db/accounts.js';
import { openDatabase, type AppDatabase } from '../db/client.js';

/** A clock tests can move. `now()` is passed to the app as `auth.now`. */
export interface TestClock {
  now(): number;
  set(ms: number): void;
  advance(ms: number): void;
}

export interface AuthApp {
  app: FastifyInstance;
  db: AppDatabase;
  clock: TestClock;
  publicOrigin: string;
}

export interface SignedIn {
  userId: string;
  token: string;
  cookie: string;
  csrfToken: string;
}

export function makeClock(start = Date.UTC(2030, 0, 1)): TestClock {
  let current = start;
  return {
    now: () => current,
    set: (ms) => {
      current = ms;
    },
    advance: (ms) => {
      current += ms;
    },
  };
}

/** Opens an in-memory database and builds the app with cookie sessions and an injectable clock. */
export function makeAuthApp(
  opts: {
    mode?: AuthMode;
    secureCookies?: boolean;
    allowRegistration?: boolean;
    clock?: TestClock;
  } = {},
): AuthApp {
  const db = openDatabase(':memory:');
  const clock = opts.clock ?? makeClock();
  const publicOrigin = 'http://localhost:3000';
  const app = buildApp({
    db,
    auth: {
      mode: opts.mode ?? 'local',
      secureCookies: opts.secureCookies ?? false,
      allowRegistration: opts.allowRegistration ?? false,
      publicOrigin,
      now: () => clock.now(),
    },
  });
  return { app, db, clock, publicOrigin };
}

let counter = 0;

/** Creates a user with a unique email and no password. Returns the user id. */
export function makeUser(db: AppDatabase, email?: string): string {
  counter += 1;
  return createUser(db, { email: email ?? `user${String(counter)}@example.test`, passwordHash: null })
    .id;
}

/** Creates a session for the user at the clock's current time. */
export function signIn(
  { db, clock }: Pick<AuthApp, 'db' | 'clock'>,
  userId: string,
  method: AuthMethod = 'local',
): SignedIn {
  const issued = createSession(db, userId, method, clock.now());
  return {
    userId,
    token: issued.token,
    csrfToken: issued.csrfToken,
    cookie: `${SESSION_COOKIE}=${issued.token}; ${CSRF_COOKIE}=${issued.csrfToken}`,
  };
}

export const TEST_ORIGIN = 'http://localhost:3000';

/** Injects with the session cookie, X-CSRF-Token and Origin. Caller headers override them. */
export function injectAs(
  app: FastifyInstance,
  session: Pick<SignedIn, 'cookie' | 'csrfToken'>,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.inject({
    ...options,
    headers: {
      origin: TEST_ORIGIN,
      cookie: session.cookie,
      [CSRF_HEADER]: session.csrfToken,
      ...options.headers,
    },
  });
}

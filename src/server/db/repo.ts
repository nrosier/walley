/**
 * The tenant-isolation boundary for user data.
 *
 * `createUserRepo` binds one user id. Every select, update and delete below carries
 * `eq(table.userId, userId)` inside `and(...)`, and every insert writes the bound id,
 * never an id from the caller. Row values are built from named fields only, so a stray
 * `userId` or `id` key in an input is ignored. The ESLint boundary keeps drizzle out of
 * the rest of src/server, so this factory is the only way to reach user-owned rows.
 * The single unscoped write is `createUser` in accounts.ts. The only unscoped reads are the
 * four pre-sign-in lookups in lookup.ts.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, lte } from 'drizzle-orm';
import type { AuthMethod } from '../../lib/auth-mode.js';
import type { MatchStatus } from '../../lib/match-status.js';
import type { AppDatabase } from './client.js';
import {
  matches,
  sessions,
  userConfigs,
  userIdentities,
  users,
  type MatchRow,
  type UserConfigRow,
} from './schema.js';

export interface UserConfigInput {
  wallosUrl?: string | null;
  wallosApiKeyEnc?: string | null;
  actualUrl?: string | null;
  actualPasswordEnc?: string | null;
  actualSyncKeyEnc?: string | null;
  actualBudgetId?: string | null;
  tolerancePercent?: number;
}

export interface MatchInput {
  wallosId: string | null;
  actualScheduleId: string | null;
  status: MatchStatus;
  lastKnownWallosHash?: string | null;
  lastKnownActualHash?: string | null;
}

export type MatchPatch = Partial<MatchInput>;

export interface SessionInput {
  /** Hex SHA-256 of the session token. The token itself is never stored. */
  idHash: string;
  authMethod: AuthMethod;
  /** Hex SHA-256 of the CSRF token. */
  csrfHash: string;
  now: Date;
  expiresAt: Date;
}

export interface UserRepo {
  readonly userId: string;
  getKeySalt(): Buffer | undefined;
  getEmail(): string | undefined;
  /** Creates a session for this user and deletes this user's expired sessions. */
  createSession(input: SessionInput): void;
  /** Sets last_seen_at. Returns false when the id is not this user's; that row is not touched. */
  touchSession(idHash: string, now: Date): boolean;
  /** Returns false when the id is not this user's; that row is not touched. */
  deleteSession(idHash: string): boolean;
  /** Links an identity to this user. Returns false on a unique conflict. */
  linkIdentity(issuer: string, subject: string): boolean;
  getConfig(): UserConfigRow | undefined;
  upsertConfig(input: UserConfigInput): UserConfigRow;
  listMatches(): MatchRow[];
  getMatch(id: string): MatchRow | undefined;
  insertMatch(input: MatchInput): MatchRow;
  /** Returns false when the id is not this user's; that row is not touched. */
  updateMatch(id: string, patch: MatchPatch): boolean;
  /** Returns false when the id is not this user's; that row is not touched. */
  deleteMatch(id: string): boolean;
}

type ConfigValues = Partial<Omit<UserConfigRow, 'userId'>>;
type MatchValues = Partial<Omit<MatchRow, 'id' | 'userId'>>;

/** Copies only the named config fields that the caller actually provided. */
function pickConfigValues(input: UserConfigInput): ConfigValues {
  const values: ConfigValues = {};
  if (input.wallosUrl !== undefined) values.wallosUrl = input.wallosUrl;
  if (input.wallosApiKeyEnc !== undefined) values.wallosApiKeyEnc = input.wallosApiKeyEnc;
  if (input.actualUrl !== undefined) values.actualUrl = input.actualUrl;
  if (input.actualPasswordEnc !== undefined) values.actualPasswordEnc = input.actualPasswordEnc;
  if (input.actualSyncKeyEnc !== undefined) values.actualSyncKeyEnc = input.actualSyncKeyEnc;
  if (input.actualBudgetId !== undefined) values.actualBudgetId = input.actualBudgetId;
  if (input.tolerancePercent !== undefined) values.tolerancePercent = input.tolerancePercent;
  return values;
}

/** Copies only the named match fields that the caller actually provided. */
function pickMatchValues(input: MatchPatch): MatchValues {
  const values: MatchValues = {};
  if (input.wallosId !== undefined) values.wallosId = input.wallosId;
  if (input.actualScheduleId !== undefined) values.actualScheduleId = input.actualScheduleId;
  if (input.status !== undefined) values.status = input.status;
  if (input.lastKnownWallosHash !== undefined) {
    values.lastKnownWallosHash = input.lastKnownWallosHash;
  }
  if (input.lastKnownActualHash !== undefined) {
    values.lastKnownActualHash = input.lastKnownActualHash;
  }
  return values;
}

export function createUserRepo(db: AppDatabase, userId: string): UserRepo {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new TypeError('userId must not be empty');
  }

  const ownMatch = (id: string) => and(eq(matches.id, id), eq(matches.userId, userId));

  const ownSession = (idHash: string) =>
    and(eq(sessions.id, idHash), eq(sessions.userId, userId));

  const getConfig = (): UserConfigRow | undefined =>
    db.select().from(userConfigs).where(eq(userConfigs.userId, userId)).get();

  const getMatch = (id: string): MatchRow | undefined =>
    db.select().from(matches).where(ownMatch(id)).get();

  return {
    userId,

    getKeySalt() {
      const row = db
        .select({ keySalt: users.keySalt })
        .from(users)
        .where(eq(users.id, userId))
        .get();
      return row?.keySalt;
    },

    getEmail() {
      const row = db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, userId))
        .get();
      return row?.email;
    },

    createSession(input) {
      db.transaction((tx) => {
        tx.delete(sessions)
          .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, input.now)))
          .run();
        tx.insert(sessions)
          .values({
            id: input.idHash,
            userId,
            authMethod: input.authMethod,
            csrfHash: input.csrfHash,
            createdAt: input.now,
            lastSeenAt: input.now,
            expiresAt: input.expiresAt,
          })
          .run();
      });
    },

    touchSession(idHash, now) {
      return (
        db.update(sessions).set({ lastSeenAt: now }).where(ownSession(idHash)).run().changes > 0
      );
    },

    deleteSession(idHash) {
      return db.delete(sessions).where(ownSession(idHash)).run().changes > 0;
    },

    linkIdentity(issuer, subject) {
      return (
        db
          .insert(userIdentities)
          .values({ id: randomUUID(), userId, issuer, subject })
          .onConflictDoNothing()
          .run().changes > 0
      );
    },

    getConfig,

    upsertConfig(input) {
      const values = pickConfigValues(input);
      db.insert(userConfigs)
        .values({ ...values, userId })
        .onConflictDoUpdate({
          target: userConfigs.userId,
          // An empty input must still be a valid update; re-set the bound id to itself.
          set: Object.keys(values).length > 0 ? values : { userId },
        })
        .run();
      const row = getConfig();
      if (row === undefined) {
        throw new Error('user config missing after upsert');
      }
      return row;
    },

    listMatches() {
      return db.select().from(matches).where(eq(matches.userId, userId)).all();
    },

    getMatch,

    insertMatch(input) {
      const id = randomUUID();
      db.insert(matches)
        .values({ ...pickMatchValues(input), status: input.status, id, userId })
        .run();
      const row = getMatch(id);
      if (row === undefined) {
        throw new Error('match missing after insert');
      }
      return row;
    },

    updateMatch(id, patch) {
      const values = pickMatchValues(patch);
      if (Object.keys(values).length === 0) {
        return getMatch(id) !== undefined;
      }
      return db.update(matches).set(values).where(ownMatch(id)).run().changes > 0;
    },

    deleteMatch(id) {
      return db.delete(matches).where(ownMatch(id)).run().changes > 0;
    },
  };
}

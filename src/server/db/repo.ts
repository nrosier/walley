/**
 * The tenant-isolation boundary for user data.
 *
 * `createUserRepo` binds one user id. Every select, update and delete below carries
 * `eq(table.userId, userId)` inside `and(...)`, and every insert writes the bound id,
 * never an id from the caller. Row values are built from named fields only, so a stray
 * `userId` or `id` key in an input is ignored. The ESLint boundary keeps drizzle out of
 * the rest of src/server, so this factory is the only way to reach user-owned rows.
 * The single unscoped write is `createUser` in accounts.ts. The only unscoped reads are the
 * five pre-sign-in lookups in lookup.ts, including the one token-keyed read
 * (`findEmailVerification`), whose result is then bound here as the user id.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import type { AuthMethod } from '../../lib/auth-mode.js';
import { parseRate } from '../../lib/currency-convert.js';
import type { MatchStatus } from '../../lib/match-status.js';
import type { AppDatabase } from './client.js';
import {
  emailVerifications,
  matches,
  overwriteSnapshots,
  sessions,
  subscriptionOverrides,
  userConfigs,
  userIdentities,
  users,
  type MatchRow,
  type OverwriteSnapshotRow,
  type SubscriptionOverrideRow,
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
  /** Anchor for a Wallos item with no start_date. Set only on insert or by setFirstSeenNextPayment, never by updateMatch. */
  firstSeenNextPayment?: string | null;
}

export type MatchPatch = Partial<Omit<MatchInput, 'firstSeenNextPayment'>>;

/** The row state a caller last saw. A null id means that side must be absent. */
export interface MatchSideExpectation {
  wallosId: string | null;
  actualScheduleId: string | null;
  status: MatchStatus;
}

/** The side to repoint, its new item id, and the hashes to store with the repointed row. */
export interface MatchSideReplacement {
  side: 'wallos' | 'actual';
  itemId: string;
  lastKnownWallosHash: string | null;
  lastKnownActualHash: string | null;
  /** Used only when `side` is `wallos`: the new item's anchor (null if none). The old item's anchor is never kept. */
  firstSeenNextPayment?: string | null;
}

export interface SubscriptionOverrideInput {
  /** Decimal string on the Wallos scale, for example "1.0850". Must parse as a positive rate. */
  rate: string;
  now: Date;
}

export interface SaveSubscriptionOverrideResult {
  override: SubscriptionOverrideRow;
  changed: boolean;
  /** Ids of the LINKED matches whose Wallos hash was reset. Empty when `changed` is false. */
  resetMatchIds: string[];
}

export interface ClearSubscriptionOverrideResult {
  deleted: boolean;
  resetMatchIds: string[];
}

export interface SessionInput {
  /** Hex SHA-256 of the session token. The token itself is never stored. */
  idHash: string;
  authMethod: AuthMethod;
  /** Hex SHA-256 of the CSRF token. */
  csrfHash: string;
  now: Date;
  expiresAt: Date;
}

export interface EmailVerificationInput {
  /** Hex SHA-256 of the verification token. The token itself is never stored. */
  idHash: string;
  now: Date;
  expiresAt: Date;
  /**
   * Password hash chosen by whoever asked for this token. Applied to the user only when the
   * token is consumed while the user is still unverified. Required: a token without one cannot
   * be consumed.
   */
  pendingPasswordHash: string;
}

export interface OverwriteSnapshotInput {
  matchId: string;
  target: 'wallos' | 'actual';
  targetId: string;
  /** JSON of the record as it was just before the overwrite. Must hold no credentials. */
  valuesJson: string;
  now: Date;
}

export interface UserRepo {
  readonly userId: string;
  getKeySalt(): Buffer | undefined;
  getEmail(): string | undefined;
  /**
   * Voids every earlier verification token of this user and inserts the new one, in one
   * transaction. When this user already has a live (unexpired) token with a pending password
   * hash, the new token keeps that hash and `input.pendingPasswordHash` is discarded; otherwise
   * the new token carries `input.pendingPasswordHash`.
   */
  createEmailVerification(input: EmailVerificationInput): void;
  /**
   * Consumes a verification token owned by this user: deletes it when it matches and has not
   * expired, and sets `email_verified_at` to `now` if unset, in one transaction. If the user is
   * unverified, the token's pending password hash replaces the stored one. Deletes all of this
   * user's verification tokens. Returns false when no live token of this user matches, or when
   * the matching token has no pending password hash (nothing is written then). The token is
   * looked up beforehand by `findEmailVerification` in lookup.ts, the only token-keyed read.
   */
  consumeEmailVerification(idHash: string, now: Date): boolean;
  /**
   * Marks an unverified user verified, in one transaction: sets `email_verified_at` to `now`,
   * nulls the password hash when `clearPasswordHash` is true, and deletes this user's
   * verification tokens. Returns false for a user who is already verified; nothing is written.
   * Used by the OIDC link, where the identity provider has proved the email.
   */
  markEmailVerified(now: Date, opts?: { clearPasswordHash?: boolean }): boolean;
  /** Creates a session for this user and deletes this user's expired sessions. */
  createSession(input: SessionInput): void;
  /** Sets last_seen_at. Returns false when the id is not this user's; that row is not touched. */
  touchSession(idHash: string, now: Date): boolean;
  /** Returns false when the id is not this user's; that row is not touched. */
  deleteSession(idHash: string): boolean;
  /** Deletes this user's sessions except the one with this id. Returns how many were removed. */
  deleteOtherSessions(keepIdHash: string): number;
  /** Returns this user's password hash, or null when none is set (or the user is unknown). Never send it to a client. */
  getPasswordHash(): string | null;
  /** Replaces this user's password hash. Returns false when the user does not exist. */
  setPasswordHash(passwordHash: string): boolean;
  /** Lists this user's linked identities (issuer and subject only), oldest first. */
  listIdentities(): { issuer: string; subject: string }[];
  /** Links an identity to this user. Returns false on a unique conflict. */
  linkIdentity(issuer: string, subject: string): boolean;
  getConfig(): UserConfigRow | undefined;
  upsertConfig(input: UserConfigInput): UserConfigRow;
  listMatches(): MatchRow[];
  /** Returns this user's match whose Wallos id (side `wallos`) or Actual schedule id (side `actual`) is `itemId`, or undefined. */
  findMatchByItem(side: 'wallos' | 'actual', itemId: string): MatchRow | undefined;
  getMatch(id: string): MatchRow | undefined;
  insertMatch(input: MatchInput): MatchRow;
  /**
   * Writes the first-seen next payment anchor of this user's match, only while it is still null.
   * Returns true when written; false when the row is not this user's or already has an anchor.
   */
  setFirstSeenNextPayment(id: string, date: string): boolean;
  /** Returns false when the id is not this user's; that row is not touched. */
  updateMatch(id: string, patch: MatchPatch): boolean;
  /**
   * Compare-and-set repoint of one side of a match, in a single UPDATE. Changes the row only when
   * its id, this user's ownership, both current item ids and its status (LINKED or MISMATCH_DETECTED,
   * equal to `expected.status`) still match, and `next.itemId` is not already on another row of this
   * user. Sets the status to LINKED and both hashes. The match id is unchanged. Returns true only
   * when the row changed; every refusal (stale ids, IGNORED_*, another user's row, clash) returns
   * false and writes nothing.
   */
  replaceMatchSide(
    matchId: string,
    expected: MatchSideExpectation,
    next: MatchSideReplacement,
  ): boolean;
  /** Returns false when the id is not this user's; that row is not touched. */
  deleteMatch(id: string): boolean;
  /** Returns this user's override for a Wallos subscription, or undefined. */
  getSubscriptionOverride(wallosSubscriptionId: string): SubscriptionOverrideRow | undefined;
  listSubscriptionOverrides(): SubscriptionOverrideRow[];
  /**
   * Creates or replaces this user's override for a Wallos subscription. Throws a
   * CurrencyConversionError (code invalid_rate) when `rate` is not a positive decimal string.
   */
  upsertSubscriptionOverride(
    wallosSubscriptionId: string,
    input: SubscriptionOverrideInput,
  ): SubscriptionOverrideRow;
  /**
   * #28: saves the override and, only when the stored rate changed (no previous row, or a different
   * trimmed rate), sets `last_known_wallos_hash = NULL` on this user's LINKED matches for that
   * Wallos id, in one transaction. MISMATCH_DETECTED, IGNORED_* rows and the Actual hash are never
   * touched. Throws CurrencyConversionError (invalid_rate) before writing anything.
   */
  saveSubscriptionOverride(
    wallosSubscriptionId: string,
    input: SubscriptionOverrideInput,
  ): SaveSubscriptionOverrideResult;
  /**
   * #28: removes the override and, when one existed, resets the LINKED Wallos hashes the same way
   * as a changed save, in one transaction. Nothing is touched when no override existed.
   */
  clearSubscriptionOverride(wallosSubscriptionId: string): ClearSubscriptionOverrideResult;
  /** Returns false when this user has no override for that subscription; nothing is removed. */
  deleteSubscriptionOverride(wallosSubscriptionId: string): boolean;
  /** Stores a pre-overwrite copy of a remote record for this user. */
  insertOverwriteSnapshot(input: OverwriteSnapshotInput): OverwriteSnapshotRow;
  /** This user's snapshots, oldest first. */
  listOverwriteSnapshots(): OverwriteSnapshotRow[];
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

  const findMatchByItem = (side: 'wallos' | 'actual', itemId: string): MatchRow | undefined =>
    db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.userId, userId),
          side === 'wallos' ? eq(matches.wallosId, itemId) : eq(matches.actualScheduleId, itemId),
        ),
      )
      .get();

  const ownOverride = (wallosSubscriptionId: string) =>
    and(
      eq(subscriptionOverrides.userId, userId),
      eq(subscriptionOverrides.wallosSubscriptionId, wallosSubscriptionId),
    );

  const getSubscriptionOverride = (wallosSubscriptionId: string): SubscriptionOverrideRow | undefined =>
    db.select().from(subscriptionOverrides).where(ownOverride(wallosSubscriptionId)).get();

  /** Nulls the Wallos hash of this user's LINKED matches for one Wallos id. Runs inside a transaction. */
  const resetLinkedWallosHashes = (tx: Pick<AppDatabase, 'select' | 'update'>, wallosId: string): string[] => {
    const scope = and(
      eq(matches.userId, userId),
      eq(matches.wallosId, wallosId),
      eq(matches.status, 'LINKED'),
    );
    const ids = tx.select({ id: matches.id }).from(matches).where(scope).all().map((r) => r.id);
    if (ids.length > 0) {
      tx.update(matches).set({ lastKnownWallosHash: null }).where(scope).run();
    }
    return ids;
  };

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

    createEmailVerification(input) {
      db.transaction((tx) => {
        // A live (unexpired, unused) token keeps its pending password: a repeat registration
        // re-sends the link but does not replace the first registrant's password (issue 132, M1).
        const live = tx
          .select({ pending: emailVerifications.pendingPasswordHash })
          .from(emailVerifications)
          .where(
            and(
              eq(emailVerifications.userId, userId),
              gt(emailVerifications.expiresAt, input.now),
              isNotNull(emailVerifications.pendingPasswordHash),
            ),
          )
          .orderBy(desc(emailVerifications.createdAt))
          .limit(1)
          .get();
        const pendingPasswordHash = live?.pending ?? input.pendingPasswordHash;
        // A new registration voids every earlier token of this user.
        tx.delete(emailVerifications).where(eq(emailVerifications.userId, userId)).run();
        tx.insert(emailVerifications)
          .values({
            id: input.idHash,
            userId,
            expiresAt: input.expiresAt,
            pendingPasswordHash,
            createdAt: input.now,
          })
          .run();
      });
    },

    consumeEmailVerification(idHash, now) {
      return db.transaction((tx) => {
        const live = and(
          eq(emailVerifications.id, idHash),
          eq(emailVerifications.userId, userId),
          gt(emailVerifications.expiresAt, now),
        );
        const row = tx
          .select({ pending: emailVerifications.pendingPasswordHash })
          .from(emailVerifications)
          .where(live)
          .get();
        if (row?.pending == null) return false;
        tx.delete(emailVerifications).where(eq(emailVerifications.userId, userId)).run();
        // The verifier's own hash wins; a token used after verification changes nothing.
        tx.update(users)
          .set({ emailVerifiedAt: now, passwordHash: row.pending })
          .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
          .run();
        return true;
      });
    },

    markEmailVerified(now, opts) {
      return db.transaction((tx) => {
        const updated = tx
          .update(users)
          .set(
            opts?.clearPasswordHash === true
              ? { emailVerifiedAt: now, passwordHash: null }
              : { emailVerifiedAt: now },
          )
          .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
          .run();
        if (updated.changes === 0) return false;
        tx.delete(emailVerifications).where(eq(emailVerifications.userId, userId)).run();
        return true;
      });
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

    deleteOtherSessions(keepIdHash) {
      return db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), ne(sessions.id, keepIdHash)))
        .run().changes;
    },

    getPasswordHash() {
      const row = db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, userId))
        .get();
      return row?.passwordHash ?? null;
    },

    setPasswordHash(passwordHash) {
      return (
        db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run().changes > 0
      );
    },

    listIdentities() {
      return db
        .select({ issuer: userIdentities.issuer, subject: userIdentities.subject })
        .from(userIdentities)
        .where(eq(userIdentities.userId, userId))
        .orderBy(userIdentities.createdAt, userIdentities.id)
        .all();
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

    findMatchByItem,

    getMatch,

    insertMatch(input) {
      const id = randomUUID();
      db.insert(matches)
        .values({
          ...pickMatchValues(input),
          firstSeenNextPayment: input.firstSeenNextPayment ?? null,
          status: input.status,
          id,
          userId,
        })
        .run();
      const row = getMatch(id);
      if (row === undefined) {
        throw new Error('match missing after insert');
      }
      return row;
    },

    setFirstSeenNextPayment(id, date) {
      return (
        db
          .update(matches)
          .set({ firstSeenNextPayment: date })
          .where(and(ownMatch(id), isNull(matches.firstSeenNextPayment)))
          .run().changes === 1
      );
    },

    updateMatch(id, patch) {
      const values = pickMatchValues(patch);
      if (Object.keys(values).length === 0) {
        return getMatch(id) !== undefined;
      }
      return db.update(matches).set(values).where(ownMatch(id)).run().changes > 0;
    },

    replaceMatchSide(matchId, expected, next) {
      const itemColumn = next.side === 'wallos' ? 'wallos_id' : 'actual_schedule_id';
      const itemValues = next.side === 'wallos' ? { wallosId: next.itemId } : { actualScheduleId: next.itemId };
      // Another row of this user already holds the new item id. The unique index would also refuse it,
      // but this keeps the refusal a false return instead of a thrown error.
      const clash = sql`exists (select 1 from matches as other where other.user_id = ${userId} and other.id <> ${matchId} and other.${sql.raw(itemColumn)} = ${next.itemId})`;
      const result = db
        .update(matches)
        .set({
          ...itemValues,
          status: 'LINKED',
          lastKnownWallosHash: next.lastKnownWallosHash,
          lastKnownActualHash: next.lastKnownActualHash,
          ...(next.side === 'wallos' ? { firstSeenNextPayment: next.firstSeenNextPayment ?? null } : {}),
        })
        .where(
          and(
            ownMatch(matchId),
            expected.wallosId === null
              ? isNull(matches.wallosId)
              : eq(matches.wallosId, expected.wallosId),
            expected.actualScheduleId === null
              ? isNull(matches.actualScheduleId)
              : eq(matches.actualScheduleId, expected.actualScheduleId),
            eq(matches.status, expected.status),
            inArray(matches.status, ['LINKED', 'MISMATCH_DETECTED']),
            sql`not ${clash}`,
          ),
        )
        .run();
      return result.changes === 1;
    },

    deleteMatch(id) {
      return db.delete(matches).where(ownMatch(id)).run().changes > 0;
    },

    getSubscriptionOverride,

    listSubscriptionOverrides() {
      return db
        .select()
        .from(subscriptionOverrides)
        .where(eq(subscriptionOverrides.userId, userId))
        .all();
    },

    upsertSubscriptionOverride(wallosSubscriptionId, input) {
      // Validate before storing so every stored rate parses back as a positive decimal.
      const rate = input.rate.trim();
      parseRate(rate);
      db.insert(subscriptionOverrides)
        .values({ userId, wallosSubscriptionId, rate, updatedAt: input.now })
        .onConflictDoUpdate({
          target: [subscriptionOverrides.userId, subscriptionOverrides.wallosSubscriptionId],
          set: { rate, updatedAt: input.now },
        })
        .run();
      const row = getSubscriptionOverride(wallosSubscriptionId);
      if (row === undefined) {
        throw new Error('subscription override missing after upsert');
      }
      return row;
    },

    saveSubscriptionOverride(wallosSubscriptionId, input) {
      const rate = input.rate.trim();
      parseRate(rate);
      return db.transaction((tx) => {
        const previous = tx
          .select()
          .from(subscriptionOverrides)
          .where(ownOverride(wallosSubscriptionId))
          .get();
        const changed = previous === undefined || previous.rate.trim() !== rate;
        tx.insert(subscriptionOverrides)
          .values({ userId, wallosSubscriptionId, rate, updatedAt: input.now })
          .onConflictDoUpdate({
            target: [subscriptionOverrides.userId, subscriptionOverrides.wallosSubscriptionId],
            set: { rate, updatedAt: input.now },
          })
          .run();
        const override = tx
          .select()
          .from(subscriptionOverrides)
          .where(ownOverride(wallosSubscriptionId))
          .get();
        if (override === undefined) {
          throw new Error('subscription override missing after save');
        }
        const resetMatchIds = changed ? resetLinkedWallosHashes(tx, wallosSubscriptionId) : [];
        return { override, changed, resetMatchIds };
      });
    },

    clearSubscriptionOverride(wallosSubscriptionId) {
      return db.transaction((tx) => {
        const deleted =
          tx.delete(subscriptionOverrides).where(ownOverride(wallosSubscriptionId)).run().changes > 0;
        const resetMatchIds = deleted ? resetLinkedWallosHashes(tx, wallosSubscriptionId) : [];
        return { deleted, resetMatchIds };
      });
    },

    deleteSubscriptionOverride(wallosSubscriptionId) {
      return db.delete(subscriptionOverrides).where(ownOverride(wallosSubscriptionId)).run().changes > 0;
    },

    insertOverwriteSnapshot(input) {
      const id = randomUUID();
      db.insert(overwriteSnapshots)
        .values({
          id,
          userId,
          matchId: input.matchId,
          target: input.target,
          targetId: input.targetId,
          valuesJson: input.valuesJson,
          createdAt: input.now,
        })
        .run();
      const row = db
        .select()
        .from(overwriteSnapshots)
        .where(and(eq(overwriteSnapshots.id, id), eq(overwriteSnapshots.userId, userId)))
        .get();
      if (row === undefined) throw new Error('overwrite snapshot missing after insert');
      return row;
    },

    listOverwriteSnapshots() {
      return db
        .select()
        .from(overwriteSnapshots)
        .where(eq(overwriteSnapshots.userId, userId))
        .orderBy(overwriteSnapshots.createdAt, overwriteSnapshots.id)
        .all();
    },
  };
}

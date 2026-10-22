import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { AUTH_METHODS } from '../../lib/auth-mode.js';
import { MATCH_STATUSES } from '../../lib/match-status.js';

const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash'),
    keySalt: blob('key_salt', { mode: 'buffer' }).notNull(),
    createdAt: createdAt(),
    /** Null until the email is verified. Set by the verification link or by an OIDC link. */
    emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    check('users_email_lowercase_check', sql`${t.email} = lower(${t.email})`),
    check('users_key_salt_length_check', sql`length(${t.keySalt}) = 32`),
  ],
);

export const userIdentities = sqliteTable(
  'user_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('user_identities_issuer_subject_unique').on(t.issuer, t.subject),
    uniqueIndex('user_identities_user_issuer_unique').on(t.userId, t.issuer),
  ],
);

/**
 * `id` is the hex SHA-256 of the session token, never the token itself, so reading
 * the database gives no live session. `csrf_hash` is the SHA-256 of the CSRF token.
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authMethod: text('auth_method', { enum: AUTH_METHODS }).notNull(),
    csrfHash: text('csrf_hash').notNull(),
    createdAt: createdAt(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    check('sessions_id_length_check', sql`length(${t.id}) = 64`),
    check('sessions_auth_method_check', sql`${t.authMethod} IN ('local','oidc')`),
    check('sessions_csrf_hash_length_check', sql`length(${t.csrfHash}) = 64`),
  ],
);

/**
 * Pending local-registration email verifications. `id` is the hex SHA-256 of the
 * verification token, never the token itself. A row is consumed on a successful click
 * and deleted when expired.
 */
export const emailVerifications = sqliteTable(
  'email_verifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('email_verifications_user_id_idx').on(t.userId),
    check('email_verifications_id_length_check', sql`length(${t.id}) = 64`),
  ],
);

export const userConfigs = sqliteTable(
  'user_configs',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    wallosUrl: text('wallos_url'),
    wallosApiKeyEnc: text('wallos_api_key_enc'),
    actualUrl: text('actual_url'),
    actualPasswordEnc: text('actual_password_enc'),
    actualSyncKeyEnc: text('actual_sync_key_enc'),
    actualBudgetId: text('actual_budget_id'),
    tolerancePercent: real('tolerance_percent').notNull().default(5),
  },
  (t) => [
    check(
      'user_configs_tolerance_check',
      sql`${t.tolerancePercent} >= 0 AND ${t.tolerancePercent} <= 100`,
    ),
  ],
);

export const matches = sqliteTable(
  'matches',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    wallosId: text('wallos_id'),
    actualScheduleId: text('actual_schedule_id'),
    status: text('status', { enum: MATCH_STATUSES }).notNull(),
    lastKnownWallosHash: text('last_known_wallos_hash'),
    lastKnownActualHash: text('last_known_actual_hash'),
  },
  (t) => [
    uniqueIndex('matches_user_wallos_unique').on(t.userId, t.wallosId),
    uniqueIndex('matches_user_actual_unique').on(t.userId, t.actualScheduleId),
    check(
      'matches_status_check',
      sql`${t.status} IN ('LINKED','MISMATCH_DETECTED','IGNORED_WALLOS','IGNORED_ACTUAL')`,
    ),
    check(
      'matches_side_check',
      sql`(${t.status} IN ('LINKED','MISMATCH_DETECTED') AND ${t.wallosId} IS NOT NULL AND ${t.actualScheduleId} IS NOT NULL) OR (${t.status} = 'IGNORED_WALLOS' AND ${t.wallosId} IS NOT NULL) OR (${t.status} = 'IGNORED_ACTUAL' AND ${t.actualScheduleId} IS NOT NULL)`,
    ),
  ],
);

/**
 * A manual exchange-rate override for one Wallos subscription. `rate` is text, the decimal
 * string as typed (for example "1.0850"), so no float drift is stored; it is parsed when used.
 * The rate is on the Wallos scale (units per Wallos main currency). Keyed by
 * (user_id, wallos_subscription_id), so an override belongs to one user's subscription only.
 */
export const subscriptionOverrides = sqliteTable(
  'subscription_overrides',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    wallosSubscriptionId: text('wallos_subscription_id').notNull(),
    rate: text('rate').notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('subscription_overrides_user_subscription_unique').on(
      t.userId,
      t.wallosSubscriptionId,
    ),
    index('subscription_overrides_user_id_idx').on(t.userId),
    check('subscription_overrides_rate_check', sql`length(${t.rate}) > 0`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type UserIdentityRow = typeof userIdentities.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type EmailVerificationRow = typeof emailVerifications.$inferSelect;
export type UserConfigRow = typeof userConfigs.$inferSelect;
export type SubscriptionOverrideRow = typeof subscriptionOverrides.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type NewMatchRow = typeof matches.$inferInsert;

import { sql } from 'drizzle-orm';
import {
  blob,
  check,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
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

export type UserRow = typeof users.$inferSelect;
export type UserIdentityRow = typeof userIdentities.$inferSelect;
export type UserConfigRow = typeof userConfigs.$inferSelect;
export type MatchRow = typeof matches.$inferSelect;
export type NewMatchRow = typeof matches.$inferInsert;

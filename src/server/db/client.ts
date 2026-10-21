import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

/** Folder with the committed migrations. Resolves to src under tsx and vitest, and to dist when built. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('./migrations/', import.meta.url));

const IN_MEMORY = ':memory:';

/**
 * Opens the SQLite database at `path`, creating the parent folder and the file when missing,
 * applies the connection pragmas and runs every pending migration.
 */
export function openDatabase(path: string): AppDatabase {
  const inMemory = path === IN_MEMORY;
  if (!inMemory) {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const sqlite = new Database(path);
  try {
    sqlite.pragma('foreign_keys = ON');
    sqlite.pragma('busy_timeout = 5000');
    if (!inMemory) {
      sqlite.pragma('journal_mode = WAL');
    }
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    return db;
  } catch (error: unknown) {
    sqlite.close();
    throw error;
  }
}

export function closeDatabase(db: AppDatabase): void {
  db.$client.close();
}

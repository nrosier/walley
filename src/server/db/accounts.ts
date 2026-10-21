/**
 * The one documented exception to the scoped-repository rule (decision D3).
 *
 * `createUser` is the only unscoped write in the data layer: creating a user creates
 * the scope, so it cannot be bound to an existing user id. Nothing else may be exported
 * from this module. All other user data goes through `createUserRepo`.
 */
import { randomUUID } from 'node:crypto';
import { newKeySalt } from '../crypto/keys.js';
import type { AppDatabase } from './client.js';
import { users } from './schema.js';

export function createUser(
  db: AppDatabase,
  input: { email: string; passwordHash: string | null },
): { id: string; email: string } {
  const id = randomUUID();
  const email = input.email.trim().toLowerCase();
  db.insert(users)
    .values({ id, email, passwordHash: input.passwordHash, keySalt: newKeySalt() })
    .run();
  return { id, email };
}

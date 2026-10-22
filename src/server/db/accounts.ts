/**
 * The one documented exception to the scoped-repository rule (decision D3).
 *
 * `createUser` is the only unscoped write in the data layer: creating a user creates
 * the scope, so it cannot be bound to an existing user id. A user and its identity link
 * are written together in one transaction; the link itself goes through `createUserRepo`.
 * A user created with an identity (OIDC) is written verified, because the identity provider
 * proved the email; a local registration is written unverified unless `verifiedAt` is given.
 * Nothing else may be exported from this module. All other user data goes through
 * `createUserRepo`.
 */
import { randomUUID } from "node:crypto";
import { newKeySalt } from "../crypto/keys.js";
import type { AppDatabase } from "./client.js";
import { users } from "./schema.js";
import { createUserRepo } from "./repo.js";

/** Thrown inside the transaction to roll it back; never leaves this module. */
class RollbackSignal extends Error {}

export function createUser(
  db: AppDatabase,
  input: {
    email: string;
    passwordHash: null;
    identity: { issuer: string; subject: string };
    verifiedAt?: Date | null;
  },
): { id: string; email: string } | null;
export function createUser(
  db: AppDatabase,
  input: { email: string; passwordHash: string | null; verifiedAt?: Date | null },
): { id: string; email: string };
export function createUser(
  db: AppDatabase,
  input: {
    email: string;
    passwordHash: string | null;
    identity?: { issuer: string; subject: string };
    verifiedAt?: Date | null;
  },
): { id: string; email: string } | null {
  const id = randomUUID();
  const email = input.email.trim().toLowerCase();
  const { identity } = input;
  const emailVerifiedAt =
    input.verifiedAt !== undefined ? input.verifiedAt : identity === undefined ? null : new Date();
  if (identity === undefined) {
    db.insert(users)
      .values({
        id,
        email,
        passwordHash: input.passwordHash,
        emailVerifiedAt,
        keySalt: newKeySalt(),
      })
      .run();
    return { id, email };
  }
  try {
    db.transaction(() => {
      const inserted = db
        .insert(users)
        .values({
          id,
          email,
          passwordHash: input.passwordHash,
          emailVerifiedAt,
          keySalt: newKeySalt(),
        })
        .onConflictDoNothing()
        .run();
      if (inserted.changes === 0) throw new RollbackSignal();
      // Same connection, so the link joins the open transaction.
      if (
        !createUserRepo(db, id).linkIdentity(identity.issuer, identity.subject)
      ) {
        throw new RollbackSignal();
      }
    });
  } catch (error: unknown) {
    if (error instanceof RollbackSignal) return null;
    throw error;
  }
  return { id, email };
}

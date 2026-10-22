import { createUser } from "../db/accounts.js";
import type { AppDatabase } from "../db/client.js";
import { findLinkCandidate, findUserIdByIdentity } from "../db/lookup.js";
import { createUserRepo } from "../db/repo.js";

export interface OidcClaims {
  readonly issuer: string;
  readonly subject: string;
  readonly email: string | undefined;
  readonly emailVerified: unknown;
}

export type OidcLoginResult =
  | { kind: "signed_in"; userId: string; via: "known" | "linked" | "created" }
  | { kind: "refused" };

const REFUSED: OidcLoginResult = { kind: "refused" };

/**
 * The email counts only when email_verified is the boolean true and every character is
 * ASCII. Checked before lowercasing: toLowerCase maps U+212A (Kelvin sign) to "k".
 */
function usableEmail(claims: OidcClaims): string | undefined {
  const { email } = claims;
  if (claims.emailVerified !== true || typeof email !== "string")
    return undefined;
  for (let i = 0; i < email.length; i += 1) {
    if (email.charCodeAt(i) > 0x7f) return undefined;
  }
  const normalised = email.trim().toLowerCase();
  return normalised === "" ? undefined : normalised;
}

/** Synchronous: one process never interleaves two resolutions. */
export function resolveOidcLogin(
  db: AppDatabase,
  claims: OidcClaims,
  opts: { readonly allowRegistration: boolean },
): OidcLoginResult {
  const email = usableEmail(claims);

  const known = findUserIdByIdentity(db, claims.issuer, claims.subject);
  if (known !== undefined)
    return { kind: "signed_in", userId: known, via: "known" };

  if (email === undefined) return REFUSED;

  const candidate = findLinkCandidate(db, email, claims.issuer);
  if (candidate !== undefined) {
    if (
      !createUserRepo(db, candidate).linkIdentity(claims.issuer, claims.subject)
    ) {
      return REFUSED;
    }
    return { kind: "signed_in", userId: candidate, via: "linked" };
  }

  if (!opts.allowRegistration) return REFUSED;

  const created = createUser(db, {
    email,
    passwordHash: null,
    identity: { issuer: claims.issuer, subject: claims.subject },
  });
  return created === null
    ? REFUSED
    : { kind: "signed_in", userId: created.id, via: "created" };
}

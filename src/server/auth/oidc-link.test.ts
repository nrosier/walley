import { describe, expect, it, vi } from "vitest";
import { createUser } from "../db/accounts.js";
import { openDatabase } from "../db/client.js";
import * as accountsModule from "../db/accounts.js";
import * as repoModule from "../db/repo.js";
import { createUserRepo } from "../db/repo.js";
import { resolveOidcLogin } from "./oidc-link.js";

const ISS = "https://idp.example.test";

function setup() {
  const db = openDatabase(":memory:");
  const kate = createUser(db, {
    email: "kate@x.com",
    passwordHash: "hash-kate",
  });
  return { db, kate };
}
type Db = ReturnType<typeof openDatabase>;
interface UserRow {
  id: string;
  email: string;
  passwordHash: string | null;
  keySalt: Buffer;
  verifiedAt: number | null;
}
interface IdentityRow {
  userId: string;
  issuer: string;
  subject: string;
}
const userRow = (db: Db, id: string): UserRow | undefined =>
  db.$client
    .prepare(
      "select id, email, password_hash as passwordHash, key_salt as keySalt, email_verified_at as verifiedAt from users where id = ?",
    )
    .get(id) as UserRow | undefined;
const allUsers = (db: Db): UserRow[] =>
  db.$client
    .prepare(
      "select id, email, password_hash as passwordHash, key_salt as keySalt, email_verified_at as verifiedAt from users",
    )
    .all() as UserRow[];
const identities = (db: Db): IdentityRow[] =>
  db.$client
    .prepare("select user_id as userId, issuer, subject from user_identities")
    .all() as IdentityRow[];
const claims = (
  over: Partial<Parameters<typeof resolveOidcLogin>[1]> = {},
) => ({
  issuer: ISS,
  subject: "sub-1",
  email: "kate@x.com" as string | undefined,
  emailVerified: true as unknown,
  ...over,
});

describe("resolveOidcLogin", () => {
  it("a: known identity signs in regardless of registration and verification", () => {
    const { db, kate } = setup();
    expect(
      resolveOidcLogin(db, claims(), { allowRegistration: false }),
    ).toEqual({
      kind: "signed_in",
      userId: kate.id,
      via: "linked",
    });
    expect(
      resolveOidcLogin(db, claims({ emailVerified: false }), {
        allowRegistration: false,
      }),
    ).toEqual({
      kind: "signed_in",
      userId: kate.id,
      via: "known",
    });
    expect(identities(db)).toHaveLength(1);
  });

  it("b: verified email links an existing verified user and leaves the row unchanged", () => {
    const { db, kate } = setup();
    createUserRepo(db, kate.id).markEmailVerified(new Date(5_000));
    const before = userRow(db, kate.id);
    expect(
      resolveOidcLogin(db, claims({ email: " Kate@X.com " }), {
        allowRegistration: false,
      }),
    ).toEqual({
      kind: "signed_in",
      userId: kate.id,
      via: "linked",
    });
    const rows = identities(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: kate.id,
      issuer: ISS,
      subject: "sub-1",
    });
    const after = userRow(db, kate.id);
    expect(after?.passwordHash).toBe("hash-kate");
    expect(after?.verifiedAt).toBe(5_000);
    expect(after?.keySalt.equals(before?.keySalt ?? Buffer.alloc(0))).toBe(
      true,
    );
  });

  it("b2: linking an unverified local account nulls its hash, verifies it and drops its tokens", () => {
    const { db, kate } = setup();
    const repo = createUserRepo(db, kate.id);
    repo.createEmailVerification({
      idHash: "a".repeat(64),
      now: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const before = userRow(db, kate.id);
    expect(before?.verifiedAt).toBeNull();
    expect(
      resolveOidcLogin(db, claims(), { allowRegistration: false }),
    ).toEqual({ kind: "signed_in", userId: kate.id, via: "linked" });
    const after = userRow(db, kate.id);
    expect(after?.passwordHash).toBeNull();
    expect(after?.verifiedAt).toBeGreaterThan(0);
    expect(after?.keySalt.equals(before?.keySalt ?? Buffer.alloc(0))).toBe(true);
    const tokens = db.$client
      .prepare("select count(*) as n from email_verifications")
      .get() as { n: number };
    expect(tokens.n).toBe(0);
  });

  it("b3: a failed link leaves an unverified account untouched", () => {
    const { db, kate } = setup();
    createUserRepo(db, kate.id).linkIdentity(ISS, "other-sub");
    // Kate already has an identity at this issuer, so she is not a candidate: refused.
    expect(
      resolveOidcLogin(db, claims({ subject: "sub-2" }), { allowRegistration: false }),
    ).toEqual({ kind: "refused" });
    expect(userRow(db, kate.id)?.passwordHash).toBe("hash-kate");
    expect(userRow(db, kate.id)?.verifiedAt).toBeNull();
  });

  it.each([false, undefined, "true", 1])(
    "c: email_verified %s is refused",
    (flag) => {
      const { db } = setup();
      expect(
        resolveOidcLogin(db, claims({ emailVerified: flag }), {
          allowRegistration: true,
        }),
      ).toEqual({
        kind: "refused",
      });
      expect(identities(db)).toHaveLength(0);
      expect(allUsers(db)).toHaveLength(1);
    },
  );

  it("d: a user already linked at this issuer is refused", () => {
    const { db, kate } = setup();
    expect(
      resolveOidcLogin(db, claims(), { allowRegistration: true }).kind,
    ).toBe("signed_in");
    expect(
      resolveOidcLogin(db, claims({ subject: "sub-2" }), {
        allowRegistration: true,
      }),
    ).toEqual({
      kind: "refused",
    });
    expect(identities(db).filter((r) => r.subject === "sub-2")).toHaveLength(0);
    expect(allUsers(db)).toHaveLength(1);
    expect(identities(db)[0]?.userId).toBe(kate.id);
  });

  it("e: no match with registration creates a user and an identity", () => {
    const { db } = setup();
    const result = resolveOidcLogin(
      db,
      claims({ email: "new@x.com", subject: "n" }),
      { allowRegistration: true },
    );
    expect(result.kind).toBe("signed_in");
    if (result.kind !== "signed_in") return;
    expect(result.via).toBe("created");
    const row = userRow(db, result.userId);
    expect(row?.passwordHash).toBeNull();
    expect(row?.verifiedAt).toBeGreaterThan(0);
    expect(row?.keySalt).toHaveLength(32);
    expect(row?.email).toBe("new@x.com");
    expect(
      identities(db).filter((r) => r.userId === result.userId),
    ).toHaveLength(1);
  });

  it("f: no match without registration is refused", () => {
    const { db } = setup();
    expect(
      resolveOidcLogin(db, claims({ email: "new@x.com" }), {
        allowRegistration: false,
      }),
    ).toEqual({
      kind: "refused",
    });
    expect(allUsers(db)).toHaveLength(1);
    expect(identities(db)).toHaveLength(0);
  });

  it("refuses a non-ASCII email before any lookup (Kelvin sign)", () => {
    const { db } = setup();
    expect(
      resolveOidcLogin(db, claims({ email: "Kate@x.com" }), {
        allowRegistration: true,
      }),
    ).toEqual({
      kind: "refused",
    });
    expect(
      resolveOidcLogin(db, claims({ email: "KKate@x.com" }), {
        allowRegistration: true,
      }),
    ).toEqual({
      kind: "refused",
    });
    expect(identities(db)).toHaveLength(0);
    expect(allUsers(db)).toHaveLength(1);
  });

  it("refuses when email is missing and the identity is unknown", () => {
    const { db } = setup();
    expect(
      resolveOidcLogin(db, claims({ email: undefined }), {
        allowRegistration: true,
      }).kind,
    ).toBe("refused");
  });

  it("a linkIdentity failure while linking is a refusal with nothing written", () => {
    const { db } = setup();
    const spy = vi.spyOn(repoModule, "createUserRepo").mockReturnValue({
      linkIdentity: () => false,
    } as unknown as repoModule.UserRepo);
    try {
      expect(
        resolveOidcLogin(db, claims(), { allowRegistration: false }).kind,
      ).toBe("refused");
    } finally {
      spy.mockRestore();
    }
    expect(identities(db)).toHaveLength(0);
  });

  it("refuses when createUser returns null, leaving no new user row", () => {
    const { db } = setup();
    // The identity overload returns null; the spy types only the last overload.
    const spy = vi
      .spyOn(accountsModule, "createUser")
      .mockImplementation((() => null) as unknown as typeof createUser);
    try {
      expect(
        resolveOidcLogin(db, claims({ email: "new@x.com", subject: "n" }), {
          allowRegistration: true,
        }),
      ).toEqual({ kind: "refused" });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
    expect(allUsers(db)).toHaveLength(1);
    expect(identities(db)).toHaveLength(0);
  });

  it("two users are isolated at one issuer", () => {
    const { db, kate } = setup();
    const bob = createUser(db, { email: "bob@x.com", passwordHash: null });
    resolveOidcLogin(db, claims(), { allowRegistration: false });
    expect(identities(db)).toHaveLength(1);
    expect(identities(db)[0]?.userId).toBe(kate.id);
    expect(userRow(db, bob.id)?.passwordHash).toBeNull();
    // A second subject for Kate at the same issuer is refused by UNIQUE (user_id, issuer).
    expect(
      resolveOidcLogin(db, claims({ subject: "sub-other" }), {
        allowRegistration: false,
      }).kind,
    ).toBe("refused");
    expect(identities(db)).toHaveLength(1);
    // Bob links separately.
    expect(
      resolveOidcLogin(db, claims({ subject: "bob-sub", email: "bob@x.com" }), {
        allowRegistration: false,
      }),
    ).toEqual({ kind: "signed_in", userId: bob.id, via: "linked" });
  });
});

describe("createUser with identity", () => {
  it("returns null and leaves no user row when the identity link fails", () => {
    const { db, kate } = setup();
    expect(
      resolveOidcLogin(db, claims({ subject: "s1", email: "kate@x.com" }), {
        allowRegistration: false,
      }).kind,
    ).toBe("signed_in");
    // Same (issuer, subject) already linked: the identity insert conflicts.
    const result = createUser(db, {
      email: "fresh@x.com",
      passwordHash: null,
      identity: { issuer: ISS, subject: "s1" },
    });
    expect(result).toBeNull();
    expect(allUsers(db).map((u) => u.id)).toEqual([kate.id]);
  });

  it("returns null on a duplicate email", () => {
    const { db } = setup();
    expect(
      createUser(db, {
        email: "KATE@x.com",
        passwordHash: null,
        identity: { issuer: ISS, subject: "z" },
      }),
    ).toBeNull();
    expect(identities(db)).toHaveLength(0);
  });
});

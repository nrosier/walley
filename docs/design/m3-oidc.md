# Design: OIDC sign-in with user_identities mapping, M3 issue #22 (2026-10-21)

This design assumes the startup config task and #19 (default-deny) have landed. "Unverified" marks a library fact I could not check offline. "Convention" marks a project choice with no external source. I could not fetch the issue, so section 8 uses the nine #22 criteria from the M3 plan's test map. Confirm them with `gh issue view 22`.

## 1. OIDC library

**Recommendation: `openid-client` v6, pinned exactly.** The M3 plan names 6.8.8. Unverified: the package is ESM-only, is built on `oauth4webapi` and `jose`, and has a Node 20 baseline. The repo needs Node 24 or later.

The library makes every protocol check, so Walley writes none. All API names below are unverified.

- `discovery()` checks the metadata `issuer` against `OIDC_ISSUER`. Set `allowInsecureRequests` (through `execute`) only for an `http:` issuer.
- `randomState`, `randomNonce`, `randomPKCECodeVerifier`, `calculatePKCECodeChallenge` and `buildAuthorizationUrl` build the request.
- `authorizationCodeGrant(config, currentUrl, { expectedState, expectedNonce, pkceCodeVerifier, idTokenExpected: true })` checks state, sends the PKCE verifier and client secret, and validates the ID token's `iss`, `aud`, `azp`, `exp`, `iat` and `nonce`.
- Walley calls `enableNonRepudiationChecks(config)` to verify the ID token signature against the JWKS. The library skips that check by default for token-endpoint responses (OIDC Core 3.1.3.7 allows this over TLS), and loopback http issuers have no TLS.

Rejected: `oauth4webapi` alone. It is the same engine one level lower, and it leaves discovery, JWKS caching and the check order to Walley.

## 2. Flow state between login and callback

**Recommendation: an encrypted, short-lived cookie.**

- **Cookie.** `walley_oidc` holds `encryptSecret(JSON.stringify({ v: 1, state, nonce, codeVerifier, exp }), flowKey)`, made with the existing AES-256-GCM helper in `crypto/secrets.ts`.
- **Attributes.** `HttpOnly`, `Path=/api/auth/oidc` and `Max-Age=600` (convention). `Secure` follows `auth.secureCookies`, as the session cookies do. The server also checks `exp`, which is the clock plus 600 000 ms.
- **SameSite=Lax.** The provider sends the browser back with a top-level GET, which carries Lax cookies. A Strict cookie would not be sent.
- **Key.** `deriveFlowKey(appSecret)` is HKDF-SHA256 with APP_SECRET as input key material, an empty salt, the info label **`walley/oidc-flow/v1`** and 32 bytes of output. Per-user keys use `key_salt` and the user id, so the two keys cannot collide. `index.ts` derives the flow key once, so the app never holds APP_SECRET.
- **Lifecycle.** `/login` overwrites any earlier flow cookie, so the newest tab wins. `/callback` clears the cookie on every outcome (`Max-Age=0`, same attributes). A missing, undecryptable, malformed, wrong-`v` or expired cookie gives `oidc_failed` without a provider call.

Rejected: server memory keyed by state. It is lost on restart, needs eviction under unauthenticated load, breaks with two processes, and would still need a cookie to bind the flow to the browser against login CSRF.

## 3. Issuer normalization

**Rule: `user_identities.issuer` is the provider's discovery `issuer`, byte for byte.** It comes from `config.serverMetadata().issuer` (unverified). `OIDC_ISSUER` stays raw and trimmed, and only `discovery()` reads it.

- **Where.** Only the adapter in `auth/oidc.ts` sets `OidcIdentity.issuer`, and only that value reaches `findUserIdByIdentity`, `findLinkCandidate`, `linkIdentity` and `createUser`.
- **`iss`.** The library compares `iss` with the metadata issuer by exact string equality (OIDC Core 3.1.3.7). The adapter then asserts `claims.iss === metadata.issuer` itself: case-sensitive and untrimmed. A mismatch gives `oidc_failed`.
- **Trailing slash.** Discovery compares parsed URLs (unverified), so `https://idp.example.com` stores one string with or without a slash. A path issuer with the wrong slash fails discovery (`oidc_failed`) and adds no row. The README says to copy the issuer from the discovery document.

Rejected: stripping one trailing slash at load. Some issuers end in one (Authentik, unverified), the result would still depend on what the operator typed, and the owner has fixed raw storage.

## 4. Routes

Both routes are registered in both modes with `config: { public: true }` (the deny hook gives unregistered paths a 401) and `exposeHeadRoute: false` (a HEAD prefetch must not spend a code). In local mode both call `reply.callNotFound()` (the standard 404) and read no cookie. In OIDC mode every response sends `Cache-Control: no-store`.

### GET /api/auth/oidc/login

1. Call `provider.start()` and set `walley_oidc`.
2. Respond 302 to the provider with `response_type=code`, `scope=openid email`, `redirect_uri` (the stored callback URL), `state`, `nonce` and an S256 `code_challenge`. PKCE is always sent. Send no `response_mode`: `form_post` would make the callback a cross-site POST, which #20 blocks and which carries no Lax cookie.
3. If `start()` throws, respond 302 to `/login?error=oidc_failed`.

### GET /api/auth/oidc/callback

1. Clear `walley_oidc`, then call `openFlow`. On failure, respond 302 to `/login?error=oidc_failed`.
2. Build `currentUrl` from `callbackUrl` plus the raw query of `request.url`, never from the Host header. The token request's `redirect_uri` then equals the stored callback URL (unverified).
3. Call `await provider.finish(currentUrl, flow)`. Any throw, including a provider `error` response, gives `oidc_failed`.
4. Call `resolveOidcLogin`. `refused` gives a 302 to `/login?error=account_not_linked`, and a throw gives `oidc_failed`.
5. On success:
   - if `request.auth !== null`, call `deleteSession(db, request.auth)`;
   - call `createSession(db, userId, 'oidc', now())` and `setSessionCookies`;
   - respond 302 to `/`.

The handler catches every error itself, so Fastify's error logger never sees provider text. A successful sign-in lands on `/`. There is no `returnTo`, and every Location except the provider URL is fixed.

### Errors, CSRF and rate limits

- **`oidc_failed`** (convention) covers any protocol, provider, cookie or internal failure.
- **`account_not_linked`** (owner) covers every refusal: an unverified or unusable email, an email whose owner is already linked at this issuer, registration turned off, and a `linkIdentity` or `createUser` conflict. All refusals look identical (same Location, flow cookie cleared, no session), so none reveals whether an account exists.
- **CSRF (#20).** #20 checks only POST, PUT, PATCH and DELETE, so neither route needs an Origin header or a token. `setSessionCookies` issues the new `walley_csrf`.
- **Rate limits (#21).** The per-IP limiter is a `preHandler` on both routes, so it runs before decryption or any provider call. Merge gate: #22 must not merge before #21 (rate limiting) has merged. Open item O-D in section 10 decides whether GET /api/auth/oidc/login is rate limited in M3.

## 5. Transactions and races

`resolveOidcLogin` is synchronous (better-sqlite3, no `await`), so one process never interleaves two resolutions. Across processes, the unique indexes decide.

1. **Known identity.** Call `findUserIdByIdentity`. A hit signs in the mapped user whatever the flag is, and ignores `email_verified` (O-A).
2. **Link.** This needs `emailVerified === true` and an email. Call `findLinkCandidate`, then `linkIdentity`. A `false` is a refusal and is not retried: nothing was written, because `linkIdentity` is a single `INSERT … ON CONFLICT DO NOTHING`. The `users` row is never updated.
3. **Create.** Creation runs only when allowRegistration is true, email_verified is the boolean true, and no user has that email. The user row and the identity link are written in one db.transaction, which rolls back if linkIdentity returns false. Call `createUser(db, { email, passwordHash: null, identity })`. The "no user has this email" check is the `users.email` UNIQUE index inside that transaction, so there is no gap between check and insert. A CHECK constraint keeps stored emails lowercase, so the check is case-insensitive.
4. **Otherwise, refuse.** An email collision ends here, or at step 3's unique index.

`createUser` with `identity` runs one `db.transaction`. Without `identity`, it keeps today's plain insert, which throws on a duplicate.

1. Insert the user with `onConflictDoNothing()`. If nothing changed, return `null`.
2. Call `createUserRepo(db, id).linkIdentity(issuer, subject)`, keeping identity writes in `UserRepo`; on the same connection it joins the open transaction. On `false`, throw a private sentinel to roll back, catch it outside, and return `null`.
3. Rethrow any other error (CHECK, FK or I/O). It ends as `oidc_failed`.

Two racing first logins give one success and one `account_not_linked`; no identity can reach the wrong user. If session creation fails after linking, the next login succeeds through step 1.

## 6. Interfaces

All fields are `readonly` in code. New files:

```ts
// src/server/auth/oidc.ts
export interface OidcFlow { state: string; nonce: string; codeVerifier: string }
export interface OidcIdentity { issuer: string; subject: string; email: string | null; emailVerified: boolean }
export interface OidcProvider {
  start(): Promise<{ url: URL; flow: OidcFlow }>;
  finish(currentUrl: URL, flow: OidcFlow): Promise<OidcIdentity>; // throws OidcError
}
export interface OidcRuntime { provider: OidcProvider; flowKey: Buffer; callbackUrl: string }
export class OidcError extends Error { // fixed message, no cause
  stage: 'start' | 'finish' | 'claims'; code: string;
  constructor(stage: OidcError['stage'], code: string);
}
export function createOidcProvider(cfg: OidcConfig, opts?: { fetch?: typeof fetch }): OidcProvider;

// src/server/auth/oidc-flow.ts
export const OIDC_FLOW_COOKIE = 'walley_oidc';
export const OIDC_FLOW_TTL_MS = 600_000;
export function sealFlow(flow: OidcFlow, key: Buffer, now: number): string;
export function openFlow(value: string | undefined, key: Buffer, now: number): OidcFlow | null;
export function setFlowCookie(reply: FastifyReply, sealed: string, secure: boolean): void;
export function clearFlowCookie(reply: FastifyReply, secure: boolean): void;

// src/server/auth/oidc-link.ts
export type OidcResolution =
  | { kind: 'signed_in'; userId: string; via: 'known' | 'linked' | 'created' }
  | { kind: 'refused' };
export function resolveOidcLogin(db: AppDatabase, identity: OidcIdentity,
  opts: { allowRegistration: boolean }): OidcResolution;

// src/server/routes/oidc.ts
export interface OidcRoutesOptions {
  db: AppDatabase; secureCookies: boolean; allowRegistration: boolean; now: () => number;
  oidc: OidcRuntime | null; // null in local mode: both routes 404
}
export const oidcRoutes: FastifyPluginAsync<OidcRoutesOptions>;
```

Adapter rules:

- `code` is the library error's `code` if it matches `^[A-Z][A-Z0-9_]{0,63}$`, else `UNKNOWN`.
- Discovery is lazy, through one shared promise kept on success and reset on failure; startup never contacts the provider.
- Client authentication uses `ClientSecretBasic(cfg.clientSecret)` (unverified), unless O-B decides otherwise.
- `email` is null unless the trimmed claim has exactly one `@` and at most 254 characters.

Email rule: the email used for linking and creation is the ID token's email claim, and only when email_verified is the boolean true. If that email contains any character above U+007F, treat it as absent: no link, no user, no session, and the callback redirects to account_not_linked. Lowercase the email only after this check. Reason: JavaScript toLowerCase() maps U+212A KELVIN SIGN to "k", so a verified "KaKte@x.com" would otherwise match the account for kate@x.com. This check runs in the adapter, so findLinkCandidate in src/server/db/lookup.ts never receives a non-ASCII email. The check is implemented in `resolveOidcLogin` in `src/server/auth/oidc-link.ts` rather than in the adapter, so it protects every caller of that function.

- Route tests inject a plain `OidcProvider`. Adapter tests pass `opts.fetch`, wired to `customFetch` (unverified). Failing that, they use a server on 127.0.0.1, port 0.

`createUser` stays the only runtime export of `db/accounts.ts`, so `exports.test.ts` is unchanged. The identity overload comes first, so a call with `identity` gets the nullable return type:

```ts
export function createUser(db: AppDatabase, input: { email: string; passwordHash: null; identity: { issuer: string; subject: string } }): { id: string; email: string } | null;
export function createUser(db: AppDatabase, input: { email: string; passwordHash: string | null }): { id: string; email: string };
```

Other changes:

- **`crypto/keys.ts`:** add `deriveFlowKey(appSecret: string): Buffer`.
- **`app.ts`:** `AuthOptions` gains `oidc?: OidcRuntime`, and `buildApp` throws if it is missing in OIDC mode or present in local mode. `BuildAppOptions` gains `logStream?: { write(line: string): void }`, which turns logging on. A `req` log serializer drops query strings. The serializer is registered on both logger configurations, the app logger in src/server/app.ts and the logger: true option in src/server/index.ts, so the callback's code and state never reach production logs through the request URL. `registerAuth` registers `oidcRoutes` under `/api`, after `authRoutes`.
- **`index.ts`:** in OIDC mode, build the runtime from `createOidcProvider(config.oidc)`, `deriveFlowKey(config.appSecret)` and `config.oidc.callbackUrl`.
- **`test/auth-helpers.ts`:** add `fakeOidcProvider(result: OidcIdentity | Error)`, which counts calls and whose `finish` throws unless it receives the flow `start` returned. Add `fakeOidcRuntime(provider?)`, and give `makeAuthApp` `oidc` and `logStream` options.
- **`routes/auth-gate.test.ts`:** pass `fakeOidcRuntime()` in OIDC mode, and assert that neither OIDC route returns 401.
- **`package.json`:** add `openid-client` as a dependency and `jose` as a devDependency (it signs test tokens), both pinned exactly.
- **Docs:** update each touched folder's MAP.md, and the README "Sign-in modes" section (scope, copying the issuer exactly, client authentication method).

Do not touch `lookup.ts`, `repo.ts`, `schema.ts`, the migrations, `sessions.ts`, `secrets.ts` or `CLAUDE.md`.

## 7. Security checks

| Check | By | Rule |
| --- | --- | --- |
| state, nonce | library | Exact match; a bad state fails before any token request |
| PKCE S256 | Walley, library, provider | Challenge always sent; verifier sent at exchange; provider rejects a mismatch |
| signature, `iss` | library | JWKS check on; exact `iss`, which Walley checks again |
| `aud`, `azp`, `exp`, `iat` | library | `aud` contains `OIDC_CLIENT_ID`; `azp` checked for multiple audiences; default clock skew |
| ID token present | library | `idTokenExpected: true` |
| `sub` | Walley | Non-empty string, at most 255 characters (OIDC Core 2) |
| `email_verified` | Walley | Only the boolean `true`; `"true"`, missing and `false` are unverified |

- **Never log** the authorization code, tokens, state, nonce, verifier, cookies, client secret, email, subject, or a library error's `message` or `cause`.
- **Log only** `{ stage, code }` on failure (`UNKNOWN` for a non-`OidcError`), `{ outcome: 'refused' }` on a refusal, and `{ via, userId }` on success.
- **Never send** provider text such as `error_description` to the browser, and never put `OidcConfig` in a log or an error.
- Every success issues a new session, so fixation is impossible.

## 8. Test plan

All tests run offline, in `routes/oidc-routes.test.ts` (routes, with the fake provider), `auth/oidc-link.test.ts` (link), and `auth/oidc-provider.test.ts` (provider: the real library against in-memory responses signed with `jose`).

The nine #22 criteria are mapped in this section:

1. A known identity signs in with the flag on and off, and with `email_verified` false (O-A). (routes)
2. A verified email links, and the `users` row is unchanged. (link)
3. An unknown identity with `email_verified` false, missing or `"true"` is refused with the flag on, and writes nothing whether or not its email exists. (link)
4. A user already linked at this issuer is refused, and nothing is written. (link)
5. No match, flag on: one user (null `password_hash`, 32-byte `key_salt`) and one identity. (link)
6. No match, flag off: 302 to `account_not_linked`, and the user count is unchanged. (routes)
7. The session's `auth_method` is `oidc`. (routes)
8. Local mode: both routes return 404. (routes)
9. Route test for the linked outcome: after a verified email match, the response sets the session cookie, and a `sessions` row exists with `auth_method` `oidc`. `password_hash` and `key_salt` are unchanged. (routes)
10. Route test for the created outcome: with `allowRegistration` true, the response sets the session cookie, a `sessions` row with `auth_method` `oidc` exists, and the new user has a null `password_hash`. (routes)
11. A state mismatch sends no token request, and a nonce mismatch is rejected. (provider)

Two-user isolation (link):

- **Linking.** Bob's login links only Bob, and Alice's rows and session are unchanged. A token with Alice's subject and Bob's email signs in Alice.
- **Creation.** Carol gets a `key_salt` different from Alice's, and Alice is unchanged. With the flag on, a new subject with already-linked Alice's verified email writes nothing.
- **`accounts.test.ts`.** `createUser` with `identity` returns null on a duplicate email or identity, and leaves no partial row.

Failure paths:

- **Bad state.** Item 11, plus route tests with a missing, a tampered and an expired (+601 s) cookie. Each gives `oidc_failed`, with no provider call and no session.
- **Bad nonce.** Item 11, plus provider tests for wrong `aud`, wrong `iss`, expired token, bad signature, missing `sub` and wrong PKCE verifier.
- **Provider error.** In the provider test, `?error=access_denied&error_description=MARKER` gives an `OidcError` without MARKER. In the routes test, a fake that throws `Error('MARKER')` gives `oidc_failed`, and MARKER is absent from the body, the Location and the logs.
- **Also check:** every outcome clears `walley_oidc`; a prior session is replaced, and the last `walley_session` cookie is the new one; logs never contain the code, state or a token; a missing Origin never causes 403; `deriveFlowKey` is deterministic, 32 bytes, and differs from `deriveUserKey`.

## 9. Schema

No migration is needed. `user_identities` already has both unique indexes, `password_hash` is nullable, `sessions.auth_method` allows `oidc`, and the flow state lives in a cookie.

## 10. Owner decisions

- O-A (closed by the owner's approved text): a known (issuer, subject) signs in whatever email_verified is. The owner's text does not condition this on email_verified.
- O-B (orchestrator's choice, for owner review): client_secret_basic is the token-endpoint client authentication method. A provider that rejects it needs a design change.
- O-C (orchestrator's choice, for owner review): ID-token claims are the only email source. There is no userinfo fallback in M3.
- Non-ASCII email (orchestrator's choice, for owner review): a non-ASCII email from the ID token is refused (see the email rule in section 6). A later change could punycode the domain.
- Refused callback and presented session (orchestrator's choice, for owner review): a refused callback leaves any presented session in place. A successful callback deletes it before creating the new session.
- Flow cookie TTL (orchestrator's choice, for owner review): 600 seconds, a project convention.
- O-D (open, owner to decide): is GET /api/auth/oidc/login rate limited in M3? A failing discovery is re-fetched on every unauthenticated request, so an unauthenticated caller can make Walley hit the provider with no cap. The orchestrator recommends limiting it with the #21 limiter.

# M3 open questions (saved for owner review)

Written 2026-10-22. Each item is a decision only the owner can make. Work that does not depend on an item continues.

## Decisions the owner should make

1. **Dependency vulnerabilities.** `npm install openid-client@6.8.8` reported 4 moderate vulnerabilities and blocked install scripts for 5 packages. Not yet triaged. Decide whether to run `npm audit fix` (may change other packages) or accept the findings after review.
2. **OIDC client authentication.** Design O-B: `client_secret_basic` is the default. A provider that rejects it needs a design change. Confirm, or name the provider you will use.
3. **Email source for OIDC.** Design O-C: ID-token claims only, with no userinfo fallback. Confirm.
4. **Non-ASCII email from the ID token.** Design: refused. A later change could punycode the domain. Confirm.
5. **Refused callback and an existing session.** Design: a refused callback leaves any presented session in place; a successful callback replaces it. Confirm.
6. **Flow cookie TTL.** 600 seconds, a project convention. Confirm or change.
7. **Rate limit on the OIDC login endpoint (design O-D).** Is `GET /api/auth/oidc/login` limited in M3? Discovery is re-fetched on each unauthenticated call, so it is currently unlimited.
8. **Non-ASCII OIDC issuer path.** An issuer such as `https://idp.example.com/café` is rejected even though the host is ASCII. Keep the rule or allow it?
9. **Reviewer model availability.** Every reviewer call to the project `security-reviewer` (configured `claude-advantage-assist[1m]`) failed with "Model not available for Coding Agents" (HTTP 400, E003), and a re-dispatch to `opus-code-reviewer` failed the same way. Only you decide the model settings. Run `security-reviewer` again once it is available, or tell me which model to use.
10. **Agent model settings.** Your instruction was that opus and sonnet agents always use `claude-advantage-assist`. The files currently set `claude-opus-5-5` and `claude-sonnet-5-5`. I have not changed them. Confirm which is intended.
11. **Rate-limit key for untrusted or junk X-Forwarded-For tokens.** Behind a trusted proxy that does not overwrite the header, a client can send a new junk token per request and get a fresh bucket. Options: document that the proxy must overwrite or append the header, or send unparseable addresses to the shared `unknown` bucket.
12. **NAT64 sources.** Addresses under `64:ff9b::/96` share one /64 bucket. Matters only for IPv6-only servers behind NAT64. Fix or accept.
13. **Email counter lockout.** Five register attempts against a victim's email lock that email's login for 15 minutes, because the counter is shared. Accepted by design; confirm.

## Already decided and applied (for reference)

- O4 and O8 do not exist anywhere in the repo or issues. Planning does not depend on them.
- TRUST_PROXY: minimum /8 IPv4 and /32 IPv6, zone IDs rejected, host bits rejected, prefix 0 rejected.
- IPv6 per-IP limit keyed on /64. Malformed JSON bodies are not counted.
- `/api/auth/me` returns no OIDC fields in M3; M6 #46 adds them.
- Login and register return a generic `internal` body on server errors.
- OIDC: `user_identities.issuer` is the provider's discovery issuer. A known identity signs in regardless of `email_verified`.
- Creation requires `email_verified === true`.
- Refused OIDC login redirects to `/login?error=account_not_linked`.
- `PUBLIC_ORIGIN` must be https, or http only on localhost, 127.0.0.1 or [::1].

## Tentative defaults, NOT confirmed by owner

Built on as placeholders. Ask the owner at 08:00 and revisit any code that depends on them.

1. npm audit: accept after review, no audit fix.
2. OIDC client auth: client_secret_basic.
3. OIDC email: ID-token claims only.
4. Non-ASCII email: refuse.
5. Refused callback: leave a presented session in place.
6. Flow cookie TTL: 600 seconds.
7. OIDC login rate limit: yes, with the existing limiter.
8. Non-ASCII issuer path: keep rejecting.
9. Reviewer model: OPEN. Reviews stay paused until the owner decides.
10. Agent models: CONFIRMED by owner. Existing settings are correct; do not change.
11. Junk X-Forwarded-For: shared unknown bucket, and document the proxy requirement.
12. NAT64: accept.
13. Shared email lockout: accept.

## Owner answers, 2026-10-22 08:00 round (confirmed)

- npm audit: run npm audit fix.
- OIDC client auth: client_secret_basic.
- OIDC provider: Authentik.
- Refused callback: leave the presented session in place.
- Flow cookie TTL: 600 seconds.
- OIDC login rate limit: limit it.
- Non-ASCII issuer path: keep rejecting.
- Non-ASCII email: refuse.
- Reviewer model: claude-advantage-assist (owner changes the agent files).
- Junk X-Forwarded-For: shared bucket.
- NAT64: accept.
- Shared email lockout: accept.
- Wallos API key header: check the Wallos API docs. Do not guess.
- M4 Actual isolation: serialize with a mutex.
- Frequency mapper #31: move into M4.
- Actual data directory: a separate DATA_DIR setting.

## Owner answer, iat check (confirmed)

- Refuse an ID token whose iat is later than now plus 60 seconds of clock skew. Being implemented as IAT_IN_FUTURE in src/server/auth/oidc.ts.

## Decided for #99 (email verification, local registration)

- Local registration sends a verification link by email. Tokens expire 24 hours after issue (`VERIFICATION_TOKEN_TTL_MS`), owner decision.
- No automatic sign-in after registering. The user must follow the link, then log in.
- `POST /api/auth/register` returns `202 {"status":"verification_sent"}` for every outcome, with no cookie. No `email_taken` response exists any more, so the register form does not reveal whether an address has an account.
- Login for an unverified user returns the same `401 invalid_credentials` as a wrong password.

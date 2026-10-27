# src/server/auth

Cookie sessions and password hashing for the API. Pure server code: no routes live here; `app.ts` wires the session hook and the logout route, and `routes/auth.ts` uses `passwords.ts`.

## Files

| Path | What it is | Read it when |
| --- | --- | --- |
| `sessions.ts` | Constants `SESSION_COOKIE` (`walley_session`), `CSRF_COOKIE` (`walley_csrf`), `CSRF_HEADER` (`x-csrf-token`); types `IssuedSession`, `SessionContext`; `hashToken` (hex SHA-256), `createSession`, `findSession` (12 h absolute, 30 min idle, `last_seen_at` written at most once a minute, wrong-method sessions deleted), `deleteSession`, `setSessionCookies`, `clearSessionCookies`. Depends on `db/lookup.ts` (`findSessionByIdHash`, read only) and `db/repo.ts` (all writes) | Signing in or out, session lifetimes, cookie attributes |
| `passwords.ts` | `hashPassword` (Argon2id via `node:crypto` `argon2`, PHC string `$argon2id$v=19$m=19456,t=2,p=1$salt$hash`), `verifyPassword` (reads m, t, p from the stored string; false for anything not argon2id PHC), `verifyAgainstDummy` (equal-cost check that always returns false), `normalisePassword` (NFKC), `isAcceptablePasswordLength` (15 to 256 code points). No other dependencies | Local register and login, changing hash parameters |
| `passwords.test.ts` | Hash format, verify, NFKC and code point length tests | Changing `passwords.ts` |
| `csrf.ts` | `createCsrfHook(publicOrigin, mode)`: `onRequest` hook for the Origin check and the `x-csrf-token` check (SHA-256 hash, `timingSafeEqual`); in OIDC mode it skips routes with `config.localAuthOnly` (login, register, verify-email, password change) so they answer 403 `local_auth_disabled`; registered in `app.ts` after the deny hook | Changing CSRF rules |
| `rate-limit.ts` | `createRateLimiter({ now, maxPerEmail, maxPerIp, windowMs, maxKeys })`: sliding-window `take(key)` (`email:` and `ip:` keys) and `clear(key)`; refused attempts are not counted; expired entries swept on each call; above `maxKeys` IP keys evict oldest-first and new email keys are refused (live email keys are never evicted). Exports the sign-in limit constants (5 per email, 20 per IP, 15 min, 10,000 keys) | Changing sign-in limits or the 429 rules |
| `rate-limit.test.ts` | Window, Retry-After, sweep, IP eviction and email refuse-at-cap tests for the limiter | Changing `rate-limit.ts` |
| `oidc.ts` | `OidcProvider` (`start()` returns `{ url, flow }`, `finish(currentUrl, flow)` returns verified claims), `OidcRuntime`, `OidcError` (fixed message, `stage`, `code`, no cause), `createOidcProvider(config, fetchImpl?)`: `openid-client` with lazy cached discovery, PKCE S256, `client_secret_basic`, `enableNonRepudiationChecks` (ID token signature), exact `iss` check, `allowInsecureRequests` only for an http loopback issuer | Changing the provider protocol, client auth or claim checks |
| `oidc-provider.test.ts` | Provider tests against in-memory responses signed with `jose`: state, nonce, aud, iss, exp, signature, sub, PKCE, provider errors, discovery retry | Changing `oidc.ts` |
| `registration.ts` | `isRegistrationOpen(db, ceiling)` (ceiling AND the stored `app_settings` toggle, read per call; used by the register route, `/api/auth/config` and OIDC first login) and `isAdminEmail(adminEmails, email)` | Registration rules, admin check |
| `sessions.test.ts` | Cookie attribute, hashing, expiry, idle, touch and mode-mismatch tests | Changing `sessions.ts` |

## Rules

- The raw token and CSRF token exist only in the cookie values. The database stores their SHA-256 hashes. Never log or return them.
- Writes go through `createUserRepo`; `findSessionByIdHash` is used only inside `findSession`.
- Every POST, PUT, PATCH or DELETE under `/api/` needs `Origin` equal to `publicOrigin` (else 403 `csrf_failed`), and with a session also an `x-csrf-token` whose hash matches the stored one; GET and HEAD are exempt.

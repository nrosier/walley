# src/server/auth

Cookie sessions for the API. Pure server code: no routes live here; `app.ts` wires the session hook and the logout route.

## Files

| Path | What it is | Read it when |
| --- | --- | --- |
| `sessions.ts` | Constants `SESSION_COOKIE` (`walley_session`), `CSRF_COOKIE` (`walley_csrf`), `CSRF_HEADER` (`x-csrf-token`); types `IssuedSession`, `SessionContext`; `hashToken` (hex SHA-256), `createSession`, `findSession` (12 h absolute, 30 min idle, `last_seen_at` written at most once a minute, wrong-method sessions deleted), `deleteSession`, `setSessionCookies`, `clearSessionCookies`. Depends on `db/lookup.ts` (`findSessionByIdHash`, read only) and `db/repo.ts` (all writes) | Signing in or out, session lifetimes, cookie attributes |
| `sessions.test.ts` | Cookie attribute, hashing, expiry, idle, touch and mode-mismatch tests | Changing `sessions.ts` |

## Rules

- The raw token and CSRF token exist only in the cookie values. The database stores their SHA-256 hashes. Never log or return them.
- Writes go through `createUserRepo`; `findSessionByIdHash` is used only inside `findSession`.
- The CSRF token is stored but not yet checked (planned in #20).

# src/server/routes

Fastify route plugins, registered by `buildApp` in `../app.ts` under the `/api` prefix. Every route here is default-deny unless it sets `config: { public: true }`.

| Path | What it is | Read it when |
| --- | --- | --- |
| `health.ts` | `GET /api/health` returns `{ "status": "ok" }`. Public | Health checks, or an example of a public route |
| `auth.ts` | `authRoutes`: public `GET /api/auth/config` (`{ mode, registration }`), `GET /api/auth/me` (`{ email, authMethod }`, session required), and public `POST /api/auth/register` (201, 400 `invalid_request`, 403 `registration_disabled` / `local_auth_disabled`, 409 `email_taken`) and `POST /api/auth/login` (200, 400 `invalid_request`, 401 `invalid_credentials`, 403 `local_auth_disabled`). Both return 429 `rate_limited` with `Retry-After` once an email (5 per 15 min, shared by both) or a client IP (20 per 15 min) is over its limit. Needs `secureCookies` and `now` options from `app.ts`. Uses `auth/passwords.ts`, `auth/sessions.ts`, `db/accounts.ts`, `db/lookup.ts` | Changing what the browser learns about auth or the signed-in user |
| `auth-local.test.ts` | Tests for `POST /api/auth/register` and `/login`: cookies, error codes, identical 401s, session replacement, OIDC refusal without a database read, two-user isolation | Changing local sign-in |
| `auth-logout.test.ts` | Tests for `POST /api/auth/logout` and the session hook's cookie clearing | Changing logout or the session hook |
| `auth-rate-limit.test.ts` | Tests for the 429 limits on register and login: per email, shared counter, success clears, per IP, `trustProxy`, no Argon2 work when limited | Changing sign-in limits |
| `auth-gate.test.ts` | Tests for default-deny: 401 on every non-public route, public routes, mode-mismatched sessions | Changing the deny hook or adding a route |

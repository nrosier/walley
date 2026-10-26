# src/server

Fastify backend. It serves the API, the built web app (when `NODE_ENV=production`) and the database.

## Files

| Path | What it is | Read it when |
| --- | --- | --- |
| `index.ts` | Entry point: loads `.env` (outside production it loads `.env.local` instead when that file exists, so `dev:server` matches Vite), validates config, opens the database, builds the app (one shared `repoFor` and Wallos client feed both `integrations` and `settings`, with `appSecret` from config) and listens. Settings get `actual` wired to `withActualServer` and `withActualSession` (from `integrations/actual/session.ts`, sharing `db`, `appSecret` and `dataDir` with the create deps). In OIDC mode it builds the `OidcRuntime` (`createOidcProvider`, no network I/O; `deriveFlowKey`; callback URL) and passes it as `auth.oidc`; if that fails it logs a fixed message, closes the database and exits with code 1 without listening. Exits 1 on any other startup error | Startup behaviour |
| `startup-oidc.test.ts` | Tests the startup wiring through `loadConfig` and `buildApp` with the options `index.ts` builds: OIDC login route registered in OIDC mode (discovery stubbed to fail gives 302 `oidc_failed`), 404 in local mode | Changing how startup wires OIDC |
| `app.ts` | `buildApp({ logger, webRoot, db, auth, trustProxy, integrations, settings })`. With `auth` it always registers `accountRoutes`; with `settings` (`SettingsWallosDeps`: `repoFor`, `wallos.listCurrencies`, `appSecret`, plus optional `actual`: `withActualServer`, `withActual`) it also registers `settingsWallosRoutes`, `settingsMatchingRoutes`, and `settingsActualRoutes` when `actual` is given. Registers the health route under `/api`, the static web app with cache headers, and the SPA fallback. With `auth` (needs `db`) it throws at startup if local registration is on and no `mailer` is given. It also registers `@fastify/cookie`, an `onRequest` session hook that sets `request.auth` for `/api` paths and clears stale cookies, `POST /api/auth/logout` and the auth routes. A deny hook (with or without `auth`) answers 401 for any `/api` request with no session unless the route has `config.public`. Never reads `process.env` | Adding a route or changing how requests are served |
| `config.ts` | `loadConfig(env)`: a pure function that validates environment variables into `AppConfig`. Secrets (including `smtpUrl`) are non-enumerable. `SMTP_URL` and `MAIL_FROM` are required only in local mode with `ALLOW_REGISTRATION=true`. Collects every problem into one `ConfigError` | Adding or changing an environment variable |
| `trust-proxy.test.ts` | Tests that `buildApp({ trustProxy })` honours X-Forwarded-For only from trusted peers (address and CIDR forms) | Changing proxy trust or client IP handling |
| `shutdown.ts` | `registerShutdown(app)`: closes the app on SIGTERM or SIGINT and exits 0. A watchdog exits 1 only if close hangs | Shutdown behaviour |
| `routes/health.ts` | `GET /api/health` returns `{ "status": "ok" }`. Public | Health checks (Docker and CI use it) |
| `routes/auth.ts` | `authRoutes` plugin (options: `db`, `mode`, `allowRegistration`, `secureCookies`, `now`, `mailer`, `publicOrigin`): public `GET /api/auth/config` returns `{ mode, registration }`; `GET /api/auth/me` returns `{ email, authMethod }`; public `POST /api/auth/register` (202, sends verification mail), `POST /api/auth/verify-email` (token plus registration password) and `POST /api/auth/login` (local mode only; 403 `local_auth_disabled` in OIDC mode). Registered only when `auth` is given | Changing what the login page or session check reads |
| `routes/auth-local.test.ts` | Tests for local register (202, no cookie) and login: errors, the session a register request carries is left alone, OIDC refusal, two-user isolation | Changing local sign-in |
| `routes/auth-verify.test.ts` | Tests for email verification: `POST /api/auth/verify-email`, login before and after verifying, re-register rules, mail, logs, Argon2 count | Changing verification |
| `routes/auth-rate-limit.test.ts` | Tests for the 429 limits: per email, shared register/login counter, success clears, per IP, `trustProxy`, no Argon2 work when limited, two-user isolation | Changing sign-in limits |
| `routes/auth-gate.test.ts` | Tests for default-deny: every non-public route gives 401, public routes, `/auth/config` and `/auth/me` bodies, mode-mismatched sessions | Changing the deny hook or adding a route |
| `routes/csrf.test.ts` | Tests for the CSRF hook: Origin and token checks, public routes, hook order, two-user isolation | Changing CSRF rules |
| `routes/integrations.ts` | `integrationRoutes`: `POST /api/integrations/actual-schedules` and `/wallos-subscriptions` (create flows #28-#30). Registered when `integrations` (a `CreateDeps`) is passed with `auth`; `index.ts` wires `realCreateDeps` | Changing the create routes |
| `routes/account.ts` | `accountRoutes` (`db`, `mode`, `now`): `GET /api/account`, `PUT /api/account/password` (rate limited like sign-in: per user and per IP, 429 `rate_limited`). Registered whenever `auth` is set | Account settings |
| `routes/settings-wallos.ts` | `settingsWallosRoutes`: `GET`/`PUT /api/settings/wallos`, `POST /api/settings/wallos/test`. Registered when `settings` is set | Wallos settings |
| `routes/settings-actual.ts` | `settingsActualRoutes`: `GET`/`PUT /api/settings/actual`, `POST /api/settings/actual/budgets` and `/base-currency`. Registered when `settings.actual` is set | Actual settings |
| `routes/overrides.ts` | `overridesRoutes`: `GET`/`PUT`/`DELETE /api/overrides/:wallosSubscriptionId` (per-subscription rate override; a changed save or a clear resets the user's LINKED Wallos hashes). Registered when `settings` is set | Currency rate overrides |
| `routes/settings-matching.ts` | `settingsMatchingRoutes`: `GET`/`PUT /api/settings/matching` (tolerance 0 to 50). Registered when `settings` is set | Matching settings |
| `routes/MAP.md` | Map of the `routes/` folder | Finding a route file |
| `db/` | SQLite schema, migrations and the scoped data layer; see `db/MAP.md` | Any stored data |
| `mail/` | Mail queue, SMTP transport and email templates; see `mail/MAP.md` | Sending email |
| `crypto/` | Secret encryption and per-user key derivation; see `crypto/MAP.md` | Encrypting or deriving keys |
| `auth/csrf.ts` | `createCsrfHook`; see `auth/MAP.md` | CSRF rules |
| `auth/rate-limit.ts` | Sliding-window limiter for login and register (per email and per client IP; email keys refuse at the cap rather than evict); see `auth/MAP.md` | Sign-in limits, 429 responses |
| `auth/` | Cookie session service and password hashing (Argon2id); see `auth/MAP.md` | Sessions, cookies, logout, passwords |
| `test/auth-helpers.ts` | Test helpers: `makeAuthApp` (in-memory db, injectable clock), `makeUser`, `signIn`, `injectAs` (adds the session cookie, `X-CSRF-Token` and `Origin`; callers may override) | Writing route tests that need a signed-in user |
| `tsconfig.json`, `tsconfig.build.json` | Server type check, and the build that emits `dist/server` | Compiler errors for server code only |

## Rules

- Route handlers must reach user data only through `createUserRepo` (see `db/MAP.md`). Do not import `drizzle-orm` here; ESLint blocks it.
- `buildApp` never reads environment variables. Configuration arrives as arguments from `index.ts`.
- Every `/api` route is default-deny. Without a valid session it returns 401 `unauthenticated`, unless the route is marked `config: { public: true }`. Public today: `GET /api/health`, `GET /api/auth/config`, `POST /api/auth/register`, `POST /api/auth/verify-email` and `POST /api/auth/login`.

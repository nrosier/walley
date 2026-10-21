# src/server

Fastify backend. It serves the API, the built web app (when `NODE_ENV=production`) and the database.

## Files

| Path | What it is | Read it when |
| --- | --- | --- |
| `index.ts` | Entry point: loads `.env`, validates config, opens the database, builds the app and listens. Exits 1 on any startup error | Startup behaviour |
| `app.ts` | `buildApp({ logger, webRoot, db, auth })`. Registers the health route under `/api`, the static web app with cache headers, and the SPA fallback. With `auth` (needs `db`) it also registers `@fastify/cookie`, an `onRequest` session hook that sets `request.auth` for `/api` paths and clears stale cookies, `POST /api/auth/logout` and the auth routes. A deny hook (with or without `auth`) answers 401 for any `/api` request with no session unless the route has `config.public`. Never reads `process.env` | Adding a route or changing how requests are served |
| `config.ts` | `loadConfig(env)`: a pure function that validates environment variables into `AppConfig`. Secrets are non-enumerable. Collects every problem into one `ConfigError` | Adding or changing an environment variable |
| `shutdown.ts` | `registerShutdown(app)`: closes the app on SIGTERM or SIGINT and exits 0. A watchdog exits 1 only if close hangs | Shutdown behaviour |
| `routes/health.ts` | `GET /api/health` returns `{ "status": "ok" }`. Public | Health checks (Docker and CI use it) |
| `routes/auth.ts` | `authRoutes` plugin: public `GET /api/auth/config` returns `{ mode, registration }`; `GET /api/auth/me` returns `{ email, authMethod }` for the signed-in user. Registered only when `auth` is given | Changing what the login page or session check reads |
| `routes/auth-gate.test.ts` | Tests for default-deny: every non-public route gives 401, public routes, `/auth/config` and `/auth/me` bodies, mode-mismatched sessions | Changing the deny hook or adding a route |
| `routes/MAP.md` | Map of the `routes/` folder | Finding a route file |
| `db/` | SQLite schema, migrations and the scoped data layer; see `db/MAP.md` | Any stored data |
| `crypto/` | Secret encryption and per-user key derivation; see `crypto/MAP.md` | Encrypting or deriving keys |
| `auth/` | Cookie session service: tokens, expiry, cookies; see `auth/MAP.md` | Sessions, cookies, logout |
| `test/auth-helpers.ts` | Test helpers: `makeAuthApp` (in-memory db, injectable clock), `makeUser`, `signIn`, `injectAs` (adds the session cookie and `X-CSRF-Token`; no `Origin` yet) | Writing route tests that need a signed-in user |
| `tsconfig.json`, `tsconfig.build.json` | Server type check, and the build that emits `dist/server` | Compiler errors for server code only |

## Rules

- Route handlers must reach user data only through `createUserRepo` (see `db/MAP.md`). Do not import `drizzle-orm` here; ESLint blocks it.
- `buildApp` never reads environment variables. Configuration arrives as arguments from `index.ts`.
- Every `/api` route is default-deny. Without a valid session it returns 401 `unauthenticated`, unless the route is marked `config: { public: true }`. Public today: `GET /api/health` and `GET /api/auth/config`.

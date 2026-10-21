# src/server

Fastify backend. It serves the API, the built web app (when `NODE_ENV=production`) and the database.

## Files

| Path | What it is | Read it when |
| --- | --- | --- |
| `index.ts` | Entry point: loads `.env`, validates config, opens the database, builds the app and listens. Exits 1 on any startup error | Startup behaviour |
| `app.ts` | `buildApp({ logger, webRoot, db, auth })`. Registers the health route under `/api`, the static web app with cache headers, and the SPA fallback. With `auth` (needs `db`) it also registers `@fastify/cookie`, an `onRequest` session hook that sets `request.auth` for `/api` paths and clears stale cookies, and `POST /api/auth/logout`. Never reads `process.env` | Adding a route or changing how requests are served |
| `config.ts` | `loadConfig(env)`: a pure function that validates environment variables into `AppConfig`. Secrets are non-enumerable. Collects every problem into one `ConfigError` | Adding or changing an environment variable |
| `shutdown.ts` | `registerShutdown(app)`: closes the app on SIGTERM or SIGINT and exits 0. A watchdog exits 1 only if close hangs | Shutdown behaviour |
| `routes/health.ts` | `GET /api/health` returns `{ "status": "ok" }` | Health checks (Docker and CI use it) |
| `db/` | SQLite schema, migrations and the scoped data layer; see `db/MAP.md` | Any stored data |
| `crypto/` | Secret encryption and per-user key derivation; see `crypto/MAP.md` | Encrypting or deriving keys |
| `auth/` | Cookie session service: tokens, expiry, cookies; see `auth/MAP.md` | Sessions, cookies, logout |
| `test/auth-helpers.ts` | Test helpers: `makeAuthApp` (in-memory db, injectable clock), `makeUser`, `signIn`, `injectAs` (adds the session cookie and `X-CSRF-Token`; no `Origin` yet) | Writing route tests that need a signed-in user |
| `tsconfig.json`, `tsconfig.build.json` | Server type check, and the build that emits `dist/server` | Compiler errors for server code only |

## Rules

- Route handlers must reach user data only through `createUserRepo` (see `db/MAP.md`). Do not import `drizzle-orm` here; ESLint blocks it.
- `buildApp` never reads environment variables. Configuration arrives as arguments from `index.ts`.
- Every `/api` route is public for now. Auth (default-deny) is planned in M3 (#19).

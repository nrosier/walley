# src/server/routes

Fastify route plugins, registered by `buildApp` in `../app.ts` under the `/api` prefix. Every route here is default-deny unless it sets `config: { public: true }`.

| Path | What it is | Read it when |
| --- | --- | --- |
| `health.ts` | `GET /api/health` returns `{ "status": "ok" }`. Public | Health checks, or an example of a public route |
| `auth.ts` | `authRoutes`: public `GET /api/auth/config` (`{ mode, registration }`) and `GET /api/auth/me` (`{ email, authMethod }`, session required) | Changing what the browser learns about auth or the signed-in user |
| `auth-logout.test.ts` | Tests for `POST /api/auth/logout` and the session hook's cookie clearing | Changing logout or the session hook |
| `auth-gate.test.ts` | Tests for default-deny: 401 on every non-public route, public routes, mode-mismatched sessions | Changing the deny hook or adding a route |

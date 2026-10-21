# Repo map

Walley syncs recurring subscriptions between Wallos and Actual Budget. Start with CLAUDE.md for the spec.

## Top level

| Path | What it is | Read it when |
| --- | --- | --- |
| `CLAUDE.md` | Project spec: stack, look and feel, auth and secrets, schema, mapping rules, UI views | Any design, data or behaviour question |
| `README.md` | Setup, configuration table, sign-in modes, security notes, contribution and branching rules | Changing setup, configuration or the contribution process |
| `LICENSE` | MIT licence | Licence questions only |
| `package.json`, `package-lock.json` | Scripts and exact-pinned dependencies (`.npmrc` sets save-exact) | Adding a dependency or changing a script |
| `tsconfig.base.json`, `tsconfig.json` | Shared strict compiler options; the root config is the superset used by `npx tsc --noEmit` | Type errors or compiler settings |
| `vite.config.ts`, `vitest.config.ts` | Web build and dev proxy; test runner config (kept separate on purpose) | Build, dev server or test setup |
| `eslint.config.js` | Lint rules, including the import boundaries and the drizzle boundary | A lint error, or adding a rule |
| `drizzle.config.ts` | Drizzle Kit: schema path and migrations folder | Generating a migration |
| `Dockerfile`, `.dockerignore`, `compose.example.yml` | Container image and the Traefik compose template (copy to `compose.yml`) | Docker build or deployment |
| `renovate.json`, `.gitleaks.toml` | Dependency updates; the secret scan allowlist (by path, for one test vector) | Dependency bumps or a scanner finding |
| `.github/workflows/` | CI (build, typecheck, lint, test, migration drift guard), Security (gitleaks, dependency review), Docker | A failing check |
| `.claude/` | Subagents and skills for this repo | Choosing an agent or skill; see `.claude/MAP.md` |

## Source

| Path | What it is | Read it when |
| --- | --- | --- |
| `src/server/` | Fastify backend; see `src/server/MAP.md` | Server routes, startup, config |
| `src/web/` | React and Vite frontend | UI work |
| `src/lib/` | Code shared by server and web, with no Node or DOM types; holds the match-status enum (`match-status.ts`) and the auth method list (`auth-mode.ts`) | Anything both sides use |

## Conventions

- Do not read `dist/`, `node_modules/` or `.claude/worktrees/`. They hold build output, dependencies, or copies of other branches.
- Secrets live only in `.env`, which is never committed. `compose.yml` is also git-ignored. Environment variables are listed in the README Configuration section.
- User data is reached only through `createUserRepo` (see `src/server/db/MAP.md`).

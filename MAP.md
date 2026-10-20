# Repo map

Walley syncs recurring subscriptions between Wallos and Actual Budget. Start with CLAUDE.md for the spec.

## On main

| Path | What it is | Read it when |
| --- | --- | --- |
| `CLAUDE.md` | Project spec: stack, look and feel, auth and secrets, schema, mapping rules, UI views | Any design, data or behaviour question |
| `README.md` | Setup, configuration table, sign-in modes, security notes, contribution and branching rules | Changing setup, configuration or the contribution process |
| `LICENSE` | MIT licence | Licence questions only |
| `.claude/` | Subagents and skills for this repo | Choosing an agent or skill; see `.claude/MAP.md` |

## Not on main yet

- Source code, `package.json`, tsconfigs and `vite.config.ts`: PR #60 (issue #1, branch `issue-1-scaffold`). Once merged, each source directory gets its own MAP.md.
- OIDC-only login spec changes to CLAUDE.md and README.md: PR #63 (issue #22).

## Conventions

- Do not read `dist/`, `node_modules/` or `.claude/worktrees/`. They hold build output, dependencies, or copies of other branches.
- Secrets live only in `.env`, which is never committed. Environment variables are listed in the README Configuration section.

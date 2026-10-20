---
name: walley-release-checklist
description: Use before tagging or shipping a Walley release, or when a change touches package.json, CI workflows, environment variables, Dockerfile or migrations. Checks that build, type check, lint and tests pass, env vars are documented, migrations apply cleanly, CI matches local commands, and no secrets or local databases are tracked.
---

# Walley Release Checklist

## Commands (all must exit 0)

- `npm run build`
- `npx tsc --noEmit`
- `npm run lint`
- `npm test`

A missing script counts as a failure. Report it as MISSING.

## Checks

1. **Env vars:** every `process.env` read and config key in code appears in `.env.example` and in the README environment section.
2. **Secret length:** startup still refuses an `APP_SECRET` under 32 characters.
3. **Migrations:** all migrations apply to an empty `walley.db`. A second start runs none.
4. **CI parity:** the CI workflow runs the same four commands.
5. **Version:** the `package.json` version matches the release, and the changelog has an entry for it.
6. **Tracked files:** no `.env`, `walley.db` or `node_modules` path is tracked. Check with `git ls-files | grep -E '(^|/)\.env$|walley\.db$|node_modules/'`.
7. **Docker (only if a Dockerfile exists):** the COPY list covers every shipped directory. See the `release-shipped-files-check` skill.

## Output

The verdict (READY or BLOCKED), then one line per command and per check: passed, failed or skipped, with the file:line or command output that supports it.

# Walley agents

Review and check agents for this repo. Use the Agent tool with the name in the first column.

| Agent | Model | Tools | Use for |
| --- | --- | --- | --- |
| `qa-engineer` | sonnet | All (instructed to write tests only) | Writing tests against an issue's acceptance criteria, and finding untested paths |
| `release-engineer` | sonnet | All (instructed to give a verdict only) | READY or BLOCKED verdict: build, typecheck, lint, tests, env vars and CI consistency |
| `security-reviewer` | opus | Read, Grep, Glob, Bash (read-only) | Auth, sessions, CSRF, rate limits, secrets, encryption, OIDC, tenant scope |
| `ux-reviewer` | sonnet | Read, Grep, Glob, Bash (read-only) | UI changes checked against the `ui-*` skills and the CLAUDE.md look and feel |

Each file is `<name>.md` with frontmatter (`name`, `description`, `model`, `effort`, and `tools` where set). Edit the frontmatter to change the model, effort or tool access.

# .claude

Claude Code configuration for this repo.

| Path | What it is | Read it when |
| --- | --- | --- |
| `agents/` | Subagent definitions for Walley reviews and checks; see `agents/MAP.md` | Choosing who does a review or check |
| `skills/` | Walley skills, one folder each with a `SKILL.md`; see `skills/MAP.md` | Checking a change against a standing checklist |
| `worktrees/` | Temporary git worktrees made by isolated agent runs. Not committed. | Never. Skip it when searching. |

Build agents such as haiku-coder, sonnet-engineer and opus-planner, and the shared UI skills (`ui-*`), are user-level. They live in `~/.claude/` and are not described here.

# Walley milestone handoff

Last updated: 2026-10-30. Read this first if you are picking the work up in a new session.

## Release

- Release 0.1.0 is tagged at `cf5f9d0` and pushed. GitHub release: https://github.com/nrosier/walley/releases/tag/0.1.0
- `main` is at `3721874` and pushed.

## Branches

| Branch | Purpose | Status |
| --- | --- | --- |
| `main` | Base | Pushed, head `3721874` |
| `feat-113-amber-danger-tokens` | Issue 113 (UI redesign) | Local, merged to `main` |
| `feat-59-readme-setup-guide` | Issue 59 (README setup guide) | Local, merged to `main` |
| `renovate/lucide-monorepo` | lucide-react bump (PR 144) | Local, merged to `main` via PR 144 |
| `renovate/vite-8.x` | Renovate dependency update | Remote only, not merged |

The branches `m3-authentication`, `m4-integrations` and `m5-matching` named in earlier versions of this doc do not exist in this clone.

## Closed issues

- M1 to M8 are all closed (open = 0).
- Closed issue counts per milestone, from the milestone data: M1 12, M2 6, M3 15, M4 10, M5 8, M6 8, M7 6, M8 7.
- M9 "Hardening and Quality" has one open issue (#58) and its other issues are closed. This includes #59 (README setup guide) and #113 (UI redesign), both closed by release 0.1.0.

## Open issues

- **M9 (deferred past 0.1.0 by owner decision):** #58 (accessibility pass).
- **No milestone:** #142, #136, #135, #117, #116, #71 (Dependency Dashboard).

## Owner decisions (confirmed)

- Wallos auth: `api_key` is a POST form field to `/api/subscriptions/get_subscriptions.php`, not a header.
- Actual: one process-wide session, so syncs run through a mutex. `DATA_DIR/actual/<userId>` holds each user's cache.
- Actual amounts are integer cents in EUR (the live budget's base currency). Expenses are negative.
- Range schedules (`isbetween`): matching uses the midpoint, rounded half away from zero. Either bound changing counts as drift. Creating a Wallos subscription from a range is refused.
- Schedules with non-empty `patterns` are refused (`patterns_unsupported`).
- Currency: Wallos `rate` is the conversion source; per-subscription overrides win.
- Matching: token-overlap name score with legal suffixes removed; a candidate must match on name and amount; tolerance is measured against the larger amount.
- Orphaned pairs (one side gone): flagged, not auto-unlinked; they get an Orphaned badge.
- Status set: LINKED, IGNORED_WALLOS, IGNORED_ACTUAL, MISMATCH_DETECTED. CLAUDE.md's schema line still needs the owner's update.
- Link, Ignore and Restore endpoints: a new M5 issue (not yet created).
- Unlink asks for confirmation in the diff modal, along with the overwrites.
- Wallos auth failures return 502 (not 401), so they do not look like a logged-out session.
- No live writes to Actual or Wallos without explicit approval.

## Open decisions

- M5: name-match threshold 0.6 is untested on real payee data.
- M6 decisions (router choice, register and verify pages in #61, Test Connection credential source, password change session sign-out, tolerance range 0 to 50 in #45 versus 0 to 100 in the DB): resolved with the M6 close. All M6 issues are closed, so these are dropped from this list.
- M9 README gaps (first-run walkthrough, OIDC provider steps) and splitting #55 to #57: resolved with the M9 close. Their issues are closed (#59 closed; #55 to #57 closed), so these are dropped from this list.
- M9 adding `vitest-axe` and redacting cookie and authorization headers in logs: status unverified. No issue mapping was checked for these; they may belong to #58.

## Live data facts (read-only check, 2026-10-22)

- Actual budget: 18 schedules (16 numeric, 2 ranges), 7 accounts, 305 payees, 34 categories, base currency EUR.
- Wallos: 16 subscriptions (15 EUR, 1 USD), 34 currencies.
- Actual schedules with `patterns`: none flagged in the live data; the mapper refuses them when present.

## Tooling

- `scripts/probe-readonly.ts` reads `probe.env` (git-ignored) and calls read endpoints only.
- Never run a write against either live service without explicit approval.

## Next steps

1. Decide whether #135 and the other unassigned open issues (#142, #136, #117, #116, #71) join a milestone for the next release.
2. Run the #58 accessibility pass when the owner schedules it.
3. Rotate the test secrets that were printed into the session output. They were exposed; the values are not recorded here.
4. If still outstanding: fix the test persistence issue in `.env.local` and the password in `accounts.env`.

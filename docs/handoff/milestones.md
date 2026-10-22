# Walley milestone handoff

Last updated: 2026-10-22. Read this first if you are picking the work up in a new session.

## Branches

| Branch | Purpose | Head | Status |
| --- | --- | --- | --- |
| `main` | Base | `16602ed` | Behind `m3-authentication` by M3 work; not updated on purpose |
| `m3-authentication` | M1 to M3 (auth, follow-up fixes, email verification) | `85a5023` | Local only, not pushed |
| `m4-integrations` | M4 (Wallos and Actual integration, server side) | `d2070d5` | Local only, not pushed |
| `m5-matching` | M5 (design decisions, matching helpers) | see `git log m5-matching` | Local only, based on `m4-integrations` |

Rule: one branch per milestone, with that milestone's issues committed to it. Commits are never pushed and no PRs are opened without an explicit instruction.

## Closed issues

- M1 to M3: #98, #100, #101, #102, #103 (accepted), #99 (email verification). Earlier milestones were closed before this handoff.
- M4: #23, #25, #26, #27, #31, #32.
- M3 #99 email verification is on `m3-authentication`.

## Open issues

- **M4 (waiting on live write approval):** #24, #28, #29, #30. Server work is built and committed. Live write checks and the M6/M8 UI are still needed.
- **M5:** #33, #34, #35, #36, #37, #38, #39, #40. Helpers for #33, #34, #36, #37 are built and uncommitted on `m5-matching`. #35 and #38 depend on them. #39 is the sync check endpoint. #40 is split: #40a (ignore_diff, unlink) can proceed; #40b (overwrite Wallos and Actual) is held for live-write approval.
- **M6:** #41, #42, #43, #44, #45, #46, #61.
- **M7:** #47, #48, #49, #50, #51.
- **M8:** #52, #53, #54. Submit wiring for #52 and #53, and the overwrite actions in #54, are held for live-write approval.
- **M9:** #55, #56, #57, #58, #59.

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

- M6: router choice (add `react-router` or hash routing); whether register and verify pages belong in #61; whether Test Connection uses form values or saved credentials only; whether a password change signs out other sessions.
- M6: tolerance is 0 to 50 in #45, but the DB allows 0 to 100.
- M9: README gaps (first-run walkthrough and OIDC provider steps); splitting #55 to #57 into now and later halves; adding `vitest-axe`; redacting cookie and authorization headers in logs.
- M5: name-match threshold 0.6 is untested on real payee data.

## Live data facts (read-only check, 2026-10-22)

- Actual budget: 18 schedules (16 numeric, 2 ranges), 7 accounts, 305 payees, 34 categories, base currency EUR.
- Wallos: 16 subscriptions (15 EUR, 1 USD), 34 currencies.
- Actual schedules with `patterns`: none flagged in the live data; the mapper refuses them when present.

## Tooling

- `scripts/probe-readonly.ts` reads `probe.env` (git-ignored) and calls read endpoints only.
- Never run a write against either live service without explicit approval.

## Next steps

1. Commit the M5 matching helpers to `m5-matching`, with the MAP entries.
2. Create the new M5 issue for Link, Ignore and Restore.
3. Resolve the open M6 decisions, then start M6 tasks in the order the M6 plan gives.
4. When live-write approval is given, run the held M4 checks (#24, #28, #29, #30) and the held M5 #40b and M8 writes.

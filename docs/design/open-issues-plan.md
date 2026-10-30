# Plan: close the 24 open issues

Status: approved. The Matches tab is removed (`pages/Matches.tsx` is deleted); its rows now live on the Sync Dashboard (`pages/SyncDashboard.tsx`, `components/dashboard/PairList.tsx`). Q2, Q3 and Q6 answered; vitest-axe still open (see Open questions).
Branch: `m7-sync-dashboard` (36 commits ahead of `main`). Baseline: 91 test files, 1375 tests, all passing.
Source: planning run on 2026-10-23 with opus-planner, checked against the code. Review page was in Lavish (`/tmp/walley-plan/walley-open-issues-plan.html`, not in the repo).

## Decisions

- **#37 Match status values: option A.** Keep the 4 stored statuses `LINKED | MISMATCH_DETECTED | IGNORED_WALLOS | IGNORED_ACTUAL`. Orphaned is computed, not stored. Confirmed in `docs/design/m3-open-questions.md:96`. Owner edits CLAUDE.md:80 to match, then #37 is closed. No migration.
- **#28 Currency overrides: option A.** Rate field in the Create Actual modal for foreign-currency subscriptions, backed by `GET/PUT/DELETE /api/overrides/:wallosSubscriptionId` (body `{ rate }`, 400 `invalid_rate`). Option B (Settings list) is a follow-up. Option C (drop from scope) is rejected.
- **Q1: the `test/` Docker environment counts as the live-write check** for #29 and #30. No real instance is needed.
- **Q4: yes.** Confirm the Wallos payment method and category endpoints, and the `add` fields, from upstream source before building #111. An empty list is an acceptable fallback for an older Wallos.
- **Q5: yes.** Add `jsdom`, `@testing-library/react` and `@testing-library/user-event` as exact-pinned dev dependencies for #58. `vitest-axe` is not decided.
- **Q2 (#28): reset on override change.** When a currency override is saved, reset the stored Wallos hash of LINKED pairs for that subscription, so the next sync does not show a false Mismatch. Comment posted on #28.
- **Q3 (#109): any unlinked item.** "Link to another item" offers any unlinked item on the missing side, with amount and name candidates shown first. Comment posted on #109.
- **Q6 (#71): do not merge PR #107 now.** Merge only on a later explicit instruction. Comment posted on #71.
- The UI spec and guide decisions (D-a to D-e) are recorded in `docs/ui/WALLEY-UI-SPEC.md` section 10. D-a amends CLAUDE.md (drop Tailwind and Lucide).

## Open questions

- **vitest-axe:** add it for #58 or not?

## Status of each issue

**Already done in code: close after review, label `fixed`, commit, close** (see fixed-issue workflow)
- #24 Map Wallos subscriptions: `src/server/integrations/wallos/map.ts`, fixture tests in `map.test.ts`.
- #33 Fuzzy name match: `src/lib/name-match.ts`, `name-match.test.ts:31-39`.
- #34 Amount tolerance: `src/lib/amount-match.ts`, `amount-match.test.ts:5-10` (1049 match, 1060 no match).
- #35 Auto-link saved pairs: `src/server/matching/engine.ts`, `engine.test.ts:15`.
- #36 Stable field hashes: `src/lib/match-fields.ts`, `src/server/matching/hash.ts`, `hash.test.ts:22`.
- #38 Mismatch on sync: `src/server/matching/mismatch.ts`, `mismatch.test.ts:51`.
- #39 Sync Check endpoint: `src/server/routes/sync.ts`, two-user test in `sync.test.ts`.
- #40 Resolve endpoint (4 actions): `src/server/routes/matches.ts`, `src/server/matching/overwrite.ts` (commit 889f20a). The "#40b held" note in the handoff doc is stale.
- #55 Tenant isolation on every route: `routes/tenant-isolation-routes.test.ts` discovers routes at run time, so a missing case fails.
- #56 Secrets out of browser and logs: `routes/secrets-response.test.ts`, `log-redaction.test.ts`, pino redact paths in `app.ts`.

**Done in code, live check pending**
- #29 Create Actual schedule from Wallos: `create.ts`, `CreateActualModal`. Live check per Q1 (test env).
- #30 Create Wallos subscription from Actual: `create.ts`, `CreateWallosModal`. Live check per Q1 (test env).

**Needs CLAUDE.md edit**
- #37: owner edits CLAUDE.md:80, then close.

**Partly done**
- #28: conversion and override are applied in create and sync check, and stored in `subscription_overrides` (migration 0004). Missing: a route and UI to set an override. Covered by Phase 2D and 3C.
- #57 Mocked integration tests: per-route tests exist. Missing: one end-to-end flow test, and a guard against network calls. Covered by 4A.
- #58 Accessibility pass: Radix focus trap, labels and focus rings are in place. Missing: keyboard and focus tests (no jsdom). Covered by 4C.
- #59 README setup guide: missing the `.env.local` dev override and the `test/` scripts. Covered by 4D.
- #105 Dutch language: parity test and picker exist. The no-literals test misses the dashboard, Matches, create modals and diff modal. Covered by 4B.

**Open, confirmed**
- #108 Auto-link after create: create routes in `create.ts` never call `insertMatch`.
- #109 Re-create or re-link an orphan: orphans show only as a badge (`PairList.tsx`, formerly `Matches.tsx:84`). No action exists.
- #110 Close modal on success: `CreateWallosModal.tsx` and `CreateActualModal.tsx:44` show "done" and never call `onClose`.
- #111 Payment method and category: `WallosSubscriptionPayload` (`wallos/write.ts`) has neither field. `WallosClient` has no list calls.

**Housekeeping**
- #71 Renovate dependency dashboard: stays open by design. PR #107 not merged; merge only on explicit instruction (Q6).

## Phases and run order

Phase 0 has no dependencies and can start now. Other phases follow the `after` column.

| Step | Issue(s) | Work | Agent tier | After |
|---|---|---|---|---|
| 0 | #24, 33, 34, 35, 36, 38, 39, 40, 55, 56 | Verify tests, label `fixed`, commit, close. Fix stale docs: `docs/handoff/milestones.md`, `src/server/MAP.md`, `src/server/routes/MAP.md` (settings-actual is registered at `app.ts:238`), `src/web/MAP.md` (missing dialog, create and create-modal files). | haiku-coder, then sonnet-code-reviewer | none |
| 0b | #37 | Owner edits CLAUDE.md:80. Then close. | owner | none |
| 2A | #108 | Auto-link on create (see below). | sonnet-engineer | none |
| 2D | #28 (server) | `src/server/routes/overrides.ts`, register in `app.ts`. | sonnet-engineer | none (parallel with 2A) |
| 2B | #111 (server) | Wallos list calls, payload fields, prefill lists, validation. | sonnet-engineer | 2A |
| 2C | #109 (server) | Relink and recreate routes. Runs after 2B, or split carefully: both touch `create.ts` and `integrations.ts`. | sonnet-engineer | 2A |
| 3A | #110 | Close modal on success, notices in dashboard `role="status"` (en and nl). | haiku-coder | 2A |
| 3D | #109 (UI) | Orphan actions in `components/dashboard/PairList.tsx` (`pages/SyncDashboard.tsx`), `lib/matches.api.ts`, optimistic apply. The Matches tab is removed; the Sync Dashboard replaces it. | sonnet-engineer | 2C (parallel with 3A) |
| 3C | #28 (UI) | Rate field in `CreateActualModal.tsx`, `lib/overrides.api.ts`. | sonnet-engineer | 3A, 2D |
| 3B | #111 (UI) | Two optional selects in `CreateWallosModal.tsx`. | haiku-coder | 3C (same modals), 2B |
| 4A | #57 | One flow test in `src/server/flows.integration.test.ts`, `fetch` set to throw. | sonnet-engineer | 2A, 2C |
| 4B | #105 | Add dashboard, Matches, create and diff views to `no-literals.test.tsx`; move strings to `*.messages.ts`. | haiku-coder | all Phase 3 |
| 4C | #58 | Dev deps (Q5), jsdom keyboard tests, written walkthrough. | sonnet-engineer | all Phase 3 |
| 4D | #59 | README: `.env.local`, `test/` scripts, overrides, auto-link. | haiku-coder | last |
| 4E | #29, #30 | Live check in `test/` environment (`test/start-test-env.sh`, ports 8282 and 5006). Compare the created amount and cycle with the prefill. | owner-approved run | after 2A |
| 5 | #71 | Merge PR #107 only if instructed (Q6). | owner | none |

Parallel groups: 0 with everything. 2A with 2D. 3A with 3D. 4B with 4C.

## Approach for the open issues

**#108 Auto-link after create (medium risk)**
- Before any remote write, return 409 `already_matched` if the source item already has a match (`repo.findMatchByItem`).
- Create on the remote side. Re-read it with `readCurrentSides`. Then `insertMatch` as LINKED with server-computed hashes. Return `{ ...ids, matchId, linked: true }`.
- If the read-back or insert fails, still return 201 with `linked: false` and a notice code. A 5xx invites a retry and a duplicate remote item.
- Per-user, per-source-item in-flight guard, following `matching/overwrite.ts`.
- Tests: match row exists after 201; a later sync check lists the pair as linked; second submit gets 409 with no remote call; user B's create never touches A's rows.

**#109 Re-create or re-link an orphan (medium-high risk; Q3 decided: any unlinked item, candidates first)**
- `POST /api/matches/:id/relink` with `{ side, itemId }`. Only this user's orphaned row, only the missing side, target must have no match. 409 on unique violation.
- Create routes take an optional `matchId`. The source must be the surviving side of that orphaned row. The row is updated, not inserted.
- UI: "Recreate in Actual or Wallos" and "Link to…" on orphaned rows. For orphans on both sides, only Unlink. Widen Unlink to cover orphans.
- Depends on #108.
- Tests: orphan becomes LINKED; 404 for another user's id; 400 `invalid_state` for a non-orphan; 409 when the target is already matched; sync check after the action shows no orphan; two-user cases in the tenant suite.

**#110 Close modal on success (low risk)**
- On success: `onCreated(result)`, then `onClose`. On failure the modal stays open.
- Update `CreateModals.test.tsx`: success closes and refreshes; failure does not close; notice text renders.

**#111 Payment method and category (medium risk; upstream API unverified)**
- Read the Wallos source first and confirm the payment method and category endpoints and the `add` field names (`payment_method_id`, `category_id`). Do not guess.
- Prefill returns `paymentMethods` and `categories`. Submit accepts optional ids. The server checks each id against the caller's own Wallos data, else 400 `invalid_payment_method` / `invalid_category`.
- Empty selections send today's exact payload.
- Tests: client tests with saved upstream fixtures; empty selection keeps the old payload; user B sending A's ids gets 400 and `createSubscription` is never called.

**#28 Override routes and UI (medium risk; Q2 decided: reset LINKED pair hashes on override save)**
- `GET/PUT/DELETE /api/overrides/:wallosSubscriptionId`, body `{ rate }` (decimal string), 400 `invalid_rate` from `parseRate`. Through `repoFor(userId)`.
- Tests: 401; CSRF; invalid rate; two-user case (B cannot read, write or delete A's override); prefill amount changes after PUT. The tenant suite covers the new route automatically.
- Q2 decided: reset LINKED pair hashes on override save, so a changed rate does not show a false Mismatch.

**#57, #58, #59, #105 (low risk)**
- #57: one end-to-end test, sync check, link, drift, resolve, create, orphan, relink, with `globalThis.fetch` throwing.
- #58: jsdom plus testing-library. Keyboard tests for toolbar, rows, create and diff modals, Matches actions. Written manual walkthrough recorded in the issue.
- #59: README sections listed in step 4D.
- #105: extend the no-literals test.

## Cross-cutting rules

- **Partial failure:** a remote write that succeeded is never reported as a failure. Otherwise the user retries and creates a duplicate.
- **Unique indexes:** `matches_user_wallos_unique` and `matches_user_actual_unique` block double links. Map violations to 409, or to `linked: false` after a remote create. Never 500.
- **Tenant scope:** all reads and writes go through `createUserRepo(db, userId)`. Never add to `lookup.ts` or `accounts.ts` (`exports.test.ts` pins them). Match ids, override keys and Wallos ids from the client are untrusted.
- **Secrets:** no new secret columns. Wallos calls keep `api_key` as a form field. Errors use fixed codes through `sendFailure`. Names returned by Wallos are not logged.
- **Migrations:** no planned issue needs a schema change. Any migration comes from `npm run db:generate`, never by hand, and must pass `npm run db:check`.
- **Compatibility:** create responses gain fields and lose none. New request fields are optional.
- **Live writes:** only the #29/#30 check touches real services, and only in the `test/` environment.
- **Git:** work stays on `m7-sync-dashboard`. Nothing is pushed and no PR is opened without an instruction.
- **Rules to keep:** no `drizzle-orm` imports outside `db/`; default-deny `/api` routes.

## Verification (every task)

```
npx tsc --noEmit && npm run typecheck
npm run lint
npm test
npm run build
npm run db:check
```

Single area: `npx vitest run <path>`. Review each task's raw `git diff` against its acceptance check before closing the issue.

## How to resume

1. Decide vitest-axe. Update the Decisions and Open questions sections of this file.
2. Start Phase 0 and step 2A. Use the progress panel for the run.
3. Check the status table against `gh issue list --state open` before starting; issues may have changed.

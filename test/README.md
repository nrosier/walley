# Local test environment

Throwaway Wallos and Actual Budget containers for testing Walley.
The scripts create no accounts and store no credentials. You set those up in the browser.

## Prerequisites
- Docker with the compose plugin, and a running daemon
- curl

## Start
    test/start-test-env.sh
Creates `test/.local/` if missing, starts both containers and waits up to 60 seconds for each URL.
Then create the Wallos account and the Actual budget in the browser and enter the URLs and credentials in Walley Settings.

## Stop
    test/stop-test-env.sh
Stops the containers and keeps the data.

## Wipe
    test/stop-test-env.sh --wipe
Stops the containers, then deletes `test/.local/` after a confirmation prompt.

## Ports (localhost only)
- Wallos: 8282 (container 80)
- Actual Budget: 5006 (container 5006)
- Walley dev: 5173 (web), 3000 (API), so no clash

## Seed test data
`scripts/seed-test-data.ts` fills the test containers with an invented set of subscriptions and
schedules that covers every match, create and link case and every schedule interval (issue 119).
It reads `WALLOS_URL`, `WALLOS_API`, `ACTUAL_URL` and `ACTUAL_PASSWORD` from `.env.test` in the
repo root (git-ignored, format `KEY: value`). Add `ACTUAL_BUDGET_ID` only when the Actual server
holds more than one budget. No value is printed or committed.

Safety: the script exits before any request unless the Wallos URL is `http://localhost:8282` or
`http://127.0.0.1:8282` and the Actual URL is `http://localhost:5006` or `http://127.0.0.1:5006`
(`scripts/seed/guard.ts`). It cannot reach a live account.

Run, dry run first:

    npm run seed:test-data -- --dry-run     # reads both instances, writes nothing, prints the plan
    npm run seed:test-data                  # writes

Repeatable: every seeded name starts with `[seed]`. A rerun looks each name up and creates only what
is missing. An existing seeded item is changed only when its amount, currency, interval, start date
or inactive flag differs from the seed, and the report names the differing field. A different Wallos
next payment is reported, not rewritten (Wallos moves it forward itself). Items without the tag are
never touched.

The set is defined as data in `scripts/seed/coverage.ts`, with at least two items per category;
`scripts/seed/coverage.test.ts` fails if a category or interval loses its items (it makes no network
call). Dates assume a "today" near 2026-10-28; edit the dates in that file when they age.

| Group | Categories |
| --- | --- |
| Match | exact name and amount; fuzzy name only; amount within tolerance; amount outside tolerance; already linked; ignored on the Wallos side; ignored on the Actual side; orphaned after the counterpart is deleted |
| Create | Wallos subscription with no Actual schedule, in the base currency (EUR) and in a foreign currency (USD, GBP, JPY); Actual schedule with no Wallos subscription, in the base currency and recorded in EUR for a foreign-priced service |
| Link | one candidate; several candidates; no candidate |
| Intervals | weekly, monthly, yearly, custom days, each with a start date and a next payment date; some Wallos items are inactive |

The seed writes only to Wallos and Actual. Walley's own state cannot be seeded, so after seeding do
these in Walley: link the "already linked" pairs, ignore the "ignored" items on their side, and for
the "orphaned" pairs link them and then delete one side in Wallos or Actual (`walleyStep` in the data
says which). An Actual budget has a single currency, so "foreign" Actual schedules are foreign-priced
services recorded in EUR.

# src/server/matching

Server side of match detection. Pure matching rules live in `src/lib` (`name-match.ts`, `amount-match.ts`, `match-fields.ts`, `match-badge.ts`).

- `hash.ts`: `sha256Hex(canonicalString)` via `node:crypto`, and `hashMatchFields(input)` (null for pattern schedules). Values go to `matches.last_known_wallos_hash` and `last_known_actual_hash`.
- `hash.test.ts`: tests for `hash.ts`.

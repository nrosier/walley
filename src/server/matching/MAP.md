# src/server/matching

Server side of match detection. Pure matching rules live in `src/lib` (`name-match.ts`, `amount-match.ts`, `match-fields.ts`, `match-badge.ts`).

- `hash.ts`: `sha256Hex(canonicalString)` via `node:crypto`, and `hashMatchFields(input)` (null for pattern schedules; name case ignored, as `normalizeMatchFields` lowercases it). Values go to `matches.last_known_wallos_hash` and `last_known_actual_hash`.
- `hash.test.ts`: tests for `hash.ts`.
- `engine.ts`: `classifySavedPairs(savedMatches, wallosIds, actualIds)`, pure. Classifies saved pairs as `linked`, `orphaned_wallos`, `orphaned_actual` or `orphaned_both` (computed, not stored), preserves ignored rows, and lists unlinked Wallos and Actual ids.
- `engine.test.ts`: tests for `engine.ts`.
- `mismatch.ts`: `detectMismatches(savedRows, currentByWallosId, currentByActualId)`, pure. Hashes with `hashMatchFields` (name case is ignored in the shared canonical form). Per LINKED or MISMATCH_DETECTED pair returns `nextStatus`, the hashes to store (`wallosHash`, `actualHash`; the stored baseline on drift, the current hash when the stored one was null), the current hashes, drift flags and `baseline`. Skips ignored and orphaned rows; lists pattern schedules in `unmappable`. A mismatch whose drift is gone returns to LINKED.
- `mismatch.test.ts`: tests for `mismatch.ts`.

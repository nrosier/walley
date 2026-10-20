---
name: walley-qa-test-matrix
description: Use when planning or reviewing tests for a Walley issue or milestone, to decide which test types each feature needs. Lists the required unit, route, two-user isolation, mocked integration and failure-path tests for Walley's amount, frequency, auth, matching and diff features.
---

# Walley QA Test Matrix

Use this table to decide what a feature needs. Each row is a minimum. Every test runs offline, with the Wallos and Actual Budget clients mocked. Amounts are integer cents.

| Area | Required tests |
| --- | --- |
| Amount converter | 12.50 becomes -1250; 0.005 rounds to 1 cent; float to cents and back returns the original value |
| Frequency mapper | Round trip for monthly, yearly, weekly and custom_days |
| Encryption | Round trip; tampered ciphertext throws; same plaintext encrypts to different output |
| Auth | 401 on every protected /api route without a cookie; wrong password and unknown email return the same error; 403 on register when registration is disabled; 429 with Retry-After |
| CSRF | 403 on POST, PUT, PATCH and DELETE without the token |
| Tenant isolation | User A cannot read, update or delete user B's configs, matches or sessions |
| Candidate matching | "Netflix Inc." matches "netflix"; 1000 matches 1049 at 5%; 1000 does not match 1060 at 5% |
| Mismatch | Changed Actual amount sets MISMATCH_DETECTED; no change stays LINKED |
| Diff actions | overwrite_wallos, overwrite_actual, ignore_diff and unlink each covered |
| Secrets | Settings responses contain no secret values |

## Failure paths to include

- Wrong input (validation error)
- Missing APP_SECRET
- Upstream Wallos or Actual error
- Upstream timeout

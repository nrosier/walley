# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.5.0] - 2026-11-13

### Added

- Sync Dashboard keyboard help (issue 170): a "Skip to linked pairs" link is the first dashboard stop when linked pairs are shown, screen readers hear the outcome of Link, Create, Ignore, Restore, Unlink, Recreate and Link to another item, and a visible hint explains the arrow keys.

### Changed

- On the Sync Dashboard each row cell is now a single tab stop. Left and Right arrow keys (and Home and End) move between that cell's actions (issue 170).
- After a successful Create in Actual Budget or Create in Wallos, focus moves to the primary action of the next row on that side (or the previous one), instead of the search box. The search box is used only when no other row is left (issue 58).
- The About dialog, the Create modals, the Link dialog, the Unlink confirmation and the Recreate and diff modals are covered by rendered accessibility tests for focus, labels and keyboard use (issue 58).
- Dependency updates: better-sqlite3 13.1.1, nodemailer 10.5.0, lucide-react 1.72.0, tailwindcss and @tailwindcss/vite 4.3.5, vite 8.3.8, jsdom 31.0.1, @vitejs/plugin-react 6.3.0, typescript-eslint 8.72.2, concurrently 10.0.7 and jose 6.2.17, plus a newer Node 26 Alpine base image digest. No user-visible change is expected.

## [0.4.5] - 2026-11-08

### Security

- The runtime image upgrades Alpine `zlib` to 1.4-r0 or later, which fixes CVE-2026-4738 (issue 197).

## [0.4.4] - 2026-11-07

### Added

- Security scan workflow (issue 194, PR 195). On every push and pull request to `main`, on a weekly schedule (Mondays 04:00 UTC) and on manual dispatch, it builds a CycloneDX SBOM with Syft, scans it with Grype, and scans the repository files and the built Docker image with Trivy. SARIF results go to Code Scanning under the categories `grype`, `trivy-fs` and `trivy-image`, the SBOM is kept as a build artifact, and on the scheduled run a High or Critical finding opens or updates a GitHub issue labelled `security`. Report-only: it does not fail the build.

## [0.4.3] - 2026-11-06

### Security

- The runtime Docker image no longer ships npm, npx or corepack. The vulnerable copies of undici, ip-address, brace-expansion, minimatch, glob and postcss-selector-parser flagged by HarborGate lived inside npm's own bundled modules in the Node base image, and Walley never uses them at run time. If you ran npm inside the container, use your own image or `docker run` another image instead.

### Fixed

- Keyboard focus (issue 58 walkthrough): the About dialog and the Create in Actual Budget / Create in Wallos modals now return focus to the control that opened them, and the Create modals start on their first field. Run Sync Check, Test Connection, Load budgets and the Save buttons stay focused while busy (they are `aria-disabled` instead of `disabled`), and Load budgets announces how many budgets loaded. After Confirm on the verify-email page and after Ignore Diff, focus moves to the result or the row instead of the page body. Failed sign-in marks the login fields invalid and points them at the error.
- Keyboard focus (issue 58, N1): after Cancel or Escape on the Unlink confirmation, the Link dialog or the Recreate modals opened from a linked row's More actions menu, focus returns to that row's More actions button instead of the search box. After a confirmed unlink, create or link the row is gone and focus still goes to the search box.
- The primary button focus ring showed white for the first moments in the light theme. It is now always the indigo ring colour.
- The Run Sync Check spinner and the loading skeletons stop animating when the system asks for reduced motion.

## [0.4.2] - 2026-11-06

### Added

- Docker images published to `ghcr.io/nrosier/walley` are now signed with cosign keyless signing. The Docker workflow signs the image digest and verifies the signature before the job ends. The README explains how to verify an image.

## [0.4.1] - 2026-11-06

### Changed

- The Docker image now records the commit it was built from in the standard `org.opencontainers.image.revision` label. The Docker workflow sets it on every build.
- The container base image is now Node.js 26.
- A weekly workflow deletes stale remote branches. It is repository maintenance and has no effect on the app.

## [0.4.0] - 2026-11-02

### Added

- Click the name of a synced item on the Sync Dashboard to see how it is set up on that side: the Wallos subscription, or the Actual Budget schedule. The card is read-only.

### Changed

- Dependency updates for lucide-react, globals, jose, @actual-app/api, cn, openid-client, fastify and @vitejs/plugin-react. No user-visible change is expected.

## [0.3.1] - 2026-10-30

### Changed

- The Sync Dashboard reuses each account's Wallos and Actual data for five minutes, so reloading the page no longer calls both services every time. Run Sync Check and Refresh always fetch fresh data.
- Changes you make directly in Wallos or Actual Budget can take up to five minutes to appear on the dashboard. Saving a Walley action or a Wallos or Actual settings change refreshes the data at once.

## [0.3.0] - 2026-10-30

### Breaking

- The Matches tab and the /matches page are removed. Linked pairs are on the Sync Dashboard; old /matches links now show a Page not found page.

### Added

- A Page not found page for unknown addresses, with a link back to the Sync Dashboard.
- Recreate, Link, Review and Unlink actions on the Sync Dashboard, where the Matches actions used to be.
- A counts line on the Sync Dashboard for linked pairs, with a cue on pairs whose amounts differ.
- A desktop sticky header for the Sync Dashboard columns, from 768px wide.
- An app footer with the version, a copyright line and an About dialog.

### Changed

- The Sync Dashboard runs a sync check when it loads. Run Sync Check stays as a manual refresh.
- Linked pairs and their actions are on the Sync Dashboard grid; below 768px a pane switch shows one side at a time instead of a scrolling table.

## [0.2.3] - 2026-10-30

### Changed

- Payee search in the Create Actual Budget modal is covered by rendered tests for filtering, no-match, selection and keyboard use.

## [0.2.2] - 2026-10-30

### Added

- Payee search in the Create Actual Budget modal, in a searchable popover.

### Fixed

- Linked pairs whose Wallos name contains an HTML entity such as & no longer show as differing after the update. The diff for such a pair shows no changed fields, and the stored baseline is updated silently.

## [0.2.1] - 2026-10-30

### Fixed

- Wallos subscription names with HTML entities such as & are shown and matched by their real name.
- Linked pairs whose Wallos name contains an entity show one mismatch after the update; resolve it with Ignore Diff or Overwrite Actual.

## [0.2.0] - 2026-10-30

### Added

- Favicon for the web app.

### Changed

- Disabled Wallos subscriptions are no longer shown or matched, so they cannot be linked or created in Actual Budget.
- Completed Actual Budget schedules are no longer shown or matched, so they cannot be linked or created in Wallos.
- Linked pairs whose Wallos item is now disabled, or whose Actual schedule is now completed, appear as orphaned.
- Warnings are shown in amber, and errors in red.
- The Docker image publishes `0.x.y`, `0.x` and `latest` tags for each release.

## [0.1.0] - 2026-10-30

### Added

- Multi-user accounts, each with its own Wallos and Actual Budget settings.
- Sign in with email and password, or with a single OpenID Connect button in OIDC mode.
- Local registration with email verification by a single-use link that expires after 24 hours.
- Registration toggle in Settings, controlled by the admins listed in `ADMIN_EMAILS`.
- Encrypted storage of Wallos API keys, Actual Budget passwords and sync keys.
- Wallos subscription and Actual Budget schedule integration, with currency conversion.
- Automatic matching of subscriptions and schedules by name and amount within a set tolerance.
- Sync Dashboard showing unlinked Wallos and Actual items side by side, with Link, Create, and Ignore actions.
- Mismatch detection with a diff modal offering overwrite, ignore, and unlink options.
- Matches view with status badges, showing ignored items on request, and restore for ignored items.
- Settings page for Wallos, Actual Budget, matching tolerance, and account security.
- Light and dark themes, with English and Dutch interface text.
- Docker image and compose example for self-hosting.

### Changed

- Redesigned app shell, Matches table, create dialogs, and login screen.
- Muted text colour adjusted so it meets 4.5:1 contrast on every light surface.

### Fixed

- Keyboard focus ring and sticky Matches header.
- Sync Dashboard no longer shows a stale "not set up" status after saving settings.
- Account settings report a session-expired message instead of failing silently.

### Security

- Per-IP rate limits on sign-in, registration, password change, and email verification.
- Verification tokens are burned after repeated wrong passwords or guesses.
- Trusted proxy addresses are validated, so client IPs cannot be forged past the rate limit.
- Every user data query is scoped to the signed-in user.

[Unreleased]: https://github.com/nrosier/walley/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/nrosier/walley/releases/tag/v0.1.0

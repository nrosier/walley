# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Nothing yet.

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

# Walley Specification

## Overview
Walley is a multi-user web application with a Node.js backend and React frontend designed to view, match, sync, and create recurring subscriptions between Wallos and Actual Budget (AB). Each authenticated user can configure their own independent Wallos and Actual Budget instances.

## Agent Development Commands
- **Build:** `npm run build`
- **Dev:** `npm run dev`
- **Type Check:** `npx tsc --noEmit`
- **Lint:** `npm run lint`

---

## Tech Stack & Project Architecture
- **Language & Runtime:** TypeScript (strict mode), Node.js backend, React (Vite) frontend.
- **UI System:** Tailwind CSS, Radix UI / Shadcn UI primitives, Lucide React icons.
- **Database:** SQLite (`walley.db`) via `better-sqlite3` and Drizzle ORM.
- **Integrations:**
  - `@actual-app/api` (runs **strictly** on the Node.js backend, isolated per user sync execution).
  - Wallos REST API (`/api/subscriptions`).
  - SMTP via `nodemailer` (local registration only: verification and already-registered mail, sent from `MAIL_FROM` through `SMTP_URL`; the URL can hold credentials and is never logged).

---

## Look & Feel Guidelines (Actual Budget UI Alignment)

### 1. Color Palette & Dark Mode Support
- **Light Theme:**
  - Background: Clean off-white/light gray (`#f8fafc` / `#f1f5f9`).
  - Cards/Panels: Pure white (`#ffffff`) with subtle 1px borders (`#e2e8f0`).
  - Primary Accent: Actual Budget Purple/Indigo (`#6366f1` / `#4f46e5`).
  - Text: Dark charcoal (`#0f172a` for headers, `#334155` for body).
- **Dark Theme (Default):**
  - Background: Dark charcoal/slate (`#0c0f19` / `#111827`).
  - Cards/Panels: Dark slate (`#1e293b` / `#182232`) with muted borders (`#334155`).
  - Text: Soft white/light gray (`#f8fafc` / `#cbd5e1`).
- **Status Badges:**
  - Matched/Linked: Soft muted green pill badge.
  - Mismatch: Soft muted amber/orange pill badge.
  - Ignored/Unlinked: Neutral gray pill badge.

### 2. Typography & Layout Density
- **Font Stack:** System sans-serif stack (`Inter`, system-ui, `-apple-system`).
- **Density:** Compact padding (`py-1.5 px-3` for table cells), sharp readable text (`text-xs` to `text-sm`), monospaced alignment for numerical amounts (`font-mono`).

---

## Multi-User Authentication & Secrets Management

### 1. App Authentication
- Multi-user authentication support.
- Walley runs in exactly one auth mode, chosen at startup from environment variables:
  - **OIDC mode:** all four of `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `OIDC_CALLBACK_URL` are set. OIDC is the only way to sign in. Local password login, local registration and password change are disabled, and their endpoints return `403` with error code `local_auth_disabled`.
  - **Local mode:** none of the four OIDC variables is set. Local password auth (Argon2id hashing). Local registration is allowed only when `ALLOW_REGISTRATION=true` (default `false`) and mail is configured (`SMTP_URL` and `MAIL_FROM` set). Otherwise it returns `403` with error code `registration_disabled`. The register form does not sign the user in: every outcome returns `202` with `{"status":"verification_sent"}` and no cookie, and the user must follow the emailed link to `POST /api/auth/verify-email` (`204` on success, `400` `invalid_token` otherwise; tokens expire after 24 hours). Login returns `401` `invalid_credentials` until the email is verified.
  - Setting some but not all of the four OIDC variables is a configuration error. Startup fails with a message that names the missing variables and prints no values. An empty value counts as unset.
- OIDC maps `(issuer, subject)` to an internal user through the `user_identities` table. On each OIDC login:
  1. A known `(issuer, subject)` signs in the mapped user.
  2. Otherwise, if the ID token has `email_verified: true` and its email matches an existing user (case-insensitive) who has no identity at this issuer, Walley links the identity to that user and signs them in. This is how local accounts move to OIDC.
  3. Otherwise, if `ALLOW_REGISTRATION=true`, Walley creates a new user with no password and links the identity.
  4. Otherwise sign-in is refused, and the login page says that no Walley account is linked to the identity.
- `ALLOW_REGISTRATION` means "new accounts may be created": through the register form in local mode (which also needs mail configured), and through a first OIDC login in OIDC mode.
- Linking keeps the user's `id` and `key_salt`, so their encrypted credentials stay readable. The password hash is kept but is not used while OIDC mode is on.
- Secure, HTTP-only cookie-based session management (`user_id` bound). Each session records how it was created (`local` or `oidc`). A session whose method does not match the current mode is treated as no session.
- The login page reads the mode from the public `GET /api/auth/config` endpoint. It shows either the email and password form or a single "Sign in with SSO" button, never both.

### 2. Secrets Encryption (Per User)
- Each user's Wallos API credentials, Actual Budget passwords, and sync keys must be stored in the database encrypted at rest using AES-256-GCM.
- Encryption key derived from a server-level master key (`APP_SECRET` env var) combined with user-specific salt/context.

---

## Data Integration & Mapping Rules

### 1. Multi-Tenant Database Schema (`walley.db`)
- `users`: `id`, `email` (unique, stored lowercased), `password_hash` (nullable; null for users created through OIDC), `email_verified_at` (nullable; null until the local email link is followed or an OIDC link verifies the email), `key_salt`, `created_at`
- `email_verifications`: `id` (primary key, 64 characters; the SHA-256 of the verification token), `user_id` (FK, cascade on delete, indexed), `expires_at` (24 hours after issue)
- `user_identities`: `id`, `user_id` (FK), `issuer`, `subject`, `created_at`; unique `(issuer, subject)` and unique `(user_id, issuer)`
- `sessions`: `id` (primary key, 64 characters; the SHA-256 of the session token), `user_id` (FK, cascade on delete, indexed), `auth_method` (`local` | `oidc`), `csrf_hash` (64 characters; the SHA-256 of the CSRF token), `created_at`, `last_seen_at`, `expires_at`
- `user_configs`: `user_id` (FK), `wallos_url`, `wallos_api_key_enc`, `actual_url`, `actual_password_enc`, `actual_sync_key_enc`, `actual_budget_id`, `tolerance_percent`
- `matches`: `id`, `user_id` (FK), `wallos_id`, `actual_schedule_id`, `status` (`LINKED` | `IGNORED_WALLOS` | `IGNORED_ACTUAL`), `last_known_wallos_hash`, `last_known_actual_hash`

### 2. Actual Budget Integration (`@actual-app/api`)
- Executes server-side in Node.js per request/user session.
- Downloads and opens the specific user's Budget ID using their decrypted credentials.
- Pulls Schedules, Accounts, Payees, Categories, and Target Base Currency.
- **Amounts:** Actual Budget stores values in integer cents (e.g., €12.50 = `-1250`). Always convert between float and integer cents in the backend layer.

### 3. Wallos Integration
- Interacts via Wallos REST API (`/api/subscriptions`) using the authenticated user's target URL and API key.
- Converts multi-currency entries to the AB target base currency using Wallos's rate conversion outputs or manual user overrides.

### 4. Bidirectional Frequency Mapper (`src/lib/frequency-mapper.ts`)
- Explicitly translate Wallos interval types (`monthly`, `yearly`, `weekly`, `custom_days`) to/from Actual Budget recurrence rules (`rrule` / schedule frequency objects).

### 5. Matching & Diff Engine
- All queries **must** be scoped to `where user_id = current_user_id`. The only exceptions are the read-only sign-in lookups in `src/server/db/lookup.ts` and `createUser` in `src/server/db/accounts.ts`, which creates a user before any `user_id` exists.
- **Heuristics:**
  - Auto-link existing pairs by saved `wallos_id` <-> `actual_schedule_id`.
  - Suggest candidates via normalized fuzzy name matching (Payee vs Subscription title) and approximate currency amounts (within configurable tolerance, e.g., ±5%).
- **Mismatch Detection:**
  - Compare current field values against stored hashes on manual sync trigger.
  - Set status to `MISMATCH_DETECTED` on drift.
  - Present diff modal with explicit options: `[Overwrite Wallos]`, `[Overwrite Actual]`, `[Ignore Diff]`, `[Unlink]`.

---

## UI Views & Navigation

### Navbar / Header
- App title ("Walley") in Actual Budget bold styling.
- Tab Navigation (`Sync Dashboard`, `Matches`, `Settings`).
- Action controls: Manual Refresh button, Theme Toggle (Light/Dark), User Account / Logout button.

### 1. Sync Dashboard (Dual-Pane View)
- Controls: Search filter, "Show Ignored Items" toggle, "Run Sync Check" trigger.
- **Left Column:** Unlinked Wallos Subscriptions (`[Link]`, `[Create in AB]`, `[Ignore]`).
- **Right Column:** Unlinked Actual Budget Schedules (`[Link]`, `[Create in Wallos]`, `[Ignore]`).

### 2. Matches & Linked Subscriptions View
- Table of confirmed synced pairs scoped to current user with status badges (`Synced`, `Mismatch`).
- Toggle to display ignored items with a single-click `[Restore / Unignore]` action.

### 3. Pre-fill Creation Modals
- **Create Actual Schedule from Wallos:** Pre-fills converted amount, mapped frequency/rrule, payee dropdown (selectable or create new), category dropdown.
- **Create Wallos Subscription from AB Schedule:** Pre-fills title, converted price, billing cycle, start date.

### 4. Settings Page (Per-User Configuration)
- Personal Wallos Config (URL, API Key, Test Connection button).
- Personal Actual Budget Config (Server URL, Password/Sync Key, Budget Selector dropdown, Base Currency auto-detect).
- Matching Settings (Amount Tolerance Percentage input/slider).
- Account / Security Settings (Password update in local mode only; in OIDC mode, a note that the password is managed by the identity provider. Linked OIDC issuer and subject when present.)

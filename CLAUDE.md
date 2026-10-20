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
- Local password auth (Argon2id hashing) with option to enable/disable local user registration in settings/env.
- OIDC integration (Issuer, Client ID, Client Secret, Callback URL) mapping external subject IDs to internal user records.
- Secure, HTTP-only cookie-based session management (`user_id` bound).

### 2. Secrets Encryption (Per User)
- Each user's Wallos API credentials, Actual Budget passwords, and sync keys must be stored in the database encrypted at rest using AES-256-GCM.
- Encryption key derived from a server-level master key (`APP_SECRET` env var) combined with user-specific salt/context.

---

## Data Integration & Mapping Rules

### 1. Multi-Tenant Database Schema (`walley.db`)
- `users`: `id`, `email`, `password_hash`, `created_at`
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
- All queries **must** be scoped to `where user_id = current_user_id`.
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
- Account / Security Settings (Password update, OIDC identity details).

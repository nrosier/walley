# Walley UI/UX Spec

Status: draft, owner decisions applied. Rule set: `docs/ui/UI-UX_GUIDELINES.md`. Visual identity: `CLAUDE.md` (Look & Feel, UI Views). Existing UI: `src/web/MAP.md`.

Where this spec and the guide conflict, the conflict and the owner's decision are listed in section 10. Every place the body applies a decision is tagged `[D-x decided: <answer>]`. Copy not found in `src/web/**/*.messages.ts` or `CLAUDE.md` is tagged `[approved, not yet in messages files]`; the strings must be added to the `*.messages.ts` files when the feature is built.

## 1. Scope and goals

Walley is a sync and matching tool for Wallos subscriptions and Actual Budget (AB) schedules. It is not a planner or chart app. No charts, no overview dashboard of metrics.

| Screen | Route | A user must be able to |
| --- | --- | --- |
| Sync Dashboard | `/sync` (also `/`) | Run a sync check, see unlinked Wallos subscriptions (left) and AB schedules (right), search, show ignored items, Link, Create in AB / Create in Wallos, Ignore, Restore |
| Matches | `/matches` | See linked pairs with status, spot a Mismatch, open the diff modal, show ignored items, Restore |
| Settings | `/settings` | Configure Wallos (URL, API key, Test connection), Actual Budget (URL, password / sync key, load and pick budget, see base currency), matching tolerance, language, password (local mode) or OIDC info |
| Login | `/login` | Sign in by email and password (local mode) or by a single "Log in with OpenID" button (OIDC mode); register when enabled |
| Verify email | `/verify-email#token=...` | See verifying, success, invalid, disabled, missing or error, and reach sign-in |
| Create modals | opened from Dashboard rows | Review pre-filled values, adjust, create the item in the other system |
| Diff modal | opened from a Mismatch row in Matches | See drifted fields side by side, choose Overwrite Wallos, Overwrite Actual, Ignore Diff or Unlink |

Out of scope: new data features, new routes, backend changes.

## 2. Information architecture

One level of navigation. No rail, no drawer, no menus beyond the account menu. Goal-based groups are not needed with three destinations.

```
Header:  Walley (bold) | Sync Dashboard  Matches  Settings | [Refresh] [Theme] [Account v]
```

- App title "Walley": bold, text, links to `/sync`.
- Tabs are route links (`<a href>`, `aria-current="page"`), not `role="tab"`. Labels: Sync Dashboard, Matches, Settings (from `AppShell.messages.ts`).
- Refresh: label "Refresh" with icon (`AppShell.messages.ts`). [approved, not yet in messages files; behaviour not in the code today: on `/sync` it runs the sync check; elsewhere it reloads the page data.] Disabled and labelled "Checking..." while running.
- Theme toggle: switches light/dark; canonical copy also lives in Settings > General as "This device" (guide section 3.3). One source of truth: `walley-theme` in localStorage.
- Account menu: trigger shows the user email; one dropdown level with "Log out".
- Page title: each page has one `<h1>` and the document title names feature and subject, for example "Matches - Walley". Walley has no record subject, so feature plus app name is the pattern.
- Login and Verify email render without the header.

Routes (path router, existing): `/sync`, `/matches`, `/settings`, `/login`, `/verify-email`. Unknown paths go to `/sync`. No new routes. Settings sections are in-page anchors, not routes (see 3.3).

State that survives reload: theme and language (device), search text and "Show Ignored Items" (page state, not persisted, reset on reload), last sync result (in memory only; Dashboard never checks on mount).

## 3. Layout and hierarchy per screen

Page order (guide section 5): h1, context line, inputs and primary action, status, results, secondary actions.

### 3.1 Sync Dashboard

```
+--------------------------------------------------------------------------+
| Walley   Sync Dashboard  Matches  Settings        Refresh  Theme  me@x v |
+--------------------------------------------------------------------------+
| Sync Dashboard                                                           |
| [D-e decided] Last check: 14:32 - 12 Wallos unlinked - 9 Actual unlinked |
| [Search by name______]  [ ] Show Ignored Items        [ Run Sync Check ] |
+------------------------------------+-------------------------------------+
| Wallos subscriptions (12)          | Actual Budget schedules (9)         |
| ---------------------------------- | ----------------------------------- |
| <name>             <amount mono>   | <name>              <amount mono>   |
|  monthly   [Link v][Create in AB]  |  monthly  [Link v][Create in Wallos]|
|            [Ignore]                |           [Ignore]                  |
| ...                                | ...                                 |
+------------------------------------+-------------------------------------+
```

- Primary action: Run Sync Check (indigo filled, right of the toolbar). One primary per screen.
- Toolbar is a labelled group ("Sync controls"): search, switch, run.
- Each column has a heading with count and its own list; columns do not scroll independently of the page (one page scroll), sticky column headings.
- Row: name, amount (`font-mono`, right aligned), cycle text, optional "range" flag (hint: "Amount is the midpoint of a range"), unmappable reason text when present. Actions: Link (picker only when candidates exist), Create in AB / Create in Wallos, Ignore. Ignored rows (when shown) show a gray Ignored badge and Restore instead of the three actions.
- Create buttons are currently held ("Held: creating items arrives in a later release."). Held state: disabled with the reason shown next to it, not a tooltip alone.
- Last-check line is [approved, not yet in messages files] copy [D-e decided: add it]; it needs the check timestamp (UI-only, held in the shared store).

### 3.2 Matches

```
| Matches                                                                  |
| [D-e decided] 8 linked - 2 mismatch        [ ] Show ignored items         |
+--------------------------------------------------------------------------+
| Wallos subscription | Wallos amount | Actual Budget schedule | Actual amt | Status    | Action |
|---------------------|--------------:|------------------------|-----------:|-----------|--------|
| <name>              |     12,50 EUR | <name>                 |   12,50    | (Synced)  |        |
| <name>              |     10,00 EUR | <name>                 |    9,00    | (Mismatch)| Review |
+--------------------------------------------------------------------------+
| Ignored items (when toggled)                                             |
| Item | Side | Amount | (Ignored)                             [Restore]    |
```

- Table, compact density [D-b decided: compact for Dashboard and Matches], sticky header, numeric columns right aligned with tabular numerals, em dash for a missing side.
- Status column uses `StatusBadge` (Synced green, Mismatch amber, Ignored gray, Orphaned gray with amber border and icon).
- "Review" opens the diff modal; shown only on Mismatch rows. Whole row is not clickable; the button is.
- Ignored items are a second section below, not mixed into the linked table.
- Narrow widths: table scrolls horizontally inside a labelled container (see section 7).

### 3.3 Settings

```
| Settings                                                                  |
| [General] [Wallos] [Actual Budget] [Matching] [Account]   (in-page anchors)|
+--------------------------------------------------------------------------+
| General - This device                                                    |
|   Language [English v]    Theme [Dark | Light]                            |
| Wallos - Your account                                                    |
|   URL [____________]  API key [write-only, "Saved"]                      |
|   [Test connection]  status line                         [Save Wallos]   |
| Actual Budget - Your account                                             |
|   Server URL [____]  Password [____]  Sync key [____] [Clear]            |
|   [Load budgets]  Budget [v]  Base currency: EUR (detected)  [Save]      |
| Matching - Your account                                                  |
|   Amount tolerance [ 5 ] %                                    [Save]     |
| Account / Security                                                       |
|   Local: current / new password [Change password]                        |
|   OIDC: "Your password is managed by your identity provider." Issuer, Subject |
```

- One page, sections in the order above; each section heading carries its scope label ("This device" or "Your account", guide section 4).
- Each section saves on its own button (Save is per section because secrets are write-only and need explicit commit). This is a deliberate exception to "preferences save immediately": credentials and test-connection require an explicit commit. Language and theme save immediately with an inline "Saved" status.
- Secrets are never shown after save; show "Saved" and a Replace / Clear action. Never echo values in errors.
- Section anchor nav: ordinary in-page links on wide screens; one labelled Select on narrow screens (guide sections 5 and 10). Not `role="tab"`.

### 3.4 Create modal (Create Actual schedule from Wallos shown)

```
+----------------------------------------------------+
| Create Actual Budget schedule                  [x] |
| Pre-filled from the Wallos subscription <name>.    |
|----------------------------------------------------|
| Name        [____________]                         |
| Amount (converted)  [ 12.50 ]  mono, right aligned |
| Frequency   Every 1 month   (read-only, mapped)    |
| Start date  [YYYY-MM-DD]                           |
| Payee       (o) existing [v]   ( ) Create new payee|
| Account     [Choose an account v]  required        |
| Category    [No category v]                        |
|----------------------------------------------------|
| status line                      [Cancel] [Create] |
+----------------------------------------------------+
```

- Header and footer pinned; body scrolls. Footer: Cancel (secondary), Create (primary). Create disabled until required fields (account) are valid; reason is shown beside the field.
- "Create Wallos subscription from AB schedule" uses the same shell: Title, Price, Billing cycle, Start date.
- Billing cycle: segmented control only when editable (guide section 6).
- Staged: nothing is written until Create. Cancel, Escape, backdrop discard.
- Partial success (schedule created, category failed): show "The schedule was created, but the category could not be set." as a warning; the modal stays open with Close.

### 3.5 Diff modal

```
+---------------------------------------------------------+
| Review differences                                  [x] |
| <wallos name> (Wallos) and <actual name> (Actual Budget)|
| no longer agree.                                        |
|---------------------------------------------------------|
| Drifted fields                                          |
| Field       | Wallos          | Actual Budget           |
| Amount      | 12.50 (mono)    | 11.00 (mono)            |
| Frequency   | every 1 month   | every 2 months          |
|---------------------------------------------------------|
| error/status region                                     |
| [Unlink]            [Ignore Diff] [Overwrite Wallos]    |
|                                   [Overwrite Actual]    |
+---------------------------------------------------------+
```

- Four options, each with a one-line consequence under or beside it (guide "OptionCards" or button plus hint): Overwrite Wallos (writes AB values into Wallos), Overwrite Actual (writes Wallos values into AB), Ignore Diff (keeps both, stops flagging this drift), Unlink (stop tracking the pair; both items stay).
- Hierarchy: Ignore Diff is the safe default action (secondary). Overwrite buttons are the two data-changing actions: neutral style with a text consequence, not red. Unlink is destructive-styled (outline with text plus icon, not colour only), placed away from the overwrites.
- Overwrite and Unlink each open an AlertDialog confirm that names the object and consequence. Ignore Diff does not confirm. Focus returns to the originating "Review" button after close.
- Server error codes map to fixed messages (`overwriteErrors`); show in the modal's alert region and keep the modal open.

### 3.6 Login and Verify email

- Centered single card (max width 24rem), title "Walley", one h1.
- Local mode: email, password, Sign in (primary), optional Register toggle. OIDC mode: only "Log in with OpenID". Never both (CLAUDE.md).
- Errors (`?error=` codes, invalid_credentials, local_auth_disabled, no linked account) show in a `role="alert"` region above the primary button; entered email is preserved, password cleared.
- Register success always shows the same "verification sent" notice (server returns the same 202 for every outcome; do not reveal whether the email exists).
- Verify email: one status panel (verifying, success, invalid, disabled, missing, error) plus a sign-in link. Verifying uses `role="status"`; failures use `role="alert"`.

## 4. Components and states

### 4.1 Status badges

Pill, `text-xs`, icon optional, always a text label (colour is never the only signal).

| Badge | Label | Style | Notes |
| --- | --- | --- | --- |
| Synced / Linked | Synced | soft green (`--success`, `--success-bg`) | |
| Mismatch | Mismatch | soft amber (`--warning`, `--warning-bg`) | |
| Ignored | Ignored | neutral gray (`--neutral`, `--neutral-bg`) | |
| Orphaned | Orphaned | gray fill, amber border, unlink icon | computed, not stored |

### 4.2 Dual-pane item row

States: default, hover, focus-within, busy (action in flight, row actions disabled, label stays), error (inline "Could not update {name}." with Retry via repeating the action), ignored (badge plus Restore), unmappable (reason text, Link/Create disabled with the reason beside them), held (Create disabled with reason).
Optimistic update with per-row rollback is existing behaviour and is kept; on rollback announce the error in the row's status region.

### 4.3 Screen states

| Screen | Loading | Empty | Zero-result | Error | Success |
| --- | --- | --- | --- | --- | --- |
| Dashboard | Before first check: idle text "Run a sync check to see unlinked items." While running: skeleton rows in both columns, run button "Checking...", region `aria-busy`, previous result kept and marked stale | "Nothing to link here." with the check time (valid zero: the check succeeded) | "No items match your search." plus "Clear search" [approved, not yet in messages files] | Alert "The sync check failed." plus cause and "Retry" [approved, not yet in messages files] (see 4.4) | Row action: row moves out of list, focus goes to the next row, polite announcement "{name} linked" |
| Matches | Table skeleton with final column geometry | "No linked pairs yet. Run Sync Check on the Sync Dashboard to load them." with a link to `/sync` | Ignored toggle on with none: "No ignored items." | Alert with "Retry" [approved, not yet in messages files] | Restore: row leaves ignored list, announcement |
| Settings | Field skeletons per section | not applicable (forms always render) | not applicable | Inline error beside field; section-level alert for network errors; entered values preserved | Inline "Saved" status (`role="status"`), no toast |
| Create modal | "Loading the pre-fill..." with skeleton fields | not applicable | not applicable | Alert in footer region; inputs preserved; Create re-enabled | "Created." then close, announce on the Dashboard |
| Diff modal | Buttons show "Working..." [approved, not yet in messages files] per action, others disabled | not applicable | not applicable | Mapped message from `overwriteErrors`; modal stays open | Close, row badge updates, sync result refreshed |
| Login | Button "Signing in..." [approved, not yet in messages files] | not applicable | not applicable | Alert above button | Navigate to `/sync` |
| Verify email | "Verifying..." status [approved, not yet in messages files; existing copy is "Confirming your email address..."] | "missing token" state | not applicable | invalid / error states with sign-in link | success state with sign-in link |

### 4.4 Unhappy paths (required copy and behaviour)

| Case | Behaviour |
| --- | --- |
| Sync failure (Wallos or AB unreachable, timeout) | Dashboard shows `role="alert"` "The sync check failed." plus which side failed when known (Wallos or Actual Budget), a "Retry" button [approved, not yet in messages files], and a link "Check settings" [approved, not yet in messages files] to `/settings`. Last good result stays visible, marked stale, with its check time |
| Invalid credentials (Wallos key, AB password, wrong budget) | Settings: field-level error beside the failing field after Test connection or Load budgets; no value echoed. Dashboard: the sync failure alert names the side and links to the matching Settings section. Copy is a new `*.messages.ts` entry in en and nl (needs server error codes confirmed; **open item for engineer**) |
| Not configured | First-use empty state on Dashboard: "Set up Wallos and Actual Budget to start" [approved, not yet in messages files] with a primary link to `/settings` (prerequisite check from config presence) |
| Offline (browser) | Persistent notice under the header: "You are offline. Sync and saving need a connection." [approved, not yet in messages files] Run Sync Check, Save, Create, Overwrite, Test connection disabled with that reason; search, toggles, theme, language still work. Cleared on `online` event |
| Session expired (401) | Existing behaviour: go to `/login`, keep the query |
| Action error (Link, Ignore, Restore) | Row-level error, rollback, focus stays on the row |
| Drift resolved elsewhere (`invalid_state`, `match_not_found`) | Mapped diff-modal message with "Run the sync check again" |

Status component: a single `StatusMessage` primitive: `role="status"` (polite) for progress and success, `role="alert"` for blocking failures, `aria-busy` on the updating region. [NEW]

## 5. Tokens

Current tokens live in `src/web/index.css` and are mirrored in `src/web/lib/palette.ts` (contrast tests read that mirror). Values below are the CLAUDE.md hex values, which already match the code. The first column shows the target names (the guide's `--bg`, `--surface`, `--line`, `--muted`); the second column shows the current code names. [D-c decided: rename to the guide's names with the CLAUDE.md hex values. FOLLOW-UP: the rename across `src/web` (`index.css`, `palette.ts`, tests, primitives) is not part of this spec change.]

### 5.1 Colour

| Token (target, D-c) | Current code name | Dark (default) | Light |
| --- | --- | --- | --- |
| `--bg` | `--background` | `#0c0f19` | `#f8fafc` |
| `--surface` | `--card` | `#182232` | `#ffffff` |
| `--line` | `--border` | `#334155` | `#e2e8f0` |
| `--text` | `--foreground` | `#f8fafc` | `#0f172a` |
| `--muted` | `--muted-foreground` | `#cbd5e1` | `#334155` |
| `--accent` | `--primary` | `#4f46e5` | `#4f46e5` |
| `--on-accent` | `--primary-foreground` | `#ffffff` | `#ffffff` |
| `--accent-text` | `--accent-text` | `#6366f1` | `#4f46e5` |
| `--focus` | `--ring` | `#6366f1` | `#6366f1` |
| `--success` / `--success-bg` | same (no rename) | `#86efac` / `rgb(34 197 94 / 0.15)` | `#166534` / `#dcfce7` |
| `--warning` / `--warning-bg` | same (no rename) | `#fcd34d` / `rgb(245 158 11 / 0.15)` | `#92400e` / `#fef3c7` |
| `--neutral` / `--neutral-bg` | same (no rename) | `#cbd5e1` / `rgb(148 163 184 / 0.15)` | `#475569` / `#f1f5f9` |

Tokens to add under the new names [D-c decided]: `--danger`, `--danger-bg` (Unlink and destructive confirm, error alerts), `--info`. Today there is no error colour token; alerts need one. Their values are not fixed by any source: the implementer chooses CLAUDE.md-consistent slate/red values and extends the contrast test. **Open item (values only).**

Both themes must meet WCAG AA text contrast (4.5:1 text, 3:1 UI components and focus ring); existing `contrast.test.ts` extends to new tokens. Dark is the default; `color-scheme` bound to `data-theme` (already done).

### 5.2 Type

Font: `Inter, system-ui, -apple-system, sans-serif`. Amounts: `font-mono`, tabular numerals, right aligned.

| Token | Size / line | Use |
| --- | --- | --- |
| `--text-xs` | 12 / 16 | badges, table cells, helper text |
| `--text-sm` | 14 / 20 | body, controls, buttons |
| `--text-base` | 16 / 24 | modal body, login |
| `--text-lg` | 18 / 28 | section headings |
| `--text-xl` | 20 / 28 | page h1 |
| weights | 400, 500, 600; app title 700 | |

Sizes match the scale CLAUDE.md names (`text-xs` to `text-sm`); they are defined as plain CSS custom properties [D-a decided: Tailwind removed]; no larger scale is needed.

### 5.3 Spacing, radius, border, focus

| Token | Value | Use |
| --- | --- | --- |
| spacing unit | 4px grid: 4, 8, 12, 16, 24, 32 | all layout spacing |
| `--cell-pad` | `py 6px, px 12px` (`py-1.5 px-3`) | table cells, list rows [D-b decided: compact for Dashboard and Matches; standard for Settings, Login, Verify-email and modals] |
| `--control-h` | 32px compact (desktop, Dashboard and Matches) [D-b decided]; 44px on touch [D-d decided: coarse pointer and narrow layouts only] | inputs, buttons, selects |
| `--radius` | 6px (cards, inputs, buttons); `--radius-pill` 9999px (badges) | |
| `--border-width` | 1px, `--line` colour | cards, panels, inputs, table row dividers |
| `--focus-ring` | 2px solid `--focus`, 2px offset | every interactive element, `:focus-visible` |
| motion | 120ms ease for hover/focus/open; none under reduced motion | |
| `--elevation-modal` | one shadow for dialogs and menus only | |

Radius, control height and motion values are consistent with a compact Actual-style UI; the owner confirms them with the token pass (no source in CLAUDE.md or the code fixes them). Every other value above is from CLAUDE.md or `index.css`.

## 6. Accessibility

- Landmarks: `<header>` with `<nav aria-label="Main">`, one `<main>`, skip link "Skip to content" [approved, not yet in messages files] as first focusable element.
- Dashboard keyboard order: skip link, header nav (title, tabs, Refresh, Theme, Account) > search > Show Ignored Items switch > Run Sync Check > Wallos column (rows top to bottom; within a row: Link, Create in AB, Ignore) > Actual column (same). DOM order equals visual order; columns are two lists, each a `<section aria-labelledby>`. After Link or Ignore, focus moves to the next row's first action (existing behaviour); if the list empties, focus moves to the column heading (`tabindex=-1`).
- Row actions have unique accessible names including the item: "Link {name} to", "Ignore {name}", "Restore {name}".
- Modals (Radix Dialog / AlertDialog, existing `components/ui/dialog.tsx`): accessible title and description, focus trap, initial focus on the first field (Create) or on the heading's safest action (Diff: Ignore Diff), Escape closes unless an action is in flight, focus returns to the trigger. Confirm dialogs stack: Escape closes the top one only and returns focus to the diff modal button that opened it.
- Badges carry text. Range flag carries text "range". Amount differences in the diff table are marked with text (a "differs" marker via visually hidden text), not only colour.
- Inputs: every input has a visible `<label>` bound by `for`/`id`; help and errors via `aria-describedby`; invalid fields `aria-invalid="true"`; units stated before entry (for example "%", currency code). Required state is stated in text. Secrets: label plus "Saved" state text.
- Tables: `<caption>` or `aria-label`, `<th scope>`, sortable columns not required.
- Live regions: `role="status"` for progress and success, `role="alert"` for failures; row-level changes announced.
- Reduced motion: respect `prefers-reduced-motion: reduce`; skeleton shimmer and open/close transitions become static or instant.
- Focus ring visible in both themes (`--focus` on `--bg` and `--surface` meets 3:1; verify in the contrast test).
- Zoom to 200% without horizontal scroll of the page (tables scroll in their container).

## 7. Responsive

Breakpoints are not defined in CLAUDE.md or the code beyond the framework defaults being removed (D-a). This spec uses the guide's test sizes.

- Minimum width for the dual-pane layout: 768px (tablet portrait) and above [D-d decided: the 768px breakpoint stands]. Verify 768x1024, 1280x800, 1440x900, 3440x1440.
- Below 768px (verify 390x844 and 430 wide):
  - Dashboard columns stack: Wallos first, then Actual, each with its heading and count; or a two-option segmented control "Wallos | Actual Budget" shows one list at a time (recommended; keeps the first screenful short). The control is a labelled radio group, not tabs.
  - Toolbar wraps: search full width, switch and Run Sync Check on the next line; Run Sync Check stays visible (sticky bottom action bar with safe-area padding is NOT used; the toolbar scrolls with the page).
  - Header: tabs stay as links in one row if they fit; otherwise collapse to a labelled Select "Main" (never a scrolling tab row). Refresh and theme stay as icon buttons with accessible names; account menu stays.
  - Matches table scrolls horizontally inside a labelled container, first column sticky; Status and Review stay reachable.
  - Settings section nav becomes a labelled Select.
  - Modals become full-screen sheets with pinned header and footer; body scrolls; padded with `env(safe-area-inset-*)`.
  - Controls return to 44px height on coarse pointers and narrow layouts [D-d decided].
- Above 1440: content max width 1440px centered for the Dashboard and Matches; Settings and Login keep a narrow measure (about 68ch for prose, 40rem forms).

## 8. Reuse

Source: `src/web/MAP.md`. Primitive enforcement: no `primitive-enforcement` command found in `package.json`/`CLAUDE.md`; the guide's primitive test (Phase 7) is NEW.

Shadcn UI components are built on Tailwind classes, so they cannot be kept as shipped now that Tailwind is removed [D-a decided]. Recommendation (not an owner decision): build primitives on Radix, styled with the tokens, and treat Shadcn only as a copy source. The KEEP/CHANGE marks below for `components/ui/*` assume this restyle.

| Item | Mark | Notes |
| --- | --- | --- |
| `components/AppShell.tsx` (+ messages) | CHANGE | Add skip link; Refresh label states; narrow-width nav collapse to Select; offline notice slot |
| `components/ui/button.tsx` | KEEP | Add compact size variant, busy state |
| `components/ui/badge.tsx`, `StatusBadge.tsx` | CHANGE | Replace Lucide icons with inline SVG [D-a decided]; removal from `src/web` and `package.json` is a FOLLOW-UP |
| `components/ui/dialog.tsx` | KEEP | Verify focus return and stacked AlertDialog; add full-screen mobile variant |
| `components/dashboard/Toolbar.tsx` | CHANGE | Add last-check line, offline-disabled state, Clear search |
| `components/dashboard/ItemRow.tsx`, `PairList`, `IgnoredSection` | CHANGE | Busy/error row states, held-reason text, narrow layout, column count |
| `components/dashboard/CreateActualModal.tsx`, `CreateWallosModal.tsx`, `create-modal-shared.ts` | CHANGE | Pinned footer, payee as radio cards, partial-success warning, full-screen mobile |
| `components/matches/DiffModal.tsx` | CHANGE | Consequence text per option, button hierarchy, danger style for Unlink, focus return |
| `pages/SyncDashboard.tsx` | CHANGE | Stale-result handling, not-configured empty state, sync-failure side naming |
| `pages/Matches.tsx` | CHANGE | Compact table, sticky header, contained overflow, empty-state link |
| `pages/SettingsPage.tsx` | CHANGE | Scope labels, section anchor nav / narrow Select |
| `pages/WallosSettings.tsx`, `ActualSettings.tsx`, `MatchingSettings.tsx`, `AccountSettings.tsx` | CHANGE | Move to shared Field anatomy, per-field errors, "Saved" status |
| `pages/LoginPage.tsx`, `VerifyEmailPage.tsx` | KEEP | Align error and status regions with `StatusMessage` |
| `components/HealthStatus.tsx` | KEEP | |
| `lib/sync-check.ts`, `matches.api.ts`, `resolve-mismatch.ts`, `api.ts`, `route.ts`, `session.ts`, `theme.ts` | KEEP | Behaviour unchanged; may expose check time |
| `lib/palette.ts`, `lib/contrast.ts`, `index.css` | CHANGE | Add danger/info tokens; keep mirror in sync |
| `i18n/` | KEEP | New strings need en and nl entries (parity) |
| `Field` (label, help, error slots) | NEW | Shared anatomy for all inputs |
| `TextField`, `NumberField`, `Select`, `Checkbox`, `Switch` | NEW | Wrap existing inputs; today inputs are styled per page |
| `SegmentedControl` (radio group) | NEW | Billing cycle, narrow Dashboard pane switch |
| `OptionCards` | NEW | Payee choice, Diff options if cards are used |
| `StatusMessage` | NEW | status / alert / busy |
| `EmptyState` | NEW | Dashboard, Matches, not-configured |
| `DataTable` | NEW | Typed alignment, sticky header, contained overflow, used by Matches and the Diff table |
| `Skeleton` | NEW | Row and field placeholders, reduced-motion aware |
| `OfflineNotice` | NEW | Online/offline detection and disabled-reason wiring |

## 9. Acceptance checklist

Each line is verified in light and dark at 390x844, 1280x800 and 1440x900 unless noted.

Global
- [ ] Skip link is first focusable and works; one `<main>`; `h1` per page.
- [ ] Tabs are links with `aria-current`; active tab is distinguishable without colour.
- [ ] Theme toggle works and matches the Settings control; dark is the default on first load.
- [ ] Offline notice appears and network actions are disabled with a stated reason; local controls still work.

Sync Dashboard
- [ ] Idle: instruction text and enabled Run Sync Check; no automatic check on mount.
- [ ] Loading: skeleton rows in both columns, button reads "Checking...", region `aria-busy`.
- [ ] Populated: both columns show count, name, mono right-aligned amount and the row actions.
- [ ] Empty (valid zero): "Nothing to link here." with check time.
- [ ] Search with no hit: "No items match your search." and Clear search.
- [ ] Show Ignored Items on: ignored rows show Ignored badge and Restore only.
- [ ] Not configured: setup empty state with link to Settings.
- [ ] Sync failure: alert, failing side named, Retry, link to Settings; last result remains, marked stale.
- [ ] Row action failure: row error, rollback, focus stays on row.
- [ ] Link/Ignore success: focus moves to next row; announcement made.
- [ ] Keyboard order matches section 6 end to end without a mouse.
- [ ] Below 768px: panes stack or switch via segmented control; nothing clipped.

Matches
- [ ] Loading skeleton with fixed column geometry.
- [ ] Empty: message plus link to the Dashboard.
- [ ] Synced, Mismatch, Ignored and Orphaned badges each show text; amounts right aligned.
- [ ] Review button only on Mismatch rows and opens the diff modal; focus returns on close.
- [ ] Ignored toggle shows/hides the ignored section; Restore works; failure shows "Could not restore {name}."
- [ ] Table header sticky; narrow width scrolls inside a labelled container.

Settings
- [ ] Each section shows its scope label.
- [ ] Wallos: Test connection success and failure states shown beside the field; API key never displayed.
- [ ] Actual Budget: Load budgets error, budget select, detected base currency shown.
- [ ] Invalid credentials: error beside the failing field, no value echoed, entered values kept.
- [ ] Matching tolerance: invalid value blocked with an inline message; unit "%" stated.
- [ ] Local mode: password change with length rules; OIDC mode: note and issuer/subject, no password form.
- [ ] Save shows "Saving...", then "Saved" (`role="status"`); network failure keeps input.
- [ ] Narrow width: section nav is a labelled Select.

Create modals
- [ ] Loading pre-fill state; Create disabled until required fields are valid, reason shown.
- [ ] Held state (feature not enabled): disabled with reason.
- [ ] Submit busy: "Creating..."; duplicate submit blocked.
- [ ] Error: alert, inputs preserved.
- [ ] Partial success (category failed) shows warning; modal stays open.
- [ ] Escape, backdrop and Cancel discard; focus returns to the trigger; trap holds.
- [ ] Below 768px: full-screen sheet with pinned footer, safe-area padding.

Diff modal
- [ ] Drifted fields table shows Wallos vs Actual values, differing cells marked in text.
- [ ] Four options present with a consequence line each: Overwrite Wallos, Overwrite Actual, Ignore Diff, Unlink.
- [ ] Overwrite and Unlink require a confirm dialog naming object and consequence; Ignore Diff does not.
- [ ] Each mapped server error code shows its message and keeps the modal open.
- [ ] Success closes the modal, updates the row badge, refreshes the sync result.
- [ ] Stacked dialogs: Escape closes only the top one; focus returns correctly.

Login and Verify email
- [ ] Local mode shows form only; OIDC mode shows SSO button only.
- [ ] Error alert shown above the button; email kept, password cleared.
- [ ] Registration always shows the same "verification sent" message.
- [ ] Verify email: verifying, success, invalid, disabled, missing and error states each render with a sign-in link.

Tokens and quality
- [ ] No hard-coded colours in components; all values via tokens.
- [ ] Contrast test covers every token pair in both themes.
- [ ] en and nl catalogues have parity for every new string.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` and the test suite pass.

## 10. Decisions for the owner

All five decisions are made (owner dialogue answers). Original options are kept for traceability.

**D-a. Tailwind CSS and Lucide icons vs the guide's ban.**
Decided: Remove Tailwind CSS and Lucide React icons. Icons are inline SVG. CLAUDE.md is being amended separately. FOLLOW-UP: removing them from `src/web` and `package.json` is not part of this spec change. Shadcn components are built on Tailwind classes and cannot be kept as shipped (see section 8; recommendation, not an owner decision).
CLAUDE.md requires Tailwind and Lucide (the code uses both: `index.css` imports Tailwind, `StatusBadge` uses Lucide). The guide forbids both (native CSS custom properties, inline SVG icons).
- Option 1: Keep Tailwind and Lucide; amend the guide for Walley.
- Option 2: Remove both; rewrite styling to plain CSS and inline SVG. (Chosen.)
- Former recommendation: Option 1. Overridden by the owner.

**D-b. Default density.**
Decided: Compact on Dashboard and Matches. Standard on Settings, Login, Verify-email and modals.
- Option 1: Compact everywhere on desktop; standard sizing on coarse-pointer.
- Option 2: Standard by default; compact only for Dashboard rows and the Matches table. (Chosen, with Verify-email also standard.)

**D-c. Palette and token names.**
Decided: Rename to the guide's token names (`--bg`, `--surface`, `--line`, `--text`, `--muted`, `--accent`, `--focus`) using the CLAUDE.md hex values. Add `--danger`, `--danger-bg` and `--info` under the new names. FOLLOW-UP: the rename across `src/web` (`index.css`, `palette.ts`, tests, primitives) is not part of this spec change.
- Option 1: CLAUDE.md hex values with the existing Shadcn-style names.
- Option 2: CLAUDE.md hex values renamed to the guide's names. (Chosen.)

**D-d. 44px touch target.**
Decided: 44px applies to coarse-pointer and narrow layouts only (controls 32px compact on desktop). The 768px dual-pane breakpoint stands.
- Option 1: Coarse-pointer / narrow layouts only. (Chosen.)
- Option 2: Apply everywhere.

**D-e. Placeholder copy.**
Decided: The proposed copy is approved, and the Dashboard "last check" line and Matches counts line are added. Every string formerly tagged as proposed is now tagged `[approved, not yet in messages files]`. FOLLOW-UP: add these strings (en and nl) to the `*.messages.ts` files when the feature is built. Wireframe names are shown as `<name>`; the example "Netflix", "Monthly - EUR - 5% tolerance" and IA label placeholders are replaced by strings from `AppShell.messages.ts`, `SyncDashboard.messages.ts`, `Matches.messages.ts`, `DiffModal.messages.ts` and `CreateModal.messages.ts`.
- Option 1: Add the last-check and counts lines. (Chosen.)
- Option 2: Omit; keep the existing title-only header.

Remaining implementation items (not conflicts): error/info colour tokens (5.1); server error codes for invalid Wallos/AB credentials to map to messages (4.4); radius, control-height and motion values (5.3); no primitive-enforcement script exists, so the guide's Phase 7 test is NEW.

## 11. Suggested phasing (from the migration plan, where it applies)

1. Tokens and shared controls (`Field`, `TextField`, `Select`, `StatusMessage`, `EmptyState`, `DataTable`, `Skeleton`); add danger/info tokens; extend contrast test.
2. Shell: skip link, narrow header, offline notice. No routing change.
3. Dashboard and Matches: states, compact density, narrow layout.
4. Modals: Create and Diff hierarchy, focus return, full-screen mobile.
5. Settings: scope labels, anchor nav, field anatomy.
6. Enforcement: primitive test, MAP.md updates.

Phases 2 to 4 of the migration plan (feature registry, canonical hash routes, record switcher, Preferences workspace, SelectionInspector, staged result dialogs) do not apply: Walley has three fixed routes, no active record and no visualizations.

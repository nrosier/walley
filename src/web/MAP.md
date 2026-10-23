# src/web map

| File | What it holds | Touch when |
| --- | --- | --- |
| `App.tsx` | Path router via `useRoute`; `/login` and `/verify-email` render without the shell or session check; other routes run the session gate (`GET /api/auth/me`, 401 goes to `/login` keeping the query), then `AppShell` with theme, logout, refresh (bumps the page key, except on `/sync` where it runs `syncStore.run()`); `SyncDashboard`, `Matches`, `SettingsPage` | Adding pages or routes |
| `App.messages.ts` | App-level strings (loading, session error, verify-email title) | |
| `main.tsx` | Mounts `I18nProvider` > `App` | |
| `pages/Matches.tsx` | Matches: `Matches` (reads `useSyncCheck` result, holds the ignored-switch state) and `MatchesView({result, showIgnored, onShowIgnoredChange, onRestore, busyId, errorId, errorMessage})`, a table of `linked[]` (names, `font-mono` amounts, range flag, `StatusBadge` from `pairBadge`, em dash for missing sides) plus an optional "Ignored items" section from `ignored[]` with a Restore button per row (`onRestore(matchId)` through `performAction`; `busyId` disables it, `errorId`/`errorMessage` show a failure). Restore is the only write action | Matches table |
| `pages/Matches.messages.ts` | Matches page en/nl strings | |
| `pages/SettingsPage.tsx` | Settings: General (`LanguageSelect`), then "Your account" with Wallos, Actual Budget and Matching, then Account / Security | Adding a settings section |
| `pages/LoginPage.tsx` (+ `LoginPage.register.ts`: client checks, register error text) | Loads `GET /api/auth/config`; local mode shows the email/password form (with register toggle when registration is on), OIDC mode only the SSO link; `?error=` codes map to page or server error text | Sign-in UI |
| `pages/VerifyEmailPage.tsx` | `/verify-email#token=...`: `runVerification` clears the hash, POSTs the token once, shows verifying / success / invalid / disabled / missing / error with a sign-in link | Email verification |
| `pages/SyncDashboard.tsx`, `pages/SyncDashboard.messages.ts` | Sync Dashboard: `SyncDashboardView` (toolbar on top, Wallos left, Actual right; idle/loading/error/empty states) and `SyncDashboard` (search and ignored-switch state, Link/Ignore/Restore through `performAction`, focus to next row). Never checks on mount | Dashboard UI |
| `components/dashboard/` | `Toolbar` (search, switch, Run Sync Check), `ItemRow` + `ItemColumn` (amount in font-mono, range flag, unmappable reason, Link picker only with candidates, disabled held Create buttons, Ignore, Restore on ignored rows), `WallosColumn`, `ActualColumn` | Dashboard rows or columns |
| `lib/sync-check.ts` | `runSyncCheck`, shared `syncStore`/`useSyncCheck` (single holder of the last result), pure `filterRows`, `buildRows`, `applyLink`, `applyIgnore`, `applyRestore`, `rollback`, `rollbackAction` (undoes only the touched rows), `nextRowId`, and `performAction` (optimistic update on the shared store, per-row rollback) | Sync result handling |
| `lib/matches.api.ts` | `linkPair` (`POST /api/matches`), `ignoreItem` (`POST /api/matches/ignore`), `restoreMatch`, `resolveMatch` (`POST /api/matches/:id/resolve`; `ignore_diff`, `unlink`, `overwrite_wallos`, `overwrite_actual`; all but ignore_diff send `confirm: true`) with injectable fetch | Match writes |
| `lib/resolve-mismatch.ts` | `driftedFields`, `applyResolve`, `rollbackResolve`, `performResolve` (optimistic resolve on the shared store, per-row rollback, `syncStore.run` refresh on success) | Mismatch resolve |
| `components/matches/DiffModal.tsx`, `DiffModal.messages.ts` | Diff modal opened from a Mismatch row in Matches: drifted fields Wallos vs Actual (`font-mono`), Ignore Diff, Unlink (AlertDialog confirm), and two Overwrite buttons that call resolve with `confirm: true` only after an AlertDialog confirm; server codes map to fixed `overwriteErrors` messages (en, nl) | Diff modal |
| `pages/WallosSettings.tsx` | Wallos URL and API key form (key is write-only, shows a saved flag), save and Test connection | Wallos config |
| `pages/ActualSettings.tsx`, `pages/ActualSettings.api.ts` | Actual Budget form: server URL, password, sync key (write-only, clear option), Load budgets, budget selector, detected base currency. The `.api.ts` file holds the fetch calls so the component file only exports components | Actual config |
| `pages/MatchingSettings.tsx` | Amount tolerance percentage form: loads and saves via `GET`/`PUT /api/settings/matching`, input checked before sending | Matching config |
| `pages/AccountSettings.tsx` | Account / Security: password change in local mode (length limits from `src/lib/password-policy.ts`), OIDC note and linked issuer/subject in OIDC mode | Account settings |
| `pages/*.messages.ts` | Co-located en/nl catalogues for each page above | |
| `pages/SettingsPage.messages.ts` | Settings page title, scope label and section headings | |
| `index.css` | Tailwind theme mapping and dark (default) / light palette variables keyed on `data-theme` | Changing colours |
| `components/AppShell.tsx` | Navbar: title, three real `<a href>` tab links (clicks go through `navigate`, `aria-current`), Refresh, theme toggle, Radix `DropdownMenu` user menu (email trigger, Log out) | Changing navigation or header actions |
| `components/AppShell.messages.ts` | Shell strings | |
| `components/HealthStatus.tsx`, `components/HealthStatus.messages.ts` | `/api/health` indicator and its en/nl labels | |
| `components/ui/button.tsx` | Shadcn button | |
| `components/ui/badge.tsx` | `Badge` pill, variants `linked` (green), `mismatch` (amber), `neutral` (gray), `orphaned` (gray fill with amber border); `text-xs` | Status badges |
| `components/StatusBadge.tsx`, `components/StatusBadge.messages.ts` | `StatusBadge({kind})` for `PairBadgeKind` (`synced`, `mismatch`, `ignored`, `orphaned`): en/nl label, badge variant, Lucide `Unlink` icon (aria-hidden) on orphaned | Pair status pills |
| `lib/theme.ts` | Pure theme helpers: read/write `walley-theme` in localStorage (dark on any failure), toggle, `applyTheme` | Theme storage |
| `lib/route.ts` | History API router: `parseRoute(pathname)` (`/` and unknown go to sync), `navigate(path)`, `useRoute()`, `TABS` | Adding tabs |
| `lib/session.ts` | `checkSession`: `GET /api/auth/me`; 401 navigates to `/login` + query | Session gate |
| `lib/api.ts` | `apiRequest` (sends `x-csrf-token` from the `walley_csrf` cookie on unsafe methods), `ApiError` | Calling the API |
| `lib/utils.ts` | `cn` | |
| `i18n/` | English/Dutch i18n: provider, `useT`, catalogues registry, language picker (see `i18n/MAP.md`) | Adding user-facing strings |
| `lib/contrast.ts` | WCAG relative luminance, contrast ratio, rgba parsing and compositing | Palette contrast checks |
| `lib/palette.ts` | `PALETTE` dark/light token values mirrored from index.css; contrast tests read it. Keep in sync with index.css | Changing colours |

Router is an in-house History API path router (no dependency); the server redirects to path URLs.

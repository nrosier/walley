# Walley UI redesign proposal

Status: owner decisions recorded (section 3). Design only; nothing under `src/web/` changed.
Mockup: `docs/ui/mockups/walley-redesign.html` (open in a browser; use the toolbar to jump to a section and to toggle light/dark). Mockups are not committed (guide 17.2).
Sources: `WALLEY-UI-SPEC.md` (decisions D-a to D-e honoured), `UI-UX_GUIDELINES.md`, `CLAUDE.md` Look and Feel, message catalogues in `src/web/**/*.messages.ts`.

## 1. Kept as is

Dark default, CLAUDE.md palette, three route-link tabs, dual-pane Sync Dashboard, StatusBadge pills (green/amber/gray, always with text), `font-mono` right-aligned amounts, write-only secrets, optimistic row updates with per-row rollback, compact density on Dashboard and Matches and standard elsewhere (D-b), 44px targets on narrow/coarse only (D-d), 768px breakpoint.

## 2. What changes and why

| # | Change | Fixes (audit) | Spec / rule |
| --- | --- | --- | --- |
| 1 | `--danger`, `--danger-bg`, `--info` tokens; Unlink and error alerts use danger red. Amber is now only Mismatch (and the Orphaned border). The "range" flag becomes an info pill. Unmappable reasons are muted text with an info icon, not amber. | Invisible Unlink; amber used for four meanings | Spec 5.1; guide 11, 13 |
| 2 | Visible focus ring (2px `--focus`, 2px offset) and a real `--hover` token for ghost/outline buttons | Faint ring, no hover | Spec 5.3, 6; guide 9 |
| 3 | Dashboard row is one line: name, cycle, mono amount, one primary action. Link (outline indigo, with a "Suggested match: X" line) when a candidate exists, otherwise "Create in Actual Budget / Wallos". Ignore and Restore move to a per-row "More actions" button. Only Run Sync Check is filled indigo. | Two-line rows with 4 look-alike controls; Link vanishing unexplained; "Create in AB" | Spec 3.1, 4.2; guide 5, 8 |
| 4 | Billing cycle shown in every row; ignored rows sit in a disclosure under the column, not mixed in | Cycle missing; ignored mixed | Spec 3.1; guide 4 (Disclosure) |
| 5 | Sync failure: alert names the side, Retry (primary), "Check settings" link; last good result kept and marked Stale. First-use state with two setup steps and a Settings link. Skeleton while checking. Row errors keep the row, say nothing changed, offer "Try again". | No side name, Retry, first-use state | Spec 4.3, 4.4; guide 7 |
| 6 | Matches: columns reordered to name+amount pairs under Wallos / Actual Budget group headers, sticky two-level header, sticky first column, search, counts line, Run Sync Check on the page, empty state with both actions. Differing amounts get bold plus hidden "differs" text. | Empty page with no way forward; split name/amount; no sticky header or search | Spec 3.2; guide 8 |
| 7 | Diff modal: values formatted ("Every 2 months", "12 Mar 2026"); Ignore Diff is the initial focus; each option has a consequence line; both overwrites are neutral equal buttons; Unlink is alone in the pinned footer on the opposite side, danger outline with icon and text; confirms name the object and the change ("Overwrite Wallos" not "Confirm"); the modal stays open with "Working..." until the server answers; body scrolls, footer pinned, max-height set. | Closes early, wrong default focus, look-alike row, generic confirm, raw values, no scroll | Spec 3.5, 6; guide 13 |
| 8 | Create modals share one shell: pinned header and footer, scrolling body, Cancel and Create together in the footer, reason Create is disabled shown in footer and beside the field, payee as option cards, billing cycle as segmented control, full-screen sheet below 768px | Split actions, no scroll, read-only fields | Spec 3.4; guide 6 |
| 9 | Settings: section cards, sticky anchor nav (labelled Select on narrow), scope pill on every card ("This device" / "Your account"), Theme control added to General, one save model per card: General saves instantly with "Saved"; each account card has a single footer Save that also carries budget pick and tolerance, with "Unsaved changes" / "No unsaved changes" status | No cards/anchors; three save models; scope hidden; theme missing | Spec 3.3; guide 3.3, 4 |
| 10 | Shell: header wraps below 768px (tabs become a full-width second row, labels collapse to icons), title links to `/sync`, per-page `<title>` ("Matches - Walley"), skip link | Header does not adapt | Spec 2, 6, 7 |
| 11 | Mobile Dashboard: two-option segmented control (radio group) switches Wallos / Actual list; toolbar wraps; Run Sync Check full width; 44px controls | Touch targets 24px | Spec 7; guide 10 |
| 12 | Login centred vertically with brand mark, 44px inputs, alert above button, busy label ("Signing in...") | Card stuck to top, no brand | Spec 3.6 |
| 13 | Unique accessible names everywhere ("Restore Amazon Prime", "Review differences for Netflix Premium", "Link X to Y") | Repeated names | Spec 6 |

## 3. Decisions

Owner decisions, all final. Items marked "needs" are prerequisites for implementation.

1. Create modals: pre-filled fields are editable before Create (name, amount, start date, payee, account, category; frequency stays read-only). Needs backend support for overrides on the create endpoints (engineer).
2. Wallos create modal: add input fields (title, price, billing cycle segmented, start date), matching the Actual modal.
3. Light-mode muted text is `#64748b` (dark `#94a3b8`). Needs AA (4.5:1) verified on every light surface with the contrast test before implementation. This departs from the CLAUDE.md palette (body `#334155`, muted not defined separately): CLAUDE.md Look and Feel must be updated to record the muted values.
4. Row actions: Ignore and Restore live in a "More actions" menu on Dashboard and Matches rows (one dropdown level only, guide 2). No visible Ignore button.
5. Test connection and Load budgets use the values typed in the form, without saving first; the "Save first" helper text goes. Needs backend confirmation that these endpoints accept unsaved values (engineer), and that secrets stay write-only.
6. Settings save model: one Save per account card with an unsaved-changes status. Budget pick and tolerance join that card's Save (no instant save, no save-on-blur). General (This device) stays instant with "Saved".
7. Danger and info token values in section 4 are approved. The placeholder "W" brand mark on login is approved (no logo asset exists).
8. Orphaned badge keeps the gray fill with an amber border and unlink icon.

## 4. Token additions

Names follow D-c (`--bg`, `--surface`, `--line`, `--text`, `--muted`, `--accent`, `--focus`). Values below that are not in CLAUDE.md are approved by the owner (decisions 3 and 7); the muted contrast check is still pending.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--danger` | `#fca5a5` | `#b91c1c` | danger text and icons |
| `--danger-line` | `#f87171` | `#dc2626` | danger borders (Unlink, alerts, invalid inputs) |
| `--danger-bg` | `rgb(239 68 68 / .15)` | `#fee2e2` | alert fill, error row, button hover |
| `--info` | `#93c5fd` | `#1e40af` | range flag, info alerts |
| `--info-bg` | `rgb(59 130 246 / .15)` | `#dbeafe` | same |
| `--hover` | `rgb(148 163 184 / .12)` | `rgb(15 23 42 / .06)` | hover on ghost/outline buttons, rows, nav |
| `--surface-2` | `#111827` | `#f1f5f9` | input fill, table header |
| `--muted` (changed value) | `#94a3b8` | `#64748b` | secondary text (decision 3; AA check pending) |
| `--accent-text` (dark changed) | `#818cf8` | `#4f46e5` | text on dark; `#6366f1` was kept for `--focus` |
| `--scrim` | `rgb(2 6 23 / .65)` | `rgb(15 23 42 / .45)` | dialog backdrop |
| `--shadow` | `0 12px 32px rgb(0 0 0 / .5)` | `0 12px 32px rgb(15 23 42 / .22)` | dialogs and menus only |
| `--control-h` | 32px; 44px under 768px container or coarse pointer | same | all controls (D-d) |

Unchanged: `--bg`, `--surface`, `--line`, `--text`, `--accent` (`#4f46e5`), `--focus` (`#6366f1`), success/warning/neutral pairs. Extend `contrast.test.ts` and `palette.ts` for every new pair in both themes, including `--focus` against `--bg` and `--surface` (3:1).

## 5. Mockup notes

- Frames use container queries, so each frame reacts to its own width like a viewport; the 390px frames show the mobile layout and narrow frames inside the page also fall under 768px.
- Sample copy comes from the catalogues: "Run Sync Check", "Show Ignored Items", "Nothing to link here.", "Review differences", "Ignore Diff", "Create Actual Budget schedule", "Amount tolerance", "Sign in to Walley", and others. Copy not yet in catalogues (Retry, Check settings, Stale, last-check line, suggested-match line, consequence lines, "More actions") is spec-approved or new and needs en and nl entries.
- New consequence and menu strings are not yet approved by D-e and should be reviewed.
- Offline notice, skip link and the not-yet-drawn Verify email page follow spec 4.4 and 3.6 and are not shown.

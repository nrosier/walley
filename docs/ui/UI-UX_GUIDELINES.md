# UI/UX Implementation Guide

**Status:** Normative guidance for new UI work  
**Audience:** Coding agents and human contributors  
**Related documents:** UI/UX migration plan

This document defines how the app's features should be organized, presented, and implemented so that the interface remains predictable as the product grows. Apply it to new screens, feature additions, and substantial UI refactors.

The terms **must**, **should**, and **may** express required behavior, the preferred behavior when no stronger constraint applies, and an optional choice.

## Design authority

The current UI is a source of workflow requirements and implementation evidence. It is not the design standard. Do not copy an existing pattern merely to remain consistent when that pattern is confusing, inconsistent, visually dated, inaccessible, or needlessly complex.

Build toward one clean target experience:

- Preserve correct domain behavior, user data, privacy guarantees, accessibility, localization, and calculation semantics.
- Replace weak layout, navigation, copy, hierarchy, settings placement, and interaction patterns when a clearer solution exists.
- Prefer familiar web conventions and direct task flows over preserving historical component behavior.
- When replacing a shared pattern, migrate related instances where practical instead of introducing a third variation.
- Consistency means consistency with this guide and the intended target system, not repetition of current design debt.
- A redesign may move, rename, regroup, combine, or remove redundant controls when the resulting feature remains discoverable and its behavior is preserved or deliberately improved.
- Do not add compatibility UI, duplicate entry points, or explanatory clutter solely to protect an obsolete interaction pattern. Use a short transition only when removing it immediately would cause users to lose work or access.

When current behavior and this guide disagree, follow this guide. Document any product or technical constraint that requires an exception and describe the user impact.

## 1. Start with the user's goal and scope

Before writing a component, write down:

1. The user goal in one sentence.
2. Whether the feature belongs to a saved item, the signed-in user, this device, one page or view, an administrator, or the deployment.
3. Its navigation group and order.
4. Its prerequisites, such as a required field being filled in, authentication, a linked account, or network access.
5. Which state must survive a redraw, route change, reload, sign-in, another device, export, or sharing.
6. Its loading, empty, partial-data, error, offline, and destructive states.
7. Its keyboard path and mobile layout.

Do not begin from a desired control such as “add a modal” or “add a menu item.” Choose the surface after the goal and scope are clear.

## 2. Use the canonical information architecture

Organize primary navigation around user goals. Group by the task the user recognizes. Do not group by module name, data type, implementation package, or delivery order.

Example for Walley's top-level navigation: **Sync Dashboard**, **Matches**, **Settings**. Account and sign-out controls sit in the header.

Apply these rules:

- A feature must have one canonical home. Shortcuts may point to it but must not create a second competing structure.
- Group by the task the user recognizes. Do not group by module name, data type, implementation package, or delivery order.
- Keep a menu to one dropdown level. Use noninteractive headings and separators inside a dropdown instead of flyouts within flyouts.
- Keep order stable. Put foundational inputs before outputs, common workflows before specialist workflows, and destructive/administrative actions away from ordinary creation paths.
- A global tool must not inherit saved-item scope merely because an item was viewed recently. Show **Return to Netflix** for history and **Using Netflix** only when that item actually affects the tool.
- A selector for the active saved item, where a feature needs one, must be searchable, not a static label. Switching items should preserve the current feature when its prerequisites are met.
- Route links use anchors. Buttons perform actions. Same-page tabs use the tab pattern only when small panels are genuinely mutually exclusive. Views of one result use ordinary route links; related sections inside one view use headings and in-page anchors. Route links do not use `role="tab"`.
- Every page title must identify both the feature and its subject, for example **Matches · Netflix** or **Subscription details · Netflix**.

When adding a feature, add typed metadata for its `scope`, `group`, `order`, `href`, prerequisites, settings mode, and export capabilities. Update route parsing, lazy loading, labels in every supported language, active navigation, and relevant export registration together. An exhaustiveness test should fail when a user-facing route has no feature metadata.

### Target application shell

Use a collapsible workspace rail on wide screens and a drawer on smaller screens. The rail contains:

1. Brand.
2. Searchable selector for the active saved item, when the feature needs one.
3. Primary feature groups.
4. Tools and documents.
5. Preferences, sync, and account controls anchored at the bottom.

The content header contains the page title, a compact basis line, the primary page action, and actions that affect only this page. It does not repeat global navigation.

Keep page exports with their page. Put document builders under Documents. Put full-data or CSV backup under Preferences → Data & privacy.

On calculated views, show the effective basis in a compact line, such as **Monthly · EUR · 5% tolerance**, with an **Edit** action.
Overview screens, where a feature has one, show the state the user must act on, essential facts, the current basis, and a small set of real next actions. Do not add decorative metrics or a feed of arbitrary recommendations.

Add continuation actions only where they advance the current task, for example a follow-up action from a completed sync check. Preserve the selected item and the effective configuration across the transition.

Do not create separate beginner and expert modes. Keep common actions visible, reveal advanced controls progressively, offer meaningful presets, and support experts through search, remembered defaults, and keyboard access. Hiding whole features by mode makes the product harder to learn and support.

## 3. Assign every setting an owner and lifetime

A setting belongs to the object whose behavior changes. Its location in the current component tree does not determine its scope.

| Scope                     | Use it for                                                                               | Edit it in                                                  | Persistence                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------ |
| Application/deployment    | Provider selection, service policy, feature availability, system limits                  | Deployment configuration or Admin                           | Server/configuration; application-wide                             |
| User/account              | Language, regional formatting, default filters, default tolerance and base currency      | Global Preferences workspace                                | Local-first; sync across the user's devices when signed in         |
| Device/browser            | Theme, motion, density, display-specific accessibility                                   | Preferences → Appearance & accessibility; optional shortcut | This browser/device only                                           |
| Saved item                | Name, item fields, notes                                                                 | The item's edit form                                        | Stored with the item; optional account sync                        |
| Saved configuration       | Settings required to reproduce a saved result                                            | Saved-item settings panel                                   | Save with the item, share and export configuration                 |
| Page/view                 | Date, comparison target, filters, sort, section, expansion, temporary export choices     | Inline or page-specific Advanced settings                   | React state; URL when navigable/shareable; no implicit persistence |
| Request/security          | Destructive confirmation, authentication challenge                                       | At the action                                               | Never a standing preference                                        |

Every setting definition must declare a stable key, `scope`, owner, default, persistence, sync behavior, editing surface, commit mode, reset target, serialization version, and whether the value is sensitive. Keep this metadata in one typed settings registry so a control cannot acquire persistence accidentally.

When a setting supports defaults and overrides, use this precedence:

1. The application default.
2. The user's default.
3. A saved-configuration override.
4. A temporary view override.

Device presentation preferences apply alongside this chain. Saved-item data does not participate in it: item fields are inputs, not defaults. The UI must identify the effective source and make Reset explicit: **Reset to my default** or **Reset to application default**.

### 3.1 Saved-item scope

Data about one saved item (its fields and notes) applies only to that item. The UI must name the item and say that the change applies to it. Persist through the existing store so offline behavior and optional sync remain consistent. Shared formatting and presentation choices stay user or device preferences (§3.2, §3.3), never item data.

### 3.2 User/account preferences

Use user scope for choices that express the reader's stable language or methodology across devices:

- Language and regional date, number, and currency formatting.
- Default matching tolerance and base currency.
- Default filters.

These preferences must work while signed out. Apply changes locally first. When profile sync exists and the user signs in, adopt or reconcile local and remote values explicitly. Do not make offline use depend on authentication and do not silently overwrite a newer local choice.

### 3.3 Device preferences

Use device scope for choices that reasonably differ by screen, operating system, browser, or input mode:

- System/light/dark theme.
- Reduced motion and interface density.
- Icon style and other display-specific choices.

Store these locally and identify them as **This device**. A header toggle may provide fast access, but the same value must also have one canonical location under Preferences.

### 3.4 Saved-result and page settings

Settings that affect reproducibility must travel with a saved, shared, or exported result. Advanced settings should offer clear actions:

- **Apply to this result** changes the current result.
- **Save as my default** changes the user's starting profile for future work.
- **Reset** changes the draft to the documented default and does not commit it.
- **Cancel** discards every change made in the dialog.

A preset changes the current draft. It must not rewrite account defaults. If the preset includes a different base currency or tolerance, store that as an override after Apply; change the account default only after a separate **Save as my default** action.

A small set of page inputs, such as the target date, the comparison item, table sort, and document contents, belongs inline. When one result has several related configuration groups, put the whole set in one staged page-settings modal and show its applied summary beside the result. Keep page state in component state unless Back/reload/share should reproduce it; in that case encode stable, non-sensitive state in the URL. Do not write page state to `localStorage` unless the user explicitly chooses **Set as default**.

### 3.5 Application and administrator settings

Deployment policy, service credentials, provider choice, feature rollout, organization limits, and administrator-only controls do not belong in user Preferences. Put editable policy on a dedicated Admin route and keep secrets in server/deployment configuration.

### 3.6 Privacy and consent

Consent authorizes the specific action described beside it. Consent must remain unchecked and unpersisted for every new request. Never promote consent to a user preference, saved-item field, or device flag.

## 4. Use a predictable settings surface

Global Preferences must use one stable, responsive route with these groups, shown as same-page tabs. Each group must be deep-linkable through a settings section route.

1. **Appearance & accessibility:** language and regional formats, theme, symbols, density, motion.
2. **Matching defaults:** tolerance, base currency, default filters.
3. **Data & privacy:** sync/account status, local-storage persistence, export, and account-data removal.

Every group must display its scope: **Your account** or **This device**. Application-wide controls belong to Admin and must be labelled there.

Preferences save immediately and display save/sync state inline. Each change updates the local source of truth first and then synchronizes account-scoped values in the background. Announce save or sync failure without reverting a valid offline change. Do not render Apply, Done, or Cancel for the whole workspace because there is no page-wide draft to commit or discard. A dedicated route provides room for durable defaults, synchronization, exports, destructive data actions, browser history, deep links, and a reliable mobile layout.

Use these surface rules:

- A small set of page-defining inputs stays inline. When one result has several related configuration groups, use one page-specific staged modal and keep a summary of the applied state on the page.
- A large set of reversible advanced page controls uses the shared settings dialog.
- A staged modal must stage every control. **Apply** commits all changes; **Cancel**, Escape, close, and backdrop discard all changes; **Reset** modifies only the draft.
- The immediate-save Preferences workspace announces save or sync status and never contains a page-wide staged commit model.
- Do not put an immediately persisted reusable control inside a staged modal unless the parent supplies its draft value and commit callback.
- Use the shared `Disclosure` component for optional inline content that does not require interruption or a commit decision. It may use semantic `<details>/<summary>` internally, but it must not expose a bare browser disclosure triangle as its only affordance.
- A destructive action uses a dedicated confirmation dialog that names the object and consequence.
- Labels such as **This view**, **This item**, **Your account**, and **This device** must make reach and persistence clear before interaction.

### Disclosure pattern

Expandable reference content uses one shared `Disclosure` component. A disclosure trigger is a full-width interactive row containing:

- A clear text title; a glyph may support the title but never replace it.
- Optional secondary text describing what will open, such as **4 options explained**.
- Explicit **Show details**/**Hide details**, **Show explanation**/**Hide explanation**, or equally specific action text.
- The standard trailing chevron, which rotates in the open state and is hidden from assistive technology.

The entire trigger row has a minimum 44px target, pointer affordance, border/surface treatment consistent with other controls, and distinct hover, focus-visible, active, and open states. Opening must not move focus. The panel is associated with its trigger, and the trigger exposes expanded state. Several disclosures may remain open when comparison is useful.

`<details>/<summary>` is an acceptable semantic implementation. Remove the native marker only after adding the shared chevron and explicit action wording. Do not ship a raw triangle beside a title, a glyph-only trigger, or a one-off accordion skin in a feature stylesheet.

Use the same component for any reference content, such as explanations of each option or candidate details.

## 5. Build each page around a clear hierarchy

Each page should render in this order when applicable:

1. Back/context link or compact breadcrumb.
2. One descriptive `<h1>` containing feature and subject.
3. A short context line for calculation basis, item, date, or scope.
4. Primary page inputs and the main action.
5. Status or summary metrics.
6. Result content.
7. Secondary actions and advanced settings.

The primary action must be visually strongest and appear near the inputs it submits. A long form should expose completion, dirty state, and a reachable Save action without forcing the user to scan to the bottom. Secondary and destructive actions must not compete with the primary action.

Use a reading measure near 68 characters for interpretation prose. Use wider data shells for tables, charts, and builders. Do not solve both needs with one global maximum width.

### Choose the right way to split content

Do not solve every long page with another tab row, and do not force every related result into one continuous page. Use the smallest structure that keeps the user's current task and feedback together:

| Structure                       | Use when                                                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Route-level local view**      | The content is a substantial task or visualization, benefits from Back/bookmark/share, or would push its interaction feedback several screens away. |
| **In-page section with anchor** | The content forms one reading or analysis flow and remains understandable in sequence.                                                              |
| **Tabs**                        | Two to four compact, mutually exclusive panels share one context and switching does not need its own URL or browser history.                        |
| **Disclosure**                  | Optional explanation or secondary detail can open in place without interrupting the task.                                                           |
| **Modal form**                  | Related settings must be reviewed and committed together while the result remains visible behind the dialog.                                        |
| **Pagination/virtualization**   | Repeated data volume, rather than information architecture, makes a list or table long.                                                             |

Split a page when it contains more than one dominant visualization with different selection contexts, when the result a control changes is no longer visible near that control, or when a secondary task routinely begins several screenfuls below the primary task. Keep each visualization's legend, selection feedback, and interpretation in the same view. Preserve context in the URL when moving between route-level local views.

## 6. Implement forms and controls semantically

Choose controls by the decision being made, not by whichever component a nearby screen already uses:

| Decision shape                                    | Required pattern                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Two to four short, exclusive choices              | Segmented control implemented as a labelled radio group. Selected, hover, focus, and disabled states must remain distinct in both themes.              |
| Two to five exclusive choices needing explanation | Radio option cards with a short title and one concise consequence per choice. The entire card may activate its radio.                                  |
| Five to twelve concise choices                    | Shared Select. Use a proven accessible popover primitive when the popup must match the app's style; retain a styled native fallback.                   |
| A long or searchable choice list                  | Combobox with text filtering, result count, full keyboard navigation, and a clear no-results state.                                                    |
| Independent multiple choices                      | Checkbox group with a visible legend. For long groups, add group-level **Select all** and **Clear** actions and show a selected count.                 |
| Immediate persistent on/off preference            | Switch with visible state text where ambiguity is possible.                                                                                            |
| Boolean value inside a staged form                | Checkbox. A switch must not imply immediate application when the parent requires Apply.                                                                |
| Date                                              | Shared `DateField` with direct keyboard entry, locale-aware display, ISO storage, validation, and an optional calendar button.                         |
| Number with a meaningful increment                | Shared `NumberField` with the same field shell and one standard stepper. Define `min`, `max`, `step`, unit, and accessible Increase/Decrease labels.   |
| Active filters                                    | `FilterSummary` showing the preset/custom name, shown/total count, and one **Change filters** action. Keep a direct **Clear** action for zero results. |
| Optional explanatory or reference content         | Shared `Disclosure` with a full-width title, content summary, explicit Show/Hide wording, trailing chevron, and visible interaction states.            |

Examples of applying these rules in Walley:

- **Billing cycle** (monthly, yearly, custom days): a segmented control.
- **Currency conversion source** (Wallos rate or manual override): radio option cards, each with its consequence.
- **Status filter** (Matched, Mismatch, Ignored): visible presets with a shown/total summary and one **Change filters** action.

### Shared control anatomy

Every field and selection control must come from the shared component layer. A feature must not style a raw input merely because it sits outside an existing form grid.

- `TextField`, `DateField`, `NumberField`, `Select`, and `Combobox` share label placement, control height, padding, radius, border, surface, typography, focus ring, disabled treatment, help spacing, and error placement. Textarea height may differ; its surrounding anatomy does not.
- Checkbox and radio controls share one size, stroke, selected color, focus ring, label gap, disabled treatment, and minimum row target. A checkmark and radio dot communicate different semantics within the same visual family.
- Select triggers use the same field surface as text entry. Their chevron, clear action, popup radius, option padding, selected mark, and focus treatment come from the shared Select component.
- Use `standard` and, only for dense desktop data tools, `compact` size variants. Do not create feature-specific heights, radii, or padding. Compact controls return to standard sizing on coarse-pointer/touch layouts.
- Labels, required/optional state, units, help, errors, and character/range limits occupy defined slots in the `Field` component. Reserve error space where validation is likely so controls do not jump vertically.

Bind the root `color-scheme` to the app's effective light/dark theme so browser date/time affordances do not contradict an explicit app theme. Never scope the only input/select styling to `.field-grid` or another layout container.

`NumberField` keeps a real numeric input for keyboard and screen-reader semantics but suppresses browser-dependent visible spinners. When stepping is useful, render the shared trailing Decrease/Increase buttons in the same order, dimensions, icon style, hover/focus/pressed states, and boundary-disabled treatment everywhere. The buttons use accessible names such as **Decrease amount** and **Increase amount**; Arrow Down/Up performs the same step while the input has focus. On touch layouts each step button has a 44px target. If stepping is not meaningful, omit the buttons rather than showing a different spinner style. Preserve valid intermediate typing such as an empty value, minus sign, or decimal separator until blur/submit validation.

The shared date field must remain directly editable. The calendar opens from a separate, labelled button and is optional; typing and pasting a date must never require opening it. Store `YYYY-MM-DD` independently of the localized display value. Do not hand-build a calendar grid or listbox: use a mature accessible primitive and verify arrow keys, page/month movement, Escape, focus return, touch, zoom, screen readers, and every supported language. A browser-native picker is the fallback when those requirements cannot be met.

- Use a `<form>` with native submit behavior when Enter should run the operation.
- Use `<fieldset>` and `<legend>` for related controls.
- Associate every label, help text, validation message, and unit with its field.
- Preserve entered data after validation or network failure.
- Put the error beside the field and provide an error summary with links when a long form contains several errors.
- State units and accepted formats before entry. Parse and format dates, numbers, currency, and timezones through shared deterministic helpers.
- Disable a control only when interaction cannot succeed. Explain the prerequisite next to it and provide the recovery action.
- Mobile touch targets should be at least 44 by 44 CSS pixels.

## 7. Design every state, including unhappy paths

Every data-bearing component must define:

- **Initial loading:** reserve final geometry with a content-shaped placeholder when latency is visible.
- **Recalculation:** retain the last valid result, mark the region `aria-busy`, and show that it is updating.
- **First-use empty:** explain the feature and provide its primary setup action.
- **Filter empty:** name the active filter and provide **Clear filters** or **Show all**.
- **Valid zero result:** say that the check succeeded and suggest the relevant parameter to change.
- **Partial/degraded data:** render usable fields, identify missing fields, and avoid invented fallbacks.
- **Error:** explain what failed, preserve user input, and provide Retry or a corrective action.
- **Offline:** distinguish operations that remain local from those that require the network.
- **Success:** confirm durable actions without interrupting continued work.

Use a shared status component with `role="status"` and polite live announcements for progress/success, `role="alert"` for blocking failures, and `aria-busy` on the region being updated.

## 8. Make dense data scannable

- Keep table headers visible for long scroll regions.
- Right-align amounts, counts, percentages, and other numeric measures; use tabular numerals.
- Give columns typed metadata for alignment and data kind. Do not style by column position.
- Offer a compact density for large result sets without shrinking touch targets on mobile.
- Keep copy, CSV, and export actions adjacent to the data they affect.
- Truncate only when the full value remains available through expansion, title, or an accessible detail view.
- Keep status, primary metric, and next action visible within the first screenful.

## 9. Preserve accessibility and keyboard behavior

- Use `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, headings, lists, tables, and forms according to meaning.
- Maintain one `<main>` and a working skip link.
- Keep focus order aligned with visual order.
- Every interactive element needs a visible high-contrast focus indicator.
- Radix Dialog (the shared Dialog primitive) is the default modal primitive. Give it an accessible title, contain focus, close on Escape, and restore focus to the trigger.
- Menus close on selection, outside interaction, Escape, focus departure, and route change. Escape restores focus to the trigger.
- Same-page tabs implement arrow-key navigation and selected-state semantics. Route navigation remains ordinary links.
- Icon-only controls require accessible names and visible tooltips or adjacent explanation when meaning is not universal.
- Honor `prefers-reduced-motion`; motion must communicate state and never be required to understand it.

Do not treat an axe pass as proof of usability. Test keyboard flow, focus restoration, zoom, screen-reader announcements, and high-density content manually when the feature changes those behaviors.

## 10. Design responsively by content type

Use layout modes for reading, forms, visualizations, data tables, and builders. Prefer container queries when a component's available width matters more than the viewport.

Verify at least:

- 390×844 is the primary baseline (iPhone 12 to 17e class). 430px wide (Plus/Max class) is the secondary breakpoint.
- 768×1024 tablet.
- 1280×800 laptop.
- 1440×900 desktop.
- 3440×1440 ultra-wide.

At narrow widths, dropdown menus become in-flow panels, tables scroll within labelled containers, settings dialogs remain operable without hidden footer actions, and sticky regions must not consume most of a short viewport. At ultra-wide widths, prose remains readable and dense data may expand.

Fixed or edge-to-edge chrome (sticky headers, bottom action bars, full-screen dialogs) must respect the iOS safe area. Pad it with `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.

## 11. Use the design system rather than local styling

- Use the spacing, type, semantic-color, radius, elevation, and motion tokens in `src/web/index.css`.
- Keep layout spacing on the 4px grid unless visualization geometry requires a specialized value.
- Use semantic state tokens for danger, warning, success, info, and focus. Domain colors, such as a category color, must not double as UI state colors.
- Use shared Button, Notice, Field, TextField, DateField, NumberField, Select, Checkbox, Radio, ChoiceGroup, OptionCards, FilterSummary, Disclosure, StatusMessage, EmptyState, DataTable, and settings-dialog primitives as they become available.
- Do not add hard-coded colors, shadows, arbitrary inline style objects, or one-off disabled/loading behavior in a feature component.
- Keep motion short and functional. Define hover, active, focus, disabled, busy, selected, and error states for every interactive component.
- Keep both light and dark themes complete. A new token or component state is unfinished until both are legible.
- No utility CSS framework (no Tailwind CSS) and no third-party icon library (no Lucide). Icons are inline SVG.
Decided (D-a): Tailwind and Lucide are removed. See WALLEY-UI-SPEC.md section 10.
- Reference colours, spacing, and radii through the native CSS custom properties (for example `var(--surface)`). Component styles contain no literal values for them.

## 12. Keep language and formatting consistent

- All user-facing text lives in co-located `*.messages.ts` catalogues with parity across every supported language.
- Use one term for one feature throughout navigation, headings, buttons, help, and errors.
- Use sentence case for page titles, menu items, labels, and buttons unless a proper name requires otherwise.
- Button labels describe the action and object: **Save subscription**, **Build PDF**, **Clear filters**.
- Avoid implementation words such as cache, payload, provider, register, or op-log in ordinary product copy.
- Pass the current locale into shared formatting helpers. Do not call browser-locale formatting ad hoc inside screens.
- Define and document the display timezone for every timestamp. Include units and use deterministic currency formatting.

## 13. Protect destructive and privacy-sensitive actions

- Prefer reversible deletion with Undo or restore.
- Permanent deletion must name what will be removed, describe sync/server consequences, and require an explicit destructive confirmation.
- Do not use color alone to identify destructive actions.
- Keep account removal, local-data removal, and single-item deletion distinct in language and consequence.
- Explain what leaves the device before a network action and request consent at that action.

## 14. Preserve perceived performance

- A click must produce visual feedback immediately.
- Disable duplicate submissions while preserving the label context, for example **Building PDF…**.
- Use optimistic updates only when rollback is safe and understandable.
- Preserve the previous result while recalculating when stale data is clearly marked.
- Lazy-load route-scale features and heavy export/rendering libraries.
- Avoid layout shift by reserving table and status geometry.
- Do not add a spinner when a stable skeleton, progress label, or retained result communicates more.

## 15. Required implementation review for a new feature

Before considering a UI feature complete, verify:

- [ ] The design follows the target experience rather than copying known design debt from an existing screen.
- [ ] The goal, scope, owner, lifetime, persistence, sync, and reset behavior are documented.
- [ ] Navigation placement follows the canonical hierarchy and adds no third menu level.
- [ ] Each visualization's selection details sit directly after it in DOM order, beside it when space permits and directly below it otherwise; each visualization's type or view choice appears once.
- [ ] Page title identifies the feature and subject.
- [ ] Global, account, device, saved-item, page, and request state are not conflated.
- [ ] Apply, Cancel, Reset, Done, and Set as default have truthful behavior.
- [ ] Related page settings use one coherent form; no nested or duplicate settings surface was added.
- [ ] Loading, empty, zero-result, partial-data, error, offline, and success states are handled.
- [ ] Primary, secondary, and destructive actions have clear visual hierarchy.
- [ ] Keyboard navigation, focus handling, semantic HTML, live announcements, and touch targets work.
- [ ] All supported languages are complete and use existing product terminology.
- [ ] Dates, times, numbers, currencies, and units use shared formatters.
- [ ] The control follows the decision matrix; no raw select/date styling or one-off choice pattern was added.
- [ ] Fields and selection controls use the shared anatomy, and numeric steppers use the standard NumberField buttons and keyboard behavior.
- [ ] Expandable content uses the shared Disclosure pattern and communicates what opens without relying on a triangle, glyph, or color.
- [ ] The feature works at the required viewport matrix in both themes.
- [ ] Meaningful page-specific export actions register and render in that page's content toolbar.
- [ ] Tests cover meaningful route/registry, keyboard/dialog, responsive-overflow, and state behavior affected by the change.
- [ ] Relevant `MAP.md` files and feature metadata are updated.
- [ ] `<check-command>` passes without warnings.

If a feature cannot satisfy a rule because of a product or technical constraint, document the exception and its user impact in the change description. Do not silently introduce a second interaction model.

## 16. Validate the experience with real tasks

Code review and automated accessibility checks cannot establish whether the information architecture is intuitive. Before finalizing a major shell, navigation, settings, or workflow change, test representative tasks with both a newer user and an experienced user:

1. Add a saved item and reach its detail view.
2. Select an item in a visualization; confirm its details appear beside the visualization on a wide layout and directly below it on a narrow layout; then move among the views without losing context.
3. Enter a target date, change a method setting, and filter a list without guessing which control to use.
4. Configure several related settings in one pass; cancel a second settings draft and confirm the page did not change.
5. Switch to another saved item and open the same feature.
6. Change one saved item only, then separately change the user's default.
7. Export the current result, build a document, and create a full-data backup.
8. Recover from incomplete data, a zero-result filter, a calculation failure, and an offline network action.

Use these quality targets:

- The user can identify the active screen, feature, and calculation basis within three seconds.
- Any primary feature is reachable without navigating through more than one expandable group.
- The primary action and current status are visible in the first screenful at 1280×800.
- An interactive visualization's selection feedback remains adjacent on wide layouts and immediately below on narrow layouts, with no unrelated module between them.
- Equivalent fields, selection controls, and number steppers are visually recognizable as the same component on every tested page.
- No user must guess whether a change applies to this view, saved item, account, device, or application.
- Back, reload, and sharing preserve the state users reasonably expect them to preserve.

When product telemetry is appropriate, collect only privacy-respecting interaction events needed to answer a stated UX question, such as failed searches, abandoned setup, or repeated menu detours. Do not capture personal data, credentials, free text, or calculated results. Prefer short usability sessions over permanent analytics when direct observation answers the question.

## 17. Shared rules for the redesign umbrella

These rules apply to every view issue in a redesign umbrella. View issues link here instead of restating them.

### 17.1 Tailwind-to-token mapping

The redesign specs use Tailwind-style class names. The project bans Tailwind (see section 11), so map each name to a token in `src/web/index.css`. Each UI change must note the mapping it used in its description.

| Spec name                               | App token                         |
| --------------------------------------- | --------------------------------- |
| `border-neutral-800`, `border-white/10` | `--line`                          |
| `bg-neutral-900/40`, `bg-neutral-900`   | `--surface` (low-opacity fill)    |
| canvas `#0b0d14`                        | `--bg` (`#0b0c18`)                |
| `rounded-lg`                            | `--radius`                        |
| `font-mono text-xs`                     | `--text-xs` with tabular-nums     |
| `text-neutral-400`                      | `--muted`                         |
| `border-b-2` route indicator            | per the route-indicator spec      |

### 17.2 Mockup gate

- Test sizes: 390×844, 1280×800, and 1440×900.
- Themes: light and dark.
- A static mockup must be reviewed and approved by the owner before any real build starts.
- Mockups are not committed to the repository.

### 17.3 Shared verification

Every UI change in the umbrella must meet these checks:

- `<check-command>` passes with zero warnings.
- The UI primitive enforcement test (not yet implemented; no script in package.json) passes.
- Every new user-facing string has entries in every supported language's `*.messages.ts` catalogue.

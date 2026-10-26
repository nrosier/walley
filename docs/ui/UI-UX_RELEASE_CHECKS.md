# UI/UX manual checks, per release

An axe pass is not proof of usability (`docs/ui/UI-UX_GUIDELINES.md` section 9). Some checks cannot be performed by an automated test. This page is the log of running them, once per release, so the answer to "has anyone actually done this?" is a row in a table and not a belief.

It does not replace the release process. A release with an empty row is not blocked by it, but the row says so, with the reason.

## How to use it

1. Copy the empty table at the end into a new section for the release, headed by the version and the date.
2. Run each check on the built release candidate (`npm run build`, then `npm start` or the Docker image), not on the dev server.
3. Write **Pass**, **Fail** or **Not run** in the Result column, who ran it, and what was seen. A failure becomes an issue before the release; link it.
4. Changes to the shell, navigation, settings or a multi-step workflow also need the representative tasks in section 16 of the guide. Run them with one newer user and one experienced user. Other releases only need the first table.

## Manual checks

| Check                      | How                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Screen reader              | VoiceOver (macOS/iOS) or another supported reader: the main list, one detail view, Preferences, one form with an error.                              |
| Zoom 200 % and text zoom   | Browser zoom to 200 %, and text-only zoom where the browser has it: no clipped text, no sideways scroll except inside a data table.                  |
| Forced colours             | Windows high contrast, or `forced-colors: active` emulated: every control, focus ring and selected state is still visible.                          |
| Touch targets and keyboard | A phone or emulated 390x844: targets are at least 44 px; the software keyboard does not cover the field being typed in.                             |
| Reduced motion             | `prefers-reduced-motion: reduce`: nothing needs motion to be understood.                                                                             |
| Keyboard only              | Tab through the main navigation, one detail view, and Preferences: order follows the layout, focus is always visible, dialogs close on Escape and return focus. |

## Quality targets

Note these against each run: the active screen, feature and calculation basis are found within three seconds; the selected Wallos or Actual Budget item is clearly identified; the primary action and status are in the first screenful at 1280x800.

## Log for a release

Copy this table under a heading such as `### v0.0.0, YYYY-MM-DD`.

| Check or task      | Result | Who | What was seen / issue |
| ------------------ | ------ | --- | --------------------- |
| Screen reader      |        |     |                       |
| Zoom 200 %         |        |     |                       |
| Forced colours     |        |     |                       |
| Touch and keyboard |        |     |                       |
| Reduced motion     |        |     |                       |
| Keyboard only      |        |     |                       |
| Representative tasks, if the change requires them |  |  |  |

## Past releases

None logged yet. Before this page, none of these checks had a log entry.

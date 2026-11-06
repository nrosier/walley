/**
 * Focus return for dialogs opened from a linked row's "More actions" menu (issue 58, N1).
 *
 * The menu item that opened the dialog unmounts as soon as the menu closes, so Radix has no opener to give
 * focus back to and it falls to the page. Each such dialog therefore moves focus itself in `onCloseAutoFocus`:
 * - cancel, Escape, or a failed action: the row still exists, so back to its "More actions for ..." button;
 * - after a confirmed action that removes or rewrites the row (unlink, create, relink): the row's button is
 *   about to go, so the dashboard search box, the stable landmark.
 */

/** The "More actions for ..." button of the linked pair with this match id, or null when the row is gone. */
export function rowMenuTrigger(matchId: string | null): HTMLElement | null {
  if (matchId === null) return null;
  return document.querySelector<HTMLElement>(`[data-linked-match="${CSS.escape(matchId)}"] [aria-haspopup="menu"]`);
}

/** Moves focus to `target`, or to the search box when `target` is null. Leaves Radix's default alone when neither exists. */
export function restoreFocus(event: Event, target: HTMLElement | null): void {
  const next = target ?? document.querySelector<HTMLElement>('input[type="search"]');
  if (next !== null) {
    event.preventDefault();
    next.focus();
  }
}

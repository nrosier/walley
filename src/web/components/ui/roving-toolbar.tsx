import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { FocusEvent, HTMLAttributes, KeyboardEvent } from 'react';

/** Spread on every control that should be one stop of a `RovingToolbar` (plain buttons and the MoreActionsMenu trigger). */
export const rovingItemProps = { 'data-roving-item': '' } as const;

const ITEM_SELECTOR = '[data-roving-item]';

export interface RovingToolbarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'aria-orientation' | 'aria-label'> {
  /** Names the toolbar (for example the row it belongs to). Required: a toolbar without a name is announced poorly. */
  'aria-label': string;
}

/**
 * Horizontal toolbar with a roving tabindex: one Tab stop for the whole group, Left/Right/Home/End move between
 * the items. Items are found by the `data-roving-item` attribute, so any element that forwards it qualifies.
 * tabindex is written on the DOM (not through props) so items need no knowledge of the toolbar.
 * Enter, Space and ArrowDown are never handled here, so a Radix menu trigger still opens.
 */
export function RovingToolbar({ children, onKeyDown, onFocus, ...rest }: RovingToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLElement | null>(null);

  const items = useCallback((): HTMLElement[] => {
    const root = ref.current;
    return root === null ? [] : Array.from(root.querySelectorAll<HTMLElement>(ITEM_SELECTOR));
  }, []);
  const enabledItems = useCallback(
    () => items().filter((el) => !el.hasAttribute('disabled')),
    [items],
  );

  const sync = useCallback(() => {
    const enabled = enabledItems();
    const current = active.current !== null && enabled.includes(active.current) ? active.current : (enabled[0] ?? null);
    active.current = current;
    for (const el of items()) {
      const value = el === current ? '0' : '-1';
      if (el.getAttribute('tabindex') !== value) el.setAttribute('tabindex', value);
    }
  }, [items, enabledItems]);

  // Every render: children may have added, removed or disabled items.
  useLayoutEffect(sync);

  // Items can change without this component re-rendering (a child re-renders on its own).
  useEffect(() => {
    const root = ref.current;
    if (root === null) return undefined;
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => {
      observer.disconnect();
    };
  }, [sync]);

  const handleFocus = (event: FocusEvent<HTMLDivElement>) => {
    onFocus?.(event);
    const target = event.target as HTMLElement;
    if (items().includes(target)) {
      active.current = target;
      sync();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    // React events bubble out of Radix portals: only act on the toolbar's own items.
    const target = event.target as HTMLElement;
    if (!items().includes(target)) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const enabled = enabledItems();
    const index = enabled.indexOf(target);
    let next: HTMLElement | undefined;
    if (event.key === 'ArrowRight') next = index >= 0 ? enabled[index + 1] : undefined;
    else if (event.key === 'ArrowLeft') next = index >= 0 ? enabled[index - 1] : undefined;
    else if (event.key === 'Home') next = enabled[0];
    else if (event.key === 'End') next = enabled[enabled.length - 1];
    else return;
    event.preventDefault();
    if (next !== undefined) next.focus();
  };

  return (
    <div {...rest} ref={ref} role="toolbar" aria-orientation="horizontal" onKeyDown={handleKeyDown} onFocus={handleFocus}>
      {children}
    </div>
  );
}

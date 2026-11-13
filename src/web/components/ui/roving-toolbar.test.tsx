// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n';
import { MoreActionsMenu } from './more-actions-menu';
import { RovingToolbar, rovingItemProps } from './roving-toolbar';

// jsdom lacks these APIs that Radix's menu uses. Local to this file: there is no vitest setup file.
beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  const define = (target: object, name: string, value: unknown) => {
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  };
  define(globalThis, 'ResizeObserver', ResizeObserverStub);
  define(Element.prototype, 'hasPointerCapture', () => false);
  define(Element.prototype, 'setPointerCapture', () => undefined);
  define(Element.prototype, 'releasePointerCapture', () => undefined);
  define(Element.prototype, 'scrollIntoView', () => undefined);
});
afterEach(cleanup);

const tabIndexes = () => screen.getAllByRole('button').map((b) => b.getAttribute('tabindex'));
const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });
const btn = (name: string) => screen.getByRole('button', { name });

function Plain({ disabled = [] as string[], hide = [] as string[] }) {
  return (
    <RovingToolbar aria-label="Row">
      {['a', 'b', 'c'].filter((n) => !hide.includes(n)).map((n) => (
        <button key={n} type="button" disabled={disabled.includes(n)} {...rovingItemProps}>
          {n}
        </button>
      ))}
    </RovingToolbar>
  );
}

describe('RovingToolbar', () => {
  it('renders toolbar semantics and one tab stop, the first enabled item', () => {
    render(<Plain disabled={['a']} />);
    const tb = screen.getByRole('toolbar', { name: 'Row' });
    expect(tb.getAttribute('aria-orientation')).toBe('horizontal');
    expect(btn('a').getAttribute('tabindex')).toBe('-1');
    expect(btn('b').getAttribute('tabindex')).toBe('0');
    expect(btn('c').getAttribute('tabindex')).toBe('-1');
  });

  it('moves with arrows without wrapping, Home and End jump', () => {
    render(<Plain />);
    btn('a').focus();
    key(btn('a'), 'ArrowLeft');
    expect(document.activeElement).toBe(btn('a'));
    key(btn('a'), 'ArrowRight');
    expect(document.activeElement).toBe(btn('b'));
    expect(tabIndexes()).toEqual(['-1', '0', '-1']);
    key(btn('b'), 'ArrowRight');
    key(btn('c'), 'ArrowRight');
    expect(document.activeElement).toBe(btn('c'));
    key(btn('c'), 'Home');
    expect(document.activeElement).toBe(btn('a'));
    key(btn('a'), 'End');
    expect(document.activeElement).toBe(btn('c'));
    expect(tabIndexes()).toEqual(['-1', '-1', '0']);
  });

  it('skips disabled items', () => {
    render(<Plain disabled={['b']} />);
    btn('a').focus();
    key(btn('a'), 'ArrowRight');
    expect(document.activeElement).toBe(btn('c'));
  });

  it('falls back to the first enabled item when the active one is disabled or removed', () => {
    const { rerender } = render(<Plain />);
    btn('c').focus();
    expect(tabIndexes()).toEqual(['-1', '-1', '0']);
    rerender(<Plain disabled={['c']} />);
    expect(tabIndexes()).toEqual(['0', '-1', '-1']);
    rerender(<Plain />);
    btn('b').focus();
    rerender(<Plain hide={['b']} />);
    expect(tabIndexes()).toEqual(['0', '-1']);
  });

  it('recovers when a child changes without the toolbar re-rendering', async () => {
    function Child() {
      const [off, setOff] = useState(false);
      return (
        <>
          <button type="button" disabled={off} {...rovingItemProps}>
            x
          </button>
          <button
            type="button"
            onClick={() => {
              setOff(true);
            }}
          >
            disable
          </button>
        </>
      );
    }
    render(
      <RovingToolbar aria-label="Row">
        <Child />
        <button type="button" {...rovingItemProps}>
          y
        </button>
      </RovingToolbar>,
    );
    expect(btn('x').getAttribute('tabindex')).toBe('0');
    fireEvent.click(btn('disable'));
    await waitFor(() => {
      expect(btn('y').getAttribute('tabindex')).toBe('0');
    });
  });

  it('has no tab stop only when every item is disabled', () => {
    render(<Plain disabled={['a', 'b', 'c']} />);
    expect(tabIndexes().every((v) => v === '-1')).toBe(true);
  });

  it('ignores keys from descendants that are not items', () => {
    render(
      <RovingToolbar aria-label="Row">
        <button type="button" {...rovingItemProps}>
          a
        </button>
        <input aria-label="field" />
        <button type="button" {...rovingItemProps}>
          b
        </button>
      </RovingToolbar>,
    );
    const field = screen.getByRole('textbox', { name: 'field' });
    field.focus();
    for (const k of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(fireEvent.keyDown(field, { key: k })).toBe(true);
      expect(document.activeElement).toBe(field);
    }
  });

  it('does not prevent Enter, Space or ArrowDown', () => {
    render(<Plain />);
    for (const k of ['Enter', ' ', 'ArrowDown']) {
      expect(fireEvent.keyDown(btn('a'), { key: k })).toBe(true);
    }
  });
});

describe('RovingToolbar with MoreActionsMenu', () => {
  const renderMenu = () =>
    render(
      <I18nProvider initialLocale="en">
        <RovingToolbar aria-label="Row">
          <button type="button" {...rovingItemProps}>
            first
          </button>
          <MoreActionsMenu roving name="Netflix" items={[{ id: 'x', label: 'Ignore', onSelect: () => undefined }]} />
          <button type="button" {...rovingItemProps}>
            last
          </button>
        </RovingToolbar>
      </I18nProvider>,
    );
  const trigger = () => screen.getByRole('button', { name: 'More actions for Netflix' });

  it('trigger is a roving stop and keeps aria-haspopup', () => {
    renderMenu();
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu');
    key(btn('first'), 'ArrowRight');
    trigger().focus();
    key(trigger(), 'ArrowRight');
    expect(document.activeElement).toBe(btn('last'));
  });

  it('opens by keyboard, keeps menu arrows out of the toolbar, and Escape returns to the trigger', async () => {
    renderMenu();
    trigger().focus();
    expect(fireEvent.keyDown(trigger(), { key: 'ArrowDown' })).toBe(false); // Radix handles it (it prevents default)
    const item = await screen.findByRole('menuitem', { name: 'Ignore' });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    const before = document.activeElement;
    // Not consumed by the toolbar: the event bubbled out of the portal and must be left alone.
    expect(fireEvent.keyDown(item, { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(item, { key: 'ArrowLeft' })).toBe(true);
    fireEvent.keyDown(item, { key: 'Home' });
    fireEvent.keyDown(item, { key: 'End' });
    expect(document.activeElement).toBe(before);
    expect(document.activeElement).not.toBe(btn('first'));
    expect(document.activeElement).not.toBe(btn('last'));
    fireEvent.keyDown(document.activeElement ?? item, { key: 'Escape' });
    // Radix's FocusScope returns focus in a setTimeout(0) on unmount.
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger());
    });
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(trigger().getAttribute('tabindex')).toBe('0');
  });
});

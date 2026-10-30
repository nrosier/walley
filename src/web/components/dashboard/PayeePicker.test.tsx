// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { PayeePicker } from './CreateActualModal';
import { NEW_PAYEE } from './create-submit';

// Rendered tests for the payee popover (issue #146). Runs in jsdom via the per-file pragma above;
// the rest of the suite stays on the node environment.

const payees = [
  { id: 'p1', name: 'NETFLIX.COM' },
  { id: 'p2', name: 'Spotify AB' },
  { id: 'p3', name: 'netflix Kids' },
  { id: 'p4', name: 'Ray & Jules' },
];

const NEW_LABEL = 'Create new payee';
const NO_MATCH = 'No payees match your search.';

/** Wraps PayeePicker in the real provider and keeps `value` in state, like the form does. */
function Harness({ onValueChange, initial = NEW_PAYEE }: { onValueChange: (v: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <I18nProvider initialLocale="en">
      <PayeePicker
        payees={payees}
        value={value}
        onValueChange={(v) => {
          onValueChange(v);
          setValue(v);
        }}
      />
    </I18nProvider>
  );
}

function openPicker(): HTMLElement {
  const trigger = screen.getByRole('button', { name: /Payee/ });
  fireEvent.click(trigger);
  return screen.getByRole('combobox', { name: 'Search payees' });
}

function optionLabels(): string[] {
  return screen.queryAllByRole('option').map((o) => o.textContent);
}

afterEach(() => {
  cleanup();
});

describe('PayeePicker rendered (issue #146)', () => {
  it('opens with the search input focused and every option listed', () => {
    render(<Harness onValueChange={vi.fn()} />);
    const input = openPicker();
    expect(document.activeElement).toBe(input);
    expect(optionLabels()).toEqual([NEW_LABEL, 'NETFLIX.COM', 'Spotify AB', 'netflix Kids', 'Ray & Jules']);
  });

  it('1. typing filters options by name, case-insensitively', () => {
    render(<Harness onValueChange={vi.fn()} />);
    const input = openPicker();
    fireEvent.change(input, { target: { value: 'netf' } });
    // "Create new payee" stays first; only the two Netflix payees match.
    expect(optionLabels()).toEqual([NEW_LABEL, 'NETFLIX.COM', 'netflix Kids']);
    expect(screen.queryByText('Spotify AB')).toBeNull();
    expect(screen.queryByText(NO_MATCH)).toBeNull();
  });

  it('2. a query with no match shows the no-match message and keeps Create new payee', () => {
    render(<Harness onValueChange={vi.fn()} />);
    const input = openPicker();
    fireEvent.change(input, { target: { value: 'zzqx' } });
    expect(screen.getByText(NO_MATCH)).toBeTruthy();
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: NEW_LABEL })).toBeTruthy();
    expect(within(listbox).queryAllByRole('option')).toHaveLength(1);
  });

  it('3. selecting an existing payee calls onValueChange with its id and closes the popover', () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    openPicker();
    fireEvent.click(screen.getByRole('option', { name: 'Ray & Jules' }));
    expect(onValueChange).toHaveBeenCalledWith('p4');
    expect(screen.queryByRole('combobox', { name: 'Search payees' })).toBeNull();
    // The trigger shows the chosen name.
    expect(screen.getByRole('button', { name: /Ray & Jules/ })).toBeTruthy();
  });

  it('4a. keyboard: ArrowDown moves the active option and Enter selects it', () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);
    const input = openPicker();
    const first = input.getAttribute('aria-activedescendant');
    expect(first).toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const second = input.getAttribute('aria-activedescendant');
    expect(second).not.toBe(first);
    const activeEl = document.getElementById(second ?? '');
    expect(activeEl?.textContent).toBe('NETFLIX.COM');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).toHaveBeenCalledWith('p1');
    expect(screen.queryByRole('combobox', { name: 'Search payees' })).toBeNull();
  });

  it('4b. keyboard: Escape closes the popover and focus returns to the trigger', async () => {
    render(<Harness onValueChange={vi.fn()} />);
    const input = openPicker();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: 'Search payees' })).toBeNull();
    // Radix moves focus back to the trigger after unmount, on a deferred tick.
    const trigger = screen.getByRole('button', { name: /Payee/ });
    await waitFor(() => { expect(document.activeElement).toBe(trigger); });
  });

  it('5. selecting Create new payee calls onValueChange with NEW_PAYEE', () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} initial="p2" />);
    openPicker();
    fireEvent.click(screen.getByRole('option', { name: NEW_LABEL }));
    expect(onValueChange).toHaveBeenCalledWith(NEW_PAYEE);
    expect(onValueChange).toHaveBeenCalledWith('__new__');
  });
});

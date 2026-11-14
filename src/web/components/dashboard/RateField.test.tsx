// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/i18n';
import { RateField } from './RateField';

// Issue 223: Enter in the rate input saves. RateField also sits inside the Create modal's <form>, so it must not
// render a form of its own, and Enter must not submit the surrounding form.

afterEach(cleanup);

const prefill = { sourceCurrency: 'USD', baseCurrency: 'EUR', overrideRate: null, wallosRate: '2' };

function setup(onSubmit: () => void) {
  const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ wallosSubscriptionId: 'w1', rate: '1.5', resetMatches: 0 })));
  const onChanged = vi.fn();
  const view = render(
    <I18nProvider initialLocale="en">
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <RateField prefill={prefill} wallosId="w1" fetchImpl={fetchImpl} onChanged={onChanged} />
      </form>
    </I18nProvider>,
  );
  return { view, fetchImpl, onChanged };
}

describe('RateField inside a form', () => {
  it('renders no nested form', () => {
    const { view } = setup(() => undefined);
    expect(view.container.querySelectorAll('form')).toHaveLength(1);
  });

  it('Enter saves once and cancels the default, so the surrounding form is not submitted', async () => {
    const onSubmit = vi.fn();
    const { view, fetchImpl, onChanged } = setup(onSubmit);
    const input = view.getByLabelText('Rate (USD to EUR)');
    fireEvent.change(input, { target: { value: '1.5' } });
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    await waitFor(() => { expect(onChanged).toHaveBeenCalledTimes(1); });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Enter during IME composition does not save', () => {
    const { view, fetchImpl } = setup(() => undefined);
    const input = view.getByLabelText('Rate (USD to EUR)');
    fireEvent.change(input, { target: { value: '1.5' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('locked: input is read-only and Save and Clear send nothing', () => {
    const fetchImpl = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({})));
    const view = render(
      <I18nProvider initialLocale="en">
        <RateField prefill={{ ...prefill, overrideRate: '3' }} wallosId="w1" fetchImpl={fetchImpl} locked />
      </I18nProvider>,
    );
    const input = view.getByLabelText('Rate (USD to EUR)') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    fireEvent.click(view.getByRole('button', { name: 'Save rate' }));
    fireEvent.click(view.getByRole('button', { name: 'Clear' }));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Enter with an empty value sends nothing and still does not submit the form', () => {
    const onSubmit = vi.fn();
    const { view, fetchImpl } = setup(onSubmit);
    const input = view.getByLabelText('Rate (USD to EUR)');
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

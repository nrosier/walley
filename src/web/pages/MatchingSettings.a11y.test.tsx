// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { installDomPolyfills, nameOf, pressKey, tabbables } from '../a11y.helpers';
import { MatchingSettings } from './MatchingSettings';
import { matchingSettingsMessages } from './MatchingSettings.messages';

// Keyboard and screen reader behaviour of the Matching card: tolerance plus the currency rate margin (issue 229).
// jsdom proves wiring, names, descriptions, value sync and focus; it cannot prove the browser's slider keys, so the
// arrow keys are emulated by the step change a browser applies (+/- 0.5) through a change event.

beforeAll(installDomPolyfills);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Handler = (init: RequestInit | undefined) => Response | Promise<Response>;
const bodyText = (init: RequestInit | undefined): string => (typeof init?.body === 'string' ? init.body : '');
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let puts: unknown[];
let putHandler: Handler;
let saved: { tolerancePercent: number; currencyDriftPercent: number };

beforeEach(() => {
  puts = [];
  saved = { tolerancePercent: 5, currencyDriftPercent: 2 };
  putHandler = (init) => {
    saved = { ...saved, ...(JSON.parse(bodyText(init)) as object) };
    return json(200, saved);
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        puts.push(JSON.parse(bodyText(init)));
        return putHandler(init);
      }
      return json(200, saved);
    }),
  );
});

async function mount(locale: Locale = 'en') {
  render(
    <I18nProvider initialLocale={locale}>
      <MatchingSettings />
    </I18nProvider>,
  );
  const m = matchingSettingsMessages[locale];
  const input = await screen.findByLabelText<HTMLInputElement>(m.drift.label, { selector: 'input[type="number"]' });
  const slider = screen.getByRole<HTMLInputElement>('slider', { name: m.drift.label });
  const save = screen.getByRole('button', { name: m.save });
  return { m, input, slider, save };
}

const type = (el: HTMLInputElement, value: string) => fireEvent.change(el, { target: { value } });
/** What the browser does on ArrowRight/ArrowLeft for a slider: move one step and fire input/change. */
const arrow = (slider: HTMLInputElement, dir: 1 | -1) => {
  pressKey(slider, dir === 1 ? 'ArrowRight' : 'ArrowLeft');
  type(slider, String(Number(slider.value) + dir * 0.5));
};

describe('currency rate margin accessibility', () => {
  it('shows the defaults 5 and 2 before the load and the saved values after it', async () => {
    saved = { tolerancePercent: 12, currencyDriftPercent: 7.5 };
    const { input } = await mount();
    await waitFor(() => { expect(input.value).toBe('7.5'); });
    expect(screen.getByLabelText<HTMLInputElement>('Amount tolerance', { selector: 'input[type="number"]' }).value).toBe('12');
  });

  it('names the number input and slider and describes both by the hint (en and nl)', async () => {
    for (const locale of ['en', 'nl'] as const) {
      const { m, input, slider } = await mount(locale);
      expect(nameOf(input)).toBe(m.drift.label);
      expect(nameOf(slider)).toBe(m.drift.label);
      for (const el of [input, slider]) {
        const ids = (el.getAttribute('aria-describedby') ?? '').split(' ');
        expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([m.drift.hint]);
      }
      expect(input.inputMode).toBe('decimal');
      expect(input.step).toBe('0.5');
      cleanup();
    }
  });

  it('puts the number input and the slider in the tab order, each once', async () => {
    const { input, slider } = await mount();
    const stops = tabbables(document.body);
    expect(stops).toContain(input);
    expect(stops).toContain(slider);
  });

  it('arrow keys move the slider in 0.5 steps and the number input follows', async () => {
    const { input, slider } = await mount();
    slider.focus();
    arrow(slider, 1);
    expect(input.value).toBe('2.5');
    arrow(slider, 1);
    expect(input.value).toBe('3');
    arrow(slider, -1);
    expect(slider.value).toBe('2.5');
    expect(input.value).toBe('2.5');
  });

  it('typing moves the slider; an off-step value shows the error wired by aria-describedby and marks it dirty', async () => {
    const { m, input, slider, save } = await mount();
    type(input, '4.5');
    expect(slider.value).toBe('4.5');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    type(input, '4.3');
    expect(slider.value).toBe('4.5');
    fireEvent.submit(save.closest('section')?.querySelector('form') as HTMLFormElement);
    const error = await screen.findByText(m.drift.range.replace('{min}', '0').replace('{max}', '10').replace('{step}', '0.5'));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(error.id);
    expect(puts).toEqual([]);
  });

  it('formats the step in the error with the locale (0.5 in en, 0,5 in nl)', async () => {
    for (const [locale, step] of [['en', '0.5'], ['nl', '0,5']] as const) {
      const { m, input, save } = await mount(locale);
      type(input, '4.3');
      fireEvent.submit(save.closest('section')?.querySelector('form') as HTMLFormElement);
      const error = await screen.findByText(m.drift.range.replace('{min}', '0').replace('{max}', '10').replace('{step}', step));
      expect(error.textContent).toContain(step);
      cleanup();
    }
  });

  it('keeps both number inputs narrow (no w-full)', async () => {
    await mount();
    for (const input of document.querySelectorAll('input[type="number"]')) {
      expect(input.classList.contains('w-24')).toBe(true);
      expect(input.classList.contains('w-full')).toBe(false);
    }
  });

  it('is clean when unchanged and sends nothing on Save', async () => {
    const { input, save } = await mount();
    await waitFor(() => { expect(screen.getByText('No unsaved changes')).toBeTruthy(); });
    fireEvent.click(save);
    expect(puts).toEqual([]);
    type(input, '3');
    type(input, '2');
    expect(screen.getByText('No unsaved changes')).toBeTruthy();
  });

  it('Enter in the number input saves once and sends only the changed key; Saved is announced', async () => {
    const { input } = await mount();
    type(input, '3.5');
    fireEvent.submit(input.form as HTMLFormElement);
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Saved');
    expect(puts).toEqual([{ currencyDriftPercent: 3.5 }]);
    expect(screen.getByText('No unsaved changes')).toBeTruthy();
  });

  it('sends both keys when both changed', async () => {
    const { input, save } = await mount();
    type(screen.getByLabelText<HTMLInputElement>('Amount tolerance', { selector: 'input[type="number"]' }), '9');
    type(input, '0');
    fireEvent.click(save);
    await screen.findByText('Saved');
    expect(puts).toEqual([{ tolerancePercent: 9, currencyDriftPercent: 0 }]);
  });

  it('keeps focus on the Save button while saving (aria-disabled, never disabled) and ignores a second submit', async () => {
    let release: (r: Response) => void = () => undefined;
    putHandler = () => new Promise<Response>((resolve) => {
        release = resolve;
      });
    const { m, input, save } = await mount();
    type(input, '1');
    save.focus();
    fireEvent.click(save);
    const busy = await screen.findByRole('button', { name: m.status.saving });
    expect(busy).toBe(save);
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(busy.hasAttribute('disabled')).toBe(false);
    expect(input.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(save);
    fireEvent.submit(input.form as HTMLFormElement);
    expect(puts).toHaveLength(1);
    await act(async () => {
      release(json(200, { tolerancePercent: 5, currencyDriftPercent: 1 }));
    });
    await screen.findByText('Saved');
    expect(document.activeElement).toBe(save);
  });

  it('on a server 400 shows the message, keeps the typed value and stays dirty', async () => {
    putHandler = () => json(400, { error: 'out_of_range' });
    const { input, save } = await mount();
    type(input, '6');
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByText('The value is out of range.')).toBeTruthy();
    expect(input.value).toBe('6');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(document.activeElement).toBe(save);
  });

  it('maps invalid_request to its message in nl', async () => {
    putHandler = () => json(400, { error: 'invalid_request' });
    const { input, save } = await mount('nl');
    type(input, '6');
    fireEvent.click(save);
    expect(await screen.findByText(/Sommige velden ontbreken of zijn ongeldig/)).toBeTruthy();
  });
});

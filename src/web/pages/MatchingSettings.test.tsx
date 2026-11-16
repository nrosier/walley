import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import {
  DEFAULT_TOLERANCE_PERCENT,
  MatchingSettings,
  MatchingSettingsView,
  loadMatching,
  loadTolerance,
  parseCurrencyDrift,
  parseTolerance,
  saveMatching,
  saveTolerance,
} from './MatchingSettings';
import matchingSrc from './MatchingSettings.tsx?raw';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const fakeFetch = (response: Response) => vi.fn(async () => response.clone()) as unknown as typeof fetch;

const renderView = (props: Partial<Parameters<typeof MatchingSettingsView>[0]> = {}, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <MatchingSettingsView
        text="5"
        sliderValue={5}
        invalid={false}
        driftText="2"
        driftSliderValue={2}
        driftInvalid={false}
        status="idle"
        {...props}
      />
    </I18nProvider>,
  );

const tagOf = (html: string, pattern: RegExp) => pattern.exec(html)?.[0] ?? '';

describe('parseTolerance', () => {
  it('accepts whole and fractional numbers from 0 to 50 inclusive', () => {
    expect(parseTolerance('0')).toBe(0);
    expect(parseTolerance('50')).toBe(50);
    expect(parseTolerance(' 7.5 ')).toBe(7.5);
  });
  it('rejects out-of-range, empty and non-numeric input', () => {
    expect(parseTolerance('-1')).toBeNull();
    expect(parseTolerance('50.1')).toBeNull();
    expect(parseTolerance('')).toBeNull();
    expect(parseTolerance('abc')).toBeNull();
  });
});

describe('MatchingSettings view', () => {
  it('renders the heading in an h2 inside a labelled section (en)', () => {
    const html = renderView();
    expect(html).toContain('<section');
    expect(html).toContain('aria-labelledby="matching-settings-heading"');
    expect(html).toMatch(/<h2 id="matching-settings-heading"[^>]*>Matching<\/h2>/);
  });

  it('input and slider share one label and the same value', () => {
    const html = renderView({ text: '12', sliderValue: 12 });
    const label = tagOf(html, /<label[^>]*>/);
    const labelId = /id="([^"]+)"/.exec(label)?.[1] ?? '';
    expect(labelId).not.toBe('');
    const input = tagOf(html, /<input[^>]*type="number"[^>]*>/);
    const slider = tagOf(html, /<input[^>]*type="range"[^>]*>/);
    expect(input).toContain('value="12"');
    expect(input).toContain('min="0"');
    expect(input).toContain('max="50"');
    expect(input).toContain('step="1"');
    expect(slider).toContain('value="12"');
    expect(slider).toContain(`aria-labelledby="${labelId}"`);
    expect(slider).toContain('min="0"');
    expect(slider).toContain('max="50"');
    expect(html).toContain('font-mono');
  });

  it('shows the inline range error and marks the input invalid', () => {
    const html = renderView({ text: '70', invalid: true });
    expect(html).toContain('Enter a value from 0 to 50.');
    expect(tagOf(html, /<input[^>]*type="number"[^>]*>/)).toContain('aria-invalid="true"');
    expect(html).toContain('text-danger');
    expect(tagOf(html, /<input[^>]*type="number"[^>]*>/)).toContain('border-danger-line');
    expect(html).not.toContain('text-warning');
  });

  it('shows Saving, Saved and an error text in the status line', () => {
    expect(renderView({ status: 'saving' })).toContain('Saving...');
    expect(renderView({ status: 'saved' })).toContain('Saved');
    expect(renderView({ status: 'error', message: 'The value is out of range.' })).toContain(
      'The value is out of range.',
    );
  });

  it('renders Dutch strings from the nl catalogue', () => {
    const html = renderView({}, 'nl');
    expect(html).toMatch(/<h2 id="matching-settings-heading"[^>]*>Koppeling<\/h2>/);
    expect(html).toContain('Toegestane afwijking bedrag');
  });

  it('the connected component renders with the default value while loading', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <MatchingSettings />
      </I18nProvider>,
    );
    expect(html).toContain(`value="${String(DEFAULT_TOLERANCE_PERCENT)}"`);
  });
});

describe('loadTolerance', () => {
  it('returns the saved value from GET', async () => {
    const fetchImpl = fakeFetch(json(200, { tolerancePercent: 12 }));
    await expect(loadTolerance({ fetchImpl })).resolves.toBe(12);
  });
});

describe('saveTolerance', () => {
  it('sends an out-of-range value to nothing: no fetch call', async () => {
    const fetchImpl = fakeFetch(json(200, { tolerancePercent: 5 }));
    await expect(saveTolerance('70', fetchImpl)).resolves.toEqual({ kind: 'invalid' });
    await expect(saveTolerance('-0.5', fetchImpl)).resolves.toEqual({ kind: 'invalid' });
    await expect(saveTolerance('nope', fetchImpl)).resolves.toEqual({ kind: 'invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('PUTs a valid value and returns the saved value', async () => {
    const fetchImpl = fakeFetch(json(200, { tolerancePercent: 8 }));
    await expect(saveTolerance('8', fetchImpl)).resolves.toEqual({ kind: 'saved', value: 8 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit];
    expect(path).toBe('/api/settings/matching');
    expect(init.method).toBe('PUT');
    expect(init.body).toBe(JSON.stringify({ tolerancePercent: 8 }));
  });

  it('returns the server out_of_range code', async () => {
    const fetchImpl = fakeFetch(json(400, { error: 'out_of_range' }));
    await expect(saveTolerance('50', fetchImpl)).resolves.toEqual({ kind: 'error', code: 'out_of_range' });
  });

  it('falls back to request_failed when the request itself fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    await expect(saveTolerance('10', fetchImpl)).resolves.toEqual({ kind: 'error', code: 'request_failed' });
  });
});

describe('MatchingSettings card', () => {
  it('turns native constraint validation off so the app\'s own range and step errors can show', () => {
    expect(tagOf(renderView({}), /<form[^>]*id="matching-settings-form"[^>]*>/)).toMatch(/novalidate/i);
  });

  it('saves only through the footer Save (no save on blur or slider release) and shows the unsaved status', () => {
    const html = renderView({ dirty: true });
    expect(html).toContain('Unsaved changes');
    expect(html).toContain('form="matching-settings-form"');
    expect(html).toContain('>Save Matching<');
    expect(html).toContain('data-scope="account"');
    expect(renderView({ dirty: false })).toContain('No unsaved changes');
    expect(matchingSrc).not.toMatch(/onBlur|onPointerUp|onKeyUp/);
  });
});

describe('parseCurrencyDrift', () => {
  it('accepts multiples of 0.5 from 0 to 10 inclusive', () => {
    expect(parseCurrencyDrift('0')).toBe(0);
    expect(parseCurrencyDrift('0.5')).toBe(0.5);
    expect(parseCurrencyDrift(' 2 ')).toBe(2);
    expect(parseCurrencyDrift('10')).toBe(10);
  });
  it('rejects off-step, out-of-range, empty and non-numeric input', () => {
    for (const raw of ['0.3', '2.25', '-0.5', '10.5', '11', '', 'abc', 'Infinity']) {
      expect(parseCurrencyDrift(raw), raw).toBeNull();
    }
  });
});

describe('currency rate margin control (markup)', () => {
  const driftInput = (html: string) => tagOf(html, /<input[^>]*name="currencyDriftPercent"[^>]*>/);

  it('renders a decimal number input and a slider from 0 to 10 in steps of 0.5, defaults 5 and 2', () => {
    const html = renderView();
    const input = driftInput(html);
    expect(input).toContain('value="2"');
    expect(input).toContain('inputMode="decimal"');
    expect(input).toContain('min="0"');
    expect(input).toContain('max="10"');
    expect(input).toContain('step="0.5"');
    expect(input).toContain('font-mono');
    expect(tagOf(html, /<input[^>]*name="tolerancePercent"[^>]*>/)).toContain('value="5"');
    const sliders = html.match(/<input[^>]*type="range"[^>]*>/g) ?? [];
    expect(sliders).toHaveLength(2);
    expect(sliders[1]).toContain('max="10"');
    expect(sliders[1]).toContain('step="0.5"');
    expect(sliders[1]).toContain('aria-describedby="matching-drift-hint"');
  });

  it('shows the label and hint in en and nl, and the error wired by aria-describedby', () => {
    const en = renderView({ driftInvalid: true, driftText: '2.3' });
    expect(en).toContain('Currency rate margin');
    expect(en).toContain('or 2 minor units of the budget currency (2 cents for EUR), whichever is larger');
    expect(en).toContain('0 turns the margin off');
    expect(en).toContain('Enter a value from 0 to 10 in steps of 0.5.');
    expect(driftInput(en)).toContain('aria-describedby="matching-drift-error matching-drift-hint"');
    expect(driftInput(en)).toContain('border-danger-line');
    const nl = renderView({}, 'nl');
    expect(nl).toContain('Marge wisselkoers');
    expect(nl).toContain('Met 0 staat de marge uit');
  });
});

describe('saveMatching', () => {
  const sent = (fetchImpl: typeof fetch) =>
    (vi.mocked(fetchImpl).mock.calls[0] as unknown as [string, RequestInit])[1].body;
  const both = { tolerancePercent: 5, currencyDriftPercent: 3 };

  it('sends only the changed key', async () => {
    const fetchImpl = fakeFetch(json(200, both));
    await expect(saveMatching({ currencyDrift: '3' }, fetchImpl)).resolves.toEqual({ kind: 'saved', values: both });
    expect(sent(fetchImpl)).toBe(JSON.stringify({ currencyDriftPercent: 3 }));
  });

  it('sends nothing when no key is given or a value is invalid', async () => {
    const fetchImpl = fakeFetch(json(200, both));
    await expect(saveMatching({}, fetchImpl)).resolves.toEqual({ kind: 'invalid' });
    await expect(saveMatching({ tolerance: '5', currencyDrift: '2.3' }, fetchImpl)).resolves.toEqual({ kind: 'invalid' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns the server out_of_range and invalid_request codes', async () => {
    await expect(saveMatching({ currencyDrift: '10' }, fakeFetch(json(400, { error: 'out_of_range' })))).resolves.toEqual({
      kind: 'error',
      code: 'out_of_range',
    });
    await expect(saveMatching({ currencyDrift: '10' }, fakeFetch(json(400, { error: 'invalid_request' })))).resolves.toEqual({
      kind: 'error',
      code: 'invalid_request',
    });
  });

  it('loadMatching returns both values', async () => {
    await expect(loadMatching({ fetchImpl: fakeFetch(json(200, both)) })).resolves.toEqual(both);
  });
});

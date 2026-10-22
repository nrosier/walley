import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import {
  DEFAULT_TOLERANCE_PERCENT,
  MatchingSettings,
  MatchingSettingsView,
  loadTolerance,
  parseTolerance,
  saveTolerance,
} from './MatchingSettings';

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

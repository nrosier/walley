import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n';
import { loadedSettings, runConnectionTest, WallosSettingsView } from './WallosSettings';
import { wallosSettingsMessages } from './WallosSettings.messages';

const HELP_EN = 'Test Connection uses your saved settings. Save first.';
const HELP_NL = 'Verbinding testen gebruikt uw opgeslagen instellingen. Sla eerst op.';

/** Renders the view inside a provider so useT resolves the given locale. */
function render(locale: 'en' | 'nl', props: Parameters<typeof WallosSettingsView>[0]) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <WallosSettingsView {...props} />
    </I18nProvider>,
  );
}

const fakeFetch = (status: number, body: unknown): typeof fetch => () =>
  Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

describe('WallosSettingsView', () => {
  it('renders labelled fields, help text and the Test Connection button', () => {
    const html = render('en', { url: 'https://w.example', apiKey: '', hasKey: true });
    expect(html).toContain('for="wallos-url"');
    expect(html).toContain('Wallos URL');
    expect(html).toContain('for="wallos-api-key"');
    expect(html).toContain('Wallos API key');
    expect(html).toContain('Test Connection');
    expect(html).toContain('>Save<');
    expect(html).toContain(HELP_EN);
  });

  it('key field is a password input and is never prefilled', () => {
    const saved = render('en', { url: '', apiKey: '', hasKey: true });
    const tag = /<input[^>]*id="wallos-api-key"[^>]*>/.exec(saved)?.[0] ?? '';
    expect(tag).toContain('type="password"');
    expect(tag).not.toMatch(/value="[^"]+"/);
  });

  it('shows the masked indicator only when a key is saved and the input is empty', () => {
    const mask = wallosSettingsMessages.en.apiKeySaved;
    expect(render('en', { url: '', apiKey: '', hasKey: true })).toContain(mask);
    expect(render('en', { url: '', apiKey: '', hasKey: false })).not.toContain(mask);
    expect(render('en', { url: '', apiKey: 'typed', hasKey: true })).not.toContain(mask);
  });

  it('shows testing and result states with theme tokens', () => {
    const base = { url: '', apiKey: '', hasKey: true } as const;
    expect(render('en', { ...base, test: { kind: 'testing' } })).toContain('Testing...');
    const ok = render('en', { ...base, test: { kind: 'ok' } });
    expect(ok).toContain('Connection OK.');
    expect(ok).toContain('text-success');
    const err = render('en', { ...base, test: { kind: 'error', code: 'wallos_auth_failed' } });
    expect(err).toContain('Wallos rejected the API key. Check the key and try again.');
    expect(err).toContain('text-warning');
  });

  it('status region is a polite live region', () => {
    const html = render('en', { url: '', apiKey: '', hasKey: false });
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
  });

  it('renders the Dutch help text and labels', () => {
    const html = render('nl', { url: '', apiKey: '', hasKey: true });
    expect(html).toContain(HELP_NL);
    expect(html).toContain('Opslaan');
    expect(html).toContain('Verbinding testen');
    expect(html).not.toContain(HELP_EN);
  });
});

describe('loadedSettings', () => {
  it('takes only the URL and key flag from a response', () => {
    const response = { wallosUrl: 'https://w.example', hasWallosApiKey: true };
    const loaded = loadedSettings(response);
    expect(loaded).toEqual({ url: 'https://w.example', hasKey: true });
    expect(Object.keys(loaded)).toEqual(['url', 'hasKey']);
  });
});

describe('runConnectionTest', () => {
  it('reports success when the test endpoint answers 200', async () => {
    const state = await runConnectionTest(fakeFetch(200, { ok: true }));
    expect(state).toEqual({ kind: 'ok' });
  });

  it('maps a server error code from the response', async () => {
    const state = await runConnectionTest(fakeFetch(502, { error: 'wallos_unavailable' }));
    expect(state).toEqual({ kind: 'error', code: 'wallos_unavailable' });
  });

  it('falls back to request_failed when the error has no code', async () => {
    const failing: typeof fetch = () => Promise.reject(new TypeError('network down'));
    const state = await runConnectionTest(failing);
    expect(state).toEqual({ kind: 'error', code: 'request_failed' });
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n';
import { loadedSettings, runConnectionTest, WallosSettingsView } from './WallosSettings';
import wallosSrc from './WallosSettings.tsx?raw';
import { wallosSettingsMessages } from './WallosSettings.messages';

const TYPED = { url: 'https://w.example', apiKey: '' };

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
  it('renders labelled fields and the Test Connection button', () => {
    const html = render('en', { url: 'https://w.example', apiKey: '', hasKey: true });
    expect(html).toContain('for="wallos-url"');
    expect(html).toContain('Wallos URL');
    expect(html).toContain('for="wallos-api-key"');
    expect(html).toContain('Wallos API key');
    expect(html).toContain('Test Connection');
    expect(html).toContain('>Save Wallos<');
    expect(html).not.toContain('Save first');
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
    expect(err).toContain('text-danger');
    expect(err).not.toContain('text-warning');
  });

  it('status region is a polite live region', () => {
    const html = render('en', { url: '', apiKey: '', hasKey: false });
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
  });

  it('renders the Dutch labels', () => {
    const html = render('nl', { url: '', apiKey: '', hasKey: true });
    expect(html).not.toContain('Sla eerst op');
    expect(html).toContain('Wallos opslaan');
    expect(html).toContain('Verbinding testen');
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
    const state = await runConnectionTest(TYPED, fakeFetch(200, { ok: true }));
    expect(state).toEqual({ kind: 'ok' });
  });

  it('maps a server error code from the response', async () => {
    const state = await runConnectionTest(TYPED, fakeFetch(502, { error: 'wallos_unavailable' }));
    expect(state).toEqual({ kind: 'error', code: 'wallos_unavailable' });
  });

  it('falls back to request_failed when the error has no code', async () => {
    const failing: typeof fetch = () => Promise.reject(new TypeError('network down'));
    const state = await runConnectionTest(TYPED, failing);
    expect(state).toEqual({ kind: 'error', code: 'request_failed' });
  });
});

describe('WallosSettingsView card', () => {
  it('is a card with the account scope pill and one footer Save with the unsaved status', () => {
    const clean = render('en', { url: '', apiKey: '', hasKey: true });
    expect(clean).toContain('data-scope="account"');
    expect(clean).toContain('No unsaved changes');
    expect(clean.match(/type="submit"/g)).toHaveLength(1);
    expect(clean).toContain('form="wallos-settings-form"');
    const dirty = render('en', { url: '', apiKey: 'typed', hasKey: true, dirty: true });
    expect(dirty).toContain('Unsaved changes');
    expect(dirty).not.toContain('No unsaved changes');
  });
});

describe('Test connection sends the typed values (issue 134)', () => {
  function capture() {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const impl = ((url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    }) as typeof fetch;
    return { impl, calls };
  }

  it('The "Save first" helper text can then be removed', () => {
    for (const locale of ['en', 'nl'] as const) {
      expect(JSON.stringify(wallosSettingsMessages[locale])).not.toMatch(/save first|sla eerst op/i);
    }
    expect(Object.keys(wallosSettingsMessages.en)).toEqual(Object.keys(wallosSettingsMessages.nl));
    expect(Object.keys(wallosSettingsMessages.en)).not.toContain('help');
    expect(wallosSrc).not.toContain("t('help')");
  });

  it('posts the typed URL and key in the body, and only what is typed', async () => {
    const { impl, calls } = capture();
    await runConnectionTest({ url: 'https://typed.example', apiKey: 'typed-key' }, impl);
    expect(calls[0]).toMatchObject({
      url: '/api/settings/wallos/test',
      method: 'POST',
      body: { wallosUrl: 'https://typed.example', apiKey: 'typed-key' },
    });
    await runConnectionTest({ url: '  ', apiKey: '' }, impl);
    expect(calls[1]?.body).toEqual({});
  });

  it('the Test Connection handler passes the form state and keeps nothing afterwards', () => {
    const handler = wallosSrc.slice(wallosSrc.indexOf('const runTest'), wallosSrc.indexOf('return (\n    <WallosSettingsView'));
    expect(handler).toContain('runConnectionTest({ url, apiKey })');
    expect(handler).not.toContain('setApiKey');
    expect(handler).not.toMatch(/localStorage|sessionStorage/);
  });
});

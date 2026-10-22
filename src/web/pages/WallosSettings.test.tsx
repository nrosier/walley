import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WallosSettings, WallosSettingsView } from './WallosSettings';

describe('WallosSettings', () => {
  it('renders labelled fields and the Test Connection button', () => {
    const html = renderToStaticMarkup(<WallosSettingsView url="https://w.example" apiKey="" hasKey />);
    expect(html).toContain('for="wallos-url"');
    expect(html).toContain('Wallos URL');
    expect(html).toContain('for="wallos-api-key"');
    expect(html).toContain('Wallos API key');
    expect(html).toContain('Test Connection');
    expect(html).toContain('>Save<');
  });
  it('key field is a password input, never prefilled, placeholder only when saved', () => {
    const saved = renderToStaticMarkup(<WallosSettingsView url="" apiKey="" hasKey />);
    const tag = /<input[^>]*id="wallos-api-key"[^>]*>/.exec(saved)?.[0] ?? '';
    expect(tag).toContain('type="password"');
    expect(tag).toContain('placeholder="Saved - leave blank to keep"');
    expect(tag).not.toMatch(/value="[^"]+"/);
    const fresh = renderToStaticMarkup(<WallosSettingsView url="" apiKey="" hasKey={false} />);
    expect(fresh).not.toContain('Saved - leave blank');
  });
  it('shows testing and result states', () => {
    const base = { url: '', apiKey: '', hasKey: true } as const;
    expect(renderToStaticMarkup(<WallosSettingsView {...base} test={{ kind: 'testing' }} />)).toContain('Testing...');
    expect(renderToStaticMarkup(<WallosSettingsView {...base} test={{ kind: 'ok' }} />)).toContain('Connection OK');
    expect(
      renderToStaticMarkup(<WallosSettingsView {...base} test={{ kind: 'error', code: 'wallos_auth_failed' }} />),
    ).toContain('rejected the API key');
  });
  it('the connected component renders without a prefilled key', () => {
    expect(renderToStaticMarkup(<WallosSettings />)).toContain('type="password"');
  });
});

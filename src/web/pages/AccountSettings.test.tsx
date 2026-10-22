import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountSettingsView, OIDC_PASSWORD_NOTE, type AccountInfo } from './AccountSettings';

const render = (account: AccountInfo) => renderToStaticMarkup(<AccountSettingsView account={account} />);
const local: AccountInfo = { email: 'a@example.test', mode: 'local', hasPassword: true, identities: [] };
const oidc: AccountInfo = {
  email: 'a@example.test',
  mode: 'oidc',
  hasPassword: false,
  identities: [{ issuer: 'https://idp.example.test', subject: 'sub-123' }],
};

describe('AccountSettings local mode', () => {
  it('renders the three labelled password fields', () => {
    const html = render(local);
    for (const label of ['Current password', 'New password', 'Confirm new password']) expect(html).toContain(label);
    expect(html.match(/type="password"/g)).toHaveLength(3);
    expect(html).not.toContain(OIDC_PASSWORD_NOTE);
  });
  it('never prefills a password field', () => {
    const html = render(local);
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]/);
    expect(html).not.toMatch(/value="[^"]+"[^>]*type="password"/);
  });
});

describe('AccountSettings oidc mode', () => {
  it('shows the note and identities with no password form', () => {
    const html = render(oidc);
    expect(html).toContain(OIDC_PASSWORD_NOTE);
    expect(html).toContain('https://idp.example.test');
    expect(html).toContain('sub-123');
    expect(html).not.toContain('type="password"');
  });
});

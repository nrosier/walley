import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from '@/components/AppShell';
import { HealthStatus } from '@/components/HealthStatus';
import { LoginForm } from '@/pages/LoginPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { VerifyEmailView } from '@/pages/VerifyEmailPage';
import { catalogues } from './catalogues';
import { I18nProvider } from './I18nProvider';
import type { Locale } from './locale';

const render = (locale: Locale, ui: ReactElement) =>
  renderToStaticMarkup(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);

/** Every English sentence (three or more words) whose Dutch text differs, from all registered catalogues. */
function englishSentences(): string[] {
  const found = new Set<string>();
  const walk = (en: unknown, nl: unknown) => {
    if (typeof en === 'string' && typeof nl === 'string') {
      if (en !== nl && en.split(/\s+/).length >= 3 && !en.includes('{')) found.add(en);
      return;
    }
    if (typeof en !== 'object' || en === null || typeof nl !== 'object' || nl === null) return;
    for (const [key, value] of Object.entries(en)) walk(value, (nl as Record<string, unknown>)[key]);
  };
  for (const { en, nl } of Object.values(catalogues)) walk(en, nl);
  return [...found];
}

const shell = (
  <AppShell route="settings" theme="dark" email="a@b.c" onRefresh={() => undefined} onToggleTheme={() => undefined} onLogout={() => undefined} />
);

const views: Record<string, ReactElement> = {
  navbar: shell,
  'login local': <LoginForm config={{ mode: 'local', registration: true }} errorCode={null} />,
  'login oidc': <LoginForm config={{ mode: 'oidc', registration: false }} errorCode="oidc_failed" />,
  'settings page': <SettingsPage />,
  'verify email': <VerifyEmailView state={{ kind: 'missing' }} />,
  'health status': <HealthStatus />,
};

describe('no hard-coded user-visible text', () => {
  const sentences = englishSentences();

  it('finds English sentences to check', () => {
    expect(sentences.length).toBeGreaterThan(10);
  });

  for (const [name, ui] of Object.entries(views)) {
    describe(name, () => {
      it('differs between en and nl', () => {
        expect(render('nl', ui)).not.toBe(render('en', ui));
      });
      it('shows no English-only sentence in nl', () => {
        const html = render('nl', ui);
        for (const sentence of sentences) expect(html).not.toContain(sentence);
      });
    });
  }
});

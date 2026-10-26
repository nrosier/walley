import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppShell } from '@/components/AppShell';
import { HealthStatus } from '@/components/HealthStatus';
import { CreateActualForm } from '@/components/dashboard/CreateActualModal';
import { CreateWallosForm } from '@/components/dashboard/CreateWallosModal';
import { createModalMessages } from '@/components/dashboard/CreateModal.messages';
import { DiffModal } from '@/components/matches/DiffModal';
import { diffModalMessages } from '@/components/matches/DiffModal.messages';
import type { SyncMismatch } from '../../lib/sync-check-types';
import { sample } from '@/lib/sync-check.test';
import { MatchesView } from '@/pages/Matches';
import { SyncDashboardView } from '@/pages/SyncDashboard';
import { LoginForm } from '@/pages/LoginPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { VerifyEmailView } from '@/pages/VerifyEmailPage';
import { catalogues } from './catalogues';
import { I18nProvider } from './I18nProvider';
import type { Locale } from './locale';

/** Wrapper sources as raw text (Vite glob: src/web must not import Node built-ins). */
const sources = import.meta.glob<string>(['../components/dashboard/Create*Modal.tsx'], { query: '?raw', import: 'default', eager: true });

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

const result = sample();
const mismatch: SyncMismatch = {
  matchId: 'm1',
  wallosId: 'w1',
  actualScheduleId: 'a1',
  wallosName: 'Netflix',
  actualName: 'NETFLIX.COM',
  wallosAmountCents: 1299,
  actualAmountCents: 1499,
  isRange: false,
  wallosDrift: true,
  actualDrift: false,
  wallosFields: { frequency: 'monthly', interval: 1, startDate: '2026-01-01', currency: 'EUR', amount: { kind: 'single', cents: 1299 } },
  actualFields: { frequency: 'yearly', interval: 1, startDate: '2026-01-01', currency: 'EUR', amount: { kind: 'single', cents: 1499 } },
};
const noop = () => undefined;

const views: Record<string, ReactElement> = {
  navbar: shell,
  'login local': <LoginForm config={{ mode: 'local', registration: true }} errorCode={null} />,
  'login oidc': <LoginForm config={{ mode: 'oidc', registration: false }} errorCode="oidc_failed" />,
  'settings page': <SettingsPage />,
  'verify email': <VerifyEmailView state={{ kind: 'missing' }} />,
  'health status': <HealthStatus />,
  'sync dashboard': (
    <SyncDashboardView state={{ status: 'ready', result, errorCode: null }} query="" />
  ),
  matches: <MatchesView result={{ ...result, linked: [] }} showIgnored={false} />,
  'create actual form': (
    <CreateActualForm
      wallosId="w1"
      prefill={{
        name: 'Netflix',
        amountCents: -1299,
        baseCurrency: 'EUR',
        sourceCurrency: 'EUR',
        wallosRate: '1',
        overrideRate: null,
        recurrence: { frequency: 'monthly', interval: 1 },
        startDate: '2026-11-01',
        accounts: [{ id: 'a1', name: 'Checking' }],
        payees: [{ id: 'p1', name: 'NETFLIX.COM' }],
        categories: [{ id: 'c1', name: 'Fun' }],
      }}
    />
  ),
  'create wallos form': (
    <CreateWallosForm
      scheduleId="s1"
      prefill={{ name: 'Rent', price: '900.00', currencyCode: 'EUR', cycle: 3, frequency: 1, startDate: '2026-01-05', nextPayment: '2026-11-05' }}
    />
  ),
};

/** Main heading and primary button of each new view: present in en, absent in nl. */
const headings: Record<string, string[]> = {
  'sync dashboard': ['>Sync Dashboard<', '>Run Sync Check<'],
  matches: ['>Matches<', '>Show ignored items<'],
  'create actual form': ['>Create<'],
  'create wallos form': ['>Create<'],
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

  for (const [name, strings] of Object.entries(headings)) {
    it(`${name}: main heading and primary button are Dutch`, () => {
      const en = render('en', views[name] as ReactElement);
      const nl = render('nl', views[name] as ReactElement);
      for (const text of strings) {
        expect(en, `en contains ${text}`).toContain(text);
        expect(nl, `nl contains ${text}`).not.toContain(text);
      }
    });
  }

  // DiffModal and the create modal wrappers render inside a Radix portal, which static markup does not include.
  // Their heading and primary button come from the catalogues, so check those, and check that the modal renders.
  describe('diff modal', () => {
    it('renders without throwing in nl', () => {
      expect(() =>
        render('nl', <DiffModal mismatch={mismatch} baseCurrency="EUR" onClose={noop} onIgnoreDiff={noop} onOverwrite={noop} onUnlink={noop} />),
      ).not.toThrow();
    });
    it('has Dutch heading and buttons', () => {
      const { en, nl } = diffModalMessages;
      for (const key of ['title', 'overwriteWallos', 'overwriteActual', 'ignoreDiff', 'unlink'] as const) {
        expect(nl[key], key).not.toBe(en[key]);
      }
    });
  });
  // CreateActualModal and CreateWallosModal also render in a Radix portal. Check their catalogue keys and their source.
  const lookupKey = (tree: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
  const wrappers = [
    { file: '../components/dashboard/CreateActualModal.tsx', required: ['actual.title', 'actual.description', 'submit', 'cancel'] },
    { file: '../components/dashboard/CreateWallosModal.tsx', required: ['wallos.title', 'wallos.description', 'submit', 'cancel'] },
  ];
  for (const { file, required } of wrappers) {
    describe(`modal wrapper ${file}`, () => {
      const source = sources[file] ?? '';
      if (source === '') throw new Error(`missing source ${file}`);
      const used = [...new Set([...source.matchAll(/\bt\('([\w.]+)'/g)].map((m) => m[1] ?? ''))];
      it('imports the translated catalogue and uses the title and action keys', () => {
        expect(source).toContain("from './CreateModal.messages'");
        expect(source).toContain('useT(createModalMessages)');
        for (const key of required) expect(used, key).toContain(key);
      });
      it('has differing en and nl text for every key it uses', () => {
        for (const key of used) {
          const en = lookupKey(createModalMessages.en, key);
          const nl = lookupKey(createModalMessages.nl, key);
          expect(typeof en, `en ${key}`).toBe('string');
          expect(typeof nl, `nl ${key}`).toBe('string');
          expect(nl, key).not.toBe(en);
        }
      });
    });
  }
});

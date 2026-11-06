import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { sample } from '@/lib/sync-check.test';
import type { SyncStoreState } from '@/lib/sync-check';
import type { PairBadgeKind } from '../lib/match-badge';
import { SyncDashboardView } from '@/pages/SyncDashboard';
import { StatusBadge } from '@/components/StatusBadge';
import { CreateActualForm } from '@/components/dashboard/CreateActualModal';
import { CreateWallosForm } from '@/components/dashboard/CreateWallosModal';
import diffSrc from '@/components/matches/DiffModal.tsx?raw';
import relinkSrc from '@/components/matches/RelinkDialog.tsx?raw';
import unlinkSrc from '@/components/matches/UnlinkDialog.tsx?raw';
import detailsSrc from '@/components/dashboard/SyncItemDetailsDialog.tsx?raw';
import createActualSrc from '@/components/dashboard/CreateActualModal.tsx?raw';
import createWallosSrc from '@/components/dashboard/CreateWallosModal.tsx?raw';
import frameSrc from '@/components/dashboard/CreateModalFrame.tsx?raw';
import shellSrc from '@/components/ui/dialog-shell.tsx?raw';
import dialogSrc from '@/components/ui/dialog.tsx?raw';

// Issue #58. The test environment is node (no DOM), so these tests read the
// server-rendered markup and the component sources. They prove labels, aria,
// badge text and the focus wiring. Real Tab order and focus return in a browser
// are covered by the manual walkthrough checklist recorded on the issue.

const render = (ui: React.ReactElement, locale: Locale = 'en') =>
  renderToStaticMarkup(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);

const tags = (html: string, name: string) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'g')) ?? [];
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Every field has a label (for= its id, or wrapping it), an aria-label, or an aria-labelledby. */
const unlabelled = (html: string): string[] => {
  const forIds = new Set([...html.matchAll(/<label\b[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
  const wrapped = (at: number) => html.lastIndexOf('<label', at) > html.lastIndexOf('</label>', at);
  return [...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)]
    .filter((m) => attr(m[0], 'type') !== 'hidden')
    .filter((m) => {
      const id = attr(m[0], 'id');
      return !(id !== undefined && forIds.has(id)) && !wrapped(m.index) && attr(m[0], 'aria-label') === undefined && attr(m[0], 'aria-labelledby') === undefined;
    })
    .map((m) => m[0]);
};

/** Every button has visible text or an aria-label. */
const nameless = (html: string): string[] =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, a = '', inner = '']) => !/\saria-label="[^"]+"/.test(a) && inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '').trim() === '')
    .map((m) => m[0]);

const ready = (): SyncStoreState => ({ status: 'ready', result: sample(), errorCode: null });

const actualPrefill = {
  name: 'Netflix',
  amountCents: -1299,
  baseCurrency: 'EUR',
  sourceCurrency: 'USD',
  wallosRate: '1.1',
  overrideRate: null,
  recurrence: { frequency: 'monthly' as const, interval: 1 },
  startDate: '2026-11-01',
  accounts: [{ id: 'a1', name: 'Checking' }],
  payees: [{ id: 'p1', name: 'NETFLIX.COM' }],
  categories: [{ id: 'c1', name: 'Fun' }],
};
const wallosPrefill = {
  name: 'Rent',
  price: '900.00',
  currencyCode: 'EUR',
  cycle: 3,
  frequency: 1,
  startDate: '2026-01-05',
  nextPayment: '2026-11-05',
  paymentMethods: [{ id: '1', name: 'Card' }],
  categories: [{ id: '2', name: 'Home' }],
};

describe('dashboard accessibility', () => {
  for (const locale of ['en', 'nl'] as const) {
    it(`labels every field and names every button (${locale})`, () => {
      const html = render(<SyncDashboardView state={ready()} query="" />, locale);
      expect(tags(html, 'button').length).toBeGreaterThan(0);
      expect(unlabelled(html)).toEqual([]);
      expect(nameless(html)).toEqual([]);
    });
  }

  it('names the search, the toolbar group and the panes, and announces status text', () => {
    const html = render(<SyncDashboardView state={ready()} query="" />);
    expect(html).toMatch(/<input[^>]*aria-label="[^"]+"/);
    expect(html).toMatch(/role="group"[^>]*aria-label="[^"]+"|aria-label="[^"]+"[^>]*role="group"/);
    expect(html).toMatch(/<section[^>]*aria-labelledby="sync-title"/);
    expect(html).toContain('id="sync-title"');
    const loading = render(<SyncDashboardView state={{ status: 'loading', result: null, errorCode: null }} query="" />);
    expect(loading).toContain('role="status"');
    const failed = render(<SyncDashboardView state={{ status: 'error', result: null, errorCode: 'sync_failed' }} query="" />);
    expect(failed).toContain('role="alert"');
  });

  it('gives row actions per-row names so repeated buttons are distinguishable', () => {
    const html = render(<SyncDashboardView state={ready()} query="" />);
    const names = tags(html, 'button').map((b) => attr(b, 'aria-label')).filter((n): n is string => n !== undefined);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps a visible focus style on dashboard controls and never removes the outline', () => {
    const html = render(<SyncDashboardView state={ready()} query="" />);
    expect(html).toContain('focus-visible:outline');
    for (const src of [diffSrc, relinkSrc, unlinkSrc, detailsSrc, createActualSrc, createWallosSrc, shellSrc]) {
      expect(src).not.toMatch(/outline-none|focus:outline-none/);
    }
  });
});

describe('badges do not rely on color alone', () => {
  const kinds: [PairBadgeKind, string, string][] = [
    ['synced', 'Synced', 'Gesynchroniseerd'],
    ['mismatch', 'Mismatch', 'Afwijking'],
    ['ignored', 'Ignored', 'Genegeerd'],
    ['orphaned', 'Orphaned', 'Verweesd'],
  ];
  for (const [kind, en, nl] of kinds) {
    it(`${kind} carries its status as text in en and nl`, () => {
      expect(render(<StatusBadge kind={kind} />)).toMatch(new RegExp(`>${en}</span>`));
      expect(render(<StatusBadge kind={kind} />, 'nl')).toMatch(new RegExp(`>${nl}</span>`));
    });
  }

  it('shows a badge with text on every linked row of the dashboard', () => {
    const html = render(<SyncDashboardView state={ready()} query="" />);
    const badges = tags(html, 'span').filter((s) => attr(s, 'data-variant') !== undefined);
    expect(badges.length).toBeGreaterThan(0);
    for (const m of html.matchAll(/<span[^>]*data-variant="[^"]+"[^>]*>([\s\S]*?)<\/span>/g)) {
      expect((m[1] ?? '').replace(/<[^>]+>/g, '').trim()).not.toBe('');
    }
  });
});

describe('create modal forms', () => {
  it('Create in Actual: every field is labelled and every button is named, in en and nl', () => {
    for (const locale of ['en', 'nl'] as const) {
      const html = render(<CreateActualForm prefill={actualPrefill} wallosId="w1" />, locale);
      expect(tags(html, 'select')).toHaveLength(2);
      expect(unlabelled(html)).toEqual([]);
      expect(nameless(html)).toEqual([]);
    }
  });

  it('Create in Wallos: every field is labelled and every button is named, in en and nl', () => {
    for (const locale of ['en', 'nl'] as const) {
      const html = render(<CreateWallosForm prefill={wallosPrefill} scheduleId="s1" />, locale);
      expect(tags(html, 'select').length).toBeGreaterThanOrEqual(2);
      expect(unlabelled(html)).toEqual([]);
      expect(nameless(html)).toEqual([]);
    }
  });

  it('a disabled Create submit points at the reason through aria-describedby', () => {
    const html = render(<CreateActualForm prefill={{ ...actualPrefill, name: '' }} wallosId="w1" />);
    expect(html).toMatch(/aria-describedby="[^"]+"/);
  });

  it('the payee combobox exposes listbox semantics and keyboard-driven active option', () => {
    for (const token of ['role="combobox"', 'aria-expanded', 'aria-controls', 'aria-activedescendant', 'role="listbox"', 'role="option"', 'aria-selected']) {
      expect(createActualSrc).toContain(token);
    }
  });
});

describe('modal focus handling', () => {
  it('the dialog shell always renders a Radix title and optional description', () => {
    expect(shellSrc).toContain('<DialogTitle>');
    expect(shellSrc).toContain('<DialogDescription>');
  });

  it('the dialog primitive uses Radix (focus trap, Escape, focus return) and a named close button', () => {
    expect(dialogSrc).toContain('radix-ui');
    expect(dialogSrc).toContain('DialogPrimitive.Close');
    expect(dialogSrc).toMatch(/sr-only">\{t\("close"\)\}/);
    expect(dialogSrc).toContain('aria-hidden="true"');
  });

  it('every modal is built from DialogShell or the dialog primitives, never a hand-rolled overlay', () => {
    for (const src of [diffSrc, relinkSrc, unlinkSrc, detailsSrc, frameSrc]) {
      expect(src).toMatch(/DialogShell|DialogContent|AlertDialogContent/);
      expect(src).not.toMatch(/role="dialog"|aria-modal/);
    }
  });

  it('modals that open from a trigger return focus to it on close', () => {
    expect(diffSrc).toContain('onCloseAutoFocus');
    expect(diffSrc).toContain('onOpenAutoFocus');
    expect(unlinkSrc).toMatch(/focus\(\)/);
  });

  it('icon-only controls hide the icon and carry a text name', () => {
    for (const src of [diffSrc, createActualSrc, createWallosSrc]) {
      for (const m of src.matchAll(/<(Unlink|X|Loader2|Check|Plus)\b[^>]*>/g)) {
        expect(m[0]).toContain('aria-hidden');
      }
    }
  });
});

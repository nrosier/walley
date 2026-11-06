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
import rowFocusSrc from '@/components/matches/row-menu-focus.ts?raw';
import dashboardSrc from '@/pages/SyncDashboard.tsx?raw';
import unlinkSrc from '@/components/matches/UnlinkDialog.tsx?raw';
import detailsSrc from '@/components/dashboard/SyncItemDetailsDialog.tsx?raw';
import createActualSrc from '@/components/dashboard/CreateActualModal.tsx?raw';
import createWallosSrc from '@/components/dashboard/CreateWallosModal.tsx?raw';
import frameSrc from '@/components/dashboard/CreateModalFrame.tsx?raw';
import aboutSrc from '@/components/AboutDialog.tsx?raw';
import appShellSrc from '@/components/AppShell.tsx?raw';
import itemRowSrc from '@/components/dashboard/ItemRow.tsx?raw';
import pairListSrc from '@/components/dashboard/PairList.tsx?raw';
import buttonSrc from '@/components/ui/button.tsx?raw';
import settingsCardSrc from '@/components/settings/SettingsCard.tsx?raw';
import wallosSettingsSrc from '@/pages/WallosSettings.tsx?raw';
import actualSettingsSrc from '@/pages/ActualSettings.tsx?raw';
import matchingSettingsSrc from '@/pages/MatchingSettings.tsx?raw';
import verifySrc from '@/pages/VerifyEmailPage.tsx?raw';
import loginSrc from '@/pages/LoginPage.tsx?raw';
import toolbarSrc from '@/components/dashboard/Toolbar.tsx?raw';
import { ActualSettingsView } from '@/pages/ActualSettings';
import { WallosSettingsView } from '@/pages/WallosSettings';
import { Toolbar } from '@/components/dashboard/Toolbar';
import { VerifyEmailView } from '@/pages/VerifyEmailPage';
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

/** Visible text of a markup fragment: characters outside tags, skipping inline svg. Only used to test for emptiness. */
const textOf = (markup: string): string => {
  let out = '';
  let depth = 0;
  for (const ch of markup) {
    if (ch === '<') depth++;
    else if (ch === '>' && depth > 0) depth--;
    else if (depth === 0) out += ch;
  }
  return out.trim();
};

/** Every button has visible text or an aria-label. */
const nameless = (html: string): string[] =>
  [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, a = '', inner = '']) => !/\saria-label="[^"]+"/.test(a) && textOf(inner) === '')
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
      expect(textOf(m[1] ?? '')).not.toBe('');
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
    expect(unlinkSrc).toContain('restoreFocus(event');
    expect(rowFocusSrc).toMatch(/next\.focus\(\)/);
  });

  it('icon-only controls hide the icon and carry a text name', () => {
    for (const src of [diffSrc, createActualSrc, createWallosSrc]) {
      for (const m of src.matchAll(/<(Unlink|X|Loader2|Check|Plus)\b[^>]*>/g)) {
        expect(m[0]).toContain('aria-hidden');
      }
    }
  });
});

// Issue #58 keyboard walkthrough fixes. Markup and source checks only: that focus really lands where the
// comments say needs a browser, so these prove the wiring, not the runtime focus position.
describe('focus is kept while a control is busy', () => {
  it('Run Sync Check is aria-disabled, not disabled, while running', () => {
    const html = render(<Toolbar query="" running />);
    expect(html).toMatch(/<button[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(toolbarSrc).toMatch(/if \(!props\.running\) props\.onRun/);
  });

  it('Test Connection is aria-disabled while testing and the handler is guarded', () => {
    const html = render(<WallosSettingsView url="" apiKey="" hasKey={false} test={{ kind: 'testing' }} />);
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Testing/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Testing/);
    expect(wallosSettingsSrc).toMatch(/test\.kind !== 'testing'\) props\.onTest/);
  });

  it('Load budgets and Save are aria-disabled while busy and announce through the status region', () => {
    const base = { url: '', password: '', syncKey: '', clearSyncKey: false, hasPassword: false, hasSyncKey: false, budgetId: null, budgets: null };
    const html = render(<ActualSettingsView {...base} status={{ kind: 'busy', text: 'loadingBudgets' }} />);
    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Load budgets/);
    expect(html).not.toMatch(/<button[^>]*\sdisabled=""/);
    expect(html).toMatch(/role="status"[^>]*>Loading budgets/);
    const done = render(<ActualSettingsView {...base} budgets={[{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]} status={{ kind: 'ok', text: 'budgetsLoaded', count: 2 }} />);
    expect(done).toMatch(/role="status"[^>]*>2 budgets loaded/);
    const empty = render(<ActualSettingsView {...base} budgets={[]} status={{ kind: 'ok', text: 'noBudgets' }} />);
    expect(empty).toMatch(/role="status"[^>]*>No budgets on this server/);
  });

  it('the shared Save button and every settings submit handler ignore a busy state instead of disabling', () => {
    expect(settingsCardSrc).toContain('aria-disabled={busy || undefined}');
    expect(settingsCardSrc).not.toMatch(/[^-]disabled=\{busy/);
    expect(wallosSettingsSrc).toMatch(/props\.saving === true\) return/);
    expect(actualSettingsSrc).toMatch(/if \(busy\) return/);
    expect(matchingSettingsSrc).toMatch(/props\.status === 'saving'\) return/);
  });

  it('Confirm email stays focusable while verifying and the result takes focus when it replaces the form', () => {
    const verifying = render(<VerifyEmailView state={{ kind: 'verifying' }} />);
    expect(verifying).toMatch(/<button type="submit" aria-disabled="true"/);
    expect(render(<VerifyEmailView state={{ kind: 'success' }} />)).toMatch(/tabindex="-1"/);
    expect(verifySrc).toMatch(/resultRef\.current\?\.focus\(\)/);
  });
});

describe('focus return after closing', () => {
  it('the About dialog hands focus back to the footer About button', () => {
    expect(aboutSrc).toContain('onCloseAutoFocus');
    expect(aboutSrc).toContain('returnFocusRef');
    expect(appShellSrc).toMatch(/ref=\{aboutButtonRef\}/);
    expect(appShellSrc).toMatch(/returnFocusRef=\{aboutButtonRef\}/);
  });

  it('both create modals share a frame that restores focus, with the search box as the fallback', () => {
    expect(frameSrc).toContain('onCloseAutoFocus');
    expect(frameSrc).toContain('input[type="search"]');
    expect(createActualSrc).toContain('returnFocus={props.returnFocus}');
    expect(createWallosSrc).toContain('returnFocus={props.returnFocus}');
    expect(itemRowSrc).toContain('ref={createRef}');
    expect(itemRowSrc).toContain('returnFocus={returnToCreate}');
  });

  // Issue 58 N1. Source wiring only: that focus really lands on the button needs a browser.
  it('dialogs opened from a row menu item return focus to that row menu button, not the search box', () => {
    // The trigger lookup uses the attribute PairList really renders (UnlinkDialog once used a data-linked-id that never existed).
    expect(rowFocusSrc).toContain('[data-linked-match=');
    expect(rowFocusSrc).toContain('[aria-haspopup="menu"]');
    expect(pairListSrc).toContain('data-linked-match');
    expect(unlinkSrc).not.toContain('data-linked-id');
    expect(unlinkSrc).toContain('rowMenuTrigger(lastId.current)');
    // Confirm removes the row: that path keeps the search box fallback.
    expect(unlinkSrc).toMatch(/confirmed\.current \? null : rowMenuTrigger/);
    expect(unlinkSrc).toMatch(/confirmed\.current = true;\s+if \(row !== null\) onConfirm/);
    expect(rowFocusSrc).toContain('input[type="search"]');
    // Relink and both Recreate modals get the row-aware target from the dashboard.
    expect(relinkSrc).toContain('onCloseAutoFocus');
    expect(relinkSrc).toContain('props.returnFocus');
    expect(dashboardSrc.match(/returnFocus=\{orphanReturnFocus\}/g)).toHaveLength(3);
    expect(dashboardSrc).toContain('onCreated={orphanDone}');
    expect(dashboardSrc).toMatch(/onLinked=\{\(\) => \{\s+orphanDone\(\)/);
  });

  it('the Overwrite and Unlink confirmations inside the diff modal keep their own button as opener', () => {
    // Opened from AlertDialogTrigger buttons that stay mounted, so Radix returns focus to them; no menu item is involved.
    expect((diffSrc.match(/<AlertDialogTrigger asChild>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(diffSrc).not.toContain('MoreActionsMenu');
  });

  it('closing Review after Ignore Diff falls back to the pair row details button', () => {
    expect(diffSrc).toContain('data-linked-match');
    expect(pairListSrc).toContain('data-linked-match');
    expect(diffSrc).toContain('[data-details-for]');
  });
});

describe('focus ring and motion', () => {
  it('the button does not transition outline-color from its initial white', () => {
    // transition-colors includes outline-color. Without a base outline colour the ring transitions from the inherited
    // currentColor (white on primary) to --ring, so it reads white for the first ~150ms. The base class sets
    // outline-ring so there is nothing to transition from.
    expect(buttonSrc).toContain('outline-ring focus-visible');
    expect(dialogSrc).toContain('transition-colors outline-ring');
  });

  it('spinner and skeleton animations are off under reduced motion', () => {
    expect(toolbarSrc).toContain('animate-spin motion-reduce:animate-none');
    for (const m of dashboardSrc.matchAll(/animate-pulse[^"]*/g)) expect(m[0]).toContain('motion-reduce:animate-none');
    expect(dashboardSrc).toContain('animate-pulse');
  });
});

describe('first-field focus and login errors', () => {
  it('create forms put initial focus on the first field', () => {
    expect(createActualSrc).toMatch(/autoFocus\s+type="text"/);
    expect(createWallosSrc).toMatch(/autoFocus\s+type="text"/);
    expect(aboutSrc).not.toContain('autoFocus');
  });

  it('login inputs point at the error and are marked invalid on a failed sign-in', () => {
    expect(loginSrc.match(/aria-invalid=\{failure !== null/g)?.length).toBe(3);
    expect(loginSrc.match(/aria-describedby=\{failure !== null \? failureId/g)?.length).toBe(3);
    expect(loginSrc).toContain('<div id={failureId}>');
  });
});

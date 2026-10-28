import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { sample } from '@/lib/sync-check.test';
import type { SyncStoreState } from '@/lib/sync-check';
import dashboardSrc from './SyncDashboard.tsx?raw';
import storeSrc from '@/lib/sync-check.ts?raw';
import apiSrc from '@/lib/matches.api.ts?raw';
import rowSrc from '@/components/dashboard/ItemRow.tsx?raw';
import toolbarSrc from '@/components/dashboard/Toolbar.tsx?raw';
import wallosColumnSrc from '@/components/dashboard/WallosColumn.tsx?raw';
import actualColumnSrc from '@/components/dashboard/ActualColumn.tsx?raw';
import { ItemRow } from '@/components/dashboard/ItemRow';
import { syncDashboardMessages } from './SyncDashboard.messages';
import { createT } from '@/i18n/translate';
import { failedSide } from '@/lib/sync-failure';
import { SyncDashboardView, type SyncDashboardViewProps } from './SyncDashboard';

const restoreLabel = (locale: Locale) => createT(syncDashboardMessages, locale)('row.restoreNamed', { name: 'Amazon Prime' });

/** The markup of one column: from its data-column marker to the closing section tag. */
const columnOf = (html: string, side: 'wallos' | 'actual') => {
  const start = html.indexOf(`data-column="${side}"`);
  expect(start, `${side} column`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
};

const render = (state: SyncStoreState, extra: Partial<SyncDashboardViewProps> = {}, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <SyncDashboardView state={state} query="" {...extra} />
    </I18nProvider>,
  );

const ready = (): SyncStoreState => ({ status: 'ready', result: sample(), errorCode: null });

describe('SyncDashboard states', () => {
  it('idle: prompts to run the check and does not run it', () => {
    const html = render({ status: 'idle', result: null, errorCode: null });
    expect(html).toContain('Run a sync check to see unlinked items.');
  });
  it('loading: shows status text and a disabled Run button', () => {
    const html = render({ status: 'loading', result: null, errorCode: null });
    expect(html).toContain('Checking Wallos and Actual Budget...');
    expect(/<button[^>]*disabled=""[^>]*>[\s\S]*?Checking\.\.\./.test(html)).toBe(true);
  });
  it('error: shows the server code text in an alert', () => {
    const html = render({ status: 'error', result: null, errorCode: 'wallos_unavailable' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Could not reach Wallos.');
  });
  it('empty: both columns say there is nothing to link', () => {
    const empty = { ...sample(), unlinkedWallos: [], unlinkedActual: [], candidates: [], ignored: [] };
    const html = render({ status: 'ready', result: empty, errorCode: null });
    expect(html.match(/Nothing to link here\./g)).toHaveLength(2);
  });
  it('populated: two columns, money in font-mono, search filters', () => {
    const html = render(ready());
    expect(html).toContain('data-column="wallos"');
    expect(html).toContain('data-column="actual"');
    expect(html).toMatch(/font-mono[^>]*>€12\.99/);
    const filtered = render(ready(), { query: 'rent' });
    expect(filtered).toContain('Rent');
    expect(filtered).not.toContain('Netflix');
    expect(filtered).toContain('No items match your search.');
  });
  it('range flag and unmappable reason', () => {
    const html = render(ready());
    expect(html).toContain('>range</span>');
    expect(html).toContain('Invalid amount');
  });
  it('Link is the one action on rows with a candidate; others offer Create', () => {
    const html = render(ready());
    expect(html.match(/>Link<\/button>/g)).toHaveLength(2);
    const gym = html.slice(html.indexOf('data-row-id="w2"'), html.indexOf('data-row-id="w2"') + 1400);
    expect(gym).not.toContain('>Link<');
    expect(html).toContain('Suggested match: NETFLIX.COM');
    expect(html).toContain('Suggested match: Netflix');
    expect(html).toContain('aria-label="Link Netflix to NETFLIX.COM"');
  });
  it('Link shows a "Suggested match: X" line when a candidate exists, otherwise Create appears', () => {
    const html = render(ready());
    const wallos = columnOf(html, 'wallos');
    const actual = columnOf(html, 'actual');
    const rowOf = (column: string, id: string) => {
      const start = column.indexOf(`data-row-id="${id}"`);
      expect(start, id).toBeGreaterThan(-1);
      const next = column.indexOf('data-row-id=', start + 1);
      return column.slice(start, next === -1 ? undefined : next);
    };
    // Candidate: the line names the other side, Link is the action, Create is absent.
    const netflix = rowOf(wallos, 'w1');
    expect(netflix).toContain('Suggested match: NETFLIX.COM');
    expect(netflix).toMatch(/>Link<\/button>/);
    expect(netflix).not.toContain('>Create in');
    const netflixActual = rowOf(actual, 'a1');
    expect(netflixActual).toContain('Suggested match: Netflix');
    expect(netflixActual).toMatch(/>Link<\/button>/);
    // No candidate: no suggestion line, no Link, Create instead.
    const gym = rowOf(wallos, 'w2');
    expect(gym).not.toContain('Suggested match');
    expect(gym).not.toContain('>Link<');
    expect(gym).toContain('>Create in AB<');
    const rent = rowOf(actual, 'a2');
    expect(rent).not.toContain('Suggested match');
    expect(rent).toContain('>Create in Wallos<');
    // Both strings exist in nl.
    const nl = render(ready(), {}, 'nl');
    expect(nl).toContain('Voorgestelde koppeling: NETFLIX.COM');
    expect(nl).toContain('Aanmaken in AB');
  });
  it('Create appears only on rows without a candidate and opens the pre-fill modals', () => {
    const html = render(ready());
    expect(columnOf(html, 'wallos').match(/>Create in AB<\/button>/g)).toHaveLength(1);
    expect(columnOf(html, 'actual').match(/>Create in Wallos<\/button>/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Create in AB: Gym"');
    expect(html).toContain('aria-label="Create in Wallos: Rent"');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Create in/);
  });
  it('each unignored row shows one primary action and a uniquely named More actions button', () => {
    const html = render(ready());
    expect(html).not.toContain('>Ignore<');
    expect(html).not.toContain('>Restore<');
    for (const name of ['Netflix', 'Gym', 'NETFLIX.COM', 'Rent']) {
      expect(html.match(new RegExp(`aria-label="More actions for ${name}"`, 'g')), name).toHaveLength(1);
    }
  });
  it('only Run Sync Check is a filled indigo button', () => {
    const html = render(ready());
    expect(html.match(/data-variant="default"/g)).toHaveLength(1);
    expect(html).toMatch(/data-variant="default"[^>]*>Run Sync Check</);
  });
  it('the dashboard and its column and row sources make no /api/integrations call', () => {
    const files: Record<string, string> = { dashboardSrc, storeSrc, apiSrc, rowSrc, toolbarSrc, wallosColumnSrc, actualColumnSrc };
    for (const [f, src] of Object.entries(files)) {
      expect(src, f).not.toContain('/api/integrations');
    }
  });

  it('ignored rows sit in a collapsed disclosure with a count and a uniquely named Restore', () => {
    const html = render(ready());
    expect(html).toContain('Ignored items (1)');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('>Restore<');
  });
  it('Restore is inside More actions, named per row', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <ItemRow
          row={{ id: 'w9', name: 'Amazon Prime', amountCents: 500, isRange: false, reason: null, ignored: true, matchId: 'm1' }}
          side="wallos"
          baseCurrency="EUR"
          candidates={[]}
          createLabel="Create in AB"
        />
      </I18nProvider>,
    );
    expect(html).toContain('aria-label="More actions for Amazon Prime"');
    expect(html).toContain('data-kind="ignored"');
    expect(html).not.toContain('>Restore');
    expect(restoreLabel('en')).toBe('Restore Amazon Prime');
    expect(restoreLabel('nl')).toBe('Amazon Prime herstellen');
  });
  it('a row error keeps the row, says nothing changed and offers Try again', () => {
    const html = render(ready(), { errorRowId: 'w1', rowError: 'Kapot', onRetryRow: () => undefined });
    expect(html).toContain('Kapot');
    expect(html).toContain('Nothing changed.');
    expect(html).toContain('aria-label="Try again: Netflix"');
    expect(html).toContain('data-row-id="w1"');
    expect(render(ready(), { errorRowId: 'w1', rowError: 'Kapot', onRetryRow: () => undefined }, 'nl')).toContain('Er is niets gewijzigd.');
  });
  it('skeleton while the first check runs, with a status for screen readers', () => {
    const html = render({ status: 'loading', result: null, errorCode: null });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('animate-pulse');
  });
  it('not configured: names the missing side with a Check settings link and no Retry', () => {
    const html = render({ status: 'error', result: null, errorCode: 'wallos_not_configured' });
    expect(html).toContain('Wallos is not set up yet.');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('Check settings');
    expect(html).not.toContain('>Retry<');
  });
  it('sync failure names the side, offers Retry and Check settings, and keeps the last result marked Stale', () => {
    const html = render({ status: 'error', result: sample(), errorCode: 'actual_unavailable' });
    expect(html).toContain('The sync check failed on the Actual Budget side.');
    expect(html).toContain('>Retry<');
    expect(html).toContain('Check settings');
    expect(html).toContain('>Stale<');
    expect(html).toContain('Netflix');
    const wallos = render({ status: 'error', result: null, errorCode: 'wallos_unavailable' });
    expect(wallos).toContain('failed on the Wallos side');
    expect(wallos).not.toContain('>Stale<');
    expect(render({ status: 'error', result: null, errorCode: 'internal_error' })).toContain('The sync check failed.');
  });
  it('failedSide reads the side from the code', () => {
    expect(failedSide('wallos_auth_failed')).toBe('wallos');
    expect(failedSide('actual_sync_failed')).toBe('actual');
    expect(failedSide('request_failed')).toBeNull();
    expect(failedSide(null)).toBeNull();
  });
  it('a segmented control switches the lists below 768px; both lists stay in markup', () => {
    const html = render(ready());
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Show list"');
    expect(html).toContain('Wallos (2)');
    expect(html).toContain('Actual Budget (2)');
    expect(html).toContain('md:hidden');
    // Wallos is the default pane, so only the Actual column hides below 768px.
    expect(html).toMatch(/data-column="actual"[^>]*max-md:hidden/);
    expect(html).not.toMatch(/data-column="wallos"[^>]*max-md:hidden/);
  });
  it('shows a row error and renders in nl', () => {
    expect(render(ready(), {}, 'nl')).toContain('Aanmaken in AB');
    expect(render(ready(), {}, 'nl')).toContain('Voorgestelde koppeling: NETFLIX.COM');
  });
  it('references no create or update client to Wallos or Actual', () => {
    const files: Record<string, string> = { dashboardSrc, storeSrc, apiSrc, rowSrc, toolbarSrc };
    for (const [f, src] of Object.entries(files)) {
      expect(src, f).not.toMatch(/\/api\/(wallos|actual|create)|create-(in|schedule|subscription)|createSchedule|createSubscription/i);
    }
  });
});

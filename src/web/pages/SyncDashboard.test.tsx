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
import { SyncDashboardView, type SyncDashboardViewProps } from './SyncDashboard';

/** The markup of one column: from its data-column marker to the closing section tag. */
const columnOf = (html: string, side: 'wallos' | 'actual') => {
  const start = html.indexOf(`data-column="${side}"`);
  expect(start, `${side} column`).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</section>', start));
};

const render = (state: SyncStoreState, extra: Partial<SyncDashboardViewProps> = {}, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <SyncDashboardView state={state} query="" showIgnored={false} {...extra} />
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
  it('Link only on items with candidates; unmappable has none', () => {
    const html = render(ready());
    expect(html.match(/>Link</g)).toHaveLength(2);
    const gym = html.slice(html.indexOf('data-row-id="w2"'), html.indexOf('data-row-id="w2"') + 900);
    expect(gym).not.toContain('>Link<');
    expect(html).toContain('NETFLIX.COM (€13.00)');
  });
  it('Create buttons are enabled and open the pre-fill modals (the modals hold Submit)', () => {
    const html = render(ready());
    const buttons = html.match(/<button[^>]*>Create in (AB|Wallos)<\/button>/g) ?? [];
    expect(buttons).toHaveLength(4);
    expect(buttons.some((b) => b.includes('disabled=""'))).toBe(false);
    expect(columnOf(html, 'wallos').match(/>Create in AB<\/button>/g)).toHaveLength(2);
    expect(columnOf(html, 'actual').match(/>Create in Wallos<\/button>/g)).toHaveLength(2);
  });
  it('columns still render Link and Ignore (#48, #49)', () => {
    for (const side of ['wallos', 'actual'] as const) {
      const column = columnOf(render(ready()), side);
      expect(column.match(/>Link<\/button>/g)).toHaveLength(1);
      expect(column.match(/>Ignore<\/button>/g)).toHaveLength(2);
    }
  });
  it('the dashboard and its column and row sources make no /api/integrations call', () => {
    const files: Record<string, string> = { dashboardSrc, storeSrc, apiSrc, rowSrc, toolbarSrc, wallosColumnSrc, actualColumnSrc };
    for (const [f, src] of Object.entries(files)) {
      expect(src, f).not.toContain('/api/integrations');
    }
  });

  it('Show Ignored Items shows ignored rows with the badge', () => {
    expect(render(ready())).not.toContain('Old');
    const html = render(ready(), { showIgnored: true });
    expect(html).toContain('Old');
    expect(html).toContain('data-kind="ignored"');
    expect(html).toContain('role="switch"');
  });
  it('shows one Restore button on each ignored row', () => {
    expect(render(ready())).not.toContain('Restore (unignore)');
    const html = render(ready(), { showIgnored: true });
    expect(html.match(/aria-label="Restore \(unignore\)"/g)).toHaveLength(1);
    expect(html).toContain('>Restore</button>');
    expect(render(ready(), { showIgnored: true }, 'nl')).toContain('>Herstellen</button>');
  });
  it('shows a row error and renders in nl', () => {
    const html = render(ready(), { errorRowId: 'w1', rowError: 'Kapot' });
    expect(html).toContain('Kapot');
    expect(render(ready(), {}, 'nl')).toContain('Aanmaken in AB');
  });
  it('references no create or update client to Wallos or Actual', () => {
    const files: Record<string, string> = { dashboardSrc, storeSrc, apiSrc, rowSrc, toolbarSrc };
    for (const [f, src] of Object.entries(files)) {
      expect(src, f).not.toMatch(/\/api\/(wallos|actual|create)|create-(in|schedule|subscription)|createSchedule|createSubscription/i);
    }
  });
});

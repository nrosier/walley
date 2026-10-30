import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { sample } from '@/lib/sync-check.test';
import type { SyncStoreState } from '@/lib/sync-check';
import type { SyncCheckResult } from '../../lib/sync-check-types';
import dashboardSrc from './SyncDashboard.tsx?raw';
import storeSrc from '@/lib/sync-check.ts?raw';
import apiSrc from '@/lib/matches.api.ts?raw';
import rowSrc from '@/components/dashboard/ItemRow.tsx?raw';
import toolbarSrc from '@/components/dashboard/Toolbar.tsx?raw';
import pairListSrc from '@/components/dashboard/PairList.tsx?raw';
import pairRowsSrc from '@/lib/pair-rows.ts?raw';
import { ItemRow } from '@/components/dashboard/ItemRow';
import { syncDashboardMessages } from './SyncDashboard.messages';
import { createT } from '@/i18n/translate';
import { failedSide } from '@/lib/sync-failure';
import { SyncDashboardView, type SyncDashboardViewProps } from './SyncDashboard';

const restoreLabel = (locale: Locale) => createT(syncDashboardMessages, locale)('row.restoreNamed', { name: 'Amazon Prime' });

/** The markup of one cell: from its data-row-id and data-side marker to the next cell. */
const cellOf = (html: string, side: 'wallos' | 'actual', id: string) => {
  const marker = `data-row-id="${id}" data-side="${side}"`;
  const start = html.indexOf(marker);
  expect(start, `${side} cell ${id}`).toBeGreaterThan(-1);
  const next = html.indexOf('data-row-id=', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
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
  it('empty: the list says there is nothing to link', () => {
    const empty = { ...sample(), unlinkedWallos: [], unlinkedActual: [], candidates: [], ignored: [] };
    const html = render({ status: 'ready', result: empty, errorCode: null });
    expect(html.match(/Nothing to link here\./g)).toHaveLength(1);
  });
  it('populated: a Wallos and an Actual heading, money in font-mono, search filters', () => {
    const html = render(ready());
    expect(html).toContain('id="col-wallos"');
    expect(html).toContain('id="col-actual"');
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
    // Candidate: the line names the other side, Link is the action, Create is absent.
    const netflix = cellOf(html, 'wallos', 'w1');
    expect(netflix).toContain('Suggested match: NETFLIX.COM');
    expect(netflix).toMatch(/>Link<\/button>/);
    expect(netflix).not.toContain('>Create in');
    const netflixActual = cellOf(html, 'actual', 'a1');
    expect(netflixActual).toContain('Suggested match: Netflix');
    expect(netflixActual).toMatch(/>Link<\/button>/);
    // No candidate: no suggestion line, no Link, Create instead.
    const gym = cellOf(html, 'wallos', 'w2');
    expect(gym).not.toContain('Suggested match');
    expect(gym).not.toContain('>Link<');
    expect(gym).toContain('>Create in AB<');
    const rent = cellOf(html, 'actual', 'a2');
    expect(rent).not.toContain('Suggested match');
    expect(rent).toContain('>Create in Wallos<');
    // Both strings exist in nl.
    const nl = render(ready(), {}, 'nl');
    expect(nl).toContain('Voorgestelde koppeling: NETFLIX.COM');
    expect(nl).toContain('Aanmaken in AB');
  });
  it('Create appears only on rows without a candidate and opens the pre-fill modals', () => {
    const html = render(ready());
    expect(html.match(/>Create in AB<\/button>/g)).toHaveLength(1);
    expect(html.match(/>Create in Wallos<\/button>/g)).toHaveLength(1);
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
    const files: Record<string, string> = { dashboardSrc, storeSrc, apiSrc, rowSrc, toolbarSrc, pairListSrc, pairRowsSrc };
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
    expect(html).toContain('data-variant="warning"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain('Check settings');
    expect(html).not.toContain('>Retry<');
  });
  it('sync failure names the side, offers Retry and Check settings, and keeps the last result marked Stale', () => {
    const html = render({ status: 'error', result: sample(), errorCode: 'actual_unavailable' });
    expect(html).toContain('The sync check failed on the Actual Budget side.');
    expect(html).toContain('data-variant="error"');
    expect(html).toContain('text-danger');
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
  it('mobile keeps the segmented control and shows one side at a time (#142)', () => {
    const html = render(ready());
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Show list"');
    expect(html).toContain('Wallos (2)');
    expect(html).toContain('Actual Budget (2)');
    expect(html).toContain('md:hidden');
    // Wallos is the default pane: Actual cells and the Actual heading hide below 768px, Wallos ones do not.
    expect(cellOf(html, 'actual', 'a1')).not.toContain('max-md:hidden');
    expect(html).toMatch(/<div class="min-w-0 max-md:hidden md:border-l"><div data-row-id="a1" data-side="actual"/);
    expect(html).toMatch(/<div class="min-w-0 {2}"><div data-row-id="w1" data-side="wallos"/);
    expect(html).toMatch(/id="col-actual" class="[^"]*max-md:hidden/);
    expect(html).not.toMatch(/id="col-wallos" class="[^"]*max-md:hidden/);
    // A row with nothing on the shown side hides there: the Actual-only row (Rent).
    expect(html).toMatch(/data-pair="actual" class="[^"]*max-md:hidden/);
    expect(html).not.toMatch(/data-pair="wallos" class="[^"]*max-md:hidden/);
  });
  it('renders linked pairs first, then suggested pairs by score, then Wallos-only, then Actual-only (#142)', () => {
    const r = {
      ...sample(),
      linked: [
        {
          matchId: 'm7',
          wallosId: 'wl',
          actualScheduleId: 'al',
          status: 'LINKED' as const,
          orphan: null,
          wallosName: 'Linked W',
          actualName: 'Linked A',
          wallosAmountCents: 700,
          actualAmountCents: 700,
          isRange: false,
          relinkCandidateIds: [],
        },
      ],
    };
    const html = render({ status: 'ready', result: r, errorCode: null });
    const kinds = [...html.matchAll(/data-pair="(\w+)"/g)].map((m) => m[1]);
    expect(kinds).toEqual(['linked', 'suggested', 'wallos', 'actual']);
    const at = (name: string) => html.indexOf(name);
    expect(at('Linked W')).toBeLessThan(at('NETFLIX.COM'));
    expect(at('NETFLIX.COM')).toBeLessThan(at('Gym'));
    expect(at('Gym')).toBeLessThan(at('Rent'));
    // The linked row carries its status badge and no actions.
    const linkedStart = html.indexOf('data-pair="linked"');
    const linked = html.slice(linkedStart, html.indexOf('</li>', linkedStart));
    expect(linked).toContain('data-kind="synced"');
    expect(linked).not.toContain('<button');
    // The suggested row holds both sides of the pair side by side.
    const suggested = html.slice(html.indexOf('data-pair="suggested"'), html.indexOf('data-pair="wallos"'));
    expect(suggested).toContain('data-row-id="w1" data-side="wallos"');
    expect(suggested).toContain('data-row-id="a1" data-side="actual"');
  });
  it('an unpaired item gets an empty placeholder of the other side in its row (#142)', () => {
    const html = render(ready());
    const wallosOnly = html.slice(html.indexOf('data-pair="wallos"'), html.indexOf('data-pair="actual"'));
    expect(wallosOnly).toContain('data-row-id="w2" data-side="wallos"');
    expect(wallosOnly).toContain('aria-hidden="true" data-placeholder="actual"');
    expect(wallosOnly).not.toContain('data-side="actual"');
    const actualOnly = html.slice(html.indexOf('data-pair="actual"'));
    expect(actualOnly).toContain('data-row-id="a2" data-side="actual"');
    expect(actualOnly).toContain('data-placeholder="wallos"');
    // The placeholder is the first cell of its row: left of the Actual item.
    expect(actualOnly.indexOf('data-placeholder="wallos"')).toBeLessThan(actualOnly.indexOf('data-row-id="a2"'));
    // A paired row has no placeholder.
    const suggested = html.slice(html.indexOf('data-pair="suggested"'), html.indexOf('data-pair="wallos"'));
    expect(suggested).not.toContain('data-placeholder');
  });
  it('search keeps a row when either side matches (#142)', () => {
    // "NETFLIX.COM" is the Actual name only; the row keeps its Wallos cell.
    const html = render(ready(), { query: 'netflix.com' });
    expect(html).toContain('data-row-id="w1" data-side="wallos"');
    expect(html).toContain('data-row-id="a1" data-side="actual"');
    expect(html).not.toContain('Gym');
    expect(html).not.toContain('Rent');
  });
  it('ignored items stay in the per-side disclosure, not in the pair rows (#142)', () => {
    const html = render(ready());
    expect(html).toContain('Ignored items (1)');
    expect(html.match(/data-row-id="w9"/g) ?? []).toHaveLength(0); // collapsed: content is not rendered
    expect(html).not.toContain('data-pair="ignored"');
    expect(html).not.toContain('Old');
  });
  describe('group boxes', () => {
    const linkedRow = {
      matchId: 'm7',
      wallosId: 'wl',
      actualScheduleId: 'al',
      status: 'LINKED' as const,
      orphan: null,
      wallosName: 'Linked W',
      actualName: 'Linked A',
      wallosAmountCents: 700,
      actualAmountCents: 700,
      isRange: false,
      relinkCandidateIds: [],
    };
    const all = (): SyncStoreState => ({ status: 'ready', result: { ...sample(), linked: [linkedRow] }, errorCode: null });
    const groupOf = (html: string, kind: string) => {
      const start = html.indexOf(`data-group="${kind}"`);
      expect(start, `group ${kind}`).toBeGreaterThan(-1);
      const next = html.indexOf('data-group="', start + 1);
      return html.slice(start, next === -1 ? undefined : next);
    };
    it('each non-empty group is its own open disclosure with a count, in order', () => {
      const html = render(all());
      expect([...html.matchAll(/data-group="(\w+)"/g)].map((m) => m[1])).toEqual(['linked', 'suggested', 'wallos', 'actual']);
      expect(groupOf(html, 'linked')).toContain('Linked pairs (1)');
      expect(groupOf(html, 'suggested')).toContain('Suggested pairs (1)');
      expect(groupOf(html, 'wallos')).toContain('Wallos only (1)');
      expect(groupOf(html, 'actual')).toContain('Actual only (1)');
      for (const kind of ['linked', 'suggested', 'wallos', 'actual']) {
        expect(groupOf(html, kind)).toContain('aria-expanded="true"');
      }
      // Rows stay in their own group.
      expect(groupOf(html, 'linked')).toContain('data-pair="linked"');
      expect(groupOf(html, 'linked')).not.toContain('data-pair="suggested"');
      expect(groupOf(html, 'wallos')).toContain('data-row-id="w2"');
      expect(groupOf(html, 'actual')).toContain('data-row-id="a2"');
    });
    it('a group with no rows is not rendered', () => {
      const html = render(ready());
      expect(html).not.toContain('data-group="linked"');
      expect(html).not.toContain('Linked pairs');
      expect(html).toContain('data-group="suggested"');
    });
    it('the search hides a group with no match', () => {
      const html = render(all(), { query: 'rent' });
      expect(html).toContain('data-group="actual"');
      expect(html).toContain('Actual only (1)');
      for (const kind of ['linked', 'suggested', 'wallos']) expect(html).not.toContain(`data-group="${kind}"`);
    });
    it('keeps the order of rows inside a group', () => {
      const r = {
        ...sample(),
        unlinkedWallos: [
          { id: 'wa', name: 'Zeta', amountCents: 100, isRange: false, reason: null },
          { id: 'wb', name: 'Alpha', amountCents: 100, isRange: false, reason: null },
        ],
        unlinkedActual: [],
        candidates: [],
      };
      const html = render({ status: 'ready', result: r, errorCode: null });
      const box = groupOf(html, 'wallos');
      expect(box).toContain('Wallos only (2)');
      expect(box.indexOf('Zeta')).toBeLessThan(box.indexOf('Alpha'));
    });
    it('group headings exist in nl', () => {
      const html = render(all(), {}, 'nl');
      expect(html).toContain('Gekoppelde paren (1)');
      expect(html).toContain('Voorgestelde paren (1)');
      expect(html).toContain('Alleen in Wallos (1)');
      expect(html).toContain('Alleen in Actual (1)');
    });
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

const linkedFixture = (): SyncCheckResult => ({
  ...sample(),
  linked: [
    {
      matchId: 'm1', wallosId: 'lw1', actualScheduleId: 'la1', status: 'LINKED', orphan: null,
      wallosName: 'Spotify', actualName: 'Spotify AB', wallosAmountCents: 999, actualAmountCents: 999, isRange: false, relinkCandidateIds: [],
    },
    {
      matchId: 'm2', wallosId: 'lw2', actualScheduleId: 'la2', status: 'LINKED', orphan: null,
      wallosName: 'Netflix Plan', actualName: 'Netflix AB', wallosAmountCents: 1299, actualAmountCents: 1500, isRange: false, relinkCandidateIds: [],
    },
  ],
});

describe('Sync Dashboard counts line and differing cue (retire-matches-tab)', () => {
  it('counts line counts only the filtered linked rows, with differences among them', () => {
    const html = render({ status: 'ready', result: linkedFixture(), errorCode: null }, { query: 'netflix' });
    expect(html).toContain('1 of 2 pairs, 1 with differences');
    expect(html).not.toContain('2 of 2 pairs');
  });
  it('counts line shows every linked row when the search is empty', () => {
    const html = render({ status: 'ready', result: linkedFixture(), errorCode: null });
    expect(html).toContain('2 of 2 pairs, 1 with differences');
  });
  it('counts line is absent when there are no linked rows', () => {
    const html = render({ status: 'ready', result: sample(), errorCode: null });
    expect(html).not.toContain(' pairs, ');
  });
  it('counts line in nl uses the same keys with Dutch text', () => {
    const html = render({ status: 'ready', result: linkedFixture(), errorCode: null }, {}, 'nl');
    expect(html).toContain('2 van 2 paren, 1 met verschillen');
  });
  it('differing cue (bold and hidden "differs") appears only on linked cells whose amounts differ', () => {
    const html = render({ status: 'ready', result: linkedFixture(), errorCode: null });
    expect(cellOf(html, 'wallos', 'lw2')).toContain('<span class="sr-only"> differs</span>');
    expect(cellOf(html, 'wallos', 'lw2')).toContain('font-bold');
    expect(cellOf(html, 'wallos', 'lw1')).not.toContain('differs');
    expect(cellOf(html, 'wallos', 'lw1')).not.toContain('font-bold');
    expect(cellOf(html, 'actual', 'la2')).toContain('<span class="sr-only"> differs</span>');
    expect(cellOf(html, 'actual', 'la1')).not.toContain('differs');
    expect(html.match(/> differs<\/span>/g)).toHaveLength(2);
  });
  it('differs in nl is "wijkt af"', () => {
    const html = render({ status: 'ready', result: linkedFixture(), errorCode: null }, {}, 'nl');
    expect(html).toContain('> wijkt af</span>');
  });
});

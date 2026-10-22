import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import type { SyncCheckResult, SyncLinked, SyncIgnored } from '../../lib/sync-check-types';
import matchesSrc from './Matches.tsx?raw';
import storeSrc from '@/lib/sync-check.ts?raw';
import { MatchesView, type MatchesViewProps } from './Matches';

const linkedRow = (over: Partial<SyncLinked>): SyncLinked => ({
  matchId: 'm',
  wallosId: 'w',
  actualScheduleId: 'a',
  status: 'LINKED',
  orphan: null,
  wallosName: 'Netflix',
  actualName: 'NETFLIX.COM',
  wallosAmountCents: 1299,
  actualAmountCents: 1299,
  isRange: false,
  ...over,
});

/** Linked rows covering the three badge kinds that a linked row can have. */
const LINKED: SyncLinked[] = [
  linkedRow({ matchId: 'm1', wallosId: 'w1', actualScheduleId: 'a1' }),
  linkedRow({
    matchId: 'm2',
    wallosId: 'w2',
    actualScheduleId: 'a2',
    status: 'MISMATCH_DETECTED',
    wallosName: 'Gym',
    actualName: 'Fitness Club',
    wallosAmountCents: 4000,
    actualAmountCents: 4500,
  }),
  linkedRow({
    matchId: 'm3',
    wallosId: 'w3',
    actualScheduleId: 'a3',
    orphan: 'orphaned_actual',
    wallosName: 'Old Cloud',
    actualName: null,
    wallosAmountCents: 500,
    actualAmountCents: null,
  }),
];

const IGNORED: SyncIgnored[] = [
  {
    matchId: 'i1',
    side: 'wallos',
    itemId: 'w9',
    name: 'Old Magazine',
    amountCents: 900,
    isRange: false,
    reason: null,
  },
];

const fixture = (over: Partial<SyncCheckResult> = {}): SyncCheckResult => ({
  checkedAt: '2026-10-23T00:00:00.000Z',
  baseCurrency: 'EUR',
  unlinkedWallos: [],
  unlinkedActual: [],
  candidates: [],
  mismatches: [],
  unmappable: [],
  orphaned: [],
  linked: LINKED,
  ignored: IGNORED,
  ...over,
});

const render = (props: Partial<MatchesViewProps>, locale: Locale = 'en') =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <MatchesView result={fixture()} showIgnored={false} {...props} />
    </I18nProvider>,
  );

describe('Matches table rows', () => {
  it('renders one row per linked pair with names, amounts and the badge kind', () => {
    const html = render({});
    expect(html.match(/data-match-row/g)).toHaveLength(3);
    expect(html).toContain('Netflix');
    expect(html).toContain('NETFLIX.COM');
    expect(html).toMatch(/font-mono"><span>€12\.99<\/span>/);
    expect(html).toMatch(/font-mono"><span>€40\.00<\/span>/);
    expect(html).toMatch(/font-mono"><span>€45\.00<\/span>/);
  });

  it('shows the synced, mismatch and orphaned badge kinds for linked rows', () => {
    const html = render({});
    expect(html).toContain('data-kind="synced"');
    expect(html).toContain('data-kind="mismatch"');
    expect(html).toContain('data-kind="orphaned"');
  });

  it('shows the range flag only on a range row', () => {
    expect(render({})).not.toContain('>range</span>');
    const ranged = fixture({ linked: [linkedRow({ isRange: true })] });
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <MatchesView result={ranged} showIgnored={false} />
      </I18nProvider>,
    );
    expect(html).toContain('>range</span>');
  });

  it('uses py-1.5 px-3 cells and font-mono right-aligned amounts', () => {
    const html = render({});
    expect(html).toContain('px-3 py-1.5');
    expect(html).toContain('text-right font-mono');
  });
});

describe('Matches missing sides', () => {
  it('shows an em dash for a null name and a null amount', () => {
    const html = render({});
    const orphanRow = html.slice(html.indexOf('Old Cloud') - 200, html.indexOf('Old Cloud') + 600);
    expect(orphanRow).toContain('—');
    expect(orphanRow).toContain('text-muted-foreground');
    expect(orphanRow).toContain('€5.00');
  });
});

describe('Matches empty state', () => {
  it('tells the user to run Sync Check when there is no linked data', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <MatchesView result={null} showIgnored={false} />
      </I18nProvider>,
    );
    expect(html).toContain('Run Sync Check on the Sync Dashboard to load them.');
    expect(html).not.toContain('<table');
  });

  it('shows the empty text when the result has no linked rows', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <MatchesView result={fixture({ linked: [], ignored: [] })} showIgnored={false} />
      </I18nProvider>,
    );
    expect(html).toContain('No linked pairs yet.');
    expect(html).not.toContain('<table');
  });
});

describe('Matches ignored section', () => {
  it('is absent by default', () => {
    const html = render({ showIgnored: false });
    expect(html).not.toContain('Ignored items');
    expect(html).not.toContain('data-ignored-row');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    expect(html).toContain('Show ignored items');
  });

  it('is present with the ignored badge when the switch is on', () => {
    const html = render({ showIgnored: true });
    expect(html).toContain('Ignored items');
    expect(html).toContain('data-ignored-row');
    expect(html).toContain('Old Magazine');
    expect(html).toContain('data-kind="ignored"');
    expect(html).toContain('aria-checked="true"');
  });

  it('is shown in nl with the nl toggle label', () => {
    const html = render({ showIgnored: true }, 'nl');
    expect(html).toContain('Genegeerde items tonen');
    expect(html).toContain('Genegeerde items');
    expect(html).toContain('data-kind="ignored"');
  });
});

describe('Matches is read-only', () => {
  it('imports no write client', () => {
    expect(matchesSrc).not.toMatch(/matches\.api/);
    expect(matchesSrc).not.toMatch(/linkPair|ignoreItem|restore/i);
    expect(storeSrc).toContain('export function useSyncCheck');
  });
});

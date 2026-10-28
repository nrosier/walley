import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import type { SyncCheckResult, SyncLinked, SyncIgnored } from '../../lib/sync-check-types';
import matchesSrc from './Matches.tsx?raw';
import storeSrc from '@/lib/sync-check.ts?raw';
import { Matches, MatchesView, type MatchesViewProps } from './Matches';
import { matchesMessages } from './Matches.messages';
import { checkIfEmpty, createSyncStore, restoreAndRecheck, syncStore } from '@/lib/sync-check';
import { performResolve } from '@/lib/resolve-mismatch';

// The test environment is node, so useSyncExternalStore has no server snapshot. Matches is rendered
// with a hook that reads the real shared store's current state once, which is all SSR needs.
vi.mock('@/lib/sync-check', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/sync-check')>();
  return {
    ...actual,
    useSyncCheck: () => ({
      ...actual.syncStore.getState(),
      run: actual.syncStore.run,
      requestRun: actual.syncStore.requestRun,
      setResult: actual.syncStore.setResult,
    }),
  };
});

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
  relinkCandidateIds: [],
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
    expect(html).toMatch(/font-mono[^"]*"><span>€12\.99<\/span>/);
    expect(html).toMatch(/font-mono[^"]*"><span>€40\.00<\/span>/);
    expect(html).toMatch(/font-mono[^"]*"><span>€45\.00<\/span>/);
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
    expect(orphanRow).toContain('text-muted');
    expect(orphanRow).toContain('€5.00');
  });
});

describe('Matches empty state', () => {
  it('shows the empty text when there is no linked data', () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <MatchesView result={null} showIgnored={false} />
      </I18nProvider>,
    );
    expect(html).toContain('Link items on the Sync Dashboard and they appear here.');
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

describe('Matches ignored section Restore', () => {
  it('puts Restore inside a More actions menu named for the row, not as a visible button', () => {
    const html = render({ result: fixture(), showIgnored: true });
    expect(html.match(/aria-label="More actions for Old Magazine"/g)).toHaveLength(fixture().ignored.length);
    expect(html).not.toContain('>Restore<');
  });
  it('names Restore per row in en and nl', () => {
    expect(matchesMessages.en.ignored.restoreNamed.replace('{name}', 'Amazon Prime')).toBe('Restore Amazon Prime');
    expect(matchesMessages.nl.ignored.restoreNamed.replace('{name}', 'Amazon Prime')).toBe('Amazon Prime herstellen');
    expect(render({ result: fixture(), showIgnored: true }, 'nl')).toContain('aria-label="Meer acties voor Old Magazine"');
  });
  it('uses only the restore write client and keeps the shared store', () => {
    expect(matchesSrc).not.toMatch(/linkPair|ignoreItem/);
    expect(storeSrc).toContain('export function useSyncCheck');
  });
});

describe('Matches auto re-check', () => {
  const checkCalls = (f: ReturnType<typeof vi.fn>) =>
    f.mock.calls.filter((c) => (c as unknown as [string])[0] === '/api/sync/check').length;
  /** Routes the fake fetch by URL; check responses are returned by `check`. */
  const setup = (opts: { del?: number; resolve?: Response; check?: () => Promise<Response> } = {}) => {
    const f = vi.fn(async (url: string) => {
      if (url === '/api/sync/check') return opts.check ? opts.check() : Response.json(fixture());
      if (url.endsWith('/resolve')) return opts.resolve ?? new Response(null, { status: 204 });
      if ((opts.del ?? 204) === 204) return new Response(null, { status: 204 });
      return Response.json({ error: 'match_not_found' }, { status: opts.del });
    });
    const store = createSyncStore(f as unknown as typeof fetch);
    store.setResult(fixture());
    return { f, store };
  };

  it('a successful Restore triggers exactly one check', async () => {
    const { f, store } = setup();
    expect(await restoreAndRecheck(store, 'i1', f as unknown as typeof fetch)).toEqual({ ok: true });
    await vi.waitFor(() => { expect(store.getState().status).toBe('ready'); });
    expect(checkCalls(f)).toBe(1);
  });

  it('a failed Restore triggers no check', async () => {
    const { f, store } = setup({ del: 404 });
    expect(await restoreAndRecheck(store, 'i1', f as unknown as typeof fetch)).toEqual({ ok: false, code: 'match_not_found' });
    expect(checkCalls(f)).toBe(0);
  });

  it('a successful resolve triggers a check through requestRun', async () => {
    const { f, store } = setup();
    const out = await performResolve(() => store.getState().result, store.setResult, 'm2', 'ignore_diff', store.requestRun, f as unknown as typeof fetch);
    expect(out).toEqual({ ok: true });
    expect(checkCalls(f)).toBe(1);
  });

  it('no_change_needed triggers no check', async () => {
    const { f, store } = setup({ resolve: Response.json({ outcome: 'no_change_needed' }) });
    const out = await performResolve(() => store.getState().result, store.setResult, 'm2', 'overwrite_actual', store.requestRun, f as unknown as typeof fetch);
    expect(out).toEqual({ ok: false, code: 'no_change_needed' });
    expect(checkCalls(f)).toBe(0);
  });

  it('opening with no result starts a check; with a result it does not', async () => {
    const { f, store } = setup();
    checkIfEmpty(store); // setup stored a result
    expect(checkCalls(f)).toBe(0);
    const empty = createSyncStore(f as unknown as typeof fetch);
    checkIfEmpty(empty);
    expect(empty.getState().status).toBe('loading');
    checkIfEmpty(empty); // already loading: no second check
    await vi.waitFor(() => { expect(empty.getState().status).toBe('ready'); });
    expect(checkCalls(f)).toBe(1);
  });

  it('a failing check keeps the restored row restored', async () => {
    const { f, store } = setup({ check: async () => Response.json({ error: 'boom' }, { status: 500 }) });
    await restoreAndRecheck(store, 'i1', f as unknown as typeof fetch);
    await vi.waitFor(() => { expect(store.getState().status).toBe('error'); });
    const r = store.getState().result;
    expect(r?.ignored).toEqual([]);
    expect(r?.unlinkedWallos.map((i) => i.id)).toContain('w9');
  });

  it('renders the updating status while a check runs and not otherwise', () => {
    const html = render({ checking: true });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Updating sync status…');
    expect(render({})).not.toContain('Updating sync status…');
    expect(render({ checking: true }, 'nl')).toContain('Synchronisatiestatus bijwerken…');
  });

  it('renders the error line with Retry, and keeps the table', () => {
    const html = render({ checkErrorMessage: 'Saved. Sync status could not be refreshed: x' });
    expect(html).toContain('Saved. Sync status could not be refreshed: x');
    expect(html).toContain('>Retry</button>');
    expect(html).toContain('data-match-row');
  });

  it('wires Matches to requestRun and checkIfEmpty', () => {
    expect(matchesSrc).toContain('syncStore.requestRun)');
    expect(matchesSrc).toContain('checkIfEmpty(syncStore)');
  });

  const statusOf = (r: SyncCheckResult | null | undefined) => r?.linked.find((l) => l.matchId === 'm2')?.status;

  it('a failed check after a resolve keeps the resolved state and rolls nothing back', async () => {
    let n = 0;
    const { f, store } = setup({ check: async () => (++n === 1 ? Response.json({ error: 'boom' }, { status: 500 }) : Response.json(fixture())) });
    expect(statusOf(store.getState().result)).toBe('MISMATCH_DETECTED');
    const out = await performResolve(() => store.getState().result, store.setResult, 'm2', 'ignore_diff', store.requestRun, f as unknown as typeof fetch);
    expect(out).toEqual({ ok: true });
    expect(store.getState().status).toBe('error');
    expect(statusOf(store.getState().result)).toBe('LINKED');
  });

  it('a check in flight before a resolve cannot put the Mismatch status back when it lands', async () => {
    const pending: Array<(r: Response) => void> = [];
    const f = vi.fn(async (url: string) => {
      if (url === '/api/sync/check') return new Promise<Response>((resolve) => { pending.push(resolve); });
      return new Response(null, { status: 204 });
    });
    const store = createSyncStore(f as unknown as typeof fetch);
    store.setResult(fixture());
    const running = store.requestRun(); // check started before the resolve
    const resolving = performResolve(() => store.getState().result, store.setResult, 'm2', 'ignore_diff', store.requestRun, f as unknown as typeof fetch);
    pending[0]?.(Response.json(fixture())); // stale pre-resolve answer lands after the optimistic write
    await vi.waitFor(() => { expect(pending.length).toBe(2); });
    expect(statusOf(store.getState().result)).toBe('LINKED');
    pending[1]?.(Response.json({ error: 'boom' }, { status: 500 }));
    await Promise.all([running, resolving]);
    expect(statusOf(store.getState().result)).toBe('LINKED');
  });
});

describe('Matches page after a failed re-check', () => {
  it('keeps the last good Matches rows and shows an error when a re-check fails', async () => {
    syncStore.setResult(fixture());
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'bad_gateway' }, { status: 502 })));
    try {
      await syncStore.run(); // the public path the page's Retry and mount check use
    } finally {
      vi.unstubAllGlobals();
    }
    expect(syncStore.getState().status).toBe('error');
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <Matches />
      </I18nProvider>,
    );
    expect(html.match(/data-match-row/g)).toHaveLength(3);
    expect(html).toContain('Netflix');
    expect(html).toContain('Saved. Sync status could not be refreshed:');
    expect(html).toContain('>Retry</button>');
  });
});

describe('Matches table layout and cues', () => {
  it('groups the headers under Wallos and Actual Budget with sticky header levels and a sticky first column', () => {
    const html = render({});
    expect(html).toMatch(/scope="colgroup"[^>]*colSpan="2"|colSpan="2"[^>]*scope="colgroup"|scope="colgroup"[^>]*colspan="2"/i);
    expect(html).toContain('>Wallos</th>');
    expect(html).toContain('>Actual Budget</th>');
    expect(html).toContain('sticky top-0');
    expect(html).toContain('sticky top-8');
    expect(html).toContain('sticky left-0');
    expect(html).toContain('overflow-auto');
  });
  it('makes differing amounts bold with hidden "differs" text, and leaves equal amounts plain', () => {
    const html = render({});
    expect(html.match(/<span class="sr-only"> differs<\/span>/g)).toHaveLength(2);
    expect(html.match(/font-bold/g)).toHaveLength(2);
    const start = html.indexOf('data-match-row');
    const equal = html.slice(start, html.indexOf('</tr>', start));
    expect(equal).not.toContain('font-bold');
    expect(render({}, 'nl')).toContain('> wijkt af</span>');
  });
  it('shows a search box, the counts line, and Run Sync Check on the page', () => {
    const html = render({});
    expect(html).toContain('type="search"');
    expect(html).toContain('3 of 3 pairs, 1 with differences');
    expect(html).toContain('>Run Sync Check<');
    expect(render({ checking: true })).toContain('Checking...');
    expect(render({}, 'nl')).toContain('3 van 3 paren, 1 met verschillen');
  });
  it('filters pairs by either name and says so when nothing matches', () => {
    const html = render({ query: 'fitness' });
    expect(html.match(/data-match-row/g)).toHaveLength(1);
    expect(html).toContain('1 of 3 pairs');
    const none = render({ query: 'zzz' });
    expect(none).toContain('No pairs match your search.');
    expect(none).not.toContain('data-match-row');
  });
  it('the empty state offers both actions: open the Sync Dashboard and Run Sync Check', () => {
    const html = render({ result: fixture({ linked: [] }) });
    expect(html).toContain('href="/sync"');
    expect(html).toContain('Open Sync Dashboard');
    expect(html.match(/>Run Sync Check</g)).toHaveLength(1);
    expect(html).not.toContain('<table');
  });
  it('the Review button has a unique name and a hook for focus return', () => {
    const html = render({ onReview: () => undefined });
    expect(html).toContain('aria-label="Review differences: Gym"');
    expect(html).toContain('data-review-for="m2"');
  });
  it('loads pairs without a prior check: the page starts one on open, only when there is no result', () => {
    expect(matchesSrc).toContain('checkIfEmpty(syncStore)');
  });
});

describe('Matches orphan actions menu', () => {
  const orphanRows = [
    linkedRow({ matchId: 'o1', wallosId: 'w1', actualScheduleId: 'a1', orphan: 'orphaned_actual', wallosName: 'Lost Actual', actualName: null }),
    linkedRow({ matchId: 'o2', wallosId: 'w2', actualScheduleId: 'a2', orphan: 'orphaned_wallos', wallosName: null, actualName: 'Lost Wallos' }),
    linkedRow({ matchId: 'o3', wallosId: 'w3', actualScheduleId: 'a3', orphan: 'orphaned_both', wallosName: null, actualName: null }),
    linkedRow({ matchId: 'o4', wallosId: 'w4', actualScheduleId: 'a4', status: 'MISMATCH_DETECTED', wallosName: 'Drifted' }),
    linkedRow({ matchId: 'o5', wallosId: 'w5', actualScheduleId: 'a5', wallosName: 'Fine' }),
  ];
  const html = render({ result: fixture({ linked: orphanRows, ignored: [] }), onReview: () => undefined });

  it('shows the actions menu only on single-side orphan rows, named for the surviving item', () => {
    expect(html.match(/aria-label="More actions for /g)).toHaveLength(2);
    expect(html).toContain('aria-label="More actions for Lost Actual"');
    expect(html).toContain('aria-label="More actions for Lost Wallos"');
  });

  it('shows no actions on orphaned_both, mismatch or synced rows', () => {
    expect(html).not.toContain('More actions for Drifted');
    expect(html).not.toContain('More actions for Fine');
    expect(html).not.toContain('More actions for —');
  });

  it('names the actions in en and nl with identical catalogue keys', () => {
    expect(Object.keys(matchesMessages.nl.orphan)).toEqual(Object.keys(matchesMessages.en.orphan));
    expect(matchesMessages.en.orphan.link).toBe('Link to another item');
    expect(render({ result: fixture({ linked: orphanRows }) }, 'nl')).toContain('aria-label="Meer acties voor Lost Actual"');
  });

  it('wires Recreate to the create modals with the match id, Link to the candidates, and mounts the notice toast', () => {
    expect(matchesSrc).toMatch(/<CreateActualModal[\s\S]*?matchId=\{orphanAction\.row\.matchId\}/);
    expect(matchesSrc).toMatch(/<CreateWallosModal[\s\S]*?matchId=\{orphanAction\.row\.matchId\}/);
    expect(matchesSrc).toContain('<NoticeToast />');
    expect(matchesSrc).toMatch(/<RelinkDialog[\s\S]*?candidateIds=\{orphanAction\.row\.relinkCandidateIds\}/);
  });
});

describe('Matches and diff modal checklist (issue 113)', () => {
  it('Header is sticky with Wallos / Actual Budget groups; search and counts line work; empty state offers both actions', () => {
    const html = render({});
    // Two sticky header levels with the Wallos / Actual Budget group cells.
    expect(html).toContain('sticky top-0');
    expect(html).toContain('sticky top-8');
    expect(html).toContain('>Wallos</th>');
    expect(html).toContain('>Actual Budget</th>');
    // Search narrows the rows and the counts line follows.
    expect(html).toContain('type="search"');
    expect(html).toContain('3 of 3 pairs, 1 with differences');
    const filtered = render({ query: 'fitness' });
    expect(filtered.match(/data-match-row/g)).toHaveLength(1);
    expect(filtered).toContain('1 of 3 pairs');
    // The empty state offers Open Sync Dashboard and Run Sync Check.
    const empty = render({ result: fixture({ linked: [] }) });
    expect(empty).toContain('href="/sync"');
    expect(empty).toContain('Open Sync Dashboard');
    expect(empty.match(/>Run Sync Check</g)).toHaveLength(1);
  });
});

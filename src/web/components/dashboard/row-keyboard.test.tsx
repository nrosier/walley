// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncCheckResult, SyncItem, SyncLinked, SyncMismatch } from '../../../lib/sync-check-types';

// Keyboard and screen reader behaviour of the Sync Dashboard rows (issue 170), on the mounted page with a fake
// fetch. Real DOM, no source-string matching. The shared syncStore and the announcer are module singletons, so
// every test loads a fresh module graph (as SyncDashboard.mount.test.tsx does).
//
// jsdom has no Tab key navigation, so `tabStops` below computes the tab sequence the way a browser does for
// tabindex 0 elements: natively focusable or tabindex >= 0, minus tabindex -1, disabled, hidden, aria-hidden.

// jsdom lacks these APIs that Radix uses. Local to this file: there is no vitest setup file.
beforeAll(() => {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  const define = (target: object, name: string, value: unknown) => {
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  };
  define(globalThis, 'ResizeObserver', ResizeObserverStub);
  define(Element.prototype, 'hasPointerCapture', () => false);
  define(Element.prototype, 'setPointerCapture', () => undefined);
  define(Element.prototype, 'releasePointerCapture', () => undefined);
  define(Element.prototype, 'scrollIntoView', () => undefined);
  // The page focuses rows with CSS.escape in attribute selectors.
  const css = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
  if (css?.escape === undefined) {
    define(globalThis, 'CSS', { ...css, escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) });
  }
});

// ---- fixture ------------------------------------------------------------------------------------------------

const item = (id: string, name: string, amountCents = 1000): SyncItem => ({ id, name, amountCents, isRange: false, reason: null });

const fields = (cents: number) => ({
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-01-01',
  currency: 'EUR',
  amount: { kind: 'single', cents } as const,
});

const linked = (over: Partial<SyncLinked> & Pick<SyncLinked, 'matchId' | 'wallosId' | 'actualScheduleId'>): SyncLinked => ({
  status: 'LINKED',
  orphan: null,
  wallosName: null,
  actualName: null,
  wallosAmountCents: 1000,
  actualAmountCents: 1000,
  isRange: false,
  relinkCandidateIds: [],
  ...over,
});

const adobeMismatch: SyncMismatch = {
  matchId: 'm-ad',
  wallosId: 'w-ad',
  actualScheduleId: 'a-ad',
  wallosName: 'Adobe',
  actualName: 'Adobe CC',
  wallosAmountCents: 1000,
  actualAmountCents: 1200,
  isRange: false,
  wallosDrift: true,
  actualDrift: false,
  wallosFields: fields(1000),
  actualFields: fields(1200),
};

/** Every row kind: linked (synced, mismatch, orphaned), one suggested pair, unpaired on both sides and one ignored. */
function fixture(): SyncCheckResult {
  return {
    checkedAt: '2026-01-01T00:00:00Z',
    baseCurrency: 'EUR',
    unlinkedWallos: [item('w-net', 'Netflix', 1299), item('w-hulu', 'Hulu'), item('w-dis', 'Disney')],
    unlinkedActual: [item('a-net', 'NETFLIX.COM', 1299), item('a-gym', 'Gym', 4000)],
    candidates: [
      { wallosId: 'w-net', actualScheduleId: 'a-net', nameScore: 0.9, wallosName: 'Netflix', actualName: 'NETFLIX.COM', wallosAmountCents: 1299, actualAmountCents: 1299, isRange: false },
    ],
    mismatches: [adobeMismatch],
    linked: [
      linked({ matchId: 'm-sp', wallosId: 'w-sp', actualScheduleId: 'a-sp', wallosName: 'Spotify', actualName: 'Spotify EU' }),
      linked({ matchId: 'm-ad', wallosId: 'w-ad', actualScheduleId: 'a-ad', status: 'MISMATCH_DETECTED', wallosName: 'Adobe', actualName: 'Adobe CC', actualAmountCents: 1200 }),
      linked({ matchId: 'm-or', wallosId: 'w-or', actualScheduleId: 'a-or', orphan: 'orphaned_actual', wallosName: 'Orphan', actualName: null, actualAmountCents: null }),
    ],
    ignored: [{ matchId: 'm-old', side: 'wallos', itemId: 'w-old', name: 'Old', amountCents: 300, isRange: false, reason: null }],
    unmappable: [],
    orphaned: [],
  };
}

/** The 11 cells of the fixture: side, row id, name. */
const CELLS: ReadonlyArray<readonly ['wallos' | 'actual', string, string]> = [
  ['wallos', 'w-sp', 'Spotify'],
  ['actual', 'a-sp', 'Spotify EU'],
  ['wallos', 'w-ad', 'Adobe'],
  ['actual', 'a-ad', 'Adobe CC'],
  ['wallos', 'w-or', 'Orphan'],
  ['wallos', 'w-net', 'Netflix'],
  ['actual', 'a-net', 'NETFLIX.COM'],
  ['wallos', 'w-hulu', 'Hulu'],
  ['wallos', 'w-dis', 'Disney'],
  ['actual', 'a-gym', 'Gym'],
  ['wallos', 'w-old', 'Old'],
];

// ---- fake server --------------------------------------------------------------------------------------------

interface Call {
  method: string;
  url: string;
  body: unknown;
}
interface Server {
  result: SyncCheckResult;
  failIgnore: boolean;
  calls: Call[];
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const prefill = {
  name: 'Hulu',
  amountCents: -1000,
  baseCurrency: 'EUR',
  sourceCurrency: 'EUR',
  wallosRate: null,
  overrideRate: null,
  recurrence: { frequency: 'monthly', interval: 1 },
  startDate: '2026-11-01',
  accounts: [{ id: 'acc1', name: 'Checking' }],
  payees: [],
  categories: [],
};

function makeFetch(server: Server) {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    server.calls.push({ method, url, body });
    if (url.includes('/api/sync/check')) return json(200, server.result);
    if (url === '/api/matches/ignore') return server.failIgnore ? json(500, { error: 'request_failed' }) : json(201, { id: 'm-new', status: 'IGNORED_WALLOS' });
    if (url === '/api/matches' && method === 'POST') return json(201, { id: 'm-link', status: 'LINKED' });
    if (url.endsWith('/resolve')) {
      const unlink = (body as { action?: string } | undefined)?.action === 'unlink';
      if (unlink) server.result = { ...server.result, linked: server.result.linked.filter((l) => !url.includes(l.matchId)) };
      return new Response(null, { status: 204 });
    }
    if (url.startsWith('/api/matches/') && method === 'DELETE') return new Response(null, { status: 204 });
    if (url === '/api/integrations/actual-schedules/prefill') return json(200, prefill);
    if (url === '/api/integrations/actual-schedules') {
      return json(201, { scheduleId: 's1', payeeId: 'p1', payeeCreated: false, categoryApplied: false });
    }
    return new Response(null, { status: 200 });
  });
}

let original: typeof fetch;
let server: Server;

beforeEach(() => {
  vi.resetModules();
  original = globalThis.fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = original;
  vi.restoreAllMocks();
});

/** Mounts the page against a fresh fake server and waits for the rows. */
async function mountPage(opts: { locale?: 'en' | 'nl'; result?: SyncCheckResult; failIgnore?: boolean; noRows?: boolean } = {}) {
  server = { result: opts.result ?? fixture(), failIgnore: opts.failIgnore ?? false, calls: [] };
  const f = makeFetch(server);
  globalThis.fetch = f;
  const [{ SyncDashboard }, { I18nProvider }] = await Promise.all([import('@/pages/SyncDashboard'), import('@/i18n')]);
  render(
    <I18nProvider initialLocale={opts.locale ?? 'en'}>
      <SyncDashboard />
    </I18nProvider>,
  );
  await waitFor(() => {
    if (opts.noRows === true) expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    else expect(document.querySelector('[data-row-id]')).not.toBeNull();
  });
  return { fetch: f };
}

// ---- helpers ------------------------------------------------------------------------------------------------

const NATIVE = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=""],[contenteditable="true"]';
const isNativeTag = (el: Element) => el.matches('a[href],button,input,select,textarea,summary');

/** Elements a browser Tab key stops on, in DOM order (every stop has tabindex 0 or none, so DOM order is tab order). */
function tabStops(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(NATIVE)).filter((el) => {
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) < 0) return false;
    if (tabindex === null && !isNativeTag(el)) return false;
    if (el.matches(':disabled') || el.closest('[hidden],[aria-hidden="true"],[inert]') !== null) return false;
    if (el instanceof HTMLInputElement) {
      if (el.type === 'hidden') return false;
      // A radio group is one stop: the checked radio.
      if (el.type === 'radio' && el.name !== '') {
        const group = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.name === el.name);
        const stop = group.find((r) => r.checked) ?? group[0];
        return el === stop;
      }
    }
    return true;
  });
}

/** The element the Tab key moves to from `from`. */
function nextTabStop(from: Element): HTMLElement | undefined {
  return tabStops(document.body).find((s) => (from.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
}

const stopName = (el: HTMLElement) => el.getAttribute('aria-label') ?? (el.closest('label') ?? el).textContent.trim();

const cell = (side: string, id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-side="${side}"][data-row-id="${id}"]`);
  if (el === null) throw new Error(`no cell ${side}/${id}`);
  return el;
};
const toolbarOf = (el: HTMLElement): HTMLElement => (el.matches('[role="toolbar"]') ? el : (el.querySelector<HTMLElement>('[role="toolbar"]') as HTMLElement));
const rovingItems = (tb: HTMLElement) => Array.from(tb.querySelectorAll<HTMLElement>('[data-roving-item]'));
const btn = (name: string) => screen.getByRole('button', { name });
const key = (el: Element, k: string) => fireEvent.keyDown(el, { key: k });
const active = () => document.activeElement;
const regionEl = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('[data-slot="announcement-region"]');
  if (el === null) throw new Error('no announcement region');
  return el;
};
const regionText = () => regionEl().textContent;
const T = { timeout: 2500 };
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

async function openMenu(trigger: HTMLElement) {
  trigger.focus();
  key(trigger, 'Enter');
  return screen.findByRole('menu');
}
async function openIgnored() {
  fireEvent.click(await screen.findByRole('button', { name: /^(Ignored items|Genegeerde items)/ }));
  await screen.findByRole('toolbar', { name: /Old$/ });
}

// ---- 1. roles and labels ------------------------------------------------------------------------------------

describe.each([
  { locale: 'en', actions: (n: string) => `Actions for ${n}`, names: ['Link Netflix to NETFLIX.COM', 'More actions for Netflix', 'Create in AB: Hulu', 'Create in Wallos: Gym', 'Show details for Spotify', 'Review differences: Adobe', 'More actions for Orphan', 'More actions for Spotify'] },
  { locale: 'nl', actions: (n: string) => `Acties voor ${n}`, names: ['Netflix koppelen aan NETFLIX.COM', 'Meer acties voor Netflix', 'Aanmaken in AB: Hulu', 'Aanmaken in Wallos: Gym', 'Details tonen voor Spotify', 'Verschillen bekijken: Adobe', 'Meer acties voor Orphan', 'Meer acties voor Spotify'] },
] as const)('toolbar roles and labels ($locale)', ({ locale, actions, names }) => {
  it('every unpaired, suggested, linked and ignored cell is a named toolbar with one tab stop item, and button names are unchanged', async () => {
    await mountPage({ locale });
    await openIgnored();
    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-row-id]'));
    expect(cells).toHaveLength(CELLS.length);
    for (const [side, id, name] of CELLS) {
      const tb = toolbarOf(cell(side, id));
      expect(tb.getAttribute('role')).toBe('toolbar');
      expect(tb.getAttribute('aria-label')).toBe(actions(name));
      expect(screen.getByRole('toolbar', { name: actions(name) })).toBe(tb);
      const items = rovingItems(tb);
      expect(items.length).toBeGreaterThan(0);
      expect(items.filter((i) => i.getAttribute('tabindex') === '0')).toHaveLength(1);
      expect(items.filter((i) => i.getAttribute('tabindex') === '-1')).toHaveLength(items.length - 1);
    }
    for (const name of names) expect(btn(name)).toBeTruthy();
  });
});

// ---- 2. tab stops -------------------------------------------------------------------------------------------

describe('tab stops', () => {
  // Before issue 170 every button in a cell was its own tab stop: 2 for an unpaired item (Create, More actions),
  // 2 to 3 for a linked cell (details, Review on a mismatch, More actions), so the 11 cells below cost about 20
  // stops. Now each cell is one stop (its roving item), 11 in total.
  it('every cell has exactly one stop and the rows add up to the cell count', async () => {
    await mountPage();
    await openIgnored();
    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-row-id]'));
    expect(cells).toHaveLength(11);
    let rowStops = 0;
    for (const c of cells) {
      const stops = tabStops(c);
      expect(stops, `${c.dataset.side ?? ''}/${c.dataset.rowId ?? ''}`).toHaveLength(1);
      rowStops += stops.length;
    }
    expect(rowStops).toBe(cells.length);

    // Everything else, by name, in order.
    const section = screen.getByRole('region', { name: 'Sync Dashboard' });
    const outside = tabStops(section).filter((el) => el.closest('[data-row-id]') === null);
    expect(outside.map(stopName)).toEqual([
      'Skip to linked pairs',
      'Search by name',
      'Run Sync Check',
      'Wallos (6)',
      'Linked pairs (3)',
      'Suggested pairs (1)',
      'Wallos only (2)',
      'Actual only (1)',
      'Ignored items (1)',
    ]);
    expect(tabStops(section)).toHaveLength(outside.length + rowStops);
  });

  it('the helper skips tabindex -1, disabled, hidden and aria-hidden elements', () => {
    const host = document.createElement('div');
    host.innerHTML = `<button id="a">a</button><button tabindex="-1">b</button><button disabled>c</button>
      <div aria-hidden="true"><button>d</button></div><div hidden><button>e</button></div><div tabindex="0" id="f">f</div><div tabindex="-1">g</div>`;
    document.body.append(host);
    expect(tabStops(host).map((e) => e.id || e.textContent)).toEqual(['a', 'f']);
    host.remove();
  });
});

// ---- 3. arrow keys ------------------------------------------------------------------------------------------

describe('roving keys', () => {
  it('Arrow keys, Home and End move between the primary action and More actions, without wrapping', async () => {
    await mountPage();
    const create = btn('Create in AB: Hulu');
    const more = btn('More actions for Hulu');
    create.focus();
    key(create, 'ArrowLeft');
    expect(active()).toBe(create);
    key(create, 'ArrowRight');
    expect(active()).toBe(more);
    expect(more.getAttribute('tabindex')).toBe('0');
    expect(create.getAttribute('tabindex')).toBe('-1');
    key(more, 'ArrowRight');
    expect(active()).toBe(more);
    key(more, 'ArrowLeft');
    expect(active()).toBe(create);
    key(create, 'End');
    expect(active()).toBe(more);
    key(more, 'Home');
    expect(active()).toBe(create);
  });

  it('Tab from More actions (and from the primary action) reaches the next cell stop', async () => {
    await mountPage();
    const create = btn('Create in AB: Hulu');
    const more = btn('More actions for Hulu');
    more.focus();
    key(more, 'ArrowLeft');
    key(create, 'End');
    expect(active()).toBe(more);
    const next = nextTabStop(more);
    expect(next?.closest('[data-row-id]')).toBe(cell('wallos', 'w-dis'));
    expect(next).toBe(btn('Create in AB: Disney'));
    expect(next?.getAttribute('tabindex')).toBe('0');
    // The roving stop moved with focus: Tab never visits Hulu's primary action any more.
    expect(tabStops(document.body)).not.toContain(create);
  });
});

// ---- 4. menu interaction ------------------------------------------------------------------------------------

describe('More actions menu inside the toolbar', () => {
  it('Enter and ArrowDown on the trigger open the menu', async () => {
    await mountPage();
    const more = btn('More actions for Hulu');
    expect(await openMenu(more)).toBeTruthy();
    key(screen.getByRole('menu'), 'Escape');
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull(); });
    more.focus();
    key(more, 'ArrowDown');
    expect(await screen.findByRole('menu')).toBeTruthy();
  });

  it('ArrowLeft and ArrowRight inside the open menu do not move toolbar focus; Escape closes and returns focus to the trigger', async () => {
    await mountPage();
    const more = btn('More actions for Hulu');
    const create = btn('Create in AB: Hulu');
    await openMenu(more);
    const menuItem = await screen.findByRole('menuitem', { name: 'Ignore Hulu' });
    menuItem.focus();
    key(menuItem, 'ArrowLeft');
    key(menuItem, 'ArrowRight');
    expect(screen.queryByRole('menu')).not.toBeNull();
    expect(active()).toBe(menuItem);
    expect(active()).not.toBe(create);
    expect(more.getAttribute('tabindex')).toBe('0');
    expect(create.getAttribute('tabindex')).toBe('-1');
    key(menuItem, 'Escape');
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull(); });
    await waitFor(() => { expect(active()).toBe(more); });
  });

  it('selecting Ignore triggers the ignore action', async () => {
    await mountPage();
    await openMenu(btn('More actions for Hulu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ignore Hulu' }));
    await waitFor(() => {
      expect(server.calls).toContainEqual({ method: 'POST', url: '/api/matches/ignore', body: { side: 'wallos', itemId: 'w-hulu' } });
    });
  });
});

// ---- 5. focus after an action -------------------------------------------------------------------------------

describe('focus after a row action', () => {
  /** Focus is on the next row's container and the next Tab goes to that row's roving item. */
  async function expectFocusOnRow(id: string, itemName: string) {
    const row = cell('wallos', id);
    await waitFor(() => { expect(active()).toBe(row); }, T);
    const next = nextTabStop(row);
    expect(next?.closest('[data-row-id]')).toBe(row);
    expect(next?.hasAttribute('data-roving-item')).toBe(true);
    expect(next?.getAttribute('tabindex')).toBe('0');
    expect(next).toBe(btn(itemName));
  }

  it('after Link', async () => {
    await mountPage();
    fireEvent.click(btn('Link Netflix to NETFLIX.COM'));
    await expectFocusOnRow('w-hulu', 'Create in AB: Hulu');
  });

  it('after Ignore', async () => {
    await mountPage();
    await openMenu(btn('More actions for Hulu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ignore Hulu' }));
    await expectFocusOnRow('w-dis', 'Create in AB: Disney');
  });

  it('after Restore', async () => {
    await mountPage();
    await openIgnored();
    await openMenu(btn('More actions for Old'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore Old' }));
    await expectFocusOnRow('w-dis', 'Create in AB: Disney');
  });
});

// ---- 6. announcements ---------------------------------------------------------------------------------------

describe('announcements', () => {
  it('the region exists, is a polite status and is empty before the first action', async () => {
    await mountPage();
    const region = regionEl();
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
  });

  it('a message from before the region mounted is not shown again; a new one is', async () => {
    await mountPage();
    fireEvent.click(btn('Link Netflix to NETFLIX.COM'));
    await waitFor(() => { expect(regionText()).toBe('Linked Netflix to NETFLIX.COM.'); }, T);
    // Leave the dashboard (e.g. to Settings) and come back: same module graph, so the announcer keeps its last message.
    cleanup();
    await mountPage();
    expect(regionText()).toBe('');
    await openMenu(btn('More actions for Hulu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ignore Hulu' }));
    await waitFor(() => { expect(regionText()).toBe('Ignored Hulu.'); }, T);
  });

  it('Link', async () => {
    await mountPage();
    fireEvent.click(btn('Link Netflix to NETFLIX.COM'));
    await waitFor(() => { expect(regionText()).toBe('Linked Netflix to NETFLIX.COM.'); }, T);
  });

  it('Ignore', async () => {
    await mountPage();
    await openMenu(btn('More actions for Hulu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ignore Hulu' }));
    await waitFor(() => { expect(regionText()).toBe('Ignored Hulu.'); }, T);
  });

  it('Restore', async () => {
    await mountPage();
    await openIgnored();
    await openMenu(btn('More actions for Old'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Restore Old' }));
    await waitFor(() => { expect(regionText()).toBe('Restored Old.'); }, T);
  });

  it('Unlink from the row menu', async () => {
    await mountPage();
    await openMenu(btn('More actions for Spotify'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Unlink' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
    await waitFor(() => { expect(regionText()).toBe('Unlinked Spotify.'); }, T);
  });

  it('Create (successful stubbed create)', async () => {
    await mountPage();
    fireEvent.click(btn('Create in AB: Hulu'));
    const account = await screen.findByRole('combobox', { name: /^Account/ });
    fireEvent.change(account, { target: { value: 'acc1' } });
    const form = account.closest('form');
    if (form === null) throw new Error('no create form');
    fireEvent.submit(form);
    await waitFor(() => { expect(regionText()).toBe('Created Hulu in Actual Budget.'); }, T);
    expect(server.calls.some((c) => c.method === 'POST' && c.url === '/api/integrations/actual-schedules')).toBe(true);
  });

  it('is read in Dutch', async () => {
    await mountPage({ locale: 'nl' });
    await openMenu(btn('Meer acties voor Hulu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hulu negeren' }));
    await waitFor(() => { expect(regionText()).toBe('Hulu genegeerd.'); }, T);
  });

  it('a failed action announces no success text and shows the row error alert', async () => {
    await mountPage({ failIgnore: true });
    await openMenu(btn('More actions for Hulu'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ignore Hulu' }));
    const alert = await screen.findByText(/Could not update Hulu\./, undefined, T);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
    await settle();
    expect(regionText()).toBe('');
    expect(screen.getByRole('toolbar', { name: 'Actions for Hulu' })).toBeTruthy();
  });

  it('the same message twice in a row replaces the node, so it is read again', async () => {
    const result = fixture();
    await mountPage({
      result: { ...result, unlinkedWallos: [item('w-t1', 'Twin'), item('w-t2', 'Twin')], unlinkedActual: [], candidates: [], linked: [], mismatches: [], ignored: [] },
    });
    const ignoreFirstTwin = async () => {
      await openMenu(screen.getAllByRole('button', { name: 'More actions for Twin' })[0] as HTMLElement);
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Ignore Twin' }));
    };
    await ignoreFirstTwin();
    await waitFor(() => { expect(regionText()).toBe('Ignored Twin.'); }, T);
    const first = regionEl().firstElementChild;
    expect(first).not.toBeNull();
    // Let the first menu finish closing and the page finish moving focus, so the second open is not raced.
    await waitFor(() => { expect(screen.queryByRole('menu')).toBeNull(); });
    await waitFor(() => { expect(active()).toBe(cell('wallos', 'w-t2')); }, T);
    await ignoreFirstTwin();
    await waitFor(() => {
      expect(regionText()).toBe('Ignored Twin.');
      expect(regionEl().firstElementChild).not.toBe(first);
    }, T);
    expect(server.calls.filter((c) => c.url === '/api/matches/ignore')).toHaveLength(2);
  });

  describe('diff modal actions do not announce', () => {
    const resolveCall = (action: string) =>
      server.calls.some((c) => c.url === '/api/matches/m-ad/resolve' && (c.body as { action?: string }).action === action);
    const closed = async () => {
      await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); }, T);
      await settle();
      expect(regionText()).toBe('');
    };

    it('Ignore Diff', async () => {
      await mountPage();
      fireEvent.click(btn('Review differences: Adobe'));
      fireEvent.click(await screen.findByRole('button', { name: 'Ignore Diff' }));
      await closed();
      expect(resolveCall('ignore_diff')).toBe(true);
    });

    it('Overwrite Wallos', async () => {
      await mountPage();
      fireEvent.click(btn('Review differences: Adobe'));
      fireEvent.click(await screen.findByRole('button', { name: 'Overwrite Wallos' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
      await closed();
      expect(resolveCall('overwrite_wallos')).toBe(true);
    });

    it('Unlink', async () => {
      await mountPage();
      fireEvent.click(btn('Review differences: Adobe'));
      fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
      await closed();
      expect(resolveCall('unlink')).toBe(true);
    });
  });
});

// ---- 7. skip link -------------------------------------------------------------------------------------------

describe('skip link', () => {
  it('is the first tab stop in the dashboard, before the search box', async () => {
    await mountPage();
    const section = screen.getByRole('region', { name: 'Sync Dashboard' });
    const [first, second] = tabStops(section);
    expect(first).toBe(screen.getByRole('link', { name: 'Skip to linked pairs' }));
    expect(first?.getAttribute('href')).toBe('#linked-pairs-trigger');
    expect(second).toBe(screen.getByRole('searchbox', { name: 'Search by name' }));
  });

  it('is absent when there are no linked rows', async () => {
    await mountPage({ result: { ...fixture(), linked: [], mismatches: [] } });
    expect(screen.queryByRole('link', { name: 'Skip to linked pairs' })).toBeNull();
    const section = screen.getByRole('region', { name: 'Sync Dashboard' });
    expect(tabStops(section)[0]).toBe(screen.getByRole('searchbox', { name: 'Search by name' }));
  });

  it('is absent on a pane where the linked section is hidden, and present on the other pane', async () => {
    // Every linked row is orphaned_actual, so it has only a Wallos cell: below 768px the linked section hides on the Actual pane.
    const base = fixture();
    await mountPage({ result: { ...base, linked: base.linked.filter((l) => l.orphan === 'orphaned_actual'), mismatches: [] } });
    expect(screen.getByRole('link', { name: 'Skip to linked pairs' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /^Actual Budget/ }));
    await waitFor(() => { expect(screen.queryByRole('link', { name: 'Skip to linked pairs' })).toBeNull(); });
    expect(document.querySelector('[data-group="linked"]')?.className).toContain('max-md:hidden');
    fireEvent.click(screen.getByRole('radio', { name: /^Wallos/ }));
    await waitFor(() => { expect(screen.getByRole('link', { name: 'Skip to linked pairs' })).toBeTruthy(); });
  });

  it('stays on the Actual pane when a linked row has an Actual cell', async () => {
    await mountPage();
    fireEvent.click(screen.getByRole('radio', { name: /^Actual Budget/ }));
    await waitFor(() => { expect(screen.getByRole('radio', { name: /^Actual Budget/ })).toHaveProperty('checked', true); });
    expect(screen.getByRole('link', { name: 'Skip to linked pairs' })).toBeTruthy();
  });

  it('moves focus to the linked group trigger and leaves the path and hash unchanged', async () => {
    await mountPage();
    const link = screen.getByRole('link', { name: 'Skip to linked pairs' });
    const before = { path: window.location.pathname, hash: window.location.hash };
    link.focus();
    // A browser turns Enter on a link into a click; jsdom does not, so the click is fired directly.
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false);
    expect(active()).toBe(document.getElementById('linked-pairs-trigger'));
    expect(active()).toBe(screen.getByRole('button', { name: 'Linked pairs (3)' }));
    expect(window.location.pathname).toBe(before.path);
    expect(window.location.hash).toBe(before.hash);
  });

  it('the linked group is a region named by its heading', async () => {
    await mountPage();
    const group = screen.getByRole('region', { name: 'Linked pairs (3)' });
    expect(group.getAttribute('aria-labelledby')).toBe('linked-pairs-trigger');
    expect(within(group).getByRole('button', { name: 'Linked pairs (3)' })).toBe(document.getElementById('linked-pairs-trigger'));
    expect(within(group).getAllByRole('toolbar').length).toBeGreaterThan(0);
  });
});

// ---- 7. visible arrow-key hint ------------------------------------------------------------------------------

describe.each([
  { locale: 'en', text: 'Use the Left and Right arrow keys to move between a row’s actions.' },
  { locale: 'nl', text: 'Gebruik de pijltjestoetsen Links en Rechts om te wisselen tussen de acties van een rij.' },
] as const)('arrow-key hint ($locale)', ({ locale, text }) => {
  it('is one visible text line, not hidden from assistive technology', async () => {
    await mountPage({ locale });
    const hints = screen.getAllByText(text);
    expect(hints).toHaveLength(1);
    const hint = hints[0] as HTMLElement;
    expect(hint.id).toBe('row-arrow-hint');
    expect(hint.closest('[hidden],[aria-hidden="true"],.sr-only')).toBeNull();
    expect(hint.closest('[role="toolbar"]')).toBeNull();
  });

  it('describes every row toolbar, including the ignored ones', async () => {
    await mountPage({ locale });
    await openIgnored();
    const toolbars = screen.getAllByRole('toolbar');
    expect(toolbars.length).toBeGreaterThanOrEqual(CELLS.length);
    for (const tb of toolbars) {
      const id = tb.getAttribute('aria-describedby');
      expect(id).toBe('row-arrow-hint');
      expect(document.getElementById(id as string)?.textContent).toBe(text);
    }
    expect(screen.getAllByRole('toolbar', { description: text })).toHaveLength(toolbars.length);
  });

  it('is absent when there are no cells', async () => {
    const empty: SyncCheckResult = { ...fixture(), unlinkedWallos: [], unlinkedActual: [], candidates: [], mismatches: [], linked: [], ignored: [] };
    await mountPage({ locale, result: empty, noRows: true });
    await screen.findByText(locale === 'en' ? 'Nothing to link here.' : 'Hier valt niets te koppelen.');
    expect(screen.queryByText(text)).toBeNull();
    expect(document.getElementById('row-arrow-hint')).toBeNull();
    expect(screen.queryAllByRole('toolbar')).toHaveLength(0);
  });
});

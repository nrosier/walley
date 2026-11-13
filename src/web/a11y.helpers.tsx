// Shared helpers for the real-DOM accessibility tests of the Sync Dashboard and its dialogs (issue 58).
// Not a test file (no `.test.` in the name), so vitest does not collect it; it is type-checked and linted like
// the rest of src/web. Importers must run in jsdom (`// @vitest-environment jsdom`).
//
// What jsdom cannot prove (tests must not claim it): real Tab order and the browser's own focus ring (jsdom has
// no sequential navigation; `pressTab` emulates it from the DOM), layout, visibility from CSS classes (no
// stylesheet is loaded, so only the `hidden` attribute, inline styles, aria-hidden and inert count), colour
// contrast, and what a screen reader says (`nameOf` is an approximation of the accessible name computation).
import { act, cleanup, fireEvent, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import { expect, vi } from 'vitest';
import type { Locale } from '@/i18n';
import type { SyncCheckResult, SyncItem, SyncLinked, SyncMismatch } from '../lib/sync-check-types';

// ---- polyfills ----------------------------------------------------------------------------------------------

const defineIfMissing = (target: object, name: string, value: unknown): void => {
  if (name in target) return;
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
};

/**
 * Adds the browser APIs Radix and the dashboard use and jsdom lacks: ResizeObserver, pointer capture,
 * scrollIntoView and CSS.escape. Idempotent, and never replaces an API that exists. There is no vitest setup
 * file, so each test file calls this (`mountDashboard` does it too). No component needs matchMedia.
 */
export function installDomPolyfills(): void {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  defineIfMissing(globalThis, 'ResizeObserver', ResizeObserverStub);
  defineIfMissing(Element.prototype, 'hasPointerCapture', () => false);
  defineIfMissing(Element.prototype, 'setPointerCapture', () => undefined);
  defineIfMissing(Element.prototype, 'releasePointerCapture', () => undefined);
  defineIfMissing(Element.prototype, 'scrollIntoView', () => undefined);
  const css = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS;
  if (css?.escape === undefined) {
    Object.defineProperty(globalThis, 'CSS', {
      value: { ...css, escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) },
      configurable: true,
      writable: true,
    });
  }
}

// ---- tab order ----------------------------------------------------------------------------------------------

const FOCUSABLE = 'a[href],area[href],button,input,select,textarea,summary,iframe,[tabindex],[contenteditable]:not([contenteditable="false"])';
const NATIVE_TAGS = 'a[href],area[href],button,input,select,textarea,summary,iframe,[contenteditable]:not([contenteditable="false"])';

function isHiddenByStyle(el: Element): boolean {
  for (let node: Element | null = el; node !== null; node = node.parentElement) {
    if (getComputedStyle(node).display === 'none') return true;
  }
  return getComputedStyle(el).visibility === 'hidden';
}

/**
 * Elements a browser Tab key stops on inside `root`, in tab order: natively focusable or tabindex >= 0, minus
 * tabindex < 0, disabled controls, type=hidden inputs, anything inside `[hidden]`, `[aria-hidden="true"]` or
 * `[inert]`, and anything hidden by an inline display/visibility style. A radio group is one stop (the checked
 * radio, else the first). Positive tabindex values come first, as in a browser; otherwise DOM order.
 */
export function tabbables(root: ParentNode): HTMLElement[] {
  const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    const tabindex = el.getAttribute('tabindex');
    if (tabindex !== null && Number(tabindex) < 0) return false;
    if (tabindex === null && !el.matches(NATIVE_TAGS)) return false;
    if (el.matches(':disabled')) return false;
    if (el.closest('[hidden],[aria-hidden="true"],[inert]') !== null || isHiddenByStyle(el)) return false;
    if (el instanceof HTMLInputElement) {
      if (el.type === 'hidden') return false;
      if (el.type === 'radio' && el.name !== '') {
        const scope: ParentNode = el.form ?? el.ownerDocument;
        const group = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => r.name === el.name);
        return el === (group.find((r) => r.checked) ?? group[0]);
      }
    }
    return true;
  });
  const order = (el: HTMLElement): number => {
    const n = Number(el.getAttribute('tabindex'));
    return n > 0 ? n : Number.MAX_SAFE_INTEGER;
  };
  return stops.map((el, i) => ({ el, i })).sort((a, b) => order(a.el) - order(b.el) || a.i - b.i).map((s) => s.el);
}

// ---- accessible name ----------------------------------------------------------------------------------------

const NAME_FROM_CONTENT =
  'button,a[href],summary,legend,label,option,h1,h2,h3,h4,h5,h6,[role="button"],[role="link"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="tab"],[role="option"],[role="checkbox"],[role="radio"],[role="switch"],[role="heading"]';

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

function textOf(node: Node, force = false): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element)) return '';
  if (!force && (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true')) return '';
  if (node instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(node.type)) return node.value;
  if (node instanceof HTMLImageElement) return node.alt;
  return Array.from(node.childNodes).map((c) => textOf(c)).join(' ');
}

/**
 * Approximate accessible name: aria-labelledby (ids joined in order), aria-label, native labels, alt/value,
 * then text content for roles that take their name from content (buttons, links, menu items, headings, ...),
 * then title. A dialog or a plain div gets no name from its content, so a missing label shows up as ''.
 */
export function nameOf(el: Element): string {
  const by = el.getAttribute('aria-labelledby');
  if (by !== null && by.trim() !== '') {
    const text = by.trim().split(/\s+/).map((id) => {
      const ref = el.ownerDocument.getElementById(id);
      return ref === null ? '' : (ref.getAttribute('aria-label') ?? textOf(ref, true));
    }).join(' ');
    if (squash(text) !== '') return squash(text);
  }
  const label = el.getAttribute('aria-label');
  if (label !== null && squash(label) !== '') return squash(label);
  const labels = (el as HTMLInputElement).labels as NodeListOf<HTMLLabelElement> | null | undefined;
  if (labels !== null && labels !== undefined && labels.length > 0) {
    const text = squash(Array.from(labels).map((l) => textOf(l, true)).join(' '));
    if (text !== '') return text;
  }
  if (el instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(el.type) && squash(el.value) !== '') return squash(el.value);
  if (el instanceof HTMLImageElement && squash(el.alt) !== '') return squash(el.alt);
  if (el.matches(NAME_FROM_CONTENT)) {
    const text = squash(textOf(el, true));
    if (text !== '') return text;
  }
  return squash(el.getAttribute('title') ?? '');
}

// ---- keyboard -----------------------------------------------------------------------------------------------

export interface KeyOptions {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

/**
 * Dispatches keydown then keyup on `el` (a real key press reaches the focused element). Returns true when the
 * keydown was NOT default-prevented, as `fireEvent` does. jsdom runs no default action: Enter on a link or a
 * button does not click, Tab does not move focus (see `pressTab`).
 */
export function pressKey(el: Element, key: string, opts: KeyOptions = {}): boolean {
  const notPrevented = fireEvent.keyDown(el, { key, code: key, ...opts });
  fireEvent.keyUp(el, { key, code: key, ...opts });
  return notPrevented;
}

/**
 * Emulates the Tab key inside `container`: dispatches keydown on the focused element first, so a focus trap
 * (Radix FocusScope) can react and `preventDefault`. If it did not, focus moves the way a browser would: to the
 * next (or, with `shift`, previous) entry of `tabbables(container)`. Past the end, focus leaves the container:
 * the active element is blurred (document.body), standing for the browser chrome or the page behind. Returns the
 * active element afterwards.
 */
export function pressTab(container: ParentNode, opts: { shift?: boolean } = {}): Element | null {
  const shift = opts.shift === true;
  const from = document.activeElement ?? document.body;
  const notPrevented = fireEvent.keyDown(from, { key: 'Tab', code: 'Tab', shiftKey: shift });
  if (notPrevented) {
    const list = tabbables(container);
    const at = list.indexOf(from as HTMLElement);
    const next = at === -1 ? (shift ? list[list.length - 1] : list[0]) : list[at + (shift ? -1 : 1)];
    act(() => {
      if (next === undefined) {
        if (from instanceof HTMLElement) from.blur();
      } else {
        next.focus();
      }
    });
  }
  fireEvent.keyUp(document.activeElement ?? document.body, { key: 'Tab', code: 'Tab', shiftKey: shift });
  return document.activeElement;
}

// ---- focus --------------------------------------------------------------------------------------------------

/** True when `el` is the focused element right now. */
export const focusIs = (el: Element | null | undefined): boolean => el !== null && el !== undefined && document.activeElement === el;

/**
 * Waits until `target` is focused. Radix returns focus after close in a setTimeout(0), so assert with this, not
 * synchronously. Pass a getter when the element is re-created (rows are re-rendered after an action).
 */
export async function waitForFocus(target: Element | (() => Element | null), timeout = 2500): Promise<void> {
  await waitFor(() => {
    const el = typeof target === 'function' ? target() : target;
    expect(el, 'element to focus exists').not.toBeNull();
    expect(document.activeElement).toBe(el);
  }, { timeout });
}

// ---- dialog assertions --------------------------------------------------------------------------------------

const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'LINK', 'META', 'NOSCRIPT']);
const isHiddenFromAT = (el: Element): boolean => el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert');

/** Elements outside `dialog` that are still exposed to assistive technology. Live regions stay exposed on purpose (Radix keeps them). */
function exposedOutside(root: Element, dialog: Element, out: Element[]): Element[] {
  for (const child of Array.from(root.children)) {
    if (child === dialog || IGNORED_TAGS.has(child.tagName) || child.hasAttribute('data-radix-focus-guard')) continue;
    if (child.contains(dialog)) exposedOutside(child, dialog, out);
    else if (isHiddenFromAT(child) || child.matches('[aria-live]')) continue;
    else if (child.querySelector('[aria-live]') !== null) exposedOutside(child, dialog, out);
    else out.push(child);
  }
  return out;
}

const describeEl = (el: Element): string => `<${el.tagName.toLowerCase()}${el.id === '' ? '' : `#${el.id}`}${el.getAttribute('data-slot') === null ? '' : ` data-slot=${el.getAttribute('data-slot') ?? ''}`}>`;

/**
 * Asserts the dialog traps focus: Tab from its last tabbable wraps to the first, Shift+Tab from the first wraps
 * to the last (through `pressTab`, so the trap itself must call preventDefault and move focus), and every
 * element outside it is `aria-hidden` or `inert` (what Radix does to the rest of the page). The dialog needs
 * at least one tabbable. Leaves focus on the first tabbable.
 */
export function expectFocusTrapped(dialog: HTMLElement): void {
  const stops = tabbables(dialog);
  expect(stops.length, 'dialog has tabbable elements').toBeGreaterThan(0);
  const first = stops[0] as HTMLElement;
  const last = stops[stops.length - 1] as HTMLElement;
  act(() => { last.focus(); });
  expect(pressTab(dialog), 'Tab from the last tabbable wraps to the first').toBe(first);
  act(() => { first.focus(); });
  expect(pressTab(dialog, { shift: true }), 'Shift+Tab from the first tabbable wraps to the last').toBe(last);
  expect(Array.from(exposedOutside(document.body, dialog, [])).map(describeEl), 'outside elements hidden from assistive technology').toEqual([]);
}

/** Resolves the ids of an aria-labelledby / aria-describedby attribute to elements; fails on a missing id. */
function resolveIds(dialog: HTMLElement, attr: string): HTMLElement[] {
  const ids = (dialog.getAttribute(attr) ?? '').trim().split(/\s+/).filter((s) => s !== '');
  return ids.map((id) => {
    const ref = document.getElementById(id);
    expect(ref, `${attr} id "${id}" resolves`).not.toBeNull();
    expect(dialog.contains(ref), `${attr} id "${id}" is inside the dialog`).toBe(true);
    return ref as HTMLElement;
  });
}

/**
 * Asserts the dialog's name and wiring: role dialog or alertdialog; `aria-labelledby` resolves to non-empty
 * elements inside it and the accessible name equals `name` (string, or RegExp tested against it); likewise
 * `aria-describedby` (required when `description` is a string or RegExp; with `null` there must be none; left
 * out, a present attribute is still validated but not required); the close control, if any, has a name; and
 * every tabbable inside has an accessible name.
 */
export function expectDialogAccessibility(
  dialog: HTMLElement,
  expected: { name: string | RegExp; description?: string | RegExp | null },
): void {
  expect(['dialog', 'alertdialog'], 'dialog role').toContain(dialog.getAttribute('role'));
  const labels = resolveIds(dialog, 'aria-labelledby');
  expect(labels.length, 'dialog has aria-labelledby').toBeGreaterThan(0);
  for (const l of labels) expect(squash(textOf(l, true)), 'label element is not empty').not.toBe('');
  const name = nameOf(dialog);
  expect(name, 'dialog accessible name').not.toBe('');
  if (typeof expected.name === 'string') expect(name).toBe(expected.name);
  else expect(name).toMatch(expected.name);

  const descriptions = resolveIds(dialog, 'aria-describedby');
  for (const d of descriptions) expect(squash(textOf(d, true)), 'description element is not empty').not.toBe('');
  const { description } = expected;
  if (description === null) expect(descriptions, 'dialog has no description').toHaveLength(0);
  else if (description !== undefined) {
    expect(descriptions.length, 'dialog has aria-describedby').toBeGreaterThan(0);
    const text = squash(descriptions.map((d) => textOf(d, true)).join(' '));
    if (typeof description === 'string') expect(text).toBe(description);
    else expect(text).toMatch(description);
  }

  for (const close of Array.from(dialog.querySelectorAll<HTMLElement>('[data-slot="dialog-close"]'))) {
    expect(nameOf(close), `close control ${describeEl(close)} name`).not.toBe('');
  }
  for (const stop of tabbables(dialog)) expect(nameOf(stop), `tabbable ${describeEl(stop)} accessible name`).not.toBe('');
}

// ---- dashboard fixture and fake server ----------------------------------------------------------------------

/** Builds an unlinked item of the sync result. */
export const syncItem = (id: string, name: string, amountCents = 1000): SyncItem => ({ id, name, amountCents, isRange: false, reason: null });

const fields = (cents: number) => ({
  frequency: 'monthly',
  interval: 1,
  startDate: '2026-01-01',
  currency: 'EUR',
  amount: { kind: 'single', cents } as const,
});

const linkedRow = (over: Partial<SyncLinked> & Pick<SyncLinked, 'matchId' | 'wallosId' | 'actualScheduleId'>): SyncLinked => ({
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

/**
 * One of every row kind. Linked synced: Spotify (m-sp). Linked mismatch: Adobe / Adobe CC (m-ad, Wallos 10.00
 * vs Actual 12.00). Orphaned Actual side: Orphan (m-or, Gym a-gym is its relink candidate). Orphaned Wallos
 * side: Lost (m-ow, Hulu w-hulu is its candidate). Suggested pair: Netflix / NETFLIX.COM. Unpaired: Hulu,
 * Disney (Wallos) and Gym (Actual). Ignored: Old (Wallos, m-old). Base currency EUR.
 */
export function dashboardFixture(): SyncCheckResult {
  return {
    checkedAt: '2026-01-01T00:00:00Z',
    baseCurrency: 'EUR',
    unlinkedWallos: [syncItem('w-net', 'Netflix', 1299), syncItem('w-hulu', 'Hulu'), syncItem('w-dis', 'Disney')],
    unlinkedActual: [syncItem('a-net', 'NETFLIX.COM', 1299), syncItem('a-gym', 'Gym', 4000)],
    candidates: [
      { wallosId: 'w-net', actualScheduleId: 'a-net', nameScore: 0.9, wallosName: 'Netflix', actualName: 'NETFLIX.COM', wallosAmountCents: 1299, actualAmountCents: 1299, isRange: false },
    ],
    mismatches: [adobeMismatch],
    linked: [
      linkedRow({ matchId: 'm-sp', wallosId: 'w-sp', actualScheduleId: 'a-sp', wallosName: 'Spotify', actualName: 'Spotify EU' }),
      linkedRow({ matchId: 'm-ad', wallosId: 'w-ad', actualScheduleId: 'a-ad', status: 'MISMATCH_DETECTED', wallosName: 'Adobe', actualName: 'Adobe CC', actualAmountCents: 1200 }),
      linkedRow({ matchId: 'm-or', wallosId: 'w-or', actualScheduleId: 'a-or', orphan: 'orphaned_actual', wallosName: 'Orphan', actualName: null, actualAmountCents: null, relinkCandidateIds: ['a-gym'] }),
      linkedRow({ matchId: 'm-ow', wallosId: 'w-ow', actualScheduleId: 'a-ow', orphan: 'orphaned_wallos', wallosName: null, actualName: 'Lost', wallosAmountCents: null, relinkCandidateIds: ['w-hulu'] }),
    ],
    ignored: [{ matchId: 'm-old', side: 'wallos', itemId: 'w-old', name: 'Old', amountCents: 300, isRange: false, reason: null }],
    unmappable: [],
    orphaned: [],
  };
}

/** A request the fake server received. */
export interface FakeCall {
  method: string;
  url: string;
  body: unknown;
}

/** Endpoints `mountDashboard({ fail })` can make answer 500 `request_failed`. */
export type FailableEndpoint = 'ignore' | 'resolve' | 'relink' | 'details' | 'create' | 'prefill';

/** The fake backend of `mountDashboard`; mutate `result` between actions if a test needs another state. */
export interface FakeServer {
  result: SyncCheckResult;
  fail: Set<FailableEndpoint>;
  /**
   * What the next check shows after a successful Create from an unlinked row (not a Recreate, which sends a
   * matchId). 'linked' (the real server): the item leaves the unlinked list and a LINKED pair for it is added;
   * the dashboard renders linked pairs first, so its cell sits first in its side of the DOM, with the same
   * data-side and data-row-id as the row it replaces. 'removed': the item just disappears.
   */
  createOutcome: 'linked' | 'removed';
  calls: FakeCall[];
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failed = (): Response => json(500, { error: 'request_failed' });

const actualPrefill = {
  name: 'Hulu',
  amountCents: -1000,
  baseCurrency: 'EUR',
  sourceCurrency: 'EUR',
  wallosRate: null,
  overrideRate: null,
  recurrence: { frequency: 'monthly', interval: 1 },
  startDate: '2026-11-01',
  accounts: [{ id: 'acc1', name: 'Checking' }],
  payees: [{ id: 'p1', name: 'Hulu Inc' }],
  categories: [{ id: 'c1', name: 'Streaming' }],
};

const wallosPrefill = {
  name: 'Gym',
  price: '40.00',
  currencyCode: 'EUR',
  cycle: 3,
  frequency: 1,
  startDate: '2026-01-01',
  nextPayment: '2026-12-01',
  paymentMethods: [{ id: '1', name: 'Visa' }],
  categories: [{ id: '2', name: 'Health' }],
};

function nameFor(result: SyncCheckResult, id: string): string {
  const fromLinked = result.linked.flatMap((l) => [[l.wallosId, l.wallosName], [l.actualScheduleId, l.actualName]] as const).find(([i]) => i === id);
  return fromLinked?.[1] ?? [...result.unlinkedWallos, ...result.unlinkedActual].find((i) => i.id === id)?.name ?? id;
}

/** Applies a successful create of an unlinked item to `server.result`, as the next sync check would show it. */
function applyCreate(server: FakeServer, side: 'wallos' | 'actual', itemId: string, createdId: string): void {
  const r = server.result;
  const item = [...r.unlinkedWallos, ...r.unlinkedActual].find((i) => i.id === itemId);
  const unlinked = {
    unlinkedWallos: side === 'wallos' ? r.unlinkedWallos.filter((i) => i.id !== itemId) : r.unlinkedWallos,
    unlinkedActual: side === 'actual' ? r.unlinkedActual.filter((i) => i.id !== itemId) : r.unlinkedActual,
    candidates: r.candidates.filter((c) => c.wallosId !== itemId && c.actualScheduleId !== itemId),
  };
  if (server.createOutcome === 'removed' || item === undefined) {
    server.result = { ...r, ...unlinked };
    return;
  }
  const pair = side === 'wallos'
    ? { wallosId: itemId, actualScheduleId: createdId, wallosName: item.name, actualName: item.name }
    : { wallosId: createdId, actualScheduleId: itemId, wallosName: item.name, actualName: item.name };
  server.result = {
    ...r,
    ...unlinked,
    linked: [...r.linked, linkedRow({ matchId: `m-new-${itemId}`, wallosAmountCents: item.amountCents, actualAmountCents: item.amountCents, ...pair })],
  };
}

function makeFetch(server: FakeServer) {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    server.calls.push({ method, url, body });
    if (url.includes('/api/sync/check')) return json(200, server.result);
    const item = /^\/api\/sync\/items\/(wallos|actual)\/(.+)$/.exec(url);
    if (item !== null) {
      if (server.fail.has('details')) return failed();
      const [, side, rawId] = item;
      const id = decodeURIComponent(rawId ?? '');
      const name = nameFor(server.result, id);
      return json(200, side === 'wallos'
        ? { side, id, title: name, priceCents: 1000, currency: 'EUR', cycle: { key: 'monthly', count: 1 }, startDate: '2026-01-01', nextPayment: '2026-12-01', paymentMethod: 'Visa', category: null, notes: null, autoRenew: true }
        : { side, id, name, amountCents: -1000, isRange: false, currency: 'EUR', cycle: { key: 'monthly', count: 1 }, startDate: '2026-01-01', payee: 'Payee', account: 'Checking' });
    }
    if (url === '/api/matches/ignore') return server.fail.has('ignore') ? failed() : json(201, { id: 'm-new', status: 'IGNORED_WALLOS' });
    if (url === '/api/matches' && method === 'POST') return json(201, { id: 'm-link', status: 'LINKED' });
    if (url.endsWith('/relink')) return server.fail.has('relink') ? failed() : json(201, { id: 'm-relinked', status: 'LINKED' });
    if (url.endsWith('/resolve')) {
      if (server.fail.has('resolve')) return failed();
      if ((body as { action?: string } | undefined)?.action === 'unlink') {
        server.result = { ...server.result, linked: server.result.linked.filter((l) => !url.includes(`/${l.matchId}/`)) };
      }
      return new Response(null, { status: 204 });
    }
    if (url.startsWith('/api/matches/') && method === 'DELETE') return new Response(null, { status: 204 });
    if (url === '/api/integrations/actual-schedules/prefill') return server.fail.has('prefill') ? failed() : json(200, actualPrefill);
    if (url === '/api/integrations/wallos-subscriptions/prefill') return server.fail.has('prefill') ? failed() : json(200, wallosPrefill);
    if (url === '/api/integrations/actual-schedules') {
      if (server.fail.has('create')) return failed();
      const req = body as { wallosSubscriptionId: string; matchId?: string };
      if (req.matchId === undefined) applyCreate(server, 'wallos', req.wallosSubscriptionId, 's1');
      return json(201, { scheduleId: 's1', payeeId: 'p1', payeeCreated: false, categoryApplied: false });
    }
    if (url === '/api/integrations/wallos-subscriptions') {
      if (server.fail.has('create')) return failed();
      const req = body as { scheduleId: string; matchId?: string };
      if (req.matchId === undefined) applyCreate(server, 'actual', req.scheduleId, '99');
      return json(201, { subscriptionId: '99' });
    }
    return new Response(null, { status: 200 });
  });
}

let originalFetch: typeof fetch | undefined;

/**
 * Call from `afterEach`: unmounts everything RTL rendered (there is no auto-cleanup with `globals: false`),
 * restores `fetch` and the vitest mocks.
 */
export function cleanupDashboard(): void {
  cleanup();
  if (originalFetch !== undefined) globalThis.fetch = originalFetch;
  originalFetch = undefined;
  vi.restoreAllMocks();
}

export interface MountDashboardOptions {
  locale?: Locale;
  /** Defaults to `dashboardFixture()`. */
  result?: SyncCheckResult;
  /** Endpoints that answer 500 `request_failed`. */
  fail?: readonly FailableEndpoint[];
  /** What a successful Create from an unlinked row does to the next check, see `FakeServer.createOutcome`. Default 'linked'. */
  createOutcome?: FakeServer['createOutcome'];
  /** Wait for the loading state to end instead of for the first row (use with an empty result). */
  noRows?: boolean;
}

export interface MountedDashboard extends RenderResult {
  fetch: ReturnType<typeof makeFetch>;
  server: FakeServer;
}

/**
 * Mounts the Sync Dashboard page in the chosen locale against a fake fetch (check, details, ignore, link,
 * relink, resolve, create and both prefill routes) and waits for the rows. The shared syncStore and the
 * announcer are module singletons, so this resets the module registry first: every call gets a fresh graph.
 * Pair it with `afterEach(cleanupDashboard)`. Open dialogs from the page by keyboard with `openRowMenuItem`
 * or by pressing Enter on a row's primary button.
 */
export async function mountDashboard(opts: MountDashboardOptions = {}): Promise<MountedDashboard> {
  installDomPolyfills();
  vi.resetModules();
  originalFetch ??= globalThis.fetch;
  const server: FakeServer = { result: opts.result ?? dashboardFixture(), fail: new Set(opts.fail ?? []), createOutcome: opts.createOutcome ?? 'linked', calls: [] };
  const fake = makeFetch(server);
  globalThis.fetch = fake;
  const [{ SyncDashboard }, { I18nProvider }] = await Promise.all([import('@/pages/SyncDashboard'), import('@/i18n')]);
  const utils = render(
    <I18nProvider initialLocale={opts.locale ?? 'en'}>
      <SyncDashboard />
    </I18nProvider>,
  );
  await waitFor(() => {
    if (opts.noRows === true) expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    else expect(document.querySelector('[data-row-id]')).not.toBeNull();
  });
  return { ...utils, fetch: fake, server };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Opens the "More actions" menu of the row named `rowName` by keyboard (focus the trigger, Enter) and activates
 * the menu item named `label` (focus it, Enter, which Radix turns into a select). The trigger name matches in
 * English and Dutch. Resolves once the item was activated; the menu closes and the action runs afterwards.
 */
export async function openRowMenuItem(rowName: string, label: string | RegExp): Promise<void> {
  const trigger = screen.getByRole('button', { name: new RegExp(`^(More actions for|Meer acties voor) ${escapeRe(rowName)}$`) });
  act(() => { trigger.focus(); });
  pressKey(trigger, 'Enter');
  const item = await screen.findByRole('menuitem', { name: label });
  act(() => { item.focus(); });
  pressKey(item, 'Enter');
}

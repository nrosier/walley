// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { I18nProvider } from '@/i18n';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  cleanupDashboard,
  expectDialogAccessibility,
  expectFocusTrapped,
  focusIs,
  installDomPolyfills,
  mountDashboard,
  nameOf,
  openRowMenuItem,
  pressTab,
  tabbables,
  waitForFocus,
} from './a11y.helpers';

// Tests of the helpers themselves, so the dialog tests that use them can be trusted.

beforeAll(installDomPolyfills);
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

const html = (markup: string): HTMLElement => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.append(host);
  return host;
};
const label = (el: Element): string => el.id || el.textContent;

// Test-only text kept in constants (the literal scan covers JSX text in non-test files, not these).
const TITLE = 'Real title';
const BODY = 'Real body';

function RealDialog({ withDescription = true, withTitle = true }: { withDescription?: boolean; withTitle?: boolean }) {
  return (
    <I18nProvider initialLocale="en">
      <main>
        <button type="button">outside</button>
      </main>
      <Dialog open>
        <DialogContent {...(withDescription ? {} : { 'aria-describedby': undefined })}>
          {withTitle ? <DialogTitle>{TITLE}</DialogTitle> : null}
          {withDescription ? <DialogDescription>{BODY}</DialogDescription> : null}
          <button type="button">first</button>
          <button type="button">last</button>
        </DialogContent>
      </Dialog>
    </I18nProvider>
  );
}

describe('installDomPolyfills', () => {
  it('is idempotent and does not replace an existing implementation', () => {
    installDomPolyfills();
    const before = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')?.value as unknown;
    installDomPolyfills();
    expect(Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')?.value as unknown).toBe(before);
    expect(typeof ResizeObserver).toBe('function');
    expect(CSS.escape('a.b')).toBe('a\\.b');
  });
});

describe('tabbables', () => {
  it('skips tabindex -1, disabled, hidden, aria-hidden, inert and inline display none, keeps DOM order', () => {
    const host = html(`<button id="a">a</button><button tabindex="-1">b</button><button disabled>c</button>
      <div aria-hidden="true"><button>d</button></div><div hidden><button>e</button></div><div inert><button>i</button></div>
      <div style="display:none"><button>n</button></div><div tabindex="0" id="f">f</div><div tabindex="-1">g</div>
      <a href="#x" id="h">h</a><a id="nohref">x</a><input type="hidden"><input id="in">`);
    expect(tabbables(host).map(label)).toEqual(['a', 'f', 'h', 'in']);
  });

  it('treats a radio group as one stop and puts positive tabindex first', () => {
    const host = html(`<button id="plain">p</button><input type="radio" name="r" id="r1"><input type="radio" name="r" id="r2" checked><button tabindex="2" id="late">l</button>`);
    expect(tabbables(host).map(label)).toEqual(['late', 'plain', 'r2']);
  });
});

describe('nameOf', () => {
  it('reads aria-labelledby, aria-label, label, content and value, and gives a bare dialog no name', () => {
    const host = html(`<h2 id="h">Heading</h2><div id="d" role="dialog" aria-labelledby="h"></div><div id="bare" role="dialog">text</div>
      <button id="b1" aria-label="Close it">x</button><button id="b2"><svg aria-hidden="true"></svg> Save <span aria-hidden="true">!</span></button>
      <label for="i">Email</label><input id="i"><label>Wrapped <input id="w"></label><input id="s" type="submit" value="Go">`);
    const by = (id: string) => host.querySelector(`#${id}`) as HTMLElement;
    expect(nameOf(by('d'))).toBe('Heading');
    expect(nameOf(by('bare'))).toBe('');
    expect(nameOf(by('b1'))).toBe('Close it');
    expect(nameOf(by('b2'))).toBe('Save');
    expect(nameOf(by('i'))).toBe('Email');
    expect(nameOf(by('w'))).toBe('Wrapped');
    expect(nameOf(by('s'))).toBe('Go');
  });
});

describe('pressTab', () => {
  it('moves focus through the container in order, and out of it past the ends', () => {
    const host = html('<button id="a">a</button><button id="b">b</button><button id="c">c</button>');
    const [a, b, c] = Array.from(host.querySelectorAll('button'));
    a?.focus();
    expect(pressTab(host)).toBe(b);
    expect(pressTab(host)).toBe(c);
    expect(pressTab(host)).toBe(document.body);
    expect(pressTab(host)).toBe(a);
    expect(pressTab(host, { shift: true })).toBe(document.body);
    expect(pressTab(host, { shift: true })).toBe(c);
    expect(pressTab(host, { shift: true })).toBe(b);
  });

  it('lets a handler that prevents the default take over', () => {
    const host = html('<button id="a">a</button><button id="b">b</button>');
    const [a, b] = Array.from(host.querySelectorAll('button'));
    host.addEventListener('keydown', (e) => { e.preventDefault(); b?.focus(); });
    a?.focus();
    expect(pressTab(host, { shift: true })).toBe(b);
  });
});

describe('expectFocusTrapped', () => {
  it('passes on a real Radix dialog (wraps both ways, the rest of the page is hidden)', async () => {
    render(<RealDialog />);
    const dialog = await screen.findByRole('dialog');
    expectFocusTrapped(dialog);
  });

  it('fails on a div that does not trap focus', () => {
    const host = html('<div role="dialog" id="fake"><button>one</button><button>two</button></div><button>outside</button>');
    expect(() => { expectFocusTrapped(host.querySelector('#fake') as HTMLElement); }).toThrow();
  });

  it('fails when the outside is not hidden even though the trap wraps', () => {
    const host = html('<div role="dialog" id="fake"><button id="one">one</button><button id="two">two</button></div><button>outside</button>');
    host.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      e.preventDefault();
      (document.activeElement?.id === 'two' ? host.querySelector<HTMLElement>('#one') : host.querySelector<HTMLElement>('#two'))?.focus();
    });
    expect(() => { expectFocusTrapped(host.querySelector('#fake') as HTMLElement); }).toThrow(/hidden from assistive technology/);
  });
});

describe('expectDialogAccessibility', () => {
  it('passes on a labelled and described Radix dialog and checks the text', async () => {
    render(<RealDialog />);
    const dialog = await screen.findByRole('dialog');
    expectDialogAccessibility(dialog, { name: TITLE, description: BODY });
    expectDialogAccessibility(dialog, { name: /real/i });
    expect(() => { expectDialogAccessibility(dialog, { name: 'Other' }); }).toThrow();
    expect(() => { expectDialogAccessibility(dialog, { name: TITLE, description: 'Other' }); }).toThrow();
  });

  it('catches a dialog without a label', () => {
    const host = html('<div role="dialog" id="d"><button>ok</button></div>');
    expect(() => { expectDialogAccessibility(host.querySelector('#d') as HTMLElement, { name: /./ }); }).toThrow();
  });

  it('catches an aria-labelledby that points nowhere or at an empty element', () => {
    const lost = html('<div role="dialog" id="d" aria-labelledby="gone"></div>');
    expect(() => { expectDialogAccessibility(lost.querySelector('#d') as HTMLElement, { name: /./ }); }).toThrow(/resolves/);
    const empty = html('<div role="dialog" id="e" aria-labelledby="t"><h2 id="t"> </h2></div>');
    expect(() => { expectDialogAccessibility(empty.querySelector('#e') as HTMLElement, { name: /./ }); }).toThrow();
  });

  it('catches a missing description when one is required, and an unnamed button', () => {
    const host = html('<div role="dialog" id="d" aria-labelledby="t"><h2 id="t">Title</h2><button id="b"></button></div>');
    const dialog = host.querySelector('#d') as HTMLElement;
    expect(() => { expectDialogAccessibility(dialog, { name: 'Title', description: 'x' }); }).toThrow(/aria-describedby/);
    expect(() => { expectDialogAccessibility(dialog, { name: 'Title' }); }).toThrow(/accessible name/);
    expect(() => { expectDialogAccessibility(dialog, { name: 'Title', description: null }); }).toThrow(/accessible name/);
  });

  it('accepts an alertdialog', () => {
    const host = html('<div role="alertdialog" id="d" aria-labelledby="t" aria-describedby="p"><h2 id="t">T</h2><p id="p">P</p><button>ok</button></div>');
    expectDialogAccessibility(host.querySelector('#d') as HTMLElement, { name: 'T', description: 'P' });
  });
});

describe('focus helpers', () => {
  it('focusIs and waitForFocus see a late focus', async () => {
    const host = html('<button id="a">a</button>');
    const a = host.querySelector('button') as HTMLElement;
    expect(focusIs(a)).toBe(false);
    setTimeout(() => { a.focus(); }, 0);
    await waitForFocus(a);
    expect(focusIs(a)).toBe(true);
    await waitForFocus(() => host.querySelector('#a'));
    await expect(waitForFocus(host, 50)).rejects.toThrow();
  });
});

describe('mountDashboard and openRowMenuItem', () => {
  afterEach(cleanupDashboard);

  it('mounts every row kind and opens the Ignore action of a row from the keyboard', async () => {
    const { server } = await mountDashboard();
    for (const name of ['Netflix', 'Spotify', 'Adobe', 'Orphan', 'Hulu', 'Gym']) {
      expect(document.body.textContent).toContain(name);
    }
    expect(screen.getByRole('button', { name: 'Review differences: Adobe' })).toBeTruthy();
    await openRowMenuItem('Hulu', 'Ignore Hulu');
    await waitFor(() => {
      expect(server.calls).toContainEqual({ method: 'POST', url: '/api/matches/ignore', body: { side: 'wallos', itemId: 'w-hulu' } });
    });
  });

  it('opens the Unlink confirmation from a linked row menu, and mounts in Dutch', async () => {
    await mountDashboard({ locale: 'nl' });
    expect(screen.getByRole('button', { name: 'Verschillen bekijken: Adobe' })).toBeTruthy();
    await openRowMenuItem('Spotify', /./);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });
});

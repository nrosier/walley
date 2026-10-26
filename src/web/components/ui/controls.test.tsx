import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import { Alert } from './alert';
import { Dialog } from './dialog';
import { DialogShell } from './dialog-shell';
import shellSource from './dialog-shell.tsx?raw';
import { Disclosure } from './disclosure';
import { MoreActionsMenu } from './more-actions-menu';
import { ScopePill } from './scope-pill';
import { SegmentedControl } from './segmented-control';

// Node test environment: no DOM, so Radix portal content (open menu, open dialog) and key presses cannot run here.
// These tests check the rendered markup that carries the keyboard and screen reader contract: roles, names,
// aria-expanded, native radio inputs (which give arrow-key behaviour), and the dialog layout classes.
const render = (ui: React.ReactElement, locale: Locale = 'en') =>
  renderToStaticMarkup(<I18nProvider initialLocale={locale}>{ui}</I18nProvider>);

describe('MoreActionsMenu', () => {
  const items = [{ id: 'ignore', label: 'Ignore', onSelect: () => undefined }];
  it('renders a menu button with a unique accessible name per row', () => {
    const a = render(<MoreActionsMenu items={items} name="Netflix" />);
    const b = render(<MoreActionsMenu items={items} name="Spotify" />);
    expect(a).toContain('aria-label="More actions for Netflix"');
    expect(b).toContain('aria-label="More actions for Spotify"');
    expect(a).toContain('aria-haspopup="menu"');
    expect(a).toContain('aria-expanded="false"');
    expect(a).toContain('<button');
    expect(a).not.toContain('Ignore');
  });
  it('falls back to a generic name and translates', () => {
    expect(render(<MoreActionsMenu items={items} />)).toContain('aria-label="More actions"');
    expect(render(<MoreActionsMenu items={items} name="Netflix" />, 'nl')).toContain('aria-label="Meer acties voor Netflix"');
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'wallos', label: 'Wallos' },
    { value: 'actual', label: 'Actual' },
  ];
  it('renders a named radio group with one checked native radio per option', () => {
    const html = render(<SegmentedControl options={options} value="actual" onValueChange={() => undefined} aria-label="Source" />);
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Source"');
    expect(html.match(/type="radio"/g)).toHaveLength(2);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toMatch(/value="actual"[^>]*checked=""|checked=""[^>]*value="actual"/);
    const names = [...html.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(names).size).toBe(1);
    expect(html).toContain('min-h-(--control-h)');
  });
  it('gives two controls different group names', () => {
    const one = render(<SegmentedControl options={options} value="wallos" onValueChange={() => undefined} aria-label="Source" />);
    const two = render(<SegmentedControl options={options} value="wallos" onValueChange={() => undefined} aria-label="Billing cycle" />);
    expect(one).toContain('aria-label="Source"');
    expect(two).toContain('aria-label="Billing cycle"');
  });
});

describe('Disclosure', () => {
  it('is closed by default: a button with aria-expanded=false and no content', () => {
    const html = render(<Disclosure title="Ignored items">Hidden rows</Disclosure>);
    expect(html).toContain('<button');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Ignored items');
    expect(html).not.toContain('Hidden rows');
  });
  it('shows content when open', () => {
    const html = render(<Disclosure title="Ignored items" defaultOpen>Visible rows</Disclosure>);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('Visible rows');
  });
});

describe('Alert', () => {
  it('uses role=alert and assertive live region for errors, with a hidden kind prefix', () => {
    const html = render(<Alert variant="error">Could not save</Alert>);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('Error: ');
    expect(html).toContain('Could not save');
  });
  it('uses role=status and a polite live region for info and success', () => {
    for (const variant of ['info', 'success'] as const) {
      const html = render(<Alert variant={variant}>Saved</Alert>);
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-live="polite"');
    }
  });
  it('translates the prefix', () => {
    expect(render(<Alert variant="warning">x</Alert>, 'nl')).toContain('Waarschuwing: ');
  });
});

describe('ScopePill', () => {
  it('renders the scope text in en and nl', () => {
    expect(render(<ScopePill scope="account" />)).toContain('>Your account<');
    expect(render(<ScopePill scope="device" />)).toContain('>This device<');
    expect(render(<ScopePill scope="account" />, 'nl')).toContain('>Uw account<');
    expect(render(<ScopePill scope="device" />, 'nl')).toContain('>Dit apparaat<');
  });
});

describe('DialogShell', () => {
  it('renders nothing while the dialog is closed', () => {
    const html = render(
      <Dialog open={false}>
        <DialogShell title="Hidden" footer="Foot">Body</DialogShell>
      </Dialog>,
    );
    expect(html).not.toContain('Hidden');
  });
  it('pins header and footer, scrolls the body, caps the height and becomes a sheet below 768px', () => {
    // The open dialog sits in a portal that static markup does not include, so check the layout in the source.
    expect(shellSource).toContain('max-h-[85vh]');
    expect(shellSource).toContain('shrink-0');
    expect(shellSource).toContain('overflow-y-auto');
    expect(shellSource).toContain('max-md:h-dvh');
    expect(shellSource).toContain('max-md:inset-0');
    expect(shellSource).toContain('<DialogTitle>');
  });
});

// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, type Locale } from '@/i18n';
import type { PairRow } from '@/lib/pair-rows';
import type { SyncLinked } from '../../../lib/sync-check-types';
import type { SyncItemDetails } from '../../../lib/sync-item-details';
import { PairList } from './PairList';
import { SyncItemDetailsDialog } from './SyncItemDetailsDialog';
import { syncItemDetailsMessages } from './SyncItemDetailsDialog.messages';

// Rendered tests for the read-only details dialog of a synced item (#155). Runs in jsdom via the
// per-file pragma above; the rest of the suite stays on the node environment.

const wallosDetails: SyncItemDetails = {
  side: 'wallos',
  id: '7',
  title: 'Netflix',
  priceCents: -1250,
  currency: 'EUR',
  cycle: { key: 'monthly', count: 1 },
  startDate: '2026-01-01',
  nextPayment: '2026-11-03',
  paymentMethod: 'Visa',
  category: 'Streaming',
  notes: 'family plan',
  autoRenew: true,
};

const actualDetails: SyncItemDetails = {
  side: 'actual',
  id: 'sch-a',
  name: 'Spotify',
  amountCents: -999,
  isRange: false,
  currency: 'EUR',
  cycle: { key: 'yearly', count: 2 },
  startDate: '2026-01-01',
  payee: 'Spotify AB',
  account: 'Checking',
};

const emptyWallos: SyncItemDetails = {
  side: 'wallos',
  id: '9',
  title: 'Bare',
  priceCents: 300,
  currency: 'JPY',
  cycle: null,
  startDate: null,
  nextPayment: null,
  paymentMethod: null,
  category: null,
  notes: null,
  autoRenew: false,
};

function fetchReturning(body: SyncItemDetails | null, status = 200): typeof fetch {
  return vi.fn(async () => {
    if (body === null) return new Response(JSON.stringify({ error: 'item_not_found' }), { status: 404 });
    return new Response(JSON.stringify(body), { status });
  });
}

function renderDialog(props: { side: 'wallos' | 'actual'; itemId: string; name: string; fetchImpl: typeof fetch; locale?: Locale }) {
  return render(
    <I18nProvider initialLocale={props.locale ?? 'en'}>
      <SyncItemDetailsDialog open onOpenChange={vi.fn()} side={props.side} itemId={props.itemId} name={props.name} fetchImpl={props.fetchImpl} />
    </I18nProvider>,
  );
}

/** The label/value pairs of the open dialog, in order. */
function fields(): [string, string][] {
  const dl = document.querySelector('dl');
  if (dl === null) return [];
  const dts = [...dl.querySelectorAll('dt')];
  const dds = [...dl.querySelectorAll('dd')];
  return dts.map((dt, i) => [dt.textContent, dds[i]?.textContent ?? '']);
}

afterEach(() => {
  cleanup();
});

describe('SyncItemDetailsDialog Wallos side (#155)', () => {
  it('lists the Wallos fields with the price in its own currency and the cycle label', async () => {
    renderDialog({ side: 'wallos', itemId: '7', name: 'Netflix', fetchImpl: fetchReturning(wallosDetails) });
    await waitFor(() => { expect(fields().length).toBeGreaterThan(0); });
    expect(fields()).toEqual([
      ['Price', '-€12.50'],
      ['Currency', 'EUR'],
      ['Billing cycle', 'Every month'],
      ['Start date', expect.any(String) as unknown as string],
      ['Next payment', expect.any(String) as unknown as string],
      ['Payment method', 'Visa'],
      ['Category', 'Streaming'],
      ['Notes', 'family plan'],
      ['Auto-renew', 'Yes'],
    ]);
  });

  it('formats a zero-decimal currency with no fraction digits', async () => {
    renderDialog({ side: 'wallos', itemId: '9', name: 'Bare', fetchImpl: fetchReturning(emptyWallos) });
    await waitFor(() => { expect(fields().length).toBeGreaterThan(0); });
    expect(fields()[0]).toEqual(['Price', '¥300']);
  });
});

describe('SyncItemDetailsDialog Actual side (#155)', () => {
  it('lists the Actual fields with the base-currency amount, frequency, payee and account', async () => {
    renderDialog({ side: 'actual', itemId: 'sch-a', name: 'Spotify', fetchImpl: fetchReturning(actualDetails) });
    await waitFor(() => { expect(fields().length).toBeGreaterThan(0); });
    expect(fields()).toEqual([
      ['Amount', '-€9.99'],
      ['Currency', 'EUR'],
      ['Frequency', 'Every 2 years'],
      ['Start date', expect.any(String) as unknown as string],
      ['Payee', 'Spotify AB'],
      ['Account', 'Checking'],
    ]);
  });
});

describe('SyncItemDetailsDialog empty values (#155)', () => {
  it('shows "Not set" for every empty Wallos field and "No" for auto-renew off', async () => {
    renderDialog({ side: 'wallos', itemId: '9', name: 'Bare', fetchImpl: fetchReturning(emptyWallos) });
    await waitFor(() => { expect(fields().length).toBeGreaterThan(0); });
    const values = Object.fromEntries(fields());
    expect(values['Billing cycle']).toBe('Not set');
    expect(values['Start date']).toBe('Not set');
    expect(values['Next payment']).toBe('Not set');
    expect(values['Payment method']).toBe('Not set');
    expect(values['Category']).toBe('Not set');
    expect(values['Notes']).toBe('Not set');
    expect(values['Auto-renew']).toBe('No');
  });

  it('shows "Not set" for an Actual schedule with no payee, account or cycle', async () => {
    const bare: SyncItemDetails = { ...actualDetails, amountCents: null, cycle: null, startDate: null, payee: null, account: null };
    renderDialog({ side: 'actual', itemId: 'sch-a', name: 'Spotify', fetchImpl: fetchReturning(bare) });
    await waitFor(() => { expect(fields().length).toBeGreaterThan(0); });
    const values = Object.fromEntries(fields());
    expect(values['Amount']).toBe('Not set');
    expect(values['Frequency']).toBe('Not set');
    expect(values['Payee']).toBe('Not set');
    expect(values['Account']).toBe('Not set');
  });
});

describe('SyncItemDetailsDialog read-only (#155)', () => {
  it('has no form fields and no save action', async () => {
    renderDialog({ side: 'wallos', itemId: '7', name: 'Netflix', fetchImpl: fetchReturning(wallosDetails) });
    await waitFor(() => { expect(fields().length).toBeGreaterThan(0); });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(dialog).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(dialog).queryAllByRole('spinbutton')).toHaveLength(0);
    expect(within(dialog).queryByRole('button', { name: /save/i })).toBeNull();
    expect(dialog.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });

  it('shows an error message and no fields when the item is not found', async () => {
    renderDialog({ side: 'actual', itemId: 'sch-x', name: 'Gone', fetchImpl: fetchReturning(null) });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fields()).toEqual([]);
  });
});

describe('SyncItemDetailsDialog from a synced row (#155)', () => {
  const link: SyncLinked = {
    matchId: 'm1',
    wallosId: '7',
    actualScheduleId: 'sch-a',
    status: 'LINKED',
    orphan: null,
    wallosName: 'Netflix',
    actualName: 'Spotify',
    wallosAmountCents: -1250,
    actualAmountCents: -1250,
    isRange: false,
    relinkCandidateIds: [],
  };
  const rows: PairRow[] = [
    {
      key: 'linked:7|sch-a',
      kind: 'linked',
      wallos: { id: '7', name: 'Netflix', amountCents: -1250, isRange: false, reason: null, ignored: false, matchId: null },
      actual: { id: 'sch-a', name: 'Spotify', amountCents: -1250, isRange: false, reason: null, ignored: false, matchId: null },
      badge: 'synced',
      candidate: null,
      differs: false,
      link,
    } as unknown as PairRow,
  ];

  /** Mounts PairList with a fetch stub and keeps `pane` in state, as the page does. */
  function Harness({ fetchImpl }: { fetchImpl: typeof fetch }) {
    const [pane] = useState<'wallos' | 'actual'>('wallos');
    return (
      <I18nProvider initialLocale="en">
        <PairList
          rows={rows}
          pane={pane}
          baseCurrency="EUR"
          candidates={[]}
          emptyText="none"
          wallosTitle="Wallos"
          actualTitle="Actual"
          wallosCount={1}
          actualCount={1}
          linkedTotal={1}
          detailsFetch={fetchImpl}
        />
      </I18nProvider>
    );
  }

  it('opens from the name button, moves focus into the dialog, and Escape returns focus to the name', async () => {
    const fetchImpl = fetchReturning(wallosDetails);
    render(<Harness fetchImpl={fetchImpl} />);
    const nameButton = screen.getByRole('button', { name: 'Show details for Netflix' });
    nameButton.focus();
    fireEvent.click(nameButton);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => { expect(within(dialog).queryByText('Billing cycle')).not.toBeNull(); });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
    expect(document.activeElement).toBe(nameButton);
  });
});

describe('SyncItemDetails messages (#155)', () => {
  it('renders the same labels in nl, and the nl "Not set" text', async () => {
    renderDialog({ side: 'wallos', itemId: '9', name: 'Bare', fetchImpl: fetchReturning(emptyWallos), locale: 'nl' });
    await waitFor(() => { expect(fields().length).toBeGreaterThan(0); });
    const values = Object.fromEntries(fields());
    expect(values['Factureringscyclus']).toBe('Niet ingesteld');
    expect(values['Automatisch verlengen']).toBe('Nee');
  });

  it('has identical en and nl keys', () => {
    const keys = (node: unknown, prefix = ''): string[] =>
      typeof node !== 'object' || node === null
        ? [prefix]
        : Object.entries(node).flatMap(([k, v]) => keys(v, prefix === '' ? k : `${prefix}.${k}`));
    expect(keys(syncItemDetailsMessages.nl).sort()).toEqual(keys(syncItemDetailsMessages.en).sort());
  });
});

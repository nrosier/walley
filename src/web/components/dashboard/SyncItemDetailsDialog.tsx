import { useEffect, useRef, useState } from 'react';
import { formatMoney } from '../../../lib/format-money';
import type { BillingCycle } from '../../../lib/billing-cycle';
import type { ActualItemDetails, SyncItemDetails, WallosItemDetails } from '../../../lib/sync-item-details';
import { useT, type Locale } from '@/i18n';
import { ApiError } from '@/lib/api';
import { fetchItemDetails } from '@/lib/sync-items.api';
import { Dialog } from '../ui/dialog';
import { DialogShell } from '../ui/dialog-shell';
import { cycleLabel } from '@/lib/billing-cycle-label';
import { syncItemDetailsMessages } from './SyncItemDetailsDialog.messages';
import { syncDashboardMessages } from '@/pages/SyncDashboard.messages';

export interface SyncItemDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side: 'wallos' | 'actual';
  /** The item's own id on its side (Wallos subscription id or Actual schedule id). */
  itemId: string;
  /** The name shown on the row, used as the dialog title until the details load. */
  name: string;
  fetchImpl?: typeof fetch;
}

/** The fetch result, tagged with the item it is for so a stale result from another item is never shown. */
type Load =
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; details: SyncItemDetails }
  | { status: 'error'; key: string; code: string };

/** A `YYYY-MM-DD` date in the reader's format; anything else is shown as given. Matches DiffModal. */
function formatDate(value: string, locale: Locale): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

/**
 * Read-only details of one synced item on its own side (#155). Fetches on open from
 * GET /api/sync/items/:side/:id. No form fields and no save action. Empty values show "Not set".
 * Radix returns focus to the opening name button when the dialog closes (Escape or close).
 */
export function SyncItemDetailsDialog({ open, onOpenChange, side, itemId, name, fetchImpl }: SyncItemDetailsDialogProps) {
  const { t, locale } = useT(syncItemDetailsMessages);
  const { t: tCycle } = useT(syncDashboardMessages);
  const key = `${side}:${itemId}`;
  const [load, setLoad] = useState<Load>({ status: 'loading', key });
  // The name button that opened the dialog, kept while the dialog is open so close can return focus to it.
  const openerId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    openerId.current = itemId;
    const ctl = new AbortController();
    fetchItemDetails(side, itemId, fetchImpl, ctl.signal).then(
      (details) => { setLoad({ status: 'ready', key, details }); },
      (err: unknown) => {
        if (ctl.signal.aborted) return;
        setLoad({ status: 'error', key, code: err instanceof ApiError ? err.code : 'request_failed' });
      },
    );
    return () => { ctl.abort(); };
  }, [open, side, itemId, fetchImpl, key]);
  // A result for another item (from an earlier open) reads as loading until this item's fetch lands.
  const current = load.key === key ? load : { status: 'loading' as const, key };

  const notSet = t('notSet');
  const money = (cents: number | null, currency: string) => (cents === null ? notSet : formatMoney(cents, currency, locale));
  const date = (value: string | null) => (value === null ? notSet : formatDate(value, locale));
  const text = (value: string | null) => value ?? notSet;
  const cycle = (c: BillingCycle | null) => (c === null ? notSet : cycleLabel(tCycle, c));

  const rowsOf = (details: SyncItemDetails): [string, string][] => {
    if (details.side === 'wallos') {
      const d: WallosItemDetails = details;
      return [
        [t('wallos.price'), money(d.priceCents, d.currency)],
        [t('wallos.currency'), d.currency],
        [t('wallos.cycle'), cycle(d.cycle)],
        [t('wallos.startDate'), date(d.startDate)],
        [t('wallos.nextPayment'), date(d.nextPayment)],
        [t('wallos.paymentMethod'), text(d.paymentMethod)],
        [t('wallos.category'), text(d.category)],
        [t('wallos.notes'), text(d.notes)],
        [t('wallos.autoRenew'), d.autoRenew ? t('yes') : t('no')],
      ];
    }
    const d: ActualItemDetails = details;
    return [
      [t('actual.amount'), money(d.amountCents, d.currency)],
      [t('actual.currency'), d.currency],
      [t('actual.frequency'), cycle(d.cycle)],
      [t('actual.startDate'), date(d.startDate)],
      [t('actual.payee'), text(d.payee)],
      [t('actual.account'), text(d.account)],
    ];
  };

  const title = current.status === 'ready' ? (current.details.side === 'wallos' ? current.details.title : current.details.name) : name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogShell
        title={title}
        description={t(side === 'wallos' ? 'wallosHeading' : 'actualHeading')}
        onCloseAutoFocus={(event) => {
          // Return focus to the name button that opened the dialog (#155 keyboard rule).
          const id = openerId.current;
          const opener = id === null ? null : document.querySelector<HTMLElement>(`[data-details-for="${CSS.escape(id)}"]`);
          if (opener !== null) {
            event.preventDefault();
            opener.focus();
          }
        }}
      >
        {current.status === 'loading' ? <p className="text-sm text-muted">{t('loading')}</p> : null}
        {current.status === 'error' ? (
          <p role="alert" className="text-sm text-muted">{t('loadFailed')}</p>
        ) : null}
        {current.status === 'ready' ? (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
            {rowsOf(current.details).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </DialogShell>
    </Dialog>
  );
}

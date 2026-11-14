import { useEffect, useId, useRef, useState } from 'react';
import { Unlink } from 'lucide-react';
import type { SyncMismatch, SyncMismatchFields, SyncWallosSource } from '../../../lib/sync-check-types';
import { formatMoney } from '../../../lib/format-money';
import { currencyExponent } from '../../../lib/currency-exponent';
import { formatRate } from '@/lib/format-rate';
import { useT } from '@/i18n';
import type { Locale } from '@/i18n';
import type { OverwriteAction } from '@/lib/matches.api';
import { driftedFields, type FieldKey } from '@/lib/resolve-mismatch';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Dialog,
} from '../ui/dialog';
import { DialogShell } from '../ui/dialog-shell';
import { RateField } from '../dashboard/RateField';
import { diffModalMessages } from './DiffModal.messages';

export interface DiffModalProps {
  /** The mismatch to review; the modal is open while this is set. */
  mismatch: SyncMismatch | null;
  baseCurrency: string;
  onClose: () => void;
  onIgnoreDiff: (matchId: string) => void;
  /** Called only after the overwrite confirmation. */
  onOverwrite: (matchId: string, action: OverwriteAction) => void;
  /** Called only after the Unlink confirmation. */
  onUnlink: (matchId: string) => void;
  /** An action was sent and the server has not answered: buttons are off, "Working..." shows, the modal cannot be dismissed. */
  working?: boolean;
  /** Resolved text of the last failed action; the modal stays open to show it. */
  error?: string | null;
  /** The per-subscription rate was saved or cleared: the owner re-runs the check and passes the updated mismatch back (#223). */
  onRateChanged?: (matchId: string) => void;
  /** Resolved text of a partial success (the currency was written but other fields still differ); shown as a status. */
  notice?: string | null;
  /** Where focus goes when neither the Review button nor the row's name button exists (after Unlink); null means the search box. */
  closeFocus?: () => HTMLElement | null;
}

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

/** A `YYYY-MM-DD` start date in the reader's format; anything else is shown as given. */
function formatDate(value: string, locale: Locale): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

/**
 * The subscription's own price as `USD 25.00` (JPY: `JPY 2,000`): the code, and the minor units that currency has.
 * Wallos may hold a code that is not an ISO 4217 code (`US$`): Intl throws a RangeError for it, so the price is
 * shown as `{code} {amount}` with the same number of decimals instead.
 */
function formatSourcePrice(source: SyncWallosSource, locale: Locale): string {
  const digits = currencyExponent(source.currencyCode);
  // The price is shown as a magnitude (`USD 25.00`), not signed: priceCents is negative for an expense.
  const amount = Math.abs(source.priceCents) / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: source.currencyCode,
      currencyDisplay: 'code',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    const plain = new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
    return `${source.currencyCode} ${plain}`;
  }
}

/**
 * `1 USD ≈ 0.50 EUR`, read from the subscription's own price and the converted amount the check computed. The
 * stored rate is on the Wallos scale (units per Wallos main currency), which does not say this directly.
 */
function effectiveRate(source: SyncWallosSource, wallos: SyncMismatchFields, baseCurrency: string, locale: Locale): string | null {
  if (wallos.amount.kind !== 'single' || source.priceCents === 0 || baseCurrency === '') return null;
  const own = source.priceCents / 10 ** currencyExponent(source.currencyCode);
  const base = wallos.amount.cents / 10 ** currencyExponent(baseCurrency);
  const per = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(base / own);
  return `1 ${source.currencyCode} \u2248 ${per} ${baseCurrency}`;
}

/** Wallos and Actual values of each drifted field, side by side, with the four resolve actions. */
export function DiffModal({ mismatch, baseCurrency, onClose, onIgnoreDiff, onOverwrite, onUnlink, working: resolving = false, error, onRateChanged, notice, closeFocus }: DiffModalProps) {
  // A rate save or clear is pending: the resolve actions lock, as the rate field locks while a resolve runs.
  const [rateBusy, setRateBusy] = useState(false);
  const working = resolving || rateBusy;
  const { t, locale } = useT(diffModalMessages);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const ignoreRef = useRef<HTMLButtonElement>(null);
  const sourceHeadingId = useId();
  // The Review button to return to; the modal's mismatch is already null when the close focus handler runs.
  const lastId = useRef<string | null>(null);
  const openId = mismatch?.matchId ?? null;
  useEffect(() => {
    if (openId !== null) lastId.current = openId;
  }, [openId]);

  const show = (key: FieldKey, f: SyncMismatchFields): string => {
    const currency = f.currency === '' ? baseCurrency : f.currency;
    switch (key) {
      case 'amount':
        return f.amount.kind === 'single'
          ? formatMoney(f.amount.cents, baseCurrency, locale)
          : `${formatMoney(Math.min(f.amount.num1, f.amount.num2), baseCurrency, locale)} – ${formatMoney(Math.max(f.amount.num1, f.amount.num2), baseCurrency, locale)}`;
      case 'interval':
        return t('every', { n: String(f.interval) });
      case 'startDate':
        return f.startDate === null ? t('none') : formatDate(f.startDate, locale);
      case 'currency':
        return currency;
      case 'frequency': {
        const known = FREQUENCIES.find((x) => x === f.frequency);
        return known === undefined ? f.frequency : t(`frequencies.${known}`);
      }
    }
  };

  const rows = mismatch === null ? [] : driftedFields(mismatch.wallosFields, mismatch.actualFields);
  // Present only for a foreign-currency subscription (#223); nothing extra shows for a base-currency pair.
  const source = mismatch?.wallosFields.source;
  // Rates are written without exponent notation: the server's override pattern rejects `1e-7`.
  const wallosRate = source === undefined ? '' : formatRate(source.rate);
  const effective = mismatch !== null && source !== undefined ? effectiveRate(source, mismatch.wallosFields, baseCurrency, locale) : null;

  const overwrite = (
    label: string,
    hint: string,
    title: string,
    body: string,
    action: OverwriteAction,
  ) => (
    <li className="flex flex-col gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="min-h-(--control-h) self-start"
            // Not natively off: the button keeps focus while the request runs and after a failure.
            aria-disabled={working}
            aria-busy={working}
            onClick={(e) => {
              // Cancelling the click also keeps the confirmation from opening (Radix skips a prevented click).
              if (working) e.preventDefault();
            }}
          >
            {label}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (mismatch !== null && !working) onOverwrite(mismatch.matchId, action);
              }}
            >
              {t('confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <span className="text-xs text-muted">{hint}</span>
    </li>
  );

  return (
    <Dialog
      open={mismatch !== null}
      onOpenChange={(open) => {
        if (!open && !working) onClose();
      }}
    >
      <DialogShell
        className="max-w-2xl"
        title={t('title')}
        description={mismatch === null ? '' : t('description', { wallos: mismatch.wallosName, actual: mismatch.actualName })}
        aria-busy={working}
        onOpenAutoFocus={(event) => {
          // Ignore Diff is the safe choice: it changes nothing in either system.
          event.preventDefault();
          ignoreRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          const id = lastId.current;
          const review = id === null ? null : document.querySelector<HTMLElement>(`[data-review-for="${CSS.escape(id)}"]`);
          // After Ignore Diff the pair is Synced and the Review button is gone: use the row's name (details) button.
          const details = id === null ? null : document.querySelector<HTMLElement>(`[data-linked-match="${CSS.escape(id)}"] [data-details-for]`);
          // Neither exists after a successful Unlink (the pair left the list): the next row, else the search box.
          const target = review ?? details ?? closeFocus?.() ?? document.querySelector<HTMLElement>('input[type="search"]');
          if (target !== null) {
            event.preventDefault();
            target.focus();
          }
        }}
        footer={
          <div className="flex w-full flex-col gap-1">
            <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  aria-disabled={working}
                  aria-busy={working}
                  onClick={(e) => {
                    if (working) e.preventDefault();
                  }}
                  className="min-h-(--control-h) self-start border-danger-line text-danger hover:bg-danger-bg"
                >
                  <Unlink aria-hidden="true" />
                  {t('unlink')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('unlinkConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('unlinkConfirmBody')}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      if (mismatch !== null && !working) onUnlink(mismatch.matchId);
                    }}
                  >
                    {t('confirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <span className="text-xs text-muted">{t('consequence.unlink')}</span>
          </div>
        }
      >
        {resolving ? (
          <Alert variant="info" className="mb-3">
            {t('working')}
          </Alert>
        ) : null}
        {notice != null && error == null && !resolving ? (
          <Alert variant="info" className="mb-3">
            {notice}
          </Alert>
        ) : null}
        {error != null && !resolving ? (
          <Alert variant="error" className="mb-3">
            {error}
          </Alert>
        ) : null}
        <table aria-label={t('table')} className="mb-4 w-full border-collapse">
          <thead className="border-b">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left text-xs font-medium text-muted">{t('field')}</th>
              <th scope="col" className="px-3 py-1.5 text-left text-xs font-medium text-muted">{t('wallos')}</th>
              <th scope="col" className="px-3 py-1.5 text-left text-xs font-medium text-muted">{t('actual')}</th>
            </tr>
          </thead>
          <tbody>
            {mismatch !== null &&
              rows.map((key) => (
                <tr key={key} data-diff-row={key} className="border-b last:border-b-0">
                  <th scope="row" className="px-3 py-1.5 text-left text-sm font-medium">{t(`fields.${key}`)}</th>
                  <td className="px-3 py-1.5 font-mono text-sm">
                    {show(key, mismatch.wallosFields)}
                    {key === 'amount' && source !== undefined ? (
                      <span data-source-price className="block text-xs text-muted">{formatSourcePrice(source, locale)}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-sm">{show(key, mismatch.actualFields)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        {mismatch !== null && source !== undefined ? (
          <section aria-labelledby={sourceHeadingId} data-wallos-source className="mb-4 grid gap-2 rounded-md border p-3">
            <h3 id={sourceHeadingId} className="text-sm font-medium">{t('source.heading')}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted">{t('source.price')}</dt>
              <dd className="font-mono">{formatSourcePrice(source, locale)}</dd>
              <dt className="text-muted">
                {effective === null ? t(source.rateSource === 'override' ? 'source.yourRate' : 'source.wallosRate', { from: source.currencyCode }) : t('source.rate', { from: source.currencyCode, to: baseCurrency })}
              </dt>
              <dd className="font-mono">{effective ?? wallosRate}</dd>
              <dt className="text-muted">{t('source.rateFrom')}</dt>
              <dd>{t(`source.rateSources.${source.rateSource}`)}</dd>
            </dl>
            <RateField
              prefill={{
                sourceCurrency: source.currencyCode,
                baseCurrency,
                overrideRate: source.rateSource === 'override' ? wallosRate : null,
                // With an override, source.rate is the override, not the Wallos rate: no Wallos-rate help then.
                ...(source.rateSource === 'override' ? {} : { wallosRate }),
              }}
              label={t('source.wallosRate', { from: source.currencyCode })}
              labelClassName="text-xs"
              locked={resolving}
              onBusyChange={setRateBusy}

              wallosId={mismatch.wallosId}
              onChanged={() => { onRateChanged?.(mismatch.matchId); }}
            />
          </section>
        ) : null}
        <ul aria-label={t('options')} className="flex flex-col gap-3">
          <li className="flex flex-col gap-1">
            <Button
              ref={ignoreRef}
              type="button"
              variant="outline"
              className="min-h-(--control-h) self-start"
              aria-disabled={working}
              aria-busy={working}
              onClick={() => {
                if (mismatch !== null && !working) onIgnoreDiff(mismatch.matchId);
              }}
            >
              {t('ignoreDiff')}
            </Button>
            <span className="text-xs text-muted">{t('consequence.ignoreDiff')}</span>
          </li>
          {overwrite(t('overwriteWallos'), t('consequence.overwriteWallos'), t('overwriteWallosConfirmTitle'), t('overwriteConfirmBody'), 'overwrite_wallos')}
          {overwrite(t('overwriteActual'), t('consequence.overwriteActual'), t('overwriteActualConfirmTitle'), t('overwriteConfirmBody'), 'overwrite_actual')}
          {mismatch !== null && source !== undefined && mismatch.actualFields.amount.kind === 'single'
            ? overwrite(
                t('changeCurrency', { currency: baseCurrency }),
                t('consequence.changeCurrency', { currency: baseCurrency }),
                t('changeCurrencyConfirmTitle', { currency: baseCurrency }),
                t('changeCurrencyConfirmBody', {
                  name: mismatch.wallosName,
                  from: source.currencyCode,
                  to: baseCurrency,
                  amount: formatMoney(Math.abs(mismatch.actualFields.amount.cents), baseCurrency, locale),
                }),
                'overwrite_wallos_currency',
              )
            : null}
        </ul>
      </DialogShell>
    </Dialog>
  );
}

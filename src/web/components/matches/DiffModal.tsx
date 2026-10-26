import { useEffect, useRef, useState } from 'react';
import { Unlink } from 'lucide-react';
import type { SyncMismatch, SyncMismatchFields } from '../../../lib/sync-check-types';
import { formatMoney } from '../../../lib/format-money';
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
}

const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

/** A `YYYY-MM-DD` start date in the reader's format; anything else is shown as given. */
function formatDate(value: string, locale: Locale): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

/** Wallos and Actual values of each drifted field, side by side, with the four resolve actions. */
export function DiffModal({ mismatch, baseCurrency, onClose, onIgnoreDiff, onOverwrite, onUnlink, working = false, error }: DiffModalProps) {
  const { t, locale } = useT(diffModalMessages);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const ignoreRef = useRef<HTMLButtonElement>(null);
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

  const overwrite = (
    label: string,
    hint: string,
    titleKey: 'overwriteWallosConfirmTitle' | 'overwriteActualConfirmTitle',
    action: OverwriteAction,
  ) => (
    <li className="flex flex-col gap-1">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" className="min-h-(--control-h) self-start" disabled={working}>
            {label}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(titleKey)}</AlertDialogTitle>
            <AlertDialogDescription>{t('overwriteConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (mismatch !== null) onOverwrite(mismatch.matchId, action);
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
          if (review !== null) {
            event.preventDefault();
            review.focus();
          }
        }}
        footer={
          <div className="flex w-full flex-col gap-1">
            <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={working}
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
                      if (mismatch !== null) onUnlink(mismatch.matchId);
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
        {working ? (
          <Alert variant="info" className="mb-3">
            {t('working')}
          </Alert>
        ) : null}
        {error != null && !working ? (
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
                  <td className="px-3 py-1.5 font-mono text-sm">{show(key, mismatch.wallosFields)}</td>
                  <td className="px-3 py-1.5 font-mono text-sm">{show(key, mismatch.actualFields)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <ul aria-label={t('options')} className="flex flex-col gap-3">
          <li className="flex flex-col gap-1">
            <Button
              ref={ignoreRef}
              type="button"
              variant="outline"
              className="min-h-(--control-h) self-start"
              disabled={working}
              onClick={() => {
                if (mismatch !== null) onIgnoreDiff(mismatch.matchId);
              }}
            >
              {t('ignoreDiff')}
            </Button>
            <span className="text-xs text-muted">{t('consequence.ignoreDiff')}</span>
          </li>
          {overwrite(t('overwriteWallos'), t('consequence.overwriteWallos'), 'overwriteWallosConfirmTitle', 'overwrite_wallos')}
          {overwrite(t('overwriteActual'), t('consequence.overwriteActual'), 'overwriteActualConfirmTitle', 'overwrite_actual')}
        </ul>
      </DialogShell>
    </Dialog>
  );
}

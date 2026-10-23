import { useState } from 'react';
import type { SyncMismatch, SyncMismatchFields } from '../../../lib/sync-check-types';
import { formatMoney } from '../../../lib/format-money';
import { useT } from '@/i18n';
import type { OverwriteAction } from '@/lib/matches.api';
import { driftedFields, type FieldKey } from '@/lib/resolve-mismatch';
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
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
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
}

/** Wallos and Actual values of each drifted field, side by side, with the four resolve actions. */
export function DiffModal({ mismatch, baseCurrency, onClose, onIgnoreDiff, onOverwrite, onUnlink }: DiffModalProps) {
  const { t, locale } = useT(diffModalMessages);
  const [confirmUnlink, setConfirmUnlink] = useState(false);

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
        return f.startDate ?? t('none');
      case 'currency':
        return currency;
      case 'frequency':
        return f.frequency;
    }
  };

  const rows = mismatch === null ? [] : driftedFields(mismatch.wallosFields, mismatch.actualFields);
  const overwrite = (
    label: string,
    titleKey: 'overwriteWallosConfirmTitle' | 'overwriteActualConfirmTitle',
    action: OverwriteAction,
  ) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline">
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
  );

  return (
    <Dialog
      open={mismatch !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {mismatch === null ? '' : t('description', { wallos: mismatch.wallosName, actual: mismatch.actualName })}
          </DialogDescription>
        </DialogHeader>
        <table aria-label={t('table')} className="w-full border-collapse">
          <thead className="border-b">
            <tr>
              <th scope="col" className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">{t('field')}</th>
              <th scope="col" className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">{t('wallos')}</th>
              <th scope="col" className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">{t('actual')}</th>
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
        <DialogFooter className="flex-wrap">
          {overwrite(t('overwriteWallos'), 'overwriteWallosConfirmTitle', 'overwrite_wallos')}
          {overwrite(t('overwriteActual'), 'overwriteActualConfirmTitle', 'overwrite_actual')}
          <Button type="button" variant="outline" onClick={() => {
              if (mismatch !== null) onIgnoreDiff(mismatch.matchId);
            }}>
            {t('ignoreDiff')}
          </Button>
          <AlertDialog open={confirmUnlink} onOpenChange={setConfirmUnlink}>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useState } from 'react';
import { formatMoney } from '../../../lib/format-money';
import type { SyncItem } from '../../../lib/sync-check-types';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { relinkMatch } from '@/lib/matches.api';
import { Alert } from '../ui/alert';
import { Button } from '../ui/button';
import { Dialog } from '../ui/dialog';
import { DialogShell } from '../ui/dialog-shell';
import { OptionCards } from '../ui/option-cards';
import { relinkDialogMessages } from './RelinkDialog.messages';
import { orderRelinkItems } from './relink-order';

export interface RelinkDialogProps {
  matchId: string;
  /** Name of the surviving item. */
  name: string;
  /** The side that lost its item. */
  missingSide: 'wallos' | 'actual';
  /** Every unlinked item on the missing side (unmappable ones included). */
  items: readonly SyncItem[];
  candidateIds: readonly string[];
  baseCurrency: string;
  onClose: () => void;
  /** Called after the server accepted the relink; the caller re-checks. */
  onLinked: () => void;
  fetchImpl?: typeof fetch;
}

/** Lists the unlinked items on the missing side (suggested first) and relinks the orphan to the chosen one. */
export function RelinkDialog(props: RelinkDialogProps) {
  const { t, errorText, locale } = useT(relinkDialogMessages);
  const ordered = orderRelinkItems(props.items, props.candidateIds);
  const [itemId, setItemId] = useState(ordered[0]?.item.id ?? '');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const sideName = t(`sides.${props.missingSide}`);

  const submit = () => {
    if (itemId === '' || pending) return;
    setPending(true);
    setFailure(null);
    relinkMatch(props.matchId, itemId, props.fetchImpl).then(
      () => {
        setPending(false);
        props.onLinked();
        props.onClose();
      },
      (err: unknown) => {
        setPending(false);
        setFailure(err instanceof ApiError ? err.code : 'request_failed');
      },
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) props.onClose();
      }}
    >
      <DialogShell
        title={t('title')}
        description={t('description', { name: props.name, side: sideName })}
        footer={
          <>
            <Button type="button" variant="outline" className="min-h-(--control-h)" disabled={pending} onClick={props.onClose}>
              {t('cancel')}
            </Button>
            <Button type="button" className="min-h-(--control-h)" disabled={itemId === '' || pending} aria-busy={pending} onClick={submit}>
              {pending ? t('linking') : t('submit')}
            </Button>
          </>
        }
      >
        <div className="grid gap-3 text-sm">
          {ordered.length === 0 ? (
            <p className="text-muted">{t('none')}</p>
          ) : (
            <OptionCards
              aria-label={t('options')}
              value={itemId}
              onValueChange={setItemId}
              options={ordered.map(({ item, suggested }) => {
                const label =
                  item.amountCents === null
                    ? t('optionNoAmount', { name: item.name })
                    : t('option', { name: item.name, amount: formatMoney(item.amountCents, props.baseCurrency, locale) });
                return { value: item.id, label: suggested ? t('suggested', { label }) : label };
              })}
            />
          )}
          {failure !== null ? (
            <Alert variant="error">{t('failed', { reason: errorText(failure), code: failure })}</Alert>
          ) : null}
        </div>
      </DialogShell>
    </Dialog>
  );
}

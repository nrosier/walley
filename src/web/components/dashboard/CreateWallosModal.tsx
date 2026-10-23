import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { prefillWallosSubscription, type WallosSubscriptionPrefill } from '@/lib/create.api';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { createModalMessages } from './CreateModal.messages';
import { cycleKey } from './create-modal-shared';

/** The pre-fill and a Submit that stays disabled while creating is held. */
export function CreateWallosForm({ prefill }: { prefill: WallosSubscriptionPrefill }) {
  const { t } = useT(createModalMessages);
  const cycle = cycleKey(prefill.cycle, prefill.frequency);
  return (
    <form
      className="grid gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{t('wallos.name')}</dt>
        <dd>{prefill.name}</dd>
        <dt className="text-muted-foreground">{t('wallos.price')}</dt>
        <dd className="font-mono">
          {prefill.price} {prefill.currencyCode}
        </dd>
        <dt className="text-muted-foreground">{t('wallos.cycle')}</dt>
        <dd>{t(cycle.key, { n: cycle.n })}</dd>
        <dt className="text-muted-foreground">{t('wallos.startDate')}</dt>
        <dd className="font-mono">{prefill.startDate ?? prefill.nextPayment}</dd>
      </dl>
      <p className="text-xs text-muted-foreground">{t('held')}</p>
      <Button type="submit" size="sm" disabled title={t('held')} aria-label={`${t('submit')}. ${t('held')}`}>
        {t('submit')}
      </Button>
    </form>
  );
}

export interface CreateWallosModalProps {
  scheduleId: string;
  scheduleName: string;
  onClose: () => void;
  fetchImpl?: typeof fetch;
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; code: string }
  | { status: 'ready'; prefill: WallosSubscriptionPrefill };

/** Opened from an Actual schedule. Loads the read-only pre-fill and never calls a create route. */
export function CreateWallosModal(props: CreateWallosModalProps) {
  const { t, errorText } = useT(createModalMessages);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const { scheduleId, fetchImpl } = props;

  useEffect(() => {
    const ctl = new AbortController();
    prefillWallosSubscription(scheduleId, fetchImpl, ctl.signal).then(
      (prefill) => { setLoad({ status: 'ready', prefill }); },
      (err: unknown) => {
        if (ctl.signal.aborted) return;
        setLoad({ status: 'error', code: err instanceof ApiError ? err.code : 'request_failed' });
      },
    );
    return () => { ctl.abort(); };
  }, [scheduleId, fetchImpl]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('wallos.title')}</DialogTitle>
          <DialogDescription>{t('wallos.description', { name: props.scheduleName })}</DialogDescription>
        </DialogHeader>
        {load.status === 'loading' ? <p role="status">{t('loading')}</p> : null}
        {load.status === 'error' ? <p role="alert" className="text-warning">{errorText(load.code)}</p> : null}
        {load.status === 'ready' ? <CreateWallosForm prefill={load.prefill} /> : null}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={props.onClose}>
            {t('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useId, useState } from 'react';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { createWallosSubscription, prefillWallosSubscription, type WallosSubscriptionPrefill } from '@/lib/create.api';
import { syncStore } from '@/lib/sync-check';
import { Alert } from '../ui/alert';
import { SegmentedControl } from '../ui/segmented-control';
import { CreateFooter } from './CreateFooter';
import { CreateModalFrame } from './CreateModalFrame';
import { createModalMessages } from './CreateModal.messages';
import { CYCLE_UNITS, cycleKey, cycleUnit } from './create-modal-shared';
import { performCreate, wallosSubmitDisabled } from './create-submit';

export interface CreateWallosFormProps {
  prefill: WallosSubscriptionPrefill;
  scheduleId: string;
  fetchImpl?: typeof fetch;
  /** Where Cancel and Create render (the modal's pinned footer); see `CreateFooter.host`. */
  footerHost?: HTMLElement | null;
  onCancel?: () => void;
}

/**
 * The pre-fill as read-only display (title, price, billing cycle, start date) until the Wallos create endpoint
 * accepts overrides, so nothing typed can be ignored. Create is locked while the request is in flight.
 */
export function CreateWallosForm({ prefill, scheduleId, fetchImpl, footerHost, onCancel }: CreateWallosFormProps) {
  const { t, errorText } = useT(createModalMessages);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const formId = useId();
  const reasonId = useId();
  const cycle = cycleKey(prefill.cycle, prefill.frequency);
  return (
    <form
      id={formId}
      className="grid gap-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (wallosSubmitDisabled(pending) || created) return;
        setPending(true);
        setErrorCode(null);
        void performCreate(
          () => createWallosSubscription(scheduleId, fetchImpl),
          () => syncStore.run(),
        ).then((outcome) => {
          if (outcome.ok) setCreated(true);
          else setErrorCode(outcome.code);
          setPending(false);
        });
      }}
    >
      <div className="grid gap-1">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 rounded-md border bg-surface-2 p-3">
          <dt className="text-muted">{t('wallos.name')}</dt>
          <dd>{prefill.name}</dd>
          <dt className="text-muted">{t('wallos.price')}</dt>
          <dd className="font-mono">
            {prefill.price} {prefill.currencyCode}
          </dd>
          <dt className="text-muted">{t('wallos.cycle')}</dt>
          <dd className="grid gap-1">
            <SegmentedControl
              aria-label={t('wallos.cycle')}
              value={cycleUnit(prefill.cycle)}
              onValueChange={() => undefined}
              options={CYCLE_UNITS.map((unit) => ({ value: unit, label: t(`wallos.cycleUnit.${unit}`), disabled: true }))}
            />
            <span>{t(cycle.key, { n: cycle.n })}</span>
          </dd>
          <dt className="text-muted">{t('wallos.startDate')}</dt>
          <dd className="font-mono">{prefill.startDate ?? prefill.nextPayment}</dd>
        </dl>
        <p className="text-xs text-muted">{t('readOnlyNote')}</p>
      </div>
      {errorCode !== null ? <Alert variant="error">{errorText(errorCode)}</Alert> : null}
      {created ? <Alert variant="success">{t('done')}</Alert> : null}
      <CreateFooter
        formId={formId}
        reasonId={reasonId}
        cancelLabel={t('cancel')}
        submitLabel={pending ? t('creating') : t('submit')}
        onCancel={onCancel}
        reason={null}
        busy={wallosSubmitDisabled(pending) || created}
        host={footerHost}
      />
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

/** Opened from an Actual schedule. Loads the pre-fill; the create route is called only when the user submits. */
export function CreateWallosModal(props: CreateWallosModalProps) {
  const { t, errorText } = useT(createModalMessages);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const { scheduleId, fetchImpl } = props;
  const [host, setHost] = useState<HTMLElement | null>(null);
  const footerId = useId();

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
    <CreateModalFrame
      title={t('wallos.title')}
      description={t('wallos.description', { name: props.scheduleName })}
      onClose={props.onClose}
      footer={<div ref={setHost} className="flex w-full" />}
    >
      {load.status === 'loading' ? <p role="status">{t('loading')}</p> : null}
      {load.status === 'error' ? <Alert variant="error">{errorText(load.code)}</Alert> : null}
      {load.status === 'ready' ? (
        <CreateWallosForm prefill={load.prefill} scheduleId={scheduleId} fetchImpl={fetchImpl} footerHost={host} onCancel={props.onClose} />
      ) : (
        <CreateFooter
          formId={footerId}
          reasonId={`${footerId}-reason`}
          cancelLabel={t('cancel')}
          submitLabel={t('submit')}
          onCancel={props.onClose}
          reason={load.status === 'error' ? t('loadFailed') : null}
          busy
          host={host}
        />
      )}
    </CreateModalFrame>
  );
}

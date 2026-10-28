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
import { CYCLE_UNITS, FIELD_CLASS, cycleKey, cycleNumberFor, cycleUnit, type CycleUnit } from './create-modal-shared';
import { submitCreate, wallosDisabledReason, wallosEdits, wallosSubmitDisabled, type WallosFormFields } from './create-submit';

export interface CreateWallosFormProps {
  prefill: WallosSubscriptionPrefill;
  scheduleId: string;
  /** Orphaned match the new subscription is attached to (Recreate from Matches); sent in the create body. */
  matchId?: string;
  fetchImpl?: typeof fetch;
  /** Where Cancel and Create render (the modal's pinned footer); see `CreateFooter.host`. */
  footerHost?: HTMLElement | null;
  onCancel?: () => void;
  /** Called once the subscription was created and the dashboard refreshed; the modal closes here. */
  onCreated?: () => void;
}

/**
 * The four pre-filled fields (title, price, billing cycle, start date) are editable (#133); only values changed from the
 * pre-fill are sent, through `buildWallosBody`. Payment method and category are selects, each hidden when Wallos returned no
 * options and sending nothing while on its empty choice. The reason Create is off shows in the footer. Create is locked while
 * the request is in flight.
 */
export function CreateWallosForm({ prefill, scheduleId, matchId, fetchImpl, footerHost, onCancel, onCreated }: CreateWallosFormProps) {
  const { t, errorText } = useT(createModalMessages);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [category, setCategory] = useState('');
  const prefillUnit = cycleUnit(prefill.cycle);
  const [fields, setFields] = useState<WallosFormFields>({
    title: prefill.name,
    price: prefill.price,
    unit: prefillUnit,
    startDate: prefill.startDate ?? prefill.nextPayment,
  });
  const edit = (change: Partial<WallosFormFields>): void => { setFields((f) => ({ ...f, ...change })); };
  const missing = wallosDisabledReason(fields, prefill.currencyCode);
  const reasonText =
    missing === 'title' ? t('wallos.titleInvalid') : missing === 'price' ? t('wallos.priceInvalid') : missing === 'startDate' ? t('wallos.startDateInvalid') : null;
  const formId = useId();
  const reasonId = useId();
  const titleFieldId = useId();
  const priceFieldId = useId();
  const startFieldId = useId();
  const paymentMethodId = useId();
  const categoryId = useId();
  const cycle = cycleKey(cycleNumberFor(fields.unit), prefill.frequency);
  return (
    <form
      id={formId}
      className="grid gap-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (missing !== null || wallosSubmitDisabled(pending) || created) return;
        setPending(true);
        setErrorCode(null);
        void submitCreate(
          () => createWallosSubscription(scheduleId, fetchImpl, undefined, matchId, { paymentMethodId: paymentMethod, categoryId: category, ...wallosEdits(prefill, fields, prefillUnit) }),
          () => syncStore.run(),
          {
            onCreated: () => {
              setCreated(true);
              setPending(false);
              onCreated?.();
            },
            onFailed: (code) => {
              setErrorCode(code);
              setPending(false);
            },
          },
        );
      }}
    >
      <label htmlFor={titleFieldId} className="grid gap-1">
        {t('wallos.name')}
        <input
          id={titleFieldId}
          type="text"
          required
          maxLength={200}
          value={fields.title}
          aria-describedby={missing === 'title' ? reasonId : undefined}
          onChange={(e) => { edit({ title: e.target.value }); }}
          className={FIELD_CLASS}
        />
      </label>
      <label htmlFor={priceFieldId} className="grid gap-1">
        {t('wallos.price')} ({prefill.currencyCode})
        <input
          id={priceFieldId}
          type="text"
          inputMode="decimal"
          required
          value={fields.price}
          aria-describedby={missing === 'price' ? reasonId : undefined}
          onChange={(e) => { edit({ price: e.target.value }); }}
          className={`${FIELD_CLASS} font-mono`}
        />
      </label>
      <div className="grid gap-1">
        <span className="font-medium">{t('wallos.cycle')}</span>
        <SegmentedControl
          aria-label={t('wallos.cycle')}
          value={fields.unit}
          onValueChange={(unit) => { edit({ unit: unit as CycleUnit }); }}
          options={CYCLE_UNITS.map((unit) => ({ value: unit, label: t(`wallos.cycleUnit.${unit}`) }))}
        />
        <span className="text-xs text-muted">{t(cycle.key, { n: cycle.n })}</span>
      </div>
      <label htmlFor={startFieldId} className="grid gap-1">
        {t('wallos.startDate')}
        <input
          id={startFieldId}
          type="date"
          required
          value={fields.startDate}
          aria-describedby={missing === 'startDate' ? reasonId : undefined}
          onChange={(e) => { edit({ startDate: e.target.value }); }}
          className={`${FIELD_CLASS} font-mono`}
        />
      </label>
      {prefill.paymentMethods.length > 0 ? (
        <label htmlFor={paymentMethodId} className="grid gap-1">
          {t('wallos.paymentMethod')}
          <select
            id={paymentMethodId}
            value={paymentMethod}
            onChange={(e) => { setPaymentMethod(e.target.value); }}
            className={FIELD_CLASS}
          >
            <option value="">{t('wallos.paymentMethodNone')}</option>
            {prefill.paymentMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {prefill.categories.length > 0 ? (
        <label htmlFor={categoryId} className="grid gap-1">
          {t('wallos.category')}
          <select id={categoryId} value={category} onChange={(e) => { setCategory(e.target.value); }} className={FIELD_CLASS}>
            <option value="">{t('wallos.categoryNone')}</option>
            {prefill.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {errorCode !== null ? <Alert variant="error">{errorText(errorCode)}</Alert> : null}
      <CreateFooter
        formId={formId}
        reasonId={reasonId}
        cancelLabel={t('cancel')}
        submitLabel={pending ? t('creating') : t('submit')}
        onCancel={onCancel}
        reason={reasonText === null ? null : t('wallos.createDisabled', { reason: reasonText })}
        busy={wallosSubmitDisabled(pending) || created}
        host={footerHost}
      />
    </form>
  );
}

export interface CreateWallosModalProps {
  scheduleId: string;
  scheduleName: string;
  /** Recreate from an orphaned Matches row: the create call repoints this match. */
  matchId?: string;
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
        <CreateWallosForm prefill={load.prefill} scheduleId={scheduleId} matchId={props.matchId} fetchImpl={fetchImpl} footerHost={host} onCancel={props.onClose} onCreated={props.onClose} />
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

import { useEffect, useId, useState } from 'react';
import { formatMoney } from '../../../lib/format-money';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { createActualSchedule, prefillActualSchedule, type ActualSchedulePrefill, type CreateActualScheduleResult } from '@/lib/create.api';
import { createNoticeKinds, noticeStore } from '@/lib/notices';
import { syncStore } from '@/lib/sync-check';
import { Alert } from '../ui/alert';
import { OptionCards } from '../ui/option-cards';
import { CreateFooter } from './CreateFooter';
import { CreateModalFrame } from './CreateModalFrame';
import { RateField } from './RateField';
import { createModalMessages } from './CreateModal.messages';
import { everyKey, FIELD_CLASS } from './create-modal-shared';
import { actualDisabledReason, buildActualBody, NEW_PAYEE, submitCreate } from './create-submit';

export interface CreateActualFormProps {
  prefill: ActualSchedulePrefill;
  wallosId: string;
  fetchImpl?: typeof fetch;
  /** Called after the rate was saved or cleared so the caller can re-fetch the pre-fill. */
  onRateChanged?: () => void;
  /** Where Cancel and Create render (the modal's pinned footer); see `CreateFooter.host`. */
  footerHost?: HTMLElement | null;
  onCancel?: () => void;
  /** Called once the schedule was created and the dashboard refreshed; the modal closes here. */
  onCreated?: (result: CreateActualScheduleResult) => void;
}

/**
 * The pre-fill (read-only until the override backend lands), a payee choice, account and category, and Create.
 * Create needs an account and a payee name; the reason it is off shows in the footer and beside the field.
 */
export function CreateActualForm({ prefill, wallosId, fetchImpl, onRateChanged, footerHost, onCancel, onCreated }: CreateActualFormProps) {
  const { t, errorText, locale } = useT(createModalMessages);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const formId = useId();
  const ids = { newPayee: useId(), account: useId(), category: useId(), reason: useId() };
  const [payee, setPayee] = useState(NEW_PAYEE);
  const [newName, setNewName] = useState(prefill.name);
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const every = everyKey(prefill.recurrence.frequency, prefill.recurrence.interval ?? 1);
  const missing = actualDisabledReason(account, payee, newName);
  const reasonText =
    missing === 'account' ? t('actual.accountRequired') : missing === 'payeeName' ? t('actual.payeeNameRequired') : null;

  return (
    <form
      id={formId}
      className="grid gap-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (missing !== null || pending || created) return;
        setPending(true);
        setErrorCode(null);
        void submitCreate(
          () => createActualSchedule(buildActualBody(wallosId, account, payee, newName, category), fetchImpl),
          () => syncStore.run(),
          {
            onCreated: (result) => {
              setCreated(true);
              setPending(false);
              onCreated?.(result);
            },
            onFailed: (code) => {
              setErrorCode(code);
              setPending(false);
            },
          },
        );
      }}
    >
      <div className="grid gap-1">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border bg-surface-2 p-3">
          <dt className="text-muted">{t('actual.name')}</dt>
          <dd>{prefill.name}</dd>
          <dt className="text-muted">{t('actual.amount')}</dt>
          <dd className="font-mono">{formatMoney(prefill.amountCents, prefill.baseCurrency, locale)}</dd>
          <dt className="text-muted">{t('actual.frequency')}</dt>
          <dd>{t(every.key, { n: every.n })}</dd>
          <dt className="text-muted">{t('actual.startDate')}</dt>
          <dd className="font-mono">{prefill.startDate}</dd>
        </dl>
        <p className="text-xs text-muted">{t('readOnlyNote')}</p>
      </div>
      {prefill.sourceCurrency !== prefill.baseCurrency ? (
        <RateField prefill={prefill} wallosId={wallosId} fetchImpl={fetchImpl} onChanged={onRateChanged} />
      ) : null}
      <div className="grid gap-1">
        <span className="font-medium">{t('actual.payee')}</span>
        <OptionCards
          aria-label={t('actual.payee')}
          value={payee}
          onValueChange={setPayee}
          options={[{ value: NEW_PAYEE, label: t('actual.payeeNew') }, ...prefill.payees.map((p) => ({ value: p.id, label: p.name }))]}
        />
      </div>
      {payee === NEW_PAYEE ? (
        <label htmlFor={ids.newPayee} className="grid gap-1">
          {t('actual.payeeNewName')}
          <input
            id={ids.newPayee}
            type="text"
            value={newName}
            maxLength={200}
            aria-describedby={missing === 'payeeName' ? ids.reason : undefined}
            onChange={(e) => { setNewName(e.target.value); }}
            className={FIELD_CLASS}
          />
          {missing === 'payeeName' ? <span className="text-xs text-muted">{t('actual.payeeNameRequired')}</span> : null}
        </label>
      ) : null}
      <label htmlFor={ids.account} className="grid gap-1">
        {t('actual.account')}
        <select
          id={ids.account}
          required
          value={account}
          onChange={(e) => { setAccount(e.target.value); }}
          className={FIELD_CLASS}
        >
          <option value="">{t('actual.accountPlaceholder')}</option>
          {prefill.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {account === '' ? <span className="text-xs text-muted">{t('actual.accountRequired')}</span> : null}
      </label>
      <label htmlFor={ids.category} className="grid gap-1">
        {t('actual.category')}
        <select id={ids.category} value={category} onChange={(e) => { setCategory(e.target.value); }} className={FIELD_CLASS}>
          <option value="">{t('actual.categoryNone')}</option>
          {prefill.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {errorCode !== null ? <Alert variant="error">{errorText(errorCode)}</Alert> : null}
      <CreateFooter
        formId={formId}
        reasonId={ids.reason}
        cancelLabel={t('cancel')}
        submitLabel={pending ? t('creating') : t('submit')}
        onCancel={onCancel}
        reason={reasonText === null ? null : t('actual.createDisabled', { reason: reasonText })}
        busy={pending || created}
        host={footerHost}
      />
    </form>
  );
}

export interface CreateActualModalProps {
  wallosId: string;
  wallosName: string;
  onClose: () => void;
  fetchImpl?: typeof fetch;
}

type Load = { status: 'loading' } | { status: 'error'; code: string } | { status: 'ready'; prefill: ActualSchedulePrefill };

/** Opened from a Wallos subscription. Loads the pre-fill; the create route is called only when the user submits. */
export function CreateActualModal(props: CreateActualModalProps) {
  const { t, errorText } = useT(createModalMessages);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const { wallosId, fetchImpl } = props;
  const [reloads, setReloads] = useState(0);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const footerId = useId();

  useEffect(() => {
    const ctl = new AbortController();
    prefillActualSchedule(wallosId, fetchImpl, ctl.signal).then(
      (prefill) => { setLoad({ status: 'ready', prefill }); },
      (err: unknown) => {
        if (ctl.signal.aborted) return;
        setLoad({ status: 'error', code: err instanceof ApiError ? err.code : 'request_failed' });
      },
    );
    return () => { ctl.abort(); };
  }, [wallosId, fetchImpl, reloads]);

  return (
    <CreateModalFrame
      title={t('actual.title')}
      description={t('actual.description', { name: props.wallosName })}
      onClose={props.onClose}
      footer={<div ref={setHost} className="flex w-full" />}
    >
      {load.status === 'loading' ? <p role="status">{t('loading')}</p> : null}
      {load.status === 'error' ? <Alert variant="error">{errorText(load.code)}</Alert> : null}
      {load.status === 'ready' ? (
        <CreateActualForm
          prefill={load.prefill}
          wallosId={wallosId}
          fetchImpl={fetchImpl}
          onRateChanged={() => { setReloads((n) => n + 1); }}
          footerHost={host}
          onCancel={props.onClose}
          onCreated={(result) => {
            noticeStore.push(createNoticeKinds(result));
            props.onClose();
          }}
        />
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

import { useEffect, useId, useState } from 'react';
import { formatMoney } from '../../../lib/format-money';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { createActualSchedule, prefillActualSchedule, type ActualSchedulePrefill, type CreateActualScheduleResult } from '@/lib/create.api';
import { syncStore } from '@/lib/sync-check';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { RateField } from './RateField';
import { createModalMessages } from './CreateModal.messages';
import { everyKey, FIELD_CLASS } from './create-modal-shared';
import { actualSubmitDisabled, buildActualBody, NEW_PAYEE, performCreate } from './create-submit';

export interface CreateActualFormProps {
  prefill: ActualSchedulePrefill;
  wallosId: string;
  fetchImpl?: typeof fetch;
  /** Called after the rate was saved or cleared so the caller can re-fetch the pre-fill. */
  onRateChanged?: () => void;
}

/** The pre-fill, three dropdowns and a Submit that needs an account and is locked while in flight. */
export function CreateActualForm({ prefill, wallosId, fetchImpl, onRateChanged }: CreateActualFormProps) {
  const { t, errorText, locale } = useT(createModalMessages);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<CreateActualScheduleResult | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const ids = { payee: useId(), newPayee: useId(), account: useId(), category: useId() };
  const [payee, setPayee] = useState(NEW_PAYEE);
  const [newName, setNewName] = useState(prefill.name);
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  const every = everyKey(prefill.recurrence.frequency, prefill.recurrence.interval ?? 1);

  return (
    <form
      className="grid gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        if (actualSubmitDisabled(account, pending) || created !== null) return;
        setPending(true);
        setErrorCode(null);
        void performCreate(
          () => createActualSchedule(buildActualBody(wallosId, account, payee, newName, category), fetchImpl),
          () => syncStore.run(),
        ).then((outcome) => {
          if (outcome.ok) setCreated(outcome.result);
          else setErrorCode(outcome.code);
          setPending(false);
        });
      }}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{t('actual.name')}</dt>
        <dd>{prefill.name}</dd>
        <dt className="text-muted-foreground">{t('actual.amount')}</dt>
        <dd className="font-mono">{formatMoney(prefill.amountCents, prefill.baseCurrency, locale)}</dd>
        <dt className="text-muted-foreground">{t('actual.frequency')}</dt>
        <dd>{t(every.key, { n: every.n })}</dd>
        <dt className="text-muted-foreground">{t('actual.startDate')}</dt>
        <dd className="font-mono">{prefill.startDate}</dd>
      </dl>
      {prefill.sourceCurrency !== prefill.baseCurrency ? (
        <RateField prefill={prefill} wallosId={wallosId} fetchImpl={fetchImpl} onChanged={onRateChanged} />
      ) : null}
      <label htmlFor={ids.payee} className="grid gap-1">
        {t('actual.payee')}
        <select id={ids.payee} value={payee} onChange={(e) => { setPayee(e.target.value); }} className={FIELD_CLASS}>
          <option value={NEW_PAYEE}>{t('actual.payeeNew')}</option>
          {prefill.payees.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {payee === NEW_PAYEE ? (
        <label htmlFor={ids.newPayee} className="grid gap-1">
          {t('actual.payeeNewName')}
          <input
            id={ids.newPayee}
            type="text"
            value={newName}
            maxLength={200}
            onChange={(e) => { setNewName(e.target.value); }}
            className={FIELD_CLASS}
          />
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
        {account === '' ? <span className="text-xs text-muted-foreground">{t('actual.accountRequired')}</span> : null}
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
      {errorCode !== null ? <p role="alert" className="text-warning">{errorText(errorCode)}</p> : null}
      {created !== null ? (
        <div role="status" className="grid gap-1">
          <p>{t('done')}</p>
          {created.payeeCreated ? <p>{t('actual.payeeCreated')}</p> : null}
          {created.categoryError === true ? <p className="text-warning">{t('actual.categoryError')}</p> : null}
        </div>
      ) : null}
      <Button
        type="submit"
        size="sm"
        disabled={actualSubmitDisabled(account, pending) || created !== null || (payee === NEW_PAYEE && newName.trim() === '')}
      >
        {pending ? t('creating') : t('submit')}
      </Button>
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
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('actual.title')}</DialogTitle>
          <DialogDescription>{t('actual.description', { name: props.wallosName })}</DialogDescription>
        </DialogHeader>
        {load.status === 'loading' ? <p role="status">{t('loading')}</p> : null}
        {load.status === 'error' ? <p role="alert" className="text-warning">{errorText(load.code)}</p> : null}
        {load.status === 'ready' ? <CreateActualForm prefill={load.prefill} wallosId={wallosId} fetchImpl={fetchImpl} onRateChanged={() => { setReloads((n) => n + 1); }} /> : null}
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={props.onClose}>
            {t('cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

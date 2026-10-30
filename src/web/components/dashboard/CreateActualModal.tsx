import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { Popover } from 'radix-ui';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import { createActualSchedule, prefillActualSchedule, type ActualSchedulePrefill, type CreateActualScheduleResult } from '@/lib/create.api';
import { createNoticeKinds, noticeStore } from '@/lib/notices';
import { syncStore } from '@/lib/sync-check';
import { Alert } from '../ui/alert';
import { CreateFooter } from './CreateFooter';
import { CreateModalFrame } from './CreateModalFrame';
import { RateField } from './RateField';
import { createModalMessages } from './CreateModal.messages';
import { everyKey, FIELD_CLASS } from './create-modal-shared';
import { actualDisabledReason, actualEdits, actualFieldsReason, actualFieldValues, buildActualBody, filterPayees, NEW_PAYEE, submitCreate, type ActualFormFields } from './create-submit';

interface PayeePickerProps {
  payees: ActualSchedulePrefill['payees'];
  value: string;
  onValueChange: (value: string) => void;
}

/**
 * Payee choice: a button that opens a searchable list. The search box takes focus on open; arrows move the highlight,
 * Enter selects, Escape closes and Radix returns focus to the button. "Create new payee" is always the first option.
 */
function PayeePicker({ payees, value, onValueChange }: PayeePickerProps) {
  const { t } = useT(createModalMessages);
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const valueId = `${baseId}-value`;
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-option-${String(i)}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const newLabel = t('actual.payeeNew');
  const matches = filterPayees(payees, query);
  const options = [{ id: NEW_PAYEE, name: newLabel }, ...matches];
  const selectedName = payees.find((p) => p.id === value)?.name ?? newLabel;

  const choose = (id: string): void => {
    onValueChange(id);
    setOpen(false);
  };
  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    setQuery('');
    // Highlight the current choice on open; NEW_PAYEE is index 0, payees follow it.
    setActive(next ? payees.findIndex((p) => p.id === value) + 1 : 0);
  };
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = options[active];
      if (option !== undefined) choose(option.id);
    }
  };

  return (
    <div className="grid gap-1">
      <span id={labelId} className="font-medium">{t('actual.payee')}</span>
      <Popover.Root open={open} onOpenChange={handleOpenChange}>
        <Popover.Trigger
          aria-labelledby={`${labelId} ${valueId}`}
          className={`${FIELD_CLASS} flex items-center justify-between text-left`}
        >
          <span id={valueId} className="min-w-0 truncate">{selectedName}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 grid w-(--radix-popover-trigger-width) max-w-[90vw] gap-2 rounded-md border bg-card p-2 text-sm shadow-overlay"
          >
            <input
              type="text"
              autoFocus
              role="combobox"
              aria-label={t('actual.payeeSearch')}
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={optionId(active)}
              autoComplete="off"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={t('actual.payeeSearch')}
              className={FIELD_CLASS}
            />
            <div id={listId} role="listbox" aria-labelledby={labelId} className="grid max-h-56 gap-0.5 overflow-y-auto">
              {options.map((option, i) => (
                <div
                  key={option.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={option.id === value}
                  data-active={i === active ? '' : undefined}
                  onMouseEnter={() => { setActive(i); }}
                  onClick={() => { choose(option.id); }}
                  className="min-w-0 cursor-pointer break-words rounded-sm px-2 py-1.5 data-[active]:bg-hover"
                >
                  {option.name}
                </div>
              ))}
            </div>
            {matches.length === 0 ? <p className="px-1 text-xs text-muted">{t('actual.payeeNoMatch')}</p> : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}

export interface CreateActualFormProps {
  prefill: ActualSchedulePrefill;
  wallosId: string;
  /** Orphaned match the new schedule is attached to (Recreate from Matches); sent in the create body. */
  matchId?: string;
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
 * Name, amount (in the budget's base currency) and start date are editable, pre-filled (#135); only values changed from the
 * pre-fill are sent, through `actualEdits`. The frequency stays read-only. Then a payee choice, account and category, and Create.
 * Create needs valid edited fields, an account and a payee name; the reason it is off shows in the footer and beside the field.
 */
export function CreateActualForm({ prefill, wallosId, matchId, fetchImpl, onRateChanged, footerHost, onCancel, onCreated }: CreateActualFormProps) {
  const { t, errorText } = useT(createModalMessages);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const formId = useId();
  const ids = { name: useId(), amount: useId(), startDate: useId(), newPayee: useId(), account: useId(), category: useId(), reason: useId() };
  const [payee, setPayee] = useState(NEW_PAYEE);
  const [newName, setNewName] = useState(prefill.name);
  const [account, setAccount] = useState('');
  const [category, setCategory] = useState('');
  // Untouched fields stay undefined, so a re-fetched pre-fill (after a rate change) shows through.
  const [fields, setFields] = useState<ActualFormFields>({});
  const edit = (change: ActualFormFields): void => { setFields((f) => ({ ...f, ...change })); };
  const shown = actualFieldValues(prefill, fields);
  const every = everyKey(prefill.recurrence.frequency, prefill.recurrence.interval ?? 1);
  const missing = actualFieldsReason(prefill, fields) ?? actualDisabledReason(account, payee, newName);
  const REASONS = {
    name: t('actual.nameInvalid'),
    amount: t('actual.amountInvalid'),
    startDate: t('actual.startDateInvalid'),
    account: t('actual.accountRequired'),
    payeeName: t('actual.payeeNameRequired'),
  } as const;
  const reasonText = missing === null ? null : REASONS[missing];

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
          () => createActualSchedule(buildActualBody(wallosId, account, payee, newName, category, matchId, actualEdits(prefill, fields)), fetchImpl),
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
      <label htmlFor={ids.name} className="grid gap-1">
        {t('actual.name')}
        <input
          id={ids.name}
          type="text"
          required
          maxLength={200}
          value={shown.name}
          aria-describedby={missing === 'name' ? ids.reason : undefined}
          onChange={(e) => { edit({ name: e.target.value }); }}
          className={FIELD_CLASS}
        />
      </label>
      <label htmlFor={ids.amount} className="grid gap-1">
        {t('actual.amount')} ({prefill.baseCurrency})
        <input
          id={ids.amount}
          type="text"
          inputMode="decimal"
          required
          value={shown.amount}
          aria-describedby={missing === 'amount' ? ids.reason : undefined}
          onChange={(e) => { edit({ amount: e.target.value }); }}
          className={`${FIELD_CLASS} font-mono`}
        />
      </label>
      <dl className="grid gap-1">
        <dt className="font-medium">{t('actual.frequency')}</dt>
        <dd>{t(every.key, { n: every.n })}</dd>
      </dl>
      <label htmlFor={ids.startDate} className="grid gap-1">
        {t('actual.startDate')}
        <input
          id={ids.startDate}
          type="date"
          required
          value={shown.startDate}
          aria-describedby={missing === 'startDate' ? ids.reason : undefined}
          onChange={(e) => { edit({ startDate: e.target.value }); }}
          className={`${FIELD_CLASS} font-mono`}
        />
      </label>
      {prefill.sourceCurrency !== prefill.baseCurrency ? (
        <RateField prefill={prefill} wallosId={wallosId} fetchImpl={fetchImpl} onChanged={onRateChanged} />
      ) : null}
      <PayeePicker payees={prefill.payees} value={payee} onValueChange={setPayee} />
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
  /** Recreate from an orphaned Matches row: the create call repoints this match. */
  matchId?: string;
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
          matchId={props.matchId}
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

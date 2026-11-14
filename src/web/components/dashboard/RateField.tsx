import { useId, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import type { ActualSchedulePrefill } from '@/lib/create.api';
import { clearOverride, saveOverride } from '@/lib/overrides.api';
import { Button } from '../ui/button';
import { createModalMessages } from './CreateModal.messages';
import { FIELD_CLASS } from './create-modal-shared';

/** The rate fields RateField reads. `wallosRate` undefined means "not known here": the Wallos rate help is left out. */
type RateFieldPrefill = Pick<ActualSchedulePrefill, 'sourceCurrency' | 'baseCurrency' | 'overrideRate'> & {
  wallosRate?: string | null;
};

export interface RateFieldProps {
  prefill: RateFieldPrefill;
  wallosId: string;
  fetchImpl?: typeof fetch;
  onChanged?: () => void;
  /** Replaces the default "Rate (X to Y)" label, for a place that shows a different rate next to this field. */
  label?: string;
  labelClassName?: string;
  /** Another action of the owner is running: the input, Save and Clear lock like during a rate save. */
  locked?: boolean;
  /** Called with true while a rate save or clear is pending, so the owner can lock its own actions. */
  onBusyChange?: (busy: boolean) => void;
}

/** Manual rate for a foreign-currency subscription. Save calls PUT, Clear calls DELETE, then the caller re-fetches the pre-fill. */
export function RateField({ prefill, wallosId, fetchImpl, onChanged, label, labelClassName, locked = false, onBusyChange }: RateFieldProps) {
  const { t, errorText } = useT(createModalMessages);
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const [value, setValue] = useState(prefill.overrideRate ?? '');
  const [pending, setPending] = useState(false);
  const setBusy = (b: boolean) => { setPending(b); onBusyChange?.(b); };
  // One signal for the lock: this field's own request, or an action of the owner (a resolve).
  const busy = pending || locked;
  const [errorCode, setErrorCode] = useState<string | null>(null);

  // Blocks a second activation in the same tick, before the busy state has rendered.
  const inFlight = useRef(false);

  const run = (action: () => Promise<unknown>, after: () => void) => {
    if (inFlight.current || locked) return;
    inFlight.current = true;
    setBusy(true);
    setErrorCode(null);
    action().then(
      () => { after(); onChanged?.(); inFlight.current = false; setBusy(false); },
      (err: unknown) => {
        setErrorCode(err instanceof ApiError ? err.code : 'request_failed');
        inFlight.current = false;
        setBusy(false);
      },
    );
  };
  const save = () => {
    if (value.trim() === '') return;
    run(() => saveOverride(wallosId, value.trim(), fetchImpl), () => undefined);
  };
  const clear = () => {
    run(() => clearOverride(wallosId, fetchImpl), () => { setValue(''); });
  };
  const hasOverride = prefill.overrideRate !== null;
  const help =
    prefill.wallosRate === undefined
      ? ''
      : prefill.wallosRate !== null
        ? t('actual.rate.wallosHelp', { rate: prefill.wallosRate })
        : t('actual.rate.wallosNone');

  return (
    <div className="grid gap-1">
      <label htmlFor={inputId} className={labelClassName}>
        {label ?? t('actual.rate.label', { from: prefill.sourceCurrency, to: prefill.baseCurrency })}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={prefill.wallosRate ?? ''}
          // readOnly, not disabled: a disabled input that has focus drops it to the body while the request runs.
          readOnly={busy}
          aria-readonly={busy}
          aria-busy={busy}
          aria-invalid={errorCode === 'invalid_rate'}
          aria-describedby={errorCode === null ? helpId : `${helpId} ${errorId}`}
          onChange={(e) => { if (!busy) setValue(e.target.value); }}
          // Enter saves. No <form> here: this field also sits inside the Create modal's form, and forms cannot nest.
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
            e.preventDefault();
            save();
          }}
          className={`${FIELD_CLASS} w-32 font-mono`}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-(--control-h)"
          // aria-disabled, not disabled (as CreateFooter does): the button keeps focus while busy and after a failure.
          aria-disabled={busy || value.trim() === ''}
          aria-busy={busy}
          onClick={save}
        >
          {pending ? t('actual.rate.saving') : t('actual.rate.save')}
        </Button>
        {hasOverride ? (
          <Button type="button" size="sm" variant="outline" className="min-h-(--control-h)" aria-disabled={busy} onClick={clear}>
            {t('actual.rate.clear')}
          </Button>
        ) : null}
      </div>
      <span id={helpId} className="text-xs text-muted">
        {hasOverride ? `${t('actual.rate.overridden')} ` : ''}
        {help}
      </span>
      {errorCode !== null ? (
        <p id={errorId} role="alert" className="text-xs text-danger">{errorText(errorCode)}</p>
      ) : null}
    </div>
  );
}

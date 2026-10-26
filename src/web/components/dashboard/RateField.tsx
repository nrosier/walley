import { useId, useState } from 'react';
import { useT } from '@/i18n';
import { ApiError } from '@/lib/api';
import type { ActualSchedulePrefill } from '@/lib/create.api';
import { clearOverride, saveOverride } from '@/lib/overrides.api';
import { Button } from '../ui/button';
import { createModalMessages } from './CreateModal.messages';
import { FIELD_CLASS } from './create-modal-shared';

export interface RateFieldProps {
  prefill: ActualSchedulePrefill;
  wallosId: string;
  fetchImpl?: typeof fetch;
  onChanged?: () => void;
}

/** Manual rate for a foreign-currency subscription. Save calls PUT, Clear calls DELETE, then the caller re-fetches the pre-fill. */
export function RateField({ prefill, wallosId, fetchImpl, onChanged }: RateFieldProps) {
  const { t, errorText } = useT(createModalMessages);
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();
  const [value, setValue] = useState(prefill.overrideRate ?? '');
  const [busy, setBusy] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const run = (action: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setErrorCode(null);
    action().then(
      () => { after(); onChanged?.(); setBusy(false); },
      (err: unknown) => {
        setErrorCode(err instanceof ApiError ? err.code : 'request_failed');
        setBusy(false);
      },
    );
  };
  const hasOverride = prefill.overrideRate !== null;
  const help =
    prefill.wallosRate !== null ? t('actual.rate.wallosHelp', { rate: prefill.wallosRate }) : t('actual.rate.wallosNone');

  return (
    <div className="grid gap-1">
      <label htmlFor={inputId}>
        {t('actual.rate.label', { from: prefill.sourceCurrency, to: prefill.baseCurrency })}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={value}
          placeholder={prefill.wallosRate ?? ''}
          disabled={busy}
          aria-invalid={errorCode === 'invalid_rate'}
          aria-describedby={errorCode === null ? helpId : `${helpId} ${errorId}`}
          onChange={(e) => { setValue(e.target.value); }}
          className={`${FIELD_CLASS} w-32 font-mono`}
        />
        <Button type="button" size="sm" variant="outline" className="min-h-(--control-h)" disabled={busy || value.trim() === ''} onClick={() => { run(() => saveOverride(wallosId, value.trim(), fetchImpl), () => undefined); }}>
          {busy ? t('actual.rate.saving') : t('actual.rate.save')}
        </Button>
        {hasOverride ? (
          <Button type="button" size="sm" variant="outline" className="min-h-(--control-h)" disabled={busy} onClick={() => { run(() => clearOverride(wallosId, fetchImpl), () => { setValue(''); }); }}>
            {t('actual.rate.clear')}
          </Button>
        ) : null}
      </div>
      <span id={helpId} className="text-xs text-muted">
        {hasOverride ? `${t('actual.rate.overridden')} ` : ''}
        {help}
      </span>
      {errorCode !== null ? (
        <p id={errorId} role="alert" className="text-xs text-warning">{errorText(errorCode)}</p>
      ) : null}
    </div>
  );
}

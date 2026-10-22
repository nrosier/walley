import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/i18n';
import { ApiError, apiRequest } from '@/lib/api';
import { matchingSettingsMessages } from './MatchingSettings.messages';
import { settingsPageMessages } from './SettingsPage.messages';

/** Used while loading and when the user has no saved value. Matches the server default. */
export const DEFAULT_TOLERANCE_PERCENT = 5;
export const MIN_TOLERANCE_PERCENT = 0;
export const MAX_TOLERANCE_PERCENT = 50;

const ENDPOINT = '/api/settings/matching';
const SLIDER_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];

const FIELD =
  'h-9 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

/** The value as a number when it is finite and within 0 to 50 inclusive; otherwise null. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests
export function parseTolerance(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < MIN_TOLERANCE_PERCENT || value > MAX_TOLERANCE_PERCENT) return null;
  return value;
}

export type SaveOutcome =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'saved'; readonly value: number }
  | { readonly kind: 'error'; readonly code: string };

interface MatchingResponse {
  tolerancePercent: number;
}

/** GET the saved tolerance. Throws ApiError or a network error on failure. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests with a fake fetch
export async function loadTolerance(opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<number> {
  const data = await apiRequest<MatchingResponse>(ENDPOINT, opts);
  return data.tolerancePercent;
}

/** PUT the tolerance. Invalid input never reaches the network. Server errors come back as a code. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests with a fake fetch
export async function saveTolerance(raw: string, fetchImpl?: typeof fetch): Promise<SaveOutcome> {
  const value = parseTolerance(raw);
  if (value === null) return { kind: 'invalid' };
  try {
    const data = await apiRequest<MatchingResponse>(ENDPOINT, {
      method: 'PUT',
      body: { tolerancePercent: value },
      fetchImpl,
    });
    return { kind: 'saved', value: data.tolerancePercent };
  } catch (error: unknown) {
    return { kind: 'error', code: error instanceof ApiError ? error.code : 'request_failed' };
  }
}

export type MatchingStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface MatchingSettingsViewProps {
  /** Shared state: the number input shows this text. */
  text: string;
  /** Shared state: the slider shows the last valid value. */
  sliderValue: number;
  /** Show the inline range error under the input. */
  invalid: boolean;
  status: MatchingStatus;
  /** Resolved message for the error status. */
  message?: string;
  onTextChange?: (raw: string) => void;
  onCommit?: (raw: string) => void;
}

/** Presentational control. Input and slider share one value; each commit saves through onCommit. */
export function MatchingSettingsView(props: MatchingSettingsViewProps) {
  const { t } = useT(matchingSettingsMessages);
  const { t: tSettings } = useT(settingsPageMessages);
  const inputId = 'matching-tolerance-input';
  const labelId = 'matching-tolerance-label';
  const errorId = 'matching-tolerance-error';
  const hintId = 'matching-tolerance-hint';

  const statusText =
    props.status === 'saving'
      ? t('status.saving')
      : props.status === 'saved'
        ? t('status.saved')
        : props.status === 'error'
          ? (props.message ?? '')
          : '';

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      props.onCommit?.(event.currentTarget.value);
    }
  };

  return (
    <section className="max-w-md space-y-3" aria-labelledby="matching-settings-heading">
      <h2 id="matching-settings-heading" className="text-sm font-semibold">
        {tSettings('sections.matching')}
      </h2>
      <div className="space-y-1">
        <label id={labelId} htmlFor={inputId} className="text-xs font-medium">
          {t('label')}
        </label>
        <div className="flex items-center gap-3">
          <input
            id={inputId}
            name="tolerancePercent"
            type="number"
            inputMode="numeric"
            min={MIN_TOLERANCE_PERCENT}
            max={MAX_TOLERANCE_PERCENT}
            step={1}
            className={`${FIELD} w-24 ${props.invalid ? 'border-warning' : 'border-border'}`}
            value={props.text}
            aria-invalid={props.invalid}
            aria-describedby={props.invalid ? `${errorId} ${hintId}` : hintId}
            onChange={(e) => props.onTextChange?.(e.target.value)}
            onBlur={(e) => props.onCommit?.(e.currentTarget.value)}
            onKeyDown={onInputKey}
          />
          <span className="text-xs text-muted-foreground">{t('unit')}</span>
        </div>
        <input
          type="range"
          aria-labelledby={labelId}
          aria-describedby={hintId}
          min={MIN_TOLERANCE_PERCENT}
          max={MAX_TOLERANCE_PERCENT}
          step={1}
          className="h-11 w-full accent-primary"
          value={props.sliderValue}
          onChange={(e) => props.onTextChange?.(e.target.value)}
          onPointerUp={(e) => props.onCommit?.(e.currentTarget.value)}
          onKeyUp={(e) => {
            if (SLIDER_KEYS.includes(e.key)) props.onCommit?.(e.currentTarget.value);
          }}
        />
        <p id={hintId} className="text-xs text-muted-foreground">
          {t('hint')}
        </p>
        {props.invalid ? (
          <p id={errorId} className="text-xs text-warning">
            {t('range', { min: MIN_TOLERANCE_PERCENT, max: MAX_TOLERANCE_PERCENT })}
          </p>
        ) : null}
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-xs">
        {statusText}
      </p>
    </section>
  );
}

/** Matching settings: one tolerance value (0 to 50 percent) saved on commit. */
export function MatchingSettings() {
  const { errorText } = useT(matchingSettingsMessages);
  const [text, setText] = useState(String(DEFAULT_TOLERANCE_PERCENT));
  const [sliderValue, setSliderValue] = useState(DEFAULT_TOLERANCE_PERCENT);
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<MatchingStatus>('idle');
  const [message, setMessage] = useState('');
  const savedRef = useRef(DEFAULT_TOLERANCE_PERCENT);

  useEffect(() => {
    const controller = new AbortController();
    loadTolerance({ signal: controller.signal })
      .then((value) => {
        savedRef.current = value;
        setText(String(value));
        setSliderValue(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setStatus('error');
          setMessage(errorText('request_failed'));
        }
      });
    return () => {
      controller.abort();
    };
  }, [errorText]);

  const onTextChange = (raw: string) => {
    setText(raw);
    const value = parseTolerance(raw);
    if (value !== null) setSliderValue(value);
  };

  const onCommit = (raw: string) => {
    setTouched(true);
    const value = parseTolerance(raw);
    if (value === null || value === savedRef.current) return;
    setStatus('saving');
    setMessage('');
    void saveTolerance(raw).then((outcome) => {
      if (outcome.kind === 'saved') {
        savedRef.current = outcome.value;
        setText(String(outcome.value));
        setSliderValue(outcome.value);
        setStatus('saved');
      } else if (outcome.kind === 'error') {
        setStatus('error');
        setMessage(errorText(outcome.code));
      }
    });
  };

  return (
    <MatchingSettingsView
      text={text}
      sliderValue={sliderValue}
      invalid={touched && parseTolerance(text) === null}
      status={status}
      message={message}
      onTextChange={onTextChange}
      onCommit={onCommit}
    />
  );
}

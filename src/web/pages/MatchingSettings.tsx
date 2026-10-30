import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { SaveFooter, SettingsCard } from '@/components/settings/SettingsCard';
import { useT } from '@/i18n';
import { ApiError, apiRequest } from '@/lib/api';
import { matchingSettingsMessages } from './MatchingSettings.messages';
import { settingsPageMessages } from './SettingsPage.messages';

/** Used while loading and when the user has no saved value. Matches the server default. */
export const DEFAULT_TOLERANCE_PERCENT = 5;
export const MIN_TOLERANCE_PERCENT = 0;
export const MAX_TOLERANCE_PERCENT = 50;

const ENDPOINT = '/api/settings/matching';

const FIELD =
  'min-h-(--control-h) w-full rounded-md border bg-background px-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

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
  /** The value differs from the saved one. */
  dirty?: boolean;
  onTextChange?: (raw: string) => void;
  /** The card's Save (footer button or Enter in the input). */
  onCommit?: (raw: string) => void;
}

/** Presentational control. Input and slider share one value; the footer Save sends it through onCommit. */
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

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    props.onCommit?.(props.text);
  };

  return (
    <SettingsCard
      id="settings-matching"
      headingId="matching-settings-heading"
      title={tSettings('sections.matching')}
      scope="account"
      footer={
        <SaveFooter
          formId="matching-settings-form"
          dirty={props.dirty === true}
          busy={props.status === 'saving'}
          label={props.status === 'saving' ? t('status.saving') : t('save')}
        />
      }
    >
      <form id="matching-settings-form" onSubmit={submit} className="max-w-md space-y-3" aria-labelledby="matching-settings-heading">
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
              className={`${FIELD} w-24 ${props.invalid ? 'border-danger-line' : 'border-input-border'}`}
              value={props.text}
              aria-invalid={props.invalid}
              aria-describedby={props.invalid ? `${errorId} ${hintId}` : hintId}
              onChange={(e) => props.onTextChange?.(e.target.value)}
            />
            <span className="text-xs text-muted">{t('unit')}</span>
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
          />
          <p id={hintId} className="text-xs text-muted">
            {t('hint')}
          </p>
          {props.invalid ? (
            <p id={errorId} className="text-xs text-danger">
              {t('range', { min: MIN_TOLERANCE_PERCENT, max: MAX_TOLERANCE_PERCENT })}
            </p>
          ) : null}
        </div>
        <p role="status" aria-live="polite" className="min-h-4 text-xs">
          {statusText}
        </p>
      </form>
    </SettingsCard>
  );
}

/** Matching settings: one tolerance value (0 to 50 percent) saved by the card's Save. */
export function MatchingSettings() {
  const { errorText } = useT(matchingSettingsMessages);
  const [text, setText] = useState(String(DEFAULT_TOLERANCE_PERCENT));
  const [sliderValue, setSliderValue] = useState(DEFAULT_TOLERANCE_PERCENT);
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<MatchingStatus>('idle');
  const [message, setMessage] = useState('');
  const savedRef = useRef(DEFAULT_TOLERANCE_PERCENT);
  const [saved, setSaved] = useState(DEFAULT_TOLERANCE_PERCENT);

  useEffect(() => {
    const controller = new AbortController();
    loadTolerance({ signal: controller.signal })
      .then((value) => {
        savedRef.current = value;
        setSaved(value);
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
    if (status === 'saved') setStatus('idle');
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
        setSaved(outcome.value);
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
      dirty={parseTolerance(text) !== saved}
      status={status}
      message={message}
      onTextChange={onTextChange}
      onCommit={onCommit}
    />
  );
}

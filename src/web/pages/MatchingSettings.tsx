import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { SaveFooter, SettingsCard } from '@/components/settings/SettingsCard';
import { useT } from '@/i18n';
import { ApiError, apiRequest } from '@/lib/api';
import {
  CURRENCY_DRIFT_STEP,
  DEFAULT_CURRENCY_DRIFT_PERCENT,
  MAX_CURRENCY_DRIFT_PERCENT,
  MIN_CURRENCY_DRIFT_PERCENT,
} from '../../lib/amount-match';
import { matchingSettingsMessages } from './MatchingSettings.messages';
import { settingsPageMessages } from './SettingsPage.messages';

/** Used while loading and when the user has no saved value. Matches the server default. */
export const DEFAULT_TOLERANCE_PERCENT = 5;
export const MIN_TOLERANCE_PERCENT = 0;
export const MAX_TOLERANCE_PERCENT = 50;

export { DEFAULT_CURRENCY_DRIFT_PERCENT };

const ENDPOINT = '/api/settings/matching';

const FIELD =
  'min-h-(--control-h) rounded-md border bg-background px-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The value as a number when it is finite and within 0 to 50 inclusive; otherwise null. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests
export function parseTolerance(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < MIN_TOLERANCE_PERCENT || value > MAX_TOLERANCE_PERCENT) return null;
  return value;
}

/** The value as a number when it is finite, within 0 to 10 and a multiple of 0.5; otherwise null. Mirrors the server. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests
export function parseCurrencyDrift(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < MIN_CURRENCY_DRIFT_PERCENT || value > MAX_CURRENCY_DRIFT_PERCENT) return null;
  if (!Number.isInteger(value / CURRENCY_DRIFT_STEP)) return null;
  return value;
}

export type SaveOutcome =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'saved'; readonly value: number }
  | { readonly kind: 'error'; readonly code: string };

export interface MatchingValues {
  tolerancePercent: number;
  currencyDriftPercent: number;
}

export type SaveMatchingOutcome =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'saved'; readonly values: MatchingValues }
  | { readonly kind: 'error'; readonly code: string };

/** GET both saved values. Throws ApiError or a network error on failure. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests with a fake fetch
export async function loadMatching(opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<MatchingValues> {
  const data = await apiRequest<MatchingValues>(ENDPOINT, opts);
  return { tolerancePercent: data.tolerancePercent, currencyDriftPercent: data.currencyDriftPercent };
}

/** GET the saved tolerance. Throws ApiError or a network error on failure. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests with a fake fetch
export async function loadTolerance(opts: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {}): Promise<number> {
  return (await loadMatching(opts)).tolerancePercent;
}

/**
 * PUT only the given raw values (a key left out is not sent). Invalid or empty input never reaches the network.
 * Server errors come back as a code.
 */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests with a fake fetch
export async function saveMatching(
  raw: { tolerance?: string; currencyDrift?: string },
  fetchImpl?: typeof fetch,
): Promise<SaveMatchingOutcome> {
  const body: Partial<MatchingValues> = {};
  if (raw.tolerance !== undefined) {
    const value = parseTolerance(raw.tolerance);
    if (value === null) return { kind: 'invalid' };
    body.tolerancePercent = value;
  }
  if (raw.currencyDrift !== undefined) {
    const value = parseCurrencyDrift(raw.currencyDrift);
    if (value === null) return { kind: 'invalid' };
    body.currencyDriftPercent = value;
  }
  if (Object.keys(body).length === 0) return { kind: 'invalid' };
  try {
    const data = await apiRequest<MatchingValues>(ENDPOINT, { method: 'PUT', body, fetchImpl });
    return {
      kind: 'saved',
      values: { tolerancePercent: data.tolerancePercent, currencyDriftPercent: data.currencyDriftPercent },
    };
  } catch (error: unknown) {
    return { kind: 'error', code: error instanceof ApiError ? error.code : 'request_failed' };
  }
}

/** PUT the tolerance alone. Invalid input never reaches the network. Server errors come back as a code. */
// eslint-disable-next-line react-refresh/only-export-components -- exported for tests with a fake fetch
export async function saveTolerance(raw: string, fetchImpl?: typeof fetch): Promise<SaveOutcome> {
  const outcome = await saveMatching({ tolerance: raw }, fetchImpl);
  if (outcome.kind === 'saved') return { kind: 'saved', value: outcome.values.tolerancePercent };
  return outcome;
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
  /** Currency rate margin: the number input shows this text. */
  driftText: string;
  /** Currency rate margin: the slider shows the last valid value. */
  driftSliderValue: number;
  /** Show the inline range error under the margin input. */
  driftInvalid: boolean;
  onDriftTextChange?: (raw: string) => void;
  /** The card's Save (footer button or Enter in an input). */
  onCommit?: () => void;
}

interface PercentControlProps {
  /** Element ids are `${prefix}-input`, `-label`, `-hint` and `-error`. */
  prefix: string;
  name: string;
  label: string;
  hint: string;
  unit: string;
  error: string;
  inputMode: 'numeric' | 'decimal';
  min: number;
  max: number;
  step: number;
  text: string;
  sliderValue: number;
  invalid: boolean;
  onChange?: (raw: string) => void;
}

/** One percent value: label, number input, range slider, hint and inline error wired by aria-describedby. */
function PercentControl(props: PercentControlProps) {
  const inputId = `${props.prefix}-input`;
  const labelId = `${props.prefix}-label`;
  const errorId = `${props.prefix}-error`;
  const hintId = `${props.prefix}-hint`;
  return (
    <div className="space-y-1">
      <label id={labelId} htmlFor={inputId} className="text-xs font-medium">
        {props.label}
      </label>
      <div className="flex items-center gap-3">
        <input
          id={inputId}
          name={props.name}
          type="number"
          inputMode={props.inputMode}
          min={props.min}
          max={props.max}
          step={props.step}
          className={`${FIELD} w-24 ${props.invalid ? 'border-danger-line' : 'border-input-border'}`}
          value={props.text}
          aria-invalid={props.invalid}
          aria-describedby={props.invalid ? `${errorId} ${hintId}` : hintId}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
        <span className="text-xs text-muted">{props.unit}</span>
      </div>
      <input
        type="range"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        min={props.min}
        max={props.max}
        step={props.step}
        className="h-11 w-full accent-primary"
        value={props.sliderValue}
        onChange={(e) => props.onChange?.(e.target.value)}
      />
      <p id={hintId} className="text-xs text-muted">
        {props.hint}
      </p>
      {props.invalid ? (
        <p id={errorId} className="text-xs text-danger">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

/** Presentational control. Input and slider share one value; the footer Save sends it through onCommit. */
export function MatchingSettingsView(props: MatchingSettingsViewProps) {
  const { t, locale } = useT(matchingSettingsMessages);
  const num = (n: number) => new Intl.NumberFormat(locale).format(n);
  const { t: tSettings } = useT(settingsPageMessages);
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
    if (props.status === 'saving') return;
    props.onCommit?.();
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
      <form id="matching-settings-form" noValidate onSubmit={submit} className="max-w-md space-y-3" aria-labelledby="matching-settings-heading">
        <PercentControl
          prefix="matching-tolerance"
          name="tolerancePercent"
          label={t('label')}
          hint={t('hint')}
          unit={t('unit')}
          error={t('range', { min: num(MIN_TOLERANCE_PERCENT), max: num(MAX_TOLERANCE_PERCENT) })}
          inputMode="numeric"
          min={MIN_TOLERANCE_PERCENT}
          max={MAX_TOLERANCE_PERCENT}
          step={1}
          text={props.text}
          sliderValue={props.sliderValue}
          invalid={props.invalid}
          onChange={props.onTextChange}
        />
        <PercentControl
          prefix="matching-drift"
          name="currencyDriftPercent"
          label={t('drift.label')}
          hint={t('drift.hint')}
          unit={t('unit')}
          error={t('drift.range', {
            min: num(MIN_CURRENCY_DRIFT_PERCENT),
            max: num(MAX_CURRENCY_DRIFT_PERCENT),
            step: num(CURRENCY_DRIFT_STEP),
          })}
          inputMode="decimal"
          min={MIN_CURRENCY_DRIFT_PERCENT}
          max={MAX_CURRENCY_DRIFT_PERCENT}
          step={CURRENCY_DRIFT_STEP}
          text={props.driftText}
          sliderValue={props.driftSliderValue}
          invalid={props.driftInvalid}
          onChange={props.onDriftTextChange}
        />
        <p role="status" aria-live="polite" className="min-h-4 text-xs">
          {statusText}
        </p>
      </form>
    </SettingsCard>
  );
}

/** Matching settings: amount tolerance (0 to 50) and currency rate margin (0 to 10), saved by the card's one Save. */
export function MatchingSettings() {
  const { errorText } = useT(matchingSettingsMessages);
  const [text, setText] = useState(String(DEFAULT_TOLERANCE_PERCENT));
  const [sliderValue, setSliderValue] = useState(DEFAULT_TOLERANCE_PERCENT);
  const [driftText, setDriftText] = useState(String(DEFAULT_CURRENCY_DRIFT_PERCENT));
  const [driftSliderValue, setDriftSliderValue] = useState(DEFAULT_CURRENCY_DRIFT_PERCENT);
  const [touched, setTouched] = useState(false);
  const [status, setStatus] = useState<MatchingStatus>('idle');
  const [message, setMessage] = useState('');
  const defaults: MatchingValues = {
    tolerancePercent: DEFAULT_TOLERANCE_PERCENT,
    currencyDriftPercent: DEFAULT_CURRENCY_DRIFT_PERCENT,
  };
  const savedRef = useRef<MatchingValues>(defaults);
  const [saved, setSaved] = useState<MatchingValues>(defaults);

  const apply = (values: MatchingValues) => {
    savedRef.current = values;
    setSaved(values);
    setText(String(values.tolerancePercent));
    setSliderValue(values.tolerancePercent);
    setDriftText(String(values.currencyDriftPercent));
    setDriftSliderValue(values.currencyDriftPercent);
  };

  useEffect(() => {
    const controller = new AbortController();
    loadMatching({ signal: controller.signal })
      .then((values) => {
        savedRef.current = values;
        setSaved(values);
        setText(String(values.tolerancePercent));
        setSliderValue(values.tolerancePercent);
        setDriftText(String(values.currencyDriftPercent));
        setDriftSliderValue(values.currencyDriftPercent);
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

  const onDriftTextChange = (raw: string) => {
    setDriftText(raw);
    if (status === 'saved') setStatus('idle');
    const value = parseCurrencyDrift(raw);
    if (value !== null) setDriftSliderValue(value);
  };

  const onCommit = () => {
    setTouched(true);
    const tolerance = parseTolerance(text);
    const drift = parseCurrencyDrift(driftText);
    if (tolerance === null || drift === null) return;
    const changes: { tolerance?: string; currencyDrift?: string } = {};
    if (tolerance !== savedRef.current.tolerancePercent) changes.tolerance = text;
    if (drift !== savedRef.current.currencyDriftPercent) changes.currencyDrift = driftText;
    if (changes.tolerance === undefined && changes.currencyDrift === undefined) return;
    setStatus('saving');
    setMessage('');
    void saveMatching(changes).then((outcome) => {
      if (outcome.kind === 'saved') {
        apply(outcome.values);
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
      driftText={driftText}
      driftSliderValue={driftSliderValue}
      driftInvalid={touched && parseCurrencyDrift(driftText) === null}
      dirty={parseTolerance(text) !== saved.tolerancePercent || parseCurrencyDrift(driftText) !== saved.currencyDriftPercent}
      status={status}
      message={message}
      onTextChange={onTextChange}
      onDriftTextChange={onDriftTextChange}
      onCommit={onCommit}
    />
  );
}

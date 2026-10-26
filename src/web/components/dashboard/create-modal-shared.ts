import type { MessageKey } from '@/i18n/translate';
import type { createModalMessages } from './CreateModal.messages';

/** Form inputs use the stronger input border and the shared control height (44px on narrow screens). */
export const FIELD_CLASS =
  'min-h-(--control-h) rounded-md border border-input-border bg-background px-2 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

type Unit = 'day' | 'week' | 'month' | 'year';
export type EveryKey = Extract<MessageKey<typeof createModalMessages.en>, `every.${string}`>;

const FREQ_UNIT: Record<string, Unit> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };
const CYCLE_UNIT: Record<number, Unit> = { 1: 'day', 2: 'week', 3: 'month', 4: 'year' };

function key(unit: Unit, n: number): { key: EveryKey; n: number } {
  return { key: `every.${unit}.${n === 1 ? 'one' : 'other'}`, n };
}

/** Message key for an Actual recurrence frequency ('daily' ...) repeated every n. */
export function everyKey(frequency: string, n: number): { key: EveryKey; n: number } {
  return key(FREQ_UNIT[frequency] ?? 'month', n);
}

/** Unit of a Wallos cycle number (1 days, 2 weeks, 3 months, 4 years); anything else reads as months. */
export function cycleUnit(cycle: number): Unit {
  return CYCLE_UNIT[cycle] ?? 'month';
}

export const CYCLE_UNITS: readonly Unit[] = ['day', 'week', 'month', 'year'];

/** Message key for a Wallos cycle unit (1 days, 2 weeks, 3 months, 4 years) repeated every n. */
export function cycleKey(cycle: number, n: number): { key: EveryKey; n: number } {
  return key(CYCLE_UNIT[cycle] ?? 'month', n);
}

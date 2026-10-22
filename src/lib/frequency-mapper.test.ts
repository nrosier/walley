import type { APIScheduleEntity } from '@actual-app/api/models';
import { describe, expect, it } from 'vitest';
import {
  actualToWallos,
  FrequencyMappingError,
  wallosToActual,
  type ActualRecurrence,
  type WallosInterval,
} from './frequency-mapper.js';

describe('frequency mapper', () => {
  const cases: [WallosInterval, ActualRecurrence][] = [
    [{ type: 'monthly', every: 1 }, { frequency: 'monthly', interval: 1 }],
    [{ type: 'yearly', every: 1 }, { frequency: 'yearly', interval: 1 }],
    [{ type: 'weekly', every: 2 }, { frequency: 'weekly', interval: 2 }],
    [{ type: 'custom_days', days: 45 }, { frequency: 'daily', interval: 45 }],
  ];

  it.each(cases)('round trips %j', (wallos, actual) => {
    expect(wallosToActual(wallos)).toEqual(actual);
    expect(actualToWallos(wallosToActual(wallos))).toEqual(wallos);
    expect(wallosToActual(actualToWallos(actual))).toEqual(actual);
  });

  it('treats a missing Actual interval as 1', () => {
    expect(actualToWallos({ frequency: 'monthly' })).toEqual({ type: 'monthly', every: 1 });
  });

  it('rejects invalid input with a typed error', () => {
    const bad = [
      () => wallosToActual({ type: 'daily' } as unknown as WallosInterval),
      () => wallosToActual({ type: 'custom_days', days: 0 }),
      () => wallosToActual({ type: 'custom_days', days: 1.5 }),
      () => wallosToActual({ type: 'monthly' } as unknown as WallosInterval),
      () => actualToWallos({ frequency: 'hourly' } as unknown as ActualRecurrence),
      () => actualToWallos({ frequency: 'weekly', interval: -1 }),
    ];
    for (const fn of bad) expect(fn).toThrow(FrequencyMappingError);
  });
});

// Type-level check against the real Actual type: a mapper result plus the
// caller-supplied `start` must be a valid schedule `date`, and the mapper's
// fields must be exactly the real frequency union and interval.
type RealRecurConfig = Exclude<APIScheduleEntity['date'], string>;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const frequencyMatches: Same<ActualRecurrence['frequency'], RealRecurConfig['frequency']> = true;
const intervalMatches: Same<ActualRecurrence['interval'], RealRecurConfig['interval']> = true;

describe('real Actual type', () => {
  it('produces a valid RecurConfig once start is added', () => {
    const date: APIScheduleEntity['date'] = {
      ...wallosToActual({ type: 'custom_days', days: 45 }),
      start: '2026-01-01',
    };
    expect(date).toEqual({ frequency: 'daily', interval: 45, start: '2026-01-01' });
    expect([frequencyMatches, intervalMatches]).toEqual([true, true]);
  });
});

import type { BillingCycle } from '../../lib/billing-cycle';
import type { MessageKey, TFunction } from '@/i18n/translate';
import type { syncDashboardMessages } from '@/pages/SyncDashboard.messages';

type T = TFunction<(typeof syncDashboardMessages)['en']>;

const SINGLE = {
  monthly: 'cycle.monthly',
  yearly: 'cycle.yearly',
  weekly: 'cycle.weekly',
  custom_days: 'cycle.custom_days',
} as const satisfies Record<BillingCycle['key'], MessageKey<(typeof syncDashboardMessages)['en']>>;

const MANY = {
  monthly: 'cycle.monthlyN',
  yearly: 'cycle.yearlyN',
  weekly: 'cycle.weeklyN',
  custom_days: 'cycle.custom_daysN',
} as const satisfies Record<BillingCycle['key'], MessageKey<(typeof syncDashboardMessages)['en']>>;

/** The row label of a billing cycle ("Every month", "Every 7 days"). One mapping for both sides. */
export function cycleLabel(t: T, cycle: BillingCycle): string {
  return cycle.count === 1 ? t(SINGLE[cycle.key]) : t(MANY[cycle.key], { n: cycle.count });
}

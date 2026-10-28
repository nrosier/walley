/**
 * The coverage set of the test-data seed (issue 119), defined as data. Everything here is invented:
 * subscription names, amounts and dates are plausible but belong to no real account. The seed
 * script (scripts/seed-test-data.ts) reads this file; the coverage check test
 * (scripts/seed/coverage.test.ts) reads it too, so the set cannot drift silently.
 *
 * Reference "today" for the dates is 2026-10-28; every next payment lies in the following weeks.
 * The budget base currency of the test Actual budget is EUR. An Actual budget has one currency, so
 * every Actual schedule is stored in EUR. The "create-actual-foreign" items are therefore services
 * that are priced in a foreign currency but paid, and recorded in Actual, as their EUR equivalent
 * (the title says where the service is priced); "Create in Wallos" turns them into EUR
 * subscriptions.
 */
import type { WallosInterval } from '../../src/lib/frequency-mapper.js';

/** Fixed marker at the start of every seeded Wallos subscription, Actual schedule and payee name. */
export const SEED_TAG = '[seed]';

export const BASE_CURRENCY = 'EUR';
export type SeedCurrency = 'EUR' | 'USD' | 'GBP' | 'JPY';

export const MATCH_CATEGORIES = [
  'match-exact',
  'match-fuzzy-name',
  'match-amount-within-tolerance',
  'match-amount-outside-tolerance',
  'match-already-linked',
  'match-ignored-wallos',
  'match-ignored-actual',
  'match-orphaned',
] as const;
export const CREATE_CATEGORIES = [
  'create-wallos-base',
  'create-wallos-foreign',
  'create-actual-base',
  'create-actual-foreign',
] as const;
export const LINK_CATEGORIES = [
  'link-one-candidate',
  'link-several-candidates',
  'link-no-candidate',
] as const;
export const COVERAGE_CATEGORIES = [...MATCH_CATEGORIES, ...CREATE_CATEGORIES, ...LINK_CATEGORIES] as const;
export type Category = (typeof COVERAGE_CATEGORIES)[number];

export const INTERVAL_TYPES = ['weekly', 'monthly', 'yearly', 'custom_days'] as const;

/**
 * What the owner still does in Walley after seeding, because Walley's own database cannot be
 * written by the seed: link the pair, ignore the item, or link the pair and then delete one side.
 */
export type WalleyStep =
  | 'link-pair'
  | 'ignore-item'
  | 'link-pair-then-delete-wallos'
  | 'link-pair-then-delete-actual';

export interface SeedItem {
  /** Unique, stable key; also the group key's child. */
  readonly key: string;
  /** Items of one scenario share a group (a pair, or one item against several candidates). */
  readonly group: string;
  readonly category: Category;
  readonly side: 'wallos' | 'actual';
  /** Name without the tag. The stored name is seedName(title). */
  readonly title: string;
  /** Decimal in `currency`, always positive: "13.99" (EUR), "1080" (JPY). */
  readonly amount: string;
  readonly currency: SeedCurrency;
  readonly interval: WallosInterval;
  /** YYYY-MM-DD. */
  readonly startDate: string;
  /** YYYY-MM-DD. Sent to Wallos; Actual computes its own next date from the start. */
  readonly nextPayment: string;
  /** Wallos only (Actual has no inactive flag for a schedule). */
  readonly inactive?: true;
  readonly walleyStep?: WalleyStep;
}

export function seedName(title: string): string {
  return `${SEED_TAG} ${title}`;
}

interface Recurrence {
  readonly interval: WallosInterval;
  readonly startDate: string;
  readonly nextPayment: string;
}

const monthly = (startDate: string, nextPayment: string): Recurrence => ({
  interval: { type: 'monthly', every: 1 },
  startDate,
  nextPayment,
});
const yearly = (startDate: string, nextPayment: string): Recurrence => ({
  interval: { type: 'yearly', every: 1 },
  startDate,
  nextPayment,
});
const weekly = (every: number, startDate: string, nextPayment: string): Recurrence => ({
  interval: { type: 'weekly', every },
  startDate,
  nextPayment,
});
const everyDays = (days: number, startDate: string, nextPayment: string): Recurrence => ({
  interval: { type: 'custom_days', days },
  startDate,
  nextPayment,
});

interface Side {
  readonly title: string;
  readonly amount: string;
}

/** A pair in the base currency: one Wallos item and one Actual item of one scenario. */
function pair(
  group: string,
  category: Category,
  wallos: Side,
  actual: Side,
  rec: Recurrence,
  walleyStep?: WalleyStep,
): SeedItem[] {
  const step = walleyStep === undefined ? {} : { walleyStep };
  return [
    { key: `${group}-w`, group, category, side: 'wallos', ...wallos, currency: 'EUR', ...rec, ...step },
    { key: `${group}-a`, group, category, side: 'actual', ...actual, currency: 'EUR', ...rec, ...step },
  ];
}

const same = (title: string, amount: string): [Side, Side] => [
  { title, amount },
  { title, amount },
];

function wallosOnly(
  group: string,
  category: Category,
  title: string,
  amount: string,
  currency: SeedCurrency,
  rec: Recurrence,
  extra: { inactive?: true; walleyStep?: WalleyStep } = {},
): SeedItem {
  return { key: `${group}-w`, group, category, side: 'wallos', title, amount, currency, ...rec, ...extra };
}

function actualOnly(
  group: string,
  category: Category,
  title: string,
  amount: string,
  rec: Recurrence,
  extra: { walleyStep?: WalleyStep } = {},
): SeedItem {
  return { key: `${group}-a`, group, category, side: 'actual', title, amount, currency: 'EUR', ...rec, ...extra };
}

/** One Wallos item against several Actual items, or one Actual item against several Wallos items. */
function several(
  group: string,
  one: { side: 'wallos' | 'actual'; title: string; amount: string },
  others: readonly Side[],
  rec: Recurrence,
): SeedItem[] {
  const otherSide = one.side === 'wallos' ? 'actual' : 'wallos';
  const suffix = (side: 'wallos' | 'actual'): string => (side === 'wallos' ? 'w' : 'a');
  return [
    {
      key: `${group}-${suffix(one.side)}`,
      group,
      category: 'link-several-candidates',
      side: one.side,
      title: one.title,
      amount: one.amount,
      currency: 'EUR',
      ...rec,
    },
    ...others.map(
      (other, index): SeedItem => ({
        key: `${group}-${suffix(otherSide)}${String(index + 1)}`,
        group,
        category: 'link-several-candidates',
        side: otherSide,
        title: other.title,
        amount: other.amount,
        currency: 'EUR',
        ...rec,
      }),
    ),
  ];
}

export const SEED_ITEMS: readonly SeedItem[] = [
  // match-exact: same name, same amount, same schedule.
  ...pair('exact-netflix', 'match-exact', ...same('Netflix', '13.99'), monthly('2024-02-14', '2026-11-14')),
  ...pair('exact-spotify', 'match-exact', ...same('Spotify', '11.99'), monthly('2023-06-08', '2026-11-08')),
  ...pair('exact-microsoft', 'match-exact', ...same('Microsoft 365', '99.00'), yearly('2025-03-19', '2027-03-19')),

  // match-fuzzy-name: names differ but pass the name threshold; same amount.
  ...pair(
    'fuzzy-amazon',
    'match-fuzzy-name',
    { title: 'Amazon Prime', amount: '8.99' },
    { title: 'Amazon Prime Video', amount: '8.99' },
    monthly('2025-01-22', '2026-11-22'),
  ),
  ...pair(
    'fuzzy-google',
    'match-fuzzy-name',
    { title: 'Google One', amount: '1.99' },
    { title: 'Google One Storage', amount: '1.99' },
    monthly('2024-08-27', '2026-11-27'),
  ),
  ...pair(
    'fuzzy-adobe',
    'match-fuzzy-name',
    { title: 'Adobe Creative Cloud', amount: '66.49' },
    { title: 'Adobe Creative Cloud All Apps', amount: '66.49' },
    monthly('2023-11-03', '2026-11-03'),
  ),

  // match-amount-within-tolerance: same name; amounts differ by about 3 percent (default limit 5).
  ...pair(
    'tol-disney',
    'match-amount-within-tolerance',
    { title: 'Disney+', amount: '9.99' },
    { title: 'Disney+', amount: '10.29' },
    monthly('2025-04-11', '2026-11-11'),
  ),
  ...pair(
    'tol-icloud',
    'match-amount-within-tolerance',
    { title: 'iCloud+', amount: '2.99' },
    { title: 'iCloud+', amount: '3.09' },
    monthly('2024-12-05', '2026-11-05'),
  ),
  ...pair(
    'tol-audible',
    'match-amount-within-tolerance',
    { title: 'Audible', amount: '9.95' },
    { title: 'Audible', amount: '9.65' },
    monthly('2025-07-17', '2026-11-17'),
  ),

  // match-amount-outside-tolerance: same name; amounts differ by more than 10 percent.
  ...pair(
    'out-headspace',
    'match-amount-outside-tolerance',
    { title: 'Headspace', amount: '12.99' },
    { title: 'Headspace', amount: '14.99' },
    monthly('2025-02-09', '2026-11-09'),
  ),
  ...pair(
    'out-duolingo',
    'match-amount-outside-tolerance',
    { title: 'Duolingo', amount: '12.99' },
    { title: 'Duolingo', amount: '9.99' },
    monthly('2025-05-21', '2026-11-21'),
  ),
  ...pair(
    'out-notion',
    'match-amount-outside-tolerance',
    { title: 'Notion', amount: '10.00' },
    { title: 'Notion', amount: '8.00' },
    monthly('2024-10-15', '2026-11-15'),
  ),

  // match-already-linked: identical pairs. Walley step: link each pair in Walley.
  ...pair('linked-chatgpt', 'match-already-linked', ...same('ChatGPT Plus', '22.99'), monthly('2025-06-12', '2026-11-12'), 'link-pair'),
  ...pair('linked-youtube', 'match-already-linked', ...same('YouTube', '12.99'), monthly('2024-03-25', '2026-11-25'), 'link-pair'),
  ...pair('linked-dropbox', 'match-already-linked', ...same('Dropbox', '119.88'), yearly('2025-11-12', '2026-11-12'), 'link-pair'),

  // match-ignored-wallos: Wallos-only items. Walley step: ignore each on the Wallos side.
  wallosOnly('ignw-linkedin', 'match-ignored-wallos', 'LinkedIn', '29.99', 'EUR', monthly('2025-03-06', '2026-11-06'), { walleyStep: 'ignore-item' }),
  wallosOnly('ignw-medium', 'match-ignored-wallos', 'Medium', '5.00', 'USD', monthly('2025-01-18', '2026-11-18'), { walleyStep: 'ignore-item' }),
  wallosOnly('ignw-skillshare', 'match-ignored-wallos', 'Skillshare', '99.00', 'USD', yearly('2025-12-09', '2026-12-09'), {
    inactive: true,
    walleyStep: 'ignore-item',
  }),

  // match-ignored-actual: Actual-only schedules. Walley step: ignore each on the Actual side.
  actualOnly('igna-strava', 'match-ignored-actual', 'Strava', '54.99', yearly('2025-12-19', '2026-12-19'), { walleyStep: 'ignore-item' }),
  actualOnly('igna-nordvpn', 'match-ignored-actual', 'NordVPN', '11.99', monthly('2025-10-01', '2026-11-01'), { walleyStep: 'ignore-item' }),
  actualOnly('igna-peloton', 'match-ignored-actual', 'Peloton', '12.99', monthly('2025-02-26', '2026-11-26'), { walleyStep: 'ignore-item' }),

  // match-orphaned: identical pairs. Walley step: link, then delete one side in Wallos or Actual.
  ...pair('orph-canva', 'match-orphaned', ...same('Canva', '11.99'), monthly('2025-08-14', '2026-11-14'), 'link-pair-then-delete-actual'),
  ...pair('orph-evernote', 'match-orphaned', ...same('Evernote', '14.99'), monthly('2024-11-02', '2026-11-02'), 'link-pair-then-delete-wallos'),
  ...pair('orph-tidal', 'match-orphaned', ...same('Tidal', '10.99'), monthly('2025-09-28', '2026-11-28'), 'link-pair-then-delete-actual'),

  // create-wallos-base: Wallos-only, in the base currency (create in Actual).
  wallosOnly('cwb-todoist', 'create-wallos-base', 'Todoist', '36.00', 'EUR', yearly('2025-12-03', '2026-12-03')),
  wallosOnly('cwb-1password', 'create-wallos-base', '1Password', '4.99', 'EUR', monthly('2024-09-16', '2026-11-16')),
  wallosOnly('cwb-proton', 'create-wallos-base', 'Proton Mail', '4.99', 'EUR', monthly('2025-04-24', '2026-11-24')),
  wallosOnly('cwb-hellofresh', 'create-wallos-base', 'HelloFresh', '49.99', 'EUR', weekly(1, '2026-03-04', '2026-11-04')),
  wallosOnly('cwb-calm', 'create-wallos-base', 'Calm', '49.99', 'EUR', yearly('2024-12-22', '2026-12-22'), { inactive: true }),
  wallosOnly('cwb-coffee', 'create-wallos-base', 'Coffee Beans Club', '14.50', 'EUR', everyDays(14, '2026-02-10', '2026-11-03')),
  wallosOnly('cwb-lens', 'create-wallos-base', 'Lens Club', '24.90', 'EUR', everyDays(30, '2026-04-20', '2026-11-16')),

  // create-wallos-foreign: Wallos-only, in USD, GBP and JPY (JPY has no decimals).
  wallosOnly('cwf-peacock', 'create-wallos-foreign', 'Peacock', '7.99', 'USD', monthly('2025-09-10', '2026-11-10'), { inactive: true }),
  wallosOnly('cwf-grammarly', 'create-wallos-foreign', 'Grammarly', '12.00', 'USD', monthly('2025-06-03', '2026-11-03')),
  wallosOnly('cwf-nowtv', 'create-wallos-foreign', 'Now TV', '9.99', 'GBP', monthly('2025-01-14', '2026-11-14')),
  wallosOnly('cwf-economist', 'create-wallos-foreign', 'The Economist', '19.00', 'GBP', monthly('2024-09-21', '2026-11-21')),
  wallosOnly('cwf-abema', 'create-wallos-foreign', 'Abema', '1080', 'JPY', monthly('2025-03-08', '2026-11-08')),
  wallosOnly('cwf-niconico', 'create-wallos-foreign', 'Niconico', '800', 'JPY', monthly('2024-07-13', '2026-11-13')),
  wallosOnly('cwf-unext', 'create-wallos-foreign', 'U-NEXT', '2189', 'JPY', monthly('2025-05-02', '2026-11-02')),

  // create-actual-base: Actual-only schedules (create in Wallos). Always the budget currency.
  actualOnly('cab-basicfit', 'create-actual-base', 'Basic-Fit Gym', '24.99', weekly(4, '2026-01-07', '2026-11-11')),
  actualOnly('cab-odido', 'create-actual-base', 'Odido Mobile', '17.50', monthly('2023-09-10', '2026-11-10')),
  actualOnly('cab-kindle', 'create-actual-base', 'Kindle Unlimited', '9.99', monthly('2025-02-13', '2026-11-13')),
  actualOnly('cab-vegbox', 'create-actual-base', 'Farm Veg Box', '18.50', weekly(1, '2026-05-06', '2026-11-04')),
  actualOnly('cab-water', 'create-actual-base', 'Spring Water', '9.50', everyDays(10, '2026-03-02', '2026-11-07')),
  actualOnly('cab-vimeo', 'create-actual-base', 'Vimeo', '120.00', yearly('2025-11-24', '2026-11-24')),
  actualOnly('cab-protein', 'create-actual-base', 'Protein Refill', '39.90', everyDays(45, '2026-05-06', '2026-11-02')),

  // create-actual-foreign: Actual-only, priced abroad (USD, GBP, JPY), recorded in EUR.
  actualOnly('caf-hulu', 'create-actual-foreign', 'Hulu US', '7.34', monthly('2025-05-30', '2026-11-30')),
  actualOnly('caf-sling', 'create-actual-foreign', 'Sling TV US', '41.40', monthly('2025-02-04', '2026-11-04')),
  actualOnly('caf-skysports', 'create-actual-foreign', 'Sky Sports UK', '27.50', monthly('2025-08-19', '2026-11-19')),
  actualOnly('caf-britbox', 'create-actual-foreign', 'BritBox UK', '7.10', monthly('2025-04-07', '2026-11-07')),
  actualOnly('caf-rakuten', 'create-actual-foreign', 'Rakuten Mobile JP', '6.40', monthly('2025-06-26', '2026-11-26')),
  actualOnly('caf-dazn', 'create-actual-foreign', 'DAZN Japan', '18.50', yearly('2025-12-11', '2026-12-11')),

  // link-one-candidate: one Wallos item and exactly one Actual item that pass the candidate rule.
  ...pair(
    'one-paramount',
    'link-one-candidate',
    { title: 'Paramount Plus', amount: '7.99' },
    { title: 'Paramount Plus Essential', amount: '7.99' },
    monthly('2025-10-20', '2026-11-20'),
  ),
  ...pair(
    'one-crunchyroll',
    'link-one-candidate',
    { title: 'Crunchyroll', amount: '6.99' },
    { title: 'Crunchyroll Fan', amount: '6.99' },
    monthly('2025-08-04', '2026-11-04'),
  ),
  ...pair(
    'one-appletv',
    'link-one-candidate',
    { title: 'Apple TV', amount: '9.99' },
    { title: 'Apple TV Streaming', amount: '10.29' },
    monthly('2025-06-18', '2026-11-18'),
  ),

  // link-several-candidates: one item with two or more candidates on the other side.
  ...several(
    'many-xbox',
    { side: 'wallos', title: 'Xbox Game Pass', amount: '14.99' },
    [
      { title: 'Xbox Game Pass', amount: '14.99' },
      { title: 'Xbox Game Pass Core', amount: '15.29' },
    ],
    monthly('2025-01-09', '2026-11-09'),
  ),
  ...several(
    'many-telegram',
    { side: 'actual', title: 'Telegram Premium', amount: '4.99' },
    [
      { title: 'Telegram Premium', amount: '4.99' },
      { title: 'Telegram', amount: '4.89' },
    ],
    monthly('2025-03-12', '2026-11-12'),
  ),
  ...several(
    'many-twitch',
    { side: 'wallos', title: 'Twitch', amount: '8.99' },
    [
      { title: 'Twitch Subscription', amount: '8.99' },
      { title: 'Twitch Turbo', amount: '9.19' },
    ],
    monthly('2025-09-23', '2026-11-23'),
  ),

  // link-no-candidate: items with nothing similar on the other side, to link by hand.
  wallosOnly('none-pocketcasts', 'link-no-candidate', 'Pocket Casts', '3.99', 'EUR', monthly('2025-02-17', '2026-11-17')),
  wallosOnly('none-readwise', 'link-no-candidate', 'Readwise', '9.99', 'USD', monthly('2025-07-08', '2026-11-08')),
  wallosOnly('none-raindrop', 'link-no-candidate', 'Raindrop', '28.00', 'EUR', yearly('2025-12-15', '2026-12-15')),
  actualOnly('none-hetzner', 'link-no-candidate', 'Hetzner Storage Box', '3.81', monthly('2024-04-06', '2026-11-06')),
  actualOnly('none-vattenfall', 'link-no-candidate', 'Vattenfall Energy', '85.00', monthly('2023-01-01', '2026-11-01')),
  actualOnly('none-obsidian', 'link-no-candidate', 'Obsidian Sync', '48.00', yearly('2025-12-27', '2026-12-27')),
];

/** Item count per category, in COVERAGE_CATEGORIES order. */
export function countByCategory(items: readonly SeedItem[]): Record<Category, number> {
  const counts = Object.fromEntries(COVERAGE_CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const item of items) counts[item.category] += 1;
  return counts;
}

/** Item count per interval type. */
export function countByInterval(items: readonly SeedItem[]): Record<(typeof INTERVAL_TYPES)[number], number> {
  const counts = { weekly: 0, monthly: 0, yearly: 0, custom_days: 0 };
  for (const item of items) counts[item.interval.type] += 1;
  return counts;
}

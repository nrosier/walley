// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { amountWithinTolerance, DEFAULT_TOLERANCE_PERCENT } from '../../src/lib/amount-match.js';
import { currencyExponent } from '../../src/lib/currency-exponent.js';
import { NAME_MATCH_THRESHOLD, nameScore } from '../../src/lib/name-match.js';
import { priceToMinorUnits } from '../../src/server/integrations/wallos/create-fields.js';
import { isIsoDate } from '../../src/server/integrations/wallos/write.js';
import {
  BASE_CURRENCY,
  COVERAGE_CATEGORIES,
  CREATE_CATEGORIES,
  INTERVAL_TYPES,
  LINK_CATEGORIES,
  MATCH_CATEGORIES,
  SEED_ITEMS,
  SEED_TAG,
  countByCategory,
  countByInterval,
  seedName,
  type Category,
  type SeedItem,
} from './coverage.js';

// Pure data checks. No network, no env file.

const inCategory = (category: Category): SeedItem[] => SEED_ITEMS.filter((i) => i.category === category);
const pairOf = (group: string): { w: SeedItem[]; a: SeedItem[] } => ({
  w: SEED_ITEMS.filter((i) => i.group === group && i.side === 'wallos'),
  a: SEED_ITEMS.filter((i) => i.group === group && i.side === 'actual'),
});
const cents = (item: SeedItem): number => priceToMinorUnits(item.amount, item.currency) ?? Number.NaN;
const groupsOf = (category: Category): string[] => [...new Set(inCategory(category).map((i) => i.group))];

describe('seed coverage set', () => {
  it('lists the categories of issue 119', () => {
    expect(MATCH_CATEGORIES).toHaveLength(8);
    expect(CREATE_CATEGORIES).toHaveLength(4);
    expect(LINK_CATEGORIES).toHaveLength(3);
    expect(INTERVAL_TYPES).toEqual(['weekly', 'monthly', 'yearly', 'custom_days']);
  });

  it.each(COVERAGE_CATEGORIES)('category %s has at least two items', (category) => {
    // Twice the number needed, so no test runs out of data.
    expect(countByCategory(SEED_ITEMS)[category]).toBeGreaterThanOrEqual(2);
  });

  it.each(INTERVAL_TYPES)('interval %s has items, each with a next payment and a start date', (type) => {
    const items = SEED_ITEMS.filter((i) => i.interval.type === type);
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(countByInterval(SEED_ITEMS)[type]).toBe(items.length);
    for (const item of items) {
      expect(isIsoDate(item.startDate), `${item.key} start date`).toBe(true);
      expect(isIsoDate(item.nextPayment), `${item.key} next payment`).toBe(true);
    }
  });

  it('gives every item valid dates, with the next payment not before the start', () => {
    for (const item of SEED_ITEMS) {
      expect(isIsoDate(item.startDate), item.key).toBe(true);
      expect(isIsoDate(item.nextPayment), item.key).toBe(true);
      expect(item.nextPayment >= item.startDate, item.key).toBe(true);
    }
  });

  it('has at least one inactive item', () => {
    expect(SEED_ITEMS.some((i) => i.inactive === true)).toBe(true);
  });

  it('has unique keys and unique tagged names per side', () => {
    expect(new Set(SEED_ITEMS.map((i) => i.key)).size).toBe(SEED_ITEMS.length);
    for (const side of ['wallos', 'actual'] as const) {
      const names = SEED_ITEMS.filter((i) => i.side === side).map((i) => seedName(i.title));
      expect(new Set(names).size, side).toBe(names.length);
      for (const name of names) expect(name.startsWith(`${SEED_TAG} `)).toBe(true);
    }
  });

  it('uses only the currencies EUR, USD, GBP and JPY, with amounts that fit their minor units', () => {
    const used = new Set(SEED_ITEMS.map((i) => i.currency));
    expect([...used].sort()).toEqual(['EUR', 'GBP', 'JPY', 'USD']);
    for (const item of SEED_ITEMS) {
      const amount = priceToMinorUnits(item.amount, item.currency);
      expect(amount, item.key).not.toBeNull();
    }
    // JPY has no decimals.
    expect(currencyExponent('JPY')).toBe(0);
    for (const item of SEED_ITEMS.filter((i) => i.currency === 'JPY')) expect(item.amount).toMatch(/^\d+$/);
  });

  it('keeps every Actual schedule in the budget base currency', () => {
    for (const item of SEED_ITEMS.filter((i) => i.side === 'actual')) expect(item.currency).toBe(BASE_CURRENCY);
  });

  it('puts the foreign currencies on Wallos items in the create-wallos-foreign category', () => {
    const foreign = inCategory('create-wallos-foreign');
    expect(foreign.every((i) => i.side === 'wallos' && i.currency !== BASE_CURRENCY)).toBe(true);
    expect(new Set(foreign.map((i) => i.currency))).toEqual(new Set(['USD', 'GBP', 'JPY']));
    expect(inCategory('create-wallos-base').every((i) => i.side === 'wallos' && i.currency === BASE_CURRENCY)).toBe(true);
    expect(inCategory('create-actual-base').every((i) => i.side === 'actual')).toBe(true);
    expect(inCategory('create-actual-foreign').every((i) => i.side === 'actual')).toBe(true);
  });

  describe('match categories behave as named under the matching rules', () => {
    const matchesName = (w: SeedItem, a: SeedItem): boolean => nameScore(w.title, a.title) >= NAME_MATCH_THRESHOLD;
    const within = (w: SeedItem, a: SeedItem): boolean =>
      amountWithinTolerance(cents(w), cents(a), DEFAULT_TOLERANCE_PERCENT);

    it.each(['match-exact', 'match-already-linked', 'match-orphaned'] as const)('%s: same name and same amount', (category) => {
      for (const group of groupsOf(category)) {
        const { w, a } = pairOf(group);
        expect(w).toHaveLength(1);
        expect(a).toHaveLength(1);
        expect(w[0]?.title).toBe(a[0]?.title);
        expect(cents(w[0] as SeedItem)).toBe(cents(a[0] as SeedItem));
      }
    });

    it('match-fuzzy-name: different names that still pass the name rule, same amount', () => {
      for (const group of groupsOf('match-fuzzy-name')) {
        const { w, a } = pairOf(group);
        const [wi, ai] = [w[0] as SeedItem, a[0] as SeedItem];
        expect(wi.title).not.toBe(ai.title);
        expect(matchesName(wi, ai), group).toBe(true);
        expect(cents(wi)).toBe(cents(ai));
      }
    });

    it('match-amount-within-tolerance: same name, different amount inside the default tolerance', () => {
      for (const group of groupsOf('match-amount-within-tolerance')) {
        const { w, a } = pairOf(group);
        const [wi, ai] = [w[0] as SeedItem, a[0] as SeedItem];
        expect(wi.title).toBe(ai.title);
        expect(cents(wi)).not.toBe(cents(ai));
        expect(within(wi, ai), group).toBe(true);
      }
    });

    it('match-amount-outside-tolerance: same name, amount outside the default tolerance', () => {
      for (const group of groupsOf('match-amount-outside-tolerance')) {
        const { w, a } = pairOf(group);
        const [wi, ai] = [w[0] as SeedItem, a[0] as SeedItem];
        expect(wi.title).toBe(ai.title);
        expect(within(wi, ai), group).toBe(false);
      }
    });

    it('ignored categories hold one item on the side that is ignored', () => {
      expect(inCategory('match-ignored-wallos').every((i) => i.side === 'wallos' && i.walleyStep === 'ignore-item')).toBe(true);
      expect(inCategory('match-ignored-actual').every((i) => i.side === 'actual' && i.walleyStep === 'ignore-item')).toBe(true);
    });

    it('orphan items name which side the owner deletes after linking', () => {
      const steps = new Set(inCategory('match-orphaned').map((i) => i.walleyStep));
      expect(steps).toEqual(new Set(['link-pair-then-delete-wallos', 'link-pair-then-delete-actual']));
    });
  });

  describe('link categories behave as named under the candidate rule', () => {
    const isCandidatePair = (w: SeedItem, a: SeedItem): boolean =>
      nameScore(w.title, a.title) >= NAME_MATCH_THRESHOLD &&
      amountWithinTolerance(cents(w), cents(a), DEFAULT_TOLERANCE_PERCENT);
    const candidatesIn = (group: string): Map<string, number> => {
      const { w, a } = pairOf(group);
      const counts = new Map<string, number>();
      for (const x of w) for (const y of a) if (isCandidatePair(x, y)) {
        counts.set(x.key, (counts.get(x.key) ?? 0) + 1);
        counts.set(y.key, (counts.get(y.key) ?? 0) + 1);
      }
      return counts;
    };

    it('link-one-candidate: each pair is exactly one candidate', () => {
      for (const group of groupsOf('link-one-candidate')) {
        const counts = candidatesIn(group);
        expect([...counts.values()], group).toEqual([1, 1]);
      }
    });

    it('link-several-candidates: the single item has two or more candidates', () => {
      for (const group of groupsOf('link-several-candidates')) {
        const counts = candidatesIn(group);
        expect(Math.max(...counts.values()), group).toBeGreaterThanOrEqual(2);
      }
    });

    it('no candidate pair crosses scenarios, so each scenario stays isolated', () => {
      for (const w of SEED_ITEMS.filter((i) => i.side === 'wallos')) {
        for (const a of SEED_ITEMS.filter((i) => i.side === 'actual' && i.group !== w.group)) {
          expect(isCandidatePair(w, a), `${w.key} vs ${a.key}`).toBe(false);
        }
      }
    });

    it('link-no-candidate: no item pairs with any item of the whole seed set', () => {
      const none = inCategory('link-no-candidate');
      for (const item of none) {
        const others = SEED_ITEMS.filter((o) => o.side !== item.side);
        for (const other of others) {
          const [w, a] = item.side === 'wallos' ? [item, other] : [other, item];
          expect(isCandidatePair(w, a), `${item.key} vs ${other.key}`).toBe(false);
        }
      }
    });
  });

  it('lists the count per category, so a change is visible in review', () => {
    const counts = countByCategory(SEED_ITEMS);
    expect(Object.keys(counts)).toEqual([...COVERAGE_CATEGORIES]);
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(SEED_ITEMS.length);
  });
});

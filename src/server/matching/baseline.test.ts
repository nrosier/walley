import { afterEach, describe, expect, it } from 'vitest';
import type { MatchFieldsInput } from '../../lib/match-fields.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../db/client.js';
import { createUserRepo } from '../db/repo.js';
import type { WallosClient } from '../integrations/wallos/client.js';
import { makeUser } from '../test/auth-helpers.js';
import { wallosBaselineOf } from './baseline.js';
import { readCurrentSides } from './sync-check.js';

const dbs: AppDatabase[] = [];
afterEach(() => {
  for (const d of dbs.splice(0)) closeDatabase(d);
});

const NULLS = { lastKnownWallosAmountCents: null, lastKnownWallosPriceMinor: null, lastKnownWallosCurrency: null };

async function sideOf(price: string, currencyId: number) {
  const db = openDatabase(':memory:');
  dbs.push(db);
  const userId = makeUser(db);
  const deps = {
    repoFor: (id: string) => createUserRepo(db, id),
    wallos: {
      listSubscriptions: async () => [
        { id: 1, name: 'Netflix', price, currency_id: currencyId, cycle: 3, frequency: 1, next_payment: '2026-11-03', start_date: '2026-01-01', inactive: 0 },
      ],
      listCurrencies: async () => [
        { id: 1, code: 'EUR', rate: '1' },
        { id: 2, code: 'USD', rate: '2' },
        { id: 3, code: 'JPY', rate: '160' },
      ],
    } as unknown as WallosClient,
    withActual: (_id: string, use: (api: never) => Promise<unknown>) =>
      use({ getPreferences: async () => ({ defaultCurrencyCode: 'EUR' }), getSchedules: async () => [] } as never),
  };
  const { wallosSides } = await readCurrentSides(deps as never, userId);
  return wallosSides.get('1');
}

describe('wallosBaselineOf', () => {
  it('describes a base-currency subscription', async () => {
    expect(wallosBaselineOf(await sideOf('12.50', 1))).toEqual({
      lastKnownWallosAmountCents: -1250,
      lastKnownWallosPriceMinor: -1250,
      lastKnownWallosCurrency: 'EUR',
    });
  });

  it('describes a USD subscription: converted amount and own price (signed like Side.source.priceCents)', async () => {
    expect(wallosBaselineOf(await sideOf('25.00', 2))).toEqual({
      lastKnownWallosAmountCents: -1250,
      lastKnownWallosPriceMinor: -2500,
      lastKnownWallosCurrency: 'USD',
    });
  });

  it('describes a 0-decimal JPY subscription', async () => {
    expect(wallosBaselineOf(await sideOf('2000', 3))).toEqual({
      lastKnownWallosAmountCents: -1250,
      lastKnownWallosPriceMinor: -2000,
      lastKnownWallosCurrency: 'JPY',
    });
  });

  it('returns all null for an unmappable side', async () => {
    const side = await sideOf('abc', 1);
    expect(side?.fields).toBeNull();
    expect(wallosBaselineOf(side)).toEqual(NULLS);
  });

  it('returns all null for a missing side', () => {
    expect(wallosBaselineOf(undefined)).toEqual(NULLS);
  });

  it('returns all null for a range amount', () => {
    const fields: MatchFieldsInput = {
      name: 'x',
      amount: { kind: 'range', num1: -1, num2: -2 },
      frequency: 'monthly',
      currency: 'EUR',
      startDate: null,
    };
    expect(wallosBaselineOf({ fields, own: { priceMinor: -1, currencyCode: 'EUR' } })).toEqual(NULLS);
  });
});

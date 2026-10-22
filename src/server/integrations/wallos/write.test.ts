import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveUserKey } from '../../crypto/keys.js';
import { encryptSecret } from '../../crypto/secrets.js';
import { createUser } from '../../db/accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../../db/client.js';
import { createUserRepo, type UserRepo } from '../../db/repo.js';
import { toActualCents } from '../../../lib/money.js';
import type { ActualRecurrence } from '../../../lib/frequency-mapper.js';
import {
  WallosAuthError,
  WallosHttpError,
  WallosNetworkError,
  WallosRejectedError,
  createWallosClient,
} from './client.js';
import { mapWallosSubscription, WallosMappingError } from './map.js';
import {
  buildWallosSubscriptionPayload,
  type RecurringSubscriptionInput,
  type WallosSubscriptionPayload,
} from './write.js';
import type { WallosSubscription } from './types.js';

const APP_SECRET = 'test-app-secret-test-app-secret-0123';
const KEY_A = 'key-A-write-7f3c9e1d2b';

interface Call {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string;
}

function stubFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    calls.push({ url, method: init?.method, headers, body: typeof init?.body === 'string' ? init.body : '' });
    return respond(url);
  };
  return { calls, fetch: impl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const VALID_INPUT: RecurringSubscriptionInput = {
  name: 'Streaming service',
  priceCents: -1250,
  currencyId: '3',
  recurrence: { frequency: 'monthly', interval: 2 },
  startDate: '2026-01-15',
  nextPaymentDate: '2026-11-15',
};

describe('buildWallosSubscriptionPayload', () => {
  it('converts an expense in cents to a positive two-decimal price', () => {
    const payload = buildWallosSubscriptionPayload(VALID_INPUT);
    expect(payload).toEqual({
      name: 'Streaming service',
      price: '12.50',
      currency_id: '3',
      cycle: '3',
      frequency: '2',
      next_payment: '2026-11-15',
      start_date: '2026-01-15',
    });
  });

  it('omits start_date when it is unknown', () => {
    const payload = buildWallosSubscriptionPayload({ ...VALID_INPUT, startDate: null });
    expect(payload).not.toHaveProperty('start_date');
  });

  it('writes the Wallos cycle for each recurrence', () => {
    const cases: Array<[ActualRecurrence, string, string]> = [
      [{ frequency: 'daily', interval: 10 }, '1', '10'],
      [{ frequency: 'weekly', interval: 2 }, '2', '2'],
      [{ frequency: 'monthly' }, '3', '1'],
      [{ frequency: 'yearly', interval: 1 }, '4', '1'],
    ];
    for (const [recurrence, cycle, frequency] of cases) {
      const payload = buildWallosSubscriptionPayload({ ...VALID_INPUT, recurrence });
      expect(payload.cycle).toBe(cycle);
      expect(payload.frequency).toBe(frequency);
    }
  });

  it('rejects a positive (income) amount', () => {
    expect(() => buildWallosSubscriptionPayload({ ...VALID_INPUT, priceCents: 1250 })).toThrow(
      WallosMappingError,
    );
  });

  it('rejects a missing next payment date as a typed error', () => {
    try {
      buildWallosSubscriptionPayload({ ...VALID_INPUT, nextPaymentDate: null });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(WallosMappingError);
      expect((err as WallosMappingError).code).toBe('missing_field');
      expect((err as WallosMappingError).field).toBe('next_payment');
    }
  });

  it('rejects an empty name and a missing currency id as typed errors', () => {
    expect(captureMappingError({ ...VALID_INPUT, name: '  ' })).toMatchObject({
      code: 'missing_field',
      field: 'name',
    });
    expect(captureMappingError({ ...VALID_INPUT, currencyId: '' })).toMatchObject({
      code: 'missing_field',
      field: 'currency_id',
    });
  });

  it('rejects a recurrence Wallos cannot express', () => {
    expect(
      captureMappingError({ ...VALID_INPUT, recurrence: { frequency: 'monthly', interval: 0 } }),
    ).toMatchObject({ code: 'unsupported_cycle' });
  });

  it('round-trips amount and cycle through the read-side mapper', () => {
    const cases: ActualRecurrence[] = [
      { frequency: 'daily', interval: 7 },
      { frequency: 'weekly', interval: 1 },
      { frequency: 'monthly', interval: 1 },
      { frequency: 'monthly', interval: 3 },
      { frequency: 'yearly', interval: 1 },
    ];
    for (const recurrence of cases) {
      for (const priceCents of [-1, -1250, -99999, -100000]) {
        const payload = buildWallosSubscriptionPayload({ ...VALID_INPUT, priceCents, recurrence });
        const mapped = mapWallosSubscription(wallosRecordFrom(payload, '55'));
        expect(mapped.priceCents).toBe(priceCents);
        expect(mapped.recurrence).toEqual(normalise(recurrence));
        expect(mapped.wallosId).toBe('55');
        expect(mapped.currencyId).toBe('3');
        expect(mapped.nextPaymentDate).toBe('2026-11-15');
        expect(mapped.startDate).toBe('2026-01-15');
      }
    }
  });

  it('round-trips a cents amount that float rounding could corrupt', () => {
    const priceCents = toActualCents(1.005, { expense: true });
    const payload = buildWallosSubscriptionPayload({ ...VALID_INPUT, priceCents });
    expect(payload.price).toBe('1.01');
    expect(mapWallosSubscription(wallosRecordFrom(payload, '1')).priceCents).toBe(priceCents);
  });
});

function captureMappingError(input: RecurringSubscriptionInput): WallosMappingError {
  try {
    buildWallosSubscriptionPayload(input);
  } catch (err) {
    if (err instanceof WallosMappingError) return err;
    throw err;
  }
  throw new Error('expected a WallosMappingError');
}

/** Shape Wallos returns on read for a payload just written. Extra read-only fields are added. */
function wallosRecordFrom(payload: WallosSubscriptionPayload, id: string): WallosSubscription {
  return {
    id,
    name: payload.name,
    price: payload.price,
    currency_id: payload.currency_id,
    cycle: payload.cycle,
    frequency: payload.frequency,
    next_payment: payload.next_payment,
    ...(payload.start_date !== undefined ? { start_date: payload.start_date } : {}),
    inactive: 0,
  };
}

/** The recurrence the read side reports for an input, with the default interval made explicit. */
function normalise(recurrence: ActualRecurrence): ActualRecurrence {
  return { frequency: recurrence.frequency, interval: recurrence.interval ?? 1 };
}

describe('WallosClient.createSubscription', () => {
  let db: AppDatabase;
  let a: UserRepo;
  const repoFor = (id: string) => createUserRepo(db, id);

  beforeEach(() => {
    db = openDatabase(':memory:');
    a = repoFor(createUser(db, { email: 'write-a@example.com', passwordHash: null }).id);
    const salt = a.getKeySalt();
    if (salt === undefined) throw new Error('no salt');
    a.upsertConfig({
      wallosUrl: 'https://wallos-a.test',
      wallosApiKeyEnc: encryptSecret(KEY_A, deriveUserKey(APP_SECRET, salt, a.userId)),
    });
  });

  afterEach(() => {
    closeDatabase(db);
  });

  const payload = () => buildWallosSubscriptionPayload(VALID_INPUT);

  it('posts to set_subscriptions with action=add and the key in the form body only', async () => {
    const stub = stubFetch(() => json({ success: true, title: 'Subscription added', subscriptionId: 55 }));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });

    await client.createSubscription(a.userId, payload());

    const [call] = stub.calls;
    expect(call?.method).toBe('POST');
    expect(call?.url).toBe('https://wallos-a.test/api/subscriptions/set_subscriptions.php');
    expect(call?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(call?.headers['x-api-key']).toBeUndefined();
    expect(call?.url).not.toContain(KEY_A);
    expect(call?.url).not.toContain('api_key');
    expect(JSON.stringify(call?.headers)).not.toContain(KEY_A);

    const form = new URLSearchParams(call?.body);
    expect(form.get('api_key')).toBe(KEY_A);
    expect(form.get('action')).toBe('add');
    expect(form.get('name')).toBe('Streaming service');
    expect(form.get('price')).toBe('12.50');
    expect(form.get('currency_id')).toBe('3');
    expect(form.get('cycle')).toBe('3');
    expect(form.get('frequency')).toBe('2');
    expect(form.get('next_payment')).toBe('2026-11-15');
    expect(form.get('start_date')).toBe('2026-01-15');
  });

  it('cannot be overridden by a caller-supplied api_key field', async () => {
    const stub = stubFetch(() => json({ success: true, title: 'Subscription added', subscriptionId: 1 }));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    const hostile = { ...payload(), api_key: 'attacker-key' } as WallosSubscriptionPayload;

    await client.createSubscription(a.userId, hostile);

    expect(new URLSearchParams(stub.calls[0]?.body).get('api_key')).toBe(KEY_A);
  });

  it('returns the new Wallos id from a success response', async () => {
    const stub = stubFetch(() => json({ success: true, title: 'Subscription added', subscriptionId: 55 }));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    expect(await client.createSubscription(a.userId, payload())).toBe('55');
  });

  it('maps an invalid key to WallosAuthError, both as HTTP 200 and as HTTP 401', async () => {
    const envelope = stubFetch(() => json({ success: false, title: 'Unauthorized', message: 'Invalid API key.' }));
    await expect(
      createWallosClient(repoFor, APP_SECRET, { fetch: envelope.fetch }).createSubscription(a.userId, payload()),
    ).rejects.toBeInstanceOf(WallosAuthError);

    const status = stubFetch(() => new Response('', { status: 401 }));
    await expect(
      createWallosClient(repoFor, APP_SECRET, { fetch: status.fetch }).createSubscription(a.userId, payload()),
    ).rejects.toBeInstanceOf(WallosAuthError);
  });

  it('maps a Wallos validation refusal to WallosRejectedError with its title', async () => {
    const stub = stubFetch(() =>
      json({ success: false, title: 'Invalid currency ID', message: 'The specified currency does not exist.' }),
    );
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    const err = await client.createSubscription(a.userId, payload()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WallosRejectedError);
    expect((err as WallosRejectedError).title).toBe('Invalid currency ID');
  });

  it('maps a non-2xx answer to WallosHttpError and a thrown fetch to WallosNetworkError', async () => {
    const server = stubFetch(() => new Response('', { status: 500 }));
    await expect(
      createWallosClient(repoFor, APP_SECRET, { fetch: server.fetch }).createSubscription(a.userId, payload()),
    ).rejects.toBeInstanceOf(WallosHttpError);

    const down = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(
      createWallosClient(repoFor, APP_SECRET, { fetch: down }).createSubscription(a.userId, payload()),
    ).rejects.toBeInstanceOf(WallosNetworkError);
  });

  it('treats a success envelope without a usable id as an HTTP error', async () => {
    const stub = stubFetch(() => json({ success: true, title: 'Subscription added' }));
    await expect(
      createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch }).createSubscription(a.userId, payload()),
    ).rejects.toBeInstanceOf(WallosHttpError);
  });
});


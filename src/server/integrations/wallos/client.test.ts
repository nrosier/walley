import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deriveUserKey } from '../../crypto/keys.js';
import { encryptSecret } from '../../crypto/secrets.js';
import { createUser } from '../../db/accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../../db/client.js';
import { createUserRepo, type UserRepo } from '../../db/repo.js';
import {
  WallosAuthError,
  WallosConfigMissing,
  WallosHttpError,
  WallosNetworkError,
  WallosRejectedError,
  createWallosClient,
} from './client.js';
import type { WallosCategory, WallosCurrency, WallosPaymentMethod } from './types.js';

const APP_SECRET = 'test-app-secret-test-app-secret-0123';
const KEY_A = 'key-A-7f3c9e1d2b';
const KEY_B = 'key-B-4a8d6c0e9f';

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

const ok = (subscriptions: unknown[]) =>
  json({ success: true, title: 'Subscriptions', subscriptions, notes: [] });

// Invented, sanitized fixtures in the shape of ellite/Wallos main d799b8f
// api/payment_methods/get_payment_methods.php and api/categories/get_categories.php.
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));
const PAYMENT_METHODS_FIXTURE = fixture('wallos-payment-methods.json');
const CATEGORIES_FIXTURE = fixture('wallos-categories.json');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('createWallosClient', () => {
  let db: AppDatabase;
  let a: UserRepo;
  let b: UserRepo;
  const repoFor = (id: string) => createUserRepo(db, id);

  function configure(repo: UserRepo, url: string, key: string) {
    const salt = repo.getKeySalt();
    if (salt === undefined) throw new Error('no salt');
    const enc = encryptSecret(key, deriveUserKey(APP_SECRET, salt, repo.userId));
    repo.upsertConfig({ wallosUrl: url, wallosApiKeyEnc: enc });
  }

  beforeEach(() => {
    db = openDatabase(':memory:');
    a = repoFor(createUser(db, { email: 'a@example.com', passwordHash: null }).id);
    b = repoFor(createUser(db, { email: 'b@example.com', passwordHash: null }).id);
    configure(a, 'https://wallos-a.test', KEY_A);
    configure(b, 'https://wallos-b.test/base/', KEY_B);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it("each user's call reaches only that user's host", async () => {
    const stub = stubFetch((url) =>
      ok(url.startsWith('https://wallos-a.test') ? [{ id: 1 }] : [{ id: 2 }]),
    );
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });

    expect(await client.listSubscriptions(a.userId)).toEqual([{ id: 1 }]);
    expect(await client.listSubscriptions(b.userId)).toEqual([{ id: 2 }]);

    expect(stub.calls.map((c) => c.url)).toEqual([
      'https://wallos-a.test/api/subscriptions/get_subscriptions.php',
      'https://wallos-b.test/base/api/subscriptions/get_subscriptions.php',
    ]);
    // Whatever header carries the key, A's key never goes to B's host and vice versa.
    expect(JSON.stringify(stub.calls[0])).not.toContain(KEY_B);
    expect(JSON.stringify(stub.calls[1])).not.toContain(KEY_A);
  });

  it("each call posts that user's key as a form field, not in the URL", async () => {
    const stub = stubFetch(() => ok([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await client.listSubscriptions(a.userId);
    await client.listSubscriptions(b.userId);
    const [ca, cb] = stub.calls;
    expect(ca?.method).toBe('POST');
    expect(ca?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(ca?.headers['x-api-key']).toBeUndefined();
    expect(new URLSearchParams(ca?.body).get('api_key')).toBe(KEY_A);
    expect(ca?.url).not.toContain(KEY_A);
    expect(ca?.url).not.toContain('api_key');
    expect(JSON.stringify(ca?.headers)).not.toContain(KEY_A);
    expect(ca?.body).not.toContain(KEY_B);
    expect(new URLSearchParams(cb?.body).get('api_key')).toBe(KEY_B);
    expect(cb?.url).not.toContain(KEY_B);
    expect(cb?.body).not.toContain(KEY_A);
  });

  it('HTTP 200 with success:false gives WallosAuthError and leaks nothing', async () => {
    const stub = stubFetch(() => json({ success: false, title: `Invalid API key ${KEY_A}` }));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    const err = await client.listSubscriptions(a.userId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WallosAuthError);
    expect(String(err)).not.toContain(KEY_A);
  });

  it('maps the response only through the typed fields', async () => {
    const stub = stubFetch(() =>
      ok([
        { id: 7, name: 'Netflix', price: 9.99, category_ids: [1, 2], secret_extra: 'x' },
        { id: '8' },
      ]),
    );
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    expect(await client.listSubscriptions(a.userId)).toEqual([
      { id: 7, name: 'Netflix', price: 9.99, category_ids: [1, 2] },
      { id: '8' },
    ]);
  });

  it('drops disabled items (inactive 1 or true) and keeps enabled ones', async () => {
    const stub = stubFetch(() =>
      ok([
        { id: 1, inactive: 1 },
        { id: 2, inactive: true },
        { id: 3, inactive: 0 },
        { id: 4, inactive: false },
        { id: 5 },
      ]),
    );
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    expect(await client.listSubscriptions(a.userId)).toEqual([
      { id: 3, inactive: 0 },
      { id: 4, inactive: false },
      { id: 5 },
    ]);
  });

  it.each([
    ['a bare array', [{ id: 1 }]],
    ['a missing success flag', { subscriptions: [] }],
    ['a missing subscriptions list', { success: true }],
    ['a subscription without an id', { success: true, subscriptions: [{ name: 'x' }] }],
    ['a null body', null],
  ])('%s gives WallosHttpError', async (_label, body) => {
    const stub = stubFetch(() => json(body));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(a.userId)).rejects.toBeInstanceOf(WallosHttpError);
  });

  it('a non-JSON body gives WallosHttpError', async () => {
    const stub = stubFetch(() => new Response('<html>', { status: 200 }));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(a.userId)).rejects.toBeInstanceOf(WallosHttpError);
  });

  it('a failing call does not leak the key or the query string', async () => {
    const leaky = 'https://wallos-a.test/?token=secret-query';
    const responses: Array<() => Response | Promise<Response>> = [
      () => json({ error: `bad key ${KEY_A}` }, 401),
      () => json({ error: `boom ${KEY_A}` }, 500),
      () => Promise.reject(new Error(`connect failed ${KEY_A} ${leaky}`)),
    ];
    for (const respond of responses) {
      const stub = stubFetch(respond);
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      const err = await client.listSubscriptions(a.userId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      const text = `${String(err)} ${(err as Error).message} ${JSON.stringify(err)}`;
      expect(text).not.toContain(KEY_A);
      expect(text).not.toContain('secret-query');
      expect(text).not.toContain('token=');
    }

    a.upsertConfig({ wallosUrl: leaky });
    const stub = stubFetch(() => ok([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    const err = await client.listSubscriptions(a.userId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WallosConfigMissing);
    expect(String(err)).not.toContain('secret-query');
    expect(String(err)).not.toContain(KEY_A);
    expect(stub.calls).toHaveLength(0);
  });

  it('401 gives WallosAuthError', async () => {
    const stub = stubFetch(() => new Response('no', { status: 401 }));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(a.userId)).rejects.toBeInstanceOf(WallosAuthError);
  });

  it('500 gives WallosHttpError with the status', async () => {
    const stub = stubFetch(() => new Response('oops', { status: 500 }));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    const err = await client.listSubscriptions(a.userId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WallosHttpError);
    expect((err as WallosHttpError).status).toBe(500);
    expect((err as Error).message).not.toContain('oops');
  });

  it('a thrown fetch gives WallosNetworkError with no inner message', async () => {
    const stub = stubFetch(() => Promise.reject(new Error('ECONNREFUSED inner detail')));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    const err = await client.listSubscriptions(a.userId).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WallosNetworkError);
    expect((err as Error).message).not.toContain('inner detail');
    expect((err as Error).cause).toBeUndefined();
  });

  it('the timeout gives WallosNetworkError', async () => {
    const stub = stubFetch(() => new Promise<Response>(() => undefined));
    const hanging = (async (input: string | URL | Request, init?: RequestInit) => {
      void stub.fetch(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason as Error);
        });
      });
    }) as typeof fetch;
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: hanging, timeoutMs: 20 });
    await expect(client.listSubscriptions(a.userId)).rejects.toBeInstanceOf(WallosNetworkError);
  });

  it('a missing config row gives WallosConfigMissing', async () => {
    const c = repoFor(createUser(db, { email: 'c@example.com', passwordHash: null }).id);
    const stub = stubFetch(() => ok([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(c.userId)).rejects.toBeInstanceOf(WallosConfigMissing);
    expect(stub.calls).toHaveLength(0);
  });

  it('an http URL with a query string gives WallosConfigMissing', async () => {
    a.upsertConfig({ wallosUrl: 'http://wallos-a.test/?x=1' });
    const stub = stubFetch(() => ok([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(a.userId)).rejects.toBeInstanceOf(WallosConfigMissing);
    expect(stub.calls).toHaveLength(0);
  });

  it.each([
    'ftp://wallos-a.test',
    'https://user:pass@wallos-a.test',
    'https://wallos-a.test/#frag',
    'not a url',
    '',
  ])('rejects the stored URL %j with WallosConfigMissing', async (url) => {
    a.upsertConfig({ wallosUrl: url });
    const stub = stubFetch(() => ok([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(a.userId)).rejects.toBeInstanceOf(WallosConfigMissing);
    expect(stub.calls).toHaveLength(0);
  });

  it('an empty key gives WallosConfigMissing', async () => {
    a.upsertConfig({ wallosApiKeyEnc: '' });
    const stub = stubFetch(() => ok([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(a.userId)).rejects.toBeInstanceOf(WallosConfigMissing);
  });

  describe('listCurrencies', () => {
    // Saved fixture: the documented example in ellite/Wallos api/currencies/get_currencies.php.
    const CURRENCY_EXAMPLE = {
      success: true,
      title: 'currencies',
      main_currency: 3,
      currencies: [
        { id: 1, name: 'US Dollar', symbol: '$', code: 'USD', rate: '1.1000', in_use: true },
        { id: 2, name: 'Japanese Yen', symbol: '¥', code: 'JPY', rate: '150.0000', in_use: true },
        { id: 3, name: 'Euro', symbol: '€', code: 'EUR', rate: '1.0000', in_use: true },
      ],
      notes: [],
    };
    const CURRENCIES_URL = 'https://wallos-a.test/api/currencies/get_currencies.php';

    it('POSTs the key as a form field to the currencies endpoint, not in the URL', async () => {
      const stub = stubFetch(() => json(CURRENCY_EXAMPLE));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await client.listCurrencies(a.userId);
      const [call] = stub.calls;
      expect(call?.url).toBe(CURRENCIES_URL);
      expect(call?.method).toBe('POST');
      expect(call?.headers['content-type']).toBe('application/x-www-form-urlencoded');
      expect(new URLSearchParams(call?.body).get('api_key')).toBe(KEY_A);
      expect(call?.url).not.toContain(KEY_A);
      expect(call?.url).not.toContain('api_key');
      expect(JSON.stringify(call?.headers)).not.toContain(KEY_A);
    });

    it('keeps only id, code, name and rate from each currency', async () => {
      const stub = stubFetch(() => json(CURRENCY_EXAMPLE));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      const expected: WallosCurrency[] = [
        { id: 1, name: 'US Dollar', code: 'USD', rate: '1.1000' },
        { id: 2, name: 'Japanese Yen', code: 'JPY', rate: '150.0000' },
        { id: 3, name: 'Euro', code: 'EUR', rate: '1.0000' },
      ];
      expect(await client.listCurrencies(a.userId)).toEqual(expected);
    });

    it('uses the same user-scoped host and key as subscriptions', async () => {
      const stub = stubFetch(() => json(CURRENCY_EXAMPLE));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await client.listCurrencies(b.userId);
      expect(stub.calls[0]?.url).toBe(
        'https://wallos-b.test/base/api/currencies/get_currencies.php',
      );
      expect(new URLSearchParams(stub.calls[0]?.body).get('api_key')).toBe(KEY_B);
    });

    it('HTTP 200 with success:false gives WallosAuthError and leaks nothing', async () => {
      const stub = stubFetch(() => json({ success: false, title: `Invalid API key ${KEY_A}` }));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      const err = await client.listCurrencies(a.userId).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(WallosAuthError);
      expect(String(err)).not.toContain(KEY_A);
    });

    it('HTTP 401 gives WallosAuthError', async () => {
      const stub = stubFetch(() => json({ success: false }, 401));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await expect(client.listCurrencies(a.userId)).rejects.toBeInstanceOf(WallosAuthError);
    });

    it('a body without a currencies array gives WallosHttpError', async () => {
      const stub = stubFetch(() => json({ success: true, title: 'currencies' }));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await expect(client.listCurrencies(a.userId)).rejects.toBeInstanceOf(WallosHttpError);
    });

    it('a currency without a usable code gives WallosHttpError', async () => {
      const stub = stubFetch(() =>
        json({ success: true, currencies: [{ id: 1, code: '  ' }] }),
      );
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await expect(client.listCurrencies(a.userId)).rejects.toBeInstanceOf(WallosHttpError);
    });

    it('an unconfigured user gives WallosConfigMissing without calling fetch', async () => {
      const c = repoFor(createUser(db, { email: 'c@example.com', passwordHash: null }).id);
      const stub = stubFetch(() => json(CURRENCY_EXAMPLE));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await expect(client.listCurrencies(c.userId)).rejects.toBeInstanceOf(WallosConfigMissing);
      expect(stub.calls).toHaveLength(0);
    });
  });
  describe('listPaymentMethods', () => {
    it('maps the fixture to id strings and names, keeping only enabled methods', async () => {
      const stub = stubFetch(() => json(PAYMENT_METHODS_FIXTURE));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      const expected: WallosPaymentMethod[] = [
        { id: '1', name: 'Example Card' },
        { id: '2', name: 'Example Transfer' },
      ];
      expect(await client.listPaymentMethods(a.userId)).toEqual(expected);
      const [call] = stub.calls;
      expect(call?.url).toBe('https://wallos-a.test/api/payment_methods/get_payment_methods.php');
      expect(call?.method).toBe('POST');
      expect(new URLSearchParams(call?.body).get('api_key')).toBe(KEY_A);
      expect(call?.url).not.toContain(KEY_A);
    });

    it('excludes a disabled payment method', async () => {
      const stub = stubFetch(() =>
        json({
          success: true,
          payment_methods: [
            { id: 7, name: 'Off', enabled: 0 },
            { id: '8', name: 'On', enabled: 1 },
          ],
        }),
      );
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      expect(await client.listPaymentMethods(a.userId)).toEqual([{ id: '8', name: 'On' }]);
    });

    it('an empty list returns an empty array', async () => {
      const stub = stubFetch(() => json({ success: true, payment_methods: [] }));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      expect(await client.listPaymentMethods(a.userId)).toEqual([]);
    });

    it("reads only the given user's host and key", async () => {
      const stub = stubFetch(() => json(PAYMENT_METHODS_FIXTURE));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await client.listPaymentMethods(b.userId);
      expect(stub.calls[0]?.url).toBe(
        'https://wallos-b.test/base/api/payment_methods/get_payment_methods.php',
      );
      expect(new URLSearchParams(stub.calls[0]?.body).get('api_key')).toBe(KEY_B);
    });

    it('HTTP 200 with success:false gives WallosAuthError', async () => {
      const stub = stubFetch(() => json({ success: false, title: 'Invalid API key' }));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await expect(client.listPaymentMethods(a.userId)).rejects.toBeInstanceOf(WallosAuthError);
    });

    it('a body without a payment_methods array or with an unusable id gives WallosHttpError', async () => {
      const missing = stubFetch(() => json({ success: true }));
      await expect(
        createWallosClient(repoFor, APP_SECRET, { fetch: missing.fetch }).listPaymentMethods(a.userId),
      ).rejects.toBeInstanceOf(WallosHttpError);
      const badId = stubFetch(() =>
        json({ success: true, payment_methods: [{ id: 'x1', name: 'Card', enabled: 1 }] }),
      );
      await expect(
        createWallosClient(repoFor, APP_SECRET, { fetch: badId.fetch }).listPaymentMethods(a.userId),
      ).rejects.toBeInstanceOf(WallosHttpError);
    });

    it('a thrown fetch gives WallosNetworkError', async () => {
      const client = createWallosClient(repoFor, APP_SECRET, {
        fetch: () => Promise.reject(new Error('down')),
      });
      await expect(client.listPaymentMethods(a.userId)).rejects.toBeInstanceOf(WallosNetworkError);
    });
  });

  describe('listCategories', () => {
    it('maps the fixture to id strings and names only', async () => {
      const stub = stubFetch(() => json(CATEGORIES_FIXTURE));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      const expected: WallosCategory[] = [
        { id: '1', name: 'Example Streaming' },
        { id: '2', name: 'Example Utilities' },
      ];
      expect(await client.listCategories(a.userId)).toEqual(expected);
      const [call] = stub.calls;
      expect(call?.url).toBe('https://wallos-a.test/api/categories/get_categories.php');
      expect(new URLSearchParams(call?.body).get('api_key')).toBe(KEY_A);
    });

    it('an empty list returns an empty array', async () => {
      const stub = stubFetch(() => json({ success: true, categories: [] }));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      expect(await client.listCategories(a.userId)).toEqual([]);
    });

    it("reads only the given user's host and key", async () => {
      const stub = stubFetch(() => json(CATEGORIES_FIXTURE));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await client.listCategories(b.userId);
      expect(stub.calls[0]?.url).toBe('https://wallos-b.test/base/api/categories/get_categories.php');
      expect(new URLSearchParams(stub.calls[0]?.body).get('api_key')).toBe(KEY_B);
    });

    it('HTTP 200 with success:false gives WallosAuthError', async () => {
      const stub = stubFetch(() => json({ success: false, title: 'Invalid API key' }));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await expect(client.listCategories(a.userId)).rejects.toBeInstanceOf(WallosAuthError);
    });

    it('a category without a name gives WallosHttpError', async () => {
      const stub = stubFetch(() => json({ success: true, categories: [{ id: 1, name: ' ' }] }));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await expect(client.listCategories(a.userId)).rejects.toBeInstanceOf(WallosHttpError);
    });
  });

  describe('updateSubscription', () => {
    it('posts action=edit with id, only the given fields and api_key last, to the user host', async () => {
      const stub = stubFetch(() => json({ success: true, title: 'Subscription updated' }));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      await client.updateSubscription(a.userId, '7', { next_payment: '2026-11-03', price: '14.99' });
      const call = stub.calls[0];
      expect(call?.url).toBe('https://wallos-a.test/api/subscriptions/set_subscriptions.php');
      expect(call?.method).toBe('POST');
      const params = new URLSearchParams(call?.body);
      expect([...params.keys()]).toEqual(['next_payment', 'price', 'action', 'id', 'api_key']);
      expect(params.get('action')).toBe('edit');
      expect(params.get('id')).toBe('7');
      expect(params.get('api_key')).toBe(KEY_A);
      expect(call?.url).not.toContain(KEY_A);
    });

    it('maps success:false to WallosAuthError or WallosRejectedError and rejects a non-numeric id before fetch', async () => {
      let title = 'Invalid API key';
      const stub = stubFetch(() => json({ success: false, title }));
      const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
      title = 'Unauthorized';
      await expect(client.updateSubscription(a.userId, '7', { next_payment: '2026-11-03' })).rejects.toBeInstanceOf(WallosAuthError);
      title = 'Invalid currency ID';
      await expect(client.updateSubscription(a.userId, '7', { next_payment: '2026-11-03' })).rejects.toBeInstanceOf(WallosRejectedError);
      const before = stub.calls.length;
      await expect(client.updateSubscription(a.userId, '7&x=1', { next_payment: '2026-11-03' })).rejects.toBeInstanceOf(WallosRejectedError);
      expect(stub.calls).toHaveLength(before);
    });
  });
});

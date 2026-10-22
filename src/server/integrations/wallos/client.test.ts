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
  createWallosClient,
} from './client.js';

const APP_SECRET = 'test-app-secret-test-app-secret-0123';
const KEY_A = 'key-A-7f3c9e1d2b';
const KEY_B = 'key-B-4a8d6c0e9f';

interface Call {
  url: string;
  headers: Record<string, string>;
}

function stubFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    calls.push({ url, headers });
    return respond(url);
  };
  return { calls, fetch: impl };
}

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
      json(url.startsWith('https://wallos-a.test') ? [{ id: 1 }] : [{ id: 2 }]),
    );
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });

    expect(await client.listSubscriptions(a.userId)).toEqual([{ id: 1 }]);
    expect(await client.listSubscriptions(b.userId)).toEqual([{ id: 2 }]);

    expect(stub.calls.map((c) => c.url)).toEqual([
      'https://wallos-a.test/api/subscriptions',
      'https://wallos-b.test/base/api/subscriptions',
    ]);
    // Whatever header carries the key, A's key never goes to B's host and vice versa.
    expect(JSON.stringify(stub.calls[0])).not.toContain(KEY_B);
    expect(JSON.stringify(stub.calls[1])).not.toContain(KEY_A);
  });

  it("each call sends that user's key in the x-api-key header", async () => {
    const stub = stubFetch(() => json([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await client.listSubscriptions(a.userId);
    await client.listSubscriptions(b.userId);
    expect(stub.calls[0]?.headers['x-api-key']).toBe(KEY_A);
    expect(stub.calls[0]?.headers['accept']).toBe('application/json');
    expect(JSON.stringify(stub.calls[0])).not.toContain(KEY_B);
    expect(stub.calls[1]?.headers['x-api-key']).toBe(KEY_B);
    expect(JSON.stringify(stub.calls[1])).not.toContain(KEY_A);
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
    const stub = stubFetch(() => json([]));
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
    const stub = stubFetch(() => json([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(c.userId)).rejects.toBeInstanceOf(WallosConfigMissing);
    expect(stub.calls).toHaveLength(0);
  });

  it('an http URL with a query string gives WallosConfigMissing', async () => {
    a.upsertConfig({ wallosUrl: 'http://wallos-a.test/?x=1' });
    const stub = stubFetch(() => json([]));
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
    const stub = stubFetch(() => json([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(a.userId)).rejects.toBeInstanceOf(WallosConfigMissing);
    expect(stub.calls).toHaveLength(0);
  });

  it('an empty key gives WallosConfigMissing', async () => {
    a.upsertConfig({ wallosApiKeyEnc: '' });
    const stub = stubFetch(() => json([]));
    const client = createWallosClient(repoFor, APP_SECRET, { fetch: stub.fetch });
    await expect(client.listSubscriptions(a.userId)).rejects.toBeInstanceOf(WallosConfigMissing);
  });
});

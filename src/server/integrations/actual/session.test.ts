import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
let active = 0;
let maxActive = 0;
let failOpen = false;
const inits: { dataDir?: string; serverURL?: string; password?: string }[] = [];
const downloads: { id: string; opts: unknown }[] = [];

vi.mock('@actual-app/api', () => ({
  init: vi.fn(async (config: { dataDir?: string; serverURL?: string; password?: string }) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    calls.push('init');
    inits.push(config);
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (failOpen) {
      throw new Error(`boom ${config.password ?? ''}`);
    }
  }),
  downloadBudget: vi.fn(async (id: string, opts: unknown) => {
    calls.push('download');
    downloads.push({ id, opts });
  }),
  sync: vi.fn(async () => {
    calls.push('sync');
  }),
  shutdown: vi.fn(async () => {
    calls.push('shutdown');
    active -= 1;
  }),
}));

import { encryptSecret } from '../../crypto/secrets.js';
import { deriveUserKey } from '../../crypto/keys.js';
import { closeDatabase, openDatabase, type AppDatabase } from '../../db/client.js';
import { createUserRepo } from '../../db/repo.js';
import { createUser } from '../../db/accounts.js';
import { ActualSessionError, withActualServer, withActualSession } from './session.js';

const APP_SECRET = 'a'.repeat(40);
const PW_A = 'password-of-user-a-xyz';
const PW_B = 'password-of-user-b-xyz';
const SYNC_A = 'sync-key-of-user-a-xyz';

let db: AppDatabase;
let dataDir: string;

const ids = new Map<string, string>();
const idOf = (name: string): string => ids.get(name) ?? '';

function addUser(name: string, password?: string, syncKey?: string): void {
  const { id } = createUser(db, { email: `${name}@example.com`, passwordHash: null });
  ids.set(name, id);
  if (password === undefined) {
    return;
  }
  const repo = createUserRepo(db, id);
  const keySalt = repo.getKeySalt() ?? Buffer.alloc(0);
  const key = deriveUserKey(APP_SECRET, keySalt, id);
  repo.upsertConfig({
    actualUrl: `https://actual-${name}.example.com`,
    actualPasswordEnc: encryptSecret(password, key),
    ...(syncKey === undefined ? {} : { actualSyncKeyEnc: encryptSecret(syncKey, key) }),
    actualBudgetId: `budget-${name}`,
  });
}

const deps = () => ({ db, appSecret: APP_SECRET, dataDir });

beforeEach(() => {
  calls.length = 0;
  inits.length = 0;
  downloads.length = 0;
  active = 0;
  maxActive = 0;
  failOpen = false;
  db = openDatabase(':memory:');
  dataDir = mkdtempSync(join(tmpdir(), 'walley-actual-'));
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dataDir, { recursive: true, force: true });
});

describe('withActualSession', () => {
  it('opens with the decrypted credentials in the user data dir and returns the callback result', async () => {
    addUser('u1', PW_A, SYNC_A);
    const result = await withActualSession(deps(), idOf('u1'), async () => 42);
    expect(result).toBe(42);
    expect(calls).toEqual(['init', 'download', 'shutdown']);
    expect(inits[0]).toEqual({
      dataDir: join(dataDir, 'actual', idOf('u1')),
      serverURL: 'https://actual-u1.example.com',
      password: PW_A,
    });
    expect(downloads[0]).toEqual({ id: 'budget-u1', opts: { password: SYNC_A } });
    expect(existsSync(join(dataDir, 'actual', idOf('u1')))).toBe(true);
  });

  it('omits the budget password when there is no sync key', async () => {
    addUser('u1', PW_A);
    await withActualSession(deps(), idOf('u1'), async () => undefined);
    expect(downloads[0]?.opts).toBeUndefined();
  });

  it('serializes users and gives each their own data dir', async () => {
    addUser('u1', PW_A);
    addUser('u2', PW_B);
    const run = (id: string) =>
      withActualSession(deps(), idOf(id), async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return id;
      });
    const results = await Promise.all([run('u1'), run('u2')]);
    expect(results).toEqual(['u1', 'u2']);
    expect(maxActive).toBe(1);
    expect(calls).toEqual(['init', 'download', 'shutdown', 'init', 'download', 'shutdown']);
    expect(inits.map((i) => i.dataDir)).toEqual([
      join(dataDir, 'actual', idOf('u1')),
      join(dataDir, 'actual', idOf('u2')),
    ]);
  });

  it('reads only the calling user config', async () => {
    addUser('u1', PW_A);
    addUser('u2', PW_B);
    await withActualSession(deps(), idOf('u2'), async () => undefined);
    expect(inits[0]?.serverURL).toBe('https://actual-u2.example.com');
    expect(inits[0]?.password).toBe(PW_B);
    expect(downloads[0]?.id).toBe('budget-u2');
    expect(JSON.stringify(inits)).not.toContain(PW_A);
  });

  it('refuses a user with no config and never opens', async () => {
    addUser('u1', PW_A);
    addUser('u3');
    await expect(withActualSession(deps(), idOf('u3'), async () => 1)).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(calls).toEqual([]);
  });

  it('shuts down when the callback throws, and rethrows it', async () => {
    addUser('u1', PW_A);
    await expect(
      withActualSession(deps(), idOf('u1'), async () => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
    expect(calls).toEqual(['init', 'download', 'shutdown']);
  });

  it('shuts down when open fails, with an error that holds no credential', async () => {
    addUser('u1', PW_A, SYNC_A);
    failOpen = true;
    const error = await withActualSession(deps(), idOf('u1'), async () => 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActualSessionError);
    expect(calls).toEqual(['init', 'shutdown']);
    const text = JSON.stringify(error) + (error as Error).message + ((error as Error).stack ?? '');
    expect(text).not.toContain(PW_A);
    expect(text).not.toContain(SYNC_A);
    expect((error as Error).cause).toBeUndefined();
  });

  it('keeps the queue moving after a failure', async () => {
    addUser('u1', PW_A);
    addUser('u2', PW_B);
    failOpen = true;
    await expect(withActualSession(deps(), idOf('u1'), async () => 1)).rejects.toBeInstanceOf(
      ActualSessionError,
    );
    failOpen = false;
    await expect(withActualSession(deps(), idOf('u2'), async () => 2)).resolves.toBe(2);
  });

  it('logs nothing', async () => {
    addUser('u1', PW_A, SYNC_A);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    await withActualSession(deps(), idOf('u1'), async () => 1);
    failOpen = true;
    await withActualSession(deps(), idOf('u1'), async () => 1).catch(() => undefined);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('withActualServer', () => {
  it('signs in with the server credentials only and never downloads a budget', async () => {
    addUser('u1', PW_A, SYNC_A);
    const result = await withActualServer(deps(), idOf('u1'), async () => 'ok');
    expect(result).toBe('ok');
    expect(calls).toEqual(['init', 'shutdown']);
    expect(inits[0]).toEqual({
      dataDir: join(dataDir, 'actual', idOf('u1')),
      serverURL: 'https://actual-u1.example.com',
      password: PW_A,
    });
    expect(downloads).toEqual([]);
  });

  it('works before a budget is chosen', async () => {
    const { id } = createUser(db, { email: 'nb@example.com', passwordHash: null });
    const repo = createUserRepo(db, id);
    const key = deriveUserKey(APP_SECRET, repo.getKeySalt() ?? Buffer.alloc(0), id);
    repo.upsertConfig({ actualUrl: 'https://nb.example.com', actualPasswordEnc: encryptSecret(PW_A, key) });
    await expect(withActualServer(deps(), id, async () => 1)).resolves.toBe(1);
    await expect(withActualSession(deps(), id, async () => 1)).rejects.toMatchObject({
      code: 'not_configured',
    });
  });

  it('refuses a user without url or password and never opens', async () => {
    addUser('u3');
    await expect(withActualServer(deps(), idOf('u3'), async () => 1)).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(calls).toEqual([]);
  });

  it('shuts down when the callback throws, and rethrows it', async () => {
    addUser('u1', PW_A);
    await expect(
      withActualServer(deps(), idOf('u1'), async () => {
        throw new Error('callback failed');
      }),
    ).rejects.toThrow('callback failed');
    expect(calls).toEqual(['init', 'shutdown']);
  });

  it('shuts down when init fails, with an error that holds no credential', async () => {
    addUser('u1', PW_A, SYNC_A);
    failOpen = true;
    const error = await withActualServer(deps(), idOf('u1'), async () => 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ActualSessionError);
    expect((error as ActualSessionError).code).toBe('open_failed');
    expect(calls).toEqual(['init', 'shutdown']);
    const text = JSON.stringify(error) + (error as Error).message + ((error as Error).stack ?? '');
    expect(text).not.toContain(PW_A);
    expect((error as Error).cause).toBeUndefined();
  });

  it('shares one queue with withActualSession', async () => {
    addUser('u1', PW_A);
    addUser('u2', PW_B);
    const slow = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    };
    await Promise.all([
      withActualSession(deps(), idOf('u1'), slow),
      withActualServer(deps(), idOf('u2'), slow),
      withActualSession(deps(), idOf('u2'), slow),
    ]);
    expect(maxActive).toBe(1);
    expect(calls).toEqual([
      'init', 'download', 'shutdown',
      'init', 'shutdown',
      'init', 'download', 'shutdown',
    ]);
  });
});

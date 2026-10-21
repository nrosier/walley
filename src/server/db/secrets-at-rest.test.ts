import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptSecret, DecryptError, encryptSecret } from '../crypto/secrets.js';
import { deriveUserKey } from '../crypto/keys.js';
import { createUser } from './accounts.js';
import { closeDatabase, openDatabase, type AppDatabase } from './client.js';
import { createUserRepo } from './repo.js';

const APP_SECRET = 'test-app-secret-value-0123456789abcdef';

describe('secrets at rest', () => {
  let db: AppDatabase;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('stores ciphertext that only the owner key decrypts', () => {
    const idA = createUser(db, { email: 'a@example.com', passwordHash: null }).id;
    const idB = createUser(db, { email: 'b@example.com', passwordHash: null }).id;
    const repoA = createUserRepo(db, idA);
    const repoB = createUserRepo(db, idB);
    const keyA = deriveUserKey(APP_SECRET, repoA.getKeySalt() as Buffer, idA);
    const keyB = deriveUserKey(APP_SECRET, repoB.getKeySalt() as Buffer, idB);

    repoA.upsertConfig({ wallosApiKeyEnc: encryptSecret('the-key', keyA) });

    const raw = db.$client
      .prepare('SELECT wallos_api_key_enc AS v FROM user_configs WHERE user_id = ?')
      .get(idA) as { v: string };
    expect(raw.v).not.toBe('the-key');
    expect(raw.v).not.toContain('the-key');

    const stored = repoA.getConfig()?.wallosApiKeyEnc as string;
    expect(decryptSecret(stored, keyA)).toBe('the-key');
    expect(() => decryptSecret(stored, keyB)).toThrow(DecryptError);
  });
});

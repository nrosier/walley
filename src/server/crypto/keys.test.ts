import { describe, expect, it } from 'vitest';
import { KEY_SALT_BYTES, deriveUserKey, newKeySalt } from './keys.js';
import { DecryptError, decryptSecret, encryptSecret } from './secrets.js';

const APP_SECRET = 'walley-test-app-secret-0123456789abcdef';
const SALT = Buffer.alloc(KEY_SALT_BYTES, 0x01);
const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
const GOLDEN_KEY_HEX = 'd6fd2c0351000bc95a925da3a63ce516d1c84e1d26f95d7a3237cbd957599a0f';

describe('deriveUserKey', () => {
  it('returns 32 bytes', () => {
    const key = deriveUserKey(APP_SECRET, SALT, USER_ID);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('returns the same key for the same appSecret, salt and user id', () => {
    const a = deriveUserKey(APP_SECRET, SALT, USER_ID);
    const b = deriveUserKey(APP_SECRET, Buffer.from(SALT), USER_ID);
    expect(a.equals(b)).toBe(true);
  });

  it('matches the HKDF-SHA256 golden vector', () => {
    expect(deriveUserKey(APP_SECRET, SALT, USER_ID).toString('hex')).toBe(GOLDEN_KEY_HEX);
  });

  it('derives different keys for different user ids', () => {
    const a = deriveUserKey(APP_SECRET, SALT, USER_ID);
    const b = deriveUserKey(APP_SECRET, SALT, OTHER_USER_ID);
    expect(a.equals(b)).toBe(false);
  });

  it('derives different keys for different salts', () => {
    const a = deriveUserKey(APP_SECRET, SALT, USER_ID);
    const b = deriveUserKey(APP_SECRET, Buffer.alloc(KEY_SALT_BYTES, 0x02), USER_ID);
    expect(a.equals(b)).toBe(false);
  });

  it('derives a different key for a different appSecret', () => {
    const a = deriveUserKey(APP_SECRET, SALT, USER_ID);
    const b = deriveUserKey(`${APP_SECRET}-other`, SALT, USER_ID);
    expect(a.equals(b)).toBe(false);
  });

  it('rejects an empty appSecret with TypeError', () => {
    expect(() => deriveUserKey('', SALT, USER_ID)).toThrow(TypeError);
  });

  it('rejects an empty userId with TypeError', () => {
    expect(() => deriveUserKey(APP_SECRET, SALT, '')).toThrow(TypeError);
  });

  it('rejects a salt of the wrong length with TypeError', () => {
    expect(() => deriveUserKey(APP_SECRET, Buffer.alloc(KEY_SALT_BYTES - 1, 0x01), USER_ID)).toThrow(
      TypeError,
    );
    expect(() => deriveUserKey(APP_SECRET, Buffer.alloc(KEY_SALT_BYTES + 1, 0x01), USER_ID)).toThrow(
      TypeError,
    );
    expect(() => deriveUserKey(APP_SECRET, Buffer.alloc(0), USER_ID)).toThrow(TypeError);
  });

  it('keeps the secret, salt and key out of error messages', () => {
    const cases: Array<() => unknown> = [
      () => deriveUserKey('', SALT, USER_ID),
      () => deriveUserKey(APP_SECRET, SALT, ''),
      () => deriveUserKey(APP_SECRET, Buffer.alloc(5, 0x01), USER_ID),
    ];
    for (const run of cases) {
      let message = '';
      try {
        run();
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : '';
      }
      expect(message).not.toBe('');
      expect(message).not.toContain(APP_SECRET);
      expect(message).not.toContain(GOLDEN_KEY_HEX);
      expect(message).not.toContain(SALT.toString('hex'));
    }
  });

  it('makes a value encrypted for user A undecryptable with user B key', () => {
    const keyA = deriveUserKey(APP_SECRET, SALT, USER_ID);
    const keyB = deriveUserKey(APP_SECRET, SALT, OTHER_USER_ID);
    const stored = encryptSecret('wallos-api-key-PLAINTEXT', keyA);
    expect(decryptSecret(stored, keyA)).toBe('wallos-api-key-PLAINTEXT');
    expect(() => decryptSecret(stored, keyB)).toThrow(DecryptError);
  });
});

describe('newKeySalt', () => {
  it('returns 32 bytes and a different value each call', () => {
    const a = newKeySalt();
    const b = newKeySalt();
    expect(a.length).toBe(KEY_SALT_BYTES);
    expect(b.length).toBe(KEY_SALT_BYTES);
    expect(a.equals(b)).toBe(false);
  });
});

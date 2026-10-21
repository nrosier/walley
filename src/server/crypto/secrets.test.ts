import { describe, expect, it } from 'vitest';
import { DecryptError, decryptSecret, encryptSecret } from './secrets.js';

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const PLAINTEXT = 'wallos-api-key-PLAINTEXT-123';

function flipByte(ciphertext: string, index: number): string {
  const payload = Buffer.from(ciphertext.slice(3), 'base64');
  payload[index] = (payload[index] ?? 0) ^ 0x01;
  return `v1:${payload.toString('base64')}`;
}

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error: unknown) {
    return error;
  }
  throw new Error('expected function to throw');
}

describe('encryptSecret and decryptSecret', () => {
  it.each([
    ['ASCII', 'hunter2-correct-horse'],
    ['unicode', 'pässwörd-日本語-🔐'],
    ['empty', ''],
  ])('round-trips %s plaintext', (_label, plaintext) => {
    expect(decryptSecret(encryptSecret(plaintext, KEY), KEY)).toBe(plaintext);
  });

  it('gives different output for the same plaintext', () => {
    expect(encryptSecret(PLAINTEXT, KEY)).not.toBe(encryptSecret(PLAINTEXT, KEY));
  });

  it('formats output as v1: plus base64 of iv(12) + tag(16) + ciphertext', () => {
    const out = encryptSecret(PLAINTEXT, KEY);
    expect(out.startsWith('v1:')).toBe(true);
    const payload = Buffer.from(out.slice(3), 'base64');
    expect(payload.toString('base64')).toBe(out.slice(3));
    expect(payload.length).toBe(12 + 16 + Buffer.byteLength(PLAINTEXT, 'utf8'));
  });

  it('produces a 28-byte payload for empty plaintext', () => {
    const payload = Buffer.from(encryptSecret('', KEY).slice(3), 'base64');
    expect(payload.length).toBe(28);
  });
});

describe('decryptSecret rejects bad data with DecryptError', () => {
  const valid = encryptSecret(PLAINTEXT, KEY);

  it.each([
    ['an IV byte', 0],
    ['a tag byte', 12],
    ['a ciphertext byte', 28],
  ])('when %s is flipped', (_label, index) => {
    expect(() => decryptSecret(flipByte(valid, index), KEY)).toThrow(DecryptError);
  });

  it('when the prefix is missing', () => {
    expect(() => decryptSecret(valid.slice(3), KEY)).toThrow(DecryptError);
    expect(() => decryptSecret(`v2:${valid.slice(3)}`, KEY)).toThrow(DecryptError);
  });

  it('when the base64 is not canonical', () => {
    expect(() => decryptSecret('v1:ab!!cd', KEY)).toThrow(DecryptError);
    expect(() => decryptSecret(`v1:${valid.slice(3)}\n`, KEY)).toThrow(DecryptError);
    expect(() => decryptSecret(`v1:${valid.slice(3).replace(/=+$/, '')}x`, KEY)).toThrow(
      DecryptError,
    );
  });

  it('when the decoded payload is shorter than 28 bytes', () => {
    const short = `v1:${Buffer.alloc(27, 1).toString('base64')}`;
    expect(() => decryptSecret(short, KEY)).toThrow(DecryptError);
    expect(() => decryptSecret('v1:', KEY)).toThrow(DecryptError);
  });

  it('when the key is wrong', () => {
    expect(() => decryptSecret(valid, OTHER_KEY)).toThrow(DecryptError);
  });

  it('uses a fixed name and message that leak no values', () => {
    const wrongKey = errorOf(() => decryptSecret(valid, OTHER_KEY));
    const tampered = errorOf(() => decryptSecret(flipByte(valid, 30), KEY));
    for (const error of [wrongKey, tampered]) {
      expect(error).toBeInstanceOf(DecryptError);
      const err = error as DecryptError;
      expect(err.name).toBe('DecryptError');
      expect(err.message).toBe('Unable to decrypt secret');
      expect(err.cause).toBeUndefined();
      const text = `${err.name} ${err.message} ${err.stack ?? ''}`;
      expect(text).not.toContain(PLAINTEXT);
      expect(text).not.toContain(valid);
      expect(text).not.toContain(valid.slice(3));
      expect(text).not.toContain(KEY.toString('hex'));
      expect(text).not.toContain(KEY.toString('base64'));
      expect(text).not.toContain(OTHER_KEY.toString('hex'));
    }
  });
});

describe('key validation', () => {
  const valid = encryptSecret(PLAINTEXT, KEY);

  it.each([[Buffer.alloc(16, 7)], [Buffer.alloc(31, 7)], [Buffer.alloc(33, 7)], [Buffer.alloc(0)]])(
    'rejects a %# key that is not 32 bytes with TypeError',
    (badKey) => {
      expect(() => encryptSecret(PLAINTEXT, badKey)).toThrow(TypeError);
      expect(() => encryptSecret(PLAINTEXT, badKey)).toThrow('Key must be 32 bytes');
      expect(() => decryptSecret(valid, badKey)).toThrow(TypeError);
      expect(() => decryptSecret(valid, badKey)).toThrow('Key must be 32 bytes');
    },
  );
});

import { describe, expect, it } from 'vitest';
import {
  dummyHashReady,
  MAX_RAW_PASSWORD_UNITS,
  hashPassword,
  isAcceptablePasswordLength,
  isWithinRawLimit,
  normalisePassword,
  verifyAgainstDummy,
  verifyPassword,
} from './passwords.js';

const PASSWORD = 'correct horse battery staple';

describe('hashPassword and verifyPassword', () => {
  it('produces an argon2id PHC string with the chosen parameters', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}!`, hash)).toBe(false);
  });

  it('gives a different hash each time for one password', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('verifies a hash made with other parameters, reading them from the string', async () => {
    // Made with m=8192,t=1,p=1 for the password above.
    const { argon2 } = await import('node:crypto');
    const nonce = Buffer.alloc(16, 7);
    const tag = await new Promise<Buffer>((resolve, reject) => {
      argon2(
        'argon2id',
        { message: Buffer.from(PASSWORD), nonce, parallelism: 1, tagLength: 32, memory: 8192, passes: 1 },
        (e, k) => {
          if (e === null) {
            resolve(k);
          } else {
            reject(e);
          }
        },
      );
    });
    const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
    const stored = `$argon2id$v=19$m=8192,t=1,p=1$${b64(nonce)}$${b64(tag)}`;
    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword('something else entirely', stored)).toBe(false);
  });

  it('verifies malformed and non-argon2id strings as false', async () => {
    expect(await verifyPassword(PASSWORD, '')).toBe(false);
    expect(await verifyPassword(PASSWORD, 'not a hash')).toBe(false);
    expect(await verifyPassword(PASSWORD, '$argon2id$v=19$m=19456,t=2,p=1$onlysalt')).toBe(false);
    expect(await verifyPassword(PASSWORD, '$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaA')).toBe(false);
    expect(await verifyPassword(PASSWORD, '$2b$12$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyz01234')).toBe(false);
    // Out of range for crypto.argon2: must be false, not a throw.
    expect(await verifyPassword(PASSWORD, '$argon2id$v=19$m=1,t=1,p=1$c2FsdA$aGFzaA')).toBe(false);
  });
});

describe('verifyAgainstDummy', () => {
  it('always returns false', async () => {
    expect(await verifyAgainstDummy(PASSWORD)).toBe(false);
    expect(await verifyAgainstDummy('')).toBe(false);
  });
});

describe('dummy hash', () => {
  it('is built with the same parameters as real hashes', async () => {
    expect((await dummyHashReady()).startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });
});

describe('normalisePassword', () => {
  it('maps a decomposed and a composed form to the same string', async () => {
    const composed = 'café au lait, s’il vous plaît';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    expect(normalisePassword(decomposed)).toBe(normalisePassword(composed));
    const hash = await hashPassword(normalisePassword(composed));
    expect(await verifyPassword(normalisePassword(decomposed), hash)).toBe(true);
    const hash2 = await hashPassword(normalisePassword(decomposed));
    expect(await verifyPassword(normalisePassword(composed), hash2)).toBe(true);
  });

  it('applies compatibility mapping', () => {
    expect(normalisePassword('ＡＢ')).toBe('AB');
  });
});

describe('isAcceptablePasswordLength', () => {
  it('rejects 14, accepts 15 and 256, rejects 257 code points', () => {
    expect(isAcceptablePasswordLength('a'.repeat(14))).toBe(false);
    expect(isAcceptablePasswordLength('a'.repeat(15))).toBe(true);
    expect(isAcceptablePasswordLength('a'.repeat(256))).toBe(true);
    expect(isAcceptablePasswordLength('a'.repeat(257))).toBe(false);
  });

  it('counts an astral character as one code point', () => {
    const emoji = '\u{1F600}';
    expect(emoji.length).toBe(2);
    expect(isAcceptablePasswordLength(emoji.repeat(14))).toBe(false);
    expect(isAcceptablePasswordLength(emoji.repeat(15))).toBe(true);
    expect(isAcceptablePasswordLength(emoji.repeat(256))).toBe(true);
    expect(isAcceptablePasswordLength(emoji.repeat(257))).toBe(false);
  });
});

describe('isWithinRawLimit', () => {
  it('counts UTF-16 units: 1024 pass, 1025 fail', () => {
    expect(MAX_RAW_PASSWORD_UNITS).toBe(1024);
    expect(isWithinRawLimit('a'.repeat(1024))).toBe(true);
    expect(isWithinRawLimit('a'.repeat(1025))).toBe(false);
    expect(isWithinRawLimit('')).toBe(true);
  });

  it('counts an astral character as two units', () => {
    expect(isWithinRawLimit('\u{1F600}'.repeat(512))).toBe(true);
    expect(isWithinRawLimit('\u{1F600}'.repeat(513))).toBe(false);
  });
});

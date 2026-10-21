import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const PREFIX = 'v1:';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Thrown for any malformed or unauthentic stored secret. The message is fixed
 * and never carries the plaintext, the ciphertext or the key.
 */
export class DecryptError extends Error {
  constructor() {
    super('Unable to decrypt secret');
    this.name = 'DecryptError';
  }
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new TypeError('Key must be 32 bytes');
  }
}

/** Returns `v1:` + base64(iv(12) || tag(16) || ciphertext). */
export function encryptSecret(plaintext: string, key: Buffer): string {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

export function decryptSecret(ciphertext: string, key: Buffer): string {
  assertKey(key);
  if (typeof ciphertext !== 'string' || !ciphertext.startsWith(PREFIX)) {
    throw new DecryptError();
  }
  const encoded = ciphertext.slice(PREFIX.length);
  const payload = Buffer.from(encoded, 'base64');
  // Node's base64 decoder is lenient; require the canonical padded form.
  if (payload.toString('base64') !== encoded) {
    throw new DecryptError();
  }
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new DecryptError();
  }
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = payload.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptError();
  }
}

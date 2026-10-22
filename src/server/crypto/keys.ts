import { hkdfSync, randomBytes } from 'node:crypto';

export const KEY_SALT_BYTES = 32;
const DERIVED_KEY_BYTES = 32;

/** Returns a fresh random per-user salt, stored as `users.key_salt`. */
export function newKeySalt(): Buffer {
  return randomBytes(KEY_SALT_BYTES);
}

/**
 * Derives the per-user AES-256 key with HKDF-SHA256: APP_SECRET is the input
 * key material, `keySalt` the salt and the user id the info context.
 * Error messages name the bad input in words only and never carry the secret,
 * the salt or the key.
 */
export function deriveUserKey(appSecret: string, keySalt: Buffer, userId: string): Buffer {
  if (typeof appSecret !== 'string' || appSecret.length === 0) {
    throw new TypeError('appSecret must not be empty');
  }
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new TypeError('userId must not be empty');
  }
  if (!Buffer.isBuffer(keySalt) || keySalt.length !== KEY_SALT_BYTES) {
    throw new TypeError('keySalt must be 32 bytes');
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(appSecret, 'utf8'),
      keySalt,
      Buffer.from(userId, 'utf8'),
      DERIVED_KEY_BYTES,
    ),
  );
}

const FLOW_KEY_BYTES = 32;
const FLOW_INFO = 'walley/oidc-flow/v1';

/**
 * Derives the OIDC flow cookie key with HKDF-SHA256: APP_SECRET is the input
 * key material, the salt is empty and the info label is `walley/oidc-flow/v1`.
 * Separate from the per-user keys, which use `key_salt` and the user id.
 */
export function deriveFlowKey(appSecret: string): Buffer {
  if (typeof appSecret !== 'string' || appSecret.length === 0) {
    throw new TypeError('appSecret must not be empty');
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(appSecret, 'utf8'),
      Buffer.alloc(0),
      Buffer.from(FLOW_INFO, 'utf8'),
      FLOW_KEY_BYTES,
    ),
  );
}

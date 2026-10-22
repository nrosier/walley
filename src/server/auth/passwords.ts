import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS } from '../../lib/password-policy.js';

/** Argon2id parameters for new hashes: the OWASP minimum (19 MiB, 2 passes, 1 lane). */
const MEMORY_KIB = 19456;
const PASSES = 2;
const PARALLELISM = 1;
const TAG_LENGTH = 32;
const NONCE_LENGTH = 16;

/**
 * Cap on the raw, un-normalised password, in UTF-16 units. NFKC can expand a character about
 * 18 times, so the cap must be checked before normalisePassword runs.
 */
export const MAX_RAW_PASSWORD_UNITS = 1024;

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function derive(
  password: string,
  nonce: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
  tagLength: number,
): Promise<Buffer> {
  // A synchronous throw for out-of-range parameters rejects the promise.
  return new Promise((resolve, reject) => {
    argon2(
      'argon2id',
      { message: Buffer.from(password, 'utf8'), nonce, parallelism, tagLength, memory, passes },
      (error, key) => {
        if (error !== null) {
          reject(error);
        } else {
          resolve(key);
        }
      },
    );
  });
}

function unpadded(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '');
}

/** Returns a PHC string: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`, base64 without padding. */
export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(NONCE_LENGTH);
  const tag = await derive(password, nonce, MEMORY_KIB, PASSES, PARALLELISM, TAG_LENGTH);
  return `$argon2id$v=19$m=${String(MEMORY_KIB)},t=${String(PASSES)},p=${String(PARALLELISM)}$${unpadded(nonce)}$${unpadded(tag)}`;
}

/**
 * Checks a password against a stored PHC string. The cost parameters come from the stored
 * string, so hashes made with older parameters still verify. Anything that is not a valid
 * argon2id PHC string verifies as false.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC_PATTERN.exec(stored);
  if (match === null) {
    return false;
  }
  const [, m, t, p, salt, hash] = match;
  if (m === undefined || t === undefined || p === undefined || salt === undefined || hash === undefined) {
    return false;
  }
  try {
    const nonce = Buffer.from(salt, 'base64');
    const expected = Buffer.from(hash, 'base64');
    const actual = await derive(password, nonce, Number(m), Number(t), Number(p), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Runs a real verification against a dummy hash and always returns false. Routes call it when
 * there is no user or no hash, so the work (and the time) matches a real check.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  await verifyPassword(password, await getDummyHash());
  return false;
}

/**
 * Starts the dummy hash now, so the first request that needs it does not pay for it. A failure
 * is swallowed here (it would otherwise be an unhandled rejection). The failed promise is
 * dropped from the cache, so the next caller builds a new one.
 */
export function warmDummyHash(): void {
  getDummyHash().catch(() => undefined);
}

/**
 * Created once and assigned synchronously, so concurrent callers share one hash. If it rejects,
 * the cache is cleared so a later call tries again; a rejection is never kept for the life of
 * the process.
 */
function getDummyHash(): Promise<string> {
  if (dummyHash === undefined) {
    const created = hashPassword(randomBytes(16).toString('hex'));
    dummyHash = created;
    created.catch(() => {
      if (dummyHash === created) {
        dummyHash = undefined;
      }
    });
  }
  return dummyHash;
}

/**
 * Resolves to the dummy PHC string, building it if needed. Login awaits this before it looks
 * anything up, so an unavailable dummy makes every login fail the same way (a throw, so a 500),
 * whichever email was sent.
 */
export function dummyHashReady(): Promise<string> {
  return getDummyHash();
}

/** True when the raw password is at most MAX_RAW_PASSWORD_UNITS UTF-16 units. Check it first. */
export function isWithinRawLimit(password: string): boolean {
  return password.length <= MAX_RAW_PASSWORD_UNITS;
}

export function normalisePassword(password: string): string {
  return password.normalize('NFKC');
}

/** True for 15 to 256 code points. Call it on the normalised value. */
export function isAcceptablePasswordLength(password: string): boolean {
  const length = Array.from(password).length;
  return length >= PASSWORD_MIN_CODE_POINTS && length <= PASSWORD_MAX_CODE_POINTS;
}

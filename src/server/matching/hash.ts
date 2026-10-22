import { createHash } from 'node:crypto';
import { canonicalMatchString, type MatchFieldsInput } from '../../lib/match-fields.js';

/** Lowercase hex SHA-256 of a canonical string (UTF-8). Server side only. */
export function sha256Hex(canonicalString: string): string {
  return createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

/**
 * Hash stored in matches.last_known_wallos_hash or last_known_actual_hash. Returns null for a
 * pattern schedule, which is unmappable and gets no hash.
 */
export function hashMatchFields(input: MatchFieldsInput): string | null {
  const canonical = canonicalMatchString(input);
  return canonical === null ? null : sha256Hex(canonical);
}

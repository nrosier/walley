/**
 * Pure fuzzy name matching for Actual payee or schedule names against Wallos titles (#33). No I/O.
 */

/** Legal-form tokens dropped from the end of a normalised name. */
export const LEGAL_SUFFIXES: readonly string[] = ['inc', 'ltd', 'bv', 'llc', 'gmbh', 'sa', 'plc', 'co', 'corp'];

/** Minimum nameScore for two names to count as a name match. */
export const NAME_MATCH_THRESHOLD = 0.6;

const LEGAL_SUFFIX_SET: ReadonlySet<string> = new Set(LEGAL_SUFFIXES);

/**
 * Lowercases, strips accents (NFD, combining marks removed) and punctuation, collapses spaces
 * and drops trailing legal suffixes (at least one token is always kept).
 * A dot after a lone letter is removed, so "B.V." becomes "bv"; other punctuation becomes a space.
 */
export function normalizeName(name: string): string {
  const text = name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/(?<![\p{L}\p{N}])(\p{L})\./gu, '$1')
    .replace(/['’]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (text === '') return '';
  const tokens = text.split(' ');
  while (tokens.length > 1 && LEGAL_SUFFIX_SET.has(tokens[tokens.length - 1] ?? '')) {
    tokens.pop();
  }
  return tokens.join(' ');
}

/**
 * Similarity of two names from 0 to 1: the Dice coefficient of their normalised token sets
 * (2 * shared / (size a + size b)). Names that are equal once spaces are removed score 1.
 * An empty name scores 0.
 */
export function nameScore(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === '' || nb === '') return 0;
  if (na.replaceAll(' ', '') === nb.replaceAll(' ', '')) return 1;
  const ta = new Set(na.split(' '));
  const tb = new Set(nb.split(' '));
  let shared = 0;
  for (const t of ta) {
    if (tb.has(t)) shared += 1;
  }
  return (2 * shared) / (ta.size + tb.size);
}

/** True when nameScore reaches NAME_MATCH_THRESHOLD. */
export function namesMatch(a: string, b: string): boolean {
  return nameScore(a, b) >= NAME_MATCH_THRESHOLD;
}

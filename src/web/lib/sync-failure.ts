import type { Side } from './sync-check';

/** Which side a failed sync check names, read from its server code. Null when the code does not say. */
export function failedSide(code: string | null): Side | null {
  if (code === null) return null;
  if (code.startsWith('wallos_')) return 'wallos';
  if (code.startsWith('actual_')) return 'actual';
  return null;
}

/** Codes that mean a side is not set up yet: show Check settings, not Retry. */
export const NOT_CONFIGURED_CODES: ReadonlySet<string> = new Set(['wallos_not_configured', 'actual_not_configured']);

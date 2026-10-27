/**
 * #108: saves the pair a create flow just made as a LINKED match, in the same request. Hashes are
 * computed here from a fresh read of both sides (`readCurrentSides` + `hashMatchFields`, the same
 * path the link route and the sync check use). Everything goes through the caller's user-scoped
 * repo, and the ids come from that user's own create, never from the client's match input.
 * Nothing here logs.
 */
import type { CreateDeps } from '../integrations/create.js';
import { hashMatchFields } from './hash.js';
import { readCurrentSides } from './sync-check.js';

export interface CreatedMatch {
  /** The saved match id, or the id of the row that already covered one of the two items. */
  readonly matchId: string;
  /** False when a match already existed for one of the two items; that row was left untouched. */
  readonly matchCreated: boolean;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
}

/**
 * The remote create already succeeded, so a failed read-back must not fail the request: the side
 * that cannot be hashed gets a null hash, which the next sync check baselines from the current value.
 */
export async function linkCreatedPair(
  deps: Pick<CreateDeps, 'wallos' | 'repoFor' | 'withActual'>,
  userId: string,
  wallosId: string,
  actualScheduleId: string,
): Promise<CreatedMatch | null> {
  const repo = deps.repoFor(userId);
  const existing = repo.findMatchByItem('wallos', wallosId) ?? repo.findMatchByItem('actual', actualScheduleId);
  if (existing !== undefined) return { matchId: existing.id, matchCreated: false };

  let wallosHash: string | null = null;
  let actualHash: string | null = null;
  let anchor: string | null = null;
  try {
    const current = await readCurrentSides(deps, userId);
    const w = current.wallosSides.get(wallosId)?.fields ?? null;
    const a = current.actualSides.get(actualScheduleId)?.fields ?? null;
    wallosHash = w === null ? null : hashMatchFields(w);
    actualHash = a === null ? null : hashMatchFields(a);
    anchor = current.wallosSides.get(wallosId)?.anchorDate ?? null;
  } catch {
    // Keep the null hashes; see above.
  }
  try {
    const row = repo.insertMatch({
      wallosId,
      actualScheduleId,
      status: 'LINKED',
      lastKnownWallosHash: wallosHash,
      lastKnownActualHash: actualHash,
      firstSeenNextPayment: anchor,
    });
    return { matchId: row.id, matchCreated: true };
  } catch (error: unknown) {
    if (!isUniqueViolation(error)) throw error;
    const raced = repo.findMatchByItem('wallos', wallosId) ?? repo.findMatchByItem('actual', actualScheduleId);
    return raced === undefined ? null : { matchId: raced.id, matchCreated: false };
  }
}

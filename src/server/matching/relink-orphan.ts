/**
 * #109: Recreate for an orphaned match. `checkRecreate` runs every refusal before the remote create;
 * `repointAfterRecreate` then puts the new item id on the missing side of the SAME row through the
 * guarded compare-and-set `replaceMatchSide`. The side is derived here from the stored row, never
 * from the client. Hashes come from the same read-back as `link-created.ts`. Nothing here logs.
 */
import { CreateFlowError, type CreateDeps } from '../integrations/create.js';
import type { UserRepo } from '../db/repo.js';
import { hashMatchFields } from './hash.js';
import { readCurrentSides } from './sync-check.js';

export type OrphanRow = NonNullable<ReturnType<UserRepo['getMatch']>>;

type Deps = Pick<CreateDeps, 'wallos' | 'repoFor' | 'withActual'>;

/** The side the create makes: `actual` for a Wallos-sourced create, `wallos` for an Actual-sourced one. */
export type RecreateTarget = 'actual' | 'wallos';

/**
 * Refuses (CreateFlowError) unless the user's own row is LINKED/MISMATCH_DETECTED, `sourceId` is its
 * surviving id, and a fresh read shows the survivor present and the target side absent.
 * Returns the row as read, for the later compare-and-set.
 */
export async function checkRecreate(
  deps: Deps,
  userId: string,
  matchId: string,
  target: RecreateTarget,
  sourceId: string,
): Promise<OrphanRow> {
  const row = deps.repoFor(userId).getMatch(matchId);
  if (row === undefined) throw new CreateFlowError('match_not_found');
  if (row.status !== 'LINKED' && row.status !== 'MISMATCH_DETECTED') throw new CreateFlowError('invalid_state');
  const survivorId = target === 'actual' ? row.wallosId : row.actualScheduleId;
  const missingId = target === 'actual' ? row.actualScheduleId : row.wallosId;
  if (survivorId === null || missingId === null || survivorId !== sourceId) {
    throw new CreateFlowError('invalid_state');
  }
  const current = await readCurrentSides(deps, userId);
  const survivors = target === 'actual' ? current.wallosSides : current.actualSides;
  const missing = target === 'actual' ? current.actualSides : current.wallosSides;
  if (!survivors.has(survivorId) || missing.has(missingId)) throw new CreateFlowError('invalid_state');
  return row;
}

/**
 * Repoints the row's missing side to `newItemId`. Returns false when the compare-and-set refused.
 * A failed read-back stores null hashes (baselined by the next Sync Check). Throws only on a
 * database error; the caller turns that into `matchRelinked: false`.
 */
export async function repointAfterRecreate(
  deps: Deps,
  userId: string,
  row: OrphanRow,
  target: RecreateTarget,
  newItemId: string,
): Promise<boolean> {
  const wallosId = target === 'wallos' ? newItemId : row.wallosId;
  const actualId = target === 'actual' ? newItemId : row.actualScheduleId;
  let wallosHash: string | null = null;
  let actualHash: string | null = null;
  let anchor: string | null = null;
  try {
    const current = await readCurrentSides(deps, userId);
    const w = wallosId === null ? null : (current.wallosSides.get(wallosId)?.fields ?? null);
    const a = actualId === null ? null : (current.actualSides.get(actualId)?.fields ?? null);
    wallosHash = w === null ? null : hashMatchFields(w);
    actualHash = a === null ? null : hashMatchFields(a);
    if (target === 'wallos' && wallosId !== null) anchor = current.wallosSides.get(wallosId)?.anchorDate ?? null;
  } catch {
    // Keep the null hashes; the create already succeeded.
  }
  return deps.repoFor(userId).replaceMatchSide(
    row.id,
    { wallosId: row.wallosId, actualScheduleId: row.actualScheduleId, status: row.status },
    {
      side: target,
      itemId: newItemId,
      lastKnownWallosHash: wallosHash,
      lastKnownActualHash: actualHash,
      ...(target === 'wallos' ? { firstSeenNextPayment: anchor } : {}),
    },
  );
}

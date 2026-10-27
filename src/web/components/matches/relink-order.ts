import type { SyncItem } from '../../../lib/sync-check-types';

/** Candidates first (in the order the server ranked them), then every other item in its own order. */
export function orderRelinkItems(items: readonly SyncItem[], candidateIds: readonly string[]): { item: SyncItem; suggested: boolean }[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const first = candidateIds.flatMap((id) => {
    const item = byId.get(id);
    return item === undefined ? [] : [item];
  });
  const firstIds = new Set(first.map((i) => i.id));
  return [
    ...first.map((item) => ({ item, suggested: true })),
    ...items.filter((i) => !firstIds.has(i.id)).map((item) => ({ item, suggested: false })),
  ];
}

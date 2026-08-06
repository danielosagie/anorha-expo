import type { BulkResolveItem, SyncItem } from '../types/syncItem';

type AddedGroupDecision = BulkResolveItem & { outcome: 'added' };

export function buildLookAlikeGroupDecisions(
  items: SyncItem[],
  cardId: string,
  answer: 'primary' | 'secondary',
): AddedGroupDecision[] {
  return items.map((item) => ({
    platformId: item.platformId,
    choice: 'create',
    canonicalId: undefined,
    valueOverride: {
      groupMode: answer === 'primary' ? 'combine' : 'separate',
      groupId: item.groupId || cardId,
    },
    // Never fabricate 0: SyncItems.Version starts at 1, so it is a guaranteed
    // CAS failure dressed up as an answer. See decision() in questionQueue.ts.
    version: Number.isInteger(item.version) ? (item.version as number) : undefined,
    outcome: 'added',
  }));
}

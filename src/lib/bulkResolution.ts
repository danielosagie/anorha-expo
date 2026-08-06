import type {
  BulkResolveItem,
  BulkResolveResult,
  SyncItem,
} from '../types/syncItem';

export const BULK_RESOLVE_LIMIT = 500;

export interface BulkResolutionSummary {
  saved: number;
  conflicts: number;
  errors: number;
}

/**
 * Split a batch into the items we can actually save and the ones we cannot.
 *
 * An item with no CAS token cannot be saved: SyncItems.Version starts at 1, so
 * any placeholder we invent is a guaranteed conflict that the seller reads as
 * "nothing happened". Surfacing them as unsendable keeps the batch honest —
 * they stay in the queue and get a real version on the next refresh.
 */
export function partitionSendableBulkItems(items: BulkResolveItem[]): {
  sendable: BulkResolveItem[];
  unsendable: BulkResolveItem[];
} {
  const sendable: BulkResolveItem[] = [];
  const unsendable: BulkResolveItem[] = [];
  for (const item of items) {
    if (Number.isInteger(item.version)) sendable.push(item);
    else unsendable.push(item);
  }
  return { sendable, unsendable };
}

export function chunkBulkResolveItems(
  items: BulkResolveItem[],
  limit = BULK_RESOLVE_LIMIT,
): BulkResolveItem[][] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Bulk resolve chunk size must be a positive integer.');
  }
  const chunks: BulkResolveItem[][] = [];
  for (let index = 0; index < items.length; index += limit) {
    chunks.push(items.slice(index, index + limit));
  }
  return chunks;
}

export function normalizeBulkResolveResults(
  requested: BulkResolveItem[],
  responseResults: BulkResolveResult[] | null | undefined,
  missingMessage = 'The server did not return a result for this item.',
): BulkResolveResult[] {
  const remainingById = new Map<string, BulkResolveResult[]>();
  for (const result of responseResults ?? []) {
    const bucket = remainingById.get(result.platformId);
    if (bucket) bucket.push(result);
    else remainingById.set(result.platformId, [result]);
  }

  return requested.map((item) => {
    const bucket = remainingById.get(item.platformId);
    const result = bucket?.shift();
    return result ?? {
      platformId: item.platformId,
      status: 'error',
      message: missingMessage,
    };
  });
}

export function bulkResolutionSummary(results: BulkResolveResult[]): BulkResolutionSummary {
  return results.reduce<BulkResolutionSummary>((summary, result) => {
    if (result.status === 'ok' || result.status === 'alreadyResolved') summary.saved += 1;
    else if (result.status === 'conflict') summary.conflicts += 1;
    else summary.errors += 1;
    return summary;
  }, { saved: 0, conflicts: 0, errors: 0 });
}

export function bulkResolutionNotice(summary: BulkResolutionSummary): string {
  const needsLook = summary.conflicts + summary.errors;
  return needsLook > 0
    ? `${summary.saved} saved · ${needsLook} need a look`
    : `${summary.saved} saved`;
}

export function reconcileNeedsAttentionAfterBulk(
  items: SyncItem[],
  results: BulkResolveResult[],
): SyncItem[] {
  const resultById = new Map(results.map((result) => [result.platformId, result]));
  return items.flatMap((item) => {
    const result = resultById.get(item.platformId);
    if (!result) return [item];
    if (result.status === 'ok' || result.status === 'alreadyResolved') return [];
    if (result.status === 'conflict' && Number.isInteger(result.version)) {
      return [{ ...item, version: result.version }];
    }
    return [item];
  });
}

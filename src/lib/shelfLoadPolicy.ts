import type { CollectionSyncProgress } from './pagedCollectionSync';

export type ShelfLoadAction =
  | 'serve-legend'
  | 'serve-direct'
  | 'fetch-direct'
  | 'wait'
  | 'show-empty'
  | 'show-error';

export type ShelfLoadSnapshot = {
  legendCount: number;
  directCount: number;
  syncPhase: CollectionSyncProgress['phase'];
  orgHasDataSignal: boolean;
  fallbackAttempted: boolean;
  fallbackFailed: boolean;
};

export type ShelfFallbackResult<T> = {
  action: ShelfLoadAction;
  attempted: boolean;
  rows: T[] | null;
  shelfLoadError: boolean;
  error?: unknown;
};

export const DEFAULT_SHELF_STATUS_FILTER = 'all';

/**
 * Decides whether the shelf can trust Legend, needs its one direct read, or can
 * honestly render empty. A completed zero-row sync is not enough evidence of
 * an empty catalog because the org-scoped product count may already know more.
 */
export function decideShelfLoad(snapshot: ShelfLoadSnapshot): ShelfLoadAction {
  if (snapshot.legendCount > 0) return 'serve-legend';

  const eligibleForFallback =
    snapshot.syncPhase === 'error' ||
    snapshot.syncPhase === 'complete' ||
    (snapshot.syncPhase === 'idle' && snapshot.orgHasDataSignal);

  if (!snapshot.fallbackAttempted && eligibleForFallback) return 'fetch-direct';
  if (snapshot.directCount > 0) return 'serve-direct';
  if (snapshot.fallbackFailed) return 'show-error';
  if (snapshot.syncPhase === 'initial' || snapshot.syncPhase === 'background') return 'wait';
  if (snapshot.syncPhase === 'idle' && !snapshot.orgHasDataSignal) return 'wait';
  if (snapshot.orgHasDataSignal) return 'show-error';
  return 'show-empty';
}

/** Execute only the fetch action returned by decideShelfLoad. */
export async function executeShelfFallback<T>(
  snapshot: ShelfLoadSnapshot,
  fetchDirect: () => Promise<T[]>,
): Promise<ShelfFallbackResult<T>> {
  const action = decideShelfLoad(snapshot);
  if (action !== 'fetch-direct') {
    return {
      action,
      attempted: false,
      rows: null,
      shelfLoadError: action === 'show-error',
    };
  }

  try {
    const rows = await fetchDirect();
    if (snapshot.orgHasDataSignal && rows.length === 0) {
      throw new Error('Direct fetch returned 0 items while the organization count is positive');
    }
    return {
      action: rows.length > 0 ? 'serve-direct' : 'show-empty',
      attempted: true,
      rows,
      shelfLoadError: false,
    };
  } catch (error) {
    return {
      action: 'show-error',
      attempted: true,
      rows: null,
      shelfLoadError: true,
      error,
    };
  }
}

export function shelfItemMatchesStatus(
  filter: string,
  isLive: boolean,
  isPartnerShared: boolean,
): boolean {
  if (filter === 'active') return isLive || isPartnerShared;
  if (filter === 'draft') return !isLive && !isPartnerShared;
  return true;
}

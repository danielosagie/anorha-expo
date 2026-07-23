// Mobile mirror of the backend resolver contract
// (anorha-bknd/src/sync-engine/sync-resolver/sync-item.ts). The SyncInbox renders
// this shape directly from GET /api/sync/connections/:id/resolution — no
// re-derivation from MappingSuggestion. Keep in sync with the backend.

export type SyncDirection = 'pull' | 'push' | 'both';

export interface CanonicalRef {
  id: string;
  sku: string | null;
  title: string | null;
  price?: string | number | null;
  imageUrl?: string | null;
  /** Client-enriched from the candidate's platform mapping. */
  sourcePlatform?: string | null;
}

export type SyncResolution =
  | { kind: 'link'; canonical: CanonicalRef; confidence: number; via: 'barcode' | 'sku' | 'title' | 'manual' }
  | { kind: 'create' }
  | { kind: 'ignore' };

export type AttentionReason =
  | 'multiple_candidates'
  | 'weak_match'
  | 'look_alike_group'
  | 'duplicate_target'
  | 'field_conflict'
  | 'bundle'
  | 'stale_link';

export interface SyncItem {
  platformId: string;
  sku: string | null;
  barcode: string | null;
  title: string;
  price: string | number | null;
  imageUrl: string | null;
  parentId: string | null;
  direction: SyncDirection;
  sourceHash?: string;
  productShape?: string;

  resolution: SyncResolution;

  attention?: AttentionReason;
  candidates?: CanonicalRef[];
  // Which candidate the backend prefers (NOT a canonical id). Map to a candidate
  // before sending as `canonicalId` on a 'link' resolve.
  recommended?: 'primary' | 'secondary' | null;
  reason?: string;
  groupId?: string;
  groupTitle?: string;
}

export interface ResolveResult {
  // The rows-backed backend returns the certain buckets as EMPTY arrays — the
  // real numbers live in `summary` only. Never read these arrays for content;
  // only `needsAttention` is fully populated.
  autoLink: SyncItem[];
  autoCreate: SyncItem[];
  needsAttention: SyncItem[];
  summary: {
    total: number;
    autoLinked: number;
    autoCreated: number;
    needsAttention: number;
    skipped: number;
    pushSide: number;
    clean: boolean;
    byReason: Partial<Record<AttentionReason, number>>;
  };
}

export type ResolveChoice = 'link' | 'create' | 'ignore';

export interface ResolveResponse {
  success: boolean;
  jobId?: string;
  committedCount?: number;
  alreadyResolved?: boolean;
}

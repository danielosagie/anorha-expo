// Mobile mirror of the backend resolver contract
// (anorha-bknd/src/sync-engine/sync-resolver/sync-item.ts). Import review renders
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
  | 'stale_link'
  | 'title_quality'
  // The commit ran and failed — resolving again retries it. Rows arrive with
  // this on the AttentionReason column (backend sync-item.ts has 9 values;
  // omitting one here rendered a LABEL-LESS group row).
  | 'commit_failed';

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
  /** Row-level CAS token returned by the rows-backed resolver. */
  version?: number;
  /** Optional Imports batch stamp when the resolver is filtered by importId. */
  importId?: string | null;

  resolution: SyncResolution;

  /** Server-ranked match confidence. Queue helpers preserve this server order. */
  confidence?: number | null;

  attention?: AttentionReason;
  candidates?: CanonicalRef[];
  // Which candidate the backend prefers (NOT a canonical id). Map to a candidate
  // before sending as `canonicalId` on a 'link' resolve.
  recommended?: 'primary' | 'secondary' | null;
  reason?: string;
  groupId?: string;
  groupTitle?: string;
  /** Structured conflict details, when the source includes them. */
  fieldConflicts?: Array<{
    field?: string;
    incomingValue?: string | number | null;
    canonicalValue?: string | number | null;
    platformValue?: string | number | null;
    catalogValue?: string | number | null;
  }>;
  /** Detected bundle members, when the source can name them individually. */
  bundleParts?: Array<{ sku?: string | null; title?: string | null }>;
  /** Full-fidelity photo passthrough used by title generation. */
  imageUrls?: string[];
  /** Source-grounded title-generation signals preserved from CSV/file imports. */
  description?: string | null;
  quantity?: number | null;
  brand?: string | null;
  category?: string | null;
  importDecision?: { keepCanonical?: boolean };
  commitError?: string;
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
    /** Rows whose decision is saved but whose catalog write is still running. */
    pendingCommit?: number;
    pendingLinked?: number;
    pendingCreated?: number;
    skipped: number;
    pushSide: number;
    clean: boolean;
    byReason: Partial<Record<AttentionReason, number>>;
  };
}

export type ResolveChoice = 'link' | 'create' | 'ignore';

export type ResolveValueOverride =
  | boolean
  | string
  | {
      title?: string;
      generateTitleFromPhoto?: boolean;
      groupMode?: 'combine' | 'separate';
      bundleMode?: 'set' | 'separate';
      groupId?: string;
    };

export interface ResolveOptions {
  version?: number;
  importId?: string;
  valueOverride?: ResolveValueOverride;
}

export interface ResolveResponse {
  success: boolean;
  jobId?: string;
  committedCount?: number;
  alreadyResolved?: boolean;
  version?: number;
}

export interface BulkResolveItem {
  platformId: string;
  choice: ResolveChoice;
  canonicalId?: string;
  valueOverride?: ResolveValueOverride;
  /**
   * The row's CAS token. Optional so callers can express "I do not know it"
   * instead of fabricating a 0, which SyncItems.Version (NOT NULL DEFAULT 1)
   * can never match. Items without one are dropped before send and reported.
   */
  version?: number;
}

export interface BulkResolveResult {
  platformId: string;
  status: 'ok' | 'conflict' | 'alreadyResolved' | 'error';
  version?: number;
  message?: string;
  generatedTitle?: string;
}

export interface BulkResolveResponse {
  results: BulkResolveResult[];
  timing?: {
    readMs: number;
    prepareMs: number;
    casMs: number;
    enqueueMs: number;
    totalMs: number;
  };
}

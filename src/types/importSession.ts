// Shared types for import session (mapping suggestions, wizard state, etc.)

export interface MappingSuggestion {
  action: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE' | 'UNMATCHED';
  prevAction?: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE' | 'UNMATCHED';
  platformProduct: {
    id: string;
    sku: string;
    title: string;
    price: number;
    imageUrl: string | null;
    parentId?: string | null;
    parentTitle?: string | null;
  };
  suggestedCanonicalProduct: {
    id: string | null;
    sku: string;
    title: string;
    price?: number;
    imageUrl?: string | null;
  } | null;
  anorhaVariant?: {
    id: string;
    sku: string | null;
    title: string | null;
    price?: number;
    barcode?: string | null;
    imageUrl?: string | null;
  } | null;
  direction?: 'platform_to_anorha' | 'anorha_to_platform' | 'bidirectional';
  isSelected: boolean;
  matchType?: 'BARCODE' | 'SKU' | 'TITLE' | 'NONE' | 'AI_SEMANTIC';
  confidence?: number;
  resolved?: boolean;
  prevTab?: 'all' | 'needs_review' | 'matched' | 'ignored';
  originalData?: any;

  // ── v2 matching signals (from the backend AnorhaMappingSuggestion DTO) ──
  /** simple = flat product · variant_family = parent w/ variants · unmatched_variant = orphan child */
  productShape?: 'simple' | 'variant_family' | 'unmatched_variant';
  /** bundle = 1 row holds several SKUs (Split) · kit = set here, pieces elsewhere (Kit↔singles) */
  compositionType?: 'simple' | 'bundle' | 'kit';
  /** the two sides' variant structures disagree — route to a family resolver */
  requiresFamilyDecision?: boolean;
  familyDecisionReason?: 'new_variant_family' | 'incomplete_variant_family' | 'conflicting_variant_family';
  /** several incoming rows resolve to the same canonical (many:1) */
  isDuplicate?: boolean;
  duplicateCount?: number;
  /** matched, but fields disagree — drives the Compare resolver's rows */
  fieldConflicts?: FieldConflict[];
  /** same key string matched >1 canonical — drives the Collision resolver */
  candidateVariants?: CandidateVariant[];
}

export interface FieldConflict {
  field: 'title' | 'price' | 'stock' | 'barcode' | 'tags' | 'photos' | string;
  platformValue: string | number | null;
  canonicalValue: string | number | null;
  severity?: 'warning' | 'critical';
}

export interface CandidateVariant {
  id: string;
  sku?: string | null;
  title?: string | null;
  price?: number | null;
  imageUrl?: string | null;
}

export type ProductCreationMode = 'sync_everywhere' | 'pull_only' | 'push_only' | 'do_nothing';

export interface ConnectionLocation {
  platformLocationId: string;
  locationName: string;
  timezone?: string;
}

export interface ImportSessionCounts {
  all: number;
  matched: number;
  needs_review: number;
  review: number; // alias for wizard display
  ignored: number;
  ignore: number; // alias for wizard display
  push: number;
  pushTotal: number;
}

// Shared types for import session (mapping suggestions, wizard state, etc.)

/**
 * The whole import collapses to three questions, asked in order:
 *   group → "is this one product, or several?"  (combine / split / kit / family)
 *   same  → "is this the same as something you already have?" (confirm / pick / value / stale)
 *   keep  → "bring it in, or skip?"
 * `null` means the machine is sure — auto-resolved, zero taps.
 * See anorha-bknd/docs/import/MINIMAL_DECISIONS.md.
 */
export type ImportDecisionQuestion = 'group' | 'same' | 'keep';

export type ProductShape = 'simple' | 'variant_family' | 'unmatched_variant';
export type CompositionType = 'simple' | 'bundle' | 'kit';
export type FamilyDecisionReason =
  | 'new_variant_family'
  | 'incomplete_variant_family'
  | 'conflicting_variant_family';

export interface CanonicalRef {
  id: string;
  sku?: string | null;
  title?: string | null;
  price?: number | string | null;
  imageUrl?: string | null;
}

export interface FieldConflict {
  field: 'title' | 'price' | 'stock' | 'barcode' | 'tags' | 'photos' | string;
  platformValue: string | number | null;
  canonicalValue: string | number | null;
  severity?: 'warning' | 'critical';
}

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
  matchType?: 'BARCODE' | 'SKU' | 'TITLE' | 'NONE';
  confidence?: number;
  resolved?: boolean;
  prevTab?: 'all' | 'needs_review' | 'matched' | 'ignored';
  originalData?: any;

  // ── Server-computed signals (previously dropped on the floor) ──────────────
  suggestionId?: string;
  sourceHash?: string;
  productShape?: ProductShape;
  /** bundle = one row hides several SKUs (Split) · kit = set whose pieces are canonical singles. */
  compositionType?: CompositionType;
  bundleParts?: { sku: string | null; title?: string | null; quantity?: number }[];
  kitComponents?: CanonicalRef[];
  /** One SKU string matched >1 different canonical → pick-one. */
  candidateVariants?: CanonicalRef[];
  familyDecisionReason?: FamilyDecisionReason;
  familyMemberCount?: number;
  familyResolvedCount?: number;
  familyUnmatchedCount?: number;
  /** Many incoming rows point at the same canonical → combine-many→1. */
  isDuplicateSuggestedCanonical?: boolean;
  duplicateSuggestedCanonicalSuggestionIds?: string[];
  /** Matched, but specific fields disagree → confirm-value. */
  fieldConflicts?: FieldConflict[];
  isStaleLink?: boolean;
  staleReason?: 'missing_from_import' | 'link_changed';
  alreadyMapped?: boolean;

  // ── Client-derived (decisions.ts) ──────────────────────────────────────────
  /** Which of the three questions this row raises (undefined once resolved/auto). */
  question?: ImportDecisionQuestion;
  /** Combine grouping: rows sharing a groupId are one proposed variant family. */
  groupId?: string;
  /** Display title for the proposed combine group (e.g. "Handmade Soap"). */
  groupTitle?: string;
  /** The cover/master row of a combine group (others fold under it). */
  groupCover?: boolean;
}

// ── The processed import draft (mirrors anorha-bknd import-draft.types.ts) ────
// The backend does the processing — normalize, auto-resolve, cluster, derive,
// order — and hands us a finished draft. The app renders it; presentation copy
// (see DecisionQueue.copyFor) stays here. DraftItem is shape-compatible with
// MappingSuggestion, so a unit's items feed straight into applyAnswer/commit.

export type DraftVariant =
  | 'combine' | 'duplicate' | 'family' | 'split' | 'kit'
  | 'collision' | 'value' | 'match' | 'stale' | 'new';

export interface DraftSingleUnit {
  kind: 'single';
  id: string;
  question: ImportDecisionQuestion;
  variant: DraftVariant;
  recommended: 'primary' | 'secondary' | null;
  reason: string;
  item: MappingSuggestion;
}

export interface DraftGroupUnit {
  kind: 'group';
  id: string;
  question: 'group';
  variant: DraftVariant;
  recommended: 'primary' | 'secondary' | null;
  reason: string;
  title: string;
  members: MappingSuggestion[];
}

export type DraftUnit = DraftSingleUnit | DraftGroupUnit;

export interface AutoResolvedItem {
  id: string;
  title: string;
  sku?: string | null;
  imageUrl?: string | null;
  reason: string;
  matchedTo?: { id?: string | null; title?: string | null; sku?: string | null; imageUrl?: string | null } | null;
}

export interface ImportDraftSummary {
  considered: number;
  decisions: number;
  autoResolved: number;
  byQuestion: { group: number; same: number; keep: number };
}

export type DraftAnswer = 'primary' | 'secondary' | 'skip';
export type DraftDecision =
  | { kind: 'answer'; unitId: string; answer: DraftAnswer; at?: string }
  | { kind: 'drop'; itemId: string; at?: string };

export interface CompletedDecision {
  unitId: string;
  title: string;
  variant: DraftVariant;
  choice: DraftAnswer;
  choiceLabel: string;
}

export interface ImportDraft {
  connectionId: string;
  version: string;
  generatedAt: string;
  units: DraftUnit[];
  autoResolved: AutoResolvedItem[];
  summary: ImportDraftSummary;
  decisions: DraftDecision[];
  completed: CompletedDecision[];
  canUndo: boolean;
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

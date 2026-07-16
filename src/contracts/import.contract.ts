// @generated from sssync-bknd/src/contracts/import.contract.ts (sha256:7d230f944b0e)
// DO NOT EDIT — change the backend copy, then run `npm run contracts:sync` there.
/**
 * IMPORT / MAPPING CONTRACT — Match & Optimize (import) resolver seam.
 * Self-contained (zod only); synced verbatim to mobile.
 *
 * This is where the backend's product-quality signals live: productShape,
 * requiresFamilyDecision, isDuplicateSuggestedCanonical, fieldConflicts,
 * candidateVariants. Mobile resolvers must consume these — do not re-derive
 * them client-side, and do NOT rename them in transit (the old mobile-side
 * `isDuplicate` alias is exactly the drift this file exists to kill).
 */
import { z } from 'zod';

export const IMPORT_DIRECTIONS = ['platform_to_anorha', 'anorha_to_platform', 'bidirectional'] as const;
export const zImportDirection = z.enum(IMPORT_DIRECTIONS);
export type ImportDirection = z.infer<typeof zImportDirection>;

export const MATCH_TYPES = ['BARCODE', 'SKU', 'TITLE', 'NONE', 'MANUAL'] as const;
export const zImportMatchType = z.enum(MATCH_TYPES);
export type ImportMatchType = z.infer<typeof zImportMatchType>;

export const PRODUCT_SHAPES = ['simple', 'variant_family', 'unmatched_variant'] as const;
export const zProductShape = z.enum(PRODUCT_SHAPES);
export type ProductShape = z.infer<typeof zProductShape>;

export const IMPORT_ACTIONS = ['CREATE_NEW', 'LINK_EXISTING', 'IGNORE', 'PUSH_TO_PLATFORM'] as const;
export const zImportAction = z.enum(IMPORT_ACTIONS);
export type ImportAction = z.infer<typeof zImportAction>;

export const zFamilyDecisionReason = z.enum(['new_variant_family', 'incomplete_variant_family', 'conflicting_variant_family']);
export type FamilyDecisionReason = z.infer<typeof zFamilyDecisionReason>;

const zPrice = z.union([z.string(), z.number()]).nullable();

export const zPlatformProductRef = z.object({
  id: z.string(),
  sku: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  price: zPrice.optional(),
  imageUrl: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  parentTitle: z.string().nullable().optional(),
});
export type PlatformProductRef = z.infer<typeof zPlatformProductRef>;

export const zCanonicalProductRef = z.object({
  id: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  price: zPrice.optional(),
  imageUrl: z.string().nullable().optional(),
});
export type CanonicalProductRef = z.infer<typeof zCanonicalProductRef>;

/** Same SKU matched >1 different canonical product — forces a Collision decision. */
export const zCandidateVariant = z.object({
  id: z.string(),
  sku: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  price: zPrice.optional(),
  imageUrl: z.string().nullable().optional(),
});
export type CandidateVariant = z.infer<typeof zCandidateVariant>;

/** Matched, but specific fields disagree — drives the Compare resolver's rows. */
export const zFieldConflict = z.object({
  field: z.string(),
  platformValue: z.union([z.string(), z.number()]).nullable(),
  canonicalValue: z.union([z.string(), z.number()]).nullable(),
  severity: z.enum(['warning', 'critical']).optional(),
});
export type FieldConflict = z.infer<typeof zFieldConflict>;

export const zMappingSuggestion = z.object({
  suggestionId: z.string(),
  platformProduct: zPlatformProductRef.nullable().optional(),
  anorhaVariant: zCanonicalProductRef.nullable().optional(),
  suggestedCanonicalProduct: zCanonicalProductRef.nullable().optional(),
  suggestedCanonicalVariant: z
    .object({
      Id: z.string().nullable().optional(),
      ProductId: z.string().nullable().optional(),
      Sku: z.string().nullable().optional(),
      Title: z.string().nullable().optional(),
      Barcode: z.string().nullable().optional(),
      Price: zPrice.optional(),
      PrimaryImageUrl: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  suggestedPlatformProduct: zPlatformProductRef.nullable().optional(),
  direction: zImportDirection,
  matchType: zImportMatchType,
  confidence: z.number(),
  productShape: zProductShape,
  parentId: z.string().nullable().optional(),
  parentTitle: z.string().nullable().optional(),
  requiresFamilyDecision: z.boolean().optional(),
  familyDecisionReason: zFamilyDecisionReason.optional(),
  familyDecisionSummary: z.string().optional(),
  familyMemberCount: z.number().optional(),
  familyResolvedCount: z.number().optional(),
  familyUnmatchedCount: z.number().optional(),
  isDuplicateSuggestedCanonical: z.boolean().optional(),
  duplicateSuggestedCanonicalSuggestionIds: z.array(z.string()).optional(),
  wasCollisionDeduped: z.boolean().optional(),
  collisionWinnerSuggestionId: z.string().nullable().optional(),
  candidateVariants: z.array(zCandidateVariant).optional(),
  fieldConflicts: z.array(zFieldConflict).optional(),
  /** bundle = 1 row holds several SKUs (Split resolver) · kit = set row whose pieces exist as canonicals (Kit ↔ singles). */
  compositionType: z.enum(['simple', 'bundle', 'kit']).optional(),
  /** Parsed bundle components when detectable; user edits them in the Split resolver. */
  bundleParts: z.array(z.object({ sku: z.string().nullable(), title: z.string().nullable().optional(), quantity: z.number().optional() })).optional(),
  /** Canonical singles a kit row shares stock with, for the Kit ↔ singles resolver. */
  kitComponents: z.array(zCandidateVariant).optional(),
  /** Existing link broke: partner vanished from this import, or the key now points elsewhere. Never auto-act. */
  isStaleLink: z.boolean().optional(),
  staleReason: z.enum(['missing_from_import', 'link_changed']).optional(),
  /** Already linked to the suggested canonical — re-imports can skip it (idempotency). */
  alreadyMapped: z.boolean().optional(),
  mappedVariantId: z.string().nullable().optional(),
  /** Identity hash of the incoming item; echo back on commit so decisions stay scoped to THIS version of the item. */
  sourceHash: z.string().optional(),
  /** Persisted decision from a previous session for this exact item (hash-checked server-side). */
  priorResolution: zImportAction.nullable().optional(),
  /** The canonical a prior LINK_EXISTING chose — replays re-link to THIS id only (null for CREATE_NEW/IGNORE). */
  priorCanonicalId: z.string().nullable().optional(),
});
export type MappingSuggestion = z.infer<typeof zMappingSuggestion>;

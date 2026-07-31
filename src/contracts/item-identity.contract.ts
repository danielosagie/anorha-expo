// @generated from sssync-bknd/src/contracts/item-identity.contract.ts (sha256:5a8aa2aae0b9)
// DO NOT EDIT — change the backend copy, then run `npm run contracts:sync` there.
/**
 * Canonical product identity boundary shared by Match and Generate.
 *
 * Identity is an assertion about the seller's item. Marketplace listings are
 * evidence about that assertion; they are never allowed to replace it.
 */
import { z } from 'zod';

export const zIdentityEvidence = z.object({
  source: z.enum(['seller', 'photo', 'ocr', 'barcode', 'catalog', 'marketplace']),
  field: z.enum(['brand', 'productType', 'model', 'spec', 'condition', 'identity']),
  value: z.string(),
  reference: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});
export type IdentityEvidence = z.infer<typeof zIdentityEvidence>;

export const zItemIdentity = z.object({
  /** Human-readable canonical name used as the listing-generation anchor. */
  displayName: z.string().min(1),
  brand: z.string().optional(),
  productType: z.string().min(1),
  model: z.string().optional(),
  specs: z.record(z.string(), z.string()).default({}),
  condition: z.string().optional(),
  /** Seller-entered correction. When present it outranks every other field/evidence source. */
  sellerCorrection: z.string().optional(),
  confidence: z.number().min(0).max(1),
  evidence: z.array(zIdentityEvidence).default([]),
  /** Stable normalized key for identity-scoped caching and pricing snapshots. */
  canonicalKey: z.string().min(1),
  /** Corrections bypass candidates cached under the pre-correction identity. */
  cachePolicy: z.enum(['allow', 'bypass_after_correction']).default('allow'),
});
export type ItemIdentity = z.infer<typeof zItemIdentity>;

const zMarketplaceEvidenceBase = z.object({
  title: z.string().min(1),
  url: z.string().optional(),
  imageUrl: z.string().optional(),
  price: z.number().positive().optional(),
  source: z.string().optional(),
});

/** Same product identity. May support identity and exact-item pricing. */
export const zExactMatch = zMarketplaceEvidenceBase.extend({
  kind: z.literal('exact'),
  identityCanonicalKey: z.string().min(1),
  confidence: z.number().min(0).max(1),
  sameProduct: z.literal(true),
}).catchall(z.any());
export type ExactMatch = z.infer<typeof zExactMatch>;

/** Related/look-alike item. Pricing evidence only; it can never rename ItemIdentity. */
export const zSimilarComp = zMarketplaceEvidenceBase.extend({
  kind: z.literal('similar'),
  comparedToCanonicalKey: z.string().min(1),
  similarityReason: z.string().min(1),
  sameProduct: z.literal(false),
}).catchall(z.any());
export type SimilarComp = z.infer<typeof zSimilarComp>;

export const zPricingSample = z.object({
  title: z.string().optional(),
  price: z.number().positive(),
  url: z.string().optional(),
  imageUrl: z.string().optional(),
  marketplace: z.string().optional(),
  kind: z.enum(['exact', 'similar']),
});
export type PricingSample = z.infer<typeof zPricingSample>;

/** Immutable result of Match's pricing work. Generate may consume but never refresh it. */
export const zPricingSnapshot = z.object({
  identityCanonicalKey: z.string().min(1),
  low: z.number().nonnegative(),
  median: z.number().nonnegative(),
  high: z.number().nonnegative(),
  recommended: z.number().nonnegative(),
  currency: z.string().default('USD'),
  sampleCount: z.number().int().nonnegative(),
  samples: z.array(zPricingSample).default([]),
  compKind: z.enum(['exact', 'similar', 'mixed', 'estimate']),
  capturedAt: z.string(),
  fromCache: z.boolean().optional(),
});
export type PricingSnapshot = z.infer<typeof zPricingSnapshot>;

export const zGenerationPhoto = z.object({
  url: z.string().min(1),
  isCover: z.boolean().optional(),
});
export type GenerationPhoto = z.infer<typeof zGenerationPhoto>;

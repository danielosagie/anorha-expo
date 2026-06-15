// @generated from sssync-bknd/src/contracts/generate.contract.ts (sha256:77b35ad00c18)
// DO NOT EDIT — change the backend copy, then run `npm run contracts:sync` there.
/**
 * GENERATE PIPELINE CONTRACT — listing-generation job seam.
 * Self-contained (zod + sibling contracts only); synced verbatim to mobile.
 *
 * Covers: GET /products/generate/jobs/:jobId/status · GET /products/generate/jobs/:jobId/results ·
 * GET /products/generate/versions · generate job submission envelopes.
 */
import { z } from 'zod';
import { zJobLifecycleStatus, zJobProgress } from './match.contract';

/**
 * One platform's generated listing fields. Core fields are typed; platforms add
 * arbitrary platform-specific keys on top (catchall).
 */
export const zGeneratedPlatformDetails = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    price: z.number().optional(),
    compareAtPrice: z.number().optional(),
    categorySuggestion: z.string().optional(),
    tags: z.union([z.array(z.string()), z.string()]).optional(),
    brand: z.string().optional(),
    condition: z.string().optional(),
  })
  .catchall(z.any());
export type GeneratedPlatformDetails = z.infer<typeof zGeneratedPlatformDetails>;

export const zGenerateJobResult = z.object({
  productIndex: z.number(),
  productId: z.string().optional(),
  variantId: z.string().optional(),
  /** platformKey (e.g. 'shopify', 'ebay') → generated details. */
  platforms: z.record(z.string(), zGeneratedPlatformDetails),
  sourceImageUrl: z.string(),
  processingTimeMs: z.number(),
  source: z.enum(['ai_generated', 'scraped_content', 'hybrid']).optional(),
  sources: z.array(z.object({ url: z.string(), usedForFields: z.array(z.string()).optional() })).optional(),
  error: z.string().optional(),
});
export type GenerateJobResult = z.infer<typeof zGenerateJobResult>;

export const zGenerateJobSummary = z.object({
  totalProducts: z.number(),
  completed: z.number(),
  failed: z.number(),
  averageProcessingTimeMs: z.number().optional(),
});
export type GenerateJobSummary = z.infer<typeof zGenerateJobSummary>;

export const zGenerateJobStatus = z.object({
  jobId: z.string(),
  userId: z.string(),
  status: zJobLifecycleStatus,
  /** Human-readable stage label — display text, NOT a stable enum. */
  currentStage: z.string(),
  progress: zJobProgress,
  results: z.array(zGenerateJobResult),
  summary: zGenerateJobSummary.optional(),
  error: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  estimatedCompletionAt: z.string().optional(),
  updatedAt: z.string(),
});
export type GenerateJobStatus = z.infer<typeof zGenerateJobStatus>;

/** GET /products/generate/jobs/:jobId/results — response (only when status=completed). */
export const zGenerateJobResultsResponse = z.object({
  jobId: z.string(),
  status: z.string(),
  results: z.array(zGenerateJobResult),
  summary: zGenerateJobSummary.optional(),
  completedAt: z.string().optional(),
});
export type GenerateJobResultsResponse = z.infer<typeof zGenerateJobResultsResponse>;

/** Generate job submission — 202 response (submit endpoints share this envelope). */
export const zSubmitGenerateJobResponse = z.object({
  jobId: z.string(),
  status: z.string(),
  estimatedTimeMinutes: z.number().optional(),
  totalProducts: z.number().optional(),
  message: z.string().optional(),
  /** Items paused awaiting an import/family decision (present only when non-empty). */
  blockedProducts: z.array(z.any()).optional(),
});
export type SubmitGenerateJobResponse = z.infer<typeof zSubmitGenerateJobResponse>;

/** GET /products/generate/versions — one saved generation version. */
export const zGenerateVersion = z.object({
  id: z.string(),
  jobId: z.string(),
  createdAt: z.string(),
  platforms: z.record(z.string(), zGeneratedPlatformDetails),
  sources: z.array(z.object({ url: z.string(), usedForFields: z.array(z.string()).optional() })),
});
export type GenerateVersion = z.infer<typeof zGenerateVersion>;
export const zGenerateVersionsResponse = z.array(zGenerateVersion);
export type GenerateVersionsResponse = z.infer<typeof zGenerateVersionsResponse>;

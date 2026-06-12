// @generated from sssync-bknd/src/contracts/match.contract.ts (sha256:e334fe44e151)
// DO NOT EDIT — change the backend copy, then run `npm run contracts:sync` there.
/**
 * MATCH PIPELINE CONTRACT — single source of truth for the mobile↔backend match seam.
 *
 * Rules for this directory (src/contracts/):
 *  - Files must stay SELF-CONTAINED: import only from 'zod' or sibling contract files,
 *    never from backend code — they are copied verbatim into the mobile repo by
 *    `npm run contracts:sync` (CI enforces parity via `npm run contracts:check`).
 *  - Backend stays the source of truth: contracts.assert.ts (not synced) compile-fails
 *    if the live backend types stop satisfying these schemas.
 *  - Prefer tolerant types for display-only text (e.g. currentStage is a string, not an
 *    enum) so the backend can evolve copy without breaking mobile validation. Lifecycle
 *    enums (status, matchDecision, …) are load-bearing and stay strict.
 *
 * Covers: POST /products/orchestrate/match · GET /products/match/jobs/:jobId/status ·
 * GET /products/match/jobs/:jobId/results · POST /products/match/jobs/:jobId/product/:productIndex/assist-response
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared job primitives
// ---------------------------------------------------------------------------

export const zJobLifecycleStatus = z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']);
export type JobLifecycleStatus = z.infer<typeof zJobLifecycleStatus>;

export const zJobProgress = z.object({
  totalProducts: z.number(),
  completedProducts: z.number(),
  currentProductIndex: z.number().optional(),
  failedProducts: z.number(),
  /** 0–100 within the current stage. */
  stagePercentage: z.number(),
});
export type JobProgress = z.infer<typeof zJobProgress>;

// ---------------------------------------------------------------------------
// Match building blocks
// ---------------------------------------------------------------------------

export const zQuickMatchHint = z.object({
  source: z.enum(['quick_scan_auto', 'quick_scan_confirmed']),
  selectedIndex: z.number(),
  candidates: z.array(z.any()),
  confidence: z.number().optional(),
  reasoning: z.string().optional(),
});
export type QuickMatchHint = z.infer<typeof zQuickMatchHint>;

export const zMatchEvidence = z.object({
  selectedBy: z.enum(['quick_scan_lock', 'quick_scan_seed', 'smart_picker', 'text_rank', 'text_visual_synthesis', 'fallback']),
  verifierPassed: z.boolean(),
  sameProduct: z.boolean().optional(),
  hardConflicts: z.array(z.string()),
  exactMatchScore: z.number(),
});
export type MatchEvidence = z.infer<typeof zMatchEvidence>;

export const zRerankedResult = z
  .object({
    rank: z.number(),
    score: z.number(),
    /** Index into the original SerpAPI results array. */
    serpApiIndex: z.number(),
    title: z.string(),
    link: z.string(),
    imageUrl: z.string().optional(),
    snippet: z.string().optional(),
    embeddingId: z.string().optional(),
    /**
     * True ONLY when this candidate is the scanning user's own catalog item
     * (ProductVariants lane). Cached external listings are isLocalMatch:false
     * even though they come from the local DB. Gates "Already in Inventory" UX.
     */
    isLocalMatch: z.boolean().optional(),
    /** Set alongside isLocalMatch on inventory-lane hits; carries the real variant. */
    inInventory: z.boolean().optional(),
    ProductVariantId: z.string().nullable().optional(),
  })
  // The wire merges SerpAPI display fields (thumbnail, image, price, source, …)
  // into each candidate; keep them legal without enumerating a provider shape.
  .catchall(z.any());
export type RerankedResult = z.infer<typeof zRerankedResult>;

/** Per-tier timing the processor emits — the eval harness derives tier/cost from this. */
export const zMatchTiming = z.object({
  quickScanMs: z.number(),
  serpApiMs: z.number(),
  embeddingMs: z.number(),
  vectorSearchMs: z.number(),
  rerankingMs: z.number(),
  tier1Ms: z.number().optional(),
  tier2Ms: z.number().optional(),
  tier3Ms: z.number().optional(),
  totalMs: z.number(),
});
export type MatchTiming = z.infer<typeof zMatchTiming>;

export const zAutoMatchGateTrustSource = z.enum(['precision', 'quick_scan', 'text_rank', 'text_visual_synthesis', 'visual_verifier', 'ebay_confirmed']);
export type AutoMatchGateTrustSource = z.infer<typeof zAutoMatchGateTrustSource>;

/** Why the automatch gate passed/blocked — surface this, don't re-derive it client-side. */
export const zAutoMatchMeta = z.object({
  score: z.number(),
  margin: z.number(),
  blockedByRules: z.array(z.string()),
  gatePassed: z.boolean(),
  gateTrustSource: zAutoMatchGateTrustSource.optional(),
  multiSignalAgreement: z.boolean(),
  stageUsed: z.enum(['tier1', 'tier2', 'tier3', 'user_assist']),
  /** The thresholds in force when this result was gated (config-driven server-side). */
  thresholds: z.object({ score: z.number(), margin: z.number() }),
});
export type AutoMatchMeta = z.infer<typeof zAutoMatchMeta>;

export const zUserAssistAction = z.enum(['confirm', 'deny', 'refine', 'best_guess', 'retake']);
export type UserAssistAction = z.infer<typeof zUserAssistAction>;

export const zUserAssist = z.object({
  required: z.boolean(),
  prompt: z.string(),
  requestedFields: z.array(z.string()),
  candidateCount: z.number(),
  /** Top 2–3 visual candidate guesses for a one-tap pick (last-resort ask). */
  topGuesses: z
    .array(
      z.object({
        title: z.string().optional(),
        imageUrl: z.string().optional(),
        price: z.union([z.string(), z.number()]).optional(),
        link: z.string().optional(),
        serpApiIndex: z.number().optional(),
      }),
    )
    .optional(),
  allowedActions: z.array(zUserAssistAction).optional(),
  requestId: z.string().optional(),
  lastAction: zUserAssistAction.optional(),
  respondedAt: z.string().optional(),
});
export type UserAssist = z.infer<typeof zUserAssist>;

export const zVlmAnalysis = z.object({
  confidence: z.number(),
  ocrText: z.string(),
  brand: z.string(),
  model: z.string(),
  type: z.string(),
  paraphrases: z.array(z.string()),
  provider: z.enum(['scout', 'gemini']).optional(),
  vlmModel: z.string().optional(),
  fallbackUsed: z.boolean().optional(),
  fallbackReason: z.string().optional(),
  timings: z.object({ scoutMs: z.number().optional(), geminiMs: z.number().optional() }).optional(),
});
export type VlmAnalysis = z.infer<typeof zVlmAnalysis>;

export const zSearchAttempt = z.object({
  source: z.enum(['ebay_text', 'ebay_image', 'google_text', 'google_lens', 'retry_text', 'classification_research']),
  query: z.string().optional(),
  resultCount: z.number(),
  durationMs: z.number(),
});
export type SearchAttempt = z.infer<typeof zSearchAttempt>;

// ---------------------------------------------------------------------------
// Per-product match result + job status
// ---------------------------------------------------------------------------

export const zMatchDecision = z.enum(['matched', 'classified', 'needs_user_input']);
export type MatchDecision = z.infer<typeof zMatchDecision>;

export const zMatchProcessingState = z.enum(['ready_for_generate', 'awaiting_user_input', 'user_resolved', 'blocked']);
export type MatchProcessingState = z.infer<typeof zMatchProcessingState>;

export const zMatchJobResult = z.object({
  productIndex: z.number(),
  productId: z.string(),
  variantId: z.string(),
  /** Full SerpAPI response (intentionally untyped — provider-shaped). */
  serpApiData: z.any(),
  rerankedResults: z.array(zRerankedResult),
  confidence: z.enum(['high', 'medium', 'low']),
  vectorSearchFoundResults: z.boolean(),
  originalTargetImage: z.string(),
  processingTimeMs: z.number(),
  timing: zMatchTiming,
  matchSource: z.enum(['ebay', 'serpapi']).optional(),
  matchDecision: zMatchDecision.optional(),
  matchDecisionReason: z.string().optional(),
  processingState: zMatchProcessingState.optional(),
  selectedCandidateIndex: z.number().optional(),
  deniedCandidateIndices: z.array(z.number()).optional(),
  refineText: z.string().optional(),
  matchEvidence: zMatchEvidence.optional(),
  autoMatchMeta: zAutoMatchMeta.optional(),
  searchAttempts: z.array(zSearchAttempt).optional(),
  userAssist: zUserAssist.optional(),
  vlmAnalysis: zVlmAnalysis.optional(),
  autoGenerateEnqueued: z.boolean().optional(),
  autoGenerateJobId: z.string().optional(),
  /** When true, skip MatchSelectionScreen and go straight to GenerateDetailsScreen. */
  skipToGenerate: z.boolean().optional(),
  enrichedFrom: z.enum(['ebay']).nullable().optional(),
  ebayEnrichment: z.object({ ebayMatch: z.any(), identityQuery: z.string() }).optional(),
  error: z.string().optional(),
});
export type MatchJobResult = z.infer<typeof zMatchJobResult>;

export const zMatchJobSummary = z.object({
  highConfidenceCount: z.number(),
  mediumConfidenceCount: z.number(),
  lowConfidenceCount: z.number(),
  totalEmbeddingsStored: z.number(),
  averageProcessingTimeMs: z.number(),
});
export type MatchJobSummary = z.infer<typeof zMatchJobSummary>;

export const zMatchJobStatus = z.object({
  jobId: z.string(),
  userId: z.string(),
  orgId: z.string().optional(),
  status: zJobLifecycleStatus,
  /** Human-readable stage label — display text, NOT a stable enum. */
  currentStage: z.string(),
  progress: zJobProgress,
  results: z.array(zMatchJobResult),
  summary: zMatchJobSummary.optional(),
  error: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  estimatedCompletionAt: z.string().optional(),
  updatedAt: z.string(),
});
export type MatchJobStatus = z.infer<typeof zMatchJobStatus>;

// ---------------------------------------------------------------------------
// Endpoint request/response envelopes
// ---------------------------------------------------------------------------

/** POST /products/orchestrate/match — request. */
export const zSubmitMatchJobRequest = z.object({
  products: z.array(
    z.object({
      productIndex: z.number(),
      productId: z.string().optional(),
      images: z.array(z.object({ url: z.string().optional(), base64: z.string().optional(), metadata: z.any().optional() })),
      textQuery: z.string().optional(),
      quickMatchHint: zQuickMatchHint.optional(),
    }),
  ),
  options: z
    .object({
      useReranking: z.boolean().optional(),
      vectorSearchLimit: z.number().optional(),
      useEbayFastPath: z.boolean().optional(),
      autoGenerateOnHighConfidence: z.boolean().optional(),
      generatePlatforms: z.array(z.string()).optional(),
      useEbayTextSearchFastTrack: z.boolean().optional(),
      autoGenerateAllPlatforms: z.boolean().optional(),
      skipMatchSelection: z.boolean().optional(),
    })
    .optional(),
});
export type SubmitMatchJobRequest = z.infer<typeof zSubmitMatchJobRequest>;

/** POST /products/orchestrate/match — 202 response. */
export const zSubmitMatchJobResponse = z.object({
  jobId: z.string(),
  status: z.string(),
  estimatedTimeMinutes: z.number(),
  totalProducts: z.number(),
  message: z.string().optional(),
});
export type SubmitMatchJobResponse = z.infer<typeof zSubmitMatchJobResponse>;

/** GET /products/match/jobs/:jobId/results — response (only when status=completed). */
export const zMatchJobResultsResponse = z.object({
  jobId: z.string(),
  status: z.string(),
  results: z.array(zMatchJobResult),
  summary: zMatchJobSummary.optional(),
  completedAt: z.string().optional(),
});
export type MatchJobResultsResponse = z.infer<typeof zMatchJobResultsResponse>;

/** POST /products/match/jobs/:jobId/product/:productIndex/assist-response — request. */
export const zMatchAssistResponseRequest = z.object({
  requestId: z.string().optional(),
  action: zUserAssistAction,
  candidateIndex: z.number().optional(),
  deniedCandidateIndices: z.array(z.number()).optional(),
  refineText: z.string().optional(),
  generateBestGuess: z.boolean().optional(),
  continueToGenerate: z.boolean().optional(),
});
export type MatchAssistResponseRequest = z.infer<typeof zMatchAssistResponseRequest>;

/** POST …/assist-response — response. */
export const zMatchAssistResponseResponse = z.object({
  jobId: z.string(),
  status: zJobLifecycleStatus,
  currentStage: z.string(),
  pendingUserAssistCount: z.number(),
  updatedResult: zMatchJobResult,
  autoGenerateJobId: z.string().optional(),
});
export type MatchAssistResponseResponse = z.infer<typeof zMatchAssistResponseResponse>;

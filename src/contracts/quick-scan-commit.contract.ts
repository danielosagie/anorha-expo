// @generated from sssync-bknd/src/contracts/quick-scan-commit.contract.ts (sha256:95259f539b23)
// DO NOT EDIT — change the backend copy, then run `npm run contracts:sync` there.
/**
 * QUICK-SCAN COMMIT CONTRACT — camera-scan items join the import spine.
 * Self-contained (zod only); synced verbatim to mobile.
 *
 * Covers: POST /sync/quick-scan/commit
 *
 * A batch of FINALIZED camera-scan items (the QuickScanSessions draft is the
 * pre-finalize store) is normalized into SyncItems rows on the user's
 * designated internal camera pseudo-connection, then flows the SAME
 * resolve/commit lifecycle every import uses:
 *   decision 'link'/'create'  → auto_link/auto_create rows, committed
 *                               immediately (auto-pilot style, zero taps)
 *   decision 'unsure'/absent  → an 'attention' row in the async inbox
 *                               (GET /resolution + POST /resolve on the
 *                               returned connectionId)
 * Additive: no existing mobile-facing endpoint changes; mobile adopts later.
 */
import { z } from 'zod';

export const QUICK_SCAN_DECISION_ACTIONS = ['link', 'create', 'unsure'] as const;
export const zQuickScanDecisionAction = z.enum(QUICK_SCAN_DECISION_ACTIONS);
export type QuickScanDecisionAction = z.infer<typeof zQuickScanDecisionAction>;

/** A canonical the inbox card can offer for an unsure item. */
export const zQuickScanCandidateRef = z.object({
  id: z.string(),
  sku: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});
export type QuickScanCandidateRef = z.infer<typeof zQuickScanCandidateRef>;

export const zQuickScanCommitDecision = z.object({
  action: zQuickScanDecisionAction,
  /**
   * Required when action='link'. This is the canonical VARIANT id
   * (ProductVariants.Id) — the same id surfaced in match results and in
   * `candidates[].id` — NOT a Products.Id (the link is persisted against the
   * variant; a Product id fails the commit).
   *
   * A 'link' means "this IS that product": the linked canonical record's
   * Title/Description/Price/Barcode are preserved — scan values never
   * overwrite them.
   */
  canonicalProductId: z.string().nullable().optional(),
  confidence: z.number().optional(),
});
export type QuickScanCommitDecision = z.infer<typeof zQuickScanCommitDecision>;

export const zQuickScanCommitItem = z.object({
  /**
   * Client-stable id for this captured item (becomes the row key on the
   * camera pseudo-connection — re-sending the same batch is idempotent).
   */
  itemId: z.string().min(1),
  title: z.string().min(1),
  price: z.union([z.string(), z.number()]).nullable().optional(),
  sku: z.string().nullable().optional(),
  barcode: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  quantity: z.number().optional(),
  /** Uploaded photo URLs (never device file:// URIs). First = primary image. */
  photos: z.array(z.string()).optional(),
  /** Absent/null or action='unsure' parks the item in the attention inbox. */
  decision: zQuickScanCommitDecision.nullable().optional(),
  /** Choices to offer on the inbox card when the item is unsure. */
  candidates: z.array(zQuickScanCandidateRef).optional(),
  /** Draft session this item came from (best-effort flipped to 'converted'). */
  quickScanSessionId: z.string().optional(),
});
export type QuickScanCommitItem = z.infer<typeof zQuickScanCommitItem>;

export const zQuickScanCommitRequest = z.object({
  items: z.array(zQuickScanCommitItem).min(1).max(200),
});
export type QuickScanCommitRequest = z.infer<typeof zQuickScanCommitRequest>;

export const zQuickScanCommitResponse = z.object({
  /** The camera pseudo-connection — poll GET /sync/connections/:id/resolution for the inbox. */
  connectionId: z.string(),
  /** Parent Imports batch (null while the Imports migration is unapplied). */
  importId: z.string().nullable(),
  /** Items queued for immediate commit (decided link/create). */
  queuedCount: z.number(),
  /** Items parked in the attention inbox. */
  attentionCount: z.number(),
  /** Initial-sync job materializing the queued items (null when nothing queued). */
  jobId: z.string().nullable(),
  operationId: z.string().nullable(),
});
export type QuickScanCommitResponse = z.infer<typeof zQuickScanCommitResponse>;

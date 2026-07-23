// @generated from sssync-bknd/src/contracts/quick-scan-session.contract.ts (sha256:dbce2b510dbe)
// DO NOT EDIT — change the backend copy, then run `npm run contracts:sync` there.
/**
 * QUICK-SCAN SESSION CONTRACT — draft capture-session persistence seam.
 * Self-contained (zod only); synced verbatim to mobile.
 *
 * Covers: POST/PUT/GET /products/quick-scan-sessions[/:id]
 *
 * IMPORTANT — client-state envelope:
 * The backend persists exactly the columns in zQuickScanSession (PascalCase row).
 * There are NO ItemStageById / ProcessedItemIds columns — historically mobile sent
 * those as top-level fields and the backend silently dropped them, so item stages
 * never survived a draft resume. Client-only flow state MUST ride inside
 * MatchContext under the `clientState` key (zQuickScanClientState below).
 */
import { z } from 'zod';

/** Client-only flow state, nested at MatchContext.clientState. */
export const zQuickScanClientState = z.object({
  /** itemId → stage label (mobile-owned vocabulary, e.g. 'captured' | 'matched' | 'generated'). */
  itemStageById: z.record(z.string(), z.string()).optional(),
  processedItemIds: z.array(z.string()).optional(),
});
export type QuickScanClientState = z.infer<typeof zQuickScanClientState>;

/** Persisted session row (backend/DB shape — PascalCase). */
export const zQuickScanSession = z.object({
  Id: z.string(),
  UserId: z.string(),
  OrgId: z.string().nullable(),
  Status: z.string(),
  ScannedItems: z.array(z.any()),
  MatchContext: z.record(z.string(), z.any()),
  ShelfPhotoUri: z.string().nullable(),
  ActiveItemId: z.string().nullable(),
  SavedForLaterIds: z.array(z.string()),
  CreatedAt: z.string(),
  UpdatedAt: z.string(),
});
export type QuickScanSession = z.infer<typeof zQuickScanSession>;

/**
 * POST /products/quick-scan-sessions and PUT /products/quick-scan-sessions/:id — request.
 * These five fields are ALL the backend accepts; anything else is dropped.
 */
export const zUpsertQuickScanSessionRequest = z.object({
  shelfPhotoUri: z.string().optional(),
  scannedItems: z.array(z.any()).optional(),
  /** Open envelope — nest client flow state at matchContext.clientState. */
  matchContext: z.record(z.string(), z.any()).optional(),
  activeItemId: z.string().optional(),
  savedForLaterIds: z.array(z.string()).optional(),
});
export type UpsertQuickScanSessionRequest = z.infer<typeof zUpsertQuickScanSessionRequest>;

/** Helpers so both sides agree on where client state lives inside MatchContext. */
export const QUICK_SCAN_CLIENT_STATE_KEY = 'clientState' as const;

export function readQuickScanClientState(matchContext: Record<string, any> | null | undefined): QuickScanClientState {
  const raw = matchContext?.[QUICK_SCAN_CLIENT_STATE_KEY];
  const parsed = zQuickScanClientState.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function writeQuickScanClientState(
  matchContext: Record<string, any> | null | undefined,
  clientState: QuickScanClientState,
): Record<string, any> {
  return { ...(matchContext ?? {}), [QUICK_SCAN_CLIENT_STATE_KEY]: clientState };
}

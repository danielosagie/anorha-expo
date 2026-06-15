# Cart + Preview Rebuild — Implementation Plan

_Planned 2026-06-05. Spans two sessions. Session 1 = capture → cart → preview → checkout. Session 2 = Sprout chat + campaigns._

## Guiding principle

**The pipeline's job is to _find the item_.** It searches automatically (never gated behind a user tap). If it finds a confident match it locks it in; if it can't, it _proactively_ stops and asks the user for more context (text or a better/extra photo) — an item never sits in the cart unidentified. Listing is then a deliberate per-item step (SKU + review), gated behind one batch "checkout" that generates the drafts.

### Decisions (locked)

1. **Find-first, auto-escalate, never tap-gated.** Full match search (internal pgvector/FTS catalog + eBay/SerpAPI comps + Google Lens + Firecrawl) runs automatically on the first photo. Tiered: cheap pass for all, expensive tier only for misses (cost lever).
2. **Found → auto-confirm into cart (green). Not found → block + auto-ask for more context → re-search.** An item never reaches the cart unmatched.
3. **No navigation on analyze.** Items process in place, spinning inline, via existing async jobs + WebSocket / SSE.
4. **"Potential match found" → inline preview** (new screen per the screenshots) → "Confirm & add to cart", or **"Wrong item?" → inline help-us-find-it sheet** (text + photo → re-search). No separate match screen.
5. **Checkout = batch-generate drafts for all, then finalize each item individually** (SKU + review + publish). Per-item review is intentional QC.

## Current state (ground truth)

- **Mobile** (`sssync_mobile_test`): RN/Expo.
  - `src/screens/AddProductScreen.tsx` (~3700 lines) — camera orchestrator; holds `bulkItems`, `quickScanStore`, `confirmedQuickMatchByItemId`, `itemLoadingStates` in scattered `useState`.
  - `src/screens/AddProduct/BulkItemsSheet.tsx` (~1517 lines) — the "bulk sheet" → becomes the cart UI.
  - `src/screens/AddProduct/types.ts` — `MatchCandidate`, `MatchResponse`, `QuickMatchSelection`.
  - `src/components/PricingResearchModal.tsx`, `src/components/QuickProductDetailSheet.tsx` — pricing data + hero (feed the new preview).
  - Analyze today: `handleAnalyzeAndNavigate()` → `LoadingScreen` → `GenerateDetailsScreen` (navigates away — to be removed for the search phase).
  - Shelf: `handleShelfModeScan()` (SSE) extracts items → flat `bulkItems` (children arrive photo-less).
- **Backend** (`sssync-bknd`): NestJS. All search/pricing/job machinery already exists.
  - Recognition `src/products/product-recognition.service.ts`; vector search `src/embedding/{embedding,vector-search}.service.ts`.
  - eBay comps `src/platform-adapters/ebay/ebay-pricing.service.ts` (`POST /api/ebay/pricing-research`).
  - Google Lens `src/products/image-recognition/image-recognition.service.ts`; Firecrawl `src/products/firecrawl.service.ts`.
  - Async jobs `match-job`/`generate-job` via queue; live progress via `CollaborationGateway` (WebSocket) + SSE `/api/products/orchestrate/quick-scan-stream`.
  - Listing generation `POST /products/generate/jobs` → `GenerateJobProcessor` → `AiGeneratedContent`. Publish `POST /api/products/publish`.

> The screenshot screen ("Wrong item?" / Pricing guidance / Recent comps / "Sell this item") does **not** exist in code — must be built, fed by existing data.

## Data model (cart)

Move scattered `useState` → one `useCartStore` (single source of truth), persisted into the existing draft auto-save (the cart _is_ the draft; "Past Scans" = saved carts).

```ts
type CartStatus =
  | 'searching'      // find-the-item in flight
  | 'needs_context'  // couldn't find — auto-asking for text / better photo
  | 'matched'        // found + auto-confirmed, ready (green)
  | 'generating'     // post-checkout, draft generating
  | 'ready_to_list'  // draft done, awaiting per-item finalize (SKU + review)
  | 'listed' | 'error';

type CartEntry =
  | { kind: 'single'; id; photos; title?; quantity; status: CartStatus;
      match?; pricing?; draft?; needsContextReason? }
  | { kind: 'folder'; id; label?; sourcePhotoUri?; childIds: string[];     // a "shelf"
      status: 'scanning' | 'partial' | 'complete' };
```

Ops: `addSingle`, `addPhotoToItem`, `createFolderFromShelf`, **`ungroupFolder`**, `removeEntry`, `setMatch`, `setPricing`, `setStatus`, `setDraft`.

## Find-the-item pipeline (tiered, auto-escalating)

- **Tier 0 (cheap, all):** barcode / OCR text / internal catalog pgvector+FTS.
- **Tier 1 (text comps, all):** eBay/SerpAPI from OCR'd title (the "click scan search").
- **Tier 2 (expensive, misses only):** Google Lens + Firecrawl deep search.

Per item: confident match → **auto-confirm** + attach pricing → `matched`. No confident match after escalation → `needs_context`, auto-surface the prompt. Singles run 0→2 immediately; shelf items run 0–1 on all, escalate misses only (+ per-session cap + telemetry).

## Phasing (Session 1)

- **A — Cart foundation:** `useCartStore` + entry model + persistence → refactor AddProductScreen onto it → rebuild BulkItemsSheet as cart UI (folders, ungroup, status chips). _Highest-risk refactor; do incrementally behind existing UI._
- **B — Find-the-item + in-place async:** backend tier orchestration emitting `MATCH_FOUND / NEEDS_CONTEXT / PRICING_READY`; frontend subscribes, no navigation; `needs_context` prompt.
- **C — Preview + confirm/Wrong-item:** build the screenshot screen + inline re-search sheet + auto-confirm/needs-context gating.
- **D — Checkout → finalize:** batch generate in place + per-item SKU/review/list (trim `GenerateDetailsScreen` to single-item).
- **E — Cleanup:** remove navigate-away path; retire `MatchSelectionScreen`.

Backend stays reuse-first — Session 1 is ~80% frontend restructure + thin orchestration glue.

## Session 2 (later)

Rebuild Sprout chat (designs not in repo — need Figma/exports; backend agent + SSE at `/api/agent/sessions/*` already exists), whole-inventory read tools (extend `agent-tool.registry.ts`), publish + **add-to-campaign** from product creation (campaign == liquidation session today). Cart model leaves a slot for chat-added items.

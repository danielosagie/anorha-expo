# AddProduct — Next-Engineer Refactor Plan (logic + cross-page flow)

> Audience: the engineer who picks up `AddProductScreen` after the component
> extraction. The **presentational decomposition is done** — all 7 sub-components
> live in `src/screens/AddProduct/` and `AddProductScreen.tsx` is now main flow +
> styles (~4.1k lines, down from 7.4k). What's left is the hard part: the
> **logic** and the **data passed between pages**. This doc maps the current
> reality (with file:line citations) and a concrete, incremental path to fix it.
>
> Read this top-to-bottom once. **Part A (cross-page flow) is the priority** —
> it's the thing that breaks silently and is the reason for most defensive
> `?.`/`as any` code. Part B (internal state machine) is bigger but lower-risk.

---

## 0. What's already done (don't redo)

- All sub-components extracted into this folder: `UnicodeSpinner`, `ProgressBarOverlay`,
  `NotificationBar`, `CenterOverlay`, `BottomControls`, `MatchResultsSheet`, `BulkItemsSheet`.
- Shared `types.ts` + `utils.ts` (`cleanMatchText`, `getShelfProgressPresentation`).
- Dead styles removed from the main file; `tsc --noEmit` is at **0 errors** and CI enforces it.
- `src/config/env.ts` + `src/lib/apiClient.ts` exist (Phase 2) — **use these for new fetches**;
  the legacy inline `fetch` + `API_BASE_URL` calls in this feature have NOT all been migrated yet.

**Known structural-compat duplication to clean up later** (noted in the file headers):
`types.ts`/`utils.ts` re-declare several shapes that `AddProductScreen.tsx` still has local copies
of (they interoperate via structural typing). Consolidating to the single source is a safe,
mechanical follow-up — do it opportunistically as you touch each area.

---

## Part A — The cross-page data flow (PRIORITY)

### A.1 The flow as it actually works today

```
TabBar.tsx:79            PastScansScreen.tsx:327
   navigate('AddProduct')   navigate('AddProduct', { sessionId })
            │                          │
            ▼                          ▼
      ┌──────────────────────────────────────────────┐
      │ AddProductScreen                              │
      │  • fresh start, OR                            │
      │  • hydrate full state from backend by         │
      │    sessionId  (fetch quick-scan-sessions/:id) │  ← AddProductScreen.tsx:622-639
      │  • camera / barcode / shelf / bulk capture    │
      └───────────────┬──────────────────────────────┘
                      │ child sheet owns the handoff
                      ▼
      ┌──────────────────────────────────────────────┐
      │ BulkItemsSheet.handleAnalyzeAndNavigate       │  ← BulkItemsSheet.tsx:233
      │  3 near-duplicate navigate() blocks:          │
      │   (a) all direct-generate     :344            │
      │   (b) direct, no analyze pics :394            │
      │   (c) mixed analyze+generate  :451            │
      └───────────────┬──────────────────────────────┘
                      │ navigate('LoadingScreen', { processType, payload, onCompleteRoute })
                      ▼
      ┌──────────────────────────────────────────────┐
      │ LoadingScreen (generic job-runner + router)   │  ← LoadingScreen.tsx:225
      │  runs job, then navigation.replace(           │
      │     onCompleteRoute.screen,                   │  ← LoadingScreen.tsx:295 (as never)
      │     onCompleteRoute.params)                   │
      │  ...but ALSO has its own branches to          │
      │  MatchSelectionScreen / re-LoadingScreen      │  ← LoadingScreen.tsx:461-471
      └───────────────┬──────────────────────────────┘
                      ▼
      ┌──────────────────────────────────────────────┐
      │ GenerateDetailsScreen                         │
      │  const params: any = route.params || {}       │  ← GenerateDetailsScreen.tsx:100
      │  reads items[], jobMap, userImagesByIndex,    │
      │  focusIndex, variantId ... all `as any`       │  ← .tsx:357,477,765,793
      └──────────────────────────────────────────────┘
```

### A.2 The six concrete problems (each is a "why we wrote a fallback" root cause)

1. **Typed param lists exist but are bypassed.** `AppStackParamList` is declared at
   `src/navigation/AppNavigator.tsx:88`, yet every consumer casts it away:
   `GenerateDetailsScreen.tsx:100` (`const params: any = ...`), `route.params as any` at
   `.tsx:357/477/765/793`, and the router itself does
   `navigation.replace(screen as never, params as never)` (`LoadingScreen.tsx:295`).
   The contract is theoretically typed and practically `any`. **This is the highest-leverage fix.**

2. **Large objects passed by value through navigation params.** `bulkItems` (full item objects
   *including photo URIs*) and `firstPhotos` are serialized into nav params in all three blocks
   (`BulkItemsSheet.tsx:349, 399, 455`). React Navigation holds these in memory for the life of the
   route and warns against non-serializable/large params. This is also why `sessionId` hydration
   exists in parallel — the same data crosses pages two different ways.

3. **Index-positional coupling between producer and consumer.** The handoff is glued by array
   index, not identity: `userImagesByIndex`, `resultIndexMap` (analyzeIndex→originalIndex),
   `jobMap` (index→jobId), and `items[].index` (`BulkItemsSheet.tsx:317, 447, 439, 333-342`),
   consumed positionally in `GenerateDetailsScreen.tsx:357, 765`. Re-order or filter an array
   anywhere and the screens silently disagree. Items already have stable `item.id` — the contract
   should key on that, not position.

4. **Routing logic is split across two files.** `BulkItemsSheet` decides the destination and
   pre-builds `onCompleteRoute`, but `LoadingScreen` *also* branches on its own
   (`LoadingScreen.tsx:461-471` re-navigates to `MatchSelectionScreen` or back to itself). Nobody
   owns "what comes after the job" — it's negotiated between a sheet and a loading screen.

5. **`processType` is a stringly-typed mode switch.** `'generate' | 'match'` drives stage lists,
   titles, job polling type, and post-complete routing (`LoadingScreen.tsx:233, 300, 331, 349`).
   It's a discriminant with no discriminated-union type behind it.

6. **Ambiguous inbound param shape.** AddProductScreen unwraps `rawParams?.params ?? rawParams`
   (`AddProductScreen.tsx:534`) because callers sometimes double-nest `{ params: {...} }`. That
   defensive unwrap is a symptom of the untyped contract in (1).

### A.3 Target design

Create **`src/screens/AddProduct/flowContract.ts`** — one file that owns the cross-page contract:

```ts
// The unit that crosses pages. Keyed by stable id, NOT array index.
export interface FlowItem {
  id: string;
  title: string;
  thumbUri?: string;
  photoUris: string[];
  quantity: number;
  matchSource?: QuickMatchSelection;   // already-confirmed match, if any
}

// Discriminated union replaces the stringly-typed processType + loose payload.
export type GenerateHandoff =
  | { kind: 'direct-generate'; jobId: string; items: FlowItem[] }
  | { kind: 'analyze-then-generate'; matchJobId: string; items: FlowItem[]; skipMatchSelection: boolean };

// What LoadingScreen needs, fully typed — no `onCompleteRoute.params: any`.
export interface LoadingRouteParams {
  handoff: GenerateHandoff;
  onComplete: { screen: keyof AppStackParamList };  // destination only; params are derived
}
```

Then:
- **Register these in `AppStackParamList`** (`AppNavigator.tsx:88`) for `LoadingScreen`,
  `GenerateDetailsScreen`, `MatchSelectionScreen`. Delete the `as never`/`as any` casts; let `tsc`
  find every mismatch (it will — that's the point).
- **Pass identity, not bulk objects.** Put the heavy `bulkItems`/photos behind the existing
  `sessionId` + backend hydration that AddProductScreen already uses (`.tsx:622`). Pages forward a
  `sessionId` + a small typed `GenerateHandoff`; the destination re-hydrates by id. One mechanism,
  not two. (If a screen genuinely needs the photos before the job finishes, pass `photoUris` —
  strings — never the full `CapturedPhoto` objects.)
- **Collapse the 3 navigate blocks into one.** Build a single `GenerateHandoff` value, then one
  `navigation.navigate('LoadingScreen', { handoff, onComplete })`. The branching becomes data
  (which `kind`), not three copy-pasted call sites.
- **Give routing one owner.** Move the post-job decision out of `LoadingScreen`'s internal branches
  (`LoadingScreen.tsx:461-471`) into the `GenerateHandoff` it receives. `LoadingScreen` becomes a
  dumb runner: run job for `handoff`, then `replace(onComplete.screen, derivedParams)`.

### A.4 Migration steps (incremental, each independently shippable)

1. Add `flowContract.ts` (types only) — no behavior change, compiles immediately.
2. Type `LoadingScreen`'s `route.params` against `LoadingRouteParams`; fix the `as never` at
   `:295`. Keep accepting the old shape via a thin adapter at the top so callers still work.
3. Type `GenerateDetailsScreen`'s params; replace `const params: any` (`:100`) with the real type,
   fix the resulting `tsc` errors one by one (they map exactly to the index-coupling bugs).
4. Refactor `BulkItemsSheet.handleAnalyzeAndNavigate` (`:233`) to build one `GenerateHandoff` and
   make a single `navigate` call. Delete the two duplicate blocks.
5. Switch the heavy payload to `sessionId` hydration; remove `bulkItems`/`firstPhotos` from nav
   params. Remove the `rawParams?.params ?? rawParams` unwrap (`AddProductScreen.tsx:534`) once the
   inbound shape is typed.
6. Delete the adapter from step 2.

**Verification:** grep returns nothing for `as never` in `LoadingScreen.tsx` and `route.params as any`
in `GenerateDetailsScreen.tsx`; capture→analyze→generate completes in the simulator for all three
prior cases (all-direct, direct-no-pics, mixed); resuming a draft from PastScans still hydrates.

---

## Part B — AddProductScreen's internal logic (the implicit state machine)

The screen carries **49 `useState`, 20 `useRef`, 15 `useEffect`, 60 `useCallback`** in one
function (`AddProductScreen.tsx:527`). The multi-step flow is an implicit state machine smeared
across those flags. Grouped by sub-domain (line numbers are the declarations):

| Sub-machine        | States | Lines |
|--------------------|--------|-------|
| Camera / capture   | facing, flash, hasPermission, capturedPhotos, isCapturing, cameraMode | 552–557 |
| Barcode            | scannedBarcode, barcodeNotificationCount, barcodeSearchResult, barcodeSearching, showBarcodeResultModal, manualBarcode, showBarcodeEntry, barcodeEntryError | 566–574 |
| Manifest           | showManifestSheet, manifestJobId | 577–578 |
| Receipt            | showReceiptSheet, receiptJobId | 581–582 |
| Shelf scan         | shelfPhotoUri, isProcessingShelfScan, shelfProgress | 585–589 |
| Match / results    | currentInstruction, showMatchSheet, showViewPhotosModal, showDeepSearchSheet, matchData, currentMatchItemId, quickScanStore | 715–725 |
| Items / quick-match| confirmedQuickMatchByItemId, itemLoadingStates, itemStageById, processedItemIds, hasSeenBulkModalFtux, isAutoScanning, quickScanResults | 721–769 |
| Bulk items         | isBulkMode, bulkItems, activeItemId | 735–744 |
| Job / generate     | jobResponse | 772 |
| UI chrome          | showNotification, notificationMessage, showProgressBar | 915–917 |
| Billing / tier     | showTierSelector, billingGate, billingGateVisible | 922–924 |
| Hacks              | **forceRenderCount** (manual re-render — anti-pattern), draggedPhotoId | 972, 2114 |

### B.1 Target

Don't convert all 49 at once. Extract **one sub-machine at a time into a custom hook** that owns its
state + the effects/callbacks that touch only it. Each hook returns a small typed object. The screen
shrinks to wiring.

```
src/screens/AddProduct/hooks/
  useCamera.ts        // facing, flash, permission, capture, cameraMode
  useBarcodeScan.ts   // all barcode state + lookup + manual entry
  useShelfScan.ts     // shelf uri/progress + the quickScanStream lifecycle (owns shelfScanStreamRef)
  useBulkItems.ts     // bulkItems, activeItemId, itemStage/processed, draft save/hydrate
  useMatchSheet.ts    // matchData, quickScanStore, currentMatchItemId, sheet visibility
  useBillingGate.ts   // billingGate + visibility + tier selector
```

Order by independence (do the leaf machines first): **camera → barcode → shelf → billing →
match → bulk items** (bulk is last; it's the most entangled and touches the Part-A handoff).

Two specific cleanups while you're in here:
- **Kill `forceRenderCount`** (`:972`). It's a manual re-render trigger; whatever state it's
  papering over should be real state. Find its setter call sites and model the actual dependency.
- The **draft-session hydrate/save** logic (refs at `:543-546`, effect at `:622`) is the seam
  between Part A and Part B — it belongs in `useBulkItems`/a `useDraftSession` hook, and it's the
  same backend session you'll lean on for the Part-A "pass id, not objects" change. Do Part A's
  step 5 and this together.

### B.2 Optional: make the step machine explicit

Once the sub-hooks exist, the remaining top-level "which step am I on" flags (`showMatchSheet`,
`showDeepSearchSheet`, `isProcessingShelfScan`, `showProgressBar`, the sheet visibilities) are a
small state machine. A single `useReducer` with a `phase: 'capture' | 'scanning' | 'matching' |
'reviewing'` discriminant replaces the boolean soup and makes illegal combos unrepresentable
(e.g. match sheet + shelf-scan can't both be open). Only do this after the hooks land — don't
boil the ocean.

---

## Part C — Smaller follow-ups

- **Consolidate duplicated types/utils.** Remove the local copies in `AddProductScreen.tsx` that
  now live in `types.ts`/`utils.ts`; import from the shared source. Mechanical, low-risk.
- **Migrate inline `fetch` to `apiClient`.** This feature still has raw `fetch(`${API_BASE_URL}...)`
  calls (e.g. the hydrate at `AddProductScreen.tsx:630`). Route them through `src/lib/apiClient.ts`
  so auth/error handling is consistent.
- **Jest runner** (task #14, still open): the test runner isn't configured; `jest-expo` +
  `@testing-library/react-native` need installing before the existing tests run. Once the Part-A
  contract types exist, add a unit test that builds each `GenerateHandoff` `kind` and asserts the
  derived `GenerateDetailsScreen` params — that's the regression net for the flow.

---

## Suggested order

1. **Part A** (the contract) — highest leverage, fixes the silent-break class of bugs.
2. **Part B** sub-hooks, leaf-first; kill `forceRenderCount`.
3. **Part C** cleanups, opportunistically.
4. Part B.2 explicit reducer last, only if the flag soup is still painful after the hooks.

Keep `tsc --noEmit` at 0 after every step (CI enforces it). Ship each step on its own — none of
this needs a big-bang branch.

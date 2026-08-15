# Assurance Rewrite 6 Mobile — Implementation Notes

## Outcome

App product edits now use the vendored canonical product patch contract, inventory quantity edits use the dedicated ledger-backed backend route, both inventory bulk removal actions use the authorized aggregate soft-archive path, and the Legend ProductVariants collection has no remote write grant. The final item-write receipt is zero.

## File-by-file changes

- `src/contracts/product-patch.contract.ts`
  - Vendored the frozen backend snapshot with the required VENDORED header.
  - The body is byte-identical to the supplied snapshot: SHA-256 `c95b52e398f9631190cc10886e98c9bb20c30bc1fdac943ad151acc316e618c5`.
- `scripts/check-product-contract.mjs`
  - Resolves `ANORHA_BKND_ROOT`, defaulting to sibling `../sssync-bknd`.
  - Skips clearly and successfully when the backend contract is absent.
  - Strips the exact VENDORED header and byte-compares the remaining body when the backend contract exists.
  - Stale/header failures name the files, the expected match, and the exact regeneration/re-copy ask.
- `package.json`
  - Added `test` and `contracts:check` scripts.
- `.gitignore`
  - Unignored this required root implementation-note deliverable so the parent agent can commit it normally.
- `tsconfig.json`
  - Enabled `allowImportingTsExtensions` so the native Node TypeScript tests can import the contract-backed routing helper with an explicit extension while Expo continues using bundler resolution.
- `src/lib/productPatchContract.ts`
  - Centralized the existing editor-field-to-contract mapping.
  - Derives canonical editor permission from `PRODUCT_EDITABILITY_MANIFEST` plus the parent/variant field arrays.
  - Picks only manifest-backed fields for the legacy flat mobile PUT body; the backend splits that body into canonical parent/variant patches.
- `src/components/ListingEditorForm.tsx`
  - Canonical field edits are allowed only when their vendored manifest entries exist.
  - The canonical portion of the former hardcoded standard-field set is now derived from the contract helper; platform-only fields retain their existing handling/order.
  - Quantity edits resolve the canonical variant ID, connection ID, explicitly threaded real platform location ID, and quantity before calling the dedicated callback.
  - Missing canonical IDs surface through the existing one-toast error surface.
- `src/screens/ProductDetail.tsx`
  - Keeps the already-present callback wiring to `ListingEditorForm` and hardens it to return an honest commit result.
  - `PUT /api/products/:variantId/inventory` is the only quantity-write path.
  - Auth/server failures reuse the existing danger toast and return failure so the editor rolls back its local input.
  - Inventory-only patches do not increment the product edit version or arm generic autosave.
  - Mixed patches still arm/save their product portion.
  - Generic `PUT /api/products/:id` payloads strip `locationQuantities` and `variants[].inventoryByLocation`, so inventory never falls back through that lossy route.
  - The generic canonical fields and shelf patch propagation are derived from the vendored arrays.
  - Real `PlatformLocationId` values are threaded separately from UI-only IDs; virtual/default editor rows are not promoted into backend location IDs.
- `src/components/VariantInventoryEditor.tsx` and `src/components/VariantInventoryRow.tsx`
  - Await inventory commit results and roll the typed/stepped value back when the backend rejects it.
  - No second toast channel was added.
- `src/lib/inventorySync.ts`
  - Requires a real `location.locationId`; the UI `id` is never used as a backend fallback.
  - Exports the pure generic-payload inventory stripper.
  - Keeps the pure newest-`UpdatedAt` inventory merge.
- `src/screens/InventoryOrdersScreen.tsx`
  - Both bulk removal actions now call `POST /api/products/bulk-actions/execute`.
  - Every expected item must have a successful per-item receipt before selection mode exits.
  - Rejected or missing receipts go through the existing Alert error path; partial success is not presented as full success.
  - Inventory mirrors now use the inventory-specific newest-`UpdatedAt` helper.
- `src/lib/productBulkActions.ts`
  - Builds the backend action body and treats missing/malformed per-item receipts as failures.
- `src/utils/SupaLegend.ts`
  - ProductVariants actions changed from full CRUD to `['read']`.
  - `fieldId: 'Id'`, the list select, UserId/DRAFT filters, realtime filter, and persistence config are unchanged.
  - Renamed the internal bounded-reader option from `collection` to `collectionName`. That object is not a Legend config, but the conservative gate interpreted any nested `collection: 'ProductVariants'` object without actions as default CRUD. The rename changes no runtime behavior and leaves the real Legend config statically provable as read-only.
- Tests:
  - `__tests__/productPatchContract.test.ts` locks version, variant types, exact parent/variant arrays, and manifest coverage.
  - `__tests__/productPatchRouting.test.ts` locks manifest-derived editor permission and contract-only request picking.
  - `__tests__/productBulkActions.test.ts` locks soft-delete action construction and partial/missing receipt failures.
  - `__tests__/inventorySync.test.ts` now covers timestamp ties/missing/invalid stamps, mixed-patch stripping, canonical target resolution, and refusal of editor-only location IDs.

## Four forbidden-write sites

### 1. InventoryOrdersScreen bulk Delete

Before: directly executed `supabase.from('ProductVariants').update({ IsArchived: true }).in('Id', ids)`. It only archived selected variant rows, bypassed authorization/business logic in the backend, and could leave the parent Products row active.

Now: sends `actionType: 'delete'` per selected variant to `POST /api/products/bulk-actions/execute`. In the backend implementation read for this rewrite, both `delete` and `archive` call `productRepository.archiveProduct`, which archives the complete parent/variant aggregate.

Failure: HTTP/auth failures throw through the existing Alert path. Per-item `success: false` results and missing receipts are collected and surfaced in that same Alert path. Selection mode exits only if every selected item has a successful receipt.

### 2. InventoryOrdersScreen bulk Archive

Before: the identical direct ProductVariants `IsArchived: true` update, with the same parent inconsistency and backend bypass.

Now: sends `actionType: 'archive'` per selected variant to the same bulk execute endpoint, which soft-archives the complete aggregate.

Failure: identical honest HTTP/per-item handling; a partial rejection cannot be presented as full success.

### 3. SupaLegend bounded ProductVariants list descriptor

Before: the reader helper call contained a nested `collection: 'ProductVariants'` object. Runtime behavior was read-only for that nested object, but the required conservative AST gate treated it like a Legend config with omitted actions and therefore reported create/update/delete.

Now: the internal helper option is named `collectionName`; it still drives the identical bounded `.from(ProductVariants).select(...)` read.

Endpoint/failure: no write endpoint applies. Read/realtime errors continue through the existing Legend sync state. This descriptor grants no mutation capability.

### 4. SupaLegend ProductVariants synced collection

Before: declared `actions: ['read', 'create', 'update', 'delete']`, allowing local observable mutations to push directly to Supabase.

Now: declares `actions: ['read']`. Installed `@legendapp/state` source confirms this creates the list function and realtime subscription but omits create/update/delete functions. Persistence remains configured and `fieldId: 'Id'` is unchanged.

Endpoint/failure: no app edit routes through this collection now. User edits route through backend endpoints; failures surface in those callers' existing toast/Alert paths.

## Bulk endpoint choice and destructiveness

I chose `POST /products/bulk-actions/execute` rather than firing per-item archive requests because it authorizes the whole requested set and returns per-item results that let the app report partial failure honestly.

I deliberately did not use `DELETE /products/:id`. The current mobile “Delete” was a soft archive despite its label. The bulk backend currently maps both `delete` and `archive` actions to aggregate soft-archive, so destructiveness did not increase. The app now archives the parent and all variants consistently instead of only the selected ProductVariants rows.

## ProductVariants Legend writer dependency proof

Repository-wide searches covered `productVariants$` direct references, node `.set`, `.assign`, `.delete`, `.push`, property-node writes, aliases returned by `getLegendStateObservables`/`useLegendState`, and the former shared Legend helpers.

Findings:

- No genuine user edit mutates `productVariants$`.
- ActivityFeed, InventoryOrders, ProductDetail, and realtime hooks only read or subscribe.
- No shared Legend ProductVariant write helper is called or exported.
- The same-frame cache behavior uses `src/lib/catalogPatches.ts`, a separate in-memory overlay. It is applied after successful backend saves/socket events and never pushes to Supabase. It remains intact because it is the required local/optimistic cache touch, not a remote writer.
- Therefore no user editor needed migration from the Legend grant; the actual editors already use backend HTTP paths, and this rewrite removed the unused remote capability.

## Contract disagreements and resolution

The prior ProductDetail send list and the contract were not identical:

- Parent contract additions absent from the old flat sender: `Brand`, `CategoryHint`, `SeoTitle`, `SeoDescription`.
  - `Brand`, `SeoTitle`, and `SeoDescription` already have seller-visible fields, so they are now included as contract-approved candidates.
  - `CategoryHint` was not added. The existing Category UI edits channel taxonomy IDs/paths, which is not semantically the same as the canonical free-form hint. Inventing that mapping would silently change meaning.
- Variant contract additions absent from the old flat sender include conditional `Title`, `Options`, `VariantType`, `Currency`, `Condition`, `Mpn`, `Gtin`, `RecognitionStatus`, `OriginPlatform`, and `PrimaryImageUrl`.
  - `Condition` already has a seller-visible field and is now a contract-approved candidate.
  - The others were not added to the UI or guessed into the addressed-variant patch. Option title/type transitions have explicit contract rules and the existing variants editor represents an aggregate/platform payload, not a safe one-variant transition.
  - Images retain the existing ordered image-set command path (`ImageUrls` at the mobile HTTP seam), matching the manifest's `ProductImages` set semantics instead of treating `PrimaryImageUrl` as an independent editor field.
- `PlatformSpecificData` and `ImageUrls` are transport/command fields, not ProductPatch fields. They remain because the existing backend route uses them for channel payloads and ordered images. Inventory values are now removed from `PlatformSpecificData` before generic save.
- The hardcoded per-platform required-field lists remain. They decide publish readiness, not canonical editability/sendability, so replacing them with the product contract would have changed validation behavior.
- The contract contains both parent `Title` and conditional option-variant `Title`. The current flat mobile save sends the seller's product title as the parent field only; it does not invent an option-variant title update.

The hot backend controller currently enumerates a narrower mobile body/mapping than the full generated contract for some of those newly included contract candidates. I did not edit the read-only backend worktree. Existing PlatformSpecificData behavior remains for those visible fields, while the mobile request is now forward-aligned with the generated canonical contract; the backend rewrite owner must keep the HTTP mapper aligned when that branch lands.

## Inventory merge policy

For duplicate InventoryLevels IDs:

- A valid later `UpdatedAt` wins.
- A valid timestamp beats missing or unparseable.
- Exact ties go to Legend.
- If both timestamps are missing/unparseable, Legend wins.

The tie/fallback choice is deterministic and favors the realtime lane, preventing an equally-dated direct-fetch mirror from masking a realtime row.

## Deliberately open

- The required default contract check skips today because `/Users/dosagie/Documents/CodeProjects/sssync-bknd/src/contracts/product-patch.contract.ts` does not exist; R1/R2 have not merged into that checkout. Set `ANORHA_BKND_ROOT=/Users/dosagie/Documents/CodeProjects/sssync-bknd-assure3` today; that comparison was also run and returned OK. The default check will become active automatically after the contract lands in sibling `sssync-bknd`.
- The backend HTTP mapper/full-contract alignment noted above is backend-owned and could not be changed in the strictly read-only hot worktree.
- Expo start was run as required. The default 8081 attempt and an explicit pre-checked 8096 attempt both reached project/plugin startup, then Expo reported the port occupied in non-interactive mode before Metro listened. No server process was left running.
- No device/TestFlight production validation was attempted; this task's requested verification is the static/test/gate suite below.

## Brief/report corrections followed

- The supplied investigation report described the callback and newest-row merge as absent in its founder checkout. At base `492caa87`, the callback was already passed/called in both editor inventory sites and InventoryOrders already used a generic newest-row helper. I did not duplicate that work. I hardened the existing wiring: real IDs only, no swallowed/misrepresented failure, local rollback, no generic inventory payload, explicit mixed-patch behavior, and the inventory-specific deterministic tie policy.
- The brief's own correction was accurate: both InventoryOrders mutations were archive writes, not quantity writes.
- The canonical backend checkout named by the older campaign material is currently missing the contract; the frozen snapshot was correctly used instead.
- The first final item-write scan exposed the gate's conservative interpretation of the nested bounded-reader `collection` option. Renaming that internal option made the already-read-only descriptor unambiguous without weakening or editing the gate.

## Gate outputs

All gates were run sequentially.

### Gate 1 — TypeScript

Command:

```sh
cd /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6 && node_modules/.bin/tsc --noEmit
```

Output (verbatim; empty stdout/stderr):

```text
```

Exit code: 0.

### Gate 2 — Node tests

Command:

```sh
cd /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6 && node --test --experimental-strip-types __tests__/*.test.ts __tests__/*.test.js
```

Output (verbatim):

```text
(node:87534) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/attentionGroups.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ reasonKeyOf falls back to "other" when there is no attention reason (10.945916ms)
✔ groupItems buckets by reason and drops empty buckets (0.939708ms)
✔ groupItems orders by count desc with a stable tiebreak (0.11025ms)
✔ groupItems labels each group from REASON_LABELS (1.034709ms)
✔ itemsForGroup returns exactly one bucket, including "other" (0.107291ms)
✔ groupItems on an empty queue yields no groups (0.058542ms)
(node:87535) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/bestGuesses.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ V7 queue emits a pair for a weak match (1.815667ms)
✔ V7 queue emits which-one for multiple candidates (0.098375ms)
✔ field conflicts and failed commits never enter the V7 question payload (0.095ms)
✔ badge derivation excludes field conflicts and equals the V7 card item count (0.264083ms)
✔ legacy group and title surfaces never enter the V7 question payload (0.129333ms)
✔ platform product rules keep the incoming field value (0.177959ms)
✔ Anorha product rules keep the catalog field value (0.065375ms)
✔ stock conflicts use inventory source of truth (0.150541ms)
✔ legacy platform source of truth is still honored (0.112084ms)
✔ missing sync rules default to keeping yours (0.125458ms)
✔ a conflict without a candidate safely becomes a new item (0.705583ms)
✔ auto-resolved conflicts move from NEEDS A LOOK to LINKED with the standard action (0.20925ms)
✔ three yes answers offer one bulk V7 handoff for the remaining pairs (0.354542ms)
✔ buildMatchAnalyzeProducts includes quickMatchHint only for items with stored quick-scan selections (6.340458ms)
(node:87537) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/candidateIdentity.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ remainingItemCount counts ITEMS, not cards, across grouped and single cards (1.20325ms)
✔ remainingItemCount drops settled items, so answering a 4-item merge card moves 9 to 5 (0.134791ms)
✔ remainingItemCount is 0 for no cards and ignores settled ids it never held (0.081125ms)
✔ mergeCandidateDetails keeps payload fields when hydration returns nulls (0.857458ms)
✔ mergeCandidateDetails prefers hydrated fields when they exist (0.077584ms)
✔ mergeCandidateDetails passes the payload through when there is no hydration row (0.070208ms)
✔ candidateUpdatedLabel drops the year inside the current year, keeps it otherwise (1.210625ms)
✔ candidateUpdatedLabel is empty for missing or unparseable stamps (0.089625ms)
(node:87538) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/catalogPatches.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ merge: rows only on one side pass through (6.711583ms)
✔ merge: newest UpdatedAt wins per key, either direction (0.237917ms)
✔ merge: ties and missing/unparseable stamps go to overlay (direct fetch) (0.135875ms)
✔ merge: post-import shape — fresh direct rows beat a stale-but-larger legend mirror (0.149917ms)
✔ variant patches: merge last over the row, newest-wins (0.201792ms)
✔ variant patches: a stale patch never overrides a fresher server row (0.139375ms)
✔ variant patches: unknown row ids are ignored; Products projection deep-merges (0.122542ms)
✔ variant patches: array-form Products projection is normalized before merge (0.276625ms)
✔ level patches: id patch hits its row directly (0.207708ms)
✔ level patches: match patch resolves by variant + connection + location (0.180584ms)
✔ level patches: null location in match means the default/unset location (0.089083ms)
✔ level patches: stale patch loses to a fresher level row (0.07375ms)
✔ store: applyVariantPatch coalesces per id, stamps UpdatedAt, notifies, drains (0.356667ms)
✔ store: applyLevelPatch requires an id or a match, and drain clears levels (0.100542ms)
✔ store: drain only removes patches at or before the cutoff (0.096625ms)
✔ store: unsubscribed listeners stop firing; stale marks carry their reason (0.103709ms)
(node:87539) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/connectionImportPresentation.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ latest import is selected by time even when the payload is unsorted (0.851708ms)
✔ a completed import wins over an older failure and stale connection error (0.143ms)
✔ a failure after a success remains the latest visible outcome (0.082584ms)
✔ a current aggregate scan wins over a historical completed import (0.067208ms)
✔ an active first import wins over a stale disconnected connection snapshot (16.762792ms)
✔ a raw pending first-import status is importing before the run map arrives (0.112875ms)
(node:87540) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/csvImport.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ parseCsv: simple headers and rows (1.789459ms)
✔ parseCsv: quoted field containing a comma (0.096333ms)
✔ parseCsv: embedded newline inside a quoted field (0.074916ms)
✔ parseCsv: escaped double quotes ("") become a literal quote (0.063916ms)
✔ parseCsv: CRLF line endings (0.078666ms)
✔ parseCsv: strips a leading UTF-8 BOM from the first header (0.061709ms)
✔ parseCsv: preserves trailing empty fields (0.071167ms)
✔ parseCsv: skips fully-empty lines (0.057541ms)
✔ parseCsv: lone CR (old-Mac) line endings (0.083292ms)
✔ parseCsv: empty input yields empty headers and rows (0.143833ms)
✔ parseCsv: throws a descriptive error past the row cap (17.946375ms)
✔ csvRowsToObjects: zips rows against headers (0.179458ms)
✔ csvRowsToObjects: pads short (ragged) rows with empty strings (0.08075ms)
✔ csvRowsToObjects: ignores cells beyond the header count (0.053ms)
✔ parseCsv: a mid-field inch-mark quote stays literal and preserves structure (0.082375ms)
✔ parseCsv: stray characters after a closed quote append literally (0.092416ms)
✔ parseCsv + csvRowsToObjects: end-to-end on a quoted/CRLF file (0.079ms)
(node:87541) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/importFrontDoor.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ front door rows account for every item in the Square receipt (3.1705ms)
✔ zero skipped and needs-look buckets stay hidden (0.097667ms)
✔ zero questions produces Done with no Later action (0.0975ms)
✔ owed questions keep the questions and Later actions (0.062334ms)
(node:87542) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/importStatus.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ resolution fan-out skips connections whose server attention count is zero (6.555208ms)
✔ one failed resolution uses only that connection server count (0.952875ms)
(node:87543) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/inventorySync.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ mergeInventoryLevelsByNewest selects the newest version of each row (0.902ms)
✔ mergeInventoryLevelsByNewest deterministically prefers Legend when timestamps tie or cannot be parsed (0.096125ms)
✔ stripInventoryFromPlatformData keeps mixed product edits while removing generic inventory writes (0.921917ms)
✔ buildInventoryQuantityUpdate resolves base inventory to the canonical variant and raw location (2.169791ms)
✔ buildInventoryQuantityUpdate resolves an all-tab option key to the stored variant ID (30.10775ms)
✔ buildInventoryQuantityUpdate refuses a target without a real connection (0.086833ms)
✔ buildInventoryQuantityUpdate refuses an editor-only location id (0.067584ms)
(node:87544) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/inventorySyncPolicy.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ all five inventory collections have bounded request sizes (3.049292ms)
✔ variant list projection excludes Description but retains title and tags (0.126875ms)
✔ paged collection assigns full pages then replaces with the completed cycle (0.2065ms)
✔ legacy undefined-key cache is repaired from the row Id (0.090292ms)
✔ UTF-8 payload measurement counts multibyte text (0.103209ms)
(node:87545) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/liquidationConversationState.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ first send from home creates queued user message and pending turn (27.182416ms)
✔ queued sends during streaming keep both pending turns in order (1.002459ms)
✔ retryFailedTurn re-queues a failed message (0.241375ms)
✔ retryFailedTurn keeps uploaded photos on the retried turn (0.130208ms)
✔ mergeRemoteMessages keeps unsent local messages while hydrating remote history (0.220625ms)
✔ mergeRemoteMessages keeps client-authored assistant summaries (0.103125ms)
✔ acknowledgeMessage reconciles optimistic user bubble with server id (0.259084ms)
(node:87546) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/platformConnectionList.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ selling-platform partition filters csv, keeps live/importing, and groups inactive rows (1.831583ms)
✔ an active run keeps a stale disconnected row in the main group (2.202417ms)
(node:87547) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/platformConnectionVisibility.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ active enabled connection is visible (2.708916ms)
✔ soft-disconnected connection (IsEnabled=false + inactive) is NOT visible (0.0945ms)
✔ inactive status alone hides the connection even when IsEnabled is true (0.057917ms)
✔ IsEnabled=false alone hides the connection regardless of status (0.058041ms)
✔ error connection stays visible — it needs a reconnect action (0.0645ms)
✔ mid-import statuses are visible (0.06875ms)
✔ status matching is case- and whitespace-insensitive (0.056917ms)
✔ missing fields default to visible (a bare row is not assumed dead) (0.062125ms)
✔ soft-disconnected rows ARE listed (Disconnected state, tap re-enables) (0.097959ms)
✔ active, error, and scanning rows are listed (0.428167ms)
✔ a hypothetical deleted status is never listed (tripwire) (0.0725ms)
✔ disconnected detection: either disabled flag or dead status counts (0.072458ms)
✔ every in-flight import status keeps the poll alive (0.086375ms)
✔ settled statuses do not keep the poll alive (0.056625ms)
(node:87548) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/platformConnectionsCache.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ connection cache hydrates only for its Clerk owner (3.29575ms)
✔ connection cache storage is partitioned by owner (0.201208ms)
✔ connection cache rejects malformed payloads (0.085541ms)
(node:87549) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/poolInventoryFold.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ isIndependentPoolMode: only independent is independent; missing defaults to shared (0.84975ms)
✔ foldPoolQuantities: replicated pools take max (the 3-location x10 pool reads 10, not 30) (0.650708ms)
✔ foldPoolQuantities: independent (split) pools sum (0.105291ms)
✔ foldPoolQuantities: empty and junk inputs (0.065ms)
✔ buildPoolModeIndex: maps pool id to mode, defaulting to shared (0.917292ms)
✔ sumPooledLevelQuantities: folds per pool by mode, then sums distinct pools (0.11925ms)
✔ sumPooledLevelQuantities: unknown pools default to replicated (max) (0.0745ms)
✔ sumPooledLevelQuantities: pool-less rows sum as singletons (0.060875ms)
✔ sumPooledLevelQuantities: empty input (0.072208ms)
(node:87550) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/pricingResearchCache.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ key is case-insensitive (4.270958ms)
✔ leading whitespace on the title never splits the cache (0.148291ms)
✔ identity fields separate entries: same title, different category or condition (0.124833ms)
✔ missing optional fields key the same as empty ones (0.289709ms)
✔ fresh entry is served back (0.224458ms)
✔ miss on unknown key (0.120291ms)
✔ entry exactly at the staleness window is stale (0.117834ms)
✔ stale entry is evicted on read (no zombie hit with an earlier clock) (0.084584ms)
✔ put overwrites: a forced refresh replaces the previous result and its clock (0.110917ms)
✔ custom ttl override is honored (0.132ms)
(node:87551) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/productBulkActions.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ bulk delete preserves the mobile soft-archive action contract (4.442583ms)
✔ bulk action receipts expose rejected and missing items as failures (0.164041ms)
(node:87553) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/productPatchContract.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ vendored product patch contract has the locked backend shape (1.556916ms)
(node:87554) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/productPatchRouting.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ editor editability is derived from the vendored manifest (2.322042ms)
✔ mobile product patch picker sends only contract fields (2.126792ms)
(node:87555) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/progressiveEnrichment.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ late taxonomy and shipping defaults fill an untouched draft (3.168792ms)
✔ late enrichment never overwrites a locally edited taxonomy group (0.195875ms)
✔ late enrichment never mixes server policy into locally edited shipping (0.09325ms)
✔ only pending enrichment exposes a non-blocking label (0.068166ms)
(node:87556) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/questionQueue.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ group keep-separate payload uses member ids, create, and each current version (1.69475ms)
✔ a conflict stays in the queue with its refreshed version and is not saved (0.231667ms)
✔ group count and save notice use the same per-item bulk results (0.169958ms)
✔ already-resolved items are settled and removed from the queue (0.079584ms)
✔ bulk requests are chunked at the 500-item endpoint limit (0.150083ms)
✔ an item with no CAS token is never sent as a fabricated version 0 (0.133167ms)
✔ three yes pair cards offer a handoff for the remaining reason class (0.143958ms)
✔ a no answer resets the yes streak and does not offer a handoff (0.078417ms)
✔ a pair streak never includes field conflicts or other reason classes (0.12925ms)
✔ which-one cards cannot earn the reusable pair handoff (0.11975ms)
✔ three consecutive yes answers are required after any no (0.110125ms)
✔ the V7 offer window stays open past three yes answers (0.086542ms)
(node:87557) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/realtimeRetry.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ realtime retries use capped exponential backoff (1.660292ms)
(node:87558) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/resumableImports.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ unresolved CSV work exposes its pending count and latest import id (1.640458ms)
✔ finished import count includes only rows the reopened queue can show (0.106292ms)
(node:87559) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/__tests__/toastState.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ a new toast replaces the visible toast without a queue (0.941833ms)
✔ a stale dismiss cannot clear a replacement toast (0.097459ms)
✔ duration is three seconds without an action and five with one (0.071ms)
✔ titles are constrained to one to four words and reject non-string errors (0.071583ms)
ℹ tests 158
ℹ suites 0
ℹ pass 158
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 695.097167
```

Exit code: 0.

### Gate 3 — Vendored contract

Command:

```sh
cd /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6 && node scripts/check-product-contract.mjs
```

Output (verbatim):

```text
[contracts:check] SKIPPED: backend contract not found at /Users/dosagie/Documents/CodeProjects/sssync-bknd/src/contracts/product-patch.contract.ts. Set ANORHA_BKND_ROOT to a backend checkout that contains src/contracts/product-patch.contract.ts.
```

Exit code: 0.

### Gate 4 — Forbidden item writes

Command:

```sh
cd /Users/dosagie/Documents/CodeProjects/sssync-bknd-assure3 && ITEM_WRITE_MOBILE_ROOT=/Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6 node scripts/check-item-writes.mjs
```

Output (verbatim):

```text
check:item-writes passed: 0 forbidden Products/ProductVariants mutations
scanned roots: /Users/dosagie/Documents/CodeProjects/sssync-bknd-assure3/src, /Users/dosagie/Documents/CodeProjects/sssync-bknd-assure3/scripts, /Users/dosagie/Documents/CodeProjects/sssync-mobile-assure6
```

Exit code: 0.

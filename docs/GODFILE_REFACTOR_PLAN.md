# God-File Refactor Plan — ProductDetail / ListingEditorForm / LocationsManagerV2

> Companion to `src/screens/AddProduct/NEXT_ENGINEER_PLAN.md`. AddProductScreen
> is already decomposed (components extracted, dead styles gone, logic plan
> written). These three are the next-largest files. This doc maps each — grounded
> in the current code (file:line) — and prescribes a **logic-first** path, because
> the leftover *mechanical* work here is presentational (low value), while the real
> debt is the monolithic state + how data is **passed between screens/components**.
>
> | File | Lines | useState | useEffect | useRef | Shape |
> |------|------:|---------:|----------:|-------:|-------|
> | `src/screens/ProductDetail.tsx` | 4535 | 46 | 21 | 25 | one `observer()` monolith, inline modal JSX |
> | `src/components/ListingEditorForm.tsx` | 3999 | 42* | 22 | 11 | 8 leaf comps + `ListingEditorFormInner` (3606 lines, **26 props**) |
> | `src/components/LocationsManagerV2.tsx` | 3042 | 30 | 5 | 0 | 2 leaf comps + main; styles already split out |
>
> *\*42 counts the leaf components; `ListingEditorFormInner` itself holds ~38.*

---

## 0. The relationship that matters

**ProductDetail is the hub.** It owns the product, then renders `ListingEditorForm`
and drives it through **26 props** (`ListingEditorForm.tsx:370`) — `platforms`,
`images`, `onChangePlatforms`, `onChangeImages`, `onOpenFieldPanel`,
`onRegenerateField`, `onGeneratePlatform`, `externalUpdates`, `onAdoptExternalUpdate`,
… This prop explosion is the cross-component version of the same disease AddProduct
has across pages: **state lives in the parent, behavior lives in the child, and they
are glued by a wide untyped/loosely-typed surface.** Fixing ProductDetail and
ListingEditorForm is one job, not two. LocationsManagerV2 is independent and the most
tractable — a good warm-up.

## 1. Shared anti-patterns (the "why we keep writing fallbacks")

1. **Full objects passed by value into a screen.** `ProductDetail` reads
   `route.params?.item` (the entire product object) with a `productId` fallback
   (`ProductDetail.tsx:227-228`). Same pattern as AddProduct: large param payloads +
   a second id-based load path that must be kept in sync.
2. **`as never` / `as any` at navigation + param reads.** `ProductDetail.tsx:1954,
   2000` cast `navigate(... as never)`; the 26-prop `ListingEditorForm` boundary is
   effectively untyped in practice. Types exist (`AppStackParamList`,
   `AppNavigator.tsx:88`) but are bypassed.
3. **Monolithic state.** 46 / ~38 / 30 `useState` in single components. The flow is an
   implicit machine: load → edit (dirty tracking) → save draft → publish, plus
   collaborative locking and external updates layered on top.
4. **Collaboration state hand-wired.** `isLockedByOther`, `lockOwner`, `draftVersions`,
   `externalUpdates`/`onAdoptExternalUpdate` (`ProductDetail.tsx:497-507,416` →
   `ListingEditorForm` props) implement real-time co-editing by threading flags
   through props. This is the riskiest logic to touch and the most valuable to isolate.

---

## 2. ProductDetail.tsx — the hub (do first, plan-driven)

One `observer()` component (`:224`). No clean inline sub-components — decomposition is
**logic surgery**, not lift-out. The 46 `useState` cluster into clear domains:

| Domain | State (line) |
|--------|--------------|
| Core data | detailedItem (254), mappings (269), groupedInventory (270), connections (271), activityLogs (272) |
| Form + dirty | formData (510), hasUnsavedChanges (350), isSaving (351), pendingImages (534), updateCounter (479), displayedPlatforms (480) |
| Draft + locking (collab) | draftData (501), isLoadingDraft (502), draftVersions (507), isLockedByOther (497), lockOwner (498) |
| Pricing / inventory | variantPricing (397), rawInventoryLevels (399), allProductVariants (401), platformLocationNames (406), allPlatformLocations (409) |
| Sync | syncStatus (529), fetchErrors (530), isSyncing (533), facebookSyncMeta (1730) |
| External updates (collab) | externalUpdates (416) |
| Modals/UI | isActivityModalVisible (276), isBarcodeScannerVisible (277), isImagePickerVisible (278), actionMenuVisible (506), isDangerZoneVisible (332), banner* (360-363), deleteConfirmation (503) |
| Partnerships | partnerships (323), isLoadingPartnerships (324), partnershipActionLoading (325) |
| Publish | isPublishing (1729), generatingPlatformKeys (1526) |

**Target (incremental, leaf-domains first):**
- `hooks/useProductData.ts` — core fetch/load (detailedItem, mappings, inventory,
  connections, activityLogs) keyed by `productId`. Make `route.params` pass **only
  `productId`**; drop the by-value `item` path (`:227`). This is the cross-page fix.
- `hooks/useProductDraft.ts` — formData + dirty tracking + save/version. (Note: a
  `useProductDraft` hook already exists in `src/hooks/` — reconcile, don't duplicate.)
- `hooks/useCollabLock.ts` — isLockedByOther/lockOwner/draftVersions/externalUpdates.
  **Isolate this behind one typed interface** so the co-editing rules live in one place
  instead of being threaded through ProductDetail → ListingEditorForm props.
- `hooks/usePricingInventory.ts`, `hooks/useSyncStatus.ts` — the pricing/inventory and
  sync clusters.
- Extract the inline modals (`ProductDetail.tsx:4008` Action Menu, `:4081` Barcode
  Scanner, plus Activity/ImagePicker) into `ProductDetail/modals/*` once their state
  moves into hooks.

## 3. ListingEditorForm.tsx — the 26-prop child

Two separable jobs here:

**(a) Mechanical (low value, optional):** 8 self-contained leaf components are trivially
extractable to `src/components/ListingEditor/`:
`CollapsibleSection` (:203), `StickyActionBar` (:258), `ModernInput` (:292),
`SectionHeader` (:353), `SimpleQuantityInput` (:3608), `Field` (:3658),
`ChipsField` (:3728), `LocationDropdown` (:3789). They share a `styles` object — follow
the co-locate/duplicate-shared-keys approach used in AddProduct. Note `CollapsibleSection`
depends on `SectionHeader`, so extract `SectionHeader` first. Do this only if you want a
quick line-count win; it does **not** address the real debt.

**(b) Logic (high value):** shrink the **26-prop surface** (`:370`). Group the ~38 inner
`useState` by domain and lift each into a hook + a **context** so ProductDetail stops
prop-drilling:

| Domain | State (line) |
|--------|--------------|
| Tabs/disclosure | activeTab (389), showAdditionalFields (390), showAdvanced (391), optionEditorOpen (392) |
| Variants/options | variantSearchQuery (388), newOptionName/Values (393-394), allPlatformOptions (409), optionPresets (410) |
| Taxonomy (eBay/FB) | taxonomyQueries/Results/Loading (413-415), aspects (417), aspectsLoading (418), ebayConditions* (419-420) |
| Pricing research | pricingResearch* (421-426), pricingSourcesSheetVisible (423), pricingHistoryRange (424) |
| Shipping/delivery | shippingEstimate* (436-447), deliverySheetVisible (449), editableDimensions/Weight* (450-452) |
| Image/location pickers | openImagePickerFor (412), variantImagePicker (454), locationPickerVisible (466), selectedLocationId (1120) |

Target: replace the 26 props with a `ListingEditorContext` (the product draft + the
handful of genuine callbacks). The taxonomy/pricing/shipping clusters become
`useTaxonomy`, `usePricingResearch`, `useShippingEstimate` hooks that fetch via
`src/lib/apiClient.ts` rather than inline `fetch`.

## 4. LocationsManagerV2.tsx — most tractable (good warm-up)

30 `useState`, only 5 `useEffect`, **0 `useRef`**; styles already in
`LocationsManagerV2Styles.ts`; 2 leaf components (`PoolAccordionItem` :154,
`PartnerWelcomeOverlay` :259) extract cleanly. The state is a clean draft-editing
machine: `pools`/`singleLocations` (loaded) vs `draftPools`/`originalPools` (edit buffer,
:427-428) — a classic original/draft diff. Lift into:
- `hooks/usePoolDraft.ts` — draftPools/originalPools/newPool* + dirty diff + save.
- `hooks/usePartnerInvites.ts` — invite* + pendingInvites + isInviting (:435-438, 380).
- Extract `PoolAccordionItem` + `PartnerWelcomeOverlay` to files; keep view flags
  (viewMode/activeTab/expandedPools) in the main component.

Because it has no refs and few effects, this is the lowest-risk file — do it first to
validate the hook-extraction pattern before tackling the ProductDetail/ListingEditor pair.

---

## 5. Build these once, reuse across all three

1. **Typed route params.** Extend `AppStackParamList` (`AppNavigator.tsx:88`) so
   `ProductDetail` takes `{ productId: string }` (not `item`). Delete the `as never`
   casts; let `tsc` find the breakages.
2. **`apiClient` adoption.** All three still have inline `fetch`. Route through
   `src/lib/apiClient.ts` (already built) for consistent auth/error handling.
3. **A draft/collab module.** Locking + external-update adoption appears in both
   ProductDetail and ListingEditorForm. One typed module (`src/features/draftCollab/`)
   should own it; both screens consume it. This removes the scariest threaded state.

## 6. Sequencing

1. **LocationsManagerV2** — warm-up; prove the hook pattern (lowest risk).
2. **Shared infra** (§5.1 typed params, §5.2 apiClient) — small, unblocks the rest.
3. **ProductDetail hooks** — leaf domains first (pricing/inventory, sync), then form/draft,
   then collab-lock last.
4. **ListingEditorForm** — shrink the 26-prop surface via context once ProductDetail's
   draft/collab state is in hooks; extract the 8 leaves opportunistically.

Keep `tsc --noEmit` at 0 after every step (CI enforces it). Each hook extraction is
independently shippable — no big-bang branch. The AddProduct plan's Part A (typed
`flowContract`, pass ids not objects) is the same medicine; apply the same shape here.

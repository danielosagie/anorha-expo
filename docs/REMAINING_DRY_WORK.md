# Remaining DRY-refactor work (V2 Tracks C/G) — execution-ready specs

Status as of branch `refactor/realtime-dry-systems`. The items below were
**designed and adversarially red-teamed** (planning workflow, 12 agents) but are
**deferred from auto-merge** because each either needs a device smoke-test or had
a regression the red-team caught in the blind-implementation spec. The corrections
are baked in so each is ready to execute once a device/simulator is available.

> **UPDATE — most of the deferred work is now IMPLEMENTED** (tsc-clean, pushed), per
> explicit request. These still NEED a device smoke-test before merge:
> - ✅ console→logger codemod — 975 sites (`648a1c62`) + logger module-cycle fix (`6924f5ca`).
> - ✅ AddProduct multi-job poll — inFlight dedup + AppState background-pause (`df3ff42f`).
> - ✅ ProductDetail 3-channel re-plumb onto Legend State onChange (`28bb0a7e`) — channel-ban 4→1.
>
> Still genuinely deferred: **MappingReview interval** (a socket safety-net — left as-is on
> purpose, §3) and **Track A / D / F** (strategic / security — "Out of scope" below).
> The detailed specs below remain as the reference for what each change does + how to verify.

## Already shipped on this branch (tsc-clean, lint-ratchet-clean)
- Foundations: `src/hooks/useJobStatus.ts`, `src/lib/withRetry.ts`,
  `src/constants/{tableNames,jobStatus,storageKeys}.ts`, `SOCKET_BASE_URL` in
  `src/config/env.ts`, console facade `createLogger` in `src/utils/logger.ts`.
- PlatformConnectionsContext: raw `io()` → shared `acquireCollaborationSocket()`;
  `getSupabaseUserId()` helper + `UserId=eq.<id>` realtime filter (RLS fallback).
- collaborationSocket URL env-aware; Manifest/ReceiptReviewSheet pollers → `useJobStatus`.
- Deleted dead `useProductVariantRealtimeForProduct`. ESLint bans on
  `supabase.channel()/from()` outside the data layer (warn ratchet).

---

## 1. ProductDetail: 3 channels → Legend State `onChange()`  — NEEDS DEVICE TEST
**Risk: medium · red-team: implement-with-caveats (MEDIUM-HIGH residual)**

Replace the 3 `supabase.channel()` subs (`product-*` ProductVariants, `inventory-*`
InventoryLevels **unfiltered**, `mappings-*` PlatformProductMappings) at
`ProductDetail.tsx:~3199-3572` with `obs.<observable>$.onChange()` from
`getLegendStateObservables()`. Diff `getPrevious()` vs `value` to derive
INSERT/UPDATE/DELETE; route each to the **existing, verbatim** handlers (save-blocking
window, `hasUnsavedChangesRef` guard, green-border `setExternalUpdates`, in-place
grouped/displayed merges, deferred-reload scheduler). Collect each `onChange` dispose
fn and call all on cleanup.

**Red-team corrections (MUST apply):**
1. **No `{ isFromSync: true }` options arg** — Legend State `onChange(cb, options?)`
   has no such option (it's typed `any`, so tsc won't catch it; it silently no-ops).
   Filter **inside** the callback: `({ value, getPrevious, isFromSync }) => { if (!isFromSync) return; ... }`.
2. **Add `detailedItem?.ProductId` to the effect dep array** (inventory filtering uses
   the per-product variant list).
3. **Batching changes banner semantics**: two realtime events in one sync cycle fire
   `onChange` **once** (merged) → one banner instead of two. Likely better UX, but it's
   an observable behavior change — verify on device.
4. Note: only `productVariants$`/`inventoryLevels$`/`platformProductMappings$` are
   realtime-enabled in SupaLegend; don't assume all observables are.

**Device-test checklist:** edit a product; trigger an external realtime update (2nd
device or manual DB edit) and confirm — (a) save-window suppresses the banner, (b)
unsaved-changes blocks the reload, (c) in-place inventory updates render, (d) external
field changes highlight green, (e) deferred reload fires after save unblocks.

> ⚠️ You are actively editing ProductDetail — coordinate before re-plumbing.

---

## 2. AddProductScreen multi-job poll  — NEEDS DEVICE TEST
**Risk: low→medium · red-team: implement-with-caveats (HIGH residual if naive)**

Goal: remove duplication + add AppState background-pause to the `genJobs` poll loop
(`AddProductScreen.tsx:~807-866`) **without** touching the match→auto-generate chaining
/ state-machine.

**Red-team corrections (MUST apply):**
1. **Preserve catch-and-continue**: the current bare `fetch` + empty `catch` keeps
   polling on transient errors. `api.get()` **throws** on non-2xx → wrap the snapshot
   fetch in `try/catch` that returns `null` (and skip that job this tick). Do NOT let it
   throw out of the loop.
2. **Add an `inFlightRef` dedupe guard** — the existing loop has none; if a tick takes
   >1.5s, overlapping fetches fire. (useJobStatus already has this pattern.)
3. Don't add a 2nd overlapping fn to `generateJobs.ts`; extend `fetchGenerateJobStatus`
   to take `processType` instead of a parallel `fetchJobStatusSnapshot`.

**Device-test:** AppState pause/resume only fires on a real device — verify polling
stops in background and resumes (with an immediate poll) on foreground.

---

## 3. MappingReviewScreen scan-poll interval  — DEFER (do NOT remove blind)
**Risk: HIGH if naively removed · red-team: defer**

The `setInterval(2500ms)` at `MappingReviewScreen.tsx:~103` looks redundant (it reads
the already-reactive `syncProgress?.status`), **but it is a safety-net fallback**: if a
`sync:progress` socket event is dropped (reconnect, bg/fg, packet loss) the reactive
effect never fires and the UI hangs in "scanning" forever. If you convert it to a pure
reactive effect, you **must** keep a fallback timeout (e.g. re-check / force-refresh
after N seconds) and add an unmount guard + memoized `refreshSuggestions`. Otherwise
leave it.

---

## 4. console.* → logger codemod (~996 sites, 89 files)  — RUN AS ITS OWN PR
**Risk: low (mechanical) but large diff · red-team: implement-with-caveats**

Node AST codemod: per file add `import { createLogger } from '<rel>/utils/logger'` +
`const log = createLogger('<Scope>')` and rewrite `console.{debug,log,info,warn,error}`
→ `log.*`, preserving all args.

**Red-team corrections (MUST apply):**
1. **Import path**: for a file at depth D below `src/` (D=1 = `src/*`), path is
   `(D-1) × '../' + 'utils/logger'`. (The spec's `src/components/Z/a.tsx → ../../../../utils/logger`
   was wrong; correct is `../../utils/logger`.) Max depth in repo is 4.
2. **Scope** = `path.basename(file, ext)` (drop extension).
3. **Document the prod behavior change**: the facade drops `debug`/`info` in release
   (`ENV.isDev=false`), so migrated `console.info/log` go silent in prod. That's the
   intent (PII/noise reduction) — confirm acceptable in QA.
4. **Idempotent + conflict-safe**: skip files that already have a top-level `log`
   binding (e.g. `ListingEditorForm.tsx` imports a `logger` from reanimated) or already
   ran the codemod; include `console.debug`.
5. Verify: `tsc --noEmit` 0 errors (catches broken paths); `grep -r 'console\.' src`
   returns only `logger.ts`.

---

## Out of scope — human strategic / security decision (NOT auto-merged)
- **Track A — Clerk-native auth + RLS rewrite**: security-critical (~100 policies; a
  prior premature cutover caused the AccountSyncIssue). Org-scoped policies can't use a
  blanket `coalesce()` and need per-policy audit + two-user device RLS-isolation test.
  *Already going live separately* — do not touch from this refactor.
- **Track D — PowerSync sync engine**: new managed/self-hosted infra; explicit
  pilot-first decision gate (prove CPU/offline wins). Depends on Track A.
- **Track F — god-component decomposition** (AddProductScreen 5.9k, ProductDetail 4.6k):
  the `max-lines` rule is `warn`, not `error`, and decomposition order isn't mechanical —
  do it incrementally as files are touched, not as a blind autonomous pass.

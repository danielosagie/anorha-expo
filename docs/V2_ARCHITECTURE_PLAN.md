# sssync v2 Architecture Plan

Researched plan for the foundational rethinks agreed on. Scope spans **sssync-native** (Expo RN)
and **sssync-bknd** (NestJS + Drizzle, same Supabase Postgres). This is a *plan* — sequencing,
blast radius, risk, and verification — not yet implemented.

Decisions locked in:
- **Clerk is the sole auth.** Move to Supabase native third-party auth; delete the custom JWT-exchange bridge.
- **Platforms are data**, not `On*` boolean columns.
- **Jobs are one domain.**
- **Sync is a real engine**, not hand-wired realtime + offline queue.
- **Money stays in integer minor units (cents)** — required by Square/Clover. No change; just standardize one `Money` type/helpers.
- **#7 (module boundaries) is whole-app and goes LAST.**

Recommended execution order (by dependency + leverage): **Auth → Platforms-as-data → Jobs → Sync engine → Casing(minimal) → Module boundaries.**

---

## Track A — Auth: Clerk-native Supabase, delete the bridge  (#2)

**Today:** mobile `configureClerkSupabaseBridge` → `POST /api/auth/exchange` mints a 10-min HS256
JWT with `sub = Users.Id (UUID)`; a custom `supabaseFetch` injects it; **~52 files** call
`ensureSupabaseJwt`/`forceRefreshSupabaseJwt`. Backend `SupabaseAuthGuard` has 3 verify paths
(custom HS256, Supabase native, raw Clerk).

**Target:** `createClient(url, key, { accessToken: async () => clerkSession.getToken() })`. Supabase
validates Clerk's token via JWKS; Clerk injects `role: "authenticated"`. No minting, no refresh
timer, no bridge.

**⚠️ The crux — `sub` changes meaning.** Native Clerk `sub = "user_xxx"` (Clerk id); today every
`UserId` FK and RLS policy keys on the internal `Users.Id` UUID. So you cannot just swap tokens.
Resolve with an **RLS mapping function** (keep the UUID data model):
```sql
-- SECURITY DEFINER, stable; maps the Clerk sub on the JWT to the internal user UUID
create or replace function app_user_id() returns uuid language sql stable security definer as $$
  select "Id" from "Users" where "ClerkUserId" = auth.jwt()->>'sub'
$$;
```
Rewrite RLS policies from `auth.uid() = "UserId"` → `app_user_id() = "UserId"`. (`Users.ClerkUserId`
already exists and is populated by the current exchange path.)

**Steps**
1. Supabase dashboard: add Clerk as a third-party auth provider (Clerk domain).
2. Clerk: enable the Supabase integration so session tokens carry `role: "authenticated"`.
3. DB migration: `app_user_id()` + rewrite RLS on all user-scoped tables to use it. **Audit every policy** (this is the real work).
4. Mobile `supabase.ts`: set `accessToken` to the Clerk token getter; delete `supabaseFetch` token injection, the refresh timer, `configureClerkSupabaseBridge`, `forceRefreshSupabaseJwt`. Keep `ensureSupabaseJwt` as a thin no-op shim initially to avoid touching all 52 sites at once; migrate `apiClient`/tRPC to send the Clerk token; then delete the shim.
5. Backend: keep `SupabaseAuthGuard` Path 3 (raw Clerk) as the only path; retire `/api/auth/exchange` + Path 1 once mobile no longer mints.
6. Realtime auth: pass the Clerk token to `supabase.realtime.setAuth` (or rely on `accessToken`).

**Blast radius:** ~52 files, but centralizes to `supabase.ts` + `apiClient.ts` + the RLS migration.
**Risk:** RLS rewrite is security-critical — do it behind the realtime/data work, test per-table.
**Verify:** sign in as two users; confirm RLS isolation; confirm reads/writes/realtime work with no `/auth/exchange` calls in logs; idle >10 min (old expiry) still works.

---

## Track B — Platforms as data  (#4)

**Today:** `ProductVariants.On{Shopify,Square,Clover,Amazon,Ebay,Facebook}` booleans — adding a
platform = schema migration + new boolean threaded through **41 refs / 7 files** (worst:
`InventoryOrdersScreen` = 19). `PlatformProductMappings` already exists: `(ProductVariantId,
PlatformConnectionId, IsEnabled, SyncStatus, …)` and `PlatformConnections.PlatformType`.

**Target:** "which platforms is this variant on" = a query over `PlatformProductMappings ⋈
PlatformConnections.PlatformType` where `IsEnabled`. Adding a platform = data, not schema.

**Steps**
1. DB: a view/RPC `variant_platforms(variant_id) → text[]` (or a generated column) deriving platform types from enabled mappings. Optionally keep a denormalized `platforms text[]` cache on the variant, maintained by trigger, to preserve fast list filtering.
2. Mobile: introduce `useVariantPlatforms(variantId)` (reads the cache/derived field); migrate the 7 files off `variant.OnShopify` etc. Start with the 3 low-ref screens, then `InventoryOrdersScreen`.
3. Deprecate then drop the 6 boolean columns once no readers remain; regenerate types/Zod.

**Blast radius:** 7 files. **Risk:** low-medium (filtering/perf on the big list — keep a derived array). **Verify:** platform badges/filters match mappings; adding a fake platform connection lights up without code change.

---

## Track C — Jobs as one domain  (#6)

**Today:** **11 tables** model "a job": `SyncBatches`, `generateJobs`, `productAnalysisJobs`,
`matchJobs`, `regenerateJobStatuses`, `AnorhaSyncOperations`, `QuickScanSessions`, `agentSessions`
(+threads/messages), `RawImportItems`. Mobile reads them via **4 different paths** —
`useImportProgress` (REST poll 5s), `useJobsState` (REST poll 2s), `useSyncProgress` (socket),
`useCollaboration` (socket) — ~8 hooks / ~2,100 LOC.

**Target:** one `jobs` table (`id, user_id, type, status, progress jsonb, payload jsonb, result
jsonb, error, timestamps`) with `type ∈ {import, sync, ai_generate, match, regenerate, optimize}`;
one realtime subscription; one `useJob(id)` / `useJobs(filter)`. Agent sessions (liquidation) can
stay separate (genuinely different domain) or become `type = 'agent'`.

**Steps**
1. Backend: add `jobs` table; write new job producers to it; **dual-write** from the legacy tables during transition (or a view union) so nothing breaks.
2. Mobile: `useJob`/`useJobs` over one realtime channel; migrate the 8 hooks to thin wrappers over it, then delete them.
3. Retire legacy job tables once producers/consumers are migrated.

**Blast radius:** backend (producers) + ~8 mobile hooks + their consumers. **Risk:** medium-high (touches live import/sync UX). **Verify:** import, AI-generate, and sync each show progress through the single `useJob`; no polling loops remain.

---

## Track D — Sync: formalize Legend State  (#1)  — DECIDED: keep Legend State

**Decision (confirmed):** stay on Legend State; **do not** adopt PowerSync. No new infra/dependency.
This track is now "make the existing Legend State layer solid," not a sync-engine swap.

**What's already fine** (verified in `src/utils/SupaLegend.ts`): the offline write queue is *not*
actually dead — each synced collection runs with `retry: { infinite: true }` + `retrySync: true` +
AsyncStorage persist, so pending writes survive offline and replay on reconnect. `productVariants$`
and `marketplaceListings$` already use **scoped** realtime (`realtime: { filter: 'UserId=eq…' }`).

**The real remaining work — scope the 2 unfiltered realtime subscriptions** (the realtime CPU cost):
- `platformProductMappings$` (`realtime: true`) and `inventoryLevels$` (`realtime: true`) subscribe
  to ALL rows and lean on RLS. Neither has a directly-filterable `UserId` column.
- **Gated on a small schema choice** (one of):
  1. add a denormalized `UserId` (or broadcast topic) column to `PlatformProductMappings` /
     `InventoryLevels` so realtime can filter `UserId=eq.${userId}` like the others; **or**
  2. a backend broadcast channel the client subscribes to per user; **or**
  3. `InventoryLevels` has `OrgId` — filter by org for single-org users (insufficient for
     multi-org members).
- Until then, leave them as-is (RLS-correct, just chatty).

**Lower-risk cleanups (need an on-device smoke test — touch the live cache):**
- DRY the repeated `customSynced({...})` config into one typed `syncedCollection()` factory
  (standardize persist-key versioning + retry). Behavior-preserving, but verify on device.
- Remove the dead commented-out observable examples + disabled diagnostic block in `SupaLegend.ts`.

**Blast radius:** medium (live cache layer). **Risk:** the realtime scoping is gated on the schema
choice above; the refactors are safe-by-construction but warrant a device smoke test since there's
no runtime harness here.

---

## Track E — Casing / schema  (#3) — honest scope

**Finding:** 95% PascalCase, only **3 snake_case anomalies** (`PlatformConnections.pool_id`,
`OrgMemberships.assigned_pool_ids`, an `org_member_stats` view). The *pain* that motivated #3
(drift, hand-maintained types, casing mismatches) is **already largely solved** by the generated
`database.types.ts` + Zod single source.

**Recommendation (counsel):** a full PascalCase→snake_case rename of a live DB (every column +
Drizzle + RLS + realtime filters + 96 frontend remaps) is **high-risk, low-value** now. Instead:
1. Fix the **3 anomalies** for consistency (cheap), regenerate types.
2. Add a naming convention + lint so **new** tables/columns are consistent.
3. Reserve a full rename for **if/when Track D** rebuilds the schema surface anyway (do it via DB views for backward-compat during cutover). Otherwise skip it — the generated types already removed the real cost.

---

## Track F — Module boundaries  (#7) — LAST, whole-app

After A–D land (so you restructure the *new* shape, not the old). Target:
- **Feature-sliced folders** (`features/inventory`, `features/sync`, `features/listing`, …); screens are thin composition; logic in hooks/services.
- **Lint rules:** max file size (kills the 7,430-line `AddProductScreen`), ban `supabase.from()` in screens (must go through the data layer), ban raw `fetch` (must go through `apiClient`/tRPC).
- **One telemetry facade** (Sentry + PostHog behind `logger`); ban raw `console.*`.
- **Test harness** for the auth + sync + jobs paths before re-growing LOC.
- Decompose the God components (`AddProductScreen` 7.4k, `ProductDetail` 4.5k, `ListingEditorForm` 4k) into feature modules as they're touched.

---

## Dependency graph & sequencing

```
A (auth) ──┬──────────────► D (sync engine)        ← largest; gated by a pilot
           │
B (platforms-as-data)  ─ independent, do alongside A
C (jobs)               ─ independent (backend-heavy)
E (casing, minimal)    ─ cheap, anytime
F (module boundaries)  ─ LAST, after A–D, whole-app
```

**Per-track risk:** A = security-critical but contained; B = low; C = medium; D = high (decision gate); E = trivial subset; F = large but mechanical with lint enforcement.

**Already delivered (foundation these build on):** generated DB types + Zod contract, typed
`apiClient`, tRPC privileged contract, realtime fan-out fix, optimistic-concurrency `guardedUpdate`.

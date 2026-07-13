# Import Hub — cross-screen param handoff (branch `claude/honora-import-ux-z7bkcn`)

These routes carry params that are **not** in `AppStackParamList` (AppNavigator.tsx
is intentionally untouched). The receiving screens read them via `route.params`
cast to `any` — the same pre-existing convention `BackfillOptimizer.finishOptimize`
already uses to pass `origin:'import'`. Senders cast the route name `as any`.

If/when these should become first-class types, extend `AppStackParamList` for:

## `PublishConfirmation` (import variant, `origin: 'import'`)

Read by `ImportCompleteView` in `PublishConfirmationScreen.tsx`.

| param | type | sent by |
|---|---|---|
| `origin` | `'import'` | SyncInbox deck done, BackfillOptimizer finish |
| `importCounts` | `{ linked: number; created: number; ignored: number; autoLinked: number; autoCreated: number }` | SyncInbox deck done (session tally + summary) |
| `importCount` | `number` | BackfillOptimizer.finishOptimize (legacy count-only) |
| `savedToInventory` | `boolean` | BackfillOptimizer.finishOptimize |
| `connectionId` | `string` | SyncInbox deck done |
| `platformName` | `string` | SyncInbox deck done |
| `platforms` | `string[]` | SyncInbox deck done (receipt channels) |
| `completedLane` | `'matches' \| 'photos' \| 'details'` | optional; forwarded to ImportHub on "Done" |
| `backRoute` | `{ name: string; params?: any }` | pre-existing back target |

Behavior: renders the receipt with a non-zero-only session summary; primary CTA is
`Continue — N need photos/details` → `replace('BackfillOptimizer', { source })` when
the optimizer still has gaps, else `Done` → `replace('ImportHub', { completedLane, connectionId })`.

## `useImportHub` — server aggregate adoption (`GET /api/sync/inbox/summary`)

`useImportHub` prefers a single backend aggregate over its per-connection fan-out,
but the public return shape (`{ loading, error, refresh, totalNeedsYou, scanning,
lanes }`) is **unchanged** — consumers (ImportHubScreen, ConnectionsScreen,
SettingsScreen, SyncRulesScreen) need no edits.

Each refresh cycle first issues ONE request to `/api/sync/inbox/summary` (same
`/api` base-URL normalization + `ensureSupabaseJwt` bearer auth as the fan-out).
The exported `InboxSummaryResponse` type documents the contract for a future typed
client. Mapping on `200`:

| hub output | source field |
|---|---|
| `lanes.matches.count` | `totalNeedsAttention` (authoritative — may exceed the per-connection sum) |
| `lanes.matches.byConnection` | `connections` with `needsAttention > 0` → `{ connectionId, platformName: displayName \|\| platformType, count: needsAttention }` |
| `scanning` | `connections` with `state ∈ {scanning, syncing}` → `{ connectionId, platformName, state }` |

The photos/details lanes stay 100% client-side via `useOptimizerQueues` on both paths.

**Fallback (prod today has no such endpoint):** `404` / any non-2xx / network error
/ malformed body → the aggregate fetch returns `null` and the cycle falls through to
the unchanged per-connection fan-out (`/sync/connections/:id/status` → `/resolution`),
preserving fail-soft semantics (one bad connection contributes 0; only a total
failure sets `error`).

**Retry-after-failure:** the first aggregate miss flips a session ref
(`aggregateDeadRef`) so the 20s scanning poll doesn't re-pay the doomed request every
tick. Explicit `refresh()` — pull-to-refresh and focus re-entry (`refreshAll`) — clears
that ref and retries the aggregate, so once the backend ships it is adopted live
without an app restart. Focus gating, 20s polling while scanning/syncing (on whichever
path is active), stable `refresh` identity, and unmount safety are all retained.

## `BackfillOptimizer`

`source` IS typed (`source?: string`). The hub + import summary pass:

| `source` value | effect |
|---|---|
| `'hub-photos'` | auto-enter the photo lesson once counts load (else stay in lobby) |
| `'hub-details'` | auto-enter the details review path once counts load (else stay in lobby) |

No `connectionId` is passed from the hub lanes → the optimizer runs catalog-wide,
matching the hub's unscoped `useOptimizerQueues` counts. `finishOptimize` still
navigates to `PublishConfirmation({ origin:'import', importCount, savedToInventory })`.

## `ImportHub` (already typed)

`{ completedLane?: 'matches' | 'photos' | 'details'; connectionId?: string } | undefined`
— on arrival it refreshes and the next non-empty lane becomes the highlighted
"active" step. No auto-navigation.

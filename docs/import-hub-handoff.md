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

# Implementation Notes: Connection Fix

## Source context

- The root `DESIGN.md` is present and was read before the contract-update UI change. Its status-row, error-color, typography, spacing, and minimal-copy rules were followed.
- No branch or commit was created. Dependencies were not installed.
- No dev server was started for the contract update, as explicitly requested.

## False Live root cause

`ConnectionsScreen` built `presentationByConnectionId` with `connectionImportPresentationsById`. That helper selected the newest run by `createdAt` and passed the connection row plus that run into `deriveConnectionImportPresentation`.

The old derivation checked active run state first, then checked disconnected state, then accepted a successful latest run before falling back to the current connection status. For the production shape, the connection was unhealthy while the aggregate state was `live` and a newer import was completed. The successful-run branch returned `kind: 'synced'`, label `Synced`, and green before the current row health was evaluated. Backend contract update #210 identifies the missing-scope production row as `Status='review'`. The same stale-run precedence also affected `Status='error'`.

A second override existed in `PlatformConnectionsContext.liveConnections`: a recent progress event could replace a stored error status with an allowed progress status such as `active`. That could make `ConnectFlowSheet` skip OAuth even after the Connections row correctly identified the error.

## Truthful status changes

- `deriveConnectionImportPresentation` now evaluates connection health before progress, aggregate state, or run history.
- `review`, `error`, defensive `needs_reauth`, `revoked`, `NeedsReauth=true`, `SyncState='needs-attention'`, or `RecommendedAction='reconnect'` derive to `Needs attention` and never to synced or importing.
- `review` is a first-class repairable health state. It stays visible in Connections, uses the theme danger color, and cannot be replaced by a successful run.
- `inactive`, `disconnected`, and `disabled` stay disconnected even when a stale run says it is active.
- Run history can only produce synced or import progress after the row has confirmed a healthy `active` or `live` state.
- `PlatformConnectionsContext.liveConnections` no longer applies progress overrides to unhealthy rows.
- The Connections row uses `theme.colors.error` for the unhealthy dot and label.
- An unhealthy row shows `Reconnect`. Tapping it opens the existing `ConnectFlowSheet` path. No new sheet, screen, modal, or navigation target was added.

## Backend contract update #210

- `PlatformConnectionRow` now types `SyncState`, `NeedsReauth`, `RecommendedAction`, and `FailureReason` without `any`.
- The dependency-free structural helper types use the same `SyncState` and `RecommendedAction` unions.
- `review` and `error` are both attention states. Both show `Needs attention` with the existing theme danger token and both open the existing reconnect flow.
- `RecommendedAction='reconnect'` is honored even if another field is temporarily stale.
- `FailureReason` is carried verbatim through `connectionImportPresentationsById` and rendered only on the existing Manage row detail. A null value renders no extra text.
- No backend contract field was left unsupported by this mobile change.

## Refresh root cause and fix

The manage refresh icon was wired to `retryImport`. For an active row it posted to `/api/sync/connections/:id/start-scan`; for an inactive row it patched `/api/platform-connections/:id/enable`. It did not start with an authoritative refetch, and `refresh()` only ran after that mutation returned successfully. It therefore was not a refresh control. Even when a later refetch occurred, the false Live derivation could render the same stale green result.

The icon now awaits both existing refresh paths:

- `PlatformConnectionsContext.refresh()`, which fetches `GET /api/platform-connections?includeDisabled=true` and replaces the connection rows and current statuses.
- `useImportStatus().refresh()`, which refreshes the inbox summary and related status enrichment.

The tapped control shows the existing activity indicator while those requests are in flight, then re-renders from the refreshed shared stores.

## Disconnect means gone

`listSellingPlatformConnections` is now the pure list derivation used by Connections and the Settings preview. It filters CSV pseudo-connections plus `inactive`, `disconnected`, `disabled`, and defensive `deleted` rows. The Inactive state, collapsed section, reconnect-in-place path, imports, and styles were removed from `ConnectionsScreen`.

The existing optimistic disconnect patch sets `IsEnabled=false` and `Status='inactive'`, so the row disappears immediately. The existing disconnect endpoint remains in use.

## Backend follow-up

`POST /api/platform-connections/:id/disconnect` is a soft disconnect. The repository contract says it leaves the row with `IsEnabled=false` and `Status='inactive'`. `GET /api/platform-connections?includeDisabled=true` still returns that row. The mobile client now filters the surviving `inactive` row. Backend follow-up: hard delete on disconnect, or omit inactive rows from the list response while preserving unhealthy rows that need reconnect.

## Slack and Gmail removal

The local `APPS` array, app icons, app-only styles, and the now-empty Apps section were removed from `ConnectionsScreen`. A broad case-insensitive grep across `src/` now finds no Slack, Gmail, Google Mail, or Composio platform references. The canonical platform registries already had no Slack or Gmail entries, and the new registry test locks that exclusion.

## Status value inventory

There is no PlatformConnections status union in this repository. `src/types/schema.ts` declares `PlatformConnectionsRowSchema.Status` as `z.string()`, and `PlatformConnectionRow.Status` is `string` in `PlatformConnectionsContext`.

The exact live PlatformConnections status set is defined by `CONNECTION_STATUS_SET` in `src/context/PlatformConnectionsContext.tsx`:

- `active`
- `inactive`
- `pending`
- `review`
- `ready_to_sync`
- `scanning`
- `syncing`
- `reconciling`
- `error`

The connection lifecycle and visibility code also tolerates these non-live or defensive row literals:

- `disconnected`
- `disabled`
- `revoked`
- `needs_reauth`, retained only as pre-existing defensive tolerance
- `deleted` as a defensive tripwire

`review`, not `needs_reauth`, is the live attention status. `SyncState` is typed as `scanning | syncing | live | needs-attention | error`. `RecommendedAction` is typed as `reconnect | rescan | fix_resume | manage`. `FailureReason` is `string | null`. `NeedsReauth` remains a separate boolean health signal. `live` and `needs-attention` are sync or aggregate states, not live PlatformConnections Status values. `queued`, `in_progress`, `processing`, `complete`, `completed`, `success`, `succeeded`, and failure or expired forms belong to import run or progress presentation.

## Tests

- Updated the founder regression shape so `Status='error'`, aggregate `live`, and a newer completed run must derive to `Needs attention`.
- Added the primary backend shape with `Status='review'`, `SyncState='needs-attention'`, `NeedsReauth=true`, `RecommendedAction='reconnect'`, a newer completed run, and a backend `FailureReason`. It must remain visible and derive to `Needs attention`, never `Synced`.
- Added coverage that a present `FailureReason` is preserved verbatim and a null value produces no row detail.
- Added coverage that `RecommendedAction='reconnect'` independently prevents a healthy presentation.
- Kept the pre-existing defensive `Status='needs_reauth'` regression.
- Locked that a stale active run cannot revive a disconnected row.
- Added list tests proving both inactive and disconnected rows produce no rendered row.
- Added a list and visibility regression proving `review` remains listed for repair while not being usable for work.
- Added a platform registry test proving Slack and Gmail are absent.
- Updated visibility expectations so error rows are repairable in Connections but are not usable for publishing, setup completion, or other work.

The original fix increased the suite from 170 to 173 tests. The contract update increased it again to 178 tests.

## Previous Expo start check

`npm start` loaded the Expo project and both native auth plugins. The environment then reported port 8081 as occupied. Explicit retries on ports 8082 and 19002, including offline mode, reached the same server-bind check and exited before the Metro ready banner. `lsof` showed no listeners on the tested ports, so this is an environment port-probe limitation rather than a repository compile error. No Expo process was left running.

The contract update did not rerun Expo because the updated task explicitly said not to start a dev server.

## Previous gate outputs

### Gate 1: TypeScript

Command:

```sh
node_modules/.bin/tsc --noEmit
```

Output (verbatim, empty stdout and stderr):

```text

```

Exit code: 0.

### Gate 2: Node tests

Command:

```sh
node --test --experimental-strip-types __tests__/*.test.ts __tests__/*.test.js
```

Output (verbatim):

```text
(node:88825) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/attentionGroups.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ reasonKeyOf falls back to "other" when there is no attention reason (1.703167ms)
✔ groupItems buckets by reason and drops empty buckets (1.791625ms)
✔ groupItems orders by count desc with a stable tiebreak (0.289542ms)
✔ groupItems labels each group from REASON_LABELS (1.111041ms)
✔ itemsForGroup returns exactly one bucket, including "other" (0.12825ms)
✔ groupItems on an empty queue yields no groups (0.062875ms)
(node:88826) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/bestGuesses.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ V7 queue emits a pair for a weak match (4.770625ms)
✔ V7 queue emits which-one for multiple candidates (0.31275ms)
✔ field conflicts and failed commits never enter the V7 question payload (0.129333ms)
✔ badge derivation excludes field conflicts and equals the V7 card item count (14.169416ms)
✔ legacy group and title surfaces never enter the V7 question payload (23.8565ms)
✔ platform product rules keep the incoming field value (0.293042ms)
✔ Anorha product rules keep the catalog field value (0.369292ms)
✔ stock conflicts use inventory source of truth (0.189ms)
✔ legacy platform source of truth is still honored (18.407417ms)
✔ missing sync rules default to keeping yours (0.183417ms)
✔ a conflict without a candidate safely becomes a new item (0.215834ms)
✔ auto-resolved conflicts move from NEEDS A LOOK to LINKED with the standard action (0.200375ms)
✔ three yes answers offer one bulk V7 handoff for the remaining pairs (0.374375ms)
✔ buildMatchAnalyzeProducts includes quickMatchHint only for items with stored quick-scan selections (3.198917ms)
(node:88828) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/candidateIdentity.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ remainingItemCount counts ITEMS, not cards, across grouped and single cards (5.207833ms)
✔ remainingItemCount drops settled items, so answering a 4-item merge card moves 9 to 5 (0.254041ms)
✔ remainingItemCount is 0 for no cards and ignores settled ids it never held (0.108334ms)
✔ mergeCandidateDetails keeps payload fields when hydration returns nulls (1.260459ms)
✔ mergeCandidateDetails prefers hydrated fields when they exist (0.092459ms)
✔ mergeCandidateDetails passes the payload through when there is no hydration row (0.096125ms)
✔ candidateUpdatedLabel drops the year inside the current year, keeps it otherwise (18.089625ms)
✔ candidateUpdatedLabel is empty for missing or unparseable stamps (0.150458ms)
(node:88829) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/catalogPatches.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ merge: rows only on one side pass through (30.711333ms)
✔ merge: newest UpdatedAt wins per key, either direction (0.508417ms)
✔ merge: ties and missing/unparseable stamps go to overlay (direct fetch) (0.199ms)
✔ merge: post-import shape — fresh direct rows beat a stale-but-larger legend mirror (0.21325ms)
✔ variant patches: merge last over the row, newest-wins (0.29ms)
✔ variant patches: a stale patch never overrides a fresher server row (0.675667ms)
✔ variant patches: unknown row ids are ignored; Products projection deep-merges (0.154333ms)
✔ variant patches: array-form Products projection is normalized before merge (0.12625ms)
✔ level patches: id patch hits its row directly (0.198ms)
✔ level patches: match patch resolves by variant + connection + location (0.184917ms)
✔ level patches: null location in match means the default/unset location (0.105416ms)
✔ level patches: stale patch loses to a fresher level row (0.077667ms)
✔ store: applyVariantPatch coalesces per id, stamps UpdatedAt, notifies, drains (0.227042ms)
✔ store: applyLevelPatch requires an id or a match, and drain clears levels (0.094208ms)
✔ store: drain only removes patches at or before the cutoff (0.085375ms)
✔ store: unsubscribed listeners stop firing; stale marks carry their reason (0.1145ms)
(node:88830) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/connectionImportPresentation.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ latest import is selected by time even when the payload is unsorted (23.195334ms)
✔ an error connection stays unhealthy despite a newer completed import (8.180791ms)
✔ a needs_reauth connection stays unhealthy despite a newer completed import (0.153041ms)
✔ a failure after a success remains the latest visible outcome (0.122875ms)
✔ a current aggregate scan wins over a historical completed import (0.084083ms)
✔ an active run cannot revive a disconnected connection (0.065708ms)
✔ a raw pending first-import status is importing before the run map arrives (0.099292ms)
(node:88831) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/csvImport.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ parseCsv: simple headers and rows (1.845125ms)
✔ parseCsv: quoted field containing a comma (0.124167ms)
✔ parseCsv: embedded newline inside a quoted field (0.070417ms)
✔ parseCsv: escaped double quotes ("") become a literal quote (0.066167ms)
✔ parseCsv: CRLF line endings (0.075083ms)
✔ parseCsv: strips a leading UTF-8 BOM from the first header (0.300833ms)
✔ parseCsv: preserves trailing empty fields (0.1045ms)
✔ parseCsv: skips fully-empty lines (0.070958ms)
✔ parseCsv: lone CR (old-Mac) line endings (0.08075ms)
✔ parseCsv: empty input yields empty headers and rows (0.161791ms)
✔ parseCsv: throws a descriptive error past the row cap (90.183875ms)
✔ csvRowsToObjects: zips rows against headers (0.152208ms)
✔ csvRowsToObjects: pads short (ragged) rows with empty strings (0.52675ms)
✔ csvRowsToObjects: ignores cells beyond the header count (0.1125ms)
✔ parseCsv: a mid-field inch-mark quote stays literal and preserves structure (0.11225ms)
✔ parseCsv: stray characters after a closed quote append literally (0.061ms)
✔ parseCsv + csvRowsToObjects: end-to-end on a quoted/CRLF file (0.474ms)
(node:88832) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/importFrontDoor.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ front door rows account for every item in the Square receipt (1.728417ms)
✔ zero skipped and needs-look buckets stay hidden (0.097167ms)
✔ zero questions produces Done with no Later action (0.0915ms)
✔ owed questions keep the questions and Later actions (0.060125ms)
(node:88833) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/importStatus.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ resolution fan-out skips connections whose server attention count is zero (9.441834ms)
✔ one failed resolution uses only that connection server count (0.304ms)
(node:88834) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/inventorySync.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ mergeInventoryLevelsByNewest selects the newest version of each row (1.839334ms)
✔ mergeInventoryLevelsByNewest deterministically prefers Legend when timestamps tie or cannot be parsed (3.006375ms)
✔ stripInventoryFromPlatformData keeps mixed product edits while removing generic inventory writes (1.4175ms)
✔ buildInventoryQuantityUpdate resolves base inventory to the canonical variant and raw location (0.130125ms)
✔ buildInventoryQuantityUpdate resolves an all-tab option key to the stored variant ID (108.151125ms)
✔ buildInventoryQuantityUpdate refuses a target without a real connection (0.099125ms)
✔ buildInventoryQuantityUpdate refuses an editor-only location id (0.076ms)
(node:88835) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/inventorySyncPolicy.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ all five inventory collections have bounded request sizes (3.4995ms)
✔ variant list projection excludes Description but retains title and tags (0.170458ms)
✔ paged collection assigns full pages then replaces with the completed cycle (0.247584ms)
✔ legacy undefined-key cache is repaired from the row Id (0.108208ms)
✔ UTF-8 payload measurement counts multibyte text (0.108458ms)
(node:88836) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/liquidationConversationState.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ first send from home creates queued user message and pending turn (34.070417ms)
✔ queued sends during streaming keep both pending turns in order (2.460667ms)
✔ retryFailedTurn re-queues a failed message (0.447917ms)
✔ retryFailedTurn keeps uploaded photos on the retried turn (0.193208ms)
✔ mergeRemoteMessages keeps unsent local messages while hydrating remote history (1.958208ms)
✔ mergeRemoteMessages keeps client-authored assistant summaries (3.002958ms)
✔ acknowledgeMessage reconciles optimistic user bubble with server id (0.313583ms)
(node:88837) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/platformConnectionList.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ selling-platform list filters csv and disconnected rows but keeps repairable rows (3.868958ms)
✔ a stale active run cannot put a disconnected row back in the list (0.756584ms)
✔ inactive and disconnected connections both produce no rendered row (0.112833ms)
✔ the platform registry excludes Slack and Gmail (0.073666ms)
(node:88838) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/platformConnectionVisibility.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ active enabled connection is visible (3.058ms)
✔ soft-disconnected connection (IsEnabled=false + inactive) is NOT visible (0.251208ms)
✔ inactive status alone hides the connection even when IsEnabled is true (0.090458ms)
✔ IsEnabled=false alone hides the connection regardless of status (0.133625ms)
✔ error connection is not usable for work (0.074291ms)
✔ mid-import statuses are visible (0.120333ms)
✔ status matching is case- and whitespace-insensitive (0.068875ms)
✔ missing fields default to visible (a bare row is not assumed dead) (0.07325ms)
✔ soft-disconnected rows are not listed (0.088208ms)
✔ active, error, and scanning rows are listed (0.137833ms)
✔ a hypothetical deleted status is never listed (tripwire) (0.069917ms)
✔ disconnected detection: either disabled flag or dead status counts (0.073167ms)
✔ every in-flight import status keeps the poll alive (0.080083ms)
✔ settled statuses do not keep the poll alive (0.059917ms)
(node:88839) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/platformConnectionsCache.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ connection cache hydrates only for its Clerk owner (2.638333ms)
✔ connection cache storage is partitioned by owner (0.11225ms)
✔ connection cache rejects malformed payloads (0.087375ms)
(node:88840) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/platformOverrideOutcome.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ 200 with a confirmed push is the only confirmed outcome (8.560708ms)
✔ 202 is pending, and its success:false never reads as not saved (0.13ms)
✔ 502 means the override is stored and only the push failed (0.074208ms)
✔ a non-2xx rejected before the write is not saved (0.071625ms)
✔ only not_saved requires the edit to be retried (0.27225ms)
✔ a pre-Rewrite-3 backend answering 200 with pushed:false is not called confirmed (0.147416ms)
✔ an unparseable body on a 2xx is still confirmed, and on a non-2xx is not saved (0.080375ms)
✔ a non-2xx echoing overrides is stored even without a reason (0.375208ms)
✔ the 502 platform reason wins over its generic message (0.557416ms)
✔ the 202 pending reason comes from error, which is the only text it carries (0.2435ms)
✔ a rejection reports its specific message, not the generic status name (0.325417ms)
✔ an array validation message is joined, and empty text yields null (0.195125ms)
(node:88841) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/poolInventoryFold.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ isIndependentPoolMode: only independent is independent; missing defaults to shared (2.302084ms)
✔ foldPoolQuantities: replicated pools take max (the 3-location x10 pool reads 10, not 30) (0.328583ms)
✔ foldPoolQuantities: independent (split) pools sum (0.19375ms)
✔ foldPoolQuantities: empty and junk inputs (0.280208ms)
✔ buildPoolModeIndex: maps pool id to mode, defaulting to shared (1.173417ms)
✔ sumPooledLevelQuantities: folds per pool by mode, then sums distinct pools (0.135083ms)
✔ sumPooledLevelQuantities: unknown pools default to replicated (max) (0.071958ms)
✔ sumPooledLevelQuantities: pool-less rows sum as singletons (0.07225ms)
✔ sumPooledLevelQuantities: empty input (0.098667ms)
(node:88842) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/pricingResearchCache.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ key is case-insensitive (4.176833ms)
✔ leading whitespace on the title never splits the cache (0.473334ms)
✔ identity fields separate entries: same title, different category or condition (0.184042ms)
✔ missing optional fields key the same as empty ones (0.135ms)
✔ fresh entry is served back (0.204166ms)
✔ miss on unknown key (0.123417ms)
✔ entry exactly at the staleness window is stale (0.111125ms)
✔ stale entry is evicted on read (no zombie hit with an earlier clock) (0.092208ms)
✔ put overwrites: a forced refresh replaces the previous result and its clock (0.155875ms)
✔ custom ttl override is honored (0.141584ms)
(node:88843) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/productBulkActions.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ bulk delete preserves the mobile soft-archive action contract (4.556083ms)
✔ bulk action receipts expose rejected and missing items as failures (0.172792ms)
(node:88845) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/productPatchContract.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ vendored product patch contract has the locked backend shape (2.952916ms)
(node:88847) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/productPatchRouting.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ editor editability is derived from the vendored manifest (2.633583ms)
✔ mobile product patch picker sends only contract fields (2.186208ms)
(node:88848) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/progressiveEnrichment.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ late taxonomy and shipping defaults fill an untouched draft (4.557542ms)
✔ late enrichment never overwrites a locally edited taxonomy group (0.112542ms)
✔ late enrichment never mixes server policy into locally edited shipping (0.086958ms)
✔ only pending enrichment exposes a non-blocking label (0.075666ms)
(node:88849) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/questionQueue.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ group keep-separate payload uses member ids, create, and each current version (3.4575ms)
✔ a conflict stays in the queue with its refreshed version and is not saved (0.458ms)
✔ group count and save notice use the same per-item bulk results (0.229209ms)
✔ already-resolved items are settled and removed from the queue (0.099583ms)
✔ bulk requests are chunked at the 500-item endpoint limit (0.187666ms)
✔ an item with no CAS token is never sent as a fabricated version 0 (0.165125ms)
✔ three yes pair cards offer a handoff for the remaining reason class (0.169166ms)
✔ a no answer resets the yes streak and does not offer a handoff (0.093542ms)
✔ a pair streak never includes field conflicts or other reason classes (0.15025ms)
✔ which-one cards cannot earn the reusable pair handoff (0.150541ms)
✔ three consecutive yes answers are required after any no (0.119875ms)
✔ the V7 offer window stays open past three yes answers (0.095542ms)
(node:88850) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/realtimeRetry.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ realtime retries use capped exponential backoff (4.35675ms)
(node:88851) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/resumableImports.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ unresolved CSV work exposes its pending count and latest import id (2.428084ms)
✔ finished import count includes only rows the reopened queue can show (0.181375ms)
(node:88852) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/toastState.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ a new toast replaces the visible toast without a queue (1.374083ms)
✔ a stale dismiss cannot clear a replacement toast (0.143291ms)
✔ duration is three seconds without an action and five with one (0.087833ms)
✔ titles are constrained to one to four words and reject non-string errors (0.083417ms)
ℹ tests 173
ℹ suites 0
ℹ pass 173
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1908.057125
```

Exit code: 0.

## Contract update gate outputs

### Gate 1: TypeScript

Command:

```sh
node_modules/.bin/tsc --noEmit
```

Output (verbatim, empty stdout and stderr):

```text

```

Exit code: 0.

### Gate 2: Node tests

Command:

```sh
node --test --experimental-strip-types __tests__/*.test.ts __tests__/*.test.js
```

Output (verbatim):

```text
(node:54892) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/attentionGroups.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ reasonKeyOf falls back to "other" when there is no attention reason (0.883834ms)
✔ groupItems buckets by reason and drops empty buckets (0.908208ms)
✔ groupItems orders by count desc with a stable tiebreak (0.103958ms)
✔ groupItems labels each group from REASON_LABELS (0.954333ms)
✔ itemsForGroup returns exactly one bucket, including "other" (0.142583ms)
✔ groupItems on an empty queue yields no groups (0.062459ms)
(node:54893) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/bestGuesses.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ V7 queue emits a pair for a weak match (1.818667ms)
✔ V7 queue emits which-one for multiple candidates (0.098125ms)
✔ field conflicts and failed commits never enter the V7 question payload (0.098917ms)
✔ badge derivation excludes field conflicts and equals the V7 card item count (0.250916ms)
✔ legacy group and title surfaces never enter the V7 question payload (0.182542ms)
✔ platform product rules keep the incoming field value (0.197417ms)
✔ Anorha product rules keep the catalog field value (0.067542ms)
✔ stock conflicts use inventory source of truth (0.088208ms)
✔ legacy platform source of truth is still honored (0.067291ms)
✔ missing sync rules default to keeping yours (0.0975ms)
✔ a conflict without a candidate safely becomes a new item (0.063709ms)
✔ auto-resolved conflicts move from NEEDS A LOOK to LINKED with the standard action (0.135458ms)
✔ three yes answers offer one bulk V7 handoff for the remaining pairs (0.305083ms)
✔ buildMatchAnalyzeProducts includes quickMatchHint only for items with stored quick-scan selections (1.940375ms)
(node:54895) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/candidateIdentity.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ remainingItemCount counts ITEMS, not cards, across grouped and single cards (8.347792ms)
✔ remainingItemCount drops settled items, so answering a 4-item merge card moves 9 to 5 (0.137959ms)
✔ remainingItemCount is 0 for no cards and ignores settled ids it never held (0.085208ms)
✔ mergeCandidateDetails keeps payload fields when hydration returns nulls (0.920292ms)
✔ mergeCandidateDetails prefers hydrated fields when they exist (0.078542ms)
✔ mergeCandidateDetails passes the payload through when there is no hydration row (0.05425ms)
✔ candidateUpdatedLabel drops the year inside the current year, keeps it otherwise (3.294542ms)
✔ candidateUpdatedLabel is empty for missing or unparseable stamps (0.142792ms)
(node:54896) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/catalogPatches.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ merge: rows only on one side pass through (5.718083ms)
✔ merge: newest UpdatedAt wins per key, either direction (0.186875ms)
✔ merge: ties and missing/unparseable stamps go to overlay (direct fetch) (0.135292ms)
✔ merge: post-import shape — fresh direct rows beat a stale-but-larger legend mirror (0.167375ms)
✔ variant patches: merge last over the row, newest-wins (0.192833ms)
✔ variant patches: a stale patch never overrides a fresher server row (0.122459ms)
✔ variant patches: unknown row ids are ignored; Products projection deep-merges (0.115291ms)
✔ variant patches: array-form Products projection is normalized before merge (0.100791ms)
✔ level patches: id patch hits its row directly (0.172792ms)
✔ level patches: match patch resolves by variant + connection + location (0.157625ms)
✔ level patches: null location in match means the default/unset location (0.107959ms)
✔ level patches: stale patch loses to a fresher level row (0.086542ms)
✔ store: applyVariantPatch coalesces per id, stamps UpdatedAt, notifies, drains (0.233375ms)
✔ store: applyLevelPatch requires an id or a match, and drain clears levels (0.103792ms)
✔ store: drain only removes patches at or before the cutoff (0.096291ms)
✔ store: unsubscribed listeners stop firing; stale marks carry their reason (0.128166ms)
(node:54897) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/connectionImportPresentation.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ latest import is selected by time even when the payload is unsorted (0.915291ms)
✔ an error connection stays unhealthy despite a newer completed import (0.189375ms)
✔ a review connection stays unhealthy despite a newer completed import (0.154084ms)
✔ a null FailureReason adds no row detail (0.0745ms)
✔ a reconnect recommendation is treated as unhealthy (0.072292ms)
✔ a needs_reauth connection stays unhealthy despite a newer completed import (0.058334ms)
✔ a failure after a success remains the latest visible outcome (0.080583ms)
✔ a current aggregate scan wins over a historical completed import (0.059542ms)
✔ an active run cannot revive a disconnected connection (0.087875ms)
✔ a raw pending first-import status is importing before the run map arrives (0.132875ms)
(node:54898) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/csvImport.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ parseCsv: simple headers and rows (1.760667ms)
✔ parseCsv: quoted field containing a comma (0.107708ms)
✔ parseCsv: embedded newline inside a quoted field (0.066666ms)
✔ parseCsv: escaped double quotes ("") become a literal quote (0.061916ms)
✔ parseCsv: CRLF line endings (0.068ms)
✔ parseCsv: strips a leading UTF-8 BOM from the first header (0.060125ms)
✔ parseCsv: preserves trailing empty fields (0.068375ms)
✔ parseCsv: skips fully-empty lines (0.061ms)
✔ parseCsv: lone CR (old-Mac) line endings (0.089792ms)
✔ parseCsv: empty input yields empty headers and rows (0.132458ms)
✔ parseCsv: throws a descriptive error past the row cap (18.601792ms)
✔ csvRowsToObjects: zips rows against headers (0.136334ms)
✔ csvRowsToObjects: pads short (ragged) rows with empty strings (0.059167ms)
✔ csvRowsToObjects: ignores cells beyond the header count (0.046375ms)
✔ parseCsv: a mid-field inch-mark quote stays literal and preserves structure (0.080166ms)
✔ parseCsv: stray characters after a closed quote append literally (0.054ms)
✔ parseCsv + csvRowsToObjects: end-to-end on a quoted/CRLF file (0.075459ms)
(node:54899) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/importFrontDoor.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ front door rows account for every item in the Square receipt (1.583458ms)
✔ zero skipped and needs-look buckets stay hidden (0.086584ms)
✔ zero questions produces Done with no Later action (0.08875ms)
✔ owed questions keep the questions and Later actions (0.0585ms)
(node:54900) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/importStatus.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ resolution fan-out skips connections whose server attention count is zero (1.982583ms)
✔ one failed resolution uses only that connection server count (0.250958ms)
(node:54901) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/inventorySync.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ mergeInventoryLevelsByNewest selects the newest version of each row (0.912041ms)
✔ mergeInventoryLevelsByNewest deterministically prefers Legend when timestamps tie or cannot be parsed (0.091667ms)
✔ stripInventoryFromPlatformData keeps mixed product edits while removing generic inventory writes (1.617459ms)
✔ buildInventoryQuantityUpdate resolves base inventory to the canonical variant and raw location (0.108916ms)
✔ buildInventoryQuantityUpdate resolves an all-tab option key to the stored variant ID (8.438083ms)
✔ buildInventoryQuantityUpdate refuses a target without a real connection (0.067625ms)
✔ buildInventoryQuantityUpdate refuses an editor-only location id (0.05425ms)
(node:54902) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/inventorySyncPolicy.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ all five inventory collections have bounded request sizes (1.539125ms)
✔ variant list projection excludes Description but retains title and tags (0.121667ms)
✔ paged collection assigns full pages then replaces with the completed cycle (0.241625ms)
✔ legacy undefined-key cache is repaired from the row Id (0.090708ms)
✔ UTF-8 payload measurement counts multibyte text (0.097458ms)
(node:54903) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/liquidationConversationState.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ first send from home creates queued user message and pending turn (2.361375ms)
✔ queued sends during streaming keep both pending turns in order (1.918542ms)
✔ retryFailedTurn re-queues a failed message (0.22475ms)
✔ retryFailedTurn keeps uploaded photos on the retried turn (0.121334ms)
✔ mergeRemoteMessages keeps unsent local messages while hydrating remote history (0.193541ms)
✔ mergeRemoteMessages keeps client-authored assistant summaries (0.077166ms)
✔ acknowledgeMessage reconciles optimistic user bubble with server id (0.113291ms)
(node:54904) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/platformConnectionList.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ selling-platform list filters csv and disconnected rows but keeps repairable rows (1.645292ms)
✔ review connections stay visible for repair (0.099083ms)
✔ a stale active run cannot put a disconnected row back in the list (0.319875ms)
✔ inactive and disconnected connections both produce no rendered row (0.086625ms)
✔ the platform registry excludes Slack and Gmail (0.061875ms)
(node:54905) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/platformConnectionVisibility.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ active enabled connection is visible (1.773584ms)
✔ soft-disconnected connection (IsEnabled=false + inactive) is NOT visible (0.070292ms)
✔ inactive status alone hides the connection even when IsEnabled is true (0.058291ms)
✔ IsEnabled=false alone hides the connection regardless of status (0.061333ms)
✔ error connection is not usable for work (0.055875ms)
✔ review connection is repairable, not usable (0.075458ms)
✔ mid-import statuses are visible (0.087458ms)
✔ status matching is case- and whitespace-insensitive (0.048ms)
✔ missing fields default to visible (a bare row is not assumed dead) (0.059458ms)
✔ soft-disconnected rows are not listed (0.096292ms)
✔ active, review, error, and scanning rows are listed (0.068458ms)
✔ a hypothetical deleted status is never listed (tripwire) (0.046917ms)
✔ disconnected detection: either disabled flag or dead status counts (0.064041ms)
✔ every in-flight import status keeps the poll alive (0.054792ms)
✔ settled statuses do not keep the poll alive (0.047833ms)
(node:54906) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/platformConnectionsCache.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ connection cache hydrates only for its Clerk owner (1.675458ms)
✔ connection cache storage is partitioned by owner (0.091ms)
✔ connection cache rejects malformed payloads (0.077042ms)
(node:54907) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/platformOverrideOutcome.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ 200 with a confirmed push is the only confirmed outcome (0.937333ms)
✔ 202 is pending, and its success:false never reads as not saved (0.934834ms)
✔ 502 means the override is stored and only the push failed (0.068709ms)
✔ a non-2xx rejected before the write is not saved (0.054833ms)
✔ only not_saved requires the edit to be retried (0.081583ms)
✔ a pre-Rewrite-3 backend answering 200 with pushed:false is not called confirmed (0.059334ms)
✔ an unparseable body on a 2xx is still confirmed, and on a non-2xx is not saved (0.049375ms)
✔ a non-2xx echoing overrides is stored even without a reason (0.061166ms)
✔ the 502 platform reason wins over its generic message (0.119625ms)
✔ the 202 pending reason comes from error, which is the only text it carries (0.170041ms)
✔ a rejection reports its specific message, not the generic status name (0.111667ms)
✔ an array validation message is joined, and empty text yields null (0.077334ms)
(node:54908) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/poolInventoryFold.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ isIndependentPoolMode: only independent is independent; missing defaults to shared (0.878958ms)
✔ foldPoolQuantities: replicated pools take max (the 3-location x10 pool reads 10, not 30) (0.992375ms)
✔ foldPoolQuantities: independent (split) pools sum (0.075167ms)
✔ foldPoolQuantities: empty and junk inputs (0.05525ms)
✔ buildPoolModeIndex: maps pool id to mode, defaulting to shared (6.345083ms)
✔ sumPooledLevelQuantities: folds per pool by mode, then sums distinct pools (0.131417ms)
✔ sumPooledLevelQuantities: unknown pools default to replicated (max) (0.068417ms)
✔ sumPooledLevelQuantities: pool-less rows sum as singletons (0.058958ms)
✔ sumPooledLevelQuantities: empty input (0.080875ms)
(node:54909) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/pricingResearchCache.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ key is case-insensitive (0.978417ms)
✔ leading whitespace on the title never splits the cache (1.054167ms)
✔ identity fields separate entries: same title, different category or condition (0.113375ms)
✔ missing optional fields key the same as empty ones (0.085167ms)
✔ fresh entry is served back (0.16325ms)
✔ miss on unknown key (0.108083ms)
✔ entry exactly at the staleness window is stale (0.08725ms)
✔ stale entry is evicted on read (no zombie hit with an earlier clock) (0.078708ms)
✔ put overwrites: a forced refresh replaces the previous result and its clock (0.091ms)
✔ custom ttl override is honored (0.115333ms)
(node:54910) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/productBulkActions.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ bulk delete preserves the mobile soft-archive action contract (1.514208ms)
✔ bulk action receipts expose rejected and missing items as failures (0.134542ms)
(node:54911) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/productPatchContract.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ vendored product patch contract has the locked backend shape (1.534333ms)
(node:54912) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/productPatchRouting.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ editor editability is derived from the vendored manifest (5.550375ms)
✔ mobile product patch picker sends only contract fields (0.917958ms)
(node:54913) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/progressiveEnrichment.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ late taxonomy and shipping defaults fill an untouched draft (2.708292ms)
✔ late enrichment never overwrites a locally edited taxonomy group (0.098833ms)
✔ late enrichment never mixes server policy into locally edited shipping (0.108625ms)
✔ only pending enrichment exposes a non-blocking label (0.062791ms)
(node:54914) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/questionQueue.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ group keep-separate payload uses member ids, create, and each current version (1.718416ms)
✔ a conflict stays in the queue with its refreshed version and is not saved (0.206667ms)
✔ group count and save notice use the same per-item bulk results (0.145ms)
✔ already-resolved items are settled and removed from the queue (0.071208ms)
✔ bulk requests are chunked at the 500-item endpoint limit (0.141875ms)
✔ an item with no CAS token is never sent as a fabricated version 0 (0.126209ms)
✔ three yes pair cards offer a handoff for the remaining reason class (0.138208ms)
✔ a no answer resets the yes streak and does not offer a handoff (0.084083ms)
✔ a pair streak never includes field conflicts or other reason classes (0.257542ms)
✔ which-one cards cannot earn the reusable pair handoff (0.13475ms)
✔ three consecutive yes answers are required after any no (0.102ms)
✔ the V7 offer window stays open past three yes answers (0.082584ms)
(node:54915) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/realtimeRetry.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ realtime retries use capped exponential backoff (1.460792ms)
(node:54916) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/resumableImports.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ unresolved CSV work exposes its pending count and latest import id (1.610042ms)
✔ finished import count includes only rows the reopened queue can show (0.109542ms)
(node:54917) [MODULE_TYPELESS_PACKAGE_JSON] Warning: Module type of file:///Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/__tests__/toastState.test.ts is not specified and it doesn't parse as CommonJS.
Reparsing as ES module because module syntax was detected. This incurs a performance overhead.
To eliminate this warning, add "type": "module" to /Users/dosagie/Documents/CodeProjects/sssync-mobile-connfix/package.json.
(Use `node --trace-warnings ...` to show where the warning was created)
✔ a new toast replaces the visible toast without a queue (0.902458ms)
✔ a stale dismiss cannot clear a replacement toast (0.092042ms)
✔ duration is three seconds without an action and five with one (0.072083ms)
✔ titles are constrained to one to four words and reject non-string errors (0.070083ms)
ℹ tests 178
ℹ suites 0
ℹ pass 178
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 590.082667
```

Exit code: 0.

# Import Hub redesign — "treat imports like email"

Status: implementation spec for branch `claude/honora-import-ux-z7bkcn`.

## Problem

The inner stages of importing are good (the `MatchReviewDeck` card-swipe resolver, the
optimizer conveyor). The **wrapper** around them is confusing:

- 8+ entry points (`Connections`, `Settings`, `ProfileScreen`, `ConnectedPlatformItem`,
  `SyncRules`, `CSVColumnMapping`, …) all `navigate('SyncInbox')` — a "manage" tap, a
  "review" tap, a "ready" tap and a CSV finish all dump the user into the same swipe deck
  with no context about whether they're starting, resuming, or done.
- The deck's only exit is `navigation.goBack()` — **no success screen**, no counts, no
  "what next". (`SyncInboxScreen.tsx` `onDone`)
- The optimize stage (`BackfillOptimizerScreen`) is **orphaned** — its only production
  entry is commented out in `ProfileScreen`. The import variant of
  `PublishConfirmationScreen` (`origin: 'import'`) is therefore unreachable.
- Re-entry bounce-back: whenever the server still has `needsAttention` items (including
  after a re-scan/reconcile flips the connection `Status` to `'review'`), any tap on the
  connection re-opens the deck. There is no "inbox you visit on your own time".
- CSV import lives behind Profile → "Import Inventory", parses CSV naively
  (`split('\n')`/`split(',')`), and `CSVColumnMappingScreen` uses a third visual language.
- Dead state machinery confuses everything: `useImportSession` (tombstone),
  `useImportProgress` + `ImportProgressBanner` (inert — nothing writes its storage key),
  `ProcessResumptionModal`/`ProcessPersistence` (unmounted), `OnboardConnectionScreen`
  ("Coming soon" stub).

The backend already implements the email model we want (SYNC_REBUILD): auto-pilot commits
everything certain; ambiguous rows park in a per-connection inbox
(`GET /sync/connections/:id/resolution` → buckets + `summary.byReason`); settled items
never re-surface on re-scan (`SETTLED_STATES` unless `SourceHash` changes). The app never
built the wrapper for it.

## North star (modeled on the Avec email-backlog flow)

1. **One place: the Import Inbox** (`ImportHub` route). Like an email inbox: it shows a
   total ("**N items need you**"), grouped lanes, and in-flight import progress. You visit
   it when you want; nothing drags you into it.
2. **Guided pass**: `Continue` walks the non-empty lanes in order —
   **Matches** (swipe deck) → **Photos** (optimizer camera) → **Details** (optimizer
   review conveyor). Each lane uses the existing, loved component.
3. **A real ending**: finishing the deck lands on a summary beat (import variant of
   `PublishConfirmationScreen`) — "X linked · Y added · Z ignored", with `Continue`
   pointing at the next non-empty lane, or "All caught up".
4. **Email semantics**:
   - Completing the flow means you're done. Coming back later NEVER re-opens a stage
     automatically.
   - New/leftover items from re-scans just show up as counts in the hub (passive pill),
     never as forced navigation. `Status === 'review'` renders as a count, not a redirect.
   - Tapping a connected account goes to **management** (`SyncRules`, revived), which
     shows a passive "N need you → Inbox" row.
5. **One design language**: `ResolveKit` `RC` tokens + `LobbyKit` rows for the hub, the
   restyled CSV mapping screen, the SyncInbox chrome, and the summary — same system the
   deck + optimizer already use.

## Screen map (target)

```text
ConnectionsScreen ──"Import inbox (N)"──▶ ImportHub ◀── Settings badge / CSV finish / post-connect
       │ tap row                              │
       ▼                                      │ Continue / lane tap
SyncRules (manage: direction, autosync,       ├─▶ SyncInbox(connectionId)  — matches deck
  "N need you → Inbox" row, disconnect)       │        └─ deck done ─▶ PublishConfirmation(origin:'import', counts, next lane)
                                              ├─▶ BackfillOptimizer(mode:'photos'|'details', connectionId?)
                                              └─▶ (failed lane) SyncInbox retry cards (commit_failed re-enter attention)
```

## Data: `useImportHub()` (client-side aggregate, v1)

No new backend endpoint in v1. Fan out over existing prod endpoints:

- Connections list from `PlatformConnectionsContext`.
- Per enabled connection: `GET /api/sync/connections/:id/status` (already implemented
  backend-side in `sync.controller.ts:156`, currently unconsumed) → `{state, counts:{total,
  autoLinked, autoCreated, needsAttention}}`. Fall back to `GET …/resolution` summary if
  `/status` errors.
- Optimizer counts: `useOptimizerQueues` counts (`photoNeeded`, `dataNeeded`,
  `manualQueue`).
- Shape:

```ts
type ImportHubData = {
  loading: boolean; error: string | null; refresh(): void;
  totalNeedsYou: number;               // matches + photos + details
  scanning: Array<{ connectionId, platformName, state: 'scanning'|'syncing' }>;
  lanes: {
    matches: { count: number; byConnection: Array<{ connectionId, platformName, count }> };
    photos:  { count: number };
    details: { count: number };
  };
};
```

Poll every ~20s while the screen is focused AND at least one connection is
`scanning`/`syncing`; otherwise fetch on focus only. Follow-up (separate PR, backend):
`GET /sync/inbox/summary` aggregate to replace the fan-out.

## Behavior changes (the bounce-back kill list)

| Today | Target |
|---|---|
| Connection tap → `SyncInbox` deck | Connection tap → `SyncRules` (manage). Deck reachable only via hub lanes / "N need you" rows. |
| `Status==='review'` renders "Review" CTA → deck | Renders passive count pill; primary action stays "Manage". |
| Deck `onDone` → `goBack()` | → `PublishConfirmation(origin:'import')` with session counts + next-lane `Continue` → hub. |
| Optimize orphaned | Entered from hub lanes and from the import summary's `Continue`. |
| CSV finish → `SyncInbox` | → `ImportHub` (shows progress → "N need you — Continue"). |
| `ProfileScreen.startPlatformScan` navigates to `SyncInbox` *then* fires scan | Fires scan, navigates to `ImportHub`. |
| Post-onboarding connect shows optimistic spinner then Home | Unchanged landing (Home), hub reachable from Connections; no auto-redirect. |

## Non-goals (explicitly out of scope for this branch)

- Optimizer internals (`OptimizerBatchGenerateView`'s mocked generation, add-product
  "generate details" improvements) — separate effort.
- Camera/System-B flow (`AddProductScreen`, `MatchPreview`, `GenerateDetailsScreen`).
- Backend changes (aggregate endpoint, `Status` state machine) — follow-up PR.
- SproutHome briefing integration.

## Cleanup list (verify zero usages before each delete)

`useImportSession.ts`, `useImportProgress.ts`, `ImportProgressBanner.tsx` (+ its mount in
`AppNavigator.tsx`), `ProcessPersistence.ts`, `useProcessState.ts`,
`ProcessResumptionModal.tsx` (+ `ProcessPersistence.initialize()` call in
`EnhancedSessionProvider`), `activeFlowPersistence.ts` (⚠️ verify — one audit says App.tsx
uses it for generate-job resume; if used, keep), `OnboardConnectionScreen` (route + screen
+ param types), stale `LoadingScreen`/`MatchSelectionScreen` param types, dead styles in
`BackfillOptimizerScreen`. Palette: `#8cc63f` → brand `#93C822` in `Button.tsx`,
`OptimizerBatchGenerateView` local palette → `RC`; `SyncInboxScreen` fallback header → `RC`.

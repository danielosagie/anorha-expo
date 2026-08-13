# Product write boundary mobile slice

## What changed

- Generate submissions now use the shared typed contract. Each product carries `itemIdentity`, `pricingSnapshot`, typed `photos`, and `platforms`. The visible seller-confirmed candidate price is copied into the pricing snapshot, including `recommended`, and the identity snapshot key matches `itemIdentity.canonicalKey`.
- Cart draft persistence now retains `generateJobId`, `generateMatchJobId`, `productId`, and `variantId`. `generateResult` remains an in-memory cache. Hydration recovers match and generate jobs from their durable status endpoints and reloads the canonical product from `GET /api/products/:variantId`.
- Generate Details receives canonical IDs from the cart, reloads canonical products, and shows a recovery state while a durable job is being restored instead of the previous `No results` dead end.
- Successful PUT and publish flows now require `response.item` and replace canonical client fields from it. Submitted request objects are not used as success fallbacks. Presence-based field selection preserves explicit server `null` values.
- Product Detail now reads the canonical product endpoint and no longer performs the duplicate mobile parent/variant nullish projection. Realtime and collaboration changes trigger a canonical reload.
- Inventory bulk archive and delete now call `POST /api/products/bulk-actions/execute`. The client sends `{ actions: [{ itemId, actionType, changes: [] }] }`, validates every result, and reconciles each returned canonical item.
- Added plain `node:test` receipts for typed generate pricing, cart serialize/hydrate recovery and reviewability, and PUT/publish server reconciliation including explicit `Description: null`.

## Backend response contract relied on

The contract was read from the sibling backend worktree on `feat/canonical-item-boundary`; that repository was not edited.

- `GET /api/products/:variantId` returns the projected canonical item directly.
- `PUT /api/products/:id` returns `UpdateProductResponseDto`, whose canonical product is `response.item`.
- `POST /api/products/publish` returns `{ message, listings?, results, item }`.
- `POST /api/products/bulk-actions/execute` accepts `{ actions: [{ itemId, actionType, changes }] }` and returns `{ status, total, successful, failed, results }`. Each successful result is `{ itemId, success: true, item }`.
- `GET /api/products/generate/jobs/:jobId/status` returns durable generate status and result identifiers used to recover `productId` and `variantId`.

## Gate receipts

`node --test` exited successfully:

```text
✔ PUT success replaces local canonical fields from response.item and preserves explicit null (1.231792ms)
✔ publish success uses response.item and a submitted request is never a success fallback (0.327375ms)
ℹ tests 72
ℹ suites 0
ℹ pass 72
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 649.286542
```

`npm run typecheck` exited with status 2 and only the existing backup-file errors:

```text
> Anorha@1.0.0 typecheck
> tsc --noEmit

_backups/ListingStatusCard_062341Z.tsx(4,32): error TS2307: Cannot find module './UnicodeSpinner' or its corresponding type declarations.
_backups/ListingStatusCard_062341Z.tsx(6,47): error TS2307: Cannot find module './types' or its corresponding type declarations.
_backups/ListingStatusCard_062341Z.tsx(7,40): error TS2307: Cannot find module '../../design/chatGlass' or its corresponding type declarations.
```

The engineering brief anticipated four baseline errors. The actual final compiler output contains the three errors above and no errors in changed files.

`git diff --check` exited successfully with no output. `package.json`, `package-lock.json`, and `patches/` have no changes.

Metro and Expo were not started because the engineering brief explicitly prohibited starting them in this worktree.

## Acceptance notes

- This client now requires the backend boundary branch for mutation responses containing `item` and for the canonical read and bulk action routes.
- Older clients can continue sending the legacy generate shape because the backend adapter still accepts it. This client sends the typed shape only.
- Both bulk `delete` and `archive` action types currently use the backend aggregate archive behavior, matching the reviewed backend controller.
- After restart, recovery makes authenticated status and canonical product requests. If the network is unavailable, durable IDs remain persisted so Generate Details can retry recovery when it opens.

## Left undone

- No backend files or unrelated baseline type errors were changed.
- Commits could not be created because this managed workspace exposes the shared Git metadata as read-only. The commit attempt failed with:

```text
fatal: Unable to create '/Users/dosagie/Documents/CodeProjects/sssync_mobile_test/.git/worktrees/sssync-mobile-product-state/index.lock': Operation not permitted
```

All implementation changes and this receipt file remain present in the worktree for committing from a session with writable Git metadata.

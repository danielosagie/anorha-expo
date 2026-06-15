# Match & Optimize v2 — case coverage

Every case from the `Match & Optimize v2` coverage table (the Anorha handoff
`mo-v2-page.jsx`) mapped to the resolver that handles it and its current status.

- **LIVE** — fires today on signals the system already produces.
- **READY** — the resolver UI + classifier route exist; activation waits on a
  backend signal / feature (named in "needs").

Resolvers: `src/components/resolve/{matchResolvers,optimizeResolvers}.tsx`.
Routing: `src/components/resolve/classifyMatch.ts` + `BackfillOptimizerScreen`.
Backend signals: `sssync-bknd/src/sync-engine/mapping.service.ts`.

## Match — 29 cases

### Identity
| Case | Resolver | Status | Needs |
|---|---|---|---|
| Clean SKU/barcode match | auto-link (no card) | LIVE | — |
| SKU matches, titles differ | Compare | LIVE | fieldConflicts.title |
| Fuzzy / title-only | Find its match | LIVE | — |
| No SKU or barcode | Find its match | LIVE | — |
| **SKU collision** | Same item? (Collision) | **LIVE** | candidateVariants ✅ added |
| Same product, diff SKUs | Compare | LIVE | base-SKU match |

### Cardinality
| Case | Resolver | Status | Needs |
|---|---|---|---|
| 1:1 pair | Compare / auto | LIVE | — |
| 1:0 new everywhere | Find (create) | LIVE | — |
| 0:1 in catalog, not in import | Not in import (Orphan) | LIVE | direction=anorha_to_platform |
| many:1 duplicate rows | Combine (Consolidate) | READY | backend groups dupes instead of downgrading to NONE + **merge-on-confirm** |
| 1:many bundle | Split bundle | READY | `compositionType='bundle'` from adapter bundle parsing |
| many:many | Consolidate + Split | READY | (10 + 11) |

### Variants
| Case | Resolver | Status | Needs |
|---|---|---|---|
| Stray / orphan variants | Stray variants | LIVE | family pass (variant_mismatch / unmatched_variant) |
| Variants on A, flat on B | One side flat | LIVE | family `incomplete_variant_family` |
| Both have sets, values differ | Align variants | LIVE | family `conflicting_variant_family` |
| Different axes | Align variants | LIVE | (same) |
| Platform can't model variants | One side flat | READY | platform-capability flag for the "can't model" nuance |
| Kit on one, pieces on another | Kit ↔ singles | READY | `compositionType='kit'` from adapter |

### Field conflicts
| Case | Resolver | Status | Needs |
|---|---|---|---|
| Title differs | Compare | LIVE | fieldConflicts.title ✅ |
| Price differs | Compare | LIVE | fieldConflicts.price (>20%) ✅ |
| Barcode differs | Compare | LIVE | fieldConflicts.barcode ✅ added |
| Stock / quantity differs | Compare | READY | PlatformProductData needs a stock field from adapters |
| Tags / description differ | Compare | READY | platform tags/description not fetched at match time |
| Photo sets differ | Compare | READY | per-platform photo counts |
| Currency mismatch | Compare | READY | currency field on the price |

### Lifecycle
| Case | Resolver | Status | Needs |
|---|---|---|---|
| Stale — partner renamed/moved | Match broke (Stale) | LIVE | reviewReason=stale_match |
| Stale — partner vanished | Match broke | LIVE | — |
| Re-import same file | auto (idempotent) | PARTIAL | UPSERT dedups; `ignore` not persisted → add a `ResolutionStatus` column |
| Item changed mid-review | Match broke | READY | version/etag re-pull + compare |
| Platform-exclusive (don't link) | Orphan → "keep separate" | LIVE | — |

## Optimize — 25 cases

### Photos
| Case | Resolver | Status | Needs |
|---|---|---|---|
| No photos (0) | Capture (camera) | LIVE | imageCount=0 |
| Too few (<2) | Capture | LIVE | imageCount<min |
| Broken / 404 | Bad photo | READY | broken-image (HEAD/URL) detection |
| Blurry / dark / low-res | Bad photo | READY | image-quality analysis |
| Watermark / stock | Bad photo | READY | image analysis |
| Wrong photo (mis-mapped) | Bad photo + Capture | READY | image analysis |
| Counts differ across platforms | Capture / Bad photo | READY | per-platform photo counts |
| Platform-rejected photo | Bad photo | READY | platform validation feedback |

### Details
| Case | Resolver | Status | Needs |
|---|---|---|---|
| Missing description | Choose how → Review (AI) | LIVE | — |
| Thin description | Choose how → Review | LIVE | — |
| Weak title | Choose how → Review | LIVE | — |
| Junk title | Choose how → Review | LIVE | — |
| Missing category | Review draft (AI) | LIVE | — |
| Missing tags | Review draft | LIVE | — |
| Wrong language | Choose how → Review | READY | locale param on the AI generate call |

### Manual
| Case | Resolver | Status | Needs |
|---|---|---|---|
| Missing SKU | Fill the gaps | LIVE | field wired |
| Missing / zero price | Fill the gaps | LIVE | field wired |
| Missing stock | Fill the gaps | LIVE | field wired |
| Missing barcode | Fill the gaps | LIVE | field wired |
| Missing weight / dimensions | Fill the gaps | READY | add weight/dims fields to the manual case |
| Blank variant attribute | Fill the gaps | READY | add variant-axis fields |
| Compliance / category-required | Fill the gaps | READY | platform-required field schema |

### Flow
| Case | Resolver | Status | Needs |
|---|---|---|---|
| Item with multiple gaps | Lobby routes by bucket | LIVE | — |
| Skip / ship incomplete | "Publish ready now" | LIVE | — |
| Everything filled | Lobby → 100% | LIVE | — |

## Summary

Every one of the 54 cases has a resolver screen and a classifier route.
~36 are **LIVE** today; the ~18 **READY** ones are gated on backend / adapter
features (composition parsing, photo-count + stock + tags enrichment, image
analysis, merge-on-confirm, a `ResolutionStatus` column) — not on the import
UI, which is complete and forward-compatible with each of those signals.

/**
 * Catalog patch bus — the client-side liveness seam for the inventory shelf.
 *
 * Problem it solves: after a save in ProductDetail (or a realtime socket event),
 * the shelf's caches (Legend mirror + direct-fetch state) are stale until the
 * next full refetch, which is gated behind a 20s freshness window. This module
 * carries "what just changed" as small per-row patches that the shelf merges
 * LAST in its activeProductVariants / activeInventoryLevels memos, so an edit
 * shows up on the shelf immediately regardless of any fetch gating.
 *
 * Design:
 * - Module-level store (no React dependency) so ProductDetail, socket handlers,
 *   and App.tsx can all write to it without a provider.
 * - Patches carry an UpdatedAt stamp; application is newest-UpdatedAt-wins, so a
 *   stale patch can never override a fresher server row.
 * - Drain semantics: after a successful FULL refetch the shelf drains patches
 *   created before the fetch started — the server rows now carry the truth.
 * - A separate "stale mark" channel lets app-level events (partnership change,
 *   foreground resume) tell the shelf to bypass its freshness gate.
 */

export type PatchFields = Record<string, unknown> & { UpdatedAt?: string };

export interface VariantPatch {
  id: string;
  fields: PatchFields;
  /** Creation time (ms epoch) — used only for drain bookkeeping. */
  at: number;
}

/** Identifies an InventoryLevels row when the caller doesn't know its Id. */
export interface LevelMatch {
  productVariantId: string;
  platformConnectionId?: string | null;
  /** null means "the default/unset location". Omit to match any location. */
  platformLocationId?: string | null;
}

export interface LevelPatch {
  id: string | null;
  match?: LevelMatch;
  fields: PatchFields;
  at: number;
}

export type CatalogStaleReason =
  | 'partnership'
  | 'inventory'
  | 'product'
  | 'foreground'
  | 'org-switch';

// Tripwire, not a budget: patches drain on every full shelf refetch, so any
// healthy session holds a handful at once. Only a shelf that never refetches
// (i.e. already broken) could grow past this; cap it so the store cannot leak.
const MAX_PATCHES = 500;

const variantPatches = new Map<string, VariantPatch>();
const levelPatches: LevelPatch[] = [];

let version = 0;
const listeners = new Set<() => void>();

function notify() {
  version += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A broken subscriber must not stop the rest from hearing about changes.
    }
  });
}

/** Monotonic version for useSyncExternalStore-style subscriptions. */
export function getCatalogPatchVersion(): number {
  return version;
}

/** Subscribe to patch-store changes. Returns an unsubscribe function. */
export function subscribeCatalogPatches(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Record that a ProductVariants row changed. `fields` should carry an
 * UpdatedAt (server value when available); one is stamped if missing so
 * newest-wins application always has something to compare.
 */
export function applyVariantPatch(id: string, fields: PatchFields): void {
  if (!id) return;
  const stamped: PatchFields = {
    ...fields,
    UpdatedAt: typeof fields.UpdatedAt === 'string' ? fields.UpdatedAt : new Date().toISOString(),
  };
  const existing = variantPatches.get(id);
  variantPatches.set(id, {
    id,
    // Later patch fields win over earlier ones for the same row.
    fields: existing ? { ...existing.fields, ...stamped } : stamped,
    at: Date.now(),
  });
  trimIfNeeded();
  notify();
}

/**
 * Record that an InventoryLevels row changed. Pass the row `id` when known;
 * otherwise pass a `match` describing the row (variant + connection +
 * location) and the shelf will locate it.
 */
export function applyLevelPatch(
  id: string | null,
  fields: PatchFields,
  match?: LevelMatch,
): void {
  if (!id && !match) return;
  const stamped: PatchFields = {
    ...fields,
    UpdatedAt: typeof fields.UpdatedAt === 'string' ? fields.UpdatedAt : new Date().toISOString(),
  };
  levelPatches.push({ id, match, fields: stamped, at: Date.now() });
  trimIfNeeded();
  notify();
}

/** Snapshot accessors (returned collections must not be mutated). */
export function getVariantPatches(): ReadonlyArray<VariantPatch> {
  return Array.from(variantPatches.values());
}

export function getLevelPatches(): ReadonlyArray<LevelPatch> {
  return levelPatches.slice();
}

/**
 * Drop patches created at or before `olderThanMs` (typically the start time of
 * a full refetch that just landed — those rows now carry the truth).
 */
export function drainCatalogPatches(olderThanMs: number): void {
  let changed = false;
  for (const [id, patch] of variantPatches) {
    if (patch.at <= olderThanMs) {
      variantPatches.delete(id);
      changed = true;
    }
  }
  for (let i = levelPatches.length - 1; i >= 0; i -= 1) {
    if (levelPatches[i].at <= olderThanMs) {
      levelPatches.splice(i, 1);
      changed = true;
    }
  }
  if (changed) notify();
}

function trimIfNeeded() {
  // Level patches are an append-only list between drains; cap it hard.
  if (levelPatches.length > MAX_PATCHES) {
    levelPatches.splice(0, levelPatches.length - MAX_PATCHES);
  }
  if (variantPatches.size > MAX_PATCHES) {
    const oldestFirst = Array.from(variantPatches.values()).sort((a, b) => a.at - b.at);
    for (const patch of oldestFirst.slice(0, variantPatches.size - MAX_PATCHES)) {
      variantPatches.delete(patch.id);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure merge helpers (unit-tested; no store access)
// ---------------------------------------------------------------------------

function updatedAtMs(row: unknown): number {
  const value = (row as { UpdatedAt?: unknown } | null | undefined)?.UpdatedAt;
  if (typeof value !== 'string') return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Per-key union of two row maps where, when both sides carry the same key, the
 * row with the NEWEST UpdatedAt wins. Ties (and unparseable stamps, which read
 * as 0) go to `overlay` — for the shelf that is the direct fetch, preserving
 * the post-import behavior the old positional spread protected.
 */
export function mergeNewestByUpdatedAt<T>(
  base: Record<string, T>,
  overlay: Record<string, T>,
): Record<string, T> {
  const merged: Record<string, T> = { ...base };
  for (const key of Object.keys(overlay)) {
    const baseRow = merged[key];
    if (baseRow === undefined || updatedAtMs(overlay[key]) >= updatedAtMs(baseRow)) {
      merged[key] = overlay[key];
    }
  }
  return merged;
}

/**
 * Merge patch fields into a row, deep-merging the `Products` projection
 * (ProductVariants rows embed Products(Title, Description, Tags); a patch
 * carrying only Description must not clobber Title/Tags).
 */
function mergePatchIntoRow<T extends Record<string, any>>(row: T, fields: PatchFields): T {
  const { Products: productsPatch, ...rest } = fields as PatchFields & { Products?: Record<string, unknown> };
  const next: Record<string, any> = { ...row, ...rest };
  if (productsPatch && typeof productsPatch === 'object') {
    const existing = Array.isArray(row.Products) ? row.Products[0] : row.Products;
    next.Products = { ...(existing || {}), ...productsPatch };
  }
  return next as T;
}

/**
 * Apply variant patches on top of a merged variants map. Newest-wins: a patch
 * is skipped when the row already carries a strictly newer UpdatedAt. Patches
 * for unknown row ids are ignored (the row will arrive via refetch).
 */
export function applyVariantPatchesToMap<T extends Record<string, any>>(
  variants: Record<string, T>,
  patches: ReadonlyArray<VariantPatch>,
): Record<string, T> {
  if (patches.length === 0) return variants;
  let out: Record<string, T> | null = null;
  for (const patch of patches) {
    const row = (out || variants)[patch.id];
    if (!row) continue;
    if (updatedAtMs(row) > updatedAtMs(patch.fields)) continue;
    if (!out) out = { ...variants };
    out[patch.id] = mergePatchIntoRow(row, patch.fields);
  }
  return out || variants;
}

function levelMatches(row: Record<string, any>, match: LevelMatch): boolean {
  if (row.ProductVariantId !== match.productVariantId) return false;
  if (match.platformConnectionId !== undefined
    && (row.PlatformConnectionId ?? null) !== (match.platformConnectionId ?? null)) {
    return false;
  }
  if (match.platformLocationId !== undefined
    && (row.PlatformLocationId ?? null) !== (match.platformLocationId ?? null)) {
    return false;
  }
  return true;
}

/**
 * Apply level patches on top of a merged levels map (keyed by level Id).
 * Id patches hit their row directly; match patches locate rows by
 * variant/connection/location. Newest-wins, same as variants.
 */
export function applyLevelPatchesToMap<T extends Record<string, any>>(
  levels: Record<string, T>,
  patches: ReadonlyArray<LevelPatch>,
): Record<string, T> {
  if (patches.length === 0) return levels;
  let out: Record<string, T> | null = null;
  const source = () => out || levels;
  for (const patch of patches) {
    const targetIds: string[] = [];
    if (patch.id && source()[patch.id]) {
      targetIds.push(patch.id);
    } else if (patch.match) {
      for (const [id, row] of Object.entries(source())) {
        if (levelMatches(row, patch.match)) targetIds.push(id);
      }
    }
    for (const id of targetIds) {
      const row = source()[id];
      if (updatedAtMs(row) > updatedAtMs(patch.fields)) continue;
      if (!out) out = { ...levels };
      out[id] = { ...row, ...patch.fields } as T;
    }
  }
  return out || levels;
}

// ---------------------------------------------------------------------------
// Stale marks — "refetch soon, bypass the freshness gate" signals
// ---------------------------------------------------------------------------

type StaleListener = (reason: CatalogStaleReason) => void;
const staleListeners = new Set<StaleListener>();

/**
 * Tell catalog consumers their fetched state may be stale (partnership change,
 * app foregrounded, org switched…). The shelf resets its freshness stamp and,
 * when focused, runs a cheap delta refetch.
 */
export function markCatalogStale(reason: CatalogStaleReason): void {
  staleListeners.forEach((listener) => {
    try {
      listener(reason);
    } catch {
      // Never let one consumer break the others.
    }
  });
}

export function subscribeCatalogStale(listener: StaleListener): () => void {
  staleListeners.add(listener);
  return () => staleListeners.delete(listener);
}

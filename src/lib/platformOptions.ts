/**
 * Per-platform listing overrides.
 *
 * A "platform option override" is a title/description/price that applies to ONE sales
 * channel (connection) only, instead of the canonical Products.* value that fans out to
 * every platform. The screen edits these on a specific platform tab; the canonical
 * autosave (PUT /api/products/:id) is unchanged and still owns main-tab edits.
 *
 * Backend contract (products-platform-options.controller.ts — overrides live in dedicated
 * ConnectionTitle/ConnectionDescription/ConnectionPrice columns on PlatformProductMappings,
 * NOT in PlatformSpecificData):
 *
 *   GET /api/products/:productId/variants/:variantId/platform-options
 *   200: { productId, variantId, platformOptions: Array<{ connectionId, platformType,
 *          displayName, overrides: { title, description, price }, hasOverrides, syncStatus }> }
 *
 *   PUT /api/products/:productId/variants/:variantId/platform-options/:connectionId
 *   Body:   { overrides: { title?, description?, price? } }  — value sets, explicit null
 *           clears, an omitted key is left untouched. The server rejects empty-string text
 *           and non-positive prices, so this module normalizes those to null (= clear)
 *           before sending — an emptied field on a platform tab means "back to main details".
 *   200:    { success, overrides, pushed, syncStatus?, error? }
 *           pushed:false + error means the override SAVED but the live push failed.
 */
import { apiFetch } from './apiClient';

/** The subset of fields a per-platform override can carry. */
export const OVERRIDE_FIELDS = ['title', 'description', 'price'] as const;
export type OverrideField = (typeof OVERRIDE_FIELDS)[number];

/** Override payload. `null` explicitly clears a field back to the canonical value. */
export interface PlatformOverrideValues {
  title?: string | null;
  description?: string | null;
  price?: number | null;
}

/** One connection's stored overrides, as returned by the platform-options GET. */
export interface PlatformOptionEntry {
  connectionId: string;
  platformType: string | null;
  displayName: string | null;
  overrides: { title: string | null; description: string | null; price: number | null };
  hasOverrides: boolean;
  syncStatus: string | null;
}

export interface PlatformOptionsResponse {
  success: boolean;
  overrides?: Record<string, unknown>;
  pushed?: boolean;
  syncStatus?: string;
  error?: string;
}

export interface PlatformOptionsResult {
  ok: boolean;
  status: number;
  data: PlatformOptionsResponse | null;
}

/** Coerce a price input (TextInput string, number, '' , null) to the contract's number|null. */
export function normalizeOverridePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize an override patch to what the PUT endpoint accepts: empty/whitespace text and
 * non-positive prices become explicit null (clear). Only fields present in the input are
 * kept, preserving the "omitted = untouched" semantics.
 */
export function sanitizeOverridePayload(overrides: PlatformOverrideValues): PlatformOverrideValues {
  const out: PlatformOverrideValues = {};
  if ('title' in overrides) {
    const t = overrides.title;
    out.title = t == null || String(t).trim().length === 0 ? null : String(t);
  }
  if ('description' in overrides) {
    const d = overrides.description;
    out.description = d == null || String(d).trim().length === 0 ? null : String(d);
  }
  if ('price' in overrides) {
    const n = normalizeOverridePrice(overrides.price);
    out.price = n !== null && n > 0 ? n : null;
  }
  return out;
}

/** PUT a per-platform override for one connection. Never throws on a non-2xx — the caller
 *  inspects `ok`/`data` (mirrors the calm, non-blocking autosave error handling). */
export async function savePlatformOverride(
  productId: string,
  variantId: string,
  connectionId: string,
  overrides: PlatformOverrideValues,
): Promise<PlatformOptionsResult> {
  const res = await apiFetch(
    `/api/products/${productId}/variants/${variantId}/platform-options/${connectionId}`,
    { method: 'PUT', body: { overrides: sanitizeOverridePayload(overrides) } },
  );
  let data: PlatformOptionsResponse | null = null;
  try {
    data = (await res.json()) as PlatformOptionsResponse;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * Read the stored per-connection overrides for a variant. Never throws — returns null on
 * any failure (404, offline, endpoint not deployed) so callers fall back to session-only
 * override state.
 */
export async function fetchPlatformOverrides(
  productId: string,
  variantId: string,
): Promise<PlatformOptionEntry[] | null> {
  try {
    const res = await apiFetch(
      `/api/products/${productId}/variants/${variantId}/platform-options`,
      { method: 'GET' },
    );
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.platformOptions)) return null;
    return data.platformOptions.filter(
      (e: any) => e && typeof e.connectionId === 'string' && e.connectionId.length > 0,
    ) as PlatformOptionEntry[];
  } catch {
    return null;
  }
}

function sameText(a: unknown, b: unknown): boolean {
  return String(a ?? '') === String(b ?? '');
}

function samePrice(a: unknown, b: unknown): boolean {
  return normalizeOverridePrice(a) === normalizeOverridePrice(b);
}

/**
 * Which of title/description/price changed between two platform snapshots. Returns the
 * changed fields (price normalized to a number|null) or null when nothing relevant moved.
 * Used to route a single-platform-tab edit to the override PUT.
 */
export function diffOverrideFields(prev: any, next: any): PlatformOverrideValues | null {
  if (!next || typeof next !== 'object') return null;
  const out: PlatformOverrideValues = {};
  let changed = false;

  // Only fields actually PRESENT in `next` count. patchField/patchFields spread the whole
  // platform object (every field present) so a real edit compares correctly; a sparse
  // partial write (e.g. a category-only update) leaves title/description/price absent and
  // is therefore never mistaken for a clear.
  if ('title' in next && !sameText(prev?.title, next.title)) {
    out.title = next.title ?? '';
    changed = true;
  }
  if ('description' in next && !sameText(prev?.description, next.description)) {
    out.description = next.description ?? '';
    changed = true;
  }
  if ('price' in next && !samePrice(prev?.price, next.price)) {
    out.price = normalizeOverridePrice(next.price);
    changed = true;
  }

  return changed ? out : null;
}

/** Human labels for the fields, for the "Custom title & price for eBay" microcopy. */
export function overrideFieldLabel(field: OverrideField): string {
  return field === 'title' ? 'title' : field === 'description' ? 'description' : 'price';
}

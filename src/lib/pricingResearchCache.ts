// In-memory cache for network-backed pricing-research surfaces. Publish-flow
// price steps intentionally use persisted scan-time research instead, so opening
// that step never starts a request. This cache remains keyed by the item identity
// that produced live research (title + categoryId + condition), so reopening a
// standalone price sheet paints the previous comps instantly.
//
// Staleness: comps move slowly — a 24h window keeps the app instant for a whole
// listing session while the backend's own 3-day sold-comps cache stays the source
// of truth. A manual refresh bypasses this cache entirely (callers pass force).

export const PRICING_RESEARCH_TTL_MS = 24 * 60 * 60 * 1000;

export interface PricingIdentity {
  title: string;
  categoryId?: string;
  condition?: string;
}

/** Canonical cache key for an item identity (case/whitespace insensitive). */
export const pricingCacheKey = (input: PricingIdentity): string =>
  `${input.title}|${input.categoryId ?? ''}|${input.condition ?? ''}`.trim().toLowerCase();

const store = new Map<string, { data: unknown; ts: number }>();

/** Fresh cached result for the key, or null. Stale entries are evicted on read. */
export function getFreshPricing<T>(
  key: string,
  now: number = Date.now(),
  ttlMs: number = PRICING_RESEARCH_TTL_MS,
): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (now - hit.ts >= ttlMs) {
    store.delete(key);
    return null;
  }
  return hit.data as T;
}

export function putPricing(key: string, data: unknown, now: number = Date.now()): void {
  store.set(key, { data, ts: now });
}

/** Test hook — the store is module-global on purpose (survives remounts). */
export function clearPricingCache(): void {
  store.clear();
}

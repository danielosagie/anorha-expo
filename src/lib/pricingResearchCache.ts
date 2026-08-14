// In-memory pricing-research cache, shared by every price surface (field sheet,
// publish-wizard price step). Keyed by the item identity that deterministically
// produced the research (title + categoryId + condition), so reopening a sheet
// for the same item renders the previous comps instantly instead of clearing to
// a loading state and re-hitting the network.

export const PRICING_RESEARCH_TTL_MS = 24 * 60 * 60 * 1000;

export interface PricingIdentity {
  title: string;
  categoryId?: string;
  condition?: string;
}

export const pricingCacheKey = (input: PricingIdentity): string =>
  `${input.title}|${input.categoryId ?? ''}|${input.condition ?? ''}`.trim().toLowerCase();

const store = new Map<string, { data: unknown; ts: number }>();

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

export function clearPricingCache(): void {
  store.clear();
}

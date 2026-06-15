/**
 * Central registry + builders for persisted keys (AsyncStorage + Legend State
 * persist names).
 *
 * Versions live in ONE place so a schema/shape change is a single edit, and the
 * old versions are knowable (so stale blobs can be reclaimed instead of leaking
 * in AsyncStorage forever). The hand-bumped `_v6` suffixes scattered across the
 * app are what this replaces.
 */

/** Persist-name version per user-scoped Legend State collection. */
export const STORAGE_VERSIONS = {
  productVariants: 6,
  inventoryLevels: 6,
  platformProductMappings: 3,
  productImages: 3,
  marketplaceListings: 3,
} as const;

export type PersistedCollection = keyof typeof STORAGE_VERSIONS;

/**
 * Legend State persist name for a user-scoped collection.
 * e.g. legendPersistKey('productVariants', userId) -> `productVariants_user_<id>_v6`
 */
export function legendPersistKey(collection: PersistedCollection, userId: string): string {
  return `${collection}_user_${userId}_v${STORAGE_VERSIONS[collection]}`;
}

/** Every prior version of a collection's persist key (for cleanup/migration). */
export function legendPersistKeyHistory(collection: PersistedCollection, userId: string): string[] {
  const current = STORAGE_VERSIONS[collection];
  const keys: string[] = [];
  for (let v = 1; v < current; v++) keys.push(`${collection}_user_${userId}_v${v}`);
  return keys;
}

/** Stable, app-scoped (not user-scoped) AsyncStorage keys. */
export const STORAGE_KEYS = {
  entitlementsCache: 'sssync_entitlements_cache_v1',
  orgContextCache: 'sssync_org_context_cache_v1',
  billingGatePending: 'sssync_billing_gate_pending_v1',
} as const;

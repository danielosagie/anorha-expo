export type InventoryLevelWithTimestamp = {
  UpdatedAt?: string | null;
};

const updatedAtMs = (row: InventoryLevelWithTimestamp | undefined): number => {
  if (!row?.UpdatedAt) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(row.UpdatedAt);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

/** Merge two inventory mirrors without allowing an older row to replace a newer one. */
export function mergeInventoryLevelsByNewest<T extends InventoryLevelWithTimestamp>(
  legendRows: Record<string, T>,
  directRows: Record<string, T>,
): Record<string, T> {
  const merged: Record<string, T> = { ...directRows };

  for (const [id, legendRow] of Object.entries(legendRows)) {
    const directRow = directRows[id];
    if (!directRow || updatedAtMs(legendRow) >= updatedAtMs(directRow)) {
      merged[id] = legendRow;
    }
  }

  return merged;
}

/**
 * Remove inventory values from the platform payload used by generic product
 * autosave. Quantities have their own ledger-backed endpoint and must never
 * fall back through the lossy generic product route.
 */
export function stripInventoryFromPlatformData<T extends Record<string, any>>(
  platforms: T,
): T {
  const stripped: Record<string, any> = {};

  for (const [platformKey, platformValue] of Object.entries(platforms || {})) {
    if (!platformValue || typeof platformValue !== 'object') {
      stripped[platformKey] = platformValue;
      continue;
    }

    const platform: Record<string, any> = {};
    for (const [field, value] of Object.entries(platformValue)) {
      if (field === 'locationQuantities') continue;
      if (field === 'variants' && Array.isArray(value)) {
        platform.variants = value.map((variant) => {
          if (!variant || typeof variant !== 'object') return variant;
          return Object.fromEntries(
            Object.entries(variant).filter(([variantField]) => variantField !== 'inventoryByLocation'),
          );
        });
        continue;
      }
      platform[field] = value;
    }
    stripped[platformKey] = platform;
  }

  return stripped as T;
}

export type InventoryEditorLocation = {
  id: string;
  locationId?: string;
  connectionId?: string;
};

export type InventoryEditorVariant = {
  id?: string;
  sku?: string;
  optionValues?: Record<string, unknown>;
};

export type InventoryQuantityUpdate = {
  variantId: string;
  platformConnectionId: string;
  platformLocationId: string;
  quantity: number;
};

const optionKeyForVariant = (variant: InventoryEditorVariant): string => (
  Object.entries(variant.optionValues || {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join('/')
  || variant.sku
  || 'default'
);

/** Resolve editor-only IDs into the IDs required by the inventory endpoint. */
export function buildInventoryQuantityUpdate({
  editorVariantId,
  canonicalVariantId,
  activeTab,
  platformVariants,
  location,
  quantity,
}: {
  editorVariantId: string;
  canonicalVariantId?: string;
  activeTab: string;
  platformVariants: InventoryEditorVariant[];
  location?: InventoryEditorLocation;
  quantity: number;
}): InventoryQuantityUpdate | null {
  const platformConnectionId = location?.connectionId?.trim();
  // `id` may be an editor-only composite/virtual key. Only the explicitly
  // threaded platform location ID is legal for the backend inventory route.
  const platformLocationId = location?.locationId?.trim();
  if (!platformConnectionId || !platformLocationId || !Number.isFinite(quantity)) return null;

  let variantId = editorVariantId === '_base' ? canonicalVariantId : undefined;
  if (!variantId) {
    const matchedVariant = platformVariants.find((variant) => (
      variant.id === editorVariantId
      || (activeTab === 'all' && optionKeyForVariant(variant) === editorVariantId)
    ));
    variantId = matchedVariant?.id;
  }

  if (!variantId) return null;
  return {
    variantId,
    platformConnectionId,
    platformLocationId,
    quantity,
  };
}

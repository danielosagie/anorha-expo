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
  const platformLocationId = (location?.locationId || location?.id)?.trim();
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

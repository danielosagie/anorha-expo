export type CanonicalServerItem = Record<string, any>;

const CANONICAL_EDITOR_FIELDS: Array<[server: string, editor: string]> = [
  ['Title', 'title'],
  ['Description', 'description'],
  ['Price', 'price'],
  ['CompareAtPrice', 'compareAtPrice'],
  ['Sku', 'sku'],
  ['Barcode', 'barcode'],
  ['Weight', 'weight'],
  ['WeightUnit', 'weightUnit'],
  ['RequiresShipping', 'requiresShipping'],
  ['IsTaxable', 'isTaxable'],
  ['TaxCode', 'taxCode'],
  ['Tags', 'tags'],
  ['Vendor', 'vendor'],
  ['ProductType', 'productType'],
];

export function requireServerItem(response: unknown): CanonicalServerItem {
  const item = response && typeof response === 'object'
    ? (response as Record<string, unknown>).item
    : undefined;
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new Error('Successful product mutation response is missing item');
  }
  return item as CanonicalServerItem;
}

export function replaceCanonicalFields<T extends Record<string, any>>(
  current: T,
  serverItem: CanonicalServerItem,
): T {
  return { ...current, ...serverItem };
}

export function reconcileMutationSuccess<T extends Record<string, any>>(
  current: T,
  response: unknown,
): T {
  return replaceCanonicalFields(current, requireServerItem(response));
}

export function canonicalEditorPatch(serverItem: CanonicalServerItem): Record<string, any> {
  return Object.fromEntries(CANONICAL_EDITOR_FIELDS.flatMap(([serverField, editorField]) => (
    Object.prototype.hasOwnProperty.call(serverItem, serverField)
      ? [[editorField, serverItem[serverField]]]
      : []
  )));
}

export function reconcileCanonicalEditorPlatform(
  platforms: Record<string, any>,
  serverItem: CanonicalServerItem,
): Record<string, any> {
  const keys = Object.keys(platforms || {});
  const canonicalKey = keys.includes('shopify') ? 'shopify' : keys[0] || 'canonical';
  return {
    ...platforms,
    [canonicalKey]: {
      ...(platforms?.[canonicalKey] || {}),
      ...canonicalEditorPatch(serverItem),
    },
  };
}

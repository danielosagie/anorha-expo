export type InventoryPriceValue = number | string | null | undefined;

function normalizedPrice(value: InventoryPriceValue): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatProductDetailPrice(value: InventoryPriceValue): string {
  const price = normalizedPrice(value);
  return price == null ? '—' : `$${price.toFixed(2)}`;
}

export function formatInventoryListPrice({
  price,
  minPrice,
  maxPrice,
}: {
  price?: InventoryPriceValue;
  minPrice?: InventoryPriceValue;
  maxPrice?: InventoryPriceValue;
}): string {
  const min = normalizedPrice(minPrice);
  const max = normalizedPrice(maxPrice);

  if (min != null && max != null && min !== max) {
    return `$${min.toFixed(2)} - $${max.toFixed(2)}`;
  }
  if (min != null) return `$${min.toFixed(2)}`;
  if (max != null) return `$${max.toFixed(2)}`;
  return formatProductDetailPrice(price);
}

export const COLLECTION_PAGE_SIZES = {
  ProductVariants: 250,
  PlatformProductMappings: 500,
  ProductImages: 500,
  InventoryLevels: 500,
  MarketplaceListings: 250,
} as const;

export const PRODUCT_VARIANT_LIST_SELECT = 'Id, ProductId, UserId, Sku, Barcode, Title, Price, CompareAtPrice, Options, status, OnShopify, OnSquare, OnClover, OnAmazon, OnEbay, OnFacebook, VariantType, IsArchived, PrimaryImageUrl, CreatedAt, UpdatedAt, Products(Title, Tags)';

export type BoundedCollectionName = keyof typeof COLLECTION_PAGE_SIZES;

export type CollectionSyncProgress = {
  pageSize: number;
  loadedRows: number;
  phase: 'idle' | 'initial' | 'background' | 'complete' | 'error';
};

export type AcceptedCollectionPage<T> = {
  hasMore: boolean;
  loadedRows: number;
  mode: 'assign' | 'set';
  rows: T[];
};

/**
 * Keeps each remote request bounded while letting Legend paint page one and
 * merge later pages. The final page returns the complete cycle with mode=set,
 * which also removes rows that disappeared remotely while the app was away.
 */
export function createCollectionPageAccumulator<T extends Record<string, any>>(
  pageSize: number,
  fieldId: keyof T & string = 'Id' as keyof T & string,
) {
  let nextOffset = 0;
  let cycleActive = false;
  const rowsById = new Map<string, T>();

  const reset = () => {
    nextOffset = 0;
    cycleActive = false;
    rowsById.clear();
  };

  const beginPage = () => {
    if (!cycleActive) {
      rowsById.clear();
      nextOffset = 0;
      cycleActive = true;
    }
    return { offset: nextOffset };
  };

  const acceptPage = (offset: number, rows: T[]): AcceptedCollectionPage<T> => {
    if (offset !== nextOffset) {
      throw new Error(`Out-of-order collection page: expected ${nextOffset}, received ${offset}`);
    }

    for (const row of rows) {
      const id = row?.[fieldId];
      if (id != null) rowsById.set(String(id), row);
    }

    nextOffset += rows.length;
    const hasMore = rows.length === pageSize;
    if (hasMore) {
      return {
        hasMore: true,
        loadedRows: rowsById.size,
        mode: 'assign',
        rows,
      };
    }

    cycleActive = false;
    return {
      hasMore: false,
      loadedRows: rowsById.size,
      mode: 'set',
      rows: Array.from(rowsById.values()),
    };
  };

  return { acceptPage, beginPage, reset };
}

/** Repairs caches written before Legend was told that the primary key is `Id`. */
export function normalizePersistedCollection<T extends { Id?: string }>(
  value: Record<string, T> | null | undefined,
): Record<string, T> {
  if (!value || typeof value !== 'object') return {};

  const normalized: Record<string, T> = {};
  for (const [storedKey, row] of Object.entries(value)) {
    if (!row || typeof row !== 'object') continue;
    const key = row.Id || (storedKey !== 'undefined' ? storedKey : '');
    if (key) normalized[key] = row;
  }
  return normalized;
}

export function utf8ByteLength(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Unified platform data hydration utilities
 * Used by both ProductDetail and GenerateDetailsScreen
 */

export type PlatformData = Record<string, any>;

/**
 * Smart merge that preserves user edits while adding new backend data
 * - User edits always take precedence
 * - New fields from backend are added if not present or empty
 * - Nested objects are merged recursively, not replaced
 */
export function smartMergePlatformData(
  baseData: PlatformData,
  userEdits: PlatformData
): PlatformData {
  const result: PlatformData = { ...baseData };

  // Merge user edits on top
  for (const [key, userValue] of Object.entries(userEdits)) {
    const baseValue = baseData[key];

    // Skip internal fields
    if (key.startsWith('_') || key.startsWith('__')) {
      result[key] = userValue;
      continue;
    }

    // If user has edited this field, prefer their edit
    if (userValue !== undefined && userValue !== null) {
      // For objects, do deep merge
      if (
        typeof userValue === 'object' &&
        !Array.isArray(userValue) &&
        typeof baseValue === 'object' &&
        !Array.isArray(baseValue) &&
        baseValue !== null
      ) {
        result[key] = smartMergePlatformData(baseValue, userValue);
      } else {
        // For primitives, arrays, or null, take user value
        result[key] = userValue;
      }
    }
  }

  return result;
}

/**
 * Hydrate platform data from backend response
 * Preserves nested structures like googleShopping, seo, variants, etc.
 */
export function hydratePlatformsFromBackend(
  backendPlatforms: PlatformData,
  existingPlatforms: PlatformData = {}
): PlatformData {
  const result: PlatformData = {};

  // Process each platform from backend
  for (const [platformKey, platformData] of Object.entries(backendPlatforms)) {
    const existing = existingPlatforms[platformKey] || {};
    
    // Smart merge: backend data first, then preserve user edits
    result[platformKey] = smartMergePlatformData(platformData, existing);
  }

  // Preserve any platforms the user added that aren't in backend response
  for (const [platformKey, platformData] of Object.entries(existingPlatforms)) {
    if (!result[platformKey]) {
      result[platformKey] = platformData;
    }
  }

  return result;
}

/**
 * Flatten ONLY the fields that ListingEditorForm expects at top level
 * Preserve nested structures like googleShopping, seo, variants, images
 */
export function normalizeForListingEditor(platformData: any): any {
  if (!platformData || typeof platformData !== 'object') {
    return platformData;
  }

  const normalized: any = { ...platformData };

  // Handle Shopify nested structures - extract specific SEO fields to top level
  // but ALSO preserve the nested structure
  if (normalized.seo && typeof normalized.seo === 'object') {
    // Add to top level for ListingEditorForm compatibility
    normalized.seoTitle = normalized.seo.seoTitle;
    normalized.seoDescription = normalized.seo.seoDescription;
    // Keep nested structure too
    // normalized.seo stays as-is
  }

  // Handle Square nested structure
  if (normalized.object?.itemData) {
    const itemData = normalized.object.itemData;
    normalized.name = normalized.name || itemData.name;
    normalized.description = normalized.description || itemData.description;
    normalized.categorySuggestion = normalized.categorySuggestion || itemData.categorySuggestion;
    
    // Extract price from first variation if available
    if (itemData.variations?.[0]?.itemVariationData?.priceMoney) {
      const priceMoney = itemData.variations[0].itemVariationData.priceMoney;
      normalized.price = normalized.price || (priceMoney.amount / 100);
    }
  }

  // Handle eBay nested structures
  if (normalized.listingDetails && typeof normalized.listingDetails === 'object') {
    // Extract price from buyItNowPrice
    if (normalized.listingDetails.buyItNowPrice) {
      normalized.price = normalized.price || normalized.listingDetails.buyItNowPrice;
    }
  }

  if (normalized.media?.picURL) {
    normalized.imageUrl = normalized.imageUrl || normalized.media.picURL;
  }

  return normalized;
}

/**
 * Create canonical base data from a product variant
 * Used in ProductDetail to initialize platforms
 */
export function createCanonicalBase(productVariant: {
  Title?: string | null;
  Description?: string | null;
  Price?: number | null;
  Sku?: string | null;
  Barcode?: string | null;
  Weight?: number | null;
  WeightUnit?: string | null;
  ImageUrls?: string[] | null;
  [key: string]: any;
}): PlatformData {
  return {
    title: productVariant.Title || '',
    description: productVariant.Description || '',
    price: productVariant.Price || 0,
    sku: productVariant.Sku || '',
    barcode: productVariant.Barcode || '',
    weight: productVariant.Weight || 0,
    weightUnit: productVariant.WeightUnit || 'kg',
    images: productVariant.ImageUrls || [],
  };
}

/**
 * Check if a value is effectively empty
 */
export function isEmpty(value: any): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  );
}

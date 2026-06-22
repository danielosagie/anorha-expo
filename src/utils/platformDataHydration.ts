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

  // Ensure title is populated - many platforms use 'name' instead of 'title'
  if (!normalized.title && normalized.name) {
    normalized.title = normalized.name;
  }

  // Category bridge: generation returns a FREE-TEXT `categorySuggestion` only (no id/path).
  // Seed the fields the form actually reads so the Category row shows the suggested text
  // instead of a blank placeholder while the per-platform taxonomy resolver fills the real id.
  if (normalized.categorySuggestion && !normalized.categoryPath && !normalized.category && !normalized.productCategory) {
    normalized.categoryPath = normalized.categorySuggestion;
    normalized.category = normalized.categorySuggestion;        // eBay/general read path
    normalized.productCategory = normalized.categorySuggestion;  // shopify read path
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
  CompareAtPrice?: number | null;
  Sku?: string | null;
  Barcode?: string | null;
  Weight?: number | null;
  WeightUnit?: string | null;
  RequiresShipping?: boolean | null;
  ImageUrls?: string[] | null;
  Metadata?: any;
  [key: string]: any;
}): PlatformData {
  const parseNumeric = (raw: any): number | undefined => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw === 'number') return raw >= 0 ? raw : undefined;
    const cleaned = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    return Number.isFinite(cleaned) && cleaned >= 0 ? cleaned : undefined;
  };

  // Parse saved metadata if it exists
  const metadata = (productVariant.Metadata as any) || {};
  const savedPlatformData = metadata.platformSpecificData || {};
  const savedShopify = savedPlatformData.shopify || {};

  // Build base from variant fields
  const base = {
    title: productVariant.Title || '',
    description: productVariant.Description || '',
    sku: productVariant.Sku || '',
    barcode: productVariant.Barcode || '',
    price: parseNumeric(productVariant.Price),
    compareAtPrice: parseNumeric(productVariant.CompareAtPrice),
    weight: parseNumeric(productVariant.Weight),
    weightUnit: productVariant.WeightUnit || 'kg',
    requiresShipping: productVariant.RequiresShipping !== false,
    tags: metadata.tags || [],
    vendor: metadata.vendor || '',
    productType: metadata.productType || '',
    images: productVariant.ImageUrls?.length ? productVariant.ImageUrls : (productVariant.PrimaryImageUrl ? [productVariant.PrimaryImageUrl] : []),
  };

  // Merge with saved platform-specific fields (variants, options, inventoryType, etc.)
  return {
    ...base,
    ...savedShopify,
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

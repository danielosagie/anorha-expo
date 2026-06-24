import { listPlatforms } from '../config/platforms';

export type RequirementMap = Record<string, string[]>;

// Per-platform required fields come from the central registry's capabilities.
const DEFAULT_REQUIREMENTS: RequirementMap = Object.fromEntries(
  listPlatforms().map((d) => [d.key, d.capabilities.requiredFields]),
);

/** The registry's required-field list for a platform (falls back to title+price). */
const requiredFieldsFor = (platformKey: string): string[] =>
  DEFAULT_REQUIREMENTS[platformKey] || ['title', 'price'];

/** Whether a single required-field key is satisfied by the platform data. */
const hasRequiredField = (platformData: any, field: string): boolean => {
  switch (field) {
    case 'title':
      return (platformData.title?.toString().trim().length || 0) > 0;
    case 'sku':
      return (platformData.sku?.toString().trim().length || 0) > 0;
    case 'price':
      return hasPlatformPrice(platformData);
    case 'description':
      return (platformData.description?.toString().trim().length || 0) > 0;
    case 'images':
      return Array.isArray(platformData.images) && platformData.images.length > 0;
    case 'category':
      return !!(platformData.productCategoryId || platformData.categoryId);
    default:
      // Unknown required key — be permissive rather than block valid listings.
      return true;
  }
};

export function getPlatformRequirements(overrides?: RequirementMap): RequirementMap {
  if (!overrides) return DEFAULT_REQUIREMENTS;
  return { ...DEFAULT_REQUIREMENTS, ...overrides };
}

/**
 * Check if a platform has valid pricing
 * Flexible: accepts either flat price OR all variants have prices
 * If variants exist, flat price is optional (variants provide pricing)
 */
export function hasPlatformPrice(platformData: any): boolean {
  if (!platformData) return false;

  // 1. Strictly honor explicit flat price
  const parsedPrice = Number(platformData.price);
  if (platformData.price != null && platformData.price !== '' && !isNaN(parsedPrice) && parsedPrice > 0) {
    return true;
  }

  // 2. If no flat price, check if variants exist and provide pricing
  if (Array.isArray(platformData.variants) && platformData.variants.length > 0) {
    // All variants must have prices
    const allVariantsHavePrices = platformData.variants.every((v: any) =>
      v.price && Number(v.price) > 0
    );
    if (allVariantsHavePrices) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a platform is ready to publish.
 * Validation is driven by the registry's requiredFields for the platform (not a
 * hardcoded title/sku/price list), so SKU-less channels aren't falsely blocked
 * and channels needing description/images aren't falsely passed.
 */
export function isPlatformReady(platformData: any, platformKey: string, ignoredPlatforms: string[] = []): boolean {
  if (!platformData || ignoredPlatforms.includes(platformKey)) {
    return false;
  }

  return requiredFieldsFor(platformKey).every((field) => hasRequiredField(platformData, field));
}

/**
 * Get missing fields for a platform, derived from the registry requiredFields.
 */
export function getMissingPlatformFields(platformData: any, platformKey: string): string[] {
  const missing: string[] = [];

  for (const field of requiredFieldsFor(platformKey)) {
    if (!hasRequiredField(platformData, field)) {
      missing.push(field === 'price' ? 'price (either flat or all variants)' : field);
    }
  }

  return missing;
}

export { DEFAULT_REQUIREMENTS };




















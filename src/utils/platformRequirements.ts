export type RequirementMap = Record<string, string[]>;

const DEFAULT_REQUIREMENTS: RequirementMap = {
  shopify: ['title', 'price', 'description', 'images'],
  amazon: ['title', 'price', 'description', 'images'],
  ebay: ['title', 'price', 'description', 'images'],
  clover: ['title', 'price'],
  square: ['title', 'price'],
  facebook: ['title', 'price', 'description', 'images'],
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
  
  // If variants exist, they can provide pricing (no flat price needed)
  if (Array.isArray(platformData.variants) && platformData.variants.length > 0) {
    // All variants must have prices
    const allVariantsHavePrices = platformData.variants.every((v: any) => 
      v.price && Number(v.price) > 0
    );
    if (allVariantsHavePrices) {
      return true;
    }
  }
  
  // Otherwise, require flat price
  if (platformData.price && Number(platformData.price) > 0) {
    return true;
  }
  
  return false;
}

/**
 * Check if a platform is ready to publish
 * Requires: title, sku, and valid price (flexible)
 */
export function isPlatformReady(platformData: any, platformKey: string, ignoredPlatforms: string[] = []): boolean {
  if (!platformData || ignoredPlatforms.includes(platformKey)) {
    return false;
  }
  
  const hasTitle = platformData.title?.toString().trim().length > 0;
  const hasSku = platformData.sku?.toString().trim().length > 0;
  const hasPrice = hasPlatformPrice(platformData);
  
  return hasTitle && hasSku && hasPrice;
}

/**
 * Get missing fields for a platform
 */
export function getMissingPlatformFields(platformData: any, platformKey: string): string[] {
  const missing: string[] = [];
  
  if (!platformData.title?.toString().trim()) {
    missing.push('title');
  }
  
  if (!platformData.sku?.toString().trim()) {
    missing.push('sku');
  }
  
  if (!hasPlatformPrice(platformData)) {
    missing.push('price (either flat or all variants)');
  }
  
  return missing;
}

export { DEFAULT_REQUIREMENTS };




















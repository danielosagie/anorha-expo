/**
 * Track B (v2) — platforms-as-data seam.
 *
 * Variant platform-membership is currently stored as six `On*` boolean columns on
 * ProductVariants. This file is the SINGLE place that knows that. When membership moves to
 * the `PlatformProductMappings` table (see docs/V2_ARCHITECTURE_PLAN.md), only this file
 * changes — every caller keeps using `getVariantPlatforms()` / `isVariantOnPlatform()`, and
 * adding a new platform stops being a schema change threaded through screens.
 */

export type PlatformType = 'shopify' | 'square' | 'clover' | 'amazon' | 'ebay' | 'facebook';

export const PLATFORM_TYPES: readonly PlatformType[] = [
  'shopify',
  'square',
  'clover',
  'amazon',
  'ebay',
  'facebook',
] as const;

/** Maps a platform to its current `On*` boolean column. The only reference to those names. */
export const PLATFORM_FLAG_COLUMN: Record<PlatformType, keyof VariantPlatformFlags> = {
  shopify: 'OnShopify',
  square: 'OnSquare',
  clover: 'OnClover',
  amazon: 'OnAmazon',
  ebay: 'OnEbay',
  facebook: 'OnFacebook',
};

export interface VariantPlatformFlags {
  OnShopify?: boolean | null;
  OnSquare?: boolean | null;
  OnClover?: boolean | null;
  OnAmazon?: boolean | null;
  OnEbay?: boolean | null;
  OnFacebook?: boolean | null;
}

/** Platforms a variant is currently listed on, derived from its `On*` flags. */
export function getVariantPlatforms(
  variant: VariantPlatformFlags | null | undefined,
): PlatformType[] {
  if (!variant) return [];
  return PLATFORM_TYPES.filter((p) => Boolean(variant[PLATFORM_FLAG_COLUMN[p]]));
}

/** Whether a variant is listed on a specific platform. */
export function isVariantOnPlatform(
  variant: VariantPlatformFlags | null | undefined,
  platform: PlatformType,
): boolean {
  return Boolean(variant && variant[PLATFORM_FLAG_COLUMN[platform]]);
}

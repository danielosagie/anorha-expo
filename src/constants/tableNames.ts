/**
 * Canonical Supabase table names.
 *
 * Import `TABLES.X` instead of hardcoding string literals. A table rename then
 * touches one line, and the lint guardrail can ban raw table-name literals.
 */
export const TABLES = {
  ProductVariants: 'ProductVariants',
  InventoryLevels: 'InventoryLevels',
  PlatformProductMappings: 'PlatformProductMappings',
  ProductImages: 'ProductImages',
  MarketplaceListings: 'MarketplaceListings',
  PlatformConnections: 'PlatformConnections',
  PlatformLocations: 'PlatformLocations',
  CrossOrgProductLinks: 'CrossOrgProductLinks',
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];

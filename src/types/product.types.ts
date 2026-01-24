/**
 * Canonical Product Types
 * 
 * These types define THE standard format for product data.
 * Used by: GenerateDetailsScreen, ListingEditorForm, ProductDetail, and backend APIs
 * 
 * RULE: No format conversions. Data should match these types exactly.
 */

// ============================================================================
// INVENTORY
// ============================================================================

/**
 * Inventory at a specific location
 */
export interface InventoryEntry {
    quantity: number;
    price?: number;  // Per-location price override (e.g., Square, Clover)
}

/**
 * Inventory by location - THE ONLY inventory format
 * Key is the platform location ID (e.g., "gid://shopify/Location/123")
 */
export type InventoryByLocation = Record<string, InventoryEntry>;

// ============================================================================
// VARIANTS
// ============================================================================

/**
 * Canonical variant structure
 */
export interface Variant {
    id: string;
    sku?: string;
    barcode?: string;
    price?: number;
    compareAtPrice?: number;
    costPerItem?: number;
    weight?: number;
    weightUnit?: string;

    /** Option values - e.g., { "Size": "Sm", "Color": "Red" } */
    optionValues: Record<string, string>;

    /** Inventory by location - ALWAYS use this format */
    inventoryByLocation: InventoryByLocation;

    /** Optional variant image */
    image?: string;
}

/**
 * Product option definition
 */
export interface ProductOption {
    name: string;
    values: string[];
}

// ============================================================================
// PLATFORM STATE
// ============================================================================

/**
 * Platform-specific product data
 * This is what ListingEditorForm works with
 */
export interface PlatformProductData {
    // Core fields
    title?: string;
    description?: string;
    price?: number;
    sku?: string;
    barcode?: string;

    // Categorization
    tags?: string[];
    vendor?: string;
    productType?: string;
    brand?: string;
    condition?: string;
    categorySuggestion?: string;

    // Physical
    weight?: number;
    weightUnit?: string;
    requiresShipping?: boolean;

    // SEO
    seoTitle?: string;
    seoDescription?: string;

    // Media
    images?: string[];

    // Variant options
    options?: ProductOption[];

    // Variants (if multi-variant product)
    variants?: Variant[];

    // Inventory (for single-variant products without variants array)
    inventoryByLocation?: InventoryByLocation;

    // Platform connection locations
    locations?: PlatformLocation[];

    // Status
    status?: 'active' | 'draft' | 'archived';
}

/**
 * Location from a platform connection
 */
export interface PlatformLocation {
    id: string;
    name: string;
    platformType?: string;
}

// ============================================================================
// PUBLISH PAYLOAD
// ============================================================================

/**
 * Media payload for publishing
 */
export interface PublishMedia {
    imageUris: string[];
    coverImageIndex: number;
}

/**
 * Platform details in publish payload
 */
export interface PublishPlatformDetails {
    canonical: PlatformProductData;
    // Platform-specific overrides
    [platformKey: string]: PlatformProductData | undefined;
}

/**
 * Publish payload sent to backend
 */
export interface PublishPayload {
    platformDetails: PublishPlatformDetails;
    media: PublishMedia;
    selectedPlatformsToPublish: string[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create empty inventory entry
 */
export function createEmptyInventory(price?: number): InventoryEntry {
    return { quantity: 0, price };
}

/**
 * Create inventory by location for a set of locations
 */
export function createInventoryByLocation(
    locationIds: string[],
    defaultPrice?: number
): InventoryByLocation {
    const result: InventoryByLocation = {};
    for (const locId of locationIds) {
        result[locId] = createEmptyInventory(defaultPrice);
    }
    return result;
}

/**
 * Get total inventory across all locations
 */
export function getTotalInventory(inv: InventoryByLocation): number {
    return Object.values(inv).reduce((sum, entry) => sum + entry.quantity, 0);
}

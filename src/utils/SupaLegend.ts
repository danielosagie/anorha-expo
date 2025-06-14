// Adding a comment to force a save and hopefully refresh linter state
import { observable, ObservableObject } from '@legendapp/state';
import { syncedSupabase, configureSyncedSupabase } from '@legendapp/state/sync-plugins/supabase';
import { configureSynced } from '@legendapp/state/sync'; // Removed SyncedOptions for now
import { observablePersistAsyncStorage } from '@legendapp/state/persist-plugins/async-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values'; // Polyfill for uuid
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../../lib/supabase'; // Ensure this is the auth-configured client
import { SupabaseClient } from '@supabase/supabase-js'; // Removed PostgrestQueryBuilder import
// import { Database } from './database.types'; // We'll generate this later

// export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey);

// Interfaces (can remain at top level)
export interface ProductVariant {
    Id: string; // uuid
    ProductId: string; // uuid
    UserId: string; // uuid
    Sku: string;
    Barcode?: string | null;
    Title: string;
    Description?: string | null;
    Price: number; // decimal
    CompareAtPrice?: number | null; // decimal
    Weight?: number | null; // decimal
    WeightUnit?: string | null;
    Options?: Record<string, any> | null; // jsonb
    CreatedAt: string; // timestamptz
    UpdatedAt: string; // timestamptz
    status?: string | null; // Added from your select query
    image?: string; // Example: To store a primary image URL
    quantity?: number; // Example: To store aggregated quantity
    platforms?: string[]; // Example
}

// Function to generate IDs locally (can remain at top level)
const generateId = () => uuidv4();

// Interface for the returned object from initializeLegendState
export interface LegendStateObservables {
    productVariants$?: ObservableObject<Record<string, ProductVariant>>;
    platformProductMappings$?: ObservableObject<Record<string, PlatformProductMapping>>;
    productImages$?: ObservableObject<Record<string, ProductImage>>;
    inventoryLevels$?: ObservableObject<Record<string, InventoryLevel>>;
    marketplaceListings$?: ObservableObject<Record<string, MarketplaceListing>>;
    platformLocations$?: ObservableObject<Record<string, PlatformLocation>>;
    userId?: string; // Added userId to the return type
}

// This will hold the initialized observables
let legendStateObservablesSingleton: LegendStateObservables | null = null;

// Initialization function
export async function initializeLegendState(
    supabaseClient: SupabaseClient, 
    userIdToInitialize: string, // Changed from optional to required
    options: { force?: boolean } = {} // NEW: Add options with force flag
): Promise<LegendStateObservables> {

    console.log(`[SupaLegend] Attempting to initialize Legend State for userIdToInitialize: ${userIdToInitialize}`);

    // If already initialized for the same user, return the existing instance UNLESS forcing
    if (legendStateObservablesSingleton && legendStateObservablesSingleton.userId === userIdToInitialize && !options.force) {
        console.warn(`[SupaLegend] Legend State already initialized for user ${userIdToInitialize}. Use force:true to re-initialize.`);
        return legendStateObservablesSingleton;
    }

    // If switching users, or first time init for this user, or forcing, proceed
    if (options.force) {
        console.log(`[SupaLegend] Forcing re-initialization for user ${userIdToInitialize}...`);
    } else {
        console.log(`[SupaLegend] Initializing Legend State for user ${userIdToInitialize}...`);
    }
    legendStateObservablesSingleton = null; // Clear previous instance if user is different

    const currentUserId = userIdToInitialize;
    console.log(`[SupaLegend] currentUserId set to: ${currentUserId}`);

    // --- BEGIN DIAGNOSTIC: Clear persisted productVariants$ for this user ---
    const productVariantsPersistKey = `productVariants_user_${currentUserId}_v2`;
    try {
        console.log(`[SupaLegend - DIAGNOSTIC] Attempting to remove AsyncStorage key: ${productVariantsPersistKey}`);
        await AsyncStorage.removeItem(productVariantsPersistKey);
        console.log(`[SupaLegend - DIAGNOSTIC] Successfully removed AsyncStorage key: ${productVariantsPersistKey}`);
    } catch (e) {
        console.error(`[SupaLegend - DIAGNOSTIC] Error removing AsyncStorage key ${productVariantsPersistKey}:`, e);
    }
    // --- END DIAGNOSTIC ---

    configureSyncedSupabase({
        generateId,
    });

    const syncBaseOptions: any = { 
        persist: {
            plugin: observablePersistAsyncStorage({
                AsyncStorage,
            }),
        },
        supabase: supabaseClient, 
        retry: {
            infinite: true,
        },
    };
    const customSynced = configureSynced(syncedSupabase, syncBaseOptions);

    const productVariants$ = observable<Record<string, ProductVariant>>(
        customSynced({
            collection: 'ProductVariants',
            select: (from: any) => from.select('*, id:Id'),
            filter: (query: any) => query.eq('UserId', currentUserId),
            actions: ['read', 'create', 'update', 'delete'],
            realtime: { filter: `UserId=eq.${currentUserId}` },
            persist: {
                name: `productVariants_user_${currentUserId}_v2`,
                retrySync: true,
            },
        })
    );
    console.log(`[SupaLegend] productVariants$ observable configured for UserId: ${currentUserId}`);

    // Add onChange listener for diagnostics
    productVariants$.onChange(syncedData => {
        const dataCount = Object.keys(syncedData || {}).length;
        console.log(`[SupaLegend - productVariants$.onChange] Data changed. Count: ${dataCount}`);
        if (dataCount > 0 && dataCount < 5) { // Log first few items if count is small
            console.log('[SupaLegend - productVariants$.onChange] Sample data:', JSON.stringify(Object.values(syncedData || {}).slice(0, 5), null, 2));
        } else if (dataCount === 0) {
            console.log('[SupaLegend - productVariants$.onChange] Data is empty.');
        }
    }, { immediate: true }); // true for immediate initial call with current value

    // TODO: The filters for these related tables need careful consideration.
    // If they don't have a direct UserId column, you might need to:
    // 1. Fetch them based on ProductVariantIds obtained from the already filtered productVariants$.
    // 2. Use Supabase Views or RPCs that join and filter by UserId.
    // 3. For now, they will fetch all records and client-side will need to filter in useMemo.
    // This is NOT ideal for performance or security if RLS is off for these tables.

    const platformProductMappings$ = observable<Record<string, PlatformProductMapping>>(
        customSynced({
            collection: 'PlatformProductMappings',
            select: (from: any) => from.select('*, id:Id'),
            actions: ['read', 'create', 'update', 'delete'],
            realtime: true, 
            persist: {
                name: `platformProductMappings_user_${currentUserId}_v2`,
                retrySync: true,
            },
        })
    );
    console.log(`[SupaLegend] platformProductMappings$ observable configured for UserId: ${currentUserId} (indirectly, needs RLS/joins for proper filtering)`);

    const productImages$ = observable<Record<string, ProductImage>>(
        customSynced({
            collection: 'ProductImages',
            select: (from: any) => from.select('*, id:Id'),
            actions: ['read', 'create', 'update', 'delete'],
            realtime: true, 
            persist: {
                name: `productImages_user_${currentUserId}_v2`,
                retrySync: true,
            },
        })
    );
    console.log(`[SupaLegend] productImages$ observable configured for UserId: ${currentUserId} (indirectly, needs RLS/joins for proper filtering)`);
    
    // Add onChange listener for productImages$ diagnostics
    productImages$.onChange(syncedData => {
        const dataCount = Object.keys(syncedData || {}).length;
        console.log(`[SupaLegend - productImages$.onChange] Data changed. Count: ${dataCount}`);
        if (dataCount > 0 && dataCount < 5) { // Log first few items if count is small
            console.log('[SupaLegend - productImages$.onChange] Sample data:', JSON.stringify(Object.values(syncedData || {}).slice(0, 5), null, 2));
        } else if (dataCount === 0) {
            console.log('[SupaLegend - productImages$.onChange] Data is empty.');
        }
    }, { immediate: true });

    const inventoryLevels$ = observable<Record<string, InventoryLevel>>(
        customSynced({
            collection: 'InventoryLevels',
            select: (from: any) => from.select('*, id:Id'),
            actions: ['read', 'create', 'update', 'delete'],
            realtime: true, 
            persist: {
                name: `inventoryLevels_user_${currentUserId}_v2`,
                retrySync: true,
            },
        })
    );
    console.log(`[SupaLegend] inventoryLevels$ observable configured for UserId: ${currentUserId} (indirectly, needs RLS/joins for proper filtering)`);

    const marketplaceListings$ = observable<Record<string, MarketplaceListing>>(
        customSynced({
            collection: 'MarketplaceListings',
            select: (from: any) => from.select('*, id:Id'), // Alias Id to id
            filter: (query: any) => query.eq('SellerUserId', currentUserId), // Filter by SellerUserId
            actions: ['read', 'create', 'update', 'delete'],
            realtime: { filter: `SellerUserId=eq.${currentUserId}` }, 
            persist: {
                name: `marketplaceListings_user_${currentUserId}_v2`,
                retrySync: true,
            },
        })
    );
    console.log(`[SupaLegend] marketplaceListings$ observable configured for UserId: ${currentUserId}`);

    // Placeholder for PlatformLocations observable - to be implemented with actual data fetching
    const platformLocations$ = observable<Record<string, PlatformLocation>>({}); 
    console.log(`[SupaLegend] platformLocations$ observable initialized (placeholder).`);

    // --- Activate observables to potentially kickstart sync --- 
    console.log("[SupaLegend] Activating productVariants$...");
    productVariants$.get(); // Call get() to activate and start syncing
    console.log(`[SupaLegend] productVariants$ activated. Current local count: ${Object.keys(productVariants$.get() || {}).length}`);

    // Optionally activate others if needed, but productVariants is primary for now
    // console.log("[SupaLegend] Activating platformProductMappings$...");
    // platformProductMappings$.get();
    console.log("[SupaLegend] Activating productImages$...");
    productImages$.get();
    // console.log("[SupaLegend] Activating inventoryLevels$...");
    // inventoryLevels$.get();

    legendStateObservablesSingleton = {
        productVariants$,
        platformProductMappings$,
        productImages$,
        inventoryLevels$,
        marketplaceListings$,
        platformLocations$,
        userId: currentUserId, // Store the userId with the initialized observables
    };

    console.log("[SupaLegend] Observables configured for user:", currentUserId);
    return legendStateObservablesSingleton;
}

// Getter function to access observables after initialization
export function getLegendStateObservables(): LegendStateObservables {
    if (!legendStateObservablesSingleton || !legendStateObservablesSingleton.productVariants$) {
        throw new Error("[SupaLegend] Legend State or productVariants$ not initialized. Call initializeLegendState first.");
    }
    return legendStateObservablesSingleton;
}

// Helper functions - these will now need to get productVariants$ via getLegendStateObservables()
// or be methods on a class that holds the observables.
// For simplicity, let's adjust one:

export function addProductVariant(variantData: Omit<ProductVariant, 'Id' | 'CreatedAt' | 'UpdatedAt' | 'UserId'>) {
    if (!legendStateObservablesSingleton?.productVariants$ || !legendStateObservablesSingleton?.userId) {
        console.error("[SupaLegend] Cannot add product variant: Observables or user context not ready.");
        return;
    }
    const obs = legendStateObservablesSingleton.productVariants$;
    const currentUserId = legendStateObservablesSingleton.userId;
    const id = generateId();
    const now = new Date().toISOString();
    obs[id].set({
        ...variantData,
        Id: id,
        UserId: currentUserId, // Automatically set UserId
        CreatedAt: now,
        UpdatedAt: now,
    } as ProductVariant);
}

export function updateProductVariant(id: string, updates: Partial<ProductVariant>) {
    if (!legendStateObservablesSingleton?.productVariants$) return;
    const obs = legendStateObservablesSingleton.productVariants$;
    if (!obs[id].get()) {
        console.warn(`ProductVariant with id ${id} not found for update.`);
        return;
    }
    obs[id].assign({
        ...updates,
        UpdatedAt: new Date().toISOString(),
    });
}

export function deleteProductVariant(id: string) {
    if (!legendStateObservablesSingleton?.productVariants$) return;
    const obs = legendStateObservablesSingleton.productVariants$;
    if (!obs[id].get()) {
        console.warn(`ProductVariant with id ${id} not found for hard deletion.`);
        return;
    }
    obs[id].delete(); 
}

// Temporarily commented out code for other observables will be re-introduced into the initializeLegendState function later.
/*
export interface PlatformProductMapping { ... }
// export const platformProductMappings$ = observable<...>(...);

export interface ProductImage { ... }
// export const productImages$ = observable<...>(...);

export interface InventoryLevel { ... }
// export const inventoryLevels$ = observable<...>(...);

// Helper functions for commented out observables
export function addPlatformMapping(...) { ... }
export function updatePlatformMapping(...) { ... }
export function addInventoryLevel(...) { ... }
export function updateInventoryLevel(...) { ... }
*/

// Define PlatformProductMapping interface based on sssync-db.md
export interface PlatformProductMapping {
    Id: string; // uuid
    PlatformConnectionId: string; // uuid
    ProductVariantId: string; // uuid
    PlatformProductId: string;
    PlatformVariantId?: string | null;
    PlatformSku?: string | null;
    PlatformSpecificData?: Record<string, any> | null; // jsonb
    LastSyncedAt?: string | null; // timestamptz
    SyncStatus: string; // default 'Pending'
    SyncErrorMessage?: string | null;
    IsEnabled: boolean; // default true
    CreatedAt: string; // timestamptz
    UpdatedAt: string; // timestamptz
}

// Create an observable for PlatformProductMappings
// export const platformProductMappings$ = observable<Record<string, PlatformProductMapping>>(
//     customSynced({
//         collection: 'PlatformProductMappings',
//         select: (from) => from.select('*'), // Select all fields for now, adjust as needed
//         actions: ['read', 'create', 'update', 'delete'],
//         realtime: true,
//         persist: {
//             name: 'platformProductMappings',
//             retrySync: true,
//         },
//         // Consider filtering by IsEnabled or other relevant fields
//     })
// );

// Define ProductImage interface based on sssync-db.md
export interface ProductImage {
    Id: string; // uuid
    ProductVariantId: string; // uuid
    ImageUrl: string;
    AltText?: string | null;
    Position: number; // default 0
    PlatformMappingId?: string | null; // uuid
    CreatedAt: string; // timestamptz
}

// Create an observable for ProductImages
// export const productImages$ = observable<Record<string, ProductImage>>(
//     customSynced({
//         collection: 'ProductImages',
//         select: (from) => from.select('Id, ProductVariantId, ImageUrl, AltText, Position, CreatedAt'), // PlatformMappingId can be added if needed later
//         actions: ['read', 'create', 'update', 'delete'],
//         realtime: true,
//         persist: {
//             name: 'productImages',
//             retrySync: true,
//         },
//     })
// );

// Define InventoryLevel interface based on sssync-db.md
export interface InventoryLevel {
    Id: string; // uuid
    ProductVariantId: string; // uuid
    PlatformConnectionId: string; // uuid
    PlatformLocationId?: string | null;
    Quantity: number; // default 0
    UpdatedAt: string; // timestamptz
}

// Create an observable for InventoryLevels
// export const inventoryLevels$ = observable<Record<string, InventoryLevel>>(
//     customSynced({
//         collection: 'InventoryLevels',
//         select: (from) => from.select('*'), // Select all fields, adjust as needed
//         actions: ['read', 'create', 'update', 'delete'],
//         realtime: true,
//         persist: {
//             name: 'inventoryLevels',
//             retrySync: true,
//         },
//         // Note: Unique constraint is on (ProductVariantId, PlatformConnectionId, PlatformLocationId)
//         // Legend-State typically keys by a single 'Id'. Handling composite keys for updates
//         // might need custom logic in update functions if not using the row 'Id'.
//     })
// );

// Example for PlatformProductMapping:
// export function addPlatformMapping(mappingData: Omit<PlatformProductMapping, 'Id' | 'CreatedAt' | 'UpdatedAt'>) {
//     const id = generateId();
//     const now = new Date().toISOString();
//     platformProductMappings$[id].set({
//         ...mappingData,
//         Id: id,
//         CreatedAt: now,
//         UpdatedAt: now,
//     } as PlatformProductMapping);
// }

// export function updatePlatformMapping(id: string, updates: Partial<PlatformProductMapping>) {
//     if (platformProductMappings$[id].get()) {
//         platformProductMappings$[id].assign({
//             ...updates,
//             UpdatedAt: new Date().toISOString(),
//         });
//     } else {
//         console.warn(`PlatformProductMapping with id ${id} not found for update.`);
//     }
// }

// Example for InventoryLevel:
// export function addInventoryLevel(levelData: Omit<InventoryLevel, 'Id' | 'UpdatedAt'>) {
//     const id = generateId();
//     inventoryLevels$[id].set({
//         ...levelData,
//         Id: id,
//         UpdatedAt: new Date().toISOString(),
//     } as InventoryLevel);
// }

// export function updateInventoryLevel(id: string, updates: Partial<InventoryLevel>) {
//     // Note: If using composite primary keys for business logic to find existing level to update,
//     // you might need to query/find the 'Id' first before using assign.
//     if (inventoryLevels$[id].get()) {
//         inventoryLevels$[id].assign({
//             ...updates,
//             UpdatedAt: new Date().toISOString(),
//         });
//     } else {
//         console.warn(`InventoryLevel with id ${id} not found for update.`);
//         // Potentially, you might want to create it if it doesn't exist, e.g., addInventoryLevel(updates as Omit...)
//     }
// }

// TODO: Generate TypeScript types from your Supabase schema for better type safety
// npx supabase gen types typescript --project-id <your-project-id> --schema public > src/utils/database.types.ts
// Then import Database and use createClient<Database>(...) 

// Define MarketplaceListing interface based on sssync-db.md
export interface MarketplaceListing {
    Id: string; // uuid
    ProductVariantId: string; // uuid, UNIQUE
    SellerUserId: string; // uuid
    Price: number; // decimal
    AvailableQuantity: number;
    IsEnabled: boolean; // default true
    CreatedAt: string; // timestamptz
    UpdatedAt: string; // timestamptz
    // Helper field for aliasing, actual DB field is Id
    id?: string; 
}

// Define PlatformLocation interface (based on discussion)
export interface PlatformLocation {
    Id: string; // Internal DB ID uuid
    PlatformConnectionId: string; // uuid REFERENCES PlatformConnections(Id)
    PlatformGeneratedLocationId: string; // The ID from the platform (e.g., Square's location ID)
    Name: string; // User-friendly location name
    IsPOS: boolean;
    // Potentially other fields like address, etc.
    // Helper field for aliasing, actual DB field is Id
    id?: string; 
}

// Define PlatformConnection interface (based on sssync-db.md and usage)
export interface PlatformConnection {
    Id: string; // uuid
    UserId: string; // uuid
    PlatformType: string; // e.g., 'Shopify', 'Square', 'Clover'
    DisplayName: string;
    Credentials: any; // jsonb - Opaque, store encrypted OAuth credentials or API keys
    Status: string; // e.g., 'Connected', 'NeedsReauth', 'Error'
    IsEnabled: boolean;
    LastSyncAttemptAt?: string | null; // timestamptz
    LastSyncSuccessAt?: string | null; // timestamptz
    CreatedAt: string; // timestamptz
    UpdatedAt: string; // timestamptz
    // Helper field for aliasing, actual DB field is Id
    id?: string;
} 
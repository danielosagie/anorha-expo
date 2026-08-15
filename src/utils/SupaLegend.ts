// Adding a comment to force a save and hopefully refresh linter state
import { observable, ObservableObject, syncState, when } from '@legendapp/state';
import { syncedSupabase, configureSyncedSupabase } from '@legendapp/state/sync-plugins/supabase';
import { configureSynced } from '@legendapp/state/sync'; // Removed SyncedOptions for now
import { observablePersistAsyncStorage } from '@legendapp/state/persist-plugins/async-storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values'; // Polyfill for uuid
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../../lib/supabase'; // Ensure this is the auth-configured client
import { SupabaseClient } from '@supabase/supabase-js'; // Removed PostgrestQueryBuilder import
import type {
  ProductVariantsRow,
  InventoryLevelsRow,
  PlatformProductMappingsRow,
  ProductImagesRow,
  PlatformConnectionsRow,
} from '../types/database.types';
import { createLogger } from './logger';
import {
  COLLECTION_PAGE_SIZES,
  PRODUCT_VARIANT_LIST_SELECT,
  type BoundedCollectionName,
  type CollectionSyncProgress,
  createCollectionPageAccumulator,
  normalizePersistedCollection,
  utf8ByteLength,
} from '../lib/pagedCollectionSync';
const log = createLogger('SupaLegend');


// ============================================================================
// Data model — derived from the generated DB schema (src/types/database.types.ts),
// which is the SINGLE SOURCE OF TRUTH. Each app type = the DB Row + explicit
// client-only fields. Column names/types can no longer silently drift from the DB;
// regenerate types with `npm run db:types` after a migration.
// ============================================================================

/**
 * A ProductVariant as held in the Legend State cache: the DB row plus a few
 * client-only/derived fields. (The cache select currently fetches a subset of
 * columns — see initializeLegendState — so non-selected fields are absent at runtime.)
 */
export interface ProductVariant extends ProductVariantsRow {
  // Product copy moved to the parent Products row in item-model Phase 4B.
  Products?: {
    Title: string;
    Description?: string | null;
    Tags: string[] | null;
  } | Array<{
    Title: string;
    Description?: string | null;
    Tags: string[] | null;
  }> | null;
  // Client-only / derived (NOT database columns):
  image?: string; // primary image URL convenience
  quantity?: number; // aggregated quantity convenience
  platforms?: string[]; // derived from On* flags
  ImageUrls?: string[]; // hydrated from ProductImages
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
    syncProgress$?: ObservableObject<Record<BoundedCollectionName, CollectionSyncProgress>>;
    userId?: string; // Added userId to the return type
}

// This will hold the initialized observables
let legendStateObservablesSingleton: LegendStateObservables | null = null;
let legendInitializationGeneration = 0;

const INITIAL_SYNC_PROGRESS: Record<BoundedCollectionName, CollectionSyncProgress> = {
    ProductVariants: { pageSize: COLLECTION_PAGE_SIZES.ProductVariants, loadedRows: 0, phase: 'idle' },
    PlatformProductMappings: { pageSize: COLLECTION_PAGE_SIZES.PlatformProductMappings, loadedRows: 0, phase: 'idle' },
    ProductImages: { pageSize: COLLECTION_PAGE_SIZES.ProductImages, loadedRows: 0, phase: 'idle' },
    InventoryLevels: { pageSize: COLLECTION_PAGE_SIZES.InventoryLevels, loadedRows: 0, phase: 'idle' },
    MarketplaceListings: { pageSize: COLLECTION_PAGE_SIZES.MarketplaceListings, loadedRows: 0, phase: 'idle' },
};

function buildFallbackLegendState(userId: string): LegendStateObservables {
    return {
        productVariants$: observable<Record<string, ProductVariant>>({}),
        platformProductMappings$: observable<Record<string, PlatformProductMapping>>({}),
        productImages$: observable<Record<string, ProductImage>>({}),
        inventoryLevels$: observable<Record<string, InventoryLevel>>({}),
        marketplaceListings$: observable<Record<string, MarketplaceListing>>({}),
        platformLocations$: observable<Record<string, PlatformLocation>>({}),
        syncProgress$: observable<Record<BoundedCollectionName, CollectionSyncProgress>>({ ...INITIAL_SYNC_PROGRESS }),
        userId,
    };
}

// A single, stable, inert observable set handed to any component that reads the
// Legend State context while the provider value is momentarily null/incomplete.
//
// This happens on SIGN-OUT: App.tsx nulls the context value one commit BEFORE React
// Navigation unmounts the signed-in screens that consume it, so those screens get one
// final render against a null provider. Throwing there crashed the whole app — e.g.
// NewClearoutSheet, which SproutHomeScreen keeps mounted even while the sheet is closed.
//
// Built lazily and cached so its observable identities never change across renders.
// Stable identity is required so consumers' effects/subscriptions don't churn. The
// observables are plain (NOT Supabase-synced), so this fallback touches no network and
// holds no user data.
let signedOutLegendStateSingleton: LegendStateObservables | null = null;
export function getSignedOutLegendState(): LegendStateObservables {
    if (!signedOutLegendStateSingleton) {
        signedOutLegendStateSingleton = buildFallbackLegendState('__signed_out__');
    }
    return signedOutLegendStateSingleton;
}

// Initialization function
export async function initializeLegendState(
    supabaseClient: SupabaseClient,
    userIdToInitialize: string, // Changed from optional to required
    options: { force?: boolean } = {} // NEW: Add options with force flag
): Promise<LegendStateObservables> {

    log.debug(`[SupaLegend] Attempting to initialize Legend State for userIdToInitialize: ${userIdToInitialize}`);

    // If already initialized for the same user, return the existing instance UNLESS forcing
    if (legendStateObservablesSingleton && legendStateObservablesSingleton.userId === userIdToInitialize && !options.force) {
        log.warn(`[SupaLegend] Legend State already initialized for user ${userIdToInitialize}. Use force:true to re-initialize.`);
        return legendStateObservablesSingleton;
    }

    // If switching users, or first time init for this user, or forcing, proceed
    if (options.force) {
        log.debug(`[SupaLegend] Forcing re-initialization for user ${userIdToInitialize}...`);
    } else {
        log.debug(`[SupaLegend] Initializing Legend State for user ${userIdToInitialize}...`);
    }
    legendStateObservablesSingleton = null; // Clear previous instance if user is different

    const currentUserId = userIdToInitialize;
    const initializationGeneration = ++legendInitializationGeneration;
    const initializationStartedAt = Date.now();
    log.debug(`[SupaLegend] currentUserId set to: ${currentUserId}`);

    const persistenceNames = {
        ProductVariants: `productVariants_user_${currentUserId}_v8`,
        PlatformProductMappings: `platformProductMappings_user_${currentUserId}_v3`,
        ProductImages: `productImages_user_${currentUserId}_v3`,
        InventoryLevels: `inventoryLevels_user_${currentUserId}_v7`,
        MarketplaceListings: `marketplaceListings_user_${currentUserId}_v3`,
    } as const;

    configureSyncedSupabase({
        generateId,
    });

    const syncBaseOptions: any = {
        persist: {
            plugin: observablePersistAsyncStorage({
                AsyncStorage,
                // One batched local read lets every inventory dependency hydrate before
                // the signed-in navigator paints. Remote sync starts only after persist.
                preload: Object.values(persistenceNames),
            }),
        },
        supabase: supabaseClient,
        retry: {
            // Bounded retry: a rejected write (e.g. HTTP 400) must NOT retry forever.
            // `infinite: true` previously turned a single failed upsert into a sustained
            // request storm. Cap attempts with exponential backoff instead.
            times: 3,
            delay: 1000,
            backoff: 'exponential',
            maxDelay: 30000,
        },
    };
    const customSynced = configureSynced(syncedSupabase, syncBaseOptions);

    const syncProgress$ = observable<Record<BoundedCollectionName, CollectionSyncProgress>>({
        ...INITIAL_SYNC_PROGRESS,
    });

    let productVariants$: ObservableObject<Record<string, ProductVariant>>;
    let platformProductMappings$: ObservableObject<Record<string, PlatformProductMapping>>;
    let productImages$: ObservableObject<Record<string, ProductImage>>;
    let inventoryLevels$: ObservableObject<Record<string, InventoryLevel>>;
    let marketplaceListings$: ObservableObject<Record<string, MarketplaceListing>>;

    const createBoundedList = <T extends { Id?: string }>(options: {
        collectionName: BoundedCollectionName;
        select: string;
        filter?: (query: any) => any;
        getObservable: () => ObservableObject<Record<string, T>>;
    }) => {
        const pageSize = COLLECTION_PAGE_SIZES[options.collectionName];
        const accumulator = createCollectionPageAccumulator<T>(pageSize);

        return async (params: any) => {
            const { offset } = accumulator.beginPage();
            syncProgress$[options.collectionName].set({
                pageSize,
                loadedRows: offset,
                phase: offset === 0 ? 'initial' : 'background',
            });

            let query = supabaseClient
                .from(options.collectionName)
                .select(options.select)
                .order('UpdatedAt', { ascending: false })
                .order('Id', { ascending: false })
                .range(offset, offset + pageSize - 1);
            if (options.filter) query = options.filter(query);

            const pageStartedAt = Date.now();
            const response = await query;
            if (response.error) {
                accumulator.reset();
                syncProgress$[options.collectionName].set({
                    pageSize,
                    loadedRows: offset,
                    phase: 'error',
                });
                return response;
            }

            const pageRows = (response.data || []) as unknown as T[];
            const accepted = accumulator.acceptPage(offset, pageRows);
            params.mode = accepted.mode;
            syncProgress$[options.collectionName].set({
                pageSize,
                loadedRows: accepted.loadedRows,
                phase: accepted.hasMore ? 'background' : 'complete',
            });

            log.debug('[SupaLegend][measure] bounded page', {
                collection: options.collectionName,
                offset,
                rows: pageRows.length,
                payloadBytes: utf8ByteLength(pageRows),
                durationMs: Date.now() - pageStartedAt,
                hasMore: accepted.hasMore,
            });

            if (accepted.hasMore) {
                setTimeout(() => {
                    if (initializationGeneration !== legendInitializationGeneration) return;
                    const observable = options.getObservable();
                    void syncState(observable).sync();
                }, 16);
            }

            return { ...response, data: accepted.rows };
        };
    };

    const persistedRecordTransform = {
        load: (value: Record<string, any>) => normalizePersistedCollection(value),
    };

    productVariants$ = observable<Record<string, ProductVariant>>(
        customSynced({
            collection: 'ProductVariants',
            fieldId: 'Id',
            // The inventory list never renders parent descriptions. ProductDetail
            // fetches Products.Description when the seller opens a detail surface.
            list: createBoundedList<ProductVariant>({
                collectionName: 'ProductVariants',
                select: PRODUCT_VARIANT_LIST_SELECT,
                filter: (query: any) => query.eq('UserId', currentUserId).not('Sku', 'like', 'DRAFT-%'),
                getObservable: () => productVariants$,
            }),
            actions: ['read'],
            realtime: { filter: `UserId=eq.${currentUserId}` },
            persist: {
                name: persistenceNames.ProductVariants,
                retrySync: true,
                transform: persistedRecordTransform,
            },
        })
    );
    log.debug(`[SupaLegend] productVariants$ observable configured for UserId: ${currentUserId}`);

    // Add onChange listener for diagnostics
    productVariants$.onChange(({ value, isFromPersist, isFromSync }) => {
        const dataCount = Object.keys(value || {}).length;
        log.debug('[SupaLegend][measure] ProductVariants changed', {
            rows: dataCount,
            source: isFromPersist ? 'persist' : isFromSync ? 'remote' : 'local',
            sinceInitializationMs: Date.now() - initializationStartedAt,
        });
        if (dataCount > 0 && dataCount < 5) { // Log first few items if count is small
            log.debug('[SupaLegend - productVariants$.onChange] Small cache hydrated.');
        } else if (dataCount === 0) {
            log.debug('[SupaLegend - productVariants$.onChange] Data is empty.');
        }
    }, { immediate: true }); // true for immediate initial call with current value

    // TODO: The filters for these related tables need careful consideration.
    // If they don't have a direct UserId column, you might need to:
    // 1. Fetch them based on ProductVariantIds obtained from the already filtered productVariants$.
    // 2. Use Supabase Views or RPCs that join and filter by UserId.
    // 3. For now, they will fetch all records and client-side will need to filter in useMemo.
    // This is NOT ideal for performance or security if RLS is off for these tables.

    // OPTIMIZED: Reduced columns, relies on RLS to filter via ProductVariantId join
    platformProductMappings$ = observable<Record<string, PlatformProductMapping>>(
        customSynced({
            collection: 'PlatformProductMappings',
            fieldId: 'Id',
            list: createBoundedList<PlatformProductMapping>({
                collectionName: 'PlatformProductMappings',
                select: 'Id, PlatformConnectionId, ProductVariantId, PlatformProductId, PlatformVariantId, PlatformSku, SyncStatus, IsEnabled, LastSyncedAt, UpdatedAt',
                getObservable: () => platformProductMappings$,
            }),
            actions: ['read', 'create', 'update', 'delete'],
            realtime: true, // RLS filters via ProductVariantId->UserId join
            persist: {
                name: persistenceNames.PlatformProductMappings,
                retrySync: true,
                transform: persistedRecordTransform,
            },
        })
    );
    log.debug(`[SupaLegend] platformProductMappings$ configured (filtered by RLS)`);

    // OPTIMIZED: Only fetch essential image columns, disable realtime
    productImages$ = observable<Record<string, ProductImage>>(
        customSynced({
            collection: 'ProductImages',
            fieldId: 'Id',
            list: createBoundedList<ProductImage>({
                collectionName: 'ProductImages',
                select: 'Id, ProductVariantId, ImageUrl, Position',
                getObservable: () => productImages$,
            }),
            // READ-ONLY sync: media writes go through the backend boundary
            // (set_product_media), never straight from the client. Allowing write
            // actions let realtime echoes upsert rows back to Supabase, failing RLS
            // with HTTP 400 → retry storm. Same class as InventoryLevels above.
            actions: ['read'],
            realtime: false, // DISABLED: Images rarely change, reduces egress significantly
            persist: {
                name: persistenceNames.ProductImages,
                retrySync: true,
                transform: persistedRecordTransform,
            },
        })
    );
    log.debug(`[SupaLegend] productImages$ configured (realtime disabled to reduce egress)`);

    // OPTIMIZED: Essential columns only, relies on RLS to filter via ProductVariantId join
    inventoryLevels$ = observable<Record<string, InventoryLevel>>(
        customSynced({
            collection: 'InventoryLevels',
            fieldId: 'Id',
            list: createBoundedList<InventoryLevel>({
                collectionName: 'InventoryLevels',
                // PoolId and OrgId are needed for partner-shared inventory.
                select: 'Id, ProductVariantId, PlatformConnectionId, PlatformLocationId, PoolId, OrgId, Quantity, UpdatedAt',
                getObservable: () => inventoryLevels$,
            }),
            // READ-ONLY sync: the client never writes InventoryLevels (inventory is mutated
            // server-side and flows back via realtime). Allowing write actions let realtime
            // echoes upsert rows back to Supabase, failing RLS with HTTP 400 → retry storm.
            actions: ['read'],
            realtime: true, // Live updates essential for inventory (read-only mirror)
            persist: {
                name: persistenceNames.InventoryLevels,
                retrySync: true,
                transform: persistedRecordTransform,
            },
        })
    );
    log.debug(`[SupaLegend] inventoryLevels$ configured with live updates (filtered by RLS)`);

    marketplaceListings$ = observable<Record<string, MarketplaceListing>>(
        customSynced({
            collection: 'MarketplaceListings',
            fieldId: 'Id',
            list: createBoundedList<MarketplaceListing>({
                collectionName: 'MarketplaceListings',
                select: 'Id, ProductVariantId, SellerUserId, Price, AvailableQuantity, IsEnabled, CreatedAt, UpdatedAt',
                filter: (query: any) => query.eq('SellerUserId', currentUserId),
                getObservable: () => marketplaceListings$,
            }),
            actions: ['read', 'create', 'update', 'delete'],
            realtime: { filter: `SellerUserId=eq.${currentUserId}` },
            persist: {
                name: persistenceNames.MarketplaceListings,
                retrySync: true,
                transform: persistedRecordTransform,
            },
        })
    );
    log.debug(`[SupaLegend] marketplaceListings$ configured with user filter`);

    // Placeholder for PlatformLocations observable - to be implemented with actual data fetching
    const platformLocations$ = observable<Record<string, PlatformLocation>>({});
    log.debug(`[SupaLegend] platformLocations$ observable initialized (placeholder).`);

    // Activate every persisted dependency together. Legend waits for AsyncStorage
    // before starting each remote getter, so this is cache-first without chaining
    // the five network reads behind one another.
    const persistedObservables = [
        productVariants$,
        platformProductMappings$,
        productImages$,
        inventoryLevels$,
        marketplaceListings$,
    ];
    persistedObservables.forEach((observable) => observable.get());

    // The navigator's dataReady flag should mean local data is actually available,
    // not merely that observable shells were allocated. This wait is local-only;
    // remote page one continues independently after persistence has hydrated.
    await Promise.all(persistedObservables.map((observable) =>
        when(() => syncState(observable).isPersistLoaded.get()),
    ));
    log.debug('[SupaLegend][measure] all caches hydrated', {
        durationMs: Date.now() - initializationStartedAt,
        variants: Object.keys(productVariants$.get() || {}).length,
        mappings: Object.keys(platformProductMappings$.get() || {}).length,
        images: Object.keys(productImages$.get() || {}).length,
        levels: Object.keys(inventoryLevels$.get() || {}).length,
        listings: Object.keys(marketplaceListings$.get() || {}).length,
    });

    legendStateObservablesSingleton = {
        productVariants$,
        platformProductMappings$,
        productImages$,
        inventoryLevels$,
        marketplaceListings$,
        platformLocations$,
        syncProgress$,
        userId: currentUserId, // Store the userId with the initialized observables
    };

    log.debug("[SupaLegend] Observables configured for user:", currentUserId);
    return legendStateObservablesSingleton;
}

export function initializeFallbackLegendState(userId: string): LegendStateObservables {
    if (legendStateObservablesSingleton?.userId === userId && legendStateObservablesSingleton.productVariants$) {
        return legendStateObservablesSingleton;
    }

    log.warn(`[SupaLegend] Falling back to local-only Legend State for user ${userId}`);
    legendStateObservablesSingleton = buildFallbackLegendState(userId);
    return legendStateObservablesSingleton;
}

// Getter function to access observables after initialization
export function getLegendStateObservables(): LegendStateObservables {
    if (!legendStateObservablesSingleton || !legendStateObservablesSingleton.productVariants$) {
        throw new Error("[SupaLegend] Legend State or productVariants$ not initialized. Call initializeLegendState first.");
    }
    return legendStateObservablesSingleton;
}

// Derived from the generated DB schema (single source of truth).
export type PlatformProductMapping = PlatformProductMappingsRow;

// Derived from the generated DB schema (single source of truth).
export type ProductImage = ProductImagesRow;

// Derived from the generated DB schema (single source of truth). Note: this now
// includes `Version` (optimistic-concurrency column) which the hand-typed interface
// had dropped — required to do safe inventory writes.
export type InventoryLevel = InventoryLevelsRow;

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

// Derived from the generated DB schema (single source of truth).
export type PlatformConnection = PlatformConnectionsRow;

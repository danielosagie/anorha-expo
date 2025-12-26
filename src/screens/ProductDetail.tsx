import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, Switch, FlatList, Animated } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import ListingEditorForm, { ListingEditorFormRef } from '../components/ListingEditorForm';
import BottomActionBar from '../components/BottomActionBar';
import ExpoBarcodeScanner from '../components/ExpoBarcodeScanner';
import { CameraView } from 'expo-camera';
import Card from '../components/Card';
import PlaceholderImage from '../components/PlaceholderImage';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { createCanonicalBase } from '../utils/platformDataHydration';
import { hasPlatformPrice } from '../utils/platformRequirements';
import {
  ProductVariant,
  PlatformProductMapping,
  InventoryLevel,
  getLegendStateObservables,
  PlatformConnection
} from '../utils/SupaLegend';
import { observer } from '@legendapp/state/react';
import * as ImagePicker from 'expo-image-picker';
import { useCollaboration } from '../hooks/useCollaboration';
import LoadingOverlay from '../components/LoadingOverlay';
// Base URL for API
const SSSYNC_API_BASE_URL = 'https://api.sssync.app';

// Toggle to use manual save via BottomActionBar
const ENABLE_AUTOSAVE = false;

// 🚨 CRITICAL: ProductDetail should be READ-ONLY
// It should ONLY read from cached database data (Supabase + PlatformSpecificData)
// It should NEVER make platform API calls like sync-locations
// Platform syncing should only happen during import/setup, then updates via webhooks

// Enhanced interfaces
interface ProductDetailNavigationProps {
  goBack: () => void;
  navigate: (screen: string, params?: any) => void;
}

interface ProductDetailRouteProps {
  params: {
    item?: ProductVariant;
    productId?: string;
  };
}

interface ActivityLogEntry {
  Id: string;
  Timestamp: string;
  EventType: string;
  Status: string;
  Message: string;
  Details?: any;
}

interface EditFormData {
  Title: string;
  Description: string;
  Price: number;
  CompareAtPrice?: number;
  Sku: string;
  Barcode?: string;
  Weight?: number;
  WeightUnit?: string;
  RequiresShipping: boolean;
  IsTaxable: boolean;
  TaxCode?: string;
}

interface InventoryLocationWithPlatform {
  id: string;
  locationId: string;
  locationName: string;
  platformConnectionId: string;
  platformName: string;
  platformType: string;
  quantity: number;
}

interface GroupedInventoryLocations {
  [platformName: string]: {
    platformType: string;
    platformConnectionId: string;
    displayName: string;
    locations: InventoryLocationWithPlatform[];
  };
}

// SVG logo helpers
const platformSvgMap: Record<string, React.FC<any>> = {
  shopify: ShopifySvg,
  square: SquareSvg,
  clover: CloverSvg,
  amazon: AmazonSvg,
  ebay: EbaySvg,
  facebook: FacebookSvg,
};

function getPlatformLogoComponent(platformType?: string) {
  const type = (platformType || '').toLowerCase();
  const found = Object.entries(platformSvgMap).find(([key]) => type.includes(key));
  return found ? found[1] : null;
}

/**
 * CRITICAL FIX: Clean displayedPlatforms data before save to prevent cross-platform location contamination.
 * When editing on 'all' tab, inventoryByLocation gets merged across platforms.
 * This function filters each platform's variants to ONLY include locations that belong to that platform.
 */
function cleanPlatformDataForSave(displayedPlatforms: Record<string, any>): Record<string, any> {
  const cleanedData: Record<string, any> = {};

  for (const [platformKey, platformData] of Object.entries(displayedPlatforms)) {
    if (!platformData) continue;

    // Deep clone to avoid mutating original
    const cleanedPlatform = JSON.parse(JSON.stringify(platformData));

    // Get the set of valid location IDs for this platform from its locations array
    const platformLocationIds = new Set<string>();
    if (Array.isArray(cleanedPlatform.locations)) {
      cleanedPlatform.locations.forEach((loc: any) => {
        if (loc?.id) platformLocationIds.add(loc.id);
      });
    }

    // Filter variants' inventoryByLocation to only include this platform's locations
    if (Array.isArray(cleanedPlatform.variants)) {
      cleanedPlatform.variants = cleanedPlatform.variants.map((variant: any) => {
        if (!variant.inventoryByLocation) return variant;

        const filteredInventory: Record<string, any> = {};
        for (const [locId, locData] of Object.entries(variant.inventoryByLocation)) {
          // If we have a locations array, use it as source of truth
          if (platformLocationIds.size > 0) {
            if (platformLocationIds.has(locId)) {
              filteredInventory[locId] = locData;
            } else {
              console.log(`[cleanPlatformDataForSave] Filtered out location ${locId} from ${platformKey} - not in platform's locations`);
            }
          } else {
            // Fallback: Use pattern matching for platform detection
            const isShopifyLoc = locId.includes('gid://shopify/');
            const isLikelySquareLoc = /^[A-Z0-9]{8,}$/.test(locId) && !locId.includes('gid://');

            if (platformKey === 'shopify' && !isShopifyLoc && isLikelySquareLoc) {
              console.log(`[cleanPlatformDataForSave] Filtered Square location ${locId} from Shopify platform`);
              continue;
            }
            if (platformKey === 'square' && isShopifyLoc) {
              console.log(`[cleanPlatformDataForSave] Filtered Shopify location ${locId} from Square platform`);
              continue;
            }
            filteredInventory[locId] = locData;
          }
        }

        return { ...variant, inventoryByLocation: filteredInventory };
      });
    }

    cleanedData[platformKey] = cleanedPlatform;
  }

  return cleanedData;
}

const ProductDetailScreen = observer(
  ({ route, navigation }: { route: ProductDetailRouteProps; navigation: ProductDetailNavigationProps }) => {
    const theme = useTheme();
    const passedItem = route.params?.item;
    const productId = route.params?.productId || passedItem?.Id;

    // 🚨 DEBUG: Intercept all fetch calls from this component
    React.useEffect(() => {
      const originalFetch = window.fetch;
      window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = input?.toString() || '';
        if (url.includes('sync-locations')) {
          console.error('[ProductDetail] 🚨 DETECTED sync-locations call from ProductDetail:', url, init);
          // Don't actually make the call - this is forbidden in ProductDetail
          return Promise.reject(new Error('sync-locations calls are forbidden in ProductDetail'));
        }
        if (url.includes('/api/platform-connections/') && url.includes('/sync')) {
          console.warn('[ProductDetail] ⚠️ Platform sync call detected:', url);
        }
        return originalFetch.call(this, input as RequestInfo, init);
      };
      return () => {
        window.fetch = originalFetch;
      };
    }, []);

    // State management
    const [detailedItem, setDetailedItem] = useState<ProductVariant | undefined | null>(passedItem);
    const [mappings, setMappings] = useState<PlatformProductMapping[]>([]);
    const [groupedInventory, setGroupedInventory] = useState<GroupedInventoryLocations>({});
    const [connections, setConnections] = useState<PlatformConnection[]>([]);
    const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(!passedItem);

    // Modal states
    const [isActivityModalVisible, setIsActivityModalVisible] = useState(false);
    const [isBarcodeScannerVisible, setIsBarcodeScannerVisible] = useState(false);
    const [isImagePickerVisible, setIsImagePickerVisible] = useState(false);

    // Track if initial load has completed to prevent overwrites
    const hasLoadedInitialData = useRef(false);
    const [isDangerZoneVisible, setIsDangerZoneVisible] = useState(false);
    // Track when we just saved to prevent useEffect from wiping state
    // CRITICAL: Use timestamp-based blocking instead of boolean to prevent race conditions
    const justSavedTimestampRef = useRef<number>(0);
    const SAVE_BLOCK_WINDOW_MS = 5000; // Block realtime updates for 5 seconds after save (prevents self-triggered banner)

    // Helper to check if we're in the save blocking window
    const isInSaveBlockingWindow = useCallback(() => {
      const now = Date.now();
      const timeSinceSave = now - justSavedTimestampRef.current;
      const isBlocking = timeSinceSave < SAVE_BLOCK_WINDOW_MS;
      if (isBlocking) {
        console.log('[ProductDetail] In save blocking window, time since save:', timeSinceSave, 'ms');
      }
      return isBlocking;
    }, []);

    // Auto-save state (no more manual editing mode)
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaveTime, setLastSaveTime] = useState<number>(0);
    const [isUploadingImages, setIsUploadingImages] = useState(false);
    const listingEditorRef = useRef<ListingEditorFormRef | null>(null);

    // Non-blocking notification banner
    const [bannerMessage, setBannerMessage] = useState<string | null>(null);
    const bannerOpacity = useRef(new Animated.Value(0)).current;
    const bannerTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Show banner notification (auto-hides after 3 seconds)
    const showBanner = useCallback((message: string) => {
      // Clear any existing timeout
      if (bannerTimeout.current) {
        clearTimeout(bannerTimeout.current);
      }

      setBannerMessage(message);

      // Fade in
      Animated.timing(bannerOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Auto-hide after 3 seconds
      bannerTimeout.current = setTimeout(() => {
        Animated.timing(bannerOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setBannerMessage(null);
        });
      }, 3000);
    }, [bannerOpacity]);

    // Add state after existing states (around line 160, after const [isUploadingImages, setIsUploadingImages] = useState(false);)
    const [variantPricing, setVariantPricing] = useState<any[]>([]);
    // ⚡ CRITICAL: Store raw inventory levels directly from DB for hydration
    const [rawInventoryLevels, setRawInventoryLevels] = useState<InventoryLevel[]>([]);
    // ⚡ Store all variants for this product
    const [allProductVariants, setAllProductVariants] = useState<any[]>([]);
    // Ref to access allProductVariants in realtime callbacks (avoids stale closure)
    const allProductVariantsRef = useRef<any[]>([]);
    // ⚡ Store platform location names map for consistent location name resolution
    const [platformLocationNames, setPlatformLocationNames] = useState<Map<string, string>>(new Map());
    // ⚡ CRITICAL FIX: Store ALL platform locations (not just those with inventory)
    // This ensures locations without inventory still appear in the UI
    const [allPlatformLocations, setAllPlatformLocations] = useState<Array<{
      PlatformConnectionId: string;
      PlatformLocationId: string;
      Name: string | null;
    }>>([]);

    // 🟢 EXTERNAL UPDATES: Track which fields changed from external sources for green border highlighting
    const [externalUpdates, setExternalUpdates] = useState<Record<string, { value?: any; updatedAt: number }>>({});

    // Auto-clear external update highlights after 5 seconds
    useEffect(() => {
      if (Object.keys(externalUpdates).length === 0) return;

      const timer = setTimeout(() => {
        const now = Date.now();
        setExternalUpdates(prev => {
          const filtered: Record<string, { value?: any; updatedAt: number }> = {};
          for (const [key, update] of Object.entries(prev)) {
            // Keep updates that are less than 5 seconds old
            if (now - update.updatedAt < 5000) {
              filtered[key] = update;
            }
          }
          return filtered;
        });
      }, 5000);

      return () => clearTimeout(timer);
    }, [externalUpdates]);

    // Keep ref in sync with state
    useEffect(() => {
      allProductVariantsRef.current = allProductVariants;
    }, [allProductVariants]);

    // ========== CRITICAL FIX: useRef for data persistence + auto-save ==========
    const [updateCounter, setUpdateCounter] = useState(0);
    const [displayedPlatforms, setDisplayedPlatforms] = useState<Record<string, any>>({});
    const [, forceUpdate] = useState({});
    const lastHydratedItemRef = useRef<string | null>(null);
    const lastSavedRef = useRef<string>('');

    // Get displayedPlatforms from ref (for render)
    // const displayedPlatforms = platformsRef.current; // This line is removed

    const updatePlatforms = (updater: (prev: Record<string, any>) => Record<string, any>) => {
      setDisplayedPlatforms(updater);
      forceUpdate({}); // Trigger re-render
      setUpdateCounter(c => c + 1); // Signal content change
      console.log('[ProductDetail] Updated platforms, triggering auto-save...');
    };

    // Collaboration state
    const collaboration = useCollaboration();
    const [isLockedByOther, setIsLockedByOther] = useState(false);
    const [lockOwner, setLockOwner] = useState<string | null>(null);

    // Phase 2: Draft state for auto-save and versioning
    const [draftData, setDraftData] = useState<Record<string, any> | null>(null);
    const [isLoadingDraft, setIsLoadingDraft] = useState(false);
    const [draftVersions, setDraftVersions] = useState<Array<{ id: string; createdAt: string; platforms: any; publishedPlatforms?: string[] }>>([]);

    // Current form data (now live)
    const [formData, setFormData] = useState<EditFormData>({
      Title: '',
      Description: '',
      Price: 0,
      CompareAtPrice: 0,
      Sku: '',
      Barcode: '',
      Weight: 0,
      WeightUnit: 'kg',
      RequiresShipping: true,
      IsTaxable: true,
      TaxCode: '',
    });

    // State for sync status
    const [syncStatus, setSyncStatus] = useState<any>(null);
    const [fetchErrors, setFetchErrors] = useState<string[]>([]);

    // State for sync loading
    const [isSyncing, setIsSyncing] = useState(false);

    // Helper function to get proper location names from platform data
    const getLocationName = useCallback((level: InventoryLevel, connection: PlatformConnection, mapping?: PlatformProductMapping): string => {
      // Try to get location name from mapping's platform-specific data
      if (mapping?.PlatformSpecificData && typeof mapping.PlatformSpecificData === 'object') {
        const mappingData = mapping.PlatformSpecificData as any;
        if (mappingData.locationName) {
          return mappingData.locationName;
        }
      }

      // Try to get location name from connection's platform-specific data
      if (connection.PlatformSpecificData && typeof connection.PlatformSpecificData === 'object') {
        const connectionData = connection.PlatformSpecificData as any;
        if (connectionData.locations && Array.isArray(connectionData.locations)) {
          const location = connectionData.locations.find((loc: any) =>
            loc.id === level.PlatformLocationId || loc.gid === level.PlatformLocationId
          );
          if (location?.name) {
            return location.name;
          }
        }
      }

      // Default based on platform type and location ID
      const platformType = connection.PlatformType?.toLowerCase() || '';
      if (platformType.includes('shopify')) {
        return level.PlatformLocationId === 'gid://shopify/Location/1' ? 'Main Location' :
          `Location ${level.PlatformLocationId?.split('/').pop() || ''}`;
      } else if (platformType.includes('square')) {
        return 'Main Location';
      } else if (platformType.includes('clover')) {
        return 'Main Location';
      }

      return `Location ${level.PlatformLocationId || 'Unknown'}`;
    }, []);

    // Load platform connections and organize inventory with realtime updates
    const loadPlatformData = useCallback(async () => {
      if (!detailedItem) return;

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        console.log('[ProductDetail] Loading platform data for variant:', detailedItem.Id, 'ProductId:', detailedItem.ProductId);

        // Load all platform connections for the user
        const { data: connectionsData, error: connectionsError } = await supabase
          .from('PlatformConnections')
          .select('*')
          .eq('UserId', user.id)
          .eq('IsEnabled', true);

        if (connectionsError) {
          console.error('Error loading platform connections:', connectionsError);
          return;
        }

        const platformConnections = connectionsData as PlatformConnection[];
        console.log('[ProductDetail] Loaded platform connections:', platformConnections.length);

        setConnections(platformConnections);

        // ⚡ CRITICAL FIX: Load ALL variants for this product to aggregate inventory
        // If viewing a base variant, inventory is stored against option variants
        // Include Price, Options, Title for proper variant hydration
        const { data: allProductVariantsData, error: variantsError } = await supabase
          .from('ProductVariants')
          .select('Id, Sku, VariantType, Price, CompareAtPrice, Options, Title, Barcode')
          .eq('ProductId', detailedItem.ProductId);

        if (variantsError) {
          console.error('[ProductDetail] Error loading product variants:', variantsError);
        }

        const allVariantIds = allProductVariantsData?.map(v => v.Id) || [detailedItem.Id];
        console.log('[ProductDetail] Found', allVariantIds.length, 'variants for product');

        // Load inventory levels for ALL variants of this product (base + options)
        const { data: inventoryData, error: inventoryError } = await supabase
          .from('InventoryLevels')
          .select('*')
          .in('ProductVariantId', allVariantIds);

        if (inventoryError) {
          console.error('Error loading inventory levels:', inventoryError);
        } else {
          console.log('[ProductDetail] Loaded inventory levels:', inventoryData?.length || 0, 'for', allVariantIds.length, 'variants');
          // ⚡ CRITICAL: Store raw inventory levels for displayedPlatforms hydration
          setRawInventoryLevels((inventoryData as InventoryLevel[]) || []);
        }

        // ⚡ Store all variants for hydration
        if (allProductVariantsData) {
          console.log('[ProductDetail] Storing', allProductVariantsData.length, 'variants in state for hydration');
          setAllProductVariants(allProductVariantsData);
        }

        // ⚡ Load locations from PlatformLocations table - build a lookup map for fast access
        const connectionIds = platformConnections.map(c => c.Id);
        const locationNameMap = new Map<string, string>(); // locationId -> name

        if (connectionIds.length > 0) {
          const { data: platformLocs, error: locError } = await supabase
            .from('PlatformLocations')
            .select('PlatformConnectionId, PlatformLocationId, Name')
            .in('PlatformConnectionId', connectionIds);

          if (locError) {
            console.error('Error loading platform locations:', locError);
          } else {
            platformLocs?.forEach(loc => {
              // Store by both full ID and just the location ID for flexible lookup
              locationNameMap.set(loc.PlatformLocationId, loc.Name || 'Unnamed Location');
              locationNameMap.set(`${loc.PlatformConnectionId}-${loc.PlatformLocationId}`, loc.Name || 'Unnamed Location');
            });
            console.log('[ProductDetail] ✅ Loaded', platformLocs?.length || 0, 'location names from DB');
            // ⚡ Store in state for access by buildPlatformLocations
            setPlatformLocationNames(new Map(locationNameMap));
            // ⚡ CRITICAL FIX: Also store full location records for building locations list
            setAllPlatformLocations(platformLocs || []);
          }
        }

        // Load platform mappings for ALL variants
        const { data: mappingsData, error: mappingsError } = await supabase
          .from('PlatformProductMappings')
          .select('*')
          .in('ProductVariantId', allVariantIds);

        if (mappingsError) {
          console.error('Error loading platform mappings:', mappingsError);
        } else {
          console.log('[ProductDetail] Loaded platform mappings:', mappingsData?.length || 0);
        }

        setMappings(mappingsData as PlatformProductMapping[] || []);

        // Group inventory by platform with proper names from DB
        const grouped: GroupedInventoryLocations = {};

        // Helper to get location name - use DB lookup first
        const getLocationNameFromDB = (locationId: string, connectionId: string): string => {
          // Try full key first
          const fullKey = `${connectionId}-${locationId}`;
          if (locationNameMap.has(fullKey)) {
            return locationNameMap.get(fullKey)!;
          }
          // Try just location ID
          if (locationNameMap.has(locationId)) {
            return locationNameMap.get(locationId)!;
          }

          // CRITICAL FIX: Better fallback handling for platform-specific location IDs
          // Shopify location IDs are GIDs like "gid://shopify/Location/12345"
          if (locationId?.includes('gid://shopify/Location/')) {
            const locNumber = locationId.split('/').pop();
            return `Shopify Location #${locNumber}`;
          }

          // Square location IDs are alphanumeric like "LY3ETP80S0CFK"
          // These should have been synced to PlatformLocations - log warning if not found
          if (locationId && locationId.length >= 10 && /^[A-Z0-9]+$/.test(locationId)) {
            console.warn(`[ProductDetail] Square location ${locationId} not found in PlatformLocations. May need to re-sync locations.`);
            return `Square Location (${locationId.substring(0, 6)}...)`;
          }

          // Generic fallback
          if (locationId === 'default') {
            return 'Default Location';
          }

          // Show truncated ID if nothing else works
          if (locationId && locationId.length > 10) {
            return `Location (${locationId.substring(0, 8)}...)`;
          }

          return locationId || 'Main Location';
        };

        // If we have inventory data, group it
        if (inventoryData && inventoryData.length > 0) {
          inventoryData.forEach((level: InventoryLevel) => {
            const connection = platformConnections.find(conn => conn.Id === level.PlatformConnectionId);
            if (!connection) {
              console.warn('[ProductDetail] No connection found for inventory level:', level.PlatformConnectionId);
              return;
            }

            // Use DisplayName first, then fall back to a constructed name
            const platformName = connection.DisplayName || `${connection.PlatformType} Account`;
            // Use DB lookup for location name
            const locationName = getLocationNameFromDB(level.PlatformLocationId || 'default', level.PlatformConnectionId);

            if (!grouped[platformName]) {
              grouped[platformName] = {
                platformType: connection.PlatformType,
                platformConnectionId: connection.Id,
                displayName: platformName,
                locations: []
              };
            }

            // Check if this location already exists (aggregate quantities)
            const existingLocation = grouped[platformName].locations.find(
              loc => loc.locationId === level.PlatformLocationId
            );

            if (existingLocation) {
              // Aggregate quantity for same location (from different option variants)
              existingLocation.quantity += (level.Quantity || 0);
              console.log(`[ProductDetail] Aggregated inventory for ${locationName}: now ${existingLocation.quantity}`);
            } else {
              grouped[platformName].locations.push({
                id: level.Id || `${level.PlatformConnectionId}-${level.PlatformLocationId}`,
                locationId: level.PlatformLocationId || 'default',
                locationName,
                platformConnectionId: level.PlatformConnectionId,
                platformName,
                platformType: connection.PlatformType,
                quantity: level.Quantity || 0
              });
            }
          });
        } else {
          // If no inventory data, still show connected platforms with zero inventory
          platformConnections.forEach(connection => {
            const mapping = mappingsData?.find(m => m.PlatformConnectionId === connection.Id);
            if (mapping) { // Only show platforms that have mappings for this product
              const platformName = connection.DisplayName || `${connection.PlatformType} Account`;
              grouped[platformName] = {
                platformType: connection.PlatformType,
                platformConnectionId: connection.Id,
                displayName: platformName,
                locations: [{
                  id: `${connection.Id}-default`,
                  locationId: 'default',
                  locationName: 'Main Location',
                  platformConnectionId: connection.Id,
                  platformName,
                  platformType: connection.PlatformType,
                  quantity: 0
                }]
              };
            }
          });
        }

        console.log('[ProductDetail] Grouped inventory:', Object.keys(grouped).length, 'platforms');
        Object.entries(grouped).forEach(([platform, data]) => {
          console.log(`[ProductDetail]   ${platform}: ${data.locations.length} locations, total qty: ${data.locations.reduce((sum, l) => sum + l.quantity, 0)}`);
        });
        setGroupedInventory(grouped);

        // Store mappings for hydration useEffect
        setMappings(mappingsData as PlatformProductMapping[] || []);

      } catch (error) {
        console.error('Error loading platform data:', error);
      }
    }, [detailedItem]);

    // Load additional product details (images, tags, variants, etc.) - consolidated like PastScansScreen
    const loadProductDetails = useCallback(async () => {
      if (!detailedItem) return;

      // Don't overwrite if user has unsaved changes
      if (hasUnsavedChanges) {
        console.log('[ProductDetail] Skipping reload - user has unsaved changes');
        return;
      }

      try {
        console.log('[ProductDetail] Loading consolidated product details for variant:', detailedItem.Id);

        // Load full product with all variants, tags, and images
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // First, load the current variant and its related product
        const { data: variantData, error: variantError } = await supabase
          .from('ProductVariants')
          .select(`
            Id,
            ProductId,
            Title,
            Description,
            Price,
            CompareAtPrice,
            Sku,
            Barcode,
            Weight,
            WeightUnit,
            Options,
            Metadata,
            IsTaxable,
            RequiresShipping,
            TaxCode,
            Tags,
            OnShopify,
            OnSquare,
            OnClover,
            OnAmazon,
            OnEbay,
            OnFacebook,
            PrimaryImageUrl,
            CreatedAt,
            UpdatedAt,
            ProductImages!ProductImages_ProductVariantId_fkey (
              Id,
              ImageUrl,
              AltText,
              Position
            )
          `)
          .eq('Id', detailedItem.Id)
          .single();

        if (variantError) {
          console.error('[ProductDetail] Error loading variant details:', variantError);
          return;
        }

        if (!variantData) {
          console.warn('[ProductDetail] No variant data found');
          return;
        }

        const variant = variantData;
        const sortedImages = variant.ProductImages
          ?.sort((a: any, b: any) => (a.Position || 0) - (b.Position || 0))
          ?.map((img: any) => img.ImageUrl) || [];

        console.log('[ProductDetail] Loaded variant with', sortedImages.length, 'images, options:', variant.Options, 'tags:', variant.Tags);

        // Now load ALL variants for this product
        const { data: allVariants, error: allVariantsError } = await supabase
          .from('ProductVariants')
          .select(`
            Id,
            Sku,
            Title,
            Price,
            Options,
            ProductImages!ProductImages_ProductVariantId_fkey (
              ImageUrl,
              Position
            )
          `)
          .eq('ProductId', variant.ProductId)
          .order('CreatedAt', { ascending: true });

        if (allVariantsError) {
          console.warn('[ProductDetail] Error loading all variants:', allVariantsError);
        } else {
          console.log('[ProductDetail] Loaded all variants for product:', allVariants?.length || 0);
        }



        // ⚡ NOTE: VariantPricing table no longer exists - pricing is stored in InventoryLevels.Price
        // Variants and inventory are loaded in loadPlatformData() instead
        console.log('[ProductDetail] Variants loaded via loadPlatformData, not VariantPricing table');

        // Update detailedItem with full data
        const enrichedItem = {
          ...detailedItem,
          ...variant,
          ImageUrls: sortedImages,
          // Include all the fields we need
          Options: variant.Options || {},
          Metadata: variant.Metadata || {},
          Tags: variant.Tags || [],
          IsTaxable: variant.IsTaxable,
          RequiresShipping: variant.RequiresShipping,
          TaxCode: variant.TaxCode,
          PrimaryImageUrl: variant.PrimaryImageUrl,
        };

        setDetailedItem(enrichedItem);

        // Update form data with all available fields
        setFormData({
          Title: enrichedItem.Title || '',
          Description: enrichedItem.Description || '',
          Price: enrichedItem.Price || 0,
          CompareAtPrice: enrichedItem.CompareAtPrice || 0,
          Sku: enrichedItem.Sku || '',
          Barcode: enrichedItem.Barcode || '',
          Weight: enrichedItem.Weight || 0,
          WeightUnit: enrichedItem.WeightUnit || 'kg',
          RequiresShipping: enrichedItem.RequiresShipping !== false,
          IsTaxable: enrichedItem.IsTaxable !== false,
          TaxCode: enrichedItem.TaxCode || '',
        });

        // Build variants array for display (includes all variants from product)
        const displayVariants = (allVariants || []).map((v: any) => ({
          id: v.Id,
          sku: v.Sku,
          title: v.Title,
          price: v.Price,
          optionValues: v.Options || {},
          inventoryByLocation: {} // Will be populated by inventory loading
        }));

        console.log('[ProductDetail] Built display variants:', displayVariants.length);

      } catch (error) {
        console.error('[ProductDetail] Error in loadProductDetails:', error);
      }
    }, [detailedItem]);

    // Helper to build platform locations from connections
    const buildPlatformLocations = useCallback(() => {
      // ⚡ CRITICAL FIX: Start with ALL platform locations from PlatformLocations table
      // Not just those with inventory records - this ensures new locations show up immediately
      const locsByPlatform: Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string; platformType: string }>> = {};

      // Build from allPlatformLocations which contains ALL locations for all connections
      // This is the source of truth for which locations exist
      allPlatformLocations.forEach(loc => {
        const connection = connections.find(c => c.Id === loc.PlatformConnectionId);
        if (!connection) {
          console.warn('[ProductDetail] No connection found for location:', loc.PlatformConnectionId);
          return;
        }

        const platform = connection.PlatformType?.toLowerCase();
        if (!platform) return;

        if (!locsByPlatform[platform]) locsByPlatform[platform] = [];

        const locationId = loc.PlatformLocationId;

        // STRICT FILTERING: Prevent cross-contamination of locations
        if (platform === 'shopify') {
          // Shopify IDs are either numeric string or GID
          const isLikeSquare = /^[A-Z0-9]{8,}$/.test(locationId) && !/^\d+$/.test(locationId);
          if (isLikeSquare) {
            console.warn(`[ProductDetail] Filtered out likely-Square location from Shopify list: ${locationId}`);
            return;
          }
        } else if (platform === 'square') {
          // Square IDs shouldn't look like Shopify GIDs
          if (locationId.includes('gid://shopify/')) {
            console.warn(`[ProductDetail] Filtered out likely-Shopify location from Square list: ${locationId}`);
            return;
          }
        }

        // Check if already exists
        const exists = locsByPlatform[platform].some(l => l.id === locationId);
        if (!exists) {
          // Get name from stored location name map first, then fallback
          const fullKey = `${loc.PlatformConnectionId}-${locationId}`;
          let name = loc.Name || platformLocationNames.get(fullKey) || platformLocationNames.get(locationId) || 'Unnamed Location';

          // Clean up generic fallback names
          if (name === 'Unnamed Location' || name.includes('...')) {
            if (locationId?.includes('gid://shopify/Location/')) {
              const locNumber = locationId.split('/').pop();
              name = `#${locNumber}`;
            } else if (locationId && locationId.length >= 10 && /^[A-Z0-9]+$/.test(locationId)) {
              name = `(${locationId.substring(0, 6)}...)`;
            }
          }

          const connectionName = connection.DisplayName || `${connection.PlatformType} Account`;

          locsByPlatform[platform].push({
            id: locationId,
            name,
            connectionId: loc.PlatformConnectionId,
            connectionName,
            platformType: platform
          });
        }
      });

      // Also add any locations from groupedInventory that might not be in allPlatformLocations
      // (edge case: inventory exists but location sync hasn't happened yet)
      // CRITICAL: Apply STRICT platform ID filtering here too!
      Object.values(groupedInventory).forEach(platformGroup => {
        const platform = platformGroup.platformType?.toLowerCase();
        if (!platform) return;

        if (!locsByPlatform[platform]) locsByPlatform[platform] = [];

        platformGroup.locations.forEach(loc => {
          const locationId = loc.locationId || '';

          // STRICT FILTERING - Same as primary loop
          if (platform === 'shopify') {
            const isLikeSquare = /^[A-Z0-9]{8,}$/.test(locationId) && !/^\d+$/.test(locationId);
            if (isLikeSquare) {
              console.warn(`[ProductDetail] Fallback: Filtered out likely-Square location from Shopify: ${locationId}`);
              return;
            }
          } else if (platform === 'square') {
            if (locationId.includes('gid://shopify/')) {
              console.warn(`[ProductDetail] Fallback: Filtered out likely-Shopify location from Square: ${locationId}`);
              return;
            }
          }

          const exists = locsByPlatform[platform].some(l => l.id === locationId);
          if (!exists) {
            console.log('[ProductDetail] Adding location from inventory that was missing from PlatformLocations:', locationId);
            locsByPlatform[platform].push({
              id: locationId,
              name: loc.locationName,
              connectionId: loc.platformConnectionId,
              connectionName: platformGroup.displayName,
              platformType: platform
            });
          }
        });
      });

      console.log('[ProductDetail] buildPlatformLocations result:',
        Object.entries(locsByPlatform).map(([p, locs]) => `${p}: ${locs.length} locations`).join(', '));

      return locsByPlatform;
    }, [allPlatformLocations, connections, groupedInventory, platformLocationNames]);

    // Auto-save function with proper API call
    // Note: Pricing validation is flexible - either flat price OR all variants have prices
    // This allows: Shopify with variants at different prices, Square with flat price, etc.
    const performAutoSave = useCallback(async () => {
      if (!detailedItem || !hasUnsavedChanges) {
        console.log('[ProductDetail] Skipping auto-save: no item or no changes');
        return;
      }

      console.log('[ProductDetail] ========== SAVE START ==========');
      console.log('[ProductDetail] detailedItem BEFORE save:', JSON.stringify(detailedItem, null, 2).slice(0, 500));
      console.log('[ProductDetail] displayedPlatforms BEFORE save:', JSON.stringify(displayedPlatforms, null, 2).slice(0, 500));
      console.log('[ProductDetail] Starting auto-save for product:', detailedItem.Id);
      setIsSaving(true);
      try {
        const token = await ensureSupabaseJwt();

        if (!token) {
          console.error('No authentication token available');
          return;
        }

        // CRITICAL FIX: Use displayedPlatforms data from ListingEditorForm, not just formData
        // Extract canonical data from shopify platform (or first available)
        const canonicalKey = Object.keys(displayedPlatforms).includes('shopify') ? 'shopify' : Object.keys(displayedPlatforms)[0];
        const canonical = displayedPlatforms[canonicalKey] || {};

        // Prepare update data - using the correct API structure from the backend
        // CRITICAL FIX: Clean platform data to remove cross-platform location contamination
        const cleanedPlatformData = cleanPlatformDataForSave(displayedPlatforms);

        const updateData = {
          Title: canonical.title || formData.Title,
          Description: canonical.description || formData.Description,
          Price: canonical.price !== undefined ? Number(canonical.price) : formData.Price,
          CompareAtPrice: canonical.compareAtPrice !== undefined ? Number(canonical.compareAtPrice) : formData.CompareAtPrice,
          Sku: canonical.sku || formData.Sku,
          Barcode: canonical.barcode || formData.Barcode,
          Weight: canonical.weight !== undefined ? Number(canonical.weight) : formData.Weight,
          WeightUnit: canonical.weightUnit || formData.WeightUnit,
          RequiresShipping: canonical.requiresShipping !== undefined ? canonical.requiresShipping : formData.RequiresShipping,
          IsTaxable: formData.IsTaxable,
          TaxCode: formData.TaxCode,
          // IMPORTANT: Include CLEANED platform-specific data (variants, options, tags, etc)
          // This prevents cross-platform location contamination from 'all' tab edits
          PlatformSpecificData: cleanedPlatformData,
          Tags: canonical.tags || [],
          Vendor: canonical.vendor,
          ProductType: canonical.productType,
        };

        console.log('Auto-saving product with full platform data:', detailedItem.Id, updateData);

        // Update in our API
        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
          throw new Error(errorData.message || `Failed to update product. Status: ${response.status}`);
        }

        // ✅ Platform syncing is handled automatically by the backend via syncCoordinatorService
        // The PUT /api/products/:id endpoint automatically enqueues platform sync jobs
        // No manual platform push needed - backend handles it in the background
        console.log('[ProductDetail] Product updated successfully. Platform sync will happen automatically in the background.');

        // Do NOT update Supabase directly - the real-time subscription will handle it
        // The backend automatically triggers updates via database triggers

        // Update local state
        // ✅ CRITICAL FIX: Set timestamp BEFORE updating state to prevent realtime from overwriting during save
        // Using timestamp-based blocking (2 second window) instead of boolean to prevent race conditions
        justSavedTimestampRef.current = Date.now();
        console.log('[ProductDetail] Set save blocking timestamp:', justSavedTimestampRef.current);

        console.log('[ProductDetail] updateData being set:', JSON.stringify(updateData, null, 2).slice(0, 500));
        console.log('[ProductDetail] displayedPlatforms being set:', JSON.stringify(displayedPlatforms, null, 2).slice(0, 500));

        // ✅ CRITICAL FIX: Use a function to merge state properly
        // This prevents losing data like ImageUrls, Options, Metadata that aren't in updateData
        setDetailedItem(prev => {
          console.log('[ProductDetail] setDetailedItem called with prev:', JSON.stringify(prev, null, 2).slice(0, 300));
          if (!prev) return prev;
          const merged = {
            ...prev,              // ← Keep ALL existing fields (ImageUrls, Options, Metadata, etc.)
            ...updateData,        // ← Override only the fields that changed
            PlatformSpecificData: displayedPlatforms,  // ← Ensure platform data is updated
          };
          console.log('[ProductDetail] setDetailedItem merged result:', JSON.stringify(merged, null, 2).slice(0, 300));
          return merged;
        });

        setHasUnsavedChanges(false);
        setLastSaveTime(Date.now());

        // CRITICAL FIX: Clear draft data after successful save
        // This fixes the "Changes not published" message persisting
        setDraftData(null);

        console.log('[ProductDetail] ========== SAVE END ==========');

      } catch (error) {
        console.error('Auto-save failed:', error);
        // Don't show alert for auto-save failures, just log them
      } finally {
        setIsSaving(false);
      }
    }, [detailedItem, formData, hasUnsavedChanges, displayedPlatforms]);

    // Handle form changes with auto-save
    const handleFormChange = useCallback((field: keyof EditFormData, value: any) => {
      setDetailedItem(prev => {
        if (!prev) return prev;
        const updated = { ...prev, [field]: value } as ProductVariant;
        setHasUnsavedChanges(true);
        return updated;
      });
    }, []);

    // Update inventory quantity with auto-save using the correct API endpoint
    const updateInventoryQuantity = useCallback(async (
      platformConnectionId: string,
      locationId: string,
      quantity: number
    ) => {
      try {
        const token = await ensureSupabaseJwt();

        if (!token || !detailedItem) return;

        // Use the correct API structure from the backend
        const updateData = {
          updates: [{
            platformConnectionId,
            locationId,
            quantity,
          }]
        };

        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}/inventory`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(updateData),
        });

        if (!response.ok) {
          throw new Error(`Failed to update inventory: ${response.status}`);
        }

        // Update local state immediately
        setGroupedInventory(prev => {
          const updated = { ...prev };
          Object.keys(updated).forEach(platformName => {
            const platform = updated[platformName];
            if (platform.platformConnectionId === platformConnectionId) {
              platform.locations = platform.locations.map(loc =>
                loc.locationId === locationId ? { ...loc, quantity } : loc
              );
            }
          });
          return updated;
        });

        console.log('Inventory updated successfully');

      } catch (error) {
        console.error('Failed to update inventory:', error);
        Alert.alert('Error', 'Failed to update inventory. Please try again.');
      }
    }, [detailedItem]);

    // Image management functions
    const pickImagesFromLibrary = async () => {
      try {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Required', 'Please grant camera roll permissions to add images.');
          return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsMultipleSelection: true,
          quality: 0.8,
          aspect: [1, 1],
        });

        if (!result.canceled && result.assets) {
          setIsUploadingImages(true);
          const uploadedUrls = await uploadImagesToSupabase(result.assets);
          await addImagesToProduct(uploadedUrls);
          setIsUploadingImages(false);
        }
      } catch (error) {
        console.error('Error picking images:', error);
        setIsUploadingImages(false);
        Alert.alert('Error', 'Failed to pick images. Please try again.');
      }
    };

    const uploadImagesToSupabase = async (assets: ImagePicker.ImagePickerAsset[]): Promise<string[]> => {
      const uploadedUrls: string[] = [];

      for (const asset of assets) {
        try {
          const response = await fetch(asset.uri);
          const blob = await response.blob();

          const fileExt = asset.uri.split('.').pop() || 'jpg';
          const fileName = `${detailedItem?.Id}-${Date.now()}.${fileExt}`;
          const filePath = `product-images/${fileName}`;

          const { data, error } = await supabase.storage
            .from('product-media')
            .upload(filePath, blob);

          if (error) {
            console.error('Upload error:', error);
            continue;
          }

          const { data: publicUrlData } = supabase.storage
            .from('product-media')
            .getPublicUrl(filePath);

          uploadedUrls.push(publicUrlData.publicUrl);
        } catch (error) {
          console.error('Error uploading image:', error);
        }
      }

      return uploadedUrls;
    };

    const addImagesToProduct = async (imageUrls: string[]) => {
      if (!detailedItem || imageUrls.length === 0) return;

      try {
        const currentImages = detailedItem.ImageUrls || [];
        const updatedImages = [...currentImages, ...imageUrls];

        const updateData = { ImageUrls: updatedImages };

        // Update via API
        const token = await ensureSupabaseJwt();

        if (token) {
          const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
          });

          if (!response.ok) {
            throw new Error('Failed to update product images');
          }
        }

        // Update local state
        setDetailedItem(prev => prev ? { ...prev, ImageUrls: updatedImages } : prev);

        Alert.alert('Success', `Added ${imageUrls.length} image(s) to product`);
      } catch (error) {
        console.error('Error adding images to product:', error);
        Alert.alert('Error', 'Failed to add images to product. Please try again.');
      }
    };

    const removeImage = async (imageIndex: number) => {
      if (!detailedItem || !detailedItem.ImageUrls) return;

      try {
        const updatedImages = detailedItem.ImageUrls.filter((_, index) => index !== imageIndex);
        const updateData = { ImageUrls: updatedImages };

        // Update via API
        const session = await supabase.auth.getSession();
        const token = session?.data.session?.access_token;

        if (token) {
          const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
          });

          if (!response.ok) {
            throw new Error('Failed to update product images');
          }
        }

        // Update local state
        setDetailedItem(prev => prev ? { ...prev, ImageUrls: updatedImages } : prev);

        Alert.alert('Success', 'Image removed from product');
      } catch (error) {
        console.error('Error removing image:', error);
        Alert.alert('Error', 'Failed to remove image. Please try again.');
      }
    };

    const reorderImages = async (nextImageUrls: string[]) => {
      if (!detailedItem) return;
      try {
        const session = await supabase.auth.getSession();
        const token = session?.data.session?.access_token;
        const updateData = { ImageUrls: nextImageUrls };
        if (token) {
          const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}`, {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(updateData),
          });
          if (!response.ok) throw new Error('Failed to reorder images');
        }
        setDetailedItem(prev => prev ? { ...prev, ImageUrls: nextImageUrls } : prev);
        setHasUnsavedChanges(false);
      } catch (error) {
        console.error('Error reordering images:', error);
      }
    };

    // In the delete handler
    const handleDelete = () => {
      Alert.alert(
        'Confirm Delete',
        'This action cannot be undone. Do you want to archive or hard delete?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Archive', onPress: () => archiveProduct() },
          { text: 'Hard Delete', style: 'destructive', onPress: () => hardDeleteProduct() },
        ]
      );
    };

    // Add functions
    const archiveProduct = async () => {
      if (!detailedItem?.Id) return;
      try {
        const token = await ensureSupabaseJwt();
        await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}/archive`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        navigation.goBack();
      } catch (error) {
        // handle
      }
    };

    const hardDeleteProduct = async () => {
      // similar for delete
    };

    // Load initial data
    useEffect(() => {
      if (!productId) {
        console.error('No Product ID found');
        setIsLoading(false);
        setDetailedItem(null);
        return;
      }

      const observables = getLegendStateObservables();
      if (!observables?.productVariants$) {
        console.error("[ProductDetailScreen] Legend-State observables not available.");
        setIsLoading(false);
        setDetailedItem(null);
        return;
      }

      const { productVariants$ } = observables;
      const itemData = productVariants$[productId].get();

      if (itemData) {
        setDetailedItem(itemData);
        setFormData({
          Title: itemData.Title || '',
          Description: itemData.Description || '',
          Price: itemData.Price || 0,
          CompareAtPrice: itemData.CompareAtPrice || 0,
          Sku: itemData.Sku || '',
          Barcode: itemData.Barcode || '',
          Weight: itemData.Weight || 0,
          WeightUnit: itemData.WeightUnit || 'kg',
          RequiresShipping: itemData.RequiresShipping !== false,
          IsTaxable: itemData.IsTaxable !== false,
          TaxCode: itemData.TaxCode || '',
        });
        setIsLoading(false);
      } else if (!passedItem && productId) {
        // Fallback: Fetch from Supabase if not in local state
        setIsLoading(true);
        supabase
          .from('ProductVariants')
          .select('*')
          .eq('Id', productId)
          .maybeSingle()  // Use maybeSingle to avoid error when product doesn't exist
          .then(({ data, error }) => {
            if (data) {
              console.log('[ProductDetail] Fetched item from Supabase:', data.Id);
              setDetailedItem(data);
              setFormData({
                Title: data.Title || '',
                Description: data.Description || '',
                Price: data.Price || 0,
                CompareAtPrice: data.CompareAtPrice || 0,
                Sku: data.Sku || '',
                Barcode: data.Barcode || '',
                Weight: data.Weight || 0,
                WeightUnit: data.WeightUnit || 'kg',
                RequiresShipping: data.RequiresShipping !== false,
                IsTaxable: data.IsTaxable !== false,
                TaxCode: data.TaxCode || '',
              });
            } else if (error) {
              console.error('[ProductDetail] Database error fetching item:', error);
              setDetailedItem(null);
              Alert.alert('Error', 'Failed to load product details. Please try again.');
            } else {
              // No data and no error means product doesn't exist
              console.warn('[ProductDetail] Product not found with ID:', productId);
              setDetailedItem(null);
              Alert.alert('Product Not Found', 'This product may still be syncing or no longer exists.');
            }
            setIsLoading(false);
          });
      }
    }, [productId, passedItem]);

    // Load platform data when product is available - ONLY ONCE
    useEffect(() => {
      if (detailedItem && !hasLoadedInitialData.current) {
        console.log('[ProductDetail] Loading data for product:', detailedItem.Id);
        loadPlatformData();
        loadProductDetails(); // Load additional product data
        hasLoadedInitialData.current = true;
      }
    }, [detailedItem?.Id]); // Only depend on item ID to prevent loops

    // Helper: Hydrate inventory data from InventoryLevels into variant structure
    // ⚡ CRITICAL FIX: Use ProductVariants directly, not VariantPricing (which doesn't exist)
    const hydrateInventoryFromDB = useCallback((variants: any[], invLevels: InventoryLevel[]): any[] => {
      if (!variants || variants.length === 0) {
        console.log('[ProductDetail] hydrateInventoryFromDB: No variants to hydrate');
        return [];
      }
      if (!invLevels || invLevels.length === 0) {
        console.log('[ProductDetail] hydrateInventoryFromDB: No inventory levels, returning variants without inventory');
      }

      console.log('[ProductDetail] hydrateInventoryFromDB: Hydrating', variants.length, 'variants with', invLevels?.length || 0, 'inventory levels');

      return variants.map((v: any) => {
        const inventoryByLocation: Record<string, any> = {};

        // Find inventory levels for THIS variant specifically
        const variantInventory = invLevels?.filter(level => level.ProductVariantId === v.Id) || [];

        // Map InventoryLevels to inventoryByLocation format
        variantInventory.forEach((level: InventoryLevel) => {
          const locId = level.PlatformLocationId || 'default';
          inventoryByLocation[locId] = {
            quantity: level.Quantity || 0,
            price: level.Price || undefined,
            compareAtPrice: level.CompareAtPrice || undefined,
          };
        });

        console.log('[ProductDetail] Hydrated variant', v.Sku || v.Id, 'with', Object.keys(inventoryByLocation).length, 'locations, total qty:',
          Object.values(inventoryByLocation).reduce((sum: number, loc: any) => sum + (loc.quantity || 0), 0));

        // Build optionValues from Options object
        const optionValues = v.Options && typeof v.Options === 'object' ? v.Options : {};

        return {
          id: v.Id,
          optionValues,
          price: v.Price,
          compareAtPrice: v.CompareAtPrice,
          sku: v.Sku,
          barcode: v.Barcode,
          title: v.Title,
          inventoryByLocation,
        };
      });
    }, []);

    // ⚡ Track if we've done displayedPlatforms hydration for this product
    // Also track last inventory count to allow re-hydration when inventory arrives later
    const hasHydratedPlatformsRef = useRef<string | null>(null);
    const lastHydratedInventoryCountRef = useRef<number>(0);
    const lastLocationNamesCountRef = useRef<number>(0);

    // Populate form fields from detailedItem when it loads
    useEffect(() => {
      if (!detailedItem) return;

      // CRITICAL: Skip this effect if we just saved - prevents wiping displayedPlatforms
      // The save already updated displayedPlatforms correctly, no need to re-derive from metadata
      // Using timestamp-based blocking to prevent race conditions (2 second window)
      if (isInSaveBlockingWindow()) {
        console.log('[ProductDetail] Skipping useEffect - in save blocking window, preserving displayedPlatforms');
        return; // Don't reset anything - let the blocking window expire naturally
      }

      // ⚡ CRITICAL FIX: Only hydrate displayedPlatforms ONCE per product
      // After initial hydration, only user edits should modify displayedPlatforms
      // We check and set the ref IMMEDIATELY to prevent race conditions
      // Allow re-hydration if new inventory data arrives after first pass OR if location names change
      const currentInventoryCount = rawInventoryLevels?.length || 0;
      const currentLocationNamesCount = platformLocationNames.size;
      const alreadyHydrated = hasHydratedPlatformsRef.current === detailedItem.Id;
      const inventoryChanged = currentInventoryCount !== lastHydratedInventoryCountRef.current;
      const locationNamesChanged = currentLocationNamesCount > 0 && lastLocationNamesCountRef.current !== currentLocationNamesCount;

      if (alreadyHydrated && !inventoryChanged && !locationNamesChanged) {
        console.log('[ProductDetail] ⚠️ Already hydrated for product', detailedItem.Id, '- skipping to preserve data');
        return; // Exit early - don't even update formData again
      }

      // Track location names count for change detection
      lastLocationNamesCountRef.current = currentLocationNamesCount;

      // ⚡ Don't hydrate until data is actually loaded
      // This prevents hydrating with empty data on first render before loadPlatformData completes
      const hasVariantData = allProductVariants && allProductVariants.length > 0;
      const hasInventoryData = rawInventoryLevels && rawInventoryLevels.length > 0;

      // Wait for at least variant data before hydrating (inventory might be legitimately empty)
      if (!hasVariantData) {
        console.log('[ProductDetail] Waiting for variant data before hydrating displayedPlatforms');
        return;
      }

      console.log('[ProductDetail] Data ready for hydration - variants:', allProductVariants?.length, 'inventory:', rawInventoryLevels?.length);

      // Populate formData
      setFormData(prev => ({
        ...prev,
        Title: detailedItem.Title || '',
        Description: detailedItem.Description || '',
        Price: detailedItem.Price ? Number(detailedItem.Price) : 0,
        CompareAtPrice: detailedItem.CompareAtPrice ? Number(detailedItem.CompareAtPrice) : undefined,
        Sku: detailedItem.Sku || '',
        Barcode: detailedItem.Barcode || '',
        Weight: detailedItem.Weight ? Number(detailedItem.Weight) : 0,
        WeightUnit: detailedItem.WeightUnit || 'kg',
        RequiresShipping: detailedItem.RequiresShipping !== false,
        IsTaxable: detailedItem.IsTaxable !== false,
        TaxCode: (detailedItem as any).TaxCode || '',
      }));

      // Also populate displayedPlatforms with base canonical data + variants
      // Extract additional generated fields from Metadata (cast to any for JSONB field)
      const metadata = ((detailedItem as any).Metadata as Record<string, any>) || {};
      const tags = ((detailedItem as any).Tags as string[]) || [];

      const canonicalBase = {
        title: detailedItem.Title || '',
        sku: detailedItem.Sku || '',
        barcode: detailedItem.Barcode || '',
        price: detailedItem.Price ? Number(detailedItem.Price) : 0,
        compareAtPrice: detailedItem.CompareAtPrice ? Number(detailedItem.CompareAtPrice) : undefined,
        weight: detailedItem.Weight ? Number(detailedItem.Weight) : 0,
        description: detailedItem.Description || '',
        requiresShipping: detailedItem.RequiresShipping !== false,
        isTaxable: detailedItem.IsTaxable !== false,
        tags: Array.isArray(tags) ? tags : [],
        // Add AI recommended price from metadata if available
        aiRecommendedPrice: metadata.aiRecommendedPrice,
        // Additional generated fields from Metadata
        vendor: metadata.vendor || '',
        productType: metadata.productType || '',
        brand: metadata.brand || '',
        condition: metadata.condition || '',
        categorySuggestion: metadata.categorySuggestion || '',
        // SEO fields
        seoTitle: metadata.seoTitle || '',
        seoDescription: metadata.seoDescription || '',
        // Platform-specific data for detailed editing
        ...(metadata.platformSpecificData?.shopify || {}),
      };

      console.log('[ProductDetail] Setting displayedPlatforms with tags:', canonicalBase.tags,
        'allProductVariants:', allProductVariants?.length,
        'rawInventoryLevels:', rawInventoryLevels?.length,
        'aiPrice:', canonicalBase.aiRecommendedPrice);

      // ⚡ CRITICAL FIX: Use rawInventoryLevels directly (loaded from InventoryLevels table)
      // and allProductVariants (loaded from ProductVariants table)
      // NOT variantPricing which comes from non-existent VariantPricing table

      // ⚡ CRITICAL FIX: Filter out 'base' variants - they don't have inventory
      // Only 'option' variants (or 'flat' products without options) have actual inventory
      // Base variants are just metadata containers for the product structure
      const displayableVariants = (allProductVariants || []).filter((v: any) => {
        // Keep 'option' variants (have inventory)
        if (v.VariantType === 'option') return true;
        // Keep 'flat' variants (single-variant products)
        if (v.VariantType === 'flat' || !v.VariantType) return true;
        // Filter out 'base' variants (no inventory, just a container)
        if (v.VariantType === 'base') {
          console.log('[ProductDetail] Filtering out base variant:', v.Sku || v.Id);
          return false;
        }
        return true;
      });
      console.log('[ProductDetail] Filtered variants: all=', allProductVariants?.length, 'displayable=', displayableVariants.length);

      // Hydrate variants with inventory data from REAL database data
      const hydratedVariants = hydrateInventoryFromDB(displayableVariants, rawInventoryLevels || []);

      // Build per-platform locations from rawInventoryLevels + connections
      // ⚡ CRITICAL FIX: Don't use groupedInventory (may not be populated yet)
      // Instead, build directly from rawInventoryLevels which IS available
      const platformLocationState: Record<string, { locations: Array<{ id: string; name: string; connectionId: string; connectionName: string }>; locationQuantities: Record<string, number> }> = {};

      // Build a connection -> platformType lookup
      const connectionToPlatform = new Map<string, string>();
      const connectionToName = new Map<string, string>();
      connections.forEach(conn => {
        connectionToPlatform.set(conn.Id, conn.PlatformType.toLowerCase());
        connectionToName.set(conn.Id, conn.DisplayName || conn.PlatformType);
      });

      // Group inventory levels by platform type using the connection lookup
      rawInventoryLevels?.forEach(level => {
        const platformType = connectionToPlatform.get(level.PlatformConnectionId);
        if (!platformType) return;

        if (!platformLocationState[platformType]) {
          platformLocationState[platformType] = { locations: [], locationQuantities: {} };
        }

        const locId = level.PlatformLocationId || 'default';

        // Check if location already added for this platform
        const existingLoc = platformLocationState[platformType].locations.find(l => l.id === locId);
        if (!existingLoc) {
          // Resolve location name from platformLocationNames (loaded from PlatformLocations table)
          let locationName = platformLocationNames.get(locId)
            || platformLocationNames.get(`${level.PlatformConnectionId}-${locId}`);

          if (!locationName) {
            // Fallback with smart formatting
            if (locId.includes('gid://shopify/Location/')) {
              const locNumber = locId.split('/').pop();
              locationName = `Location #${locNumber}`;
            } else if (locId.length >= 10 && /^[A-Z0-9]+$/.test(locId)) {
              locationName = `Location (${locId.substring(0, 6)}...)`;
            } else {
              locationName = locId;
            }
          }

          platformLocationState[platformType].locations.push({
            id: locId,
            name: locationName,
            connectionId: level.PlatformConnectionId,
            connectionName: connectionToName.get(level.PlatformConnectionId) || platformType,
          });
        }

        // Accumulate quantity for this location
        platformLocationState[platformType].locationQuantities[locId] =
          (platformLocationState[platformType].locationQuantities[locId] || 0) + (level.Quantity || 0);
      });

      console.log('[ProductDetail] Built platformLocationState from rawInventoryLevels:',
        Object.entries(platformLocationState).map(([k, v]) => `${k}: ${v.locations.length} locs`).join(', '));

      console.log('[ProductDetail] Hydrated variants:', hydratedVariants.length,
        'with inventory:', hydratedVariants.map(v => `${v.sku || v.id}: ${Object.keys(v.inventoryByLocation || {}).length} locs`).join(', '));

      // FIX: Populate ALL platforms from metadata.platformSpecificData, not just shopify
      // This ensures all platform data is displayed, not wiped out
      const platformSpecificData = metadata.platformSpecificData || {};
      const allPlatforms: Record<string, any> = {};

      // Build location quantities directly from hydrated variant inventory data
      // This ensures UI quantities match actual loaded inventory
      // CRITICAL FIX: Use groupedInventory to resolve location names instead of raw IDs
      const getLocationQtyAndLocs = (variants: any[], groupedInv: typeof groupedInventory) => {
        const locationQtyMap: Record<string, number> = {};
        const locationsMap: Record<string, { id: string; name: string }> = {};

        // First, build a map of all known location names from groupedInventory
        const locationNameLookup: Record<string, string> = {};
        Object.values(groupedInv).forEach(platformGroup => {
          (platformGroup.locations || []).forEach(loc => {
            if (loc.locationId && loc.locationName) {
              locationNameLookup[loc.locationId] = loc.locationName;
            }
          });
        });

        if (variants && variants.length > 0) {
          variants.forEach(v => {
            if (v.inventoryByLocation) {
              Object.entries(v.inventoryByLocation).forEach(([locId, inv]: [string, any]) => {
                locationQtyMap[locId] = (locationQtyMap[locId] || 0) + (inv.quantity || 0);
                if (!locationsMap[locId]) {
                  // CRITICAL FIX: Resolve location name from groupedInventory lookup
                  // Fall back to formatted ID if not found
                  let locationName = locationNameLookup[locId];
                  if (!locationName) {
                    // Handle Shopify GID format
                    if (locId?.includes('gid://shopify/Location/')) {
                      const locNumber = locId.split('/').pop();
                      locationName = `Shopify Location #${locNumber}`;
                    }
                    // Handle Square alphanumeric format
                    else if (locId && locId.length >= 10 && /^[A-Z0-9]+$/.test(locId)) {
                      locationName = `Square Location (${locId.substring(0, 6)}...)`;
                    }
                    else if (locId === 'default') {
                      locationName = 'Default Location';
                    }
                    else {
                      locationName = locId || 'Unknown Location';
                    }
                  }
                  locationsMap[locId] = {
                    id: locId,
                    name: locationName
                  };
                }
              });
            }
          });
        }

        return {
          locationQuantities: locationQtyMap,
          locations: Object.values(locationsMap)
        };
      };

      const { locationQuantities: hydratedLocQty, locations: hydratedLocs } = getLocationQtyAndLocs(hydratedVariants, groupedInventory);

      // Build platform data for each platform in platformSpecificData
      // ⚡ UPDATED: Include platforms that have data in platformSpecificData, even without active connections
      // This allows platforms like Facebook (where we have AI-generated data but no connection yet) to appear as tabs
      const actualPlatformTypes = new Set(connections.map(c => c.PlatformType.toLowerCase()));
      const platformKeys = Object.keys(platformSpecificData).filter(key => {
        const keyLower = key.toLowerCase();
        const platformData = platformSpecificData[key];

        // Always include if we have actual connections for this platform type
        if (actualPlatformTypes.has(keyLower)) return true;

        // Also include if there's meaningful data in platformSpecificData (for future publishing)
        // This allows platforms like Facebook to show even without a connection
        const hasMeaningfulData = platformData && (
          platformData.title ||
          platformData.description ||
          platformData.variants?.length > 0
        );
        if (hasMeaningfulData) {
          console.log(`[ProductDetail] Including platform '${key}' - has data but no active connection (for future publishing)`);
          return true;
        }

        // Skip truly empty platforms
        console.log(`[ProductDetail] Filtering out empty platform '${key}' - no data and no connection`);
        return false;
      });

      if (platformKeys.length > 0) {
        platformKeys.forEach(platformKey => {
          const platformData = platformSpecificData[platformKey] || {};
          const platformKeyLower = platformKey.toLowerCase();

          // ⚡ CRITICAL FIX: Use per-platform locations from platformLocationState
          // This ensures each platform only sees its own locations, not all platforms mixed together
          const perPlatformLocs = platformLocationState[platformKeyLower]?.locations || hydratedLocs;
          const perPlatformLocQty = platformLocationState[platformKeyLower]?.locationQuantities || hydratedLocQty;

          // ⚡ CRITICAL FIX: ALWAYS use freshly hydrated variants from DB
          // stale platformData.variants may have outdated inventory data
          // Merge: keep platformData fields, but override variants with fresh inventory

          // ⚡ CRITICAL FIX: Don't filter by optionValues - some variants may have optionValues in Metadata
          // instead of the Options column. The VariantType filter at line 1416 already handles
          // filtering out 'base' variants. Just use hydratedVariants directly.
          // 
          // NOTE: The old filter caused ALL variants to disappear when optionValues wasn't populated
          console.log('[ProductDetail] Using', hydratedVariants.length, 'freshVariants for platforms. First variant optionValues:',
            JSON.stringify(hydratedVariants[0]?.optionValues || {}));
          const freshVariants = hydratedVariants || [];

          // ⚡ CRITICAL FIX: Extract ONLY non-inventory/price fields from platformData
          // platformData comes from stale ProductVariants.Metadata.platformSpecificData
          // We want to use it for SEO, descriptions, titles etc. but NOT for prices/quantities
          // which should come from LIVE InventoryLevels data
          const {
            price: _stalePlatformPrice,
            compareAtPrice: _staleCompareAtPrice,
            variants: _staleVariants,
            locations: _staleLocations,
            locationQuantities: _staleLocationQty,
            ...safePlatformData
          } = platformData;

          // Get the LIVE price from InventoryLevels if available
          // Use the first inventory level's price for this platform as the "base" price
          const platformInventory = rawInventoryLevels?.filter(lvl =>
            connectionToPlatform.get(lvl.PlatformConnectionId) === platformKeyLower
          ) || [];
          const livePrice = platformInventory[0]?.Price;
          const liveCompareAtPrice = platformInventory[0]?.CompareAtPrice;

          allPlatforms[platformKey] = {
            ...canonicalBase,           // Base canonical data (includes ProductVariants.Price as fallback)
            ...safePlatformData,        // Platform-specific SEO, titles, descriptions (NO price/inventory)
            // ⚡ OVERRIDE: Use LIVE InventoryLevels prices if available
            price: livePrice ?? canonicalBase.price,
            compareAtPrice: liveCompareAtPrice ?? canonicalBase.compareAtPrice,
            options: safePlatformData.options || (detailedItem.Options && typeof detailedItem.Options === 'object'
              ? Object.entries(detailedItem.Options).map(([name, values]) => ({ name, values: Array.isArray(values) ? values : [values] }))
              : []),
            variants: freshVariants, // ALWAYS use fresh DB variants with live inventory
            locations: perPlatformLocs, // Use per-platform locations
            locationQuantities: perPlatformLocQty,
          };
        });
        console.log('[ProductDetail] Built platforms from metadata:', platformKeys, 'with per-platform locations:',
          Object.entries(platformLocationState).map(([k, v]) => `${k}: ${v.locations.length} locs`).join(', '));
      } else {
        // Fallback: If no platformSpecificData, use shopify as default
        // Use shopify-specific locations if available
        const shopifyLocs = platformLocationState['shopify']?.locations || hydratedLocs;
        const shopifyLocQty = platformLocationState['shopify']?.locationQuantities || hydratedLocQty;

        allPlatforms.shopify = {
          ...canonicalBase,
          options: detailedItem.Options && typeof detailedItem.Options === 'object'
            ? Object.entries(detailedItem.Options).map(([name, values]) => ({ name, values: Array.isArray(values) ? values : [values] }))
            : [],
          variants: hydratedVariants && hydratedVariants.length > 0 ? hydratedVariants : [],
          locations: shopifyLocs,
          locationQuantities: shopifyLocQty,
        };
        console.log('[ProductDetail] No platformSpecificData, using shopify as default with', shopifyLocs.length, 'locations');
      }

      // ⚡ Set displayedPlatforms - this only runs on FIRST load for this product
      // The early return above prevents re-hydration
      setDisplayedPlatforms(allPlatforms);

      // Mark as hydrated for this product AFTER setting state
      hasHydratedPlatformsRef.current = detailedItem.Id;
      lastHydratedInventoryCountRef.current = currentInventoryCount;
      console.log('[ProductDetail] ✅ Initial hydration complete for product', detailedItem.Id,
        'with', Object.keys(allPlatforms).length, 'platforms');
    }, [detailedItem?.Id, allProductVariants, rawInventoryLevels, hydrateInventoryFromDB, hasUnsavedChanges, isInSaveBlockingWindow, connections, platformLocationNames]); // Depend on real inventory data + connections + location names

    // Phase 2: Load drafts from backend (ONCE only, do NOT re-fetch when platforms change)
    // CRITICAL FIX: Removed displayedPlatforms from dependencies to prevent overwriting user edits
    const hasFetchedDraftRef = useRef<string | null>(null); // Track which product ID we fetched for

    useEffect(() => {
      // GUARD 1: Only fetch if we have a product
      if (!detailedItem?.Id) return;

      // GUARD 2: Don't re-fetch if we already fetched for this product
      if (hasFetchedDraftRef.current === detailedItem.Id) {
        console.log('[ProductDetail] Draft already fetched for product', detailedItem.Id, '- skipping');
        return;
      }

      // GUARD 3: Don't fetch if user has unsaved changes (this would overwrite them!)
      if (hasUnsavedChanges) {
        console.log('[ProductDetail] User has unsaved changes - skipping draft fetch');
        return;
      }

      let canceled = false;
      setIsLoadingDraft(true);

      (async () => {
        try {
          const token = await ensureSupabaseJwt();
          const baseUrl = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || SSSYNC_API_BASE_URL;

          if (!token) {
            console.log('[ProductDetail] No auth token for draft loading');
            return;
          }

          const response = await fetch(`${baseUrl}/api/products/drafts/${detailedItem.Id}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          });

          if (response.ok) {
            const data = await response.json();
            if (!canceled) {
              console.log('[ProductDetail] ✅ Loaded draft data:', data);
              setDraftData(data.currentDraft?.DraftData || null);
              setDraftVersions(data.versions || []);

              // Mark as fetched for this product (prevents re-fetching)
              hasFetchedDraftRef.current = detailedItem.Id;

              // CRITICAL: Do NOT merge draft data into displayedPlatforms!
              // The draft contains OLD data from original publish time.
              // displayedPlatforms should reflect CURRENT edits.
              // Draft data is available in draftData state if needed for comparison.
              console.log('[ProductDetail] Draft loaded for reference only - NOT merging to preserve current data');
            }
          } else {
            console.log('[ProductDetail] Draft data not found (expected for new products)');
            hasFetchedDraftRef.current = detailedItem.Id; // Mark as fetched even if empty
          }
        } catch (error) {
          console.error('[ProductDetail] Error loading draft:', error);
        } finally {
          if (!canceled) {
            setIsLoadingDraft(false);
          }
        }
      })();

      return () => { canceled = true };
    }, [detailedItem?.Id, hasUnsavedChanges]); // ONLY depend on product ID - NOT displayedPlatforms!

    // Set up realtime subscriptions
    // Use refs to track state to avoid stale closure issues
    const hasUnsavedChangesRef = useRef(hasUnsavedChanges);

    useEffect(() => {
      hasUnsavedChangesRef.current = hasUnsavedChanges;
    }, [hasUnsavedChanges]);

    useEffect(() => {
      if (!detailedItem) return;

      console.log('[ProductDetail] Setting up realtime subscriptions for product:', detailedItem.Id);

      // Subscribe to product variant changes
      const productSubscription = supabase
        .channel(`product-${detailedItem.Id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'ProductVariants',
            filter: `Id=eq.${detailedItem.Id}`,
          },
          (payload) => {
            console.log('[ProductDetail] REALTIME EVENT FIRED:', payload.eventType);
            console.log('[ProductDetail] hasUnsavedChangesRef.current:', hasUnsavedChangesRef.current);

            // ✅ CRITICAL FIX: Check timestamp-based blocking window FIRST
            // This prevents realtime from overwriting data right after a save
            if (isInSaveBlockingWindow()) {
              console.log('[ProductDetail] ⚠️ BLOCKING REALTIME - in save blocking window (2s after save)');
              return;
            }

            // CRITICAL: Never update if user has unsaved changes
            if (hasUnsavedChangesRef.current) {
              console.log('[ProductDetail] ⚠️ BLOCKING REALTIME - user has unsaved changes');
              showBanner('External update available. Save your changes first.');
              return;
            }

            if (payload.eventType === 'UPDATE' && payload.new) {
              const updatedProduct = payload.new as ProductVariant;
              console.log('[ProductDetail] Processing realtime update for:', updatedProduct.Title);

              // ✅ CRITICAL FIX: Merge instead of replacing to preserve nested data
              setDetailedItem((prev) => {
                if (!prev) return prev;

                // Check if this is a meaningful update or just a timestamp change
                const hasRealChanges = (
                  prev.Title !== updatedProduct.Title ||
                  prev.Description !== updatedProduct.Description ||
                  prev.Sku !== updatedProduct.Sku ||
                  prev.Price !== updatedProduct.Price
                );
                if (!hasRealChanges) {
                  console.log('[ProductDetail] No meaningful changes, skipping realtime update');
                  return prev;
                }

                // 🟢 TRACK EXTERNAL UPDATES: Record which fields changed for green border highlighting
                const now = Date.now();
                const fieldChanges: Record<string, { value?: any; updatedAt: number }> = {};

                if (prev.Title !== updatedProduct.Title && updatedProduct.Title !== undefined) {
                  fieldChanges['title'] = { value: updatedProduct.Title, updatedAt: now };
                }
                if (prev.Description !== updatedProduct.Description && updatedProduct.Description !== undefined) {
                  fieldChanges['description'] = { value: updatedProduct.Description, updatedAt: now };
                }
                if (prev.Price !== updatedProduct.Price && updatedProduct.Price !== undefined) {
                  fieldChanges['price'] = { value: updatedProduct.Price, updatedAt: now };
                }
                if (prev.Sku !== updatedProduct.Sku && updatedProduct.Sku !== undefined) {
                  fieldChanges['sku'] = { value: updatedProduct.Sku, updatedAt: now };
                }
                if (prev.Barcode !== updatedProduct.Barcode && updatedProduct.Barcode !== undefined) {
                  fieldChanges['barcode'] = { value: updatedProduct.Barcode, updatedAt: now };
                }
                if (prev.Weight !== updatedProduct.Weight && updatedProduct.Weight !== undefined) {
                  fieldChanges['weight'] = { value: updatedProduct.Weight, updatedAt: now };
                }

                if (Object.keys(fieldChanges).length > 0) {
                  console.log('[ProductDetail] 🟢 External field changes detected:', Object.keys(fieldChanges));
                  setExternalUpdates(prevUpdates => ({ ...prevUpdates, ...fieldChanges }));
                  // Show banner only when we have actual field changes from external source
                  showBanner('Product updated from external source');
                }

                console.log('[ProductDetail] ✅ Applying realtime update (merging to preserve nested data)');
                console.log('[ProductDetail] REALTIME CHANGES:', {
                  title: { old: prev.Title, new: updatedProduct.Title },
                  price: { old: prev.Price, new: updatedProduct.Price },
                  sku: { old: prev.Sku, new: updatedProduct.Sku },
                });

                // ✅ MERGE: Keep existing nested data (ImageUrls, Options, Metadata, etc.)
                // Only take scalar fields from the realtime update, preserve complex objects from prev
                // Cast to ProductVariant to satisfy TypeScript - we know these fields exist at runtime
                return {
                  ...prev,
                  Title: updatedProduct.Title ?? prev.Title,
                  Description: updatedProduct.Description ?? prev.Description,
                  Price: updatedProduct.Price ?? prev.Price,
                  CompareAtPrice: updatedProduct.CompareAtPrice ?? prev.CompareAtPrice,
                  Sku: updatedProduct.Sku ?? prev.Sku,
                  Barcode: updatedProduct.Barcode ?? prev.Barcode,
                  Weight: updatedProduct.Weight ?? prev.Weight,
                  WeightUnit: updatedProduct.WeightUnit ?? prev.WeightUnit,
                  RequiresShipping: updatedProduct.RequiresShipping ?? prev.RequiresShipping,
                  IsTaxable: updatedProduct.IsTaxable ?? prev.IsTaxable,
                  UpdatedAt: updatedProduct.UpdatedAt ?? prev.UpdatedAt,
                  // PRESERVE these complex fields from prev - don't overwrite with undefined
                  ImageUrls: prev.ImageUrls,
                  Options: prev.Options,
                  Metadata: prev.Metadata,
                  Tags: prev.Tags,
                  // PlatformSpecificData is stored on the enriched item, preserve it
                  ...((prev as any).PlatformSpecificData ? { PlatformSpecificData: (prev as any).PlatformSpecificData } : {}),
                } as ProductVariant;
              });

              // ⚡ FIX: Also update displayedPlatforms to reflect realtime changes in the UI
              // Without this, the ListingEditorForm won't show the updated values
              setDisplayedPlatforms(prev => {
                if (!prev || Object.keys(prev).length === 0) return prev;

                const updated = { ...prev };
                // Update ALL platforms with the new canonical values
                for (const platformKey of Object.keys(updated)) {
                  updated[platformKey] = {
                    ...updated[platformKey],
                    title: updatedProduct.Title ?? updated[platformKey].title,
                    description: updatedProduct.Description ?? updated[platformKey].description,
                    price: updatedProduct.Price ?? updated[platformKey].price,
                    sku: updatedProduct.Sku ?? updated[platformKey].sku,
                  };
                }
                console.log('[ProductDetail] ✅ REALTIME: Also updated displayedPlatforms for UI refresh');
                return updated;
              });
            }
          }
        )
        .subscribe();

      // Subscribe to inventory level changes - but DON'T trigger full reload if user is editing
      // CRITICAL FIX: Don't filter by ProductVariantId in the subscription because:
      // - detailedItem.Id is often the BASE variant
      // - Inventory is stored against OPTION variants (different IDs)
      // - Instead, we filter in the callback using allProductVariantsRef
      const inventorySubscription = supabase
        .channel(`inventory-product-${detailedItem.ProductId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'InventoryLevels',
            // No filter here - we check in callback if it's for our product
          },
          (payload) => {
            const updatedLevel = payload.new as InventoryLevel | undefined;
            const deletedLevel = payload.old as InventoryLevel | undefined;
            const affectedVariantId = updatedLevel?.ProductVariantId || deletedLevel?.ProductVariantId;

            // CRITICAL: Check if this inventory update is for one of our product's variants
            const ourVariantIds = allProductVariantsRef.current.map(v => v.Id);
            if (!affectedVariantId || !ourVariantIds.includes(affectedVariantId)) {
              // Not our product - ignore
              return;
            }

            console.log('[ProductDetail] Inventory level updated:', payload.eventType, 'for variant:', affectedVariantId);

            // ✅ CRITICAL: Block during save window to prevent race conditions
            if (isInSaveBlockingWindow()) {
              console.log('[ProductDetail] ⚠️ Skipping inventory reload - in save blocking window');
              return;
            }

            // CRITICAL: Don't reload if user has unsaved changes - it will overwrite their edits
            if (hasUnsavedChangesRef.current) {
              console.log('[ProductDetail] ⚠️ Skipping inventory reload - user has unsaved changes');
              showBanner('Inventory changed externally. Save your changes first.');
              return;
            }

            // Update inventory in place without full page reload
            if (payload.eventType === 'UPDATE' && updatedLevel) {
              // Update raw inventory levels and trigger re-render
              setRawInventoryLevels(prev => {
                const updated = prev.map(level =>
                  level.Id === updatedLevel.Id
                    ? { ...level, Quantity: updatedLevel.Quantity, Price: updatedLevel.Price }
                    : level
                );
                return updated;
              });

              // Also update grouped inventory for immediate UI update
              setGroupedInventory(prev => {
                const updated = { ...prev };
                Object.keys(updated).forEach(platformName => {
                  const platform = updated[platformName];
                  platform.locations = platform.locations.map(loc =>
                    loc.locationId === updatedLevel.PlatformLocationId
                      ? { ...loc, quantity: updatedLevel.Quantity }
                      : loc
                  );
                });
                return updated;
              });
              console.log('[ProductDetail] ✅ Inventory updated in place for variant', affectedVariantId);
              showBanner('Inventory updated from external source');
            } else {
              // For INSERT/DELETE, do a full reload only if not in blocking window
              console.log('[ProductDetail] Inventory INSERT/DELETE - triggering full reload');
              loadPlatformData();
            }
          }
        )
        .subscribe();

      // Subscribe to platform mapping changes
      const mappingSubscription = supabase
        .channel(`mappings-${detailedItem.Id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'PlatformProductMappings',
            filter: `ProductVariantId=eq.${detailedItem.Id}`,
          },
          (payload) => {
            console.log('[ProductDetail] Platform mapping updated:', payload.eventType);

            // ✅ CRITICAL: Block during save window
            if (isInSaveBlockingWindow()) {
              console.log('[ProductDetail] ⚠️ Skipping mapping reload - in save blocking window');
              return;
            }

            // Mapping changes are less disruptive - reload if no unsaved changes
            if (!hasUnsavedChangesRef.current) {
              loadPlatformData();
            } else {
              showBanner('Platform mapping changed. Save your changes first.');
            }
          }
        )
        .subscribe();

      return () => {
        console.log('[ProductDetail] Cleaning up realtime subscriptions');
        productSubscription.unsubscribe();
        inventorySubscription.unsubscribe();
        mappingSubscription.unsubscribe();
      };
    }, [detailedItem?.Id, loadPlatformData, showBanner, isInSaveBlockingWindow]);

    // Collaboration: Request edit lock and listen for team updates
    useEffect(() => {
      if (!detailedItem?.ProductId || !collaboration.isConnected) return;

      // Request edit lock when opening product
      collaboration.startEditing(detailedItem.ProductId).then((response) => {
        if (!response.success && response.lockedBy) {
          setIsLockedByOther(true);
          setLockOwner(response.lockedBy);
          Alert.alert(
            'Product Locked',
            `${response.lockedBy} is currently editing this product. You can view but not edit.`,
            [{ text: 'OK' }]
          );
        }
      });

      // Listen for product updates from other team members
      const unsubscribeUpdate = collaboration.onProductUpdate((update) => {
        // Ignore our own updates
        if (update.userId === detailedItem.UserId) return;

        // CRITICAL FIX: Only process updates for the CURRENT variant being edited
        // This prevents the page from "switching" to a different variant when 
        // a webhook updates another variant in the same product
        if (update.variantId !== detailedItem.Id) {
          console.log('[ProductDetail] Ignoring collaboration update for different variant:', update.variantId, '(current:', detailedItem.Id, ')');
          return;
        }

        console.log('[ProductDetail] Received update from teammate for current variant:', update);

        // Refresh product data from Supabase (single source of truth)
        const observables = getLegendStateObservables();
        if (observables?.productVariants$) {
          const refreshed = observables.productVariants$[update.variantId].get();
          if (refreshed) {
            setDetailedItem(refreshed);
            setFormData({
              Title: refreshed.Title || '',
              Description: refreshed.Description || '',
              Price: refreshed.Price || 0,
              CompareAtPrice: refreshed.CompareAtPrice || 0,
              Sku: refreshed.Sku || '',
              Barcode: refreshed.Barcode || '',
              Weight: refreshed.Weight || 0,
              WeightUnit: refreshed.WeightUnit || 'kg',
              RequiresShipping: refreshed.RequiresShipping !== false,
              IsTaxable: refreshed.IsTaxable !== false,
              TaxCode: refreshed.TaxCode || '',
            });
          }
        }

        // Show non-blocking banner instead of Alert
        showBanner('A teammate updated this product. View refreshed.');
      });

      // Listen for edit started events
      const unsubscribeEditStart = collaboration.onEditStarted((event) => {
        if (event.productId === detailedItem.ProductId) {
          setIsLockedByOther(true);
          setLockOwner(event.userName);
        }
      });

      // Listen for edit ended events
      const unsubscribeEditEnd = collaboration.onEditEnded((event) => {
        if (event.productId === detailedItem.ProductId) {
          setIsLockedByOther(false);
          setLockOwner(null);
        }
      });

      // Cleanup: Release lock when leaving
      return () => {
        collaboration.stopEditing(detailedItem.ProductId);
        unsubscribeUpdate();
        unsubscribeEditStart();
        unsubscribeEditEnd();
      };
    }, [detailedItem?.ProductId, collaboration.isConnected]);


    if (isLoading) {
      return (
        <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.background }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.loadingText, { color: theme.colors.text }]}>Loading product details...</Text>
        </View>
      );
    }

    if (!detailedItem) {
      return (
        <View style={[styles.container, styles.centered, { backgroundColor: theme.colors.background }]}>
          <Text style={[styles.errorText, { color: theme.colors.error }]}>Product not found</Text>
          <Button title="Go Back" onPress={navigation.goBack} />
        </View>
      );
    }


    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        {/* Non-blocking notification banner */}
        {bannerMessage && (
          <Animated.View
            style={[
              styles.notificationBanner,
              {
                opacity: bannerOpacity,
                backgroundColor: theme.colors.primary + 'E6', // 90% opacity
              }
            ]}
          >
            <Text style={styles.notificationBannerText}>{bannerMessage}</Text>
          </Animated.View>
        )}

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Header with auto-save indicator */}
          <View style={[styles.header, { backgroundColor: theme.colors.surface }]}>
            <TouchableOpacity onPress={navigation.goBack} style={styles.backButton}>
              <Icon name="arrow-left" size={24} color={theme.colors.text} />
            </TouchableOpacity>
            <View style={styles.headerCenter}>
              <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Product Details</Text>
              {isSaving && (
                <View style={styles.savingIndicator}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={[styles.savingText, { color: theme.colors.primary }]}>Saving...</Text>
                </View>
              )}
              {hasUnsavedChanges && (
                <Text style={{ color: 'orange', fontSize: 12 }}>Unsaved changes</Text>
              )}

              {!isSaving && lastSaveTime > 0 && (
                <Text style={[styles.savedText, { color: theme.colors.success }]}>
                  Saved {new Date(lastSaveTime).toLocaleTimeString()}
                </Text>
              )}
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity onPress={() => loadPlatformData()} style={styles.refreshButton}>
                <Icon name="refresh" size={20} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>



          {/* Listing editor (edit mode) */}
          <Card style={styles.basicSection}>
            <ListingEditorForm
              ref={listingEditorRef}
              platforms={displayedPlatforms}
              images={detailedItem?.ImageUrls || []}
              platformLocations={buildPlatformLocations()}
              onChangePlatforms={(next) => {
                console.log('[ProductDetail] ListingEditorForm onChange:', Object.keys(next));
                setDisplayedPlatforms(next);
                setHasUnsavedChanges(true)
                console.log('[GEN-DETAILS] onChangePlatforms received - deep merge to preserve all data');
                // DEEP merge: preserve all existing fields while updating changed ones
                // This preserves user edits AND keeps all loaded backend data
                updatePlatforms(prev => {
                  const merged = { ...prev };
                  for (const [platformKey, platformData] of Object.entries(next)) {
                    const prevPlatform = prev[platformKey] || {};

                    // Deep merge platform data
                    merged[platformKey] = {
                      ...prevPlatform,
                      ...platformData
                    };

                    // CRITICAL: Preserve variant inventoryByLocation when merging variants array
                    if (Array.isArray(platformData?.variants) && Array.isArray(prevPlatform.variants)) {
                      merged[platformKey].variants = platformData.variants.map((newVariant: any) => {
                        const prevVariant = prevPlatform.variants?.find((v: any) => v.id === newVariant.id);
                        if (prevVariant?.inventoryByLocation) {
                          return {
                            ...newVariant,
                            inventoryByLocation: {
                              ...prevVariant.inventoryByLocation,
                              ...(newVariant.inventoryByLocation || {})
                            }
                          };
                        }
                        return newVariant;
                      });
                    }
                  }
                  console.log('[GEN-DETAILS] Deep merged platforms, keys:', Object.keys(merged));
                  return merged;
                });
              }}
              onChangeImages={(next) => { reorderImages(next); }}
              onOpenFieldPanel={undefined}
              onOpenBarcodeScanner={(onResult) => {
                setIsBarcodeScannerVisible(true);
                // handler stored on closure
                (ProductDetailScreen as any)._scannerResultHandler = onResult;
              }}
              onOpenImageCapture={async (onResult) => {
                try {
                  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                  if (status !== 'granted') {
                    Alert.alert('Permission Required', 'Please grant camera roll permissions to add images.');
                    return;
                  }
                  const result = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ImagePicker.MediaTypeOptions.Images,
                    allowsMultipleSelection: true,
                    quality: 0.8,
                  });
                  if (!result.canceled && result.assets) {
                    setIsUploadingImages(true);
                    const uploadedUrls = await uploadImagesToSupabase(result.assets);
                    onResult(uploadedUrls);  // Call the callback with uploaded URLs
                    await addImagesToProduct(uploadedUrls);
                    setIsUploadingImages(false);
                  }
                } catch (error) {
                  console.error('Error picking images:', error);
                  setIsUploadingImages(false);
                  Alert.alert('Error', 'Failed to pick images. Please try again.');
                }
              }}
              // 🟢 EXTERNAL UPDATES: Pass field changes for green border highlighting
              externalUpdates={externalUpdates}
              onAdoptExternalUpdate={(key) => {
                // Clear a specific field's external update when user acknowledges it
                setExternalUpdates(prev => {
                  const { [key]: _, ...rest } = prev;
                  return rest;
                });
              }}
            />

            {/* Active Listings */}
            <Card style={styles.platformsSection}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Active Listings</Text>

              {mappings.length > 0 ? (
                <>
                  {mappings.map((mapping) => {
                    const connection = connections.find(c => c.Id === mapping.PlatformConnectionId);
                    const platformName = connection?.DisplayName || `${connection?.PlatformType || 'Unknown'} Account`;
                    const platformType = connection?.PlatformType || 'unknown';
                    const Logo = getPlatformLogoComponent(platformType);
                    return (
                      <View key={mapping.Id} style={styles.platformRow}>
                        <View style={styles.platformInfo}>
                          <View style={styles.platformLogoContainer}>
                            {Logo ? (
                              <Logo width={18} height={18} />
                            ) : (
                              <Icon name="store" size={18} color={'#666'} />
                            )}
                          </View>
                          <View style={styles.platformDetails}>
                            <Text style={[styles.platformName, { color: theme.colors.text }]}>{platformName}</Text>
                            <Text style={[styles.platformStatus, { color: theme.colors.text }]}>Status: {mapping.SyncStatus || 'Connected'}</Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={styles.delistButton}
                          onPress={() => {
                            Alert.alert('Delist', `Remove listing from ${platformName}?`, [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delist', style: 'destructive', onPress: () => console.log('Delist from', platformName) }
                            ]);
                          }}
                        >
                          <Icon name="archive-outline" size={16} color={theme.colors.text} style={{ marginRight: 6 }} />
                          <Text style={[styles.delistButtonText, { color: theme.colors.text }]}>Delist</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                  <TouchableOpacity
                    style={styles.addPlatformRow}
                    onPress={() => listingEditorRef.current?.openPlatformPicker?.()}
                  >
                    <Icon name="plus" size={16} color={theme.colors.textSecondary} style={{ marginRight: 8 }} />
                    <Text style={[styles.addPlatformText, { color: theme.colors.textSecondary }]}>Add Platform</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.noPlatformsContainer}>
                  <Text style={[styles.noPlatformsText, { color: theme.colors.textSecondary }]}>No active listings</Text>
                  <TouchableOpacity onPress={() => listingEditorRef.current?.openPlatformPicker?.()} style={[styles.syncButton, { backgroundColor: theme.colors.primary, marginTop: 8 }]}>
                    <Text style={{ color: '#fff', fontWeight: '600' }}>+ Add Platform</Text>
                  </TouchableOpacity>
                </View>
              )}
            </Card>

            {/* Danger Zone */}
            <Card style={[
              styles.dangerZoneSection,
              {
                borderColor: "#F12C2D",
                backgroundColor: '#FAFBFC',
                borderWidth: 1.5,
                borderRadius: 10,
                marginTop: 24,
                marginBottom: 24,
                padding: 0,
                overflow: 'hidden'
              }
            ]}>
              <View style={{
                padding: 16,
                borderBottomWidth: 0,
                backgroundColor: 'transparent'
              }}>
                <Text style={[
                  styles.dangerZoneTitle,
                  { color: theme.colors.text, fontWeight: '600', fontSize: 20, marginBottom: 0 }
                ]}>
                  Danger Zone
                </Text>
              </View>
              <View style={{ paddingHorizontal: 8, paddingBottom: 16 }}>
                {/* Archive Product */}
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderWidth: 1.5,
                    borderColor: "#FFBC13",
                    borderRadius: 8,
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    marginBottom: 12,
                    backgroundColor: '#fff',
                    justifyContent: 'center'
                  }}
                  onPress={() => {
                    Alert.alert(
                      'Archive Product',
                      'Are you sure you want to archive this product? You can restore it later.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        { text: 'Archive', style: 'default', onPress: () => console.log('Archive product') }
                      ]
                    );
                  }}
                >
                  <Icon name="archive" size={20} color={theme.colors.warning} style={{ marginRight: 8 }} />
                  <Text style={{ color: "#FFBC13", fontWeight: '400', fontSize: 16 }}>
                    Archive Product
                  </Text>
                </TouchableOpacity>
                {/* Delete Product */}
                <TouchableOpacity
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    borderWidth: 1.25,
                    borderColor: "#F12C2D",
                    borderRadius: 8,
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    backgroundColor: '#fff',
                    justifyContent: 'center'
                  }}
                  onPress={handleDelete}
                >
                  <Icon name="delete" size={20} color={theme.colors.error} style={{ marginRight: 8 }} />
                  <Text style={{ color: theme.colors.error, fontWeight: '500', fontSize: 16 }}>
                    Delete Product
                  </Text>
                </TouchableOpacity>
              </View>
            </Card>
          </Card>


        </ScrollView>

        {/* Sync Status Indicator */}
        {hasUnsavedChanges && (
          <BottomActionBar
            primaryLabel={isSaving ? 'Saving…' : 'Save changes'}
            primaryDisabled={isSaving}
            onPrimary={() => performAutoSave()}
          />
        )}
        {/* Barcode Scanner Modal */}
        {isBarcodeScannerVisible && (
          <View style={styles.scannerDockFull} pointerEvents="box-none">
            <View style={styles.scannerFullBleed}>
              <CameraView
                style={{ width: '100%', height: 240 }}
                facing={'back'}
                onBarcodeScanned={(result: any) => {
                  const code = result?.data || result?.rawValue;
                  if (code && (ProductDetailScreen as any)._scannerResultHandler) {
                    (ProductDetailScreen as any)._scannerResultHandler(code);
                    setIsBarcodeScannerVisible(false);
                    (ProductDetailScreen as any)._scannerResultHandler = null;
                  }
                }}
                barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'] }}
              />
              <TouchableOpacity onPress={() => { setIsBarcodeScannerVisible(false); (ProductDetailScreen as any)._scannerResultHandler = null; }} style={styles.scannerCloseFull}>
                <Text style={{ color: '#fff', fontSize: 28 }}>×</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {isSyncing && (
          <LoadingOverlay visible={isSyncing} message="Syncing to platforms..." onCancel={() => setIsSyncing(false)} />
        )}
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  notificationBanner: {
    position: 'absolute',
    top: 50,
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  notificationBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  scannerDock: { position: 'absolute', top: 6, left: 56, right: 56, zIndex: 5000 },
  scannerCard: { backgroundColor: '#000', borderRadius: 18, borderWidth: 2, borderColor: '#111', overflow: 'hidden' },
  scannerClose: { position: 'absolute', top: 14, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  scannerDockFull: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5000 },
  scannerFullBleed: { backgroundColor: '#000', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden' },
  scannerCloseFull: { position: 'absolute', top: 100, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    paddingBottom: 100,
  },
  header: {
    paddingTop: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  backButton: {
    padding: 8,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerActions: {
    flexDirection: 'row',
  },
  refreshButton: {
    padding: 8,
  },
  savingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  savingText: {
    fontSize: 12,
    marginLeft: 4,
  },
  savedText: {
    fontSize: 12,
    marginTop: 4,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },

  // Image Section
  imageSection: {
    margin: 16,
  },
  imageSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  addImageButton: {
    padding: 12,
    borderRadius: 8,
  },
  imageScroll: {
    flexDirection: 'row',
  },
  imageContainer: {
    position: 'relative',
    marginRight: 12,
  },
  productImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
  },
  primaryBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  placeholderImageContainer: {
    width: 120,
    height: 120,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    fontSize: 12,
    marginTop: 8,
  },

  // Form Sections
  basicSection: {
    margin: 0,
    marginTop: 0,
  },
  identitySection: {
    margin: 16,
    marginTop: 0,
  },
  shippingSection: {
    margin: 16,
    marginTop: 0,
  },

  formGroup: {
    marginBottom: 16,
  },
  formLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
  },
  formInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  formRow: {
    flexDirection: 'row',
  },
  barcodeRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  scanButton: {
    marginLeft: 10,
    padding: 12,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  switchLabel: {
    fontSize: 16,
  },

  // Inventory Section
  inventorySection: {
    margin: 16,
    marginTop: 0,
  },
  platformGroup: {
    marginBottom: 20,
  },
  platformHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  platformGroupTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  platformSubtitle: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  inventoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  inventoryLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  locationName: {
    fontSize: 14,
    marginLeft: 6,
  },
  inventoryInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    minWidth: 80,
    textAlign: 'center',
  },
  noInventoryText: {
    textAlign: 'center',
    fontSize: 14,
    fontStyle: 'italic',
    padding: 20,
  },

  // Platform Connections
  platformsSection: {
    margin: 0,
    marginTop: 0,
  },
  platformRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  platformInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  platformLogoContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformDetails: {
    marginLeft: 12,
    flex: 1,
  },
  platformName: {
    fontSize: 16,
    fontWeight: '500',
  },
  platformSku: {
    fontSize: 12,
    marginTop: 2,
  },
  platformStatus: {
    fontSize: 12,
    marginTop: 2,
    fontWeight: '500',
  },
  platformLastSync: {
    fontSize: 11,
    marginTop: 2,
  },
  platformActions: {
    flexDirection: 'row',
  },
  syncButton: {
    padding: 8,
    borderRadius: 6,
    marginLeft: 8,
  },
  delistButton: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  delistButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  noPlatformsContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  noPlatformsText: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: 'center',
  },
  addPlatformRow: {
    marginTop: 8,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D0D5DD',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  addPlatformText: {
    fontSize: 16,
    fontWeight: '500',
  },
  removeImageButton: {
    position: 'absolute',
    top: 4,
    right: 4,
    padding: 4,
    borderRadius: 4,
  },
  dangerZoneSection: {
    margin: 16,
    marginTop: 0,
  },
  dangerZoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  dangerZoneHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerZoneTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  dangerZoneContent: {
    padding: 16,
  },
  dangerZoneDescription: {
    fontSize: 14,
    marginBottom: 16,
  },
  dangerAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dangerActionInfo: {
    flex: 1,
  },
  dangerActionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  dangerActionDescription: {
    fontSize: 14,
  },
  dangerButton: {
    padding: 12,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },
  dangerButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
  },
});

export default ProductDetailScreen; 
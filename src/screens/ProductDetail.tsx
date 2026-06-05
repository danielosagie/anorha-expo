import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, Switch, FlatList, Animated, Easing } from 'react-native';
import { ChevronLeft, ChevronRight, Copy, Check, Info, Box, AlertTriangle, X } from 'lucide-react-native';
import BaseModal from '../components/BaseModal';
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
import * as ImageManipulator from 'expo-image-manipulator';
import { useCollaboration } from '../hooks/useCollaboration';
import { useOrg } from '../context/OrgContext';
import LoadingOverlay from '../components/LoadingOverlay';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const ACTION_BAR_HEIGHT = 80;
const ACTION_BAR_BOTTOM_OFFSET = 24;
const SCANNER_GROW_HEIGHT = 240;
const SCANNER_CLOSE_DURATION = 220;

// Base URL for API
const SSSYNC_API_BASE_URL = 'https://api.sssync.app';

// Debounced autosave keeps listing/inventory changes live without manual refresh.
const ENABLE_AUTOSAVE = true;

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
 * 
 * LOCATION VALIDATION STRATEGY:
 * 1. PRIMARY: Use `locations` array from platform data (most reliable - actual DB data)
 * 2. SECONDARY: Use `connectionId` from platformData to match against location's connectionId
 * 3. FALLBACK: Pattern matching for known platform ID formats (least reliable, last resort)
 */
function cleanPlatformDataForSave(displayedPlatforms: Record<string, any>): Record<string, any> {
  const cleanedData: Record<string, any> = {};

  for (const [platformKey, platformData] of Object.entries(displayedPlatforms)) {
    if (!platformData) continue;

    // Deep clone to avoid mutating original
    const cleanedPlatform = JSON.parse(JSON.stringify(platformData));

    // PRIMARY: Get location IDs from platform's locations array (source of truth)
    const platformLocationIds = new Set<string>();
    if (Array.isArray(cleanedPlatform.locations)) {
      cleanedPlatform.locations.forEach((loc: any) => {
        if (loc?.id) platformLocationIds.add(loc.id);
      });
    }

    // SECONDARY: Get connectionId for this platform if available
    const platformConnectionId = cleanedPlatform.connectionId || cleanedPlatform.connection?.id;

    // Filter variants' inventoryByLocation to only include this platform's locations
    if (Array.isArray(cleanedPlatform.variants)) {
      cleanedPlatform.variants = cleanedPlatform.variants.map((variant: any) => {
        if (!variant.inventoryByLocation) return variant;

        const filteredInventory: Record<string, any> = {};
        for (const [locId, locData] of Object.entries(variant.inventoryByLocation)) {
          // PRIMARY: Use locations array if available
          if (platformLocationIds.size > 0) {
            // CRITICAL FIX: Always include 'default' key for platforms like eBay
            if (locId === 'default' || platformLocationIds.has(locId)) {
              filteredInventory[locId] = locData;
            } else {
              console.log(`[cleanPlatformDataForSave] Filtered out location ${locId} from ${platformKey} - not in platform's locations`);
            }
            continue;
          }

          // For platforms WITHOUT locations (like eBay), always include 'default' key
          if (locId === 'default') {
            filteredInventory[locId] = locData;
            continue;
          }

          // SECONDARY: Check if locData has connectionId that matches this platform
          const locConnectionId = (locData as any)?.connectionId || (locData as any)?.platformConnectionId;
          if (locConnectionId && platformConnectionId) {
            if (locConnectionId === platformConnectionId) {
              filteredInventory[locId] = locData;
            } else {
              console.log(`[cleanPlatformDataForSave] Filtered location ${locId} from ${platformKey} - connectionId mismatch`);
            }
            continue;
          }

          // FALLBACK: Pattern matching for common platform ID formats
          const isShopifyLoc = locId.includes('gid://shopify/');
          const isSquareLoc = /^L[A-Z0-9]+$/.test(locId) || (/^[A-Z0-9]{8,}$/.test(locId) && !locId.includes('gid://'));
          const isCloverLoc = /^[A-Z0-9]{13}$/.test(locId); // Clover IDs are typically 13 chars

          // Cross-contamination check
          if (platformKey === 'shopify' && (isSquareLoc || isCloverLoc) && !isShopifyLoc) {
            console.log(`[cleanPlatformDataForSave] Filtered non-Shopify location ${locId} from Shopify platform`);
            continue;
          }
          if (platformKey === 'square' && (isShopifyLoc || isCloverLoc)) {
            console.log(`[cleanPlatformDataForSave] Filtered non-Square location ${locId} from Square platform`);
            continue;
          }
          if (platformKey === 'clover' && (isShopifyLoc || isSquareLoc)) {
            console.log(`[cleanPlatformDataForSave] Filtered non-Clover location ${locId} from Clover platform`);
            continue;
          }

          // If we can't determine, include it (conservative approach to avoid data loss)
          filteredInventory[locId] = locData;
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
    const { currentOrg } = useOrg();
    const insets = useSafeAreaInsets();
    const bottomSafePadding = ACTION_BAR_HEIGHT + ACTION_BAR_BOTTOM_OFFSET + insets.bottom + 16;

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

    // Derive images from ProductImages table or PrimaryImageUrl (ProductVariants has no ImageUrls column)
    const displayImages = useMemo(() => {
      if (!detailedItem?.Id) return [];
      try {
        const obs = getLegendStateObservables();
        const productImages = obs?.productImages$?.get?.() ?? {};
        const forVariant = Object.values(productImages).filter((img: any) => img.ProductVariantId === detailedItem.Id);
        if (forVariant.length > 0) {
          return forVariant.sort((a: any, b: any) => (a.Position ?? 0) - (b.Position ?? 0)).map((img: any) => img.ImageUrl);
        }
      } catch { /* Legend may not be ready */ }
      return detailedItem?.PrimaryImageUrl ? [detailedItem.PrimaryImageUrl] : [];
    }, [detailedItem?.Id, detailedItem?.PrimaryImageUrl]);
    const [mappings, setMappings] = useState<PlatformProductMapping[]>([]);
    const [groupedInventory, setGroupedInventory] = useState<GroupedInventoryLocations>({});
    const [connections, setConnections] = useState<PlatformConnection[]>([]);
    const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(!passedItem);

    // Modal states
    const [isActivityModalVisible, setIsActivityModalVisible] = useState(false);
    const [isBarcodeScannerVisible, setIsBarcodeScannerVisible] = useState(false);
    const [isImagePickerVisible, setIsImagePickerVisible] = useState(false);
    const [scannerMounted, setScannerMounted] = useState(false);
    const scannerHeight = useRef(new Animated.Value(0)).current;

    const openBarcodeScanner = useCallback((onResult: (code: string) => void) => {
      scannerHeight.stopAnimation();
      scannerHeight.setValue(0);
      setScannerMounted(true);
      setIsBarcodeScannerVisible(true);
      (ProductDetailScreen as any)._scannerResultHandler = onResult;
      Animated.spring(scannerHeight, {
        toValue: SCANNER_GROW_HEIGHT,
        speed: 18,
        bounciness: 6,
        useNativeDriver: false,
      }).start();
    }, [scannerHeight]);

    const closeBarcodeScanner = useCallback(() => {
      setIsBarcodeScannerVisible(false);
      (ProductDetailScreen as any)._scannerResultHandler = null;
      scannerHeight.stopAnimation();
      Animated.timing(scannerHeight, {
        toValue: 0,
        duration: SCANNER_CLOSE_DURATION,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished) {
          setScannerMounted(false);
        }
      });
    }, [scannerHeight]);

    // Partnership state for share/revoke controls
    interface PartnershipInfo {
      inviteId: string;
      partnerOrgId: string;
      partnerOrgName: string;
      poolName: string;
      canRevoke: boolean;
      isPaused: boolean;
      linkId?: string; // Set if this variant is shared with this partner
      isShared: boolean;
    }
    const [partnerships, setPartnerships] = useState<PartnershipInfo[]>([]);
    const [isLoadingPartnerships, setIsLoadingPartnerships] = useState(false);
    const [partnershipActionLoading, setPartnershipActionLoading] = useState<string | null>(null);
    const isSharedProductRef = useRef(false);

    // Track if initial load has completed to prevent overwrites
    const hasLoadedInitialData = useRef(false);
    // ⚡ CRITICAL: Track platform data loading separately to allow loading when ProductId becomes available
    const hasLoadedPlatformData = useRef(false);
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
    const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const editVersionRef = useRef(0);
    const [isUploadingImages, setIsUploadingImages] = useState(false);
    const listingEditorRef = useRef<ListingEditorFormRef | null>(null);
    const scrollViewRef = useRef<ScrollView | null>(null);

    // Non-blocking notification banner
    const [bannerMessage, setBannerMessage] = useState<string | null>(null);
    const bannerOpacity = useRef(new Animated.Value(0)).current;
    const bannerTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [bannerClickable, setBannerClickable] = useState(false);

    // Show banner notification (auto-hides after 3 seconds, or 5 seconds if clickable)
    const showBanner = useCallback((message: string, clickable: boolean = false) => {
      // Clear any existing timeout
      if (bannerTimeout.current) {
        clearTimeout(bannerTimeout.current);
      }

      setBannerMessage(message);
      setBannerClickable(clickable);

      // Fade in
      Animated.timing(bannerOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Auto-hide after 3 seconds (or 5 seconds for clickable banners)
      bannerTimeout.current = setTimeout(() => {
        Animated.timing(bannerOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setBannerMessage(null);
          setBannerClickable(false);
        });
      }, clickable ? 5000 : 3000);
    }, [bannerOpacity]);


    // Add state after existing states (around line 160, after const [isUploadingImages, setIsUploadingImages] = useState(false);)
    const [variantPricing, setVariantPricing] = useState<any[]>([]);
    // ⚡ CRITICAL: Store raw inventory levels directly from DB for hydration
    const [rawInventoryLevels, setRawInventoryLevels] = useState<InventoryLevel[]>([]);
    // ⚡ Store all variants for this product
    const [allProductVariants, setAllProductVariants] = useState<any[]>([]);
    // Ref to access allProductVariants in realtime callbacks (avoids stale closure)
    const allProductVariantsRef = useRef<any[]>([]);
    const connectionsRef = useRef<PlatformConnection[]>([]);
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

    // Scroll to first changed field when banner is clicked
    const scrollToFirstChangedField = useCallback(() => {
      const changedFields = Object.keys(externalUpdates || {});
      if (changedFields.length === 0) return;

      // Field key mapping to approximate scroll positions
      // These are rough estimates - we'll use a more reliable method
      const fieldOrder = ['title', 'description', 'price', 'sku', 'barcode', 'weight'];
      const firstField = changedFields.sort((a, b) => {
        const aIndex = fieldOrder.indexOf(a);
        const bIndex = fieldOrder.indexOf(b);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      })[0];

      // Try to find the field in the form and scroll to it
      // The form starts around y: 200, and each field is roughly 80px tall
      const fieldPositions: Record<string, number> = {
        title: 200,
        description: 280,
        price: 400,
        sku: 600,
        barcode: 700,
        weight: 500,
      };

      const targetY = fieldPositions[firstField] || 200;
      scrollViewRef.current?.scrollTo({ y: targetY, animated: true });

      console.log(`[ProductDetail] 📍 Scrolled to field: ${firstField} at y: ${targetY}`);
    }, [externalUpdates]);

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

    // Keep refs in sync with state
    useEffect(() => {
      allProductVariantsRef.current = allProductVariants;
    }, [allProductVariants]);
    useEffect(() => {
      connectionsRef.current = connections;
    }, [connections]);

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
    const [deleteConfirmation, setDeleteConfirmation] = useState<{ visible: boolean; platformKey: string }>({ visible: false, platformKey: '' });

    // Custom Action Menu State
    const [actionMenuVisible, setActionMenuVisible] = useState(false);
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

    useEffect(() => {
      editVersionRef.current += 1;
    }, [displayedPlatforms, formData]);

    // State for sync status
    const [syncStatus, setSyncStatus] = useState<any>(null);
    const [fetchErrors, setFetchErrors] = useState<string[]>([]);

    // State for sync loading
    const [isSyncing, setIsSyncing] = useState(false);
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const pendingExternalReloadRef = useRef(false);
    const deferredReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

        // Load all ACTIVE platform connections for the user
        // Connections in 'review', 'scanning', or 'error' status shouldn't show their locations
        const { data: connectionsData, error: connectionsError } = await supabase
          .from('PlatformConnections')
          .select('Id, UserId, OrgId, PlatformType, DisplayName, Status, IsEnabled, LastSyncAttemptAt, LastSyncSuccessAt, CreatedAt, UpdatedAt')
          .eq('UserId', user.id)
          .eq('IsEnabled', true)
          .eq('Status', 'active'); // Only show active connections

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
          .select('Id, ProductVariantId, PlatformConnectionId, PlatformLocationId, PoolId, OrgId, Quantity, Price, CompareAtPrice, Currency, UpdatedAt')
          .in('ProductVariantId', allVariantIds);

        if (inventoryError) {
          console.error('Error loading inventory levels:', inventoryError);
        }

        // Load shared inventory quantities for partner items
        let mergedInventory = (inventoryData as InventoryLevel[]) || [];
        try {
          const { data: sharedLinks, error: sharedError } = await supabase
            .from('CrossOrgProductLinks')
            .select('TargetVariantId, AvailableQuantity, TargetPoolId, Status')
            .in('TargetVariantId', allVariantIds)
            .eq('Status', 'active');

          if (sharedError) {
            console.warn('[ProductDetail] Error loading CrossOrgProductLinks:', sharedError);
          } else if (sharedLinks && sharedLinks.length > 0) {
            isSharedProductRef.current = true;
            const poolQtyByVariant = new Map<string, number>();
            mergedInventory.forEach((level: InventoryLevel) => {
              if (!level.PlatformConnectionId && (level as any).PoolId) {
                const current = poolQtyByVariant.get(level.ProductVariantId) || 0;
                poolQtyByVariant.set(level.ProductVariantId, current + (level.Quantity || 0));
              }
            });

            sharedLinks.forEach((link: any) => {
              const linkQty = link.AvailableQuantity || 0;
              const existingPoolQty = poolQtyByVariant.get(link.TargetVariantId) || 0;
              const hasRealPlatformLevelForVariant = mergedInventory.some(
                (level: InventoryLevel) => level.ProductVariantId === link.TargetVariantId && !!level.PlatformConnectionId
              );

              // Keep pool/synthetic rows as fallback only. If real platform rows exist, platform rows are authoritative.
              if (linkQty > 0 && existingPoolQty <= 0 && !hasRealPlatformLevelForVariant) {
                mergedInventory.push({
                  Id: `shared-${link.TargetVariantId}-${link.TargetPoolId || 'pool'}`,
                  ProductVariantId: link.TargetVariantId,
                  Quantity: linkQty,
                  PlatformConnectionId: null,
                  PlatformLocationId: link.TargetPoolId || 'shared',
                  PoolId: link.TargetPoolId || null,
                  UpdatedAt: new Date().toISOString(),
                } as unknown as InventoryLevel);
              }
            });
          } else {
            isSharedProductRef.current = false;
          }
        } catch (sharedErr) {
          console.warn('[ProductDetail] Failed to merge shared inventory:', sharedErr);
        }

        console.log('[ProductDetail] Loaded inventory levels:', mergedInventory?.length || 0, 'for', allVariantIds.length, 'variants');
        // ⚡ CRITICAL: Store raw inventory levels for displayedPlatforms hydration
        setRawInventoryLevels(mergedInventory || []);

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
          .select('Id, PlatformConnectionId, ProductVariantId, PlatformProductId, PlatformVariantId, PlatformSku, SyncStatus, IsEnabled, LastSyncedAt, UpdatedAt')
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
            const conn = platformConnections.find(c => c.Id === connectionId);
            return conn ? `${conn.DisplayName || conn.PlatformType} Default` : 'Default Location';
          }

          // Show truncated ID if nothing else works
          if (locationId && locationId.length > 10) {
            return `Location (${locationId.substring(0, 8)}...)`;
          }

          return locationId || 'Main Location';
        };

        // If we have inventory data, group it
        if (mergedInventory && mergedInventory.length > 0) {
          // CRITICAL FIX: Hide "Shared Stock" if there is ANY real platform connection for this item
          // regardless of quantity. Examples: Square connected with 0 stock -> Hide Shared Stock.
          const hasRealPlatformLocations = mergedInventory.some((lvl: InventoryLevel) => {
            const conn = platformConnections.find(c => c.Id === lvl.PlatformConnectionId);
            return conn !== undefined; // Simply check if a valid connection exists
          });

          mergedInventory.forEach((level: InventoryLevel) => {
            const connection = platformConnections.find(conn => conn.Id === level.PlatformConnectionId);

            // Handle pool-based inventory (partner shares) - no platform connection but has PoolId
            if (!connection && (level as any).PoolId) {
              // Only add Shared Stock if there are NO real platform locations available
              if (hasRealPlatformLocations) {
                console.log('[ProductDetail] Skipping Shared Stock - valid platform connection exists');
                return; // Skip adding the virtual location
              }

              const poolName = 'Partner Inventory';
              if (!grouped[poolName]) {
                grouped[poolName] = {
                  platformType: 'pool',
                  platformConnectionId: (level as any).PoolId,
                  displayName: poolName,
                  locations: []
                };
              }

              // Check if location already exists
              const existingLocation = grouped[poolName].locations.find(
                loc => loc.locationId === (level as any).PoolId
              );

              if (existingLocation) {
                existingLocation.quantity += (level.Quantity || 0);
              } else {
                grouped[poolName].locations.push({
                  id: level.Id || (level as any).PoolId,
                  locationId: (level as any).PoolId || 'pool',
                  locationName: 'Shared Stock',
                  platformConnectionId: (level as any).PoolId,
                  platformName: poolName,
                  platformType: 'pool',
                  quantity: level.Quantity || 0
                });
              }
              return;
            }

            // CRITICAL FIX: Filter out "Ghost" locations where connection is missing and no PoolId
            // This happens if a connection was deleted but inventory level remains stapled
            if (!connection) {
              console.warn('[ProductDetail] 👻 Ghost inventory detected (No Connection, No PoolId):', level.PlatformConnectionId);
              return;
            }

            // Use DisplayName first, then fall back to a constructed name
            const platformName = connection.DisplayName || `${connection.PlatformType} Account`;
            // Use DB lookup for location name
            const locationName = getLocationNameFromDB(level.PlatformLocationId || 'default', (level.PlatformConnectionId || ''));

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
                platformConnectionId: level.PlatformConnectionId || '',
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

    // ========== PARTNERSHIP FUNCTIONS ==========
    // Load partnerships where this org is the SOURCE (we sent the invite)
    const loadPartnerships = useCallback(async () => {
      if (!currentOrg?.id || !detailedItem) return;

      setIsLoadingPartnerships(true);
      try {
        const token = await ensureSupabaseJwt();
        if (!token) return;

        // Fetch partnerships where we are the source org
        const res = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/partnerships?orgId=${currentOrg.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          console.error('[ProductDetail] Failed to load partnerships:', res.status);
          return;
        }

        const data = await res.json();
        const sentPartnerships = (data.partnerships || []).filter(
          (p: any) => p.direction === 'sent' && p.status !== 'terminated'
        );

        if (sentPartnerships.length === 0) {
          setPartnerships([]);
          return;
        }

        // For each partnership, check if this variant is shared
        const enrichedPartnerships: PartnershipInfo[] = [];

        for (const p of sentPartnerships) {
          // Check if there's a CrossOrgProductLink for this variant in this partnership
          const linkRes = await fetch(
            `${SSSYNC_API_BASE_URL}/api/cross-org/partnerships/${p.id}/products?variantId=${detailedItem.Id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );

          let linkId: string | undefined;
          let isShared = false;

          if (linkRes.ok) {
            const links = await linkRes.json();
            const matchingLink = Array.isArray(links)
              ? links.find((l: any) => l.sourceVariantId === detailedItem.Id && l.status !== 'revoked')
              : null;
            if (matchingLink) {
              linkId = matchingLink.id || matchingLink.linkId;
              isShared = true;
            }
          }

          enrichedPartnerships.push({
            inviteId: p.id,
            partnerOrgId: p.targetOrgId || p.partnerOrgId,
            partnerOrgName: p.targetOrgName || p.partnerOrgName || p.partnerEmail || 'Partner',
            poolName: p.poolName || p.sourcePoolName || 'Shared Pool',
            canRevoke: p.canRevoke !== false && p.shareType !== 'sync',
            isPaused: p.isPaused || false,
            linkId,
            isShared,
          });
        }

        setPartnerships(enrichedPartnerships);
      } catch (error) {
        console.error('[ProductDetail] Error loading partnerships:', error);
      } finally {
        setIsLoadingPartnerships(false);
      }
    }, [currentOrg?.id, detailedItem]);

    // Share this variant with a partner
    const shareWithPartner = async (inviteId: string) => {
      if (!detailedItem) return;

      setPartnershipActionLoading(inviteId);
      try {
        const token = await ensureSupabaseJwt();
        if (!token) throw new Error('No auth token');

        const res = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/partnerships/${inviteId}/products`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ variantIds: [detailedItem.Id] }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText || 'Failed to share');
        }

        const result = await res.json();
        console.log('[ProductDetail] Shared with partner:', result);

        // Refresh partnerships to update share status
        await loadPartnerships();
        Alert.alert('Shared!', 'Product has been shared with the partner.');
      } catch (error: any) {
        console.error('[ProductDetail] Error sharing with partner:', error);
        Alert.alert('Error', error.message || 'Failed to share product');
      } finally {
        setPartnershipActionLoading(null);
      }
    };

    // Revoke this variant from a partner
    const revokeFromPartner = async (linkId: string, partnerName: string) => {
      Alert.alert(
        'Remove from Partner?',
        `This will remove the product from ${partnerName}'s inventory.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              setPartnershipActionLoading(linkId);
              try {
                const token = await ensureSupabaseJwt();
                if (!token) throw new Error('No auth token');

                const res = await fetch(`${SSSYNC_API_BASE_URL}/api/cross-org/links/${linkId}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${token}` },
                });

                if (!res.ok) {
                  const errText = await res.text();
                  throw new Error(errText || 'Failed to revoke');
                }

                console.log('[ProductDetail] Revoked from partner');

                // Refresh partnerships to update share status
                await loadPartnerships();
                Alert.alert('Removed', 'Product has been removed from the partner.');
              } catch (error: any) {
                console.error('[ProductDetail] Error revoking from partner:', error);
                Alert.alert('Error', error.message || 'Failed to remove product');
              } finally {
                setPartnershipActionLoading(null);
              }
            },
          },
        ]
      );
    };

    // Load partnerships when component mounts or org/variant changes
    useEffect(() => {
      if (currentOrg?.id && detailedItem?.Id) {
        loadPartnerships();
      }
    }, [currentOrg?.id, detailedItem?.Id, loadPartnerships]);

    // ========== END PARTNERSHIP FUNCTIONS ==========

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

      // Skip pool / "Shared Stock" when user has any real connection (hide ghost shared stock)
      const hasRealConnection = connections.some(
        (c) =>
          c.IsEnabled &&
          c.PlatformType?.toLowerCase() !== 'pool' &&
          c.PlatformType?.toLowerCase() !== 'csv'
      );

      // Also add any locations from groupedInventory that might not be in allPlatformLocations
      // (edge case: inventory exists but location sync hasn't happened yet)
      // CRITICAL: Apply STRICT platform ID filtering here too!
      Object.values(groupedInventory).forEach(platformGroup => {
        const platform = platformGroup.platformType?.toLowerCase();
        if (!platform) return;
        if (platform === 'pool' && hasRealConnection) return;

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

      // Hide virtual/default locations when platform has at least one real location
      const isVirtualDefault = (l: { id: string; name: string }) =>
        l.id.startsWith('default-') ||
        l.name === 'Default Location' ||
        (l.name != null && l.name.endsWith(' Inventory'));
      Object.keys(locsByPlatform).forEach(platform => {
        const locs = locsByPlatform[platform];
        const hasReal = locs.some(l => !isVirtualDefault(l));
        if (hasReal && locs.length > 0) {
          locsByPlatform[platform] = locs.filter(l => !isVirtualDefault(l));
        }
      });

      // CRITICAL FIX: Ensure every connected platform has at least one location for inventory
      // This handles platforms like eBay that may not have explicit locations in the database
      connections.forEach(conn => {
        const platform = conn.PlatformType?.toLowerCase();
        if (!platform || !conn.IsEnabled) return;

        // If this platform has no locations yet, add a virtual default
        if (!locsByPlatform[platform] || locsByPlatform[platform].length === 0) {
          const connectionName = conn.DisplayName || `${conn.PlatformType} Account`;
          const defaultLocationId = `default-${conn.Id}`;

          locsByPlatform[platform] = [{
            id: defaultLocationId,
            name: `${connectionName} Inventory`,
            connectionId: conn.Id,
            connectionName,
            platformType: platform
          }];

          console.log(`[ProductDetail] Added virtual default location for ${platform}: ${defaultLocationId}`);
        }
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
      const saveStartEditVersion = editVersionRef.current;

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
          return merged as ProductVariant;
        });

        if (editVersionRef.current === saveStartEditVersion) {
          setHasUnsavedChanges(false);
        } else {
          console.log('[ProductDetail] Save completed but local edits changed during request; keeping unsaved state');
          setHasUnsavedChanges(true);
        }
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

    useEffect(() => {
      if (!ENABLE_AUTOSAVE) return;
      if (!hasUnsavedChanges || isSaving) return;

      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      autoSaveTimeoutRef.current = setTimeout(() => {
        performAutoSave();
      }, 1200);

      return () => {
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = null;
        }
      };
    }, [hasUnsavedChanges, isSaving, performAutoSave]);

    useEffect(() => {
      return () => {
        if (deferredReloadTimerRef.current) {
          clearTimeout(deferredReloadTimerRef.current);
          deferredReloadTimerRef.current = null;
        }
      };
    }, []);

    // Track active regeneration jobs: jobId -> platformKey
    const activeRegenJobsRef = useRef<Record<string, string>>({});
    const [generatingPlatformKeys, setGeneratingPlatformKeys] = useState<Set<string>>(new Set());

    // Listen for socket updates for ANY regeneration job we started
    const { onJobProgress } = useCollaboration();

    useEffect(() => {
      if (!onJobProgress) return;

      const unsubscribe = onJobProgress(async (data: any) => {
        const platformKey = activeRegenJobsRef.current[data.jobId];
        if (!platformKey) return; // Not a job we care about

        console.log(`[ProductDetail] Socket update for platform ${platformKey} (job ${data.jobId}): ${data.status}`);

        if (data.status === 'completed') {
          try {
            // If socket has results, use them. Otherwise fetch.
            let resultArray = Array.isArray(data.results) ? data.results : [];

            if (resultArray.length === 0) {
              // Fallback: fetch results if socket didn't include them
              const token = await ensureSupabaseJwt();
              if (SSSYNC_API_BASE_URL && token) {
                const rr = await fetch(`${SSSYNC_API_BASE_URL}/api/products/regenerate/results/${data.jobId}`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (rr.ok) {
                  const json = await rr.json();
                  resultArray = Array.isArray(json?.results) ? json.results : [];
                }
              }
            }

            const productResult = resultArray[0]; // Assuming single product regen
            const platformData = productResult?.platforms?.[platformKey];

            if (platformData) {
              console.log(`[ProductDetail] Got generated data for ${platformKey}:`, Object.keys(platformData));

              // Smart Merge: Don't overwrite existing values with empty strings
              const safePlatformData = { ...platformData };

              // Sanitize: If title/desc are empty strings, remove them from update so we keep existing
              if (safePlatformData.title === '') delete safePlatformData.title;
              if (safePlatformData.description === '') delete safePlatformData.description;
              const now = Date.now();
              const aiFieldChanges: Record<string, { value?: any; updatedAt: number }> = {};
              if (safePlatformData.title !== undefined) aiFieldChanges.title = { value: safePlatformData.title, updatedAt: now };
              if (safePlatformData.description !== undefined) aiFieldChanges.description = { value: safePlatformData.description, updatedAt: now };
              if (safePlatformData.price !== undefined) aiFieldChanges.price = { value: safePlatformData.price, updatedAt: now };
              if (safePlatformData.sku !== undefined) aiFieldChanges.sku = { value: safePlatformData.sku, updatedAt: now };
              if (safePlatformData.barcode !== undefined) aiFieldChanges.barcode = { value: safePlatformData.barcode, updatedAt: now };
              if (safePlatformData.weight !== undefined) aiFieldChanges.weight = { value: safePlatformData.weight, updatedAt: now };

              // Update displayedPlatforms with the generated data
              setDisplayedPlatforms(prev => ({
                ...prev,
                [platformKey]: {
                  ...prev[platformKey],
                  ...safePlatformData,
                }
              }));
              if (Object.keys(aiFieldChanges).length > 0) {
                setExternalUpdates(prev => ({ ...prev, ...aiFieldChanges }));
              }
              setHasUnsavedChanges(true);
              showBanner(`✨ Generated ${platformKey} listing data`);
            }
          } catch (err) {
            console.error(`[ProductDetail] Error processing completion for ${platformKey}:`, err);
            Alert.alert('Generation Error', 'Failed to process generated results.');
          } finally {
            // Cleanup
            delete activeRegenJobsRef.current[data.jobId];
            setGeneratingPlatformKeys(prev => {
              const next = new Set(prev);
              next.delete(platformKey);
              return next;
            });
          }
        } else if (data.status === 'failed' || data.status === 'cancelled') {
          console.warn(`[ProductDetail] Generation failed for ${platformKey}`);
          delete activeRegenJobsRef.current[data.jobId];
          setGeneratingPlatformKeys(prev => {
            const next = new Set(prev);
            next.delete(platformKey);
            return next;
          });
          Alert.alert('Generation Failed', `Failed to generate details for ${platformKey}. Please try again.`);
        }
      });

      return () => unsubscribe();
    }, [onJobProgress, showBanner]);

    // Generate platform-specific data when adding a new platform tab
    const handleGeneratePlatform = useCallback(async (platformKey: string) => {
      if (!detailedItem?.Id) {
        console.warn('[ProductDetail] Cannot generate platform - no item ID');
        return;
      }

      console.log(`[ProductDetail] Generating AI data for platform: ${platformKey}`);

      try {
        // 1. Auto-save first to ensure DB matches UI (prevents state loss on refresh)
        if (hasUnsavedChanges) {
          console.log('[ProductDetail] Auto-saving before generation...');
          await performAutoSave();
        }

        const token = await ensureSupabaseJwt();
        if (!token) {
          console.error('[ProductDetail] No auth token for platform generation');
          return;
        }

        // Mark as generating immediately
        setGeneratingPlatformKeys(prev => new Set(prev).add(platformKey));

        // Submit generate job for this platform
        const submitResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/products/regenerate/submit`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            products: [{
              productId: detailedItem.ProductId,
              variantId: detailedItem.Id,
              regenerateType: 'entire_platform',
              targetPlatform: platformKey,
              imageUrls: displayImages,
            }],
            options: { useExistingScrapedData: true }
          }),
        });

        if (!submitResponse.ok) {
          throw new Error(`Generate submit failed: ${submitResponse.status}`);
        }

        const submitJson = await submitResponse.json();
        const jobId = submitJson?.jobId;

        if (!jobId) {
          throw new Error('No job ID returned from regenerate submit');
        }

        console.log(`[ProductDetail] Regenerate job submitted: ${jobId}`);

        // Track the job
        activeRegenJobsRef.current[jobId] = platformKey;

        // NOTE: We don't poll here anymore. The useEffect socket listener handles completion.

      } catch (error) {
        console.error('[ProductDetail] Platform generation failed:', error);
        Alert.alert('Generation Failed', 'Could not generate platform data. Please try again.');

        // Cleanup on immediate error
        setGeneratingPlatformKeys(prev => {
          const next = new Set(prev);
          next.delete(platformKey);
          return next;
        });
      }
    }, [detailedItem, displayImages, performAutoSave, hasUnsavedChanges]);

    // Detect platforms that have data in displayedPlatforms but no mapping (unpublished)
    const unpublishedPlatforms = useMemo(() => {
      const platformsInEditor = Object.keys(displayedPlatforms).filter(k => k !== 'all');
      const mappedPlatformTypes = new Set(
        mappings.map(m => {
          const conn = connections.find(c => c.Id === m.PlatformConnectionId);
          return conn?.PlatformType?.toLowerCase();
        }).filter(Boolean)
      );

      // Check if we have any "real" platforms connected (excluding pool/csv)
      const hasRealConnections = connections.some(c =>
        c.PlatformType !== 'pool' &&
        c.PlatformType !== 'csv' &&
        // Consider valid if enabled or active, even if needing reauth
        c.IsEnabled
      );

      return platformsInEditor.filter(platform => {
        // Skip if already mapped
        if (mappedPlatformTypes.has(platform)) return false;

        // NEW: Hide 'pool' if we have any real platform connections
        // The pool is a virtual fallback for when no platforms are connected
        if (platform === 'pool' && hasRealConnections) return false;

        // Only include if there's actual data for this platform
        const platformData = displayedPlatforms[platform];
        return platformData && Object.keys(platformData).length > 0;
      });
    }, [displayedPlatforms, mappings, connections]);

    // Publish product to a new platform
    const [isPublishing, setIsPublishing] = useState<string | null>(null);
    const [facebookSyncMeta, setFacebookSyncMeta] = useState<{
      status: 'idle' | 'pending' | 'syncing' | 'success' | 'error';
      lastSyncAt: string | null;
      lastError: string | null;
    }>({ status: 'idle', lastSyncAt: null, lastError: null });

    const handlePublishToPlatform = useCallback(async (platformKey: string) => {
      if (!detailedItem?.Id || isPublishing) return;

      console.log(`[ProductDetail] Publishing to platform: ${platformKey}`);
      setIsPublishing(platformKey);
      let targetConnection: any = null;

      try {
        // 1. Auto-save first to ensure DB matches UI
        // This prevents "state loss" if the page refreshes from DB after publish
        if (hasUnsavedChanges) {
          console.log('[ProductDetail] Auto-saving before publish...');
          await performAutoSave();
        }

        const token = await ensureSupabaseJwt();
        if (!token) {
          Alert.alert('Error', 'Not authenticated');
          return;
        }

        // Find the connection for this platform
        targetConnection = connections.find(c =>
          c.PlatformType.toLowerCase() === platformKey.toLowerCase()
        );

        if (!targetConnection) {
          Alert.alert(
            'No Connection',
            `You don't have a ${platformKey} account connected.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Add Platform',
                style: 'default',
                onPress: () => navigation.navigate('Profile')
              }
            ]
          );
          return;
        }

        // Build the publish payload using the new DTO format
        // Create a copy to modify if needed
        const platformData = { ...(displayedPlatforms[platformKey] || {}) };

        // Build canonical data from the current detailedItem
        const canonicalData = {
          title: detailedItem.Title || platformData.title || 'Untitled',
          sku: detailedItem.Sku || platformData.sku || '',
          price: detailedItem.Price || platformData.price || 0,
          description: detailedItem.Description || platformData.description || '',
          barcode: detailedItem.Barcode || platformData.barcode || '',
          weight: detailedItem.Weight || platformData.weight || 0,
          weightUnit: detailedItem.WeightUnit || platformData.weightUnit || 'lb',
          tags: platformData.tags || [],
        };

        // 🆕 Auto-Detect Category if missing (for Shopify/eBay)
        const isShopify = platformKey.toLowerCase() === 'shopify';
        const isEbay = platformKey.toLowerCase() === 'ebay';
        const hasCategory = isShopify
          ? (platformData.productCategoryId || platformData.productCategory)
          : (platformData.categoryId || platformData.category);

        if ((isShopify || isEbay) && !hasCategory) {
          console.log('[ProductDetail] Missing category for publish, attempting auto-detect...');
          showBanner(`Detecting ${platformKey} category...`);

          try {
            const query = canonicalData.title;
            const normalizedPlatform = platformKey.toLowerCase();
            const url = `${SSSYNC_API_BASE_URL}/api/taxonomy/${normalizedPlatform}/suggest`;
            const payload = {
              query,
              title: canonicalData.title,
              description: canonicalData.description,
              brand: (platformData as any).brand,
              tags: canonicalData.tags,
              categorySuggestion: (platformData as any).categorySuggestion || platformData.categoryPath || platformData.productCategory || platformData.category,
              productType: (platformData as any).productType,
              preferLeaf: true,
              limit: 15,
              useLlm: true,
            };
            const taxRes = await fetch(url, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const taxData = await taxRes.json();

            if (taxData?.suggested) {
              const best = taxData.suggested;
              console.log(`[ProductDetail] Auto-detected category: ${best.path || best.name}`);

              // Apply to platformData
              const bestScore = typeof taxData?.confidence === 'number' ? taxData.confidence : (typeof best.score === 'number' ? best.score : 0);
              const minAutoScore = 0.7;
              if (bestScore < minAutoScore) {
                console.log(`[ProductDetail] Auto-detect score too low (${bestScore}). Skipping auto-apply.`);
                return;
              }

              if (isShopify) {
                platformData.productCategoryId = best.platformCategoryId || best.value;
                platformData.productCategory = best.path || best.name;
                platformData.categoryPath = best.path;
              } else {
                platformData.categoryId = best.platformCategoryId || best.value;
                platformData.category = best.path || best.name;
                platformData.categoryPath = best.path;
              }
              platformData.taxonomyConfidence = bestScore;
              platformData.taxonomySource = taxData?.method || 'llm';

              // Update state so it persists visually if publish fails or succeeds
              setDisplayedPlatforms(prev => ({
                ...prev,
                [platformKey]: { ...prev[platformKey], ...platformData }
              }));
              setHasUnsavedChanges(true);

              showBanner(`Auto-assigned category: ${best.path || best.name}`);
            }
          } catch (e) {
            console.error('[ProductDetail] Auto-detect taxonomy failed:', e);
          }
        }

        const publishPayload = {
          variantId: detailedItem.Id,
          productId: detailedItem.ProductId,
          publishIntent: 'PUBLISH_PLATFORM_LIVE',
          platformDetails: {
            canonical: canonicalData,
            [platformKey]: platformData,
          },
          media: {
            imageUris: displayImages,
            coverImageIndex: 0, // Default to first image
          },
          selectedPlatformsToPublish: [platformKey],
          connectionIds: {
            [platformKey]: [targetConnection.Id],
          },
        };

        if (platformKey.toLowerCase() === 'facebook') {
          setFacebookSyncMeta({ status: 'syncing', lastSyncAt: null, lastError: null });
        }

        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/publish`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(publishPayload),
        });

        const responseData = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(responseData.message || `Publish failed: ${response.status}`);
        }

        if (platformKey.toLowerCase() === 'facebook') {
          const deadline = Date.now() + 10_000;
          let lastPending = 0;

          while (Date.now() < deadline) {
            const reconcileResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/products/facebook-personal/reconcile`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ variantId: detailedItem.Id }),
            });

            if (reconcileResponse.ok) {
              const reconcile = await reconcileResponse.json().catch(() => ({}));
              const updated = Number(reconcile?.updated || 0);
              const failed = Number(reconcile?.failed || 0);
              lastPending = Number(reconcile?.pending || 0);

              if (failed > 0) {
                setFacebookSyncMeta({ status: 'error', lastSyncAt: null, lastError: 'Facebook Marketplace publish failed.' });
                throw new Error('Facebook Marketplace publish failed. Please retry.');
              }
              if (updated > 0 || lastPending === 0) {
                setFacebookSyncMeta({ status: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
                break;
              }
            }

            await new Promise(resolve => setTimeout(resolve, 1200));
          }

          if (lastPending > 0) {
            setFacebookSyncMeta({ status: 'pending', lastSyncAt: null, lastError: null });
            showBanner('Facebook publish is still finishing. We will keep syncing in background.');
          }
        }

        // Check if any platforms need reauth
        if (responseData.reauthRequired && responseData.reauthRequired.length > 0) {
          const reauthPlatform = responseData.reauthRequired[0];
          Alert.alert(
            'Re-authentication Required',
            `Your ${reauthPlatform.connectionDisplayName || reauthPlatform.platform} connection needs to be re-authenticated to continue publishing.`,
            [
              { text: 'Later', style: 'cancel' },
              {
                text: 'Re-authenticate',
                onPress: () => {
                  // Navigate to profile to trigger reauth
                  navigation.navigate('Profile' as never, { openReauth: reauthPlatform.connectionId } as never);
                }
              },
            ]
          );
          return;
        }

        showBanner(`🚀 Published to ${platformKey}!`);

        capture(AnalyticsEvents.PUBLISH_COMPLETED, {
          origin: 'edit',
          product_id: detailedItem?.ProductId,
          variant_id: detailedItem?.Id,
          platforms: [platformKey],
        });

        // Refresh mappings to show the new listing
        await loadPlatformData();

      } catch (error: any) {
        console.error('[ProductDetail] Publish failed:', error);
        if (platformKey.toLowerCase() === 'facebook') {
          setFacebookSyncMeta({
            status: 'error',
            lastSyncAt: facebookSyncMeta.lastSyncAt,
            lastError: error?.message || 'Facebook publish failed',
          });
        }

        // Check for reauth error in exception message
        const errorMessage = error.message?.toLowerCase() || '';
        const isReauthError =
          errorMessage.includes('re-authentication') ||
          errorMessage.includes('reauth') ||
          errorMessage.includes('token expired') ||
          errorMessage.includes('invalid access token');

        if (isReauthError) {
          Alert.alert(
            'Re-authentication Required',
            `Your ${platformKey} connection needs to be re-authenticated. Would you like to fix this now?`,
            [
              { text: 'Later', style: 'cancel' },
              {
                text: 'Re-authenticate',
                onPress: () => navigation.navigate('Profile' as never)
              },
            ]
          );
        } else {
          if (platformKey.toLowerCase() === 'facebook' && targetConnection?.Id && detailedItem?.Id) {
            Alert.alert(
              'Publish Failed',
              error.message || 'Could not publish to platform',
              [
                {
                  text: 'Sync Now',
                  onPress: async () => {
                    try {
                      const token = await ensureSupabaseJwt();
                      if (!token) return;
                      setFacebookSyncMeta({ status: 'syncing', lastSyncAt: facebookSyncMeta.lastSyncAt, lastError: null });
                      await fetch(`${SSSYNC_API_BASE_URL}/api/products/facebook-personal/sync-now`, {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${token}`,
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ connectionId: targetConnection.Id, variantId: detailedItem.Id }),
                      });
                      await fetch(`${SSSYNC_API_BASE_URL}/api/products/facebook-personal/reconcile`, {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${token}`,
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ variantId: detailedItem.Id }),
                      });
                      setFacebookSyncMeta({ status: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
                      showBanner('Facebook sync requested.');
                    } catch (syncErr: any) {
                      setFacebookSyncMeta({ status: 'error', lastSyncAt: facebookSyncMeta.lastSyncAt, lastError: syncErr?.message || 'Sync failed' });
                    }
                  }
                },
                {
                  text: 'Retry Publish',
                  onPress: () => handlePublishToPlatform(platformKey),
                },
                { text: 'Close', style: 'cancel' },
              ]
            );
          } else {
            Alert.alert('Publish Failed', error.message || 'Could not publish to platform');
          }
        }
      } finally {
        setIsPublishing(null);
      }
    }, [detailedItem, connections, displayedPlatforms, isPublishing, showBanner, loadPlatformData, hasUnsavedChanges, performAutoSave, navigation, facebookSyncMeta.lastSyncAt]);
    // Handle Delist / Remove Mapping
    const handleDelist = useCallback(async (connectionId: string, mappingId: string, platformName: string) => {
      Alert.alert('Delist', `Remove listing from ${platformName}?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delist',
          style: 'destructive',
          onPress: async () => {
            try {
              const token = await ensureSupabaseJwt();
              const res = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/mappings/${mappingId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
              });

              if (!res.ok) {
                throw new Error('Failed to delist');
              }

              showBanner(`Deleted listing from ${platformName}`);
              // Refresh data to remove it from the list
              await loadPlatformData();
            } catch (e: any) {
              console.error('Delist failed:', e);
              Alert.alert('Error', 'Could not delete listing. Please try again.');
            }
          }
        }
      ]);
    }, [loadPlatformData, showBanner]);

    // Auto-save function with proper API call
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
        capture(AnalyticsEvents.INVENTORY_UPDATED, { product_id: detailedItem?.ProductId });

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
          // Light compression before upload (0.9 quality, max 1920px) - reduces size with minimal quality loss
          const compressed = await ImageManipulator.manipulateAsync(
            asset.uri,
            [{ resize: { width: 1920 } }], // Only downscale if wider than 1920px
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
          );

          const fileName = `${Date.now()}.jpg`;

          // CRITICAL: Path MUST be {orgId}/{variantId}/{filename} for RLS to work
          const orgId = currentOrg?.id || connections.find(c => c.OrgId)?.OrgId || detailedItem?.UserId;
          const variantId = detailedItem?.Id;

          console.log(`[uploadImagesToSupabase] Resolved orgId: ${orgId}, variantId: ${variantId}`);

          if (!orgId || !variantId) {
            console.error('Missing OrgId or VariantId for upload', { orgId, variantId });
            continue;
          }

          const filePath = `${orgId}/${variantId}/${fileName}`;

          const response = await fetch(compressed.uri);
          const arrayBuffer = await response.arrayBuffer();
          const uint8Array = new Uint8Array(arrayBuffer);

          const { data, error } = await supabase.storage
            .from('product-images')
            .upload(filePath, uint8Array, {
              contentType: 'image/jpeg',
              upsert: false,
              cacheControl: '86400', // 24h - reduces egress via browser cache
            });

          if (error) {
            console.error('Upload error:', error);
            continue;
          }

          const { data: publicUrlData } = supabase.storage
            .from('product-images')
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
        const currentImages = displayImages;
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
        setDetailedItem(prev => prev ? { ...prev } : prev);
        // displayImages will refresh from productImages$ after sync

        Alert.alert('Success', `Added ${imageUrls.length} image(s) to product`);
      } catch (error) {
        console.error('Error adding images to product:', error);
        Alert.alert('Error', 'Failed to add images to product. Please try again.');
      }
    };

    const removeImage = async (imageIndex: number) => {
      if (!detailedItem || displayImages.length === 0) return;

      try {
        const updatedImages = displayImages.filter((_, index) => index !== imageIndex);
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
        setDetailedItem(prev => prev ? { ...prev } : prev);
        // displayImages will refresh from productImages$ after sync

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
        setDetailedItem(prev => prev ? { ...prev } : prev);
        // displayImages will refresh from productImages$ after sync
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
          .select('Id, ProductId, UserId, Sku, Barcode, Title, Description, Price, CompareAtPrice, Options, VariantType, IsArchived, Tags, PrimaryImageUrl, Weight, WeightUnit, RequiresShipping, IsTaxable, TaxCode, Metadata, CreatedAt, UpdatedAt')
          .eq('Id', productId)
          .maybeSingle()  // Use maybeSingle to avoid error when product doesn't exist
          .then(({ data, error }) => {
            if (data) {
              console.log('[ProductDetail] Fetched item from Supabase:', data.Id);
              setDetailedItem(data as ProductVariant);
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
    // Load platform data when product is available - Handle case where ProductId might be missing initially
    useEffect(() => {
      if (!detailedItem) return;

      // 1. Load details if not done yet (gets us the ProductId if missing)
      if (!hasLoadedInitialData.current) {
        console.log('[ProductDetail] Loading initial details for:', detailedItem.Id);
        loadProductDetails();
        hasLoadedInitialData.current = true;
      }

      // 2. Load platform variants & inventory ONLY when we have the ProductId
      if (detailedItem.ProductId && !hasLoadedPlatformData.current) {
        console.log('[ProductDetail] ProductId available, loading platform data:', detailedItem.ProductId);
        loadPlatformData();
        hasLoadedPlatformData.current = true;
      }
    }, [detailedItem?.Id, detailedItem?.ProductId]); // Re-run when ProductId is populated

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
            connectionId: level.PlatformConnectionId || undefined,
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

      // Re-hydrate when mappings add new platforms (e.g. Square published after initial load)
      const mappedPlatformTypesFromMappings = new Set<string>();
      mappings.forEach((m: any) => {
        const conn = connections.find((c: any) => c.Id === m.PlatformConnectionId);
        if (conn) mappedPlatformTypesFromMappings.add(conn.PlatformType?.toLowerCase());
      });
      const currentDisplayedKeys = Object.keys(displayedPlatforms);
      const mappingsAddNewPlatform = [...mappedPlatformTypesFromMappings].some((k) => !currentDisplayedKeys.includes(k));

      if (alreadyHydrated && !inventoryChanged && !locationNamesChanged && !mappingsAddNewPlatform) {
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

      const isSharedProduct = isSharedProductRef.current;
      let canonicalBase = {
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
      };

      // Only merge host platform-specific data for non-shared products
      if (!isSharedProduct) {
        canonicalBase = {
          ...canonicalBase,
          ...(metadata.platformSpecificData?.shopify || {}),
        };
      }

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
        const platformType = connectionToPlatform.get(level.PlatformConnectionId || '');

        // Handle pool-based inventory (forked products with PlatformConnectionId = null)
        // These are shared products where PoolId is set but no platform connection yet
        if (!platformType && (level as any).PoolId) {
          // Add to a special 'pool' platform for shared inventory
          const poolPlatform = 'pool';
          if (!platformLocationState[poolPlatform]) {
            platformLocationState[poolPlatform] = { locations: [], locationQuantities: {} };
          }

          const locId = level.PlatformLocationId || (level as any).PoolId || 'shared';
          const existingLoc = platformLocationState[poolPlatform].locations.find(l => l.id === locId);
          if (!existingLoc) {
            platformLocationState[poolPlatform].locations.push({
              id: locId,
              name: 'Shared Inventory',
              connectionId: (level as any).PoolId,
              connectionName: 'Partner Pool',
            });
          }
          platformLocationState[poolPlatform].locationQuantities[locId] =
            (platformLocationState[poolPlatform].locationQuantities[locId] || 0) + (level.Quantity || 0);
          return;
        }

        if (!platformType) return;  // Skip if no platform and no pool

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
            connectionId: level.PlatformConnectionId || '',
            connectionName: connectionToName.get(level.PlatformConnectionId || '') || platformType,
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

      // ⚡ CRITICAL FIX: Also include platforms from PlatformProductMappings!
      // Forked products may have mappings to Square/Facebook but no platformSpecificData entry
      // Build a set of platforms that have mappings for this product's variants
      const mappedPlatformTypes = new Set<string>();
      mappings.forEach(m => {
        const conn = connections.find(c => c.Id === m.PlatformConnectionId);
        if (conn) {
          mappedPlatformTypes.add(conn.PlatformType.toLowerCase());
        }
      });
      console.log('[ProductDetail] Platforms with mappings:', Array.from(mappedPlatformTypes));

      // Combine: platforms from metadata + platforms from mappings + platforms from inventory
      const allPlatformKeysSet = new Set<string>([
        ...Object.keys(platformSpecificData).map(k => k.toLowerCase()),
        ...Array.from(mappedPlatformTypes),
        ...Object.keys(platformLocationState),
      ]);

      // Filter to only include platforms that make sense to show
      const platformKeys = Array.from(allPlatformKeysSet).filter(keyLower => {
        // Always include if we have actual mappings for this platform
        if (mappedPlatformTypes.has(keyLower)) {
          console.log(`[ProductDetail] Including platform '${keyLower}' - has mappings`);
          return true;
        }

        // Always include if we have active connections for this platform type
        // BUT skip 'pool' here - handle it specifically below so we can hide it if other connections exist
        if (actualPlatformTypes.has(keyLower) && keyLower !== 'pool') return true;

        // Include pool-based inventory ONLY when there are no real connections/mappings
        if (keyLower === 'pool' && platformLocationState['pool']?.locations?.length > 0) {
          const hasRealConnections = connections.some(c =>
            c.PlatformType !== 'pool' && c.PlatformType !== 'csv' && c.IsEnabled
          );

          if (mappedPlatformTypes.size > 0 || hasRealConnections) {
            console.log(`[ProductDetail] Force-excluding platform 'pool' because real connections/mappings exist`);
            return false;
          }

          console.log(`[ProductDetail] Including platform 'pool' - no real connections/mappings`);
          return true;
        }

        // Also include if there's meaningful data in platformSpecificData (for future publishing)
        // This allows platforms like Facebook to show even without a connection
        const platformData = platformSpecificData[keyLower] || platformSpecificData[keyLower.charAt(0).toUpperCase() + keyLower.slice(1)];
        const hasMeaningfulData = platformData && (
          platformData.title ||
          platformData.description ||
          platformData.variants?.length > 0
        );
        if (!isSharedProduct && hasMeaningfulData) {
          console.log(`[ProductDetail] Including platform '${keyLower}' - has data but no active connection (for future publishing)`);
          return true;
        }

        if (isSharedProduct) {
          console.log(`[ProductDetail] Filtering out platform '${keyLower}' - shared product with no mapping/connection`);
          return false;
        }

        // Skip truly empty platforms
        console.log(`[ProductDetail] Filtering out empty platform '${keyLower}' - no data and no connection`);
        return false;
      });

      if (platformKeys.length > 0) {
        const sortedPlatformKeys = [...platformKeys].sort((a, b) => {
          const priority = (key: string) => {
            if (actualPlatformTypes.has(key)) return 0;
            if (mappedPlatformTypes.has(key)) return 1;
            if (key === 'pool') return 2;
            return 3;
          };
          return priority(a) - priority(b);
        });

        sortedPlatformKeys.forEach(platformKey => {
          // platformKey is already lowercase from our normalization
          // Look up the original casing in platformSpecificData
          const originalKey = Object.keys(platformSpecificData).find(k => k.toLowerCase() === platformKey) || platformKey;
          const platformData = platformSpecificData[originalKey] || {};
          const platformKeyLower = platformKey; // Already lowercase

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

          // ⚡ ROOT CAUSE FIX: Build a Set of valid location IDs for THIS platform
          // Then filter each variant's inventoryByLocation to ONLY include this platform's locations
          const perPlatformLocIds = new Set(perPlatformLocs.map((loc: any) => loc.id));

          // Filter each variant to only include inventory for THIS platform's locations
          const platformFilteredVariants = (hydratedVariants || []).map((variant: any) => {
            if (!variant.inventoryByLocation) return variant;

            // If we have platform-specific locations, filter the inventory
            if (perPlatformLocIds.size > 0) {
              const filteredInventory: Record<string, any> = {};
              for (const [locId, locData] of Object.entries(variant.inventoryByLocation)) {
                if (perPlatformLocIds.has(locId)) {
                  filteredInventory[locId] = locData;
                }
              }
              return { ...variant, inventoryByLocation: filteredInventory };
            }

            // No platform-specific locations available, return as-is (legacy behavior)
            return variant;
          });

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
            connectionToPlatform.get(lvl.PlatformConnectionId || '') === platformKeyLower
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
            variants: platformFilteredVariants, // Use platform-filtered variants with only this platform's inventory
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
    }, [detailedItem?.Id, allProductVariants, rawInventoryLevels, hydrateInventoryFromDB, hasUnsavedChanges, isInSaveBlockingWindow, connections, platformLocationNames, mappings]); // Depend on real inventory data + connections + location names + mappings

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

              // DRAFT HYDRATION: If core ProductVariant fields are empty/placeholder
              // but the draft has generated data, merge draft into formData + displayedPlatforms.
              // This covers the case where user scanned → generated → but never completed "Save to Inventory".
              const draft = data.currentDraft?.DraftData;
              const coreFieldsEmpty = !formData.Title || formData.Title.trim() === '' || formData.Price === 0;

              if (draft && coreFieldsEmpty) {
                console.log('[ProductDetail] Core fields empty — hydrating from draft data');

                // Find canonical platform data (prefer shopify, else first key)
                const draftKeys = Object.keys(draft);
                const canonicalKey = draftKeys.includes('shopify') ? 'shopify' : draftKeys[0];
                const canonicalDraft = canonicalKey ? draft[canonicalKey] : null;

                if (canonicalDraft) {
                  // Hydrate formData from draft canonical fields
                  setFormData(prev => ({
                    ...prev,
                    Title: canonicalDraft.title || prev.Title || '',
                    Description: canonicalDraft.description || prev.Description || '',
                    Price: canonicalDraft.price != null ? parseFloat(String(canonicalDraft.price)) || prev.Price : prev.Price,
                    CompareAtPrice: canonicalDraft.compareAtPrice != null ? parseFloat(String(canonicalDraft.compareAtPrice)) || 0 : prev.CompareAtPrice,
                    Sku: canonicalDraft.sku || prev.Sku || '',
                    Barcode: canonicalDraft.barcode || prev.Barcode || '',
                    Weight: canonicalDraft.weight != null ? parseFloat(String(canonicalDraft.weight)) || 0 : prev.Weight,
                    WeightUnit: canonicalDraft.weightUnit || prev.WeightUnit || 'kg',
                  }));

                  // Hydrate displayedPlatforms from draft
                  setDisplayedPlatforms(prev => {
                    const merged = { ...prev };
                    for (const [platformKey, platformData] of Object.entries(draft)) {
                      if (platformData && typeof platformData === 'object') {
                        merged[platformKey] = {
                          ...(merged[platformKey] || {}),
                          ...platformData,
                        };
                      }
                    }
                    return merged;
                  });

                  console.log('[ProductDetail] Draft hydration complete — Title:', canonicalDraft.title?.substring(0, 50), 'Price:', canonicalDraft.price);
                }
              } else {
                console.log('[ProductDetail] Draft loaded for reference only — core fields already populated');
              }
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

    const scheduleDeferredExternalReload = useCallback((reason: string) => {
      pendingExternalReloadRef.current = true;
      if (deferredReloadTimerRef.current) {
        clearTimeout(deferredReloadTimerRef.current);
      }
      const elapsedSinceSave = Date.now() - justSavedTimestampRef.current;
      const remainingBlock = Math.max(0, SAVE_BLOCK_WINDOW_MS - elapsedSinceSave);
      const delayMs = Math.max(350, remainingBlock + 100);

      deferredReloadTimerRef.current = setTimeout(() => {
        if (hasUnsavedChangesRef.current || isInSaveBlockingWindow()) {
          scheduleDeferredExternalReload('still_blocked');
          return;
        }
        if (!pendingExternalReloadRef.current) return;
        pendingExternalReloadRef.current = false;
        console.log(`[ProductDetail] Applying deferred external reload (${reason})`);
        loadPlatformData();
      }, delayMs);
    }, [isInSaveBlockingWindow, loadPlatformData]);

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
              scheduleDeferredExternalReload('product_update_block_window');
              return;
            }

            // CRITICAL: Never update if user has unsaved changes
            if (hasUnsavedChangesRef.current) {
              console.log('[ProductDetail] ⚠️ BLOCKING REALTIME - user has unsaved changes');
              showBanner('External update available. Save your changes first.', false);
              scheduleDeferredExternalReload('product_update_unsaved');
              return;
            }

            if (payload.eventType === 'UPDATE' && payload.new) {
              const updatedProduct = payload.new as ProductVariant;
              console.log('[ProductDetail] Processing realtime update for:', updatedProduct.Title);

              // ✅ CRITICAL FIX: Merge instead of replacing to preserve nested data
              setDetailedItem((prev) => {
                if (!prev) return prev;

                // Check all user-facing scalar fields for meaningful changes.
                const trackedFieldDefs: Array<{ model: keyof ProductVariant; marker: string }> = [
                  { model: 'Title', marker: 'title' },
                  { model: 'Description', marker: 'description' },
                  { model: 'Price', marker: 'price' },
                  { model: 'CompareAtPrice', marker: 'compareAtPrice' },
                  { model: 'Sku', marker: 'sku' },
                  { model: 'Barcode', marker: 'barcode' },
                  { model: 'Weight', marker: 'weight' },
                  { model: 'WeightUnit', marker: 'weightUnit' },
                  { model: 'RequiresShipping', marker: 'requiresShipping' },
                  { model: 'IsTaxable', marker: 'isTaxable' },
                  { model: 'TaxCode', marker: 'taxCode' },
                ];
                const now = Date.now();
                const fieldChanges: Record<string, { value?: any; updatedAt: number }> = {};
                for (const { model, marker } of trackedFieldDefs) {
                  const nextVal = (updatedProduct as any)[model];
                  if (nextVal !== undefined && (prev as any)[model] !== nextVal) {
                    fieldChanges[marker] = { value: nextVal, updatedAt: now };
                  }
                }
                const hasRealChanges = Object.keys(fieldChanges).length > 0;
                if (!hasRealChanges) {
                  console.log('[ProductDetail] No meaningful changes, skipping realtime update');
                  return prev;
                }

                if (Object.keys(fieldChanges).length > 0) {
                  console.log('[ProductDetail] 🟢 External field changes detected:', Object.keys(fieldChanges));
                  setExternalUpdates(prevUpdates => ({ ...prevUpdates, ...fieldChanges }));

                  // 🔄 UPDATE displayedPlatforms to reflect external changes in fields
                  setDisplayedPlatforms(prev => {
                    if (!prev || Object.keys(prev).length === 0) return prev;
                    const updated = { ...prev };
                    const canonicalKey = Object.keys(prev).includes('shopify') ? 'shopify' : Object.keys(prev)[0];
                    const canonical = updated[canonicalKey] || {};

                    // Apply external updates to canonical platform data
                    if (fieldChanges.title && updatedProduct.Title) {
                      updated[canonicalKey] = { ...canonical, title: updatedProduct.Title };
                    }
                    if (fieldChanges.description && updatedProduct.Description) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), description: updatedProduct.Description };
                    }
                    if (fieldChanges.price && updatedProduct.Price !== undefined) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), price: updatedProduct.Price };
                    }
                    if (fieldChanges.sku && updatedProduct.Sku) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), sku: updatedProduct.Sku };
                    }
                    if (fieldChanges.barcode && updatedProduct.Barcode) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), barcode: updatedProduct.Barcode };
                    }
                    if (fieldChanges.weight && updatedProduct.Weight !== undefined) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), weight: updatedProduct.Weight };
                    }
                    if (fieldChanges.compareAtPrice && updatedProduct.CompareAtPrice !== undefined) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), compareAtPrice: updatedProduct.CompareAtPrice };
                    }
                    if (fieldChanges.weightUnit && updatedProduct.WeightUnit !== undefined) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), weightUnit: updatedProduct.WeightUnit };
                    }
                    if (fieldChanges.requiresShipping && updatedProduct.RequiresShipping !== undefined) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), requiresShipping: updatedProduct.RequiresShipping };
                    }
                    if (fieldChanges.isTaxable && updatedProduct.IsTaxable !== undefined) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), isTaxable: updatedProduct.IsTaxable };
                    }
                    if (fieldChanges.taxCode && updatedProduct.TaxCode !== undefined) {
                      updated[canonicalKey] = { ...(updated[canonicalKey] || canonical), taxCode: updatedProduct.TaxCode };
                    }

                    return updated;
                  });

                  // Show banner only when we have actual field changes from external source
                  showBanner('Product updated from external source', true);
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
                    compareAtPrice: updatedProduct.CompareAtPrice ?? updated[platformKey].compareAtPrice,
                    barcode: updatedProduct.Barcode ?? updated[platformKey].barcode,
                    weight: updatedProduct.Weight ?? updated[platformKey].weight,
                    weightUnit: updatedProduct.WeightUnit ?? updated[platformKey].weightUnit,
                    requiresShipping: updatedProduct.RequiresShipping ?? updated[platformKey].requiresShipping,
                    isTaxable: updatedProduct.IsTaxable ?? updated[platformKey].isTaxable,
                    taxCode: updatedProduct.TaxCode ?? updated[platformKey].taxCode,
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

            // CRITICAL: Don't reload if user has unsaved changes - it will overwrite their edits
            if (hasUnsavedChangesRef.current) {
              console.log('[ProductDetail] ⚠️ Skipping inventory reload - user has unsaved changes');
              showBanner('Inventory changed externally. Save your changes first.');
              scheduleDeferredExternalReload('inventory_unsaved');
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

              // Merge into displayedPlatforms so VariantInventoryEditor updates live (hydration skips when count unchanged)
              const conn = connectionsRef.current.find(c => c.Id === updatedLevel.PlatformConnectionId);
              let platformKey = conn?.PlatformType?.toLowerCase();
              let resolvedConnId = conn?.Id;

              const applyDisplayedPlatformsUpdate = (key: string) => {
                setDisplayedPlatforms(prev => {
                  const next = { ...prev };
                  if (!next[key]) {
                    setTimeout(() => loadPlatformData(), 0);
                    return prev;
                  }
                  const plat = next[key];
                  const locIdRaw = updatedLevel.PlatformLocationId ?? 'default';
                  const locs = plat.locations || [];
                  const matchingLoc = locs.find((l: any) => (l.locationId || l.id) === locIdRaw);
                  const keysToUpdate = matchingLoc ? [matchingLoc.id, locIdRaw] : [locIdRaw];
                  const nextLocQty = { ...(plat.locationQuantities || {}) };
                  keysToUpdate.forEach(k => { nextLocQty[k] = updatedLevel.Quantity; });
                  const nextVariants = (plat.variants || []).map((v: any) => {
                    if (v.id !== affectedVariantId) return v;
                    const inv = { ...(v.inventoryByLocation || {}) };
                    const existing = inv[locIdRaw] || inv[keysToUpdate[0]];
                    keysToUpdate.forEach(k => {
                      inv[k] = { quantity: updatedLevel.Quantity, price: updatedLevel.Price ?? existing?.price };
                    });
                    return { ...v, inventoryByLocation: inv };
                  });
                  next[key] = { ...plat, locationQuantities: nextLocQty, variants: nextVariants };
                  return next;
                });
              };

              if (platformKey) {
                applyDisplayedPlatformsUpdate(platformKey);
              } else {
                // Resolve connection on demand when not in ref (e.g. realtime before loadPlatformData finished).
                (async () => {
                  const { data, error } = await supabase
                    .from('PlatformConnections')
                    .select('Id, PlatformType')
                    .eq('Id', updatedLevel.PlatformConnectionId)
                    .single();
                  const resolvedKey = data?.PlatformType?.toLowerCase();
                  if (resolvedKey && !error) {
                    platformKey = resolvedKey;
                    resolvedConnId = data?.Id;
                    applyDisplayedPlatformsUpdate(resolvedKey);
                  } else {
                    console.log('[ProductDetail] Inventory update for variant', affectedVariantId, '- could not resolve connection, refetching platform data');
                    loadPlatformData();
                  }
                })();
              }

              // Green border: per-field keys so only quantity or price input highlights.
              const locIdRaw = updatedLevel.PlatformLocationId ?? 'default';
              const compositeId = `${platformKey ?? 'unknown'}::${resolvedConnId || 'unknown'}::${locIdRaw}`;
              setExternalUpdates(prev => ({
                ...prev,
                [`inventory_${affectedVariantId}_${locIdRaw}_quantity`]: { quantity: updatedLevel.Quantity, updatedAt: Date.now() },
                [`inventory_${affectedVariantId}_${locIdRaw}_price`]: { price: updatedLevel.Price, updatedAt: Date.now() },
                [`inventory_${affectedVariantId}_${compositeId}_quantity`]: { quantity: updatedLevel.Quantity, updatedAt: Date.now() },
                [`inventory_${affectedVariantId}_${compositeId}_price`]: { price: updatedLevel.Price, updatedAt: Date.now() },
              }));

              console.log('[ProductDetail] ✅ Inventory updated in place for variant', affectedVariantId);
              if (!isInSaveBlockingWindow()) {
                showBanner('Inventory updated from external source');
              }
            } else {
              // For INSERT/DELETE, do a full reload only if not in blocking window
              if (isInSaveBlockingWindow()) {
                console.log('[ProductDetail] Inventory INSERT/DELETE while save-blocked - deferring reload');
                scheduleDeferredExternalReload('inventory_insert_delete_blocked');
              } else {
                console.log('[ProductDetail] Inventory INSERT/DELETE - triggering full reload');
                loadPlatformData();
              }
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
              scheduleDeferredExternalReload('mapping_blocked');
              return;
            }

            // Mapping changes are less disruptive - reload if no unsaved changes
            if (!hasUnsavedChangesRef.current) {
              loadPlatformData();
            } else {
              showBanner('Platform mapping changed. Save your changes first.');
              scheduleDeferredExternalReload('mapping_unsaved');
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
    }, [detailedItem?.Id, loadPlatformData, showBanner, isInSaveBlockingWindow, scheduleDeferredExternalReload]);

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
          <TouchableOpacity
            activeOpacity={bannerClickable ? 0.7 : 1}
            onPress={bannerClickable ? scrollToFirstChangedField : undefined}
            disabled={!bannerClickable}
          >
            <Animated.View
              style={[
                styles.notificationBanner,
                {
                  opacity: bannerOpacity,
                  backgroundColor: bannerClickable ? BRAND_PRIMARY + 'E6' : theme.colors.primary + 'E6', // Green for clickable
                }
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <Text style={styles.notificationBannerText}>{bannerMessage}</Text>
                {bannerClickable && (
                  <Icon name="arrow-down" size={16} color="#fff" />
                )}
              </View>
            </Animated.View>
          </TouchableOpacity>
        )}

        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomSafePadding }]}
        >
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
              <TouchableOpacity
                onPress={() => setActionMenuVisible(true)}
                style={styles.refreshButton}
              >
                <Icon name="dots-horizontal" size={24} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>



          {/* Listing editor (edit mode) */}
          <Card style={styles.basicSection}>
            <ListingEditorForm
              ref={listingEditorRef}
              platforms={displayedPlatforms}
              images={displayImages}
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

                    // ⚡ ROOT CAUSE FIX: When merging variants, ONLY include locations that belong to THIS platform
                    // Build a Set of valid location IDs for this platform from its 'locations' array
                    const platformLocationIds = new Set<string>();
                    if (Array.isArray(platformData?.locations)) {
                      platformData.locations.forEach((loc: any) => {
                        if (loc?.id) platformLocationIds.add(loc.id);
                      });
                    }

                    // CRITICAL: Preserve variant inventoryByLocation when merging variants array
                    // BUT filter to ONLY include locations that belong to THIS platform
                    if (Array.isArray(platformData?.variants) && Array.isArray(prevPlatform.variants)) {
                      merged[platformKey].variants = platformData.variants.map((newVariant: any) => {
                        const prevVariant = prevPlatform.variants?.find((v: any) => v.id === newVariant.id);
                        if (prevVariant?.inventoryByLocation) {
                          // Filter previous inventory to only THIS platform's locations
                          const filteredPrevInventory: Record<string, any> = {};
                          for (const [locId, locData] of Object.entries(prevVariant.inventoryByLocation)) {
                            // Only include if: no locations array OR location is in this platform's locations
                            if (platformLocationIds.size === 0 || platformLocationIds.has(locId)) {
                              filteredPrevInventory[locId] = locData;
                            }
                          }

                          // Similarly filter new inventory
                          const filteredNewInventory: Record<string, any> = {};
                          if (newVariant.inventoryByLocation) {
                            for (const [locId, locData] of Object.entries(newVariant.inventoryByLocation)) {
                              if (platformLocationIds.size === 0 || platformLocationIds.has(locId)) {
                                filteredNewInventory[locId] = locData;
                              }
                            }
                          }

                          return {
                            ...newVariant,
                            inventoryByLocation: {
                              ...filteredPrevInventory,
                              ...filteredNewInventory
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
              pendingImages={pendingImages}
              onOpenBarcodeScanner={(onResult) => {
                openBarcodeScanner(onResult);
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
                    const localUris = result.assets.map(a => a.uri);
                    setPendingImages(prev => [...prev, ...localUris]);

                    try {
                      const uploadedUrls = await uploadImagesToSupabase(result.assets);
                      onResult(uploadedUrls);  // Call the callback with uploaded URLs
                      await addImagesToProduct(uploadedUrls);
                    } finally {
                      setPendingImages(prev => prev.filter(uri => !localUris.includes(uri)));
                      setIsUploadingImages(false);
                    }
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
              // 🆕 AI generation for new platforms
              onGeneratePlatform={handleGeneratePlatform}
              generatingPlatformKeys={generatingPlatformKeys}
            />

            {/* Active Listings */}
            <Card style={styles.platformsSection}>
              <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>Active Listings</Text>

              {mappings.length > 0 ? (
                <>
                  {mappings.map((mapping) => {
                    const connection = connections.find(c => c.Id === mapping.PlatformConnectionId);
                    const rawType = connection?.PlatformType || 'unknown';
                    // capitalize first letter
                    const typeLabel = rawType.charAt(0).toUpperCase() + rawType.slice(1);

                    const platformName = connection?.DisplayName || `${typeLabel} Account`;
                    const platformType = rawType;
                    const Logo = getPlatformLogoComponent(platformType);
                    const lastSyncedAt = mapping.LastSyncedAt || null;
                    const parsedSyncMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : 0;
                    const isStale = !parsedSyncMs || (Date.now() - parsedSyncMs) > 24 * 60 * 60 * 1000;
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
                            <Text style={[styles.platformStatus, { color: isStale ? '#B45309' : theme.colors.textSecondary }]}>
                              Last synced: {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Unavailable'}
                              {isStale ? ' • Stale' : ''}
                            </Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={styles.delistButton}
                          onPress={() => handleDelist(mapping.PlatformConnectionId, mapping.Id, platformName)}
                        >
                          <Icon name="archive-outline" size={16} color={theme.colors.text} style={{ marginRight: 6 }} />
                          <Text style={[styles.delistButtonText, { color: theme.colors.text }]}>Delist</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}

                  {/* Unpublished platforms - ready to publish */}
                  {unpublishedPlatforms.length > 0 && (
                    <>
                      <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 12, marginBottom: 8 }}>
                        Ready to publish:
                      </Text>
                      {unpublishedPlatforms.map((platform) => {
                        const Logo = getPlatformLogoComponent(platform);
                        const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
                        const isCurrentlyPublishing = isPublishing === platform;

                        return (
                          <View key={platform} style={[styles.platformRow, { backgroundColor: '#FFFDF4', borderRadius: 8, marginBottom: 4 }]}>
                            <View style={styles.platformInfo}>
                              <View style={[styles.platformLogoContainer, { backgroundColor: '#ffffffff' }]}>
                                {Logo ? (
                                  <Logo width={18} height={18} />
                                ) : (
                                  <Icon name="store" size={18} color={BRAND_PRIMARY} />
                                )}
                              </View>
                              <View style={styles.platformDetails}>
                                <Text style={[styles.platformName, { color: theme.colors.text }]}>{platformLabel}</Text>
                                <Text style={{ fontSize: 12, color: BRAND_PRIMARY }}>Ready to publish</Text>
                              </View>
                            </View>
                            <TouchableOpacity
                              style={[styles.syncButton, { backgroundColor: BRAND_PRIMARY, paddingHorizontal: 16, paddingVertical: 8 }]}
                              onPress={() => handlePublishToPlatform(platform)}
                              disabled={isCurrentlyPublishing}
                            >
                              {isCurrentlyPublishing ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <>
                                  <Icon name="rocket-launch-outline" size={14} color="#fff" style={{ marginRight: 6 }} />
                                  <Text style={{ color: '#fff', fontWeight: '600', fontSize: 14 }}>Publish</Text>
                                </>
                              )}
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </>
                  )}

                  {/* Partner Sharing Section */}
                  {partnerships.length > 0 && (
                    <>
                      <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 16, marginBottom: 8 }}>
                        Partner Sharing:
                      </Text>
                      {partnerships.map((partnership) => {
                        const isLoading = partnershipActionLoading === partnership.inviteId || partnershipActionLoading === partnership.linkId;

                        return (
                          <View
                            key={partnership.inviteId}
                            style={[
                              styles.platformRow,
                              {
                                backgroundColor: partnership.isShared ? '#ffffffff' : '#F9FAFB',
                                borderRadius: 8,
                                marginBottom: 4,
                              },
                            ]}
                          >
                            <View style={styles.platformInfo}>
                              <View style={styles.platformLogoContainer}>
                                <Icon name="account-group-outline" size={18} color={partnership.isShared ? BRAND_PRIMARY : '#FFF'} />
                              </View>
                              <View style={styles.platformDetails}>
                                <Text style={[styles.platformName, { color: theme.colors.text }]} numberOfLines={1}>
                                  {partnership.partnerOrgName}
                                </Text>
                                <Text style={{ fontSize: 12, color: partnership.isShared ? BRAND_PRIMARY : theme.colors.textSecondary }}>
                                  {partnership.isShared ? 'Shared' : 'Not shared'} • {partnership.poolName}
                                </Text>
                              </View>
                            </View>

                            {isLoading ? (
                              <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginRight: 12 }} />
                            ) : partnership.isShared ? (
                              partnership.canRevoke && partnership.linkId ? (
                                <TouchableOpacity
                                  style={[styles.delistButton, { backgroundColor: '#DC2626', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6 }]}
                                  onPress={() => revokeFromPartner(partnership.linkId!, partnership.partnerOrgName)}
                                >
                                  <Icon name="link-off" size={14} color="#ffffffff" style={{ marginRight: 4 }} />
                                  <Text style={{ color: '#ffffffff', fontWeight: '500', fontSize: 13 }}>Remove</Text>
                                </TouchableOpacity>
                              ) : (
                                <View style={[styles.delistButton, { backgroundColor: '#E0E7FF', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6 }]}>
                                  <Icon name="check" size={14} color={BRAND_PRIMARY} style={{ marginRight: 4 }} />
                                  <Text style={{ color: '#ffffffff', fontWeight: '500', fontSize: 13 }}>Shared</Text>
                                </View>
                              )
                            ) : (
                              <TouchableOpacity
                                style={[styles.syncButton, { backgroundColor: BRAND_PRIMARY, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 6 }]}
                                onPress={() => shareWithPartner(partnership.inviteId)}
                              >
                                <Icon name="share-variant-outline" size={14} color="#fff" style={{ marginRight: 4 }} />
                                <Text style={{ color: '#fff', fontWeight: '600', fontSize: 13 }}>Share</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}
                    </>
                  )}

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




          </Card>
        </ScrollView>

        {/* Action Menu Modal */}
        <BaseModal
          onClose={() => setActionMenuVisible(false)}
          visible={actionMenuVisible}
          showCloseButton={false}
          containerStyle={{ width: '85%', maxWidth: 340 }}
        >
          <View style={{ width: '100%' }}>
            {/* Header Row: Spacer - Title - Close */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
              <View style={{ width: 24 }} />
              <Text style={{ fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' }}>
                Product Actions
              </Text>
              <TouchableOpacity onPress={() => setActionMenuVisible(false)}>
                <Icon name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
              onPress={() => {
                setActionMenuVisible(false);
                loadPlatformData();
              }}
            >
              <Icon name="refresh" size={20} color={theme.colors.text} style={{ marginRight: 10 }} />
              <Text style={{ fontSize: 16, fontWeight: '500', color: theme.colors.text }}>Refresh Data</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
              onPress={() => {
                setActionMenuVisible(false);
                Alert.alert(
                  'Archive Product',
                  'Are you sure you want to archive this product? It will be hidden from your active listings.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Archive', style: 'default', onPress: () => console.log('Archive (Placeholder)') }
                  ]
                );
              }}
            >
              <Icon name="archive-outline" size={20} color={theme.colors.warning} style={{ marginRight: 10 }} />
              <Text style={{ fontSize: 16, fontWeight: '500', color: theme.colors.warning }}>Archive Product</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={{ paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
              onPress={() => {
                setActionMenuVisible(false);
                setTimeout(() => {
                  handleDelete();
                }, 400); // Small delay to allow modal to close smoothly
              }}
            >
              <Icon name="delete-outline" size={20} color={theme.colors.error} style={{ marginRight: 10 }} />
              <Text style={{ fontSize: 16, fontWeight: '500', color: theme.colors.error }}>Delete Product</Text>
            </TouchableOpacity>
          </View>
        </BaseModal>

        {/* Sync Status Indicator */}
        {
          hasUnsavedChanges && (
            <BottomActionBar
              primaryLabel={isSaving ? 'Saving…' : 'Save changes'}
              primaryDisabled={isSaving}
              onPrimary={() => performAutoSave()}
            />
          )
        }
        {/* Barcode Scanner Modal */}
        {
          scannerMounted && (
            <View style={styles.scannerDockFull} pointerEvents="box-none">
              <Animated.View pointerEvents={isBarcodeScannerVisible ? 'auto' : 'none'} style={[styles.scannerFullBleed, { height: scannerHeight }]}>
                <CameraView
                  style={StyleSheet.absoluteFillObject}
                  facing={'back'}
                  onBarcodeScanned={isBarcodeScannerVisible ? (result: any) => {
                    const code = result?.data || result?.rawValue;
                    if (code && (ProductDetailScreen as any)._scannerResultHandler) {
                      (ProductDetailScreen as any)._scannerResultHandler(code);
                      closeBarcodeScanner();
                    }
                  } : undefined}
                  barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'] }}
                />
                <TouchableOpacity onPress={closeBarcodeScanner} style={styles.scannerCloseFull}>
                  <Text style={{ color: '#fff', fontSize: 28 }}>×</Text>
                </TouchableOpacity>
              </Animated.View>
            </View>
          )
        }
        {
          isSyncing && (
            <LoadingOverlay visible={isSyncing} message="Syncing to platforms..." onCancel={() => setIsSyncing(false)} />
          )
        }
      </View >
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
  scrollContent: {},
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
    flexDirection: 'row',
    alignItems: 'center',
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

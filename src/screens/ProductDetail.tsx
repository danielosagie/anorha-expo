import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, Switch, FlatList, Animated, Easing, Platform } from 'react-native';
import { ChevronLeft, ChevronRight, Copy, Check, Info, Box, AlertTriangle, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import ProgressiveBlurView from '../components/ProgressiveBlurView';
import { GLASS_HEADER_STYLES } from '../design/chatGlass';
import BaseModal from '../components/BaseModal';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import PlatformLogo from '../components/PlatformLogo';
import { getPlatform } from '../config/platforms';
import ListingEditorForm, { ListingEditorFormRef } from '../components/ListingEditorForm';
import FieldRow from '../components/ListingEditor/FieldRow';
import { CHAT_COLORS, CHAT_FONT } from '../design/chatGlass';
import BottomActionBar from '../components/BottomActionBar';
import { CameraView } from 'expo-camera';
import Card from '../components/Card';
import PlaceholderImage from '../components/PlaceholderImage';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { API_BASE_URL } from '../config/env';
import { createCanonicalBase } from '../utils/platformDataHydration';
import { hasPlatformPrice } from '../utils/platformRequirements';
import {
  savePlatformOverride,
  fetchPlatformOverrides,
  diffOverrideFields,
  normalizeOverridePrice,
  overrideFieldLabel,
  OVERRIDE_FIELDS,
  type PlatformOverrideValues,
} from '../lib/platformOptions';
import {
  ProductVariant,
  PlatformProductMapping,
  InventoryLevel,
  getLegendStateObservables,
  PlatformConnection
} from '../utils/SupaLegend';
import { observer } from '@legendapp/state/react';
import * as ImagePicker from 'expo-image-picker';
import { captureOrPickImageAssets } from '../utils/imageCapture';
import * as ImageManipulator from 'expo-image-manipulator';
import { useCollaboration } from '../hooks/useCollaboration';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
import { useOrg } from '../context/OrgContext';
import LoadingOverlay from '../components/LoadingOverlay';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createLogger } from '../utils/logger';
const log = createLogger('ProductDetail');


const ACTION_BAR_HEIGHT = 80;
const ACTION_BAR_BOTTOM_OFFSET = 24;

// Compact relative time for the Active Listings status rows ("2h ago", "3d ago").
const relTime = (ms: number): string => {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
};
const SCANNER_GROW_HEIGHT = 240;
const SCANNER_CLOSE_DURATION = 220;

// Base URL for API
const SSSYNC_API_BASE_URL = API_BASE_URL;

// Debounced autosave keeps listing/inventory changes live without manual refresh.
const ENABLE_AUTOSAVE = true;

type SerializedSaveSender = (token: number, isLatest: () => boolean) => Promise<boolean>;

// Single-flight, latest-at-send serializer. Requests made during a send share one
// trailing pass; incrementing requestToken also invalidates response-side effects
// from the older pass immediately.
function useLatestSaveSerializer(send: SerializedSaveSender) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const stateRef = useRef<{
    requestToken: number;
    trailing: boolean;
    drain: Promise<boolean> | null;
  }>({ requestToken: 0, trailing: false, drain: null });

  return useCallback((): Promise<boolean> => {
    const state = stateRef.current;
    state.requestToken += 1;
    state.trailing = true;
    if (!state.drain) {
      state.drain = (async () => {
        let latestResult = true;
        while (state.trailing) {
          state.trailing = false;
          const token = state.requestToken;
          try {
            latestResult = await sendRef.current(token, () => token === state.requestToken);
          } catch {
            latestResult = false;
          }
        }
        return latestResult;
      })().finally(() => {
        state.drain = null;
      });
    }
    return state.drain;
  }, []);
}

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
              log.debug(`[cleanPlatformDataForSave] Filtered out location ${locId} from ${platformKey} - not in platform's locations`);
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
              log.debug(`[cleanPlatformDataForSave] Filtered location ${locId} from ${platformKey} - connectionId mismatch`);
            }
            continue;
          }

          // FALLBACK: Pattern matching for common platform ID formats
          const isShopifyLoc = locId.includes('gid://shopify/');
          const isSquareLoc = /^L[A-Z0-9]+$/.test(locId) || (/^[A-Z0-9]{8,}$/.test(locId) && !locId.includes('gid://'));
          const isCloverLoc = /^[A-Z0-9]{13}$/.test(locId); // Clover IDs are typically 13 chars

          // Cross-contamination check
          if (platformKey === 'shopify' && (isSquareLoc || isCloverLoc) && !isShopifyLoc) {
            log.debug(`[cleanPlatformDataForSave] Filtered non-Shopify location ${locId} from Shopify platform`);
            continue;
          }
          if (platformKey === 'square' && (isShopifyLoc || isCloverLoc)) {
            log.debug(`[cleanPlatformDataForSave] Filtered non-Square location ${locId} from Square platform`);
            continue;
          }
          if (platformKey === 'clover' && (isShopifyLoc || isSquareLoc)) {
            log.debug(`[cleanPlatformDataForSave] Filtered non-Clover location ${locId} from Clover platform`);
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
    const fbDispatch = useFacebookJobStatus();
    const insets = useSafeAreaInsets();
    // Bottom "Save changes" bar removed — autosave (1.2s debounce) + the header
    // Saved/Saving…/Unsaved/Retry chip is the only save model now, so the scroll
    // content no longer needs to clear an 80px action bar.
    const bottomSafePadding = insets.bottom + 28;
    // Overview (read-only summary, the mockup's landing) vs Edit (the field form).
    // Edit mode is the existing screen verbatim, so no functionality is lost.
    const [mode, setMode] = useState<'overview' | 'edit'>('overview');

    // 🚨 DEBUG: Intercept all fetch calls from this component
    React.useEffect(() => {
      const originalFetch = window.fetch;
      window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const url = input?.toString() || '';
        if (url.includes('sync-locations')) {
          log.error('[ProductDetail] 🚨 DETECTED sync-locations call from ProductDetail:', url, init);
          // Don't actually make the call - this is forbidden in ProductDetail
          return Promise.reject(new Error('sync-locations calls are forbidden in ProductDetail'));
        }
        if (url.includes('/api/platform-connections/') && url.includes('/sync')) {
          log.warn('[ProductDetail] ⚠️ Platform sync call detected:', url);
        }
        return originalFetch.call(this, input as RequestInfo, init);
      };
      return () => {
        window.fetch = originalFetch;
      };
    }, []);

    // State management
    const [detailedItem, setDetailedItem] = useState<ProductVariant | undefined | null>(passedItem);

    // Direct DB fetch of this variant's ProductImages. The global productImages$ sync has
    // realtime disabled (one-time get at startup), so it frequently doesn't have this item's
    // rows — which made the gallery show "no pictures". This fetch is the reliable source.
    const [dbImagesOverride, setDbImagesOverride] = useState<string[] | null>(null);

    // Derive images: prefer the direct DB fetch, then the global observable, then PrimaryImageUrl.
    // (ProductVariants has no ImageUrls column, so images live in the ProductImages table.)
    const displayImages = useMemo(() => {
      if (!detailedItem?.Id) return [];
      if (dbImagesOverride && dbImagesOverride.length > 0) return dbImagesOverride;
      try {
        const obs = getLegendStateObservables();
        const productImages = obs?.productImages$?.get?.() ?? {};
        const forVariant = Object.values(productImages).filter((img: any) => img.ProductVariantId === detailedItem.Id);
        if (forVariant.length > 0) {
          return forVariant.sort((a: any, b: any) => (a.Position ?? 0) - (b.Position ?? 0)).map((img: any) => img.ImageUrl).filter((u: any): u is string => typeof u === 'string' && u.trim().length > 0);
        }
      } catch { /* Legend may not be ready */ }
      return detailedItem?.PrimaryImageUrl ? [detailedItem.PrimaryImageUrl] : [];
    }, [detailedItem?.Id, detailedItem?.PrimaryImageUrl, dbImagesOverride]);
    // Optimistic layer: edits (add/delete/reorder) show instantly, then we re-follow the
    // synced observable once productImages$ catches up (so it never feels broken).
    const [optimisticImages, setOptimisticImages] = useState<string[] | null>(null);
    const displayImagesKey = displayImages.join('|');
    useEffect(() => { setOptimisticImages(null); }, [displayImagesKey]);
    const editorImages = optimisticImages ?? displayImages;
    const editorImagesRef = useRef<string[]>(editorImages);
    editorImagesRef.current = editorImages;

    // Load this variant's ProductImages directly from Supabase (mirrors GenerateDetails).
    // Reliable even when the global productImages$ observable hasn't synced this item.
    useEffect(() => {
      const variantId = detailedItem?.Id;
      if (!variantId) { setDbImagesOverride(null); return; }
      let canceled = false;
      (async () => {
        try {
          const { data, error } = await supabase
            .from('ProductVariants')
            .select('Id, ProductImages!ProductImages_ProductVariantId_fkey ( ImageUrl, Position )')
            .eq('Id', variantId);
          if (error || !data || canceled) return;
          const row: any = Array.isArray(data) ? data[0] : data;
          const urls: string[] = (row?.ProductImages || [])
            .slice()
            .sort((a: any, b: any) => (a.Position ?? 0) - (b.Position ?? 0))
            .map((img: any) => img.ImageUrl)
            .filter((u: any): u is string => typeof u === 'string' && u.trim().length > 0);
          if (!canceled && urls.length > 0) setDbImagesOverride(urls);
        } catch (e) {
          log.error('[ProductDetail] Failed to load ProductImages:', e);
        }
      })();
      return () => { canceled = true; };
    }, [detailedItem?.Id]);
    const [mappings, setMappings] = useState<PlatformProductMapping[]>([]);
    const [groupedInventory, setGroupedInventory] = useState<GroupedInventoryLocations>({});
    const [connections, setConnections] = useState<PlatformConnection[]>([]);
    const [activityLogs, setActivityLogs] = useState<ActivityLogEntry[]>([]);
    const [isLoading, setIsLoading] = useState<boolean>(!passedItem);
    // Inline error + retry for the by-productId Supabase load (fetch failure / timeout).
    const [loadError, setLoadError] = useState<string | null>(null);
    const [reloadNonce, setReloadNonce] = useState(0);

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
        log.debug('[ProductDetail] In save blocking window, time since save:', timeSinceSave, 'ms');
      }
      return isBlocking;
    }, []);

    // Auto-save state (no more manual editing mode)
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const hasUnsavedChangesRef = useRef(false);
    hasUnsavedChangesRef.current = hasUnsavedChanges;
    const [isSaving, setIsSaving] = useState(false);
    const [lastSaveTime, setLastSaveTime] = useState<number>(0);
    const autoSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Quiet "Saved" confirmation that fades out ~5s after the last save (no persistent badge).
    const savedOpacity = useRef(new Animated.Value(0)).current;
    const editVersionRef = useRef(0);
    const photoVersionRef = useRef(0);
    const textSaveRequestedRef = useRef(false);
    const photoSaveRequestedRef = useRef(false);
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

      log.debug(`[ProductDetail] 📍 Scrolled to field: ${firstField} at y: ${targetY}`);
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
    const displayedPlatformsRef = useRef<Record<string, any>>({});
    displayedPlatformsRef.current = displayedPlatforms;
    const [, forceUpdate] = useState({});

    // Seed a canonical platform from detailedItem the moment we have the product, so the
    // Edit form is NEVER blank when Overview already shows Title/Price/Description. The full
    // hydration effect (variants/inventory/per-platform) still runs and overlays its data on
    // top — the spread order below lets that real data win once it arrives.
    useEffect(() => {
        if (!detailedItem) return;
        const hasCanonical = Object.values(displayedPlatforms).some(
            (p: any) => p && (p.title || p.price != null || p.description),
        );
        if (hasCanonical) return;
        try {
            const canonical = createCanonicalBase(detailedItem as any);
            setDisplayedPlatforms(prev => ({ ...prev, shopify: { ...canonical, ...(prev.shopify || {}) } }));
        } catch (e) {
            log.warn('[ProductDetail] canonical seed failed', e);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detailedItem?.Id]);
    const lastHydratedItemRef = useRef<string | null>(null);
    const lastSavedRef = useRef<string>('');

    // Get displayedPlatforms from ref (for render)
    // const displayedPlatforms = platformsRef.current; // This line is removed

    const updatePlatforms = (updater: (prev: Record<string, any>) => Record<string, any>) => {
      const next = updater(displayedPlatformsRef.current);
      displayedPlatformsRef.current = next;
      setDisplayedPlatforms(next);
      forceUpdate({}); // Trigger re-render
      setUpdateCounter(c => c + 1); // Signal content change
      log.debug('[ProductDetail] Updated platforms, triggering auto-save...');
    };

    // Collaboration state — advisory only. We never block editing on a lock
    // (last-write-wins); a conflict surfaces as a quiet, dismissable banner.
    const collaboration = useCollaboration();

    // Phase 2: Draft state for auto-save and versioning
    const [draftData, setDraftData] = useState<Record<string, any> | null>(null);
    const [isLoadingDraft, setIsLoadingDraft] = useState(false);
    // Surfaced autosave failure (null = no error). Replaces the old silent
    // swallow so a failed save is visible + retryable instead of lost.
    const [saveError, setSaveError] = useState<string | null>(null);

    // ── Per-platform overrides ──────────────────────────────────────────────
    // Edits made on a SPECIFIC platform tab (not the "all"/main view) save to that one
    // channel via the platform-options PUT instead of the canonical autosave (which fans
    // out to every platform). Pending edits accumulate per connection and flush on a
    // debounce, matching the canonical autosave cadence.
    const pendingOverridesRef = useRef<Map<string, PlatformOverrideValues>>(new Map());
    const overrideSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Overrides confirmed this session (from PUT responses). Keyed by connectionId; a field
    // value present = active override, explicit null = cleared. Merged over the server-
    // fetched overrides so the quiet indicator reflects edits immediately, before any reload.
    const [sessionOverrides, setSessionOverrides] = useState<Record<string, PlatformOverrideValues>>({});
    // Server-stored overrides (dedicated ConnectionTitle/Description/Price columns on
    // PlatformProductMappings, read via the platform-options GET). Keyed by connectionId;
    // platformType is the lowercase platform key the value belongs to. A failed fetch
    // simply leaves this empty — the screen falls back to session-only override state.
    const [fetchedOverrides, setFetchedOverrides] = useState<
      Record<string, { platformType: string; values: PlatformOverrideValues }>
    >({});
    // Ref mirror so the (once-per-product) hydration effect can overlay overrides without
    // adding a reactive dependency; and a ref to the refresh fn so loadPlatformData can
    // trigger it without dependency churn.
    const fetchedOverridesRef = useRef<Record<string, { platformType: string; values: PlatformOverrideValues }>>({});
    const refreshOverridesFnRef = useRef<() => void>(() => {});
    // Tracks which variant the override state belongs to; reset on variant switch and used
    // to drop a stale in-flight overrides fetch that resolves after the product changed.
    const overridesVariantIdRef = useRef<string | null>(null);
    useEffect(() => {
      overridesVariantIdRef.current = detailedItem?.Id ?? null;
      fetchedOverridesRef.current = {};
      setFetchedOverrides({});
      setSessionOverrides({});
      pendingOverridesRef.current.clear();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detailedItem?.Id]);

    const [deleteConfirmation, setDeleteConfirmation] = useState<{ visible: boolean; platformKey: string }>({ visible: false, platformKey: '' });

    // Custom Action Menu State
    const [actionMenuVisible, setActionMenuVisible] = useState(false);
    const [draftVersions, setDraftVersions] = useState<Array<{ id: string; createdAt: string; platforms: any; publishedPlatforms?: string[] }>>([]);
    const [versionsVisible, setVersionsVisible] = useState(false);
    const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);

    // Add-to-clearout (campaign) state — publish this product into a clearout
    const [clearoutVisible, setClearoutVisible] = useState(false);
    const [clearoutCampaigns, setClearoutCampaigns] = useState<any[]>([]);
    const [clearoutLoading, setClearoutLoading] = useState(false);
    const [clearoutBusy, setClearoutBusy] = useState<string | null>(null);
    const campaignAdapter = useMemo(() => new HybridConversationDataAdapter(), []);
    // Campaigns this product is currently IN (the "In a campaign" overview card).
    const [productCampaigns, setProductCampaigns] = useState<Array<{ id: string; title: string; soldCount?: number; totalCount?: number }>>([]);
    const loadedProductCampaignsRef = useRef<string | null>(null);

    // Determine which active campaigns this product belongs to (once per product, deferred,
    // capped). Checks each active campaign's items for this variant/product id.
    useEffect(() => {
      const variantId = detailedItem?.Id;
      const productId = (detailedItem as any)?.ProductId;
      if (!variantId || loadedProductCampaignsRef.current === variantId) return;
      loadedProductCampaignsRef.current = variantId;
      let cancelled = false;
      (async () => {
        try {
          const all = await campaignAdapter.listCampaigns().catch(() => []);
          const active = (all || []).filter((c: any) => ['active', 'waiting_user', 'paused'].includes(c.status)).slice(0, 15);
          const matches: Array<{ id: string; title: string; soldCount?: number; totalCount?: number }> = [];
          await Promise.all(active.map(async (c: any) => {
            try {
              const items = await campaignAdapter.getCampaignItems(c.id);
              const inIt = (items || []).some((it: any) => it.productId === variantId || (productId && it.productId === productId));
              if (inIt) matches.push({ id: c.id, title: c.title, soldCount: c.stats?.soldCount, totalCount: c.stats?.totalCount });
            } catch { /* skip this campaign */ }
          }));
          if (!cancelled) setProductCampaigns(matches);
        } catch { /* ignore — card just won't show */ }
      })();
      return () => { cancelled = true; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detailedItem?.Id]);

    const openClearout = useCallback(async () => {
      setActionMenuVisible(false);
      setClearoutVisible(true);
      setClearoutLoading(true);
      try {
        const list = await campaignAdapter.listCampaigns();
        setClearoutCampaigns((list || []).filter((c: any) => c.status === 'active' || c.status === 'waiting_user' || c.status === 'paused'));
      } catch {
        setClearoutCampaigns([]);
      } finally {
        setClearoutLoading(false);
      }
    }, [campaignAdapter]);

    const addToClearout = useCallback(async (campaignId: string, title: string) => {
      if (!detailedItem?.Id || clearoutBusy) return;
      setClearoutBusy(campaignId);
      try {
        await campaignAdapter.addCampaignItems(campaignId, [detailedItem.Id]);
        setClearoutVisible(false);
        // Drop straight into the clearout so the user sees the product in it.
        (navigation as any).navigate('LiquidationCampaignScreen', { campaignId, entryPoint: 'detail' });
      } catch (e: any) {
        Alert.alert('Could not add', e?.message || 'Please try again.');
      } finally {
        setClearoutBusy(null);
      }
    }, [campaignAdapter, detailedItem?.Id, clearoutBusy, navigation]);

    const createClearoutWithProduct = useCallback(async () => {
      if (!detailedItem?.Id || clearoutBusy) return;
      setClearoutBusy('__new__');
      try {
        const name = detailedItem?.Title ? `Clearout · ${String(detailedItem.Title).slice(0, 24)}` : 'New clearout';
        const camp = await campaignAdapter.createCampaign({
          title: name,
          targetRevenue: Math.max(50, Math.round(Number(detailedItem?.Price) || 100)),
          timeframeDays: 14,
          aggressiveness: 'balanced',
          inventoryScope: 'all',
        });
        await campaignAdapter.addCampaignItems(camp.id, [detailedItem.Id]);
        setClearoutVisible(false);
        (navigation as any).navigate('LiquidationCampaignScreen', { campaignId: camp.id, entryPoint: 'detail' });
      } catch (e: any) {
        Alert.alert('Could not create clearout', e?.message || 'Please try again.');
      } finally {
        setClearoutBusy(null);
      }
    }, [campaignAdapter, detailedItem?.Id, detailedItem?.Title, detailedItem?.Price, clearoutBusy, navigation]);

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
    const detailedItemRef = useRef(detailedItem);
    const formDataRef = useRef(formData);
    detailedItemRef.current = detailedItem;
    formDataRef.current = formData;

    // NOTE: editVersionRef is bumped ONLY on a genuine user edit (in
    // ListingEditorForm's onChangePlatforms), NOT here. Bumping it on every
    // displayedPlatforms/formData change made hydration, the save-merge, and
    // realtime echoes advance the token, so performAutoSave's reconcile never
    // matched → the header stuck on "Unsaved" and re-fired duplicate PUTs.

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

    // Fetch this variant's stored per-connection overrides (ConnectionTitle/Description/
    // Price on PlatformProductMappings) via the platform-options GET. Non-blocking and
    // failure-tolerant: any error (404, offline, endpoint not deployed) is swallowed and
    // the screen keeps its session-only override state.
    const refreshPlatformOverrides = useCallback(async () => {
      if (!detailedItem?.ProductId || !detailedItem?.Id) return;
      const variantId = detailedItem.Id;
      const entries = await fetchPlatformOverrides(detailedItem.ProductId, variantId);
      if (!entries) return;
      // Product switched while the fetch was in flight — drop the stale result.
      if (overridesVariantIdRef.current !== variantId) return;
      const next: Record<string, { platformType: string; values: PlatformOverrideValues }> = {};
      for (const entry of entries) {
        if (!entry.hasOverrides) continue;
        const o = entry.overrides || ({} as any);
        const values: PlatformOverrideValues = {};
        if (o.title != null && String(o.title).length > 0) values.title = String(o.title);
        if (o.description != null && String(o.description).length > 0) values.description = String(o.description);
        const price = normalizeOverridePrice(o.price);
        if (price !== null) values.price = price;
        if (Object.keys(values).length === 0) continue;
        next[entry.connectionId] = { platformType: (entry.platformType || '').toLowerCase(), values };
      }
      fetchedOverridesRef.current = next;
      setFetchedOverrides(next);
    }, [detailedItem?.ProductId, detailedItem?.Id]);

    useEffect(() => {
      refreshOverridesFnRef.current = () => { refreshPlatformOverrides(); };
    }, [refreshPlatformOverrides]);

    // Load platform connections and organize inventory with realtime updates
    const loadPlatformData = useCallback(async () => {
      if (!detailedItem) return;

      try {
        if (!currentOrg?.id) return;

        log.debug('[ProductDetail] Loading platform data for variant:', detailedItem.Id, 'ProductId:', detailedItem.ProductId);

        // Refresh the per-connection overrides alongside the platform data (non-blocking;
        // failures fall back to session-only override state).
        refreshOverridesFnRef.current?.();

        // Load all ACTIVE platform connections for the org. (Clerk-native auth configures
        // the Supabase client with an accessToken, which blocks supabase.auth.getUser();
        // connections are org-owned, so scope by OrgId — matches Connections/Settings.)
        const { data: connectionsData, error: connectionsError } = await supabase
          .from('PlatformConnections')
          .select('Id, UserId, OrgId, PlatformType, DisplayName, Status, IsEnabled, LastSyncAttemptAt, LastSyncSuccessAt, CreatedAt, UpdatedAt')
          .eq('OrgId', currentOrg.id)
          .eq('IsEnabled', true)
          .eq('Status', 'active'); // Only show active connections

        if (connectionsError) {
          log.error('Error loading platform connections:', connectionsError);
          return;
        }

        const platformConnections = connectionsData as PlatformConnection[];
        log.debug('[ProductDetail] Loaded platform connections:', platformConnections.length);

        setConnections(platformConnections);

        // ⚡ CRITICAL FIX: Load ALL variants for this product to aggregate inventory
        // If viewing a base variant, inventory is stored against option variants
        // Include Price, Options, Title for proper variant hydration
        const { data: allProductVariantsData, error: variantsError } = await supabase
          .from('ProductVariants')
          .select('Id, Sku, VariantType, Price, CompareAtPrice, Options, Title, Barcode')
          .eq('ProductId', detailedItem.ProductId);

        if (variantsError) {
          log.error('[ProductDetail] Error loading product variants:', variantsError);
        }

        const allVariantIds = allProductVariantsData?.map(v => v.Id) || [detailedItem.Id];
        log.debug('[ProductDetail] Found', allVariantIds.length, 'variants for product');

        // Load inventory levels for ALL variants of this product (base + options)
        const { data: inventoryData, error: inventoryError } = await supabase
          .from('InventoryLevels')
          .select('Id, ProductVariantId, PlatformConnectionId, PlatformLocationId, PoolId, OrgId, Quantity, Price, CompareAtPrice, Currency, UpdatedAt')
          .in('ProductVariantId', allVariantIds);

        if (inventoryError) {
          log.error('Error loading inventory levels:', inventoryError);
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
            log.warn('[ProductDetail] Error loading CrossOrgProductLinks:', sharedError);
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
          log.warn('[ProductDetail] Failed to merge shared inventory:', sharedErr);
        }

        log.debug('[ProductDetail] Loaded inventory levels:', mergedInventory?.length || 0, 'for', allVariantIds.length, 'variants');
        // ⚡ CRITICAL: Store raw inventory levels for displayedPlatforms hydration
        setRawInventoryLevels(mergedInventory || []);

        // ⚡ Store all variants for hydration
        if (allProductVariantsData) {
          log.debug('[ProductDetail] Storing', allProductVariantsData.length, 'variants in state for hydration');
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
            log.error('Error loading platform locations:', locError);
          } else {
            platformLocs?.forEach(loc => {
              // Store by both full ID and just the location ID for flexible lookup
              locationNameMap.set(loc.PlatformLocationId, loc.Name || 'Unnamed Location');
              locationNameMap.set(`${loc.PlatformConnectionId}-${loc.PlatformLocationId}`, loc.Name || 'Unnamed Location');
            });
            log.debug('[ProductDetail] ✅ Loaded', platformLocs?.length || 0, 'location names from DB');
            // ⚡ Store in state for access by buildPlatformLocations
            setPlatformLocationNames(new Map(locationNameMap));
            // ⚡ CRITICAL FIX: Also store full location records for building locations list
            setAllPlatformLocations(platformLocs || []);
          }
        }

        // Load platform mappings for ALL variants
        const { data: mappingsData, error: mappingsError } = await supabase
          .from('PlatformProductMappings')
          .select('Id, PlatformConnectionId, ProductVariantId, PlatformProductId, PlatformVariantId, PlatformSku, SyncStatus, SyncErrorMessage, IsEnabled, LastSyncedAt, UpdatedAt')
          .in('ProductVariantId', allVariantIds);

        if (mappingsError) {
          log.error('Error loading platform mappings:', mappingsError);
        } else {
          log.debug('[ProductDetail] Loaded platform mappings:', mappingsData?.length || 0);
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
            log.warn(`[ProductDetail] Square location ${locationId} not found in PlatformLocations. May need to re-sync locations.`);
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
                log.debug('[ProductDetail] Skipping Shared Stock - valid platform connection exists');
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
              log.warn('[ProductDetail] 👻 Ghost inventory detected (No Connection, No PoolId):', level.PlatformConnectionId);
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
              log.debug(`[ProductDetail] Aggregated inventory for ${locationName}: now ${existingLocation.quantity}`);
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

        log.debug('[ProductDetail] Grouped inventory:', Object.keys(grouped).length, 'platforms');
        Object.entries(grouped).forEach(([platform, data]) => {
          log.debug(`[ProductDetail]   ${platform}: ${data.locations.length} locations, total qty: ${data.locations.reduce((sum, l) => sum + l.quantity, 0)}`);
        });
        setGroupedInventory(grouped);

        // Store mappings for hydration useEffect
        setMappings(mappingsData as PlatformProductMapping[] || []);

      } catch (error) {
        log.warn('Error loading platform data:', error);
      }
    }, [detailedItem, currentOrg?.id]);

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
          log.error('[ProductDetail] Failed to load partnerships:', res.status);
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
        log.error('[ProductDetail] Error loading partnerships:', error);
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
        log.debug('[ProductDetail] Shared with partner:', result);

        // Refresh partnerships to update share status
        await loadPartnerships();
        Alert.alert('Shared!', 'Product has been shared with the partner.');
      } catch (error: any) {
        log.error('[ProductDetail] Error sharing with partner:', error);
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

                log.debug('[ProductDetail] Revoked from partner');

                // Refresh partnerships to update share status
                await loadPartnerships();
                Alert.alert('Removed', 'Product has been removed from the partner.');
              } catch (error: any) {
                log.error('[ProductDetail] Error revoking from partner:', error);
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
        log.debug('[ProductDetail] Skipping reload - user has unsaved changes');
        return;
      }

      try {
        log.debug('[ProductDetail] Loading consolidated product details for variant:', detailedItem.Id);

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
          log.error('[ProductDetail] Error loading variant details:', variantError);
          return;
        }

        if (!variantData) {
          log.warn('[ProductDetail] No variant data found');
          return;
        }

        const variant = variantData;
        const sortedImages = variant.ProductImages
          ?.sort((a: any, b: any) => (a.Position || 0) - (b.Position || 0))
          ?.map((img: any) => img.ImageUrl) || [];

        log.debug('[ProductDetail] Loaded variant with', sortedImages.length, 'images, options:', variant.Options, 'tags:', variant.Tags);

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
          log.warn('[ProductDetail] Error loading all variants:', allVariantsError);
        } else {
          log.debug('[ProductDetail] Loaded all variants for product:', allVariants?.length || 0);
        }



        // ⚡ NOTE: VariantPricing table no longer exists - pricing is stored in InventoryLevels.Price
        // Variants and inventory are loaded in loadPlatformData() instead
        log.debug('[ProductDetail] Variants loaded via loadPlatformData, not VariantPricing table');

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

        log.debug('[ProductDetail] Built display variants:', displayVariants.length);

      } catch (error) {
        log.error('[ProductDetail] Error in loadProductDetails:', error);
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
          log.warn('[ProductDetail] No connection found for location:', loc.PlatformConnectionId);
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
            log.warn(`[ProductDetail] Filtered out likely-Square location from Shopify list: ${locationId}`);
            return;
          }
        } else if (platform === 'square') {
          // Square IDs shouldn't look like Shopify GIDs
          if (locationId.includes('gid://shopify/')) {
            log.warn(`[ProductDetail] Filtered out likely-Shopify location from Square list: ${locationId}`);
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
              log.warn(`[ProductDetail] Fallback: Filtered out likely-Square location from Shopify: ${locationId}`);
              return;
            }
          } else if (platform === 'square') {
            if (locationId.includes('gid://shopify/')) {
              log.warn(`[ProductDetail] Fallback: Filtered out likely-Shopify location from Square: ${locationId}`);
              return;
            }
          }

          const exists = locsByPlatform[platform].some(l => l.id === locationId);
          if (!exists) {
            log.debug('[ProductDetail] Adding location from inventory that was missing from PlatformLocations:', locationId);
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

          log.debug(`[ProductDetail] Added virtual default location for ${platform}: ${defaultLocationId}`);
        }
      });

      // Also surface every platform the PRODUCT is enabled on (On{Platform}), even without a
      // connected account, so the seller can set price/stock for each enabled channel — not
      // just Shopify.
      const enabledFlags: Record<string, boolean> = {
        shopify: !!(detailedItem as any)?.OnShopify,
        square: !!(detailedItem as any)?.OnSquare,
        clover: !!(detailedItem as any)?.OnClover,
        amazon: !!(detailedItem as any)?.OnAmazon,
        ebay: !!(detailedItem as any)?.OnEbay,
        facebook: !!(detailedItem as any)?.OnFacebook,
      };
      Object.entries(enabledFlags).forEach(([platform, on]) => {
        if (!on) return;
        if (locsByPlatform[platform] && locsByPlatform[platform].length > 0) return;
        const conn = connections.find(c => c.PlatformType?.toLowerCase() === platform);
        const label = platform.charAt(0).toUpperCase() + platform.slice(1);
        const connectionName = conn?.DisplayName || `${label}`;
        locsByPlatform[platform] = [{
          id: conn ? `default-${conn.Id}` : `default-${platform}`,
          name: `${connectionName} Inventory`,
          connectionId: conn?.Id ?? '',
          connectionName,
          platformType: platform,
        }];
      });

      log.debug('[ProductDetail] buildPlatformLocations result:',
        Object.entries(locsByPlatform).map(([p, locs]) => `${p}: ${locs.length} locations`).join(', '));

      return locsByPlatform;
    }, [allPlatformLocations, connections, groupedInventory, platformLocationNames, detailedItem]);

    const sendSerializedProductSave = useCallback<SerializedSaveSender>(async (_sendToken, isLatest) => {
      const saveText = textSaveRequestedRef.current;
      const savePhotos = photoSaveRequestedRef.current;
      textSaveRequestedRef.current = false;
      photoSaveRequestedRef.current = false;
      if (!saveText && !savePhotos) return true;

      const item = detailedItemRef.current;
      if (!item) return false;
      const saveStartEditVersion = editVersionRef.current;
      const saveStartPhotoVersion = photoVersionRef.current;
      const platformSnapshot = JSON.parse(JSON.stringify(displayedPlatformsRef.current || {}));
      const currentForm = { ...formDataRef.current };
      const imageSnapshot = [...editorImagesRef.current];
      const cleanedPlatformData = cleanPlatformDataForSave(platformSnapshot);
      const canonicalKey = Object.keys(platformSnapshot).includes('shopify') ? 'shopify' : Object.keys(platformSnapshot)[0];
      const canonical = platformSnapshot[canonicalKey] || {};
      const updateData: Record<string, any> = {};

      if (saveText) {
        Object.assign(updateData, {
          Title: canonical.title || currentForm.Title,
          Description: canonical.description || currentForm.Description,
          Price: canonical.price !== undefined && canonical.price !== '' && !isNaN(Number(canonical.price)) ? Number(canonical.price) : currentForm.Price,
          CompareAtPrice: canonical.compareAtPrice !== undefined && canonical.compareAtPrice !== '' && !isNaN(Number(canonical.compareAtPrice)) ? Number(canonical.compareAtPrice) : currentForm.CompareAtPrice,
          Sku: canonical.sku || currentForm.Sku,
          Barcode: canonical.barcode || currentForm.Barcode,
          Weight: canonical.weight !== undefined && canonical.weight !== '' && !isNaN(Number(canonical.weight)) ? Number(canonical.weight) : currentForm.Weight,
          WeightUnit: canonical.weightUnit || currentForm.WeightUnit,
          RequiresShipping: canonical.requiresShipping !== undefined ? canonical.requiresShipping : currentForm.RequiresShipping,
          IsTaxable: currentForm.IsTaxable,
          TaxCode: currentForm.TaxCode,
          PlatformSpecificData: cleanedPlatformData,
          Tags: canonical.tags || [],
          Vendor: canonical.vendor,
          ProductType: canonical.productType,
        });
        setIsSaving(true);
      }
      if (savePhotos) updateData.ImageUrls = imageSnapshot;

      try {
        const authToken = await ensureSupabaseJwt();
        if (!authToken) throw new Error('Not signed in. Changes not saved');
        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${item.Id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(updateData),
        });
        const saveResult = await response.json().catch(() => null);
        if (!response.ok) throw new Error(saveResult?.message || `Failed to update product. Status: ${response.status}`);
        if (!isLatest()) return true;

        justSavedTimestampRef.current = Date.now();
        if (saveText) {
          const failedPlatforms: any[] = Array.isArray(saveResult?.warnings)
            ? saveResult.warnings
            : (saveResult?.syncStatus?.platforms || []).filter(
                (p: any) => p?.status === 'error' || (Array.isArray(p?.errors) && p.errors.length > 0),
              );
          if (failedPlatforms.length > 0) {
            const names = failedPlatforms.map((p: any) => {
              const name = (p?.platform || '').toString();
              return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'a channel';
            }).filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i);
            const label = names.length <= 1 ? (names[0] || 'a channel') : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
            showBanner(`Saved — didn’t reach ${label}`, true);
            loadPlatformData().catch(() => {});
          }

          setDetailedItem(prev => prev ? ({
            ...prev,
            ...updateData,
            Metadata: { ...(prev as any).Metadata, platformSpecificData: cleanedPlatformData },
          } as ProductVariant) : prev);
          const textStillCurrent = editVersionRef.current === saveStartEditVersion;
          hasUnsavedChangesRef.current = !textStillCurrent;
          setHasUnsavedChanges(!textStillCurrent);
          setLastSaveTime(Date.now());
          setSaveError(null);
          setDraftData(null);
        } else if (savePhotos && photoVersionRef.current === saveStartPhotoVersion) {
          // Photo persistence is independent of text dirtiness. Never clear the
          // product-wide text dirty flag after a gallery-only save.
          setDetailedItem(prev => prev ? { ...prev } : prev);
        }
        return true;
      } catch (error) {
        log.error('Serialized product save failed:', error);
        if (isLatest()) {
          if (saveText) {
            hasUnsavedChangesRef.current = true;
            setHasUnsavedChanges(true);
            setSaveError(error instanceof Error ? error.message : 'Save failed');
          }
          if (savePhotos) setOptimisticImages(null);
        }
        return false;
      } finally {
        if (isLatest()) setIsSaving(false);
      }
    }, [showBanner, loadPlatformData]);

    const requestProductSave = useLatestSaveSerializer(sendSerializedProductSave);

    // Truthful save result for publish/generation/exit; background callers simply
    // ignore false and leave the dirty/error state intact.
    const performAutoSave = useCallback(async (): Promise<boolean> => {
      if (!detailedItemRef.current) return false;
      if (!hasUnsavedChangesRef.current) return true;
      textSaveRequestedRef.current = true;
      return requestProductSave();
    }, [requestProductSave]);

    // ── Per-platform override save path ─────────────────────────────────────
    // Separate from performAutoSave: an edit on a specific platform tab targets ONE
    // connection (never fanned out). Canonical/main-tab edits still go through
    // performAutoSave above, untouched.

    // Fold a server-confirmed override into the session record. Prefer the authoritative
    // `overrides` the server echoes; fall back to what we sent. Empty/null fields drop out
    // so the indicator only reflects real overrides.
    const mergeConfirmedOverride = useCallback(
      (
        prev: PlatformOverrideValues | undefined,
        sent: PlatformOverrideValues,
        returned: Record<string, unknown> | undefined,
      ): PlatformOverrideValues => {
        const base: any = { ...(prev || {}) };
        const apply = (src: Record<string, any>) => {
          for (const f of OVERRIDE_FIELDS) if (f in src) base[f] = src[f];
        };
        apply(sent as any);
        if (returned && typeof returned === 'object') apply(returned as any);
        for (const f of OVERRIDE_FIELDS) {
          const v = base[f];
          if (v === null || v === undefined || v === '') delete base[f];
        }
        return base as PlatformOverrideValues;
      },
      [],
    );

    // Map a platform tab key (e.g. 'ebay') to the connection to override. Prefer an existing
    // mapping for this variant; fall back to any enabled connection of that platform type.
    const resolveConnectionIdForPlatform = useCallback(
      (platformKey: string): string | undefined => {
        const lower = platformKey.toLowerCase();
        const mapping = mappings.find(
          (m) =>
            m.ProductVariantId === detailedItem?.Id &&
            (connections.find((c) => c.Id === m.PlatformConnectionId)?.PlatformType || '').toLowerCase() === lower,
        );
        if (mapping?.PlatformConnectionId) return mapping.PlatformConnectionId;
        const conn = connections.find((c) => (c.PlatformType || '').toLowerCase() === lower && c.IsEnabled);
        return conn?.Id;
      },
      [mappings, connections, detailedItem?.Id],
    );

    const platformLabelForConnection = useCallback(
      (connectionId: string): string => {
        const conn = connections.find((c) => c.Id === connectionId);
        const raw = (conn?.PlatformType || '').toString();
        return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'this channel';
      },
      [connections],
    );

    // Active overrides per connection: server-fetched (dedicated ConnectionTitle/
    // ConnectionDescription/ConnectionPrice mapping columns, via the platform-options GET)
    // merged under this session's confirmed PUT results — session wins, including clears.
    const overridesByConnection = useMemo(() => {
      const out: Record<string, PlatformOverrideValues> = {};
      for (const [connId, info] of Object.entries(fetchedOverrides)) {
        out[connId] = { ...info.values };
      }
      for (const [connId, ov] of Object.entries(sessionOverrides)) {
        const merged: any = { ...(out[connId] || {}) };
        for (const f of OVERRIDE_FIELDS) {
          if (f in ov) {
            const v = (ov as any)[f];
            if (v === null || v === undefined || v === '') delete merged[f];
            else merged[f] = v;
          }
        }
        if (Object.keys(merged).length > 0) out[connId] = merged;
        else delete out[connId];
      }
      return out;
    }, [fetchedOverrides, sessionOverrides]);

    // Seed the platform tabs' displayed title/description/price from the fetched overrides,
    // so an overridden eBay tab opens with its custom values instead of canonical. Only the
    // override fields are touched; a field with a pending (unflushed) edit is skipped; and
    // this writes displayedPlatforms directly — never through onChangePlatforms — so the
    // per-tab diff heuristic below can't mistake seeding for a user edit.
    useEffect(() => {
      const seeds: Array<{ platformKey: string; values: PlatformOverrideValues }> = [];
      for (const [connId, info] of Object.entries(fetchedOverrides)) {
        const platformKey =
          info.platformType ||
          (connections.find((c) => c.Id === connId)?.PlatformType || '').toLowerCase();
        if (!platformKey) continue;
        // Session-confirmed values win over the fetched snapshot (including clears).
        const merged: any = { ...info.values };
        const sess = sessionOverrides[connId];
        if (sess) {
          for (const f of OVERRIDE_FIELDS) {
            if (f in sess) {
              const v = (sess as any)[f];
              if (v === null || v === undefined || v === '') delete merged[f];
              else merged[f] = v;
            }
          }
        }
        const pending = pendingOverridesRef.current.get(connId);
        if (pending) {
          for (const f of OVERRIDE_FIELDS) if (f in pending) delete merged[f];
        }
        if (Object.keys(merged).length > 0) seeds.push({ platformKey, values: merged });
      }
      if (seeds.length === 0) return;
      setDisplayedPlatforms((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const { platformKey, values } of seeds) {
          const cur = prev[platformKey];
          if (!cur) continue; // platform not hydrated yet — the hydration overlay covers it
          const patch: any = {};
          if (values.title !== undefined && String(cur.title ?? '') !== String(values.title)) patch.title = values.title;
          if (values.description !== undefined && String(cur.description ?? '') !== String(values.description)) patch.description = values.description;
          if (values.price !== undefined && normalizeOverridePrice(cur.price) !== normalizeOverridePrice(values.price)) patch.price = values.price;
          if (Object.keys(patch).length > 0) {
            next[platformKey] = { ...cur, ...patch };
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, [fetchedOverrides, sessionOverrides, connections]);

    // Flush the debounced pending overrides — one PUT per connection, serialized
    // as a batch. Failed fields are merged back under any newer pending values.
    const sendSerializedOverrides = useCallback<SerializedSaveSender>(async (_sendToken, isLatest) => {
      const item = detailedItemRef.current;
      if (!item) return false;
      const entries = Array.from(pendingOverridesRef.current.entries());
      pendingOverridesRef.current.clear();
      if (entries.length === 0) return true;
      const productId = item.ProductId;
      const variantId = item.Id;
      let anyRefresh = false;
      let allSucceeded = true;
      for (const [connectionId, fields] of entries) {
        const label = platformLabelForConnection(connectionId);
        try {
          const { ok, data } = await savePlatformOverride(productId, variantId, connectionId, fields);
          if (!ok || !data?.success) {
            const newer = pendingOverridesRef.current.get(connectionId) || {};
            pendingOverridesRef.current.set(connectionId, { ...fields, ...newer });
            allSucceeded = false;
            if (isLatest()) showBanner(`Couldn’t save custom ${label} details`, false);
            continue;
          }
          if (isLatest()) {
            setSessionOverrides((prev) => ({
              ...prev,
              [connectionId]: mergeConfirmedOverride(prev[connectionId], fields, data.overrides),
            }));
          }
          // pushed:false = the override SAVED but the live push failed. Calm notice, and the
          // refresh below repaints the Active Channels dot from the new SyncStatus.
          if (data.pushed === false && isLatest()) {
            showBanner(`Saved for ${label} — didn’t reach ${label}`, true);
          }
          anyRefresh = true;
        } catch {
          const newer = pendingOverridesRef.current.get(connectionId) || {};
          pendingOverridesRef.current.set(connectionId, { ...fields, ...newer });
          allSucceeded = false;
          if (isLatest()) showBanner(`Couldn’t save custom ${label} details`, false);
        }
      }
      if (anyRefresh) {
        loadPlatformData().catch(() => {});
        refreshOverridesFnRef.current();
      }
      return allSucceeded;
    }, [detailedItem, platformLabelForConnection, showBanner, loadPlatformData, mergeConfirmedOverride]);

    const requestOverrideFlush = useLatestSaveSerializer(sendSerializedOverrides);
    const flushPendingOverrides = useCallback(async (): Promise<boolean> => {
      if (pendingOverridesRef.current.size === 0) return true;
      return requestOverrideFlush();
    }, [requestOverrideFlush]);

    // Always fire the latest flush closure from the debounce timer.
    const flushOverridesRef = useRef<() => Promise<boolean>>(async () => true);
    useEffect(() => {
      flushOverridesRef.current = flushPendingOverrides;
    }, [flushPendingOverrides]);

    const queueOverrideSave = useCallback((connectionId: string, fields: PlatformOverrideValues) => {
      const prev = pendingOverridesRef.current.get(connectionId) || {};
      pendingOverridesRef.current.set(connectionId, { ...prev, ...fields });
      if (overrideSaveTimeoutRef.current) clearTimeout(overrideSaveTimeoutRef.current);
      overrideSaveTimeoutRef.current = setTimeout(() => { void flushOverridesRef.current(); }, 1200);
    }, []);

    // Decide whether a form change is a per-platform override (a single specific-tab edit of
    // title/description/price) vs a canonical/all edit. Relies on the form's own semantics:
    // an "all" edit fans the value to EVERY platform key, so >1 platform moves; a specific
    // tab moves exactly one. With <2 platforms there's no per-platform distinction.
    const detectOverrideEdit = useCallback(
      (
        prev: Record<string, any>,
        next: Record<string, any>,
      ): { platformKey: string; connectionId: string; fields: PlatformOverrideValues } | null => {
        const keys = Object.keys(next).filter(
          (k) => typeof k === 'string' && k.trim().length > 0 && k.toLowerCase() !== 'pool',
        );
        const availableKeys = Object.keys(prev).filter((k) => k.toLowerCase() !== 'pool');
        if (availableKeys.length < 2) return null;
        const changed: Array<{ platformKey: string; fields: PlatformOverrideValues }> = [];
        for (const k of keys) {
          const diff = diffOverrideFields(prev[k], next[k]);
          if (diff) changed.push({ platformKey: k, fields: diff });
        }
        if (changed.length !== 1) return null;
        const { platformKey, fields } = changed[0];
        const connectionId = resolveConnectionIdForPlatform(platformKey);
        if (!connectionId) return null;
        return { platformKey, connectionId, fields };
      },
      [resolveConnectionIdForPlatform],
    );

    // "Use main details" — clear this connection's overridden fields back to canonical.
    const resetOverride = useCallback(
      async (connectionId: string, platformKey: string) => {
        if (!detailedItem) return;
        const current = overridesByConnection[connectionId];
        if (!current) return;
        const clearFields: any = {};
        for (const f of OVERRIDE_FIELDS) if (f in current) clearFields[f] = null;
        const label = platformLabelForConnection(connectionId);
        try {
          const { ok, data } = await savePlatformOverride(
            detailedItem.ProductId,
            detailedItem.Id,
            connectionId,
            clearFields,
          );
          if (!ok || !data?.success) {
            showBanner(`Couldn’t reset ${label}`, false);
            return;
          }
          setSessionOverrides((prev) => ({ ...prev, [connectionId]: { ...(prev[connectionId] || {}), ...clearFields } }));
          // Revert the tab's shown value to the canonical main details.
          setDisplayedPlatforms((prev) => {
            const p = prev[platformKey];
            if (!p) return prev;
            const reverted: any = { ...p };
            if ('title' in clearFields) reverted.title = detailedItem.Title || '';
            if ('description' in clearFields) reverted.description = detailedItem.Description || '';
            if ('price' in clearFields) reverted.price = detailedItem.Price != null ? Number(detailedItem.Price) : reverted.price;
            return { ...prev, [platformKey]: reverted };
          });
          if (data.pushed === false) showBanner(`Reset ${label} — didn’t reach ${label}`, true);
          loadPlatformData().catch(() => {});
        } catch {
          showBanner(`Couldn’t reset custom ${label} details`, false);
        }
      },
      [detailedItem, overridesByConnection, platformLabelForConnection, showBanner, loadPlatformData],
    );

    useEffect(() => {
      if (!ENABLE_AUTOSAVE) return;
      if (!hasUnsavedChanges || isSaving) return;
      // Stop hot-retrying a persistent failure; a new user edit clears saveError
      // (and the header "Retry" / manual Save button retries directly).
      if (saveError) return;

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
    }, [hasUnsavedChanges, isSaving, saveError, performAutoSave]);

    const performAutoSaveRef = useRef<() => Promise<boolean>>(async () => true);
    performAutoSaveRef.current = performAutoSave;
    const exitSavePromiseRef = useRef<Promise<boolean> | null>(null);
    const flushPendingSaves = useCallback((): Promise<boolean> => {
      if (exitSavePromiseRef.current) return exitSavePromiseRef.current;
      if (overrideSaveTimeoutRef.current) {
        clearTimeout(overrideSaveTimeoutRef.current);
        overrideSaveTimeoutRef.current = null;
      }
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
      const promise = Promise.all([
        flushOverridesRef.current(),
        performAutoSaveRef.current(),
      ]).then((results) => results.every(Boolean));
      exitSavePromiseRef.current = promise;
      void promise.finally(() => {
        if (exitSavePromiseRef.current === promise) exitSavePromiseRef.current = null;
      });
      return promise;
    }, []);

    useEffect(() => {
      let allowNextRemove = false;
      let exitPending = false;
      const removeBeforeRemove = (navigation as any).addListener('beforeRemove', (event: any) => {
        if (allowNextRemove) return;
        event.preventDefault();
        if (exitPending) return;
        exitPending = true;
        void Promise.race<boolean>([
          flushPendingSaves(),
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3000)),
        ]).finally(() => {
          allowNextRemove = true;
          (navigation as any).dispatch(event.data.action);
        });
      });
      const removeBlur = (navigation as any).addListener('blur', () => { void flushPendingSaves(); });
      return () => {
        removeBeforeRemove();
        removeBlur();
        void flushPendingSaves();
      };
    }, [navigation, flushPendingSaves]);

    // Show a quiet "Saved" then fade it out after 5s of no changes. While saving or with
    // unsaved edits it stays hidden (the header shows "Saving…" instead).
    useEffect(() => {
      if (isSaving || hasUnsavedChanges || saveError || lastSaveTime <= 0) {
        savedOpacity.setValue(0);
        return;
      }
      savedOpacity.setValue(1);
      const hideTimer = setTimeout(() => {
        Animated.timing(savedOpacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
      }, 5000);
      return () => clearTimeout(hideTimer);
    }, [lastSaveTime, isSaving, hasUnsavedChanges, saveError, savedOpacity]);

    // Restore a previous saved version as the working draft (R3 versions UI).
    const restoreDraftVersion = useCallback(async (versionId: string) => {
      if (!detailedItem?.Id || restoringVersionId) return;
      setRestoringVersionId(versionId);
      try {
        const token = await ensureSupabaseJwt();
        if (!token) throw new Error('Not signed in');
        const res = await fetch(
          `${SSSYNC_API_BASE_URL}/api/products/drafts/${detailedItem.Id}/restore-version/${versionId}`,
          { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({} as any));
          throw new Error(err.message || `Restore failed (${res.status})`);
        }
        setVersionsVisible(false);
        setHasUnsavedChanges(false);
        // Re-load so the restored draft hydrates the editor.
        await loadProductDetails();
        Alert.alert('Version restored', 'This version is now your working draft.');
      } catch (e: any) {
        Alert.alert('Could not restore', e?.message || 'Please try again.');
      } finally {
        setRestoringVersionId(null);
      }
    }, [detailedItem?.Id, restoringVersionId, loadProductDetails]);

    // Refresh the version list whenever the history sheet opens, so a version
    // just created by a save appears without a full screen reload.
    useEffect(() => {
      if (!versionsVisible || !detailedItem?.Id) return;
      let canceled = false;
      (async () => {
        try {
          const token = await ensureSupabaseJwt();
          if (!token) return;
          const res = await fetch(`${SSSYNC_API_BASE_URL}/api/products/drafts/${detailedItem.Id}`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          if (res.ok && !canceled) {
            const data = await res.json();
            setDraftVersions(data.versions || []);
          }
        } catch (e) {
          log.debug('[ProductDetail] versions refresh on open failed', e);
        }
      })();
      return () => { canceled = true; };
    }, [versionsVisible, detailedItem?.Id]);

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

        log.debug(`[ProductDetail] Socket update for platform ${platformKey} (job ${data.jobId}): ${data.status}`);

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
              log.debug(`[ProductDetail] Got generated data for ${platformKey}:`, Object.keys(platformData));

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
            log.error(`[ProductDetail] Error processing completion for ${platformKey}:`, err);
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
          log.warn(`[ProductDetail] Generation failed for ${platformKey}`);
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
        log.warn('[ProductDetail] Cannot generate platform - no item ID');
        return;
      }

      log.debug(`[ProductDetail] Generating AI data for platform: ${platformKey}`);

      try {
        // 1. Auto-save first to ensure DB matches UI (prevents state loss on refresh)
        log.debug('[ProductDetail] Ensuring latest edits are saved before generation...');
        if (!(await performAutoSave())) throw new Error('Could not save the latest edits before generation');

        const token = await ensureSupabaseJwt();
        if (!token) {
          log.error('[ProductDetail] No auth token for platform generation');
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

        log.debug(`[ProductDetail] Regenerate job submitted: ${jobId}`);

        // Track the job
        activeRegenJobsRef.current[jobId] = platformKey;

        // NOTE: We don't poll here anymore. The useEffect socket listener handles completion.

      } catch (error) {
        log.error('[ProductDetail] Platform generation failed:', error);
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
    // FB dispatch status is now realtime (useFacebookJobStatus) — no local poll state.

    const handlePublishToPlatform = useCallback(async (platformKey: string) => {
      if (!detailedItem?.Id || isPublishing) return;

      log.debug(`[ProductDetail] Publishing to platform: ${platformKey}`);
      setIsPublishing(platformKey);
      let targetConnection: any = null;

      try {
        // 1. Auto-save first to ensure DB matches UI
        // This prevents "state loss" if the page refreshes from DB after publish
        log.debug('[ProductDetail] Ensuring latest edits are saved before publish...');
        if (!(await performAutoSave())) throw new Error('Could not save the latest edits before publishing');

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
                onPress: () => navigation.navigate('AccountSettings')
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
          log.debug('[ProductDetail] Missing category for publish, attempting auto-detect...');
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
              log.debug(`[ProductDetail] Auto-detected category: ${best.path || best.name}`);

              // Apply to platformData
              const bestScore = typeof taxData?.confidence === 'number' ? taxData.confidence : (typeof best.score === 'number' ? best.score : 0);
              const minAutoScore = 0.7;
              if (bestScore < minAutoScore) {
                log.debug(`[ProductDetail] Auto-detect score too low (${bestScore}). Skipping auto-apply.`);
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
            log.error('[ProductDetail] Auto-detect taxonomy failed:', e);
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

        // Facebook posts asynchronously through the user's computer — no blocking
        // reconcile poll here (it delayed the UI ~10s for an unrendered result).
        // loadPlatformData() below refreshes the row, which shows the live dispatch
        // status (useFacebookJobStatus).

        // The backend returns results[] with the true per-platform outcome. Old
        // backends omit it, so when results[] is absent we fall back to the previous
        // "response.ok means success" behavior.
        const platformResults: any[] = Array.isArray(responseData?.results) ? responseData.results : [];
        const thisResult = platformResults.find(
          (r: any) => (r?.platform || '').toString().toLowerCase() === platformKey.toLowerCase(),
        );
        const resultErrorText = (thisResult?.error || '').toString();

        // Reauth: honor the per-result reauthRequired flag and the legacy top-level
        // reauthRequired[] list. As a safety net also treat an auth-shaped error string
        // as a reauth trigger even when the flag is missing (mirrors the catch block).
        const looksLikeAuthError = /token|auth|unauthorized|expired/i.test(resultErrorText);
        const legacyReauth = Array.isArray(responseData?.reauthRequired) && responseData.reauthRequired.length > 0
          ? responseData.reauthRequired[0]
          : null;
        const needsReauth =
          (thisResult && (thisResult.reauthRequired === true || (thisResult.success === false && looksLikeAuthError))) ||
          !!legacyReauth;

        if (needsReauth) {
          const reauthConnectionId = legacyReauth?.connectionId ?? targetConnection?.Id;
          const reauthName = legacyReauth?.connectionDisplayName || legacyReauth?.platform || targetConnection?.DisplayName || platformKey;
          Alert.alert(
            'Re-authentication Required',
            `Your ${reauthName} connection needs to be re-authenticated to continue publishing.`,
            [
              { text: 'Later', style: 'cancel' },
              {
                text: 'Re-authenticate',
                onPress: () => {
                  // Navigate to profile to trigger reauth
                  navigation.navigate('Profile' as never, (reauthConnectionId ? { openReauth: reauthConnectionId } : {}) as never);
                }
              },
            ]
          );
          return;
        }

        // When results[] reports this platform failed, surface the error and DO NOT
        // show the success banner — the listing never went live.
        if (thisResult && thisResult.success === false) {
          Alert.alert(
            'Publish Failed',
            resultErrorText || `Could not publish to ${platformKey}. Please try again.`,
          );
          await loadPlatformData();
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
        log.error('[ProductDetail] Publish failed:', error);
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
                      await fetch(`${SSSYNC_API_BASE_URL}/api/products/facebook-personal/sync-now`, {
                        method: 'POST',
                        headers: {
                          'Authorization': `Bearer ${token}`,
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ connectionId: targetConnection.Id, variantId: detailedItem.Id }),
                      });
                      showBanner('Facebook sync requested.');
                    } catch (syncErr: any) {
                      showBanner('Sync failed. Please try again.');
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
    }, [detailedItem, connections, displayedPlatforms, isPublishing, showBanner, loadPlatformData, hasUnsavedChanges, performAutoSave, navigation]);
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
              log.error('Delist failed:', e);
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
        editVersionRef.current += 1;
        hasUnsavedChangesRef.current = true;
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

        log.debug('Inventory updated successfully');
        capture(AnalyticsEvents.INVENTORY_UPDATED, { product_id: detailedItem?.ProductId });

      } catch (error) {
        log.error('Failed to update inventory:', error);
        Alert.alert('Error', 'Failed to update inventory. Please try again.');
      }
    }, [detailedItem]);

    // Image management functions
    const applyEditorImageUpdate = useCallback((updater: (current: string[]) => string[]) => {
      const previous = editorImagesRef.current;
      const next = Array.from(new Set(updater(previous).filter(Boolean)));
      editorImagesRef.current = next;
      photoVersionRef.current += 1;
      setOptimisticImages((currentOptimistic) => {
        const current = currentOptimistic ?? previous;
        const functionalNext = Array.from(new Set(updater(current).filter(Boolean)));
        editorImagesRef.current = functionalNext;
        return functionalNext;
      });
      return next;
    }, []);

    const persistPhotoGallery = useCallback(async (): Promise<boolean> => {
      photoSaveRequestedRef.current = true;
      return requestProductSave();
    }, [requestProductSave]);

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
        log.error('Error picking images:', error);
        setIsUploadingImages(false);
        Alert.alert('Error', 'Failed to pick images. Please try again.');
      }
    };

    const uploadImagesToSupabase = async (assets: ImagePicker.ImagePickerAsset[]): Promise<string[]> => {
      const uploadedUrls: string[] = [];

      // CRITICAL: Path MUST be {orgId}/{variantId}/{filename} for RLS to work.
      // Resolve once up front — if either is missing, every upload would fail
      // silently, so surface it as a clear error instead of returning [].
      const orgId = currentOrg?.id || connections.find(c => c.OrgId)?.OrgId || detailedItem?.UserId;
      const variantId = detailedItem?.Id;
      log.debug(`[uploadImagesToSupabase] Resolved orgId: ${orgId}, variantId: ${variantId}`);
      if (!orgId || !variantId) {
        log.error('Missing OrgId or VariantId for upload', { orgId, variantId });
        throw new Error("Couldn't determine your organization for this item. Try reopening it or reconnecting your store.");
      }

      let lastError: string | null = null;

      for (const asset of assets) {
        try {
          // Light compression before upload (0.9 quality, max 1920px) - reduces size with minimal quality loss
          const compressed = await ImageManipulator.manipulateAsync(
            asset.uri,
            [{ resize: { width: 1920 } }], // Only downscale if wider than 1920px
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
          );

          const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
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
            log.error('Upload error:', error);
            lastError = error.message || 'Storage upload failed';
            continue;
          }

          const { data: publicUrlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(filePath);

          uploadedUrls.push(publicUrlData.publicUrl);
        } catch (error: any) {
          log.error('Error uploading image:', error);
          lastError = error?.message || 'Upload failed';
        }
      }

      // If nothing made it through, don't fail silently — tell the caller why.
      if (uploadedUrls.length === 0 && assets.length > 0) {
        throw new Error(lastError || 'Image upload failed. Please try again.');
      }

      return uploadedUrls;
    };

    const addImagesToProduct = async (imageUrls: string[]) => {
      if (!detailedItem || imageUrls.length === 0) return;

      try {
        applyEditorImageUpdate(current => [...current, ...imageUrls]);
        if (!(await persistPhotoGallery())) throw new Error('Failed to update product images');
        Alert.alert('Success', `Added ${imageUrls.length} image(s) to product`);
      } catch (error) {
        log.error('Error adding images to product:', error);
        Alert.alert('Error', 'Failed to add images to product. Please try again.');
      }
    };

    const removeImage = async (imageIndex: number) => {
      if (!detailedItem || editorImagesRef.current.length === 0) return;

      try {
        applyEditorImageUpdate(current => current.filter((_, index) => index !== imageIndex));
        if (!(await persistPhotoGallery())) throw new Error('Failed to update product images');
        Alert.alert('Success', 'Image removed from product');
      } catch (error) {
        log.error('Error removing image:', error);
        Alert.alert('Error', 'Failed to remove image. Please try again.');
      }
    };

    const reorderImages = async (nextImageUrls: string[]) => {
      if (!detailedItem) return;
      try {
        applyEditorImageUpdate(() => nextImageUrls);
        if (!(await persistPhotoGallery())) throw new Error('Failed to reorder images');
      } catch (error) {
        log.error('Error reordering images:', error);
        setOptimisticImages(null);
        Alert.alert('Save failed', 'Please try again.');
      }
    };

    // In the delete handler
    const handleDelete = () => {
      Alert.alert(
        'Archive product',
        'Archive this product?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Archive', onPress: () => archiveProduct() },
        ]
      );
    };

    // Add functions
    const archiveProduct = async () => {
      if (!detailedItem?.Id) return;
      try {
        const token = await ensureSupabaseJwt();
        if (!token) throw new Error('Authentication required');
        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/products/${detailedItem.Id}/archive`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error('Archive failed');
        navigation.goBack();
      } catch (error) {
        log.error('Error archiving product:', error);
        Alert.alert('Archive failed', 'Please try again.');
      }
    };

    // Load initial data
    useEffect(() => {
      if (!productId) {
        log.error('No Product ID found');
        setIsLoading(false);
        setDetailedItem(null);
        return;
      }

      const observables = getLegendStateObservables();
      if (!observables?.productVariants$) {
        log.error("[ProductDetailScreen] Legend-State observables not available.");
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
        // Fallback: Fetch from Supabase if not in local state.
        // Non-UUID ids (synthetic quick-scan candidates like "match-...",
        // "agent_0") can never be rows — skip the query and land on the honest
        // empty state instead of a Postgres uuid-cast error alert.
        const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(productId));
        if (!uuidLike) {
          log.warn('[ProductDetail] Non-UUID productId (unsaved scan candidate?):', productId);
          setDetailedItem(null);
          setIsLoading(false);
          Alert.alert(
            'Not saved yet',
            'This item is a scan result that has not been added to your inventory yet. Finish the item in the cart to save it.',
          );
          return;
        }
        setIsLoading(true);
        setLoadError(null);
        // Ignore responses that land after productId/passedItem changed, so a
        // stale lookup can't overwrite the newer product's state.
        let canceled = false;
        const VARIANT_COLS = 'Id, ProductId, UserId, Sku, Barcode, Title, Description, Price, CompareAtPrice, Options, VariantType, IsArchived, Tags, PrimaryImageUrl, Weight, WeightUnit, RequiresShipping, IsTaxable, TaxCode, Metadata, CreatedAt, UpdatedAt';
        const applyVariant = (data: any) => {
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
        };
        // The PostgREST client can hang on a dropped connection without ever
        // rejecting, which used to leave the screen stuck on the spinner. Race each
        // query against a 15s timeout and route every failure (query error, thrown
        // rejection, or timeout) into a single retryable inline error state.
        const LOAD_TIMEOUT_MS = 15000;
        const withTimeout = <T,>(p: PromiseLike<T>): Promise<T> =>
          Promise.race([
            Promise.resolve(p),
            new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS)),
          ]);
        (async () => {
          try {
            const { data, error } = await withTimeout(
              supabase
                .from('ProductVariants')
                .select(VARIANT_COLS)
                .eq('Id', productId)
                .maybeSingle(),  // maybeSingle avoids an error when the product doesn't exist
            );
            if (canceled) return;
            if (error) throw error;
            if (data) {
              log.debug('[ProductDetail] Fetched item from Supabase:', data.Id);
              applyVariant(data);
              setIsLoading(false);
              return;
            }
            // Not a variant id. Some callers (chat activity cards) pass a
            // parent Products.Id — resolve its first variant before giving up.
            const { data: byProduct, error: byProductError } = await withTimeout(
              supabase
                .from('ProductVariants')
                .select(VARIANT_COLS)
                .eq('ProductId', productId)
                .order('CreatedAt', { ascending: true })
                .limit(1)
                .maybeSingle(),
            );
            if (canceled) return;
            if (byProductError) throw byProductError;
            if (byProduct) {
              log.debug('[ProductDetail] Resolved variant via ProductId:', byProduct.Id);
              applyVariant(byProduct);
            } else {
              // A genuinely-missing product (not a fetch failure) — keep the honest
              // "not found" empty state rather than the retryable error.
              log.warn('[ProductDetail] Product not found with ID:', productId);
              setDetailedItem(null);
              Alert.alert('Product Not Found', 'This product may still be syncing or no longer exists.');
            }
            setIsLoading(false);
          } catch (err: any) {
            if (canceled) return;
            log.error('[ProductDetail] Failed to load product:', err);
            setDetailedItem(null);
            setIsLoading(false);
            setLoadError(
              err?.message === 'timeout'
                ? 'This is taking longer than usual. Check your connection and try again.'
                : 'We couldn’t load this product. Please try again.',
            );
          }
        })();
        return () => { canceled = true; };
      }
    }, [productId, passedItem, reloadNonce]);

    // Load platform data when product is available - ONLY ONCE
    // Load platform data when product is available - Handle case where ProductId might be missing initially
    useEffect(() => {
      if (!detailedItem) return;

      // 1. Load details if not done yet (gets us the ProductId if missing)
      if (!hasLoadedInitialData.current) {
        log.debug('[ProductDetail] Loading initial details for:', detailedItem.Id);
        loadProductDetails();
        hasLoadedInitialData.current = true;
      }

      // 2. Load platform variants & inventory ONLY when we have the ProductId
      if (detailedItem.ProductId && !hasLoadedPlatformData.current) {
        log.debug('[ProductDetail] ProductId available, loading platform data:', detailedItem.ProductId);
        loadPlatformData();
        hasLoadedPlatformData.current = true;
      }
    }, [detailedItem?.Id, detailedItem?.ProductId]); // Re-run when ProductId is populated

    // Helper: Hydrate inventory data from InventoryLevels into variant structure
    // ⚡ CRITICAL FIX: Use ProductVariants directly, not VariantPricing (which doesn't exist)
    const hydrateInventoryFromDB = useCallback((variants: any[], invLevels: InventoryLevel[]): any[] => {
      if (!variants || variants.length === 0) {
        log.debug('[ProductDetail] hydrateInventoryFromDB: No variants to hydrate');
        return [];
      }
      if (!invLevels || invLevels.length === 0) {
        log.debug('[ProductDetail] hydrateInventoryFromDB: No inventory levels, returning variants without inventory');
      }

      log.debug('[ProductDetail] hydrateInventoryFromDB: Hydrating', variants.length, 'variants with', invLevels?.length || 0, 'inventory levels');

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

        log.debug('[ProductDetail] Hydrated variant', v.Sku || v.Id, 'with', Object.keys(inventoryByLocation).length, 'locations, total qty:',
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
        log.debug('[ProductDetail] Skipping useEffect - in save blocking window, preserving displayedPlatforms');
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
        log.debug('[ProductDetail] ⚠️ Already hydrated for product', detailedItem.Id, '- skipping to preserve data');
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
        log.debug('[ProductDetail] Waiting for variant data before hydrating displayedPlatforms');
        return;
      }

      log.debug('[ProductDetail] Data ready for hydration - variants:', allProductVariants?.length, 'inventory:', rawInventoryLevels?.length);

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

      log.debug('[ProductDetail] Setting displayedPlatforms with tags:', canonicalBase.tags,
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
          log.debug('[ProductDetail] Filtering out base variant:', v.Sku || v.Id);
          return false;
        }
        return true;
      });
      log.debug('[ProductDetail] Filtered variants: all=', allProductVariants?.length, 'displayable=', displayableVariants.length);

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

      log.debug('[ProductDetail] Built platformLocationState from rawInventoryLevels:',
        Object.entries(platformLocationState).map(([k, v]) => `${k}: ${v.locations.length} locs`).join(', '));

      log.debug('[ProductDetail] Hydrated variants:', hydratedVariants.length,
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
      log.debug('[ProductDetail] Platforms with mappings:', Array.from(mappedPlatformTypes));

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
          log.debug(`[ProductDetail] Including platform '${keyLower}' - has mappings`);
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
            log.debug(`[ProductDetail] Force-excluding platform 'pool' because real connections/mappings exist`);
            return false;
          }

          log.debug(`[ProductDetail] Including platform 'pool' - no real connections/mappings`);
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
          log.debug(`[ProductDetail] Including platform '${keyLower}' - has data but no active connection (for future publishing)`);
          return true;
        }

        if (isSharedProduct) {
          log.debug(`[ProductDetail] Filtering out platform '${keyLower}' - shared product with no mapping/connection`);
          return false;
        }

        // Skip truly empty platforms
        log.debug(`[ProductDetail] Filtering out empty platform '${keyLower}' - no data and no connection`);
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
          log.debug('[ProductDetail] Using', hydratedVariants.length, 'freshVariants for platforms. First variant optionValues:',
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
          // Keep the SAVED per-platform price/compareAtPrice from Metadata — that's
          // exactly what the user's last save wrote. Only the inventory-derived
          // collections (variants/locations/quantities) come from live InventoryLevels.
          const {
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
            ...safePlatformData,        // Platform-specific SEO, titles, descriptions, and SAVED price
            // Saved metadata price wins (it's the user's last edit); fall back to live
            // InventoryLevels, then canonical, only when metadata has no price.
            price: safePlatformData.price ?? livePrice ?? canonicalBase.price,
            compareAtPrice: safePlatformData.compareAtPrice ?? liveCompareAtPrice ?? canonicalBase.compareAtPrice,
            options: safePlatformData.options || (detailedItem.Options && typeof detailedItem.Options === 'object'
              ? Object.entries(detailedItem.Options).map(([name, values]) => ({ name, values: Array.isArray(values) ? values : [values] }))
              : []),
            variants: platformFilteredVariants, // Use platform-filtered variants with only this platform's inventory
            locations: perPlatformLocs, // Use per-platform locations
            locationQuantities: perPlatformLocQty,
          };
        });
        log.debug('[ProductDetail] Built platforms from metadata:', platformKeys, 'with per-platform locations:',
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
        log.debug('[ProductDetail] No platformSpecificData, using shopify as default with', shopifyLocs.length, 'locations');
      }

      // Overlay the fetched per-connection overrides (ConnectionTitle/Description/Price on
      // the mapping row — NOT in Metadata.platformSpecificData, so the build above only has
      // canonical values). This makes an overridden tab hydrate with its custom values when
      // the overrides GET resolved before this effect; the seeding effect handles the
      // fetch-after-hydration order. Read via ref — this effect must not re-run on fetch.
      for (const info of Object.values(fetchedOverridesRef.current)) {
        const key = info.platformType;
        if (!key || !allPlatforms[key]) continue;
        allPlatforms[key] = { ...allPlatforms[key], ...info.values };
      }

      // ⚡ Set displayedPlatforms - this only runs on FIRST load for this product
      // The early return above prevents re-hydration
      setDisplayedPlatforms(allPlatforms);

      // Mark as hydrated for this product AFTER setting state
      hasHydratedPlatformsRef.current = detailedItem.Id;
      lastHydratedInventoryCountRef.current = currentInventoryCount;
      log.debug('[ProductDetail] ✅ Initial hydration complete for product', detailedItem.Id,
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
        log.debug('[ProductDetail] Draft already fetched for product', detailedItem.Id, '- skipping');
        return;
      }

      // GUARD 3: Don't fetch if user has unsaved changes (this would overwrite them!)
      if (hasUnsavedChanges) {
        log.debug('[ProductDetail] User has unsaved changes - skipping draft fetch');
        return;
      }

      let canceled = false;
      setIsLoadingDraft(true);

      (async () => {
        try {
          const token = await ensureSupabaseJwt();
          const baseUrl = API_BASE_URL;

          if (!token) {
            log.debug('[ProductDetail] No auth token for draft loading');
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
              log.debug('[ProductDetail] ✅ Loaded draft data:', data);
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
                log.debug('[ProductDetail] Core fields empty — hydrating from draft data');

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

                  log.debug('[ProductDetail] Draft hydration complete — Title:', canonicalDraft.title?.substring(0, 50), 'Price:', canonicalDraft.price);
                }
              } else {
                log.debug('[ProductDetail] Draft loaded for reference only — core fields already populated');
              }
            }
          } else {
            log.debug('[ProductDetail] Draft data not found (expected for new products)');
            hasFetchedDraftRef.current = detailedItem.Id; // Mark as fetched even if empty
          }
        } catch (error) {
          log.error('[ProductDetail] Error loading draft:', error);
        } finally {
          if (!canceled) {
            setIsLoadingDraft(false);
          }
        }
      })();

      return () => { canceled = true };
    }, [detailedItem?.Id, hasUnsavedChanges]); // ONLY depend on product ID - NOT displayedPlatforms!

    // Set up realtime subscriptions. hasUnsavedChangesRef is declared with the
    // save state above so the serializer and realtime deferral share one source.

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
        log.debug(`[ProductDetail] Applying deferred external reload (${reason})`);
        loadPlatformData();
      }, delayMs);
    }, [isInSaveBlockingWindow, loadPlatformData]);

    useEffect(() => {
      if (!detailedItem) return;

      log.debug('[ProductDetail] Setting up Legend-State realtime subscriptions for product:', detailedItem.Id);

      let obs;
      try {
        obs = getLegendStateObservables();
      } catch {
        return;
      }

      const disposers: Array<() => void> = [];
      const track = (d: unknown) => {
        if (typeof d === 'function') disposers.push(d as () => void);
      };

      // Subscribe to product variant changes (was channel `product-${detailedItem.Id}`)
      track(obs?.productVariants$?.onChange?.(({ value, getPrevious, isFromSync }) => {
        if (!isFromSync) return;
        const detailId = detailedItem?.Id;
        if (!detailId) return;
        const prev = (getPrevious() || {})[detailId];
        const next = (value || {})[detailId];
        if (!next || !prev) return;
        if (JSON.stringify(next) === JSON.stringify(prev)) return;

        const updatedProduct = next as ProductVariant;
        log.debug('[ProductDetail] REALTIME EVENT FIRED: UPDATE');
        log.debug('[ProductDetail] hasUnsavedChangesRef.current:', hasUnsavedChangesRef.current);

        // ✅ CRITICAL FIX: Check timestamp-based blocking window FIRST
        // This prevents realtime from overwriting data right after a save
        if (isInSaveBlockingWindow()) {
          log.debug('[ProductDetail] ⚠️ BLOCKING REALTIME - in save blocking window (2s after save)');
          scheduleDeferredExternalReload('product_update_block_window');
          return;
        }

        // CRITICAL: Never update if user has unsaved changes
        if (hasUnsavedChangesRef.current) {
          log.debug('[ProductDetail] ⚠️ BLOCKING REALTIME - user has unsaved changes');
          showBanner('External update available. Save your changes first.', false);
          scheduleDeferredExternalReload('product_update_unsaved');
          return;
        }

        {
          log.debug('[ProductDetail] Processing realtime update for:', updatedProduct.Title);

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
                  log.debug('[ProductDetail] No meaningful changes, skipping realtime update');
                  return prev;
                }

                if (Object.keys(fieldChanges).length > 0) {
                  log.debug('[ProductDetail] 🟢 External field changes detected:', Object.keys(fieldChanges));
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

                log.debug('[ProductDetail] ✅ Applying realtime update (merging to preserve nested data)');
                log.debug('[ProductDetail] REALTIME CHANGES:', {
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
                log.debug('[ProductDetail] ✅ REALTIME: Also updated displayedPlatforms for UI refresh');
                return updated;
              });
            }
      }));

      // Subscribe to inventory level changes (was UNFILTERED channel `inventory-product-${detailedItem.ProductId}`)
      // - but DON'T trigger full reload if user is editing
      // CRITICAL FIX: We don't filter by ProductVariantId on the source because:
      // - detailedItem.Id is often the BASE variant
      // - Inventory is stored against OPTION variants (different IDs)
      // - Instead, we filter in the callback using allProductVariantsRef
      track(obs?.inventoryLevels$?.onChange?.(({ value, getPrevious, isFromSync }) => {
        if (!isFromSync) return;
        if (!detailedItem?.Id) return;
        const prevMap = getPrevious() || {};
        const nextMap = value || {};
        // Skip the initial / repopulation sync (empty prev): those rows are already on
        // screen via loadPlatformData(); treating them as INSERTs would storm reloads.
        if (Object.keys(prevMap).length === 0) return;
        for (const levelId of new Set([...Object.keys(prevMap), ...Object.keys(nextMap)])) {
          const updatedLevel = nextMap[levelId] as InventoryLevel | undefined;
          const deletedLevel = prevMap[levelId] as InventoryLevel | undefined;
          const isUpdate = !!updatedLevel && !!deletedLevel;
          if (isUpdate && JSON.stringify(updatedLevel) === JSON.stringify(deletedLevel)) continue;
          const affectedVariantId = updatedLevel?.ProductVariantId || deletedLevel?.ProductVariantId;

            // CRITICAL: Check if this inventory update is for one of our product's variants
            const ourVariantIds = allProductVariantsRef.current.map(v => v.Id);
            if (!affectedVariantId || !ourVariantIds.includes(affectedVariantId)) {
              // Not our product - ignore
              continue;
            }

            log.debug('[ProductDetail] Inventory level updated:', isUpdate ? 'UPDATE' : 'INSERT/DELETE', 'for variant:', affectedVariantId);

            // CRITICAL: Don't reload if user has unsaved changes - it will overwrite their edits
            if (hasUnsavedChangesRef.current) {
              log.debug('[ProductDetail] ⚠️ Skipping inventory reload - user has unsaved changes');
              showBanner('Inventory changed externally. Save your changes first.');
              scheduleDeferredExternalReload('inventory_unsaved');
              continue;
            }

            // Update inventory in place without full page reload
            if (isUpdate && updatedLevel) {
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
                    log.debug('[ProductDetail] Inventory update for variant', affectedVariantId, '- could not resolve connection, refetching platform data');
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

              log.debug('[ProductDetail] ✅ Inventory updated in place for variant', affectedVariantId);
              if (!isInSaveBlockingWindow()) {
                showBanner('Inventory updated from external source');
              }
            } else {
              // For INSERT/DELETE, do a full reload only if not in blocking window
              if (isInSaveBlockingWindow()) {
                log.debug('[ProductDetail] Inventory INSERT/DELETE while save-blocked - deferring reload');
                scheduleDeferredExternalReload('inventory_insert_delete_blocked');
              } else {
                log.debug('[ProductDetail] Inventory INSERT/DELETE - triggering full reload');
                loadPlatformData();
              }
            }
        }
      }));

      // Subscribe to platform mapping changes (was channel `mappings-${detailedItem.Id}`, filter ProductVariantId=eq)
      track(obs?.platformProductMappings$?.onChange?.(({ value, getPrevious, isFromSync }) => {
        if (!isFromSync) return;
        const detailId = detailedItem?.Id;
        if (!detailId) return;
        const prevMappings = getPrevious() || {};
        // Skip the initial / repopulation sync (empty prev) — not a real per-row change.
        if (Object.keys(prevMappings).length === 0) return;
        const before = Object.values(prevMappings).filter((m: any) => m?.ProductVariantId === detailId);
        const after = Object.values(value || {}).filter((m: any) => m?.ProductVariantId === detailId);
        if (JSON.stringify(before) === JSON.stringify(after)) return;

        log.debug('[ProductDetail] Platform mapping updated');

        // ✅ CRITICAL: Block during save window
        if (isInSaveBlockingWindow()) {
          log.debug('[ProductDetail] ⚠️ Skipping mapping reload - in save blocking window');
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
      }));

      return () => {
        log.debug('[ProductDetail] Cleaning up Legend-State realtime subscriptions');
        disposers.forEach(d => {
          try { d(); } catch {}
        });
      };
    }, [detailedItem?.Id, detailedItem?.ProductId, loadPlatformData, showBanner, isInSaveBlockingWindow, scheduleDeferredExternalReload]);

    // Collaboration: Request edit lock and listen for team updates
    useEffect(() => {
      if (!detailedItem?.ProductId || !collaboration.isConnected) return;

      // Request edit lock when opening product
      collaboration.startEditing(detailedItem.ProductId).then((response) => {
        // Advisory presence only — editing is never blocked. If a teammate also
        // has this open, give a quiet heads-up instead of the old blocking alert.
        if (!response.success && response.lockedBy) {
          showBanner(`${response.lockedBy} is also editing — your changes will still save.`);
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
          log.debug('[ProductDetail] Ignoring collaboration update for different variant:', update.variantId, '(current:', detailedItem.Id, ')');
          return;
        }

        log.debug('[ProductDetail] Received update from teammate for current variant:', update);

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
          showBanner(`${event.userName} is also editing this product.`);
        }
      });

      // Listen for edit ended events
      const unsubscribeEditEnd = collaboration.onEditEnded(() => {
        // No-op: presence is advisory, so there is no lock to release in the UI.
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
          <Text style={[styles.errorText, { color: theme.colors.error }]}>{loadError || 'Product not found'}</Text>
          {loadError ? (
            <Button
              title="Try Again"
              onPress={() => { setLoadError(null); setIsLoading(true); setReloadNonce(n => n + 1); }}
            />
          ) : (
            <Button title="Go Back" onPress={navigation.goBack} />
          )}
        </View>
      );
    }


    // Read-only Overview summary (the mockup's landing). Tapping any detail row, or
    // the header "Edit details" toggle, switches to the full field form (edit mode).
    const renderOverviewSummary = () => {
      const imgs = (editorImages || []).filter((u: any) => typeof u === 'string' && u.trim().length > 0);
      const cover = imgs[0];
      const thumbs = imgs.slice(1, 4);
      const priceNum = Number(detailedItem!.Price);
      const priceText = Number.isFinite(priceNum) && priceNum > 0 ? `$${priceNum.toFixed(2)}` : '—';
      const realVariants = (allProductVariants || []).filter((v: any) => String(v?.VariantType || '').toLowerCase() !== 'base');
      const sizeCount = realVariants.length;
      const stockByVariant: Record<string, number> = {};
      (rawInventoryLevels || []).forEach((l: any) => {
        const id = l?.ProductVariantId;
        if (!id) return;
        stockByVariant[id] = (stockByVariant[id] || 0) + (Number(l?.Quantity) || 0);
      });
      const totalStock = (rawInventoryLevels || []).reduce((s: number, l: any) => s + (Number(l?.Quantity) || 0), 0);
      const canon: any = (displayedPlatforms as any)?.shopify || Object.values(displayedPlatforms || {})[0] || {};
      const categoryText = canon.categoryPath || canon.category || canon.productCategory || null;

      // Tapping any read row jumps into Edit mode and opens that field's sheet.
      const openInEdit = (field: string) => {
        setMode('edit');
        setTimeout(() => listingEditorRef.current?.openFieldSheet(field), 140);
      };
      const tagsArr = Array.isArray(canon.tags) ? canon.tags : (Array.isArray(detailedItem!.Tags) ? (detailedItem!.Tags as any) : []);
      const photosCount = imgs.length;
      // Gray meta after the big price (price is shown on its own, not in this line).
      const metaGray: string[] = [];
      if (totalStock > 0) metaGray.push(`${totalStock} in stock`);
      if (sizeCount > 1) metaGray.push(`${sizeCount} sizes`);
      const priceStockSummary = `${priceText}${totalStock > 0 ? ` · ${totalStock}` : ''}`;

      // One read row: dark label (left) · gray value (right) · chevron. Tap → edit.
      const ovRow = (label: string, value: string | null, placeholder: string, field: string, isLast?: boolean) => (
        <TouchableOpacity style={[styles.ovDetailRow, !isLast && styles.ovDetailDivider]} activeOpacity={0.6} onPress={() => openInEdit(field)}>
          <Text style={styles.ovDetailLabel} numberOfLines={1}>{label}</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.ovDetailValue, !value && styles.ovDetailValueEmpty]} numberOfLines={1}>{value || placeholder}</Text>
          <ChevronRight size={17} color="#C4C8CE" style={{ marginLeft: 6 }} />
        </TouchableOpacity>
      );

      return (
        <View>
          {/* Product card — hero, thumbs, title, price, description */}
          <View style={styles.ovProductCard}>
            {cover ? (
              <Image source={{ uri: cover }} style={styles.ovHero} />
            ) : (
              <View style={[styles.ovHero, styles.ovHeroEmpty]}>
                <Icon name="image-outline" size={32} color="#C4C8CE" />
              </View>
            )}
            {thumbs.length > 0 && (
              <View style={styles.ovThumbRow}>
                {thumbs.map((u: string, i: number) => (
                  <Image key={`${u}-${i}`} source={{ uri: u }} style={styles.ovThumb} />
                ))}
              </View>
            )}
            <Text style={styles.ovTitle}>{detailedItem!.Title || 'Untitled product'}</Text>
            <View style={styles.ovPriceRow}>
              <Text style={styles.ovPrice}>{priceText}</Text>
              {metaGray.length > 0 && <Text style={styles.ovPriceMeta}>{`· ${metaGray.join(' · ')}`}</Text>}
            </View>
            {!!detailedItem!.Description && (
              <Text style={styles.ovDesc} numberOfLines={3}>{detailedItem!.Description}</Text>
            )}
          </View>

          {/* Details — key fields, tap a row to edit */}
          <View style={styles.ovCard}>
            <Text style={[styles.ovCardLabel, styles.ovCardLabelSolo]}>DETAILS</Text>
            {ovRow('Price & stock', priceStockSummary, 'Set a price', 'price')}
            {ovRow('Category', categoryText, 'Add a category', 'category')}
            <TouchableOpacity style={[styles.ovDetailRow, styles.ovDetailDivider]} activeOpacity={0.6} onPress={() => setMode('edit')}>
              <Text style={styles.ovDetailLabel}>Photos</Text>
              <View style={{ flex: 1 }} />
              <Text style={[styles.ovDetailValue, !photosCount && styles.ovDetailValueEmpty]}>{photosCount || 'Add photos'}</Text>
              <ChevronRight size={17} color="#C4C8CE" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
            {/* Tags — chips wrap below the label */}
            <TouchableOpacity style={styles.ovTagsRow} activeOpacity={0.6} onPress={() => openInEdit('tags')}>
              <Text style={styles.ovDetailLabel}>Tags</Text>
              {tagsArr.length > 0 ? (
                <View style={styles.ovTagsWrap}>
                  {tagsArr.slice(0, 6).map((t: string, i: number) => (
                    <View key={`${t}-${i}`} style={styles.ovTagChip}><Text style={styles.ovTagChipText}>{t}</Text></View>
                  ))}
                  {tagsArr.length > 6 && (
                    <View style={styles.ovTagChip}><Text style={styles.ovTagChipText}>{tagsArr.length - 6}+ more</Text></View>
                  )}
                  <ChevronRight size={17} color="#C4C8CE" style={{ alignSelf: 'center' }} />
                </View>
              ) : (
                <View style={styles.ovTagsWrap}>
                  <Text style={[styles.ovDetailValue, styles.ovDetailValueEmpty]}>Add tags</Text>
                  <ChevronRight size={17} color="#C4C8CE" style={{ alignSelf: 'center' }} />
                </View>
              )}
            </TouchableOpacity>
          </View>


          {/* Inventory — per-variant price + stock, tap to edit */}
          {sizeCount > 0 && (
            <TouchableOpacity activeOpacity={0.8} onPress={() => setMode('edit')} style={styles.ovCard}>
              <View style={styles.ovInvHeader}>
                <Text style={styles.ovCardLabel}>INVENTORY</Text>
                <View style={styles.ovInvColHead}>
                  <Text style={styles.ovInvColLabel}>Price</Text>
                  <Text style={[styles.ovInvColLabel, styles.ovInvQtyCol]}>Inv</Text>
                </View>
              </View>
              {realVariants.map((v: any, i: number) => {
                const vPrice = Number(v?.Price);
                const vPriceText = Number.isFinite(vPrice) && vPrice > 0 ? `$${vPrice.toFixed(2)}` : '—';
                const vStock = stockByVariant[v?.Id] ?? 0;
                const vName = v?.Title || v?.Sku || `Variant ${i + 1}`;
                const vSku = v?.Sku || null;
                const vImg = v?.ImageUrl || v?.Image || cover || null;
                return (
                  <View key={v?.Id || i} style={[styles.ovInvRow, i < realVariants.length - 1 && styles.ovInvDivider]}>
                    {vImg ? (
                      <Image source={{ uri: vImg }} style={styles.ovInvThumb} />
                    ) : (
                      <View style={[styles.ovInvThumb, styles.ovHeroEmpty]}><Icon name="image-outline" size={16} color="#C4C8CE" /></View>
                    )}
                    <View style={styles.ovInvNameCol}>
                      <Text style={styles.ovInvName} numberOfLines={1}>{vName}</Text>
                      {!!vSku && <Text style={styles.ovInvSku} numberOfLines={1}>{vSku}</Text>}
                    </View>
                    <Text style={styles.ovInvPrice}>{vPriceText}</Text>
                    <Text style={[styles.ovInvStock, styles.ovInvQtyCol]}>{vStock}</Text>
                  </View>
                );
              })}
            </TouchableOpacity>
          )}
        </View>
      );
    };

    // MORE DETAILS card (overview only) — long-tail fields, rendered last to match the design.
    const renderMoreDetailsCard = () => {
      const canon: any = (displayedPlatforms as any)?.shopify || Object.values(displayedPlatforms || {})[0] || {};
      const condMap: Record<string, string> = { new: 'New', like_new: 'Like New', good: 'Good', fair: 'Fair', used: 'Used', refurbished: 'Refurbished', for_parts: 'For Parts' };
      const condVal = canon.condition ? (condMap[canon.condition] || canon.condition) : null;
      const brandVal = canon.brand || canon.vendor || (detailedItem as any)?.Vendor || null;
      const skuVal = canon.sku || detailedItem!.Sku || null;
      const barcodeVal = canon.barcode || detailedItem!.Barcode || null;
      const seoTitleVal = canon.seoTitle || canon.metaTitle || (detailedItem as any)?.SeoTitle || null;
      const openInEdit = (field: string) => {
        setMode('edit');
        setTimeout(() => listingEditorRef.current?.openFieldSheet(field), 140);
      };
      const ovRow = (label: string, value: string | null, placeholder: string, field: string, isLast?: boolean) => (
        <TouchableOpacity style={[styles.ovDetailRow, !isLast && styles.ovDetailDivider]} activeOpacity={0.6} onPress={() => openInEdit(field)}>
          <Text style={styles.ovDetailLabel} numberOfLines={1}>{label}</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.ovDetailValue, !value && styles.ovDetailValueEmpty]} numberOfLines={1}>{value || placeholder}</Text>
          <ChevronRight size={17} color="#C4C8CE" style={{ marginLeft: 6 }} />
        </TouchableOpacity>
      );
      return (
        <View style={styles.ovCard}>
          <Text style={[styles.ovCardLabel, styles.ovCardLabelSolo]}>MORE DETAILS</Text>
          {ovRow('Brand', brandVal, 'Add a brand', 'brand')}
          {ovRow('Condition', condVal, 'Select condition', 'condition')}
          {ovRow('SKU', skuVal, 'Add a SKU', 'sku')}
          {ovRow('Barcode', barcodeVal, 'Add or scan', 'barcode')}
          {ovRow('SEO title', seoTitleVal, 'Add an SEO title', 'seoTitle', true)}
        </View>
      );
    };

    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        {/* Non-blocking notification banner */}
        {bannerMessage && (
          <TouchableOpacity
            activeOpacity={bannerClickable ? 0.7 : 1}
            onPress={bannerClickable ? () => { if (mode !== 'edit') { setMode('edit'); setTimeout(() => scrollToFirstChangedField(), 80); } else { scrollToFirstChangedField(); } } : undefined}
            disabled={!bannerClickable}
          >
            <Animated.View
              style={[
                styles.notificationBanner,
                {
                  opacity: bannerOpacity,
                  borderColor: bannerClickable ? '#93C822' : '#E5E7EB',
                }
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: bannerClickable ? '#93C822' : '#71717A' }} />
                <Text style={styles.notificationBannerText} numberOfLines={2}>{bannerMessage}</Text>
                {bannerClickable && (
                  <Text style={styles.notificationBannerReview}>Review</Text>
                )}
              </View>
            </Animated.View>
          </TouchableOpacity>
        )}

        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 56, paddingBottom: bottomSafePadding }]}
        >


          {/* Overview = read table of all details (tap a row to edit); Edit = full form. */}
          <Card shadow="none" style={styles.basicSection}>
            {mode === 'overview' && renderOverviewSummary()}
            {mode === 'edit' && (
            <ListingEditorForm
              ref={listingEditorRef}
              platforms={displayedPlatforms}
              images={editorImages}
              platformLocations={buildPlatformLocations()}
              onChangePlatforms={(next) => {
                log.debug('[ProductDetail] ListingEditorForm onChange:', Object.keys(next));
                // Genuine user edit: advance the autosave version token and clear
                // any prior save error so autosave re-arms.
                editVersionRef.current += 1;
                setSaveError(null);
                // Per-platform routing: a title/description/price edit made on ONE specific
                // platform tab saves to that channel via the platform-options PUT and does
                // NOT mark the canonical autosave dirty (which would fan it to every platform).
                // Everything else (all-tab edits, variants, category, etc.) keeps the existing
                // canonical autosave path exactly as-is.
                const override = detectOverrideEdit(displayedPlatforms, next);
                if (override) {
                  queueOverrideSave(override.connectionId, override.fields);
                } else {
                  hasUnsavedChangesRef.current = true;
                  setHasUnsavedChanges(true);
                }
                // DEEP merge ONLY (no eager setDisplayedPlatforms(next) — that made the
                // functional updater below receive the PARTIAL `next` as prev, so a
                // category-only partial write collapsed state to just those fields and
                // wiped every other platform/field. The merge here reads the true full prev.
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
                  log.debug('[GEN-DETAILS] Deep merged platforms, keys:', Object.keys(merged));
                  return merged;
                });
              }}
              onChangeImages={(next) => { void reorderImages(next); }}
              pendingImages={pendingImages}
              onOpenBarcodeScanner={(onResult) => {
                openBarcodeScanner(onResult);
              }}
              onOpenImageCapture={async (_onResult) => {
                try {
                  const assets = await captureOrPickImageAssets({ multiple: true });
                  if (!assets.length) return;
                  setIsUploadingImages(true);
                  const localUris = assets.map(a => a.uri);
                  setPendingImages(prev => [...prev, ...localUris]);
                  try {
                    const uploadedUrls = await uploadImagesToSupabase(assets);
                    // Append against the CURRENT gallery, not the list captured when upload
                    // started. A remove/reorder performed during upload therefore survives.
                    if (uploadedUrls.length > 0) {
                      applyEditorImageUpdate(current => [...current, ...uploadedUrls]);
                      if (!(await persistPhotoGallery())) throw new Error('Failed to save uploaded photos');
                    }
                  } finally {
                    setPendingImages(prev => prev.filter(uri => !localUris.includes(uri)));
                    setIsUploadingImages(false);
                  }
                } catch (error: any) {
                  log.error('Error picking images:', error);
                  setIsUploadingImages(false);
                  Alert.alert('Couldn’t add photo', error?.message || 'Failed to add images. Please try again.');
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
            )}

            {/* Active Channels — gray card with a white inner list (UJK-0) */}
            <View style={styles.channelsCard}>
              <View style={styles.channelsHeader}>
                <Text style={styles.channelsTitle}>Active Channels</Text>
                <TouchableOpacity style={styles.channelsManagePill} onPress={() => { if (mode !== 'edit') { setMode('edit'); setTimeout(() => listingEditorRef.current?.openPlatformPicker?.(), 80); } else { listingEditorRef.current?.openPlatformPicker?.(); } }}>
                  <Text style={styles.channelsManageText}>Manage</Text>
                </TouchableOpacity>
              </View>

              {(mappings.length > 0 || unpublishedPlatforms.length > 0 || partnerships.length > 0 || productCampaigns.length > 0) ? (
                <View style={styles.channelsInner}>
                  {mappings.map((mapping) => {
                    const connection = connections.find(c => c.Id === mapping.PlatformConnectionId);
                    const rawType = connection?.PlatformType || 'unknown';
                    const typeLabel = rawType.charAt(0).toUpperCase() + rawType.slice(1);
                    const platformName = connection?.DisplayName || `${typeLabel} Account`;
                    const parsedSyncMs = mapping.LastSyncedAt ? new Date(mapping.LastSyncedAt).getTime() : 0;
                    const isStale = !parsedSyncMs || (Date.now() - parsedSyncMs) > 24 * 60 * 60 * 1000;
                    // The backend stamps LastSyncedAt even on a FAILED push (writing
                    // SyncStatus:'Error' + SyncErrorMessage alongside), so recency alone
                    // would paint a failed sync green. Drive the dot from SyncStatus first;
                    // only fall back to the recency Live/stale logic when the last sync
                    // actually succeeded (or no status was recorded).
                    const syncState = (mapping.SyncStatus || '').toLowerCase();
                    let statusColor: string;
                    let statusText: string;
                    if (syncState === 'error' || syncState === 'failed') {
                      statusColor = '#DC2626';
                      const reason = (mapping.SyncErrorMessage || '').trim();
                      const shortReason = reason.length > 48 ? `${reason.slice(0, 45)}\u2026` : reason;
                      statusText = shortReason ? `Didn\u2019t reach ${typeLabel} \u00b7 ${shortReason}` : `Didn\u2019t reach ${typeLabel}`;
                    } else if (syncState === 'conflict') {
                      statusColor = '#BA7517';
                      statusText = 'Needs review';
                    } else if (syncState === 'pending' || syncState === 'syncing' || syncState === 'queued' || syncState === 'processing') {
                      statusColor = '#9CA3AF';
                      statusText = 'Syncing\u2026';
                    } else {
                      statusColor = isStale ? '#BA7517' : '#16A34A';
                      statusText = isStale
                        ? `Out of sync${parsedSyncMs ? ` \u00b7 ${relTime(parsedSyncMs)}` : ''}`
                        : `Live \u00b7 synced ${relTime(parsedSyncMs)}`;
                    }
                    // Facebook posts through the user's computer (async). When a
                    // dispatch job is in flight / waiting / paused / failed, show its
                    // realtime status instead of the sync status \u2014 same dot+label idiom.
                    const fbStatus = rawType.toLowerCase() === 'facebook'
                      ? fbDispatch.statusForVariant(mapping.ProductVariantId)
                      : null;
                    const dotColor = fbStatus ? fbStatus.dotColor : statusColor;
                    const textColor = fbStatus ? fbStatus.color : statusColor;
                    const rowStatusText = fbStatus ? fbStatus.label : statusText;
                    return (
                      <View key={mapping.Id} style={styles.alRow}>
                        <View style={styles.alLogo}><PlatformLogo type={rawType} size={20} fallbackIcon="store" /></View>
                        <View style={styles.alInfo}>
                          <Text style={styles.alName} numberOfLines={1}>{platformName}</Text>
                          <View style={styles.alStatusLine}>
                            <View style={[styles.alDot, { backgroundColor: dotColor }]} />
                            <Text style={[styles.alStatusText, { color: textColor }]} numberOfLines={1}>{rowStatusText}</Text>
                          </View>
                          {(() => {
                            const ov = overridesByConnection[mapping.PlatformConnectionId];
                            if (!ov) return null;
                            const fields = OVERRIDE_FIELDS.filter((f) => f in ov).map(overrideFieldLabel);
                            const fieldText =
                              fields.length <= 1
                                ? fields[0] || 'details'
                                : `${fields.slice(0, -1).join(', ')} & ${fields[fields.length - 1]}`;
                            return (
                              <View style={styles.overrideLine}>
                                <Text style={styles.overrideText} numberOfLines={1}>
                                  Custom {fieldText} for {typeLabel}
                                </Text>
                                <Text style={styles.overrideDivider}>·</Text>
                                <TouchableOpacity
                                  onPress={() => resetOverride(mapping.PlatformConnectionId, rawType.toLowerCase())}
                                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                                >
                                  <Text style={styles.overrideResetText}>Use main details</Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })()}
                        </View>
                        <TouchableOpacity style={styles.alActionOutline} onPress={() => handleDelist(mapping.PlatformConnectionId, mapping.Id, platformName)}>
                          <Text style={styles.alActionOutlineText}>Delist</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}

                  {unpublishedPlatforms.map((platform) => {
                    const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1);
                    const isCurrentlyPublishing = isPublishing === platform;
                    return (
                      <View key={platform} style={styles.alRow}>
                        <View style={styles.alLogo}>{getPlatform(platform) ? <PlatformLogo type={platform} size={20} /> : <Icon name="store" size={20} color={BRAND_PRIMARY} />}</View>
                        <View style={styles.alInfo}>
                          <Text style={styles.alName} numberOfLines={1}>{platformLabel}</Text>
                          <View style={styles.alStatusLine}>
                            <View style={[styles.alDot, { backgroundColor: '#9CA3AF' }]} />
                            <Text style={[styles.alStatusText, { color: '#71717A' }]}>Connected · not listed</Text>
                          </View>
                          {(() => {
                            const connId = resolveConnectionIdForPlatform(platform);
                            const ov = connId ? overridesByConnection[connId] : undefined;
                            if (!connId || !ov) return null;
                            const fields = OVERRIDE_FIELDS.filter((f) => f in ov).map(overrideFieldLabel);
                            const fieldText =
                              fields.length <= 1
                                ? fields[0] || 'details'
                                : `${fields.slice(0, -1).join(', ')} & ${fields[fields.length - 1]}`;
                            return (
                              <View style={styles.overrideLine}>
                                <Text style={styles.overrideText} numberOfLines={1}>
                                  Custom {fieldText} for {platformLabel}
                                </Text>
                                <Text style={styles.overrideDivider}>·</Text>
                                <TouchableOpacity
                                  onPress={() => resetOverride(connId, platform.toLowerCase())}
                                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                                >
                                  <Text style={styles.overrideResetText}>Use main details</Text>
                                </TouchableOpacity>
                              </View>
                            );
                          })()}
                        </View>
                        <TouchableOpacity style={styles.alActionGreen} onPress={() => handlePublishToPlatform(platform)} disabled={isCurrentlyPublishing}>
                          {isCurrentlyPublishing ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.alActionGreenText}>Publish</Text>}
                        </TouchableOpacity>
                      </View>
                    );
                  })}

                  {partnerships.map((partnership) => {
                    const isLoading = partnershipActionLoading === partnership.inviteId || partnershipActionLoading === partnership.linkId;
                    return (
                      <View key={partnership.inviteId} style={styles.alRow}>
                        <View style={styles.alLogo}><Icon name="account-group-outline" size={20} color={partnership.isShared ? BRAND_PRIMARY : '#9CA3AF'} /></View>
                        <View style={styles.alInfo}>
                          <Text style={styles.alName} numberOfLines={1}>{partnership.partnerOrgName}</Text>
                          <View style={styles.alStatusLine}>
                            <View style={[styles.alDot, { backgroundColor: partnership.isShared ? '#16A34A' : '#9CA3AF' }]} />
                            <Text style={[styles.alStatusText, { color: partnership.isShared ? '#16A34A' : '#71717A' }]} numberOfLines={1}>{partnership.isShared ? 'Shared' : 'Not shared'} · {partnership.poolName}</Text>
                          </View>
                        </View>
                        {isLoading ? (
                          <ActivityIndicator size="small" color={theme.colors.primary} style={{ marginRight: 8 }} />
                        ) : partnership.isShared ? (
                          partnership.canRevoke && partnership.linkId ? (
                            <TouchableOpacity style={styles.alActionOutline} onPress={() => revokeFromPartner(partnership.linkId!, partnership.partnerOrgName)}>
                              <Text style={styles.alActionOutlineText}>Remove</Text>
                            </TouchableOpacity>
                          ) : (
                            <View style={styles.alActionGhost}><Text style={styles.alActionGhostText}>Shared</Text></View>
                          )
                        ) : (
                          <TouchableOpacity style={styles.alActionGreen} onPress={() => shareWithPartner(partnership.inviteId)}>
                            <Text style={styles.alActionGreenText}>Share</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}

                  {productCampaigns.map((c) => {
                    const soldText = (typeof c.soldCount === 'number' && typeof c.totalCount === 'number')
                      ? `${c.soldCount} of ${c.totalCount} sold`
                      : 'Active';
                    return (
                      <TouchableOpacity key={c.id} style={styles.alRow} activeOpacity={0.7} onPress={() => (navigation as any).navigate('LiquidationCampaignScreen', { campaignId: c.id, entryPoint: 'detail' })}>
                        <View style={[styles.alLogo, styles.channelCampaignLogo]}><Icon name="sprout-outline" size={20} color="#5D7E16" /></View>
                        <View style={styles.alInfo}>
                          <Text style={styles.channelCampaignLabel}>IN A CAMPAIGN</Text>
                          <Text style={styles.alName} numberOfLines={1}>{c.title}</Text>
                          <View style={styles.alStatusLine}>
                            <View style={[styles.alDot, { backgroundColor: '#5D7E16' }]} />
                            <Text style={[styles.alStatusText, { color: '#71717A' }]} numberOfLines={1}>{soldText}</Text>
                          </View>
                        </View>
                        <ChevronRight size={18} color="#9CA3AF" />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.channelsInner}>
                  <View style={[styles.alRow, { borderBottomWidth: 0 }]}>
                    <Text style={styles.noPlatformsText}>Not listed anywhere yet</Text>
                  </View>
                </View>
              )}

              <TouchableOpacity style={styles.channelsAddRow} onPress={() => { if (mode !== 'edit') { setMode('edit'); setTimeout(() => listingEditorRef.current?.openPlatformPicker?.(), 80); } else { listingEditorRef.current?.openPlatformPicker?.(); } }}>
                <Icon name="plus" size={16} color="#9CA3AF" style={{ marginRight: 4 }} />
                <Text style={styles.alAddText}>Add a channel</Text>
              </TouchableOpacity>
            </View>

            {/* More details — long-tail fields, last card (overview only) */}
            {mode === 'overview' && renderMoreDetailsCard()}

          </Card>
        </ScrollView>

        {/* Floating glass header (matches Generate Details): blur + fade, back · save status · menu */}
        <View style={[styles.glassHeader, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <ProgressiveBlurView intensity={Platform.OS === 'ios' ? 50 : 28} tint="light" direction="down" />
            <LinearGradient
              colors={['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
              locations={[0, 0.55, 1]}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <View style={styles.glassHeaderRow}>
            <TouchableOpacity
              style={styles.navCircle}
              onPress={() => { if (mode === 'edit') { setMode('overview'); } else { navigation.goBack(); } }}
              activeOpacity={0.85}
            >
              <ChevronLeft size={22} color="#18181B" />
            </TouchableOpacity>
            {/* Centered: in overview, an "Edit details" entry. In edit, saving is implicit —
                no "Done"; just a quiet "Saving…/Saved" that fades after 5s. Back returns here. */}
            <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 34 }}>
              {mode === 'overview' ? (
                <TouchableOpacity style={styles.modeToggle} onPress={() => setMode('edit')} activeOpacity={0.85}>
                  <Text style={styles.modeToggleText}>Edit details</Text>
                </TouchableOpacity>
              ) : isSaving ? (
                <View style={styles.savePill}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={[styles.savePillText, { color: theme.colors.primary }]}>Saving…</Text>
                </View>
              ) : saveError ? (
                <TouchableOpacity onPress={() => performAutoSave()} activeOpacity={0.7} style={styles.savePill}>
                  <Icon name="alert-circle-outline" size={14} color="#DC2626" />
                  <Text style={[styles.savePillText, { color: '#DC2626' }]}>Save failed · Retry</Text>
                </TouchableOpacity>
              ) : (
                <Animated.View style={[styles.savePill, { opacity: savedOpacity }]} pointerEvents="none">
                  <Icon name="check" size={14} color={theme.colors.success} />
                  <Text style={[styles.savePillText, { color: theme.colors.success }]}>Saved</Text>
                </Animated.View>
              )}
            </View>
            <TouchableOpacity onPress={() => setActionMenuVisible(true)} activeOpacity={0.85} style={styles.navCircle}>
              <Icon name="dots-horizontal" size={22} color="#18181B" />
            </TouchableOpacity>
          </View>
        </View>

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
              onPress={openClearout}
            >
              <Icon name="sprout-outline" size={20} color="#5D7E16" style={{ marginRight: 10 }} />
              <Text style={{ fontSize: 16, fontWeight: '600', color: '#5D7E16' }}>Add to clearout</Text>
            </TouchableOpacity>

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
                setVersionsVisible(true);
              }}
            >
              <Icon name="history" size={20} color={theme.colors.text} style={{ marginRight: 10 }} />
              <Text style={{ fontSize: 16, fontWeight: '500', color: theme.colors.text }}>Version history</Text>
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
                    { text: 'Archive', style: 'default', onPress: () => { void archiveProduct(); } }
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

        {/* Add-to-clearout picker */}
        <BaseModal
          onClose={() => setClearoutVisible(false)}
          visible={clearoutVisible}
          showCloseButton={false}
          containerStyle={{ width: '88%', maxWidth: 380 }}
        >
          <View style={{ width: '100%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 24 }} />
              <Text style={{ fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' }}>Add to clearout</Text>
              <TouchableOpacity onPress={() => setClearoutVisible(false)}>
                <Icon name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>

            {clearoutLoading ? (
              <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                <ActivityIndicator color="#93C822" />
              </View>
            ) : (
              <>
                {clearoutCampaigns.map((c: any) => (
                  <TouchableOpacity
                    key={c.id}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}
                    onPress={() => addToClearout(c.id, c.title)}
                    disabled={!!clearoutBusy}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(147,200,34,0.14)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      <Icon name="leaf" size={18} color="#5D7E16" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: '#18181B' }} numberOfLines={1}>{c.title}</Text>
                      <Text style={{ fontSize: 12, color: '#71717A', marginTop: 1 }}>
                        {(c.stats?.soldCount ?? 0)}/{(c.stats?.totalCount ?? 0)} sold
                      </Text>
                    </View>
                    {clearoutBusy === c.id ? <ActivityIndicator size="small" color="#93C822" /> : <Icon name="chevron-right" size={20} color="#D4D4D8" />}
                  </TouchableOpacity>
                ))}
                {clearoutCampaigns.length === 0 ? (
                  <Text style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, paddingVertical: 16 }}>No active clearouts yet.</Text>
                ) : null}

                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, marginTop: 10, backgroundColor: '#93C822', borderRadius: 14 }}
                  onPress={createClearoutWithProduct}
                  disabled={!!clearoutBusy}
                >
                  {clearoutBusy === '__new__' ? <ActivityIndicator color="#FFFFFF" /> : (
                    <>
                      <Icon name="plus" size={18} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>New clearout with this product</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </BaseModal>

        {/* Version history */}
        <BaseModal
          onClose={() => setVersionsVisible(false)}
          visible={versionsVisible}
          showCloseButton={false}
          containerStyle={{ width: '88%', maxWidth: 380 }}
        >
          <View style={{ width: '100%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 24 }} />
              <Text style={{ fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' }}>Version history</Text>
              <TouchableOpacity onPress={() => setVersionsVisible(false)}>
                <Icon name="close" size={24} color="#000" />
              </TouchableOpacity>
            </View>

            {draftVersions.length === 0 ? (
              <Text style={{ textAlign: 'center', color: '#9CA3AF', fontSize: 13, paddingVertical: 16 }}>
                No saved versions yet. Versions are captured as you save and refine this listing.
              </Text>
            ) : (
              <ScrollView style={{ maxHeight: 360 }}>
                {[...draftVersions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((v, idx) => (
                  <View
                    key={v.id}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(147,200,34,0.14)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                      <Icon name="history" size={18} color="#5D7E16" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: '#18181B' }} numberOfLines={1}>
                        {idx === 0 ? 'Latest' : `Version ${draftVersions.length - idx}`}
                      </Text>
                      <Text style={{ fontSize: 12, color: '#71717A', marginTop: 1 }} numberOfLines={1}>
                        {(() => { try { return new Date(v.createdAt).toLocaleString(); } catch { return String(v.createdAt); } })()}
                        {Array.isArray(v.publishedPlatforms) && v.publishedPlatforms.length > 0 ? ` · ${v.publishedPlatforms.join(', ')}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => restoreDraftVersion(v.id)}
                      disabled={!!restoringVersionId}
                      style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: restoringVersionId ? '#E5E7EB' : 'rgba(147,200,34,0.16)' }}
                    >
                      {restoringVersionId === v.id ? (
                        <ActivityIndicator size="small" color="#5D7E16" />
                      ) : (
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#5D7E16' }}>Restore</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </BaseModal>

        {/* Manual "Save changes" bar intentionally removed — autosave + the header
            chip (Saved / Saving… / Unsaved / Save failed · Retry) is the single,
            calm save model. Retry on failure lives in that header chip. */}
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
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  notificationBannerText: {
    color: '#3F3F46',
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
  },
  notificationBannerReview: {
    color: '#4A7C00',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 'auto',
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
  glassHeader: { ...GLASS_HEADER_STYLES.header },
  glassHeaderRow: { ...GLASS_HEADER_STYLES.headerRow },
  navCircle: { ...GLASS_HEADER_STYLES.navCircle },
  modeToggle: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  modeToggleText: { fontSize: 14, fontWeight: '700', color: '#18181B' },
  // Quiet, calm save status shown in edit mode (no button chrome).
  savePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7 },
  savePillText: { fontSize: 13, fontWeight: '600' },
  // Product card (hero + title + price + desc)
  ovProductCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EDEEF1', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  ovHero: { width: '100%', height: 190, borderRadius: 14, backgroundColor: '#ECECEF' },
  ovHeroEmpty: { alignItems: 'center', justifyContent: 'center' },
  ovThumbRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  ovThumb: { width: 58, height: 58, borderRadius: 11, backgroundColor: '#ECECEF' },
  ovTitle: { fontSize: 18, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#111827', marginTop: 13, lineHeight: 23, letterSpacing: -0.2 },
  ovPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 7, flexWrap: 'wrap' },
  ovPrice: { fontSize: 22, fontFamily: CHAT_FONT.bold, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },
  ovPriceMeta: { fontSize: 14, fontFamily: CHAT_FONT.medium, fontWeight: '500', color: '#9CA3AF' },
  ovDesc: { fontSize: 13.5, fontFamily: CHAT_FONT.regular, fontWeight: '400', color: '#3F3F46', marginTop: 6, lineHeight: 20 },

  // Section cards (inventory / details / more details)
  ovCard: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, marginBottom: 12, borderWidth: 1, borderColor: '#EDEEF1', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  ovCardLabel: { fontSize: 11, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.7 },
  ovCardLabelSolo: { paddingTop: 14, paddingBottom: 2 },

  // Inventory rows
  ovInvHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 4 },
  ovInvColHead: { flexDirection: 'row', alignItems: 'center' },
  ovInvColLabel: { width: 64, textAlign: 'right', fontSize: 11.5, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: '#6B7280' },
  ovInvQtyCol: { width: 44 },
  ovInvRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 11 },
  ovInvDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F1F2F4' },
  ovInvThumb: { width: 36, height: 36, borderRadius: 9, backgroundColor: '#ECECEF' },
  ovInvNameCol: { flex: 1, minWidth: 0 },
  ovInvName: { fontSize: 14, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#111827' },
  ovInvSku: { fontSize: 12, fontFamily: CHAT_FONT.medium, fontWeight: '500', color: '#9CA3AF', marginTop: 1 },
  ovInvPrice: { width: 64, textAlign: 'right', fontSize: 13, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: '#6B7280' },
  ovInvStock: { textAlign: 'right', fontSize: 14, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#111827' },

  // Detail rows (dark label · gray value · chevron)
  ovDetailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 10 },
  ovDetailDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F1F2F4' },
  ovDetailLabel: { flexShrink: 0, fontSize: 15, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: '#111827' },
  ovDetailValue: { fontSize: 13.5, fontFamily: CHAT_FONT.medium, fontWeight: '500', color: '#6B7280', textAlign: 'right' },
  ovDetailValueEmpty: { color: '#C4C8CE' },
  ovTagsRow: { paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F1F2F4' },
  ovTagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8, alignItems: 'center' },
  ovTagChip: { backgroundColor: '#F3F4F6', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  ovTagChipText: { fontSize: 12.5, fontFamily: CHAT_FONT.medium, fontWeight: '500', color: '#3F3F46' },
  ovSectionLabel: { fontSize: 11, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#71717A', letterSpacing: 0.6, marginTop: 22, marginBottom: 8, marginLeft: 4 },
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
  // Active Channels — UJK-0 gray card wrapping a white inner list (matches the Inventory card)
  channelsCard: { marginTop: 12, backgroundColor: '#F3F4F6', borderColor: '#F1F2F4', borderWidth: 1, borderRadius: 14, padding: 12 },
  channelsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9, paddingHorizontal: 2 },
  channelsTitle: { fontSize: 14, fontFamily: CHAT_FONT.medium, fontWeight: '500', color: '#666666' },
  channelsManagePill: { backgroundColor: '#FFFFFF', borderColor: '#E5E7EB', borderWidth: 1, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  channelsManageText: { fontSize: 12, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#6B7280' },
  channelsInner: { backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 14, overflow: 'hidden' },
  channelsAddRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 11, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB', borderRadius: 13, paddingVertical: 10 },
  channelCampaignLogo: { backgroundColor: '#93C82218' },
  channelCampaignLabel: { fontSize: 10.5, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.5, marginBottom: 1 },
  // Active Listings — Paper status-row style (logo + name + dot·status + one verb)
  alTitle: { fontSize: 11, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.7, marginTop: 10, marginBottom: 4 },
  alSubLabel: { fontSize: 11, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.7, marginTop: 14, marginBottom: 4 },
  alRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F1F2F4',
  },
  alLogo: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  alInfo: { flex: 1, minWidth: 0 },
  alName: { fontSize: 15, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#111827' },
  alStatusLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  alDot: { width: 7, height: 7, borderRadius: 4 },
  alStatusText: { fontSize: 12.5, fontFamily: CHAT_FONT.semibold, fontWeight: '600', flexShrink: 1 },
  // Quiet per-platform override indicator — muted, no pill, matches the calm status line.
  overrideLine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  overrideText: { fontSize: 11.5, fontFamily: CHAT_FONT.regular, color: '#9CA3AF', flexShrink: 1 },
  overrideDivider: { fontSize: 11.5, color: '#D1D5DB' },
  overrideResetText: { fontSize: 11.5, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: '#6B7280' },
  alActionOutline: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  alActionOutlineText: { fontSize: 13, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#6B7280' },
  alActionGreen: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: BRAND_PRIMARY,
    minWidth: 80,
    alignItems: 'center',
  },
  alActionGreenText: { fontSize: 13, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#FFFFFF' },
  alActionGhost: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(147,200,34,0.12)',
  },
  alActionGhostText: { fontSize: 13, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#4A7C00' },
  alAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
  },
  alAddText: { fontSize: 14, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: '#6B7280' },
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

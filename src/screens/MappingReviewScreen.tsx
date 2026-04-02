import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Alert, TouchableOpacity, Modal, Pressable, FlatList, TextInput, KeyboardAvoidingView, Platform, Image as RNImage } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator'; // Assuming this is your stack param list
import { useTheme } from '../context/ThemeContext';
import { supabase, configureClerkSupabaseBridge, ensureSupabaseJwt } from '../../lib/supabase';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Sparkles, Link, Unlink, Hammer, DollarSign, Store, Boxes } from 'lucide-react-native';

import Card from '../components/Card'; // Import Card component
import { useLegendState } from '../context/LegendStateContext';
import { useOrg } from '../context/OrgContext'; // Import OrgContext
import { LegendStateObservables, PlatformConnection } from '../utils/SupaLegend';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import Animated, { FadeInUp, Layout } from 'react-native-reanimated';
import * as Progress from 'react-native-progress';
import PlaceholderImage from '../components/PlaceholderImage';
import PillTabs from '../components/ui/PillTabs';
import SearchBar from '../components/ui/SearchBar';
import SearchBarWithScanner from '../components/SearchBarWithScanner';
import MappingCard from '../components/mapping/MappingCard';
import BottomActionBar from '../components/BottomActionBar';
import { tokens } from '../design/tokens';
import ShopifySvg from '../assets/shopify.svg';
import SquareSvg from '../assets/square.svg';
import CloverSvg from '../assets/clover.svg';
import EbaySvg from '../assets/ebay.svg';
import FacebookSvg from '../assets/facebook.svg';
import AmazonSvg from '../assets/amazon.svg';
const AnorhaLogo = require('../assets/rounded_anorha.png');
import { CameraView } from 'expo-camera';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useImportSession } from '../hooks/useImportSession';
import { ImportWizardSheet } from '../components/import/ImportWizardSheet';

const ACTION_BAR_HEIGHT = 80;
const ACTION_BAR_BOTTOM_OFFSET = 24;

interface MappingSuggestion {
  action: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE' | 'UNMATCHED';
  prevAction?: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE' | 'UNMATCHED'; // For restore functionality
  platformProduct: {
    id: string;         // e.g., "gid://shopify/ProductVariant/12345"
    sku: string;
    title: string;
    price: number;
    imageUrl: string | null;
    parentId?: string | null; // NEW: For variant grouping
    parentTitle?: string | null; // NEW: For variant grouping headers
  };
  suggestedCanonicalProduct: {
    id: string | null;  // will be null for CREATE_NEW
    sku: string;
    title: string;
    price?: number;
    imageUrl?: string | null;
  } | null;
  // NEW: For bidirectional sync - Anorha item to push to platform
  anorhaVariant?: {
    id: string;
    sku: string | null;
    title: string | null;
    price?: number;
    barcode?: string | null;
    imageUrl?: string | null;
  } | null;
  // NEW: Direction of sync
  direction?: 'platform_to_anorha' | 'anorha_to_platform' | 'bidirectional';
  // This is the key part for your UI:
  // Default this to `true` for 'CREATE_NEW' and 'LINK_EXISTING'
  // Your UI should have a checkbox bound to this property.
  isSelected: boolean;
  // NEW metadata for classification
  matchType?: 'BARCODE' | 'SKU' | 'TITLE' | 'NONE';
  confidence?: number;
  // INTERNAL: resolution and restoration helpers (not sent to API)
  resolved?: boolean;
  prevTab?: 'all' | 'needs_review' | 'matched' | 'ignored';
  originalData?: any; // For CSV Import storage
}

// NEW: Interface for existing mappings from Supabase
interface ExistingMapping {
  Id: string;
  PlatformConnectionId: string;
  ProductVariantId: string;
  PlatformProductId: string;
  PlatformVariantId?: string | null;
  PlatformSku?: string | null;
  PlatformSpecificData?: any;
  LastSyncedAt?: string | null;
  SyncStatus: string;
  SyncErrorMessage?: string | null;
  IsEnabled: boolean;
  CreatedAt: string;
  UpdatedAt: string;
  // Join data from other tables
  ProductVariant?: {
    Id: string;
    ProductId: string;
    Sku: string;
    Title: string;
    Price: number;
  };
  Product?: {
    Id: string;
    Title: string;
  };
}

// --- NEW: Type for Job Progress (Aligned with Backend) ---
interface JobProgress {
  progress: number;
  description: string;
  isActive: boolean;
  isCompleted: boolean;
  isFailed: boolean;
  total?: number;
  processed?: number;
  elapsedSeconds?: number; // NEW: Track elapsed time
}
// --- END NEW ---

type MappingReviewScreenRouteProp = RouteProp<AppStackParamList, 'MappingReview'>;
type MappingReviewScreenNavigationProp = StackNavigationProp<AppStackParamList, 'MappingReview'>;

// Base URL for your SSSync API
const SSSYNC_API_BASE_URL = (
  process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL ||
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  'https://api.sssync.app'
).replace(/\/+$/, '');

// --- Helper: Wait for Supabase access token (bridge may need a moment) ---
const waitForSupabaseToken = async (maxWaitMs: number = 8000, stepMs: number = 200): Promise<string | null> => {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    try {
      const sessionResp = await supabase.auth.getSession();
      const token = sessionResp?.data?.session?.access_token || null;
      if (token) return token;
    } catch { }
    await new Promise(r => setTimeout(r, stepMs));
  }
  return null;
};

// Optional: ensure bridge is configured if needed
const ensureBridge = async (getClerkToken: () => Promise<string | null>) => {
  try {
    await configureClerkSupabaseBridge({ getClerkToken, autoRefreshMinutes: 9 });
  } catch { }
};

type ActiveTab = 'needs_review' | 'matched' | 'ignored';
type ReviewReason = 'low_confidence' | 'no_match_found' | 'variant_mismatch';

interface ReviewBadgeConfig {
  label: string;
  tone: 'warning' | 'danger' | 'info' | 'success';
}

interface AnnotatedMappingSuggestion extends MappingSuggestion {
  reviewReason?: ReviewReason;
  isStaleClaim: boolean;
  staleDisplay?: {
    title: string;
    sku?: string;
  } | null;
}

interface VariantReviewSheetState {
  visible: boolean;
  parentId: string | null;
  parentTitle: string | null;
  items: MappingSuggestion[];
}

// Helper function to get platform colors
const getPlatformColor = (platformType: string): string => {
  const type = platformType.toLowerCase();
  if (type.includes('shopify')) return '#96C93F';
  if (type.includes('square')) return '#3E4348';
  if (type.includes('clover')) return '#28A745';
  if (type.includes('amazon')) return '#FF9900';
  if (type.includes('ebay')) return '#0064D2';
  if (type.includes('facebook')) return '#1877F2';
  return '#6B7280';
};

const MappingReviewScreen = () => {
  const theme = useTheme();
  const route = useRoute<MappingReviewScreenRouteProp>();
  const navigation = useNavigation<MappingReviewScreenNavigationProp>();
  const {
    connectionId,
    platformName,
    jobId,
    importedProducts,
    isCSVImport,
    isScanning,
    scanStartTime,
  } = route.params as any;
  const legendState: LegendStateObservables | null = useLegendState();
  const { currentOrg } = useOrg(); // Use Org Context
  const insets = useSafeAreaInsets();
  const bottomSafePadding = ACTION_BAR_HEIGHT + ACTION_BAR_BOTTOM_OFFSET + insets.bottom + 16;
  const [connection, setConnection] = useState<any>();
  const isScanningActiveEarly = isScanning || connection?.Status?.toLowerCase() === 'scanning' || connection?.Status?.toLowerCase() === 'syncing' || connection?.Status?.toLowerCase() === 'pending';

  const importSession = useImportSession({
    connectionId,
    platformName,
    isCSVImport,
    importedProducts,
    connection,
    platformConnections: [] as any[],
    skipInitialFetch: isScanningActiveEarly,
    onNavigate: (screen, params) => navigation.navigate(screen as any, params),
  });
  const { suggestions, setSuggestions, wizardVisible, setWizardVisible, counts: sessionCounts } = importSession;

  // Sync connection from useImportSession hook (it fetches connection on mount)
  useEffect(() => {
    if (importSession.connection && !connection) {
      setConnection(importSession.connection);
    }
  }, [importSession.connection]);

  // ✅ CRITICAL: Sync hook loading state → screen loading state
  // When the hook finishes fetching (loading=false), dismiss the screen's loading spinner too.
  // Only sync when going from loading→done (not when the screen itself sets loading for actions).
  useEffect(() => {
    if (!importSession.loading && !isScanningActiveEarly) {
      setLoading(false);
    }
  }, [importSession.loading]);
  const [missingMappings, setMissingMappings] = useState<Array<{ variantId: string; sku: string | null; title: string | null; productId: string | null }>>([]);
  // ✅ CHANGED: Start loading=true when scanning is detected
  const [loading, setLoading] = useState(true); // Will be updated based on isScanningActive
  const [error, setError] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<any>(null); // Summary might not exist anymore
  const [syncing, setSyncing] = useState(false);
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [multiPlatformMode, setMultiPlatformMode] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [isReconcileMode, setIsReconcileMode] = useState(false);
  const [previewingItem, setPreviewingItem] = useState<MappingSuggestion | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('needs_review');
  const [activeReviewBucket, setActiveReviewBucket] = useState<ReviewReason | null>(null);
  const [activeReviewItemIds, setActiveReviewItemIds] = useState<string[] | null>(null);
  const [variantReviewSheet, setVariantReviewSheet] = useState<VariantReviewSheetState>({
    visible: false,
    parentId: null,
    parentTitle: null,
    items: [],
  });
  // --- NEW: State for WebSocket sync progress ---
  const { progressByConnectionId } = usePlatformConnections();
  const syncProgress = progressByConnectionId[connectionId];

  // ✅ FIX: Derive scanning state from BOTH route param AND connection status
  // This ensures progress bar shows even when navigating back to an active scan
  const isScanningActive = useMemo(() => {
    if (isScanning) return true;
    const status = connection?.Status?.toLowerCase();
    return status === 'scanning' || status === 'syncing' || status === 'pending';
  }, [isScanning, connection?.Status]);

  // --- NEW: Manual Search Modal State ---
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchModalQuery, setSearchModalQuery] = useState('');
  const [searchModalResults, setSearchModalResults] = useState<any[]>([]);
  const [isSearchingProducts, setIsSearchingProducts] = useState(false);
  const [itemToMatch, setItemToMatch] = useState<MappingSuggestion | null>(null);
  // NEW: Track group items when matching from a collapsed group
  const [groupItemsToMatch, setGroupItemsToMatch] = useState<MappingSuggestion[] | null>(null);

  // --- NEW: Expanded groups state for collapsible variant groups ---
  // Empty set = all groups collapsed by default; stores parentIds of expanded groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());


  const performProductSearch = useCallback((query: string = '') => {
    setIsSearchingProducts(true);

    try {
      if (!legendState) {
        setSearchModalResults([]);
        return;
      }

      const cleanQuery = query.trim().toLowerCase();
      
      const allVariants = legendState.productVariants$?.get() || {};
      const allProducts = (legendState as any).products$?.get() || {};
      const allMappings = legendState.platformProductMappings$?.get() || {};

      // Build a set of variant IDs already mapped to this connection
      const mappedVariantIds = new Set<string>();
      Object.values(allMappings).forEach((m: any) => {
        if (m.PlatformConnectionId === connectionId && m.ProductVariantId) {
          mappedVariantIds.add(m.ProductVariantId);
        }
      });

      const matchedVariants = Object.values(allVariants).filter((v: any) => {
        // Exclude archived and already mapped items
        if (v.IsArchived || mappedVariantIds.has(v.Id)) return false;

        // If no query, just return everything (up to the limit)
        if (!cleanQuery) return true;

        const matchTitle = v.Title?.toLowerCase().includes(cleanQuery);
        const matchSku = v.Sku?.toLowerCase().includes(cleanQuery);
        const matchBarcode = v.Barcode?.toLowerCase().includes(cleanQuery);
        return matchTitle || matchSku || matchBarcode;
      }).slice(0, 50); // increased limit to 50 for default view

      console.log(`[performProductSearch] Local query "${cleanQuery}" returned ${matchedVariants.length} results from ${Object.keys(allVariants).length} total cache`);

      setSearchModalResults(matchedVariants.map((v: any) => {
        const parentProduct = allProducts[v.ProductId];
        return {
          id: v.Id,
          sku: v.Sku,
          title: v.Title,
          productTitle: parentProduct?.Title || v.Title, // Fallback to variant title if no parent
          price: v.Price,
          imageUrl: v.PrimaryImageUrl || null,
        };
      }));
    } catch (err) {
      console.error('[performProductSearch] Local search error:', err);
    } finally {
      setIsSearchingProducts(false);
    }
  }, [legendState]);


  const handleManualMatch = (canonicalVariant: any) => {
    if (!itemToMatch) return;

    // If we have group items (from collapsed group search), map ALL items in the group
    const itemsToMap = groupItemsToMatch || [itemToMatch];
    const next = applySuggestionUpdates(itemsToMap.map(i => i.platformProduct.id), (item) => ({
      ...item,
      action: 'LINK_EXISTING',
      isSelected: true,
      matchType: 'MANUAL' as any,
      resolved: true,
      suggestedCanonicalProduct: {
        id: canonicalVariant.id,
        sku: canonicalVariant.sku,
        title: canonicalVariant.title,
        price: canonicalVariant.price,
        imageUrl: canonicalVariant.imageUrl
      }
    }));

    maybeOpenVariantReviewSheet(next, itemsToMap.map(i => i.platformProduct.id));
    closeSearchModal();
  };
  const [isPolling, setIsPolling] = useState(!!jobId); // Will be set to true when isScanningActive is detected
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null); // Keep for compatibility
  // --- END NEW ---
  // --- NEW: Add state for existing mappings ---
  const [existingMappings, setExistingMappings] = useState<ExistingMapping[]>([]);
  const [loadingExistingMappings, setLoadingExistingMappings] = useState(false);
  // --- NEW: Add state for search functionality ---
  // --- NEW: Add state for custom notification ---
  // --- NEW: Sync Rules State ---
  type SyncDirection = 'two-way' | 'push-only' | 'pull-only';
  type SourceOfTruth = 'sssync' | 'platform';

  const [syncDirection, setSyncDirection] = useState<SyncDirection>('two-way');
  const [sourceOfTruth, setSourceOfTruth] = useState<SourceOfTruth>('sssync');
  const [autoCreate, setAutoCreate] = useState(true);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [syncInventory, setSyncInventory] = useState(true);
  const [syncPricing, setSyncPricing] = useState(true);
  const [showSyncRules, setShowSyncRules] = useState(false);
  const [showAdvancedRules, setShowAdvancedRules] = useState(false);
  const [inventoryBuffer, setInventoryBuffer] = useState<Record<string, number>>({});
  const [globalInventoryBuffer, setGlobalInventoryBuffer] = useState(0); // For simple modal view
  const [isAddConnectionModalVisible, setIsAddConnectionModalVisible] = useState(false)
  // --- END NEW ---

  // --- NEW: UI state for filter/sort in list (separate from link search modal) ---
  const [listQuery, setListQuery] = useState('');
  const [showBarcodeScanner, setShowBarcodeScanner] = useState(false);
  const [showEffectAllDropdown, setShowEffectAllDropdown] = useState(false);
  const [sortBy, setSortBy] = useState<'title' | 'sku'>('title');
  // NEW: Email-inbox accordion state — only one item expanded at a time
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  // NEW: Scan summary
  const [scanSummary, setScanSummary] = useState<{ countProducts?: number; countVariants?: number; countLocations?: number } | null>(null);
  // NEW: State for refresh/rescan
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [wizardStep, setWizardStep] = useState(0); // 0 platforms, 1 sync mode, 2 delist, 3 buffer, 4 review
  const [selectedPlatformsState, setSelectedPlatformsState] = useState<string[]>([]);
  const [inventoryMergeMode, setInventoryMergeMode] = useState<'merged' | 'separate' | null>('merged');

  // Wizard step configuration - centralized titles and descriptions (description shown above divider)
  const WIZARD_STEP_CONFIG: Record<number, { title: string; description?: string }> = {
    0: { title: 'Choose Import Direction', description: 'Pick how products should flow between this platform and Anorha.' },
    1: { title: 'Assign Pool & Locations', description: 'Map this connection and locations to the right pool.' },
    2: { title: 'Advanced Settings', description: 'Optional sync behavior controls.' },
    3: { title: 'Advanced Settings', description: 'Optional delist behavior controls.' },
    4: { title: 'Advanced Settings', description: 'Optional price adjustment controls.' },
    5: { title: 'Advanced Settings', description: 'Optional inventory buffer controls.' },
    6: { title: 'Review & Complete', description: 'Confirm mappings and start the import sync.' },
  };


  // 'sync_everywhere' = Add missing items to ALL platforms including this one (full bidirectional sync)
  // 'pull_only' = Only add missing items TO this platform (import from others)
  // 'push_only' = Push this platform's inventory to others, but don't pull items in
  // 'do_nothing' = Don't create missing items on any platform
  type ProductCreationMode = 'sync_everywhere' | 'pull_only' | 'push_only' | 'do_nothing';
  const [productCreationMode, setProductCreationMode] = useState<ProductCreationMode>('pull_only');

  const getSyncRuleDirectionPatch = (mode: ProductCreationMode) => {
    if (mode === 'sync_everywhere') {
      return {
        syncDirection: 'bidirectional',
        allowPullFromPlatform: true,
        allowPushToPlatform: true,
        propagateCreates: true,
        propagateUpdates: true,
        propagateDeletes: false,
        propagateInventory: true,
      };
    }
    if (mode === 'pull_only') {
      return {
        syncDirection: 'pull_only',
        allowPullFromPlatform: true,
        allowPushToPlatform: false,
        propagateCreates: false,
        propagateUpdates: false,
        propagateDeletes: false,
        propagateInventory: false,
      };
    }
    if (mode === 'push_only') {
      return {
        syncDirection: 'push_only',
        allowPullFromPlatform: false,
        allowPushToPlatform: true,
        propagateCreates: true,
        propagateUpdates: true,
        propagateDeletes: false,
        propagateInventory: true,
      };
    }
    return {
      syncDirection: 'bidirectional',
      allowPullFromPlatform: true,
      allowPushToPlatform: true,
      propagateCreates: false,
      propagateUpdates: true,
      propagateDeletes: false,
      propagateInventory: true,
    };
  };


  // Pools Selection State
  const [pools, setPools] = useState<any[]>([]);
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const [isLoadingPools, setIsLoadingPools] = useState(false);
  const [isCreatingPool, setIsCreatingPool] = useState(false);
  const [poolNameInput, setPoolNameInput] = useState('');

  // Location Assignment State (for mapping locations to pools)
  interface ConnectionLocation {
    platformLocationId: string;
    locationName: string;
    timezone?: string;
  }
  const [connectionLocations, setConnectionLocations] = useState<ConnectionLocation[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  // Maps locationId -> poolId (which pool each location is assigned to)
  const [locationPoolAssignments, setLocationPoolAssignments] = useState<Record<string, string>>({});

  // Hide virtual/default locations when at least one real location exists (same rule as ProductDetail)
  const isVirtualDefaultLoc = (l: ConnectionLocation) =>
    l.platformLocationId.startsWith('default-') ||
    l.locationName === 'Default Location' ||
    (l.locationName != null && l.locationName.endsWith(' Inventory'));
  const displayConnectionLocations = useMemo(() => {
    const hasReal = connectionLocations.some(l => !isVirtualDefaultLoc(l));
    return hasReal ? connectionLocations.filter(l => !isVirtualDefaultLoc(l)) : connectionLocations;
  }, [connectionLocations]);


  // Sync Settings
  const [syncMode, setSyncMode] = useState<'auto' | 'manual'>('auto');
  const [delistMode, setDelistMode] = useState<'auto' | 'manual'>('auto');
  const [priceBuffer, setPriceBuffer] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ Sync hook state → local state for pools, locations, and settings
  // The hook fetches this data; we sync it into local state used by handleCreatePool and the wizard UI.
  useEffect(() => {
    if (importSession.pools && importSession.pools.length > 0 && pools.length === 0) {
      setPools(importSession.pools);
    }
  }, [importSession.pools]);

  useEffect(() => {
    if (importSession.selectedPool && !selectedPool) {
      setSelectedPool(importSession.selectedPool);
    }
  }, [importSession.selectedPool]);

  useEffect(() => {
    const hookLocations = importSession.connectionLocations || [];
    if (hookLocations.length > 0 && connectionLocations.length === 0) {
      setConnectionLocations(hookLocations as ConnectionLocation[]);
    }
  }, [importSession.connectionLocations]);

  useEffect(() => {
    const hookAssignments = importSession.locationPoolAssignments || {};
    if (Object.keys(hookAssignments).length > 0 && Object.keys(locationPoolAssignments).length === 0) {
      setLocationPoolAssignments(hookAssignments);
    }
  }, [importSession.locationPoolAssignments]);


  const renderProgressCard = () => {
    // If job completed or no progress, don't show card
    if (!syncProgress || syncProgress.status === 'completed') return null;

    const progress = (syncProgress.progress || 0) / 100;
    return (
      <Animated.View entering={FadeInUp}>
        <Card style={{ marginHorizontal: 16, marginVertical: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 12 }}>
            Analyzing {platformName} Products
          </Text>
          <Progress.Bar progress={progress} width={null} color={theme.colors.primary} />
          <Text style={{ marginTop: 8, fontSize: 14 }}>
            {Math.round((syncProgress.progress || 0))}% - {syncProgress.description}
          </Text>
          {syncProgress.elapsedSeconds && (
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 }}>
              Elapsed: {syncProgress.elapsedSeconds.toFixed(1)}s
            </Text>
          )}
          {syncProgress.details?.productsProcessed && (
            <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 }}>
              Products: {syncProgress.details.productsProcessed} | Variants: {syncProgress.details.variantsProcessed || 0}
            </Text>
          )}
        </Card>
      </Animated.View>
    );
  };

  // ✅ ENHANCED: Poll connection status and auto-transition when scan completes
  useEffect(() => {
    let pollingInterval: ReturnType<typeof setInterval> | null = null;
    let isMounted = true;

    const pollConnectionStatus = async () => {
      if (!isMounted) return;

      try {
        const token = await ensureSupabaseJwt();
        const response = await fetch(
          `${SSSYNC_API_BASE_URL}/api/platform-connections/${connectionId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            }
          }
        );

        if (response.ok) {
          const conn = await response.json();
          setConnection(conn);

          // ✅ AUTO-TRANSITION: When status changes from scanning to review/active
          // Fetch suggestions and stop loading
          const status = conn.Status?.toLowerCase();
          console.log(`[MappingReviewScreen] Polled status: ${status} (isScanningActive: ${isScanningActive})`);

          if (isScanningActive && status && ['review', 'active', 'ready_to_sync'].includes(status)) {
            // NEW: Check for race condition - if status is 'active' but LastSyncAttemptAt is older than scan start, it's stale
            if (status === 'active' && scanStartTime) {
              const lastSyncTime = conn.LastSyncAttemptAt ? new Date(conn.LastSyncAttemptAt).getTime() : 0;
              // Allow a small buffer (e.g., 2000ms) for clock drift, but generally strict
              if (lastSyncTime < scanStartTime) {
                console.log(`[MappingReviewScreen] ⏳ Status is 'active' but LastSyncAttemptAt (${new Date(lastSyncTime).toISOString()}) is older than scan start (${new Date(scanStartTime).toISOString()}). Waiting...`);
                return; // Keep polling
              }
            }
            console.log('[MappingReviewScreen] ✅ Scan complete! Fetching suggestions...');
            // Stop polling
            if (pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
            }
            // Fetch suggestions - this will set loading=false when done
            importSession.refreshSuggestions();
          } else if (isScanningActive && status === 'error') {
            console.log('[MappingReviewScreen] ❌ Scan failed');
            setError('Scan failed. Please try again.');
            setLoading(false);
            if (pollingInterval) {
              clearInterval(pollingInterval);
              pollingInterval = null;
            }
          }
        }
      } catch (error) {
        console.error('[MappingReviewScreen] Error polling connection:', error);
      }
    };

    if (connectionId && connectionId !== 'csv-import') {
      // Initial load
      pollConnectionStatus();

      // ✅ Start polling if scanning - poll every 3 seconds for status changes
      if (isScanningActive || isPolling) {
        console.log('[MappingReviewScreen] 🔄 Starting status polling...');
        pollingInterval = setInterval(pollConnectionStatus, 3000);
      }
    }

    return () => {
      isMounted = false;
      if (pollingInterval) {
        clearInterval(pollingInterval);
      }
    };
  }, [connectionId, isScanningActive, isPolling]);

  // ✅ ALSO: Listen for WebSocket progress and auto-transition on completion
  useEffect(() => {
    if (syncProgress?.status === 'review' || syncProgress?.status === 'active' || syncProgress?.status === 'completed') {
      console.log(`[MappingReviewScreen] WebSocket status: ${syncProgress.status} - fetching suggestions`);
      if (loading && (isScanningActive || isPolling)) {
        importSession.refreshSuggestions();
      }
    }
  }, [syncProgress?.status]);

  // ✅ FIX: Auto-enable polling when isScanningActive becomes true (e.g., navigating back to active scan)
  useEffect(() => {
    if (isScanningActive && !isPolling) {
      console.log('[MappingReviewScreen] 🔄 isScanningActive detected, enabling polling');
      setIsPolling(true);
      setLoading(true); // Show progress UI
    }
  }, [isScanningActive]);

  // NOTE: Pools, locations, and quick-settings are loaded by useImportSession hook.
  // No duplicate fetching here — see importSession.pools, importSession.connectionLocations, etc.

  // ✅ SYNC EVERYWHERE FIX: Update suggestions selection based on productCreationMode
  // This ensures the correct items are selected for import based on the user's mode choice in wizard step 0
  useEffect(() => {
    if (!suggestions || suggestions.length === 0) return;

    console.log(`[MappingReviewScreen] Updating suggestion selections for mode: ${productCreationMode}`);

    setSuggestions(prevSuggestions => prevSuggestions?.map(suggestion => {
      const direction = suggestion.direction || 'platform_to_anorha';
      // UNMATCHED items should remain unselected by default in all modes to prompt user review
      // unless user explicitly interacts with them later

      switch (productCreationMode) {
        case 'sync_everywhere':
          // Select ALL items - both directions (full bidirectional sync)
          // EXCEPTION: UNMATCHED items (no match found) start unselected to avoid accidental dupes
          return { ...suggestion, isSelected: suggestion.action !== 'IGNORE' && suggestion.action !== 'UNMATCHED' };

        case 'pull_only':
          // Only select platform_to_anorha and bidirectional items
          // Deselect anorha_to_platform items
          if (direction === 'anorha_to_platform') {
            return { ...suggestion, isSelected: false };
          }
          // EXCEPTION: UNMATCHED items
          return { ...suggestion, isSelected: suggestion.action !== 'IGNORE' && suggestion.action !== 'UNMATCHED' };

        case 'push_only':
          // Only select anorha_to_platform items
          // Deselect platform_to_anorha CREATE_NEW/UNMATCHED items
          if (direction === 'anorha_to_platform') {
            return { ...suggestion, isSelected: true };
          }
          // Keep bidirectional/linked items, deselect CREATE_NEW/UNMATCHED for platform items
          if (suggestion.action === 'CREATE_NEW' || suggestion.action === 'UNMATCHED') {
            return { ...suggestion, isSelected: false };
          }
          return { ...suggestion, isSelected: suggestion.action !== 'IGNORE' };

        case 'do_nothing':
          // Only keep bidirectional/linked items, no creates or pushes
          if (direction === 'anorha_to_platform') {
            return { ...suggestion, isSelected: false };
          }
          if (suggestion.action === 'CREATE_NEW' || suggestion.action === 'UNMATCHED') {
            return { ...suggestion, isSelected: false };
          }
          return { ...suggestion, isSelected: suggestion.action !== 'IGNORE' };

        default:
          return suggestion;
      }
    }) || []);
  }, [productCreationMode]);

  // ✅ POOLS: Create new pool
  const handleCreatePool = async () => {
    if (!poolNameInput.trim()) {
      Alert.alert('Error', 'Please enter a pool name');
      return;
    }

    try {
      setIsCreatingPool(true);
      const token = await ensureSupabaseJwt();

      // ✅ FIX: Get orgId from connection OR fetch user's active org
      let orgId = connection?.OrgId;
      if (!orgId) {
        console.warn('[MappingReviewScreen] Connection missing OrgId, fetching user active org...');
        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/organizations/me/active`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });
        if (response.ok) {
          const data = await response.json();
          orgId = data.orgId;
          console.log('[MappingReviewScreen] Got active orgId:', orgId);
        } else {
          throw new Error('Could not determine organization');
        }
      }

      // Get location IDs that should be assigned to this new pool
      // If user has specifically assigned locations to this pool, use those
      // Otherwise, use all displayed (real) connection locations
      const locationIdsForNewPool = displayConnectionLocations
        .filter(loc => {
          const assignedPoolId = locationPoolAssignments[loc.platformLocationId];
          // Include if explicitly assigned to 'create-new' or not assigned at all (default to new pool)
          return assignedPoolId === 'create-new' || !assignedPoolId;
        })
        .map(loc => loc.platformLocationId);

      console.log('[MappingReviewScreen] Creating pool with locations:', locationIdsForNewPool);

      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/pools`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orgId,
          name: poolNameInput.trim(),
          description: `Pool for ${connection?.DisplayName || 'new connection'}`,
          syncInventory: true,
          syncPricing: true,
          location_ids: locationIdsForNewPool, // Include locations when creating
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to create pool');
      }

      const newPool = await response.json();

      // Refresh pools list from API to ensure consistency
      const poolsResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/pools/org/${orgId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (poolsResponse.ok) {
        const poolsData = await poolsResponse.json();
        const poolsList = Array.isArray(poolsData) ? poolsData : [];
        setPools(poolsList);

        // Select the newly created pool
        const createdPool = poolsList.find((p: any) => p.id === newPool.id) || newPool;
        setSelectedPool(createdPool.id);
      } else {
        // Fallback: add to existing list
        setPools([...pools, newPool]);
        setSelectedPool(newPool.id);
      }

      setPoolNameInput('');
      setWizardStep(1); // Move to next step
    } catch (error) {
      console.error('[MappingReviewScreen] Error creating pool:', error);
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to create pool');
    } finally {
      setIsCreatingPool(false);
    }
  };


  // NOTE: Platform connections are loaded by useImportSession hook (importSession.platformConnections).
  // Sync local multi-platform state from the hook's data.
  useEffect(() => {
    const hookConnections = importSession.platformConnections || [];
    if (hookConnections.length > 0) {
      setPlatformConnections(hookConnections as PlatformConnection[]);
      const platformTypes = new Set(hookConnections.map((conn: any) => conn.PlatformType));
      setMultiPlatformMode(platformTypes.size > 1);
      setSelectedConnectionIds([connectionId]);
    }
  }, [importSession.platformConnections, connectionId]);

  // ═══════════════════════════════════════════════════════════════
  // Data loading is handled by useImportSession hook (DB-first architecture).
  // The hook always loads from PlatformProductMappings + /missing-mappings
  // as the primary source, with scan suggestions overlaid on top.
  // Use importSession.refreshSuggestions() to re-fetch.
  // ═══════════════════════════════════════════════════════════════

  // Effect to trigger initial data loading
  // NOTE: useImportSession already fetches suggestions on mount when skipInitialFetch is false.
  // This effect only handles: CSV import, scanning/polling transitions, and missing connectionId.
  const initialFetchDoneRef = React.useRef(false);
  useEffect(() => {
    console.log(`[MappingReviewScreen] Effect triggered - isPolling: ${isPolling}, connectionId: ${connectionId}, jobId: ${jobId}, loading: ${loading}`);

    // CSV import handling
    if ((isCSVImport || connectionId === 'csv-import') && importedProducts) {
      setLoading(true);
      try {
        const mappedSuggestions: MappingSuggestion[] = importedProducts.map((p: any, index: number) => ({
          action: 'CREATE_NEW',
          platformProduct: {
            id: `csv-${index}`,
            sku: p.sku || `CSV-${index}`,
            title: p.title || 'Untitled',
            price: Number(p.price) || 0,
            imageUrl: p.imageUrl || null,
          },
          suggestedCanonicalProduct: null,
          isSelected: true,
          matchType: 'NONE',
          confidence: 1.0,
          originalData: p,
        }));
        setSuggestions(mappedSuggestions);
        setLoading(false);
      } catch (e) {
        console.error("Error mapping CSV data:", e);
        setLoading(false);
      }
    } else if (connectionId) {
      // For non-scanning connections, useImportSession already calls fetchMappingSuggestions on mount.
      // We only need to handle scanning/polling transitions here.
      if (isPolling || isScanningActive) {
        console.log(`[MappingReviewScreen] Scanning/Polling active, keeping loading state`);
        setLoading(true);
      } else if (!initialFetchDoneRef.current && !isScanningActiveEarly) {
        // The hook handles the initial fetch via skipInitialFetch logic.
        // If skipInitialFetch was true (scanning) but scanning ended before mount,
        // trigger a manual refresh. Otherwise the hook already did it.
        if (isScanningActiveEarly) {
          // skipInitialFetch was true, scanning may still be active
          setLoading(true);
        } else {
          // Hook already fetched (skipInitialFetch=false), just track it
          initialFetchDoneRef.current = true;
        }
      }
    } else {
      console.error(`[MappingReviewScreen] No connection ID provided`);
      setError("Connection ID is missing.");
      setLoading(false);
    }
  }, [connectionId, isPolling, isScanningActive]); // Removed `connection` dependency to prevent cascading

  // --- WebSocket sync progress handling ---
  useEffect(() => {
    if (syncProgress) {
      console.log('[MappingReviewScreen] Received sync progress:', syncProgress);

      // Update progress for UI
      if (syncProgress.progress !== undefined) {
        setJobProgress({
          progress: syncProgress.progress / 100,
          description: syncProgress.description || 'Processing...',
          elapsedSeconds: syncProgress.elapsedSeconds,
          isActive: syncProgress.status === 'scanning' || syncProgress.status === 'syncing',
          isCompleted: syncProgress.status === 'review' || syncProgress.status === 'active',
          isFailed: syncProgress.status === 'error',
        });
      }

      // When scan completes (status = 'review'), fetch suggestions and move to review
      if (syncProgress.status === 'review') {
        console.log('[MappingReviewScreen] Scan completed successfully');
        setLoading(false);
        setIsPolling(false); // Stop polling
        // Fetch suggestions to populate the review screen
        importSession.refreshSuggestions();
      } else if (syncProgress.status === 'active') {
        console.log('[MappingReviewScreen] Sync activated');
        setLoading(false);
        importSession.refreshSuggestions();
      } else if (syncProgress.status === 'error') {
        console.log('[MappingReviewScreen] Scan/Sync failed');
        setLoading(false);
        setIsPolling(false);
        setError(`Operation failed: ${syncProgress.description}`);
      } else if (syncProgress.status === 'scanning') {
        // Show progress during scan - don't stop polling
        console.log(`[MappingReviewScreen] Scanning progress: ${syncProgress.progress}%`);
        setIsPolling(true);
      }
    }
  }, [syncProgress, connectionId]);

  useEffect(() => {
    navigation.setOptions({
      title: `Review ${platformName} Sync`,
      headerBackTitle: 'Profile', // Adds a back button with a label
    });
  }, [navigation, platformName]);

  // Toggle selection of a connection for multi-platform sync
  const toggleConnectionSelection = (connId: string) => {
    setSelectedConnectionIds(prev =>
      prev.includes(connId)
        ? prev.filter(id => id !== connId)
        : [...prev, connId]
    );
  };

  // --- API-RELATED FUNCTIONS ---

  // --- NEW: Function to handle batch approval of perfect matches ---
  const handleApproveAllLinks = async () => {
    if (!suggestions?.filter(s => s.action === 'LINK_EXISTING') || suggestions.filter(s => s.action === 'LINK_EXISTING').length === 0) {
      console.log('[MappingReviewScreen] No perfect matches to approve');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = await ensureSupabaseJwt();
      if (!token) throw new Error("Authentication token not found. Please log in again.");

      // Prepare payload - extract the necessary fields from perfectMatches
      const mappingsPayload = suggestions.filter(s => s.action === 'LINK_EXISTING').map(match => ({
        platformProductId: match.platformProduct.id,
        sssyncProductId: match.suggestedCanonicalProduct?.id,
        action: 'link',
      }));

      console.log(`[MappingReviewScreen] Approving ${mappingsPayload.length} perfect match links for ${platformName}`);

      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/confirm-mappings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmedMatches: mappingsPayload }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to confirm link mappings. Status: ${response.status}`);
      }

      const result = await response.json();
      console.log('[MappingReviewScreen] Perfect match links confirmed successfully:', result);

      // Success notification
      Alert.alert(
        "Links Approved",
        `Successfully linked ${mappingsPayload.length} products.`,
        [{
          text: "OK",
          onPress: () => {
            if (connectionId) {
              importSession.refreshSuggestions();
            }
          }
        }]
      );

    } catch (err: any) {
      console.error('[MappingReviewScreen] Error confirming perfect match links:', err);
      setError(err.message || 'An unexpected error occurred while confirming links.');
      Alert.alert("Error", err.message || "Failed to approve links. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  // --- NEW: Function to handle batch approval of new product creations ---
  const handleApproveAllNewCreations = async () => {
    if (!suggestions?.filter(s => s.action === 'CREATE_NEW') || suggestions.filter(s => s.action === 'CREATE_NEW').length === 0) {
      console.log('[MappingReviewScreen] No new products to create');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;

      if (!token) {
        throw new Error("Authentication token not found. Please log in again.");
      }

      // Prepare payload - extract the necessary fields from newFromPlatform
      const mappingsPayload = suggestions.filter(s => s.action === 'CREATE_NEW').map(product => ({
        platformProductId: product.platformProduct.id,
        action: 'create_new',
        platformProductDetails: product.platformProduct,
      }));

      console.log(`[MappingReviewScreen] Creating ${mappingsPayload.length} new products from ${platformName}`);

      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/confirm-mappings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmedMatches: mappingsPayload }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to confirm new product creations. Status: ${response.status}`);
      }

      const result = await response.json();
      console.log('[MappingReviewScreen] New product creations confirmed successfully:', result);

      // Success notification
      Alert.alert(
        "New Products Approved",
        `Successfully queued ${mappingsPayload.length} new products for creation in SSSync.`,
        [{
          text: "OK",
          onPress: () => {
            if (connectionId) {
              importSession.refreshSuggestions();
            }
          }
        }]
      );

    } catch (err: any) {
      console.error('[MappingReviewScreen] Error confirming new product creations:', err);
      setError(err.message || 'An unexpected error occurred while creating new products.');
      Alert.alert("Error", err.message || "Failed to create new products. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handles importing products from CSV
   */
  const handleImportCSV = async () => {
    if (!suggestions || suggestions.filter(s => s.isSelected).length === 0) {
      Alert.alert("Error", "No products selected for import.");
      return;
    }

    setLoading(true);
    // Use 'Syncing...' state to show progress overlay if available, or just keeping loading spinner
    setSyncing(true);

    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error("Authentication token not found.");

      const selectedItems = suggestions.filter(s => s.isSelected);
      let successCount = 0;
      let failCount = 0;
      const createdVariantIds: string[] = [];

      const total = selectedItems.length;

      // Iterate and create products strictly
      for (let i = 0; i < total; i++) {
        const item = selectedItems[i];
        // Retrieve the full original data if possible, or reconstruct from platformProduct
        // Since we mapped it, platformProduct has the basics.
        // But importedProducts param has the full data. 
        // We can look it up or just use what we have.
        // Let's use the original imported object if we can find it by index/ID, 
        // but for now relying on the mapped suggestion data is safer.

        // Construct the DTO expected by POST /api/products
        // Construct the DTO expected by POST /api/products
        // Sanitize data to match ProductVariants table columns to avoid 500 errors
        const options: Record<string, any> = {};
        if ((item as any).originalData?.size) options['Size'] = (item as any).originalData.size;
        if ((item as any).originalData?.color) options['Color'] = (item as any).originalData.color;
        if ((item as any).originalData?.brand) options['Brand'] = (item as any).originalData.brand;
        if ((item as any).originalData?.category) options['Category'] = (item as any).originalData.category;
        if ((item as any).originalData?.condition) options['Condition'] = (item as any).originalData.condition;

        const productData = {
          userId: (legendState?.userId) || '',
          variantData: {
            Title: item.platformProduct.title,
            Sku: item.platformProduct.sku,
            Price: item.platformProduct.price,
            Description: (item as any).originalData?.description || item.platformProduct.title,
            Barcode: (item as any).originalData?.barcode,
            // Only include fields that exist in ProductVariants table
            Weight: (item as any).originalData?.weight ? Number((item as any).originalData.weight) : undefined,
            Options: Object.keys(options).length > 0 ? options : undefined,
            PrimaryImageUrl: item.platformProduct.imageUrl, // Backend now handles this separately!
          }
        };

        try {
          const res = await fetch(`${SSSYNC_API_BASE_URL}/api/products`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(productData),
          });

          if (!res.ok) {
            const errorText = await res.text().catch(() => 'No error body');
            console.error(`Failed to import item ${i}: status ${res.status}`, errorText);
            failCount++;
          } else {
            const created = await res.json().catch(() => ({}));
            const createdVariantId =
              created?.variant?.Id ||
              created?.variantId ||
              created?.data?.variant?.Id ||
              created?.data?.variantId ||
              created?.Id ||
              created?.id;
            if (createdVariantId) {
              createdVariantIds.push(String(createdVariantId));
            }
            successCount++;
          }
        } catch (e: any) {
          console.error(`Failed to import item ${i}:`, e.message || e);
          failCount++;
        }

        // Optional: Update progress UI here if we had a detailed progress bar
      }

      capture(AnalyticsEvents.INVENTORY_IMPORT_COMPLETED, {
        product_count: successCount,
        failed_count: failCount,
      });

      Alert.alert(
        "Import Complete",
        `Successfully imported ${successCount} products.${failCount > 0 ? ` Failed: ${failCount}` : ''}`,
        [
          {
            text: "Go to Inventory",
            onPress: () => {
              navigation.navigate('TabNavigator', { screen: 'InventoryOrders' } as any);
            }
          },
          {
            text: "Improve Now",
            onPress: () => {
              navigation.navigate('BackfillOptimizer' as any, {
                newlyImportedIds: createdVariantIds,
                source: 'csv_import',
              });
            }
          }
        ]
      );

    } catch (error: any) {
      console.error('[MappingReviewScreen] CSV Import Error:', error);
      Alert.alert("Import Error", error.message || "Failed to import products.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  // --- END API-RELATED FUNCTIONS ---

  const handleReviewItem = (item: MappingSuggestion) => {
    setPreviewingItem(item);
  };

  const updateSuggestionAction = (platformProductId: string, newAction: 'LINK_EXISTING' | 'CREATE_NEW' | 'IGNORE' | 'UNMATCHED') => {
    setSuggestions(currentSuggestions => {
      if (!currentSuggestions) return null;
      return currentSuggestions.map(suggestion => {
        if (suggestion.platformProduct.id === platformProductId) {
          // When ignoring, deselect. Otherwise, select.
          return { ...suggestion, action: newAction, isSelected: newAction !== 'IGNORE' };
        }
        return suggestion;
      });
    });
  };

  // --- ALWAYS-CALLED HOOKS: keep BEFORE any conditional returns to obey Rules of Hooks ---
  const matchesListQuery = useCallback((item: MappingSuggestion, query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;

    if ((item.platformProduct.title || '').toLowerCase().includes(q)) return true;
    if ((item.platformProduct.sku || '').toLowerCase().includes(q)) return true;
    if ((item.suggestedCanonicalProduct?.title || '').toLowerCase().includes(q)) return true;
    if ((item.suggestedCanonicalProduct?.sku || '').toLowerCase().includes(q)) return true;
    if ((item.anorhaVariant?.title || '').toLowerCase().includes(q)) return true;
    if ((item.anorhaVariant?.sku || '').toLowerCase().includes(q)) return true;
    if ((item.anorhaVariant?.barcode || '').toLowerCase().includes(q)) return true;
    return false;
  }, []);

  const sortSuggestionItems = useCallback(<T extends MappingSuggestion>(list: T[]): T[] => {
    return [...list].sort((a, b) => {
      if (sortBy === 'title') {
        return (a.platformProduct.title || '').localeCompare(b.platformProduct.title || '');
      }
      return (a.platformProduct.sku || '').localeCompare(b.platformProduct.sku || '');
    });
  }, [sortBy]);

  const claimedIds = useMemo(() => {
    const ids = new Set<string>();
    (suggestions || []).forEach((item) => {
      if (item.resolved === true && item.action === 'LINK_EXISTING' && item.suggestedCanonicalProduct?.id) {
        ids.add(item.suggestedCanonicalProduct.id);
      }
    });
    return ids;
  }, [suggestions]);

  const annotatedSuggestions = useMemo<AnnotatedMappingSuggestion[]>(() => {
    const list = suggestions || [];
    const familyResolvedCanonicalIds = new Map<string, Set<string>>();

    list.forEach((item) => {
      const parentId = item.platformProduct.parentId;
      const canonicalId = item.suggestedCanonicalProduct?.id || null;
      if (!parentId || !canonicalId || item.resolved !== true || item.action !== 'LINK_EXISTING') return;
      if (!familyResolvedCanonicalIds.has(parentId)) {
        familyResolvedCanonicalIds.set(parentId, new Set<string>());
      }
      familyResolvedCanonicalIds.get(parentId)!.add(canonicalId);
    });

    return list.map((item) => {
      const unresolved = item.action !== 'IGNORE' && item.resolved !== true;
      const canonicalId = item.suggestedCanonicalProduct?.id || null;
      const familyResolvedIds = item.platformProduct.parentId ? familyResolvedCanonicalIds.get(item.platformProduct.parentId) : undefined;
      const hasFamilyConflict = unresolved
        && !!item.platformProduct.parentId
        && !!familyResolvedIds
        && familyResolvedIds.size > 0
        && (!canonicalId || !familyResolvedIds.has(canonicalId));
      const isStaleClaim = unresolved && !!canonicalId && claimedIds.has(canonicalId);

      let reviewReason: ReviewReason | undefined;
      if (unresolved) {
        if (hasFamilyConflict) {
          reviewReason = 'variant_mismatch';
        } else if (item.action === 'UNMATCHED' && !canonicalId) {
          reviewReason = 'no_match_found';
        } else if ((typeof item.confidence === 'number' && item.confidence < 0.6) || isStaleClaim) {
          reviewReason = 'low_confidence';
        } else if (canonicalId) {
          reviewReason = 'low_confidence';
        } else {
          reviewReason = 'no_match_found';
        }
      }

      return {
        ...item,
        reviewReason,
        isStaleClaim,
        staleDisplay: isStaleClaim && item.suggestedCanonicalProduct ? {
          title: item.suggestedCanonicalProduct.title,
          sku: item.suggestedCanonicalProduct.sku,
        } : null,
      };
    });
  }, [claimedIds, suggestions]);

  const counts = useMemo(() => {
    const list = annotatedSuggestions;
    const all = list.length;
    const matched = list.filter(s => (s.action === 'LINK_EXISTING' && s.resolved === true) || (s.action === 'CREATE_NEW' && s.resolved === true)).length;
    const needs_review = list.filter(s => s.action !== 'IGNORE' && s.resolved !== true).length;
    const ignored = list.filter(s => s.action === 'IGNORE').length;
    const push = list.filter(s => s.direction === 'anorha_to_platform' && s.isSelected).length;
    const pushTotal = list.filter(s => s.direction === 'anorha_to_platform').length;
    return { all, matched, needs_review, ignored, push, pushTotal } as any;
  }, [annotatedSuggestions]);

  const filteredReviewItems = useMemo<AnnotatedMappingSuggestion[]>(() => {
    const reviewItems = annotatedSuggestions.filter(item => item.action !== 'IGNORE' && item.resolved !== true && !!item.reviewReason);
    return sortSuggestionItems(reviewItems.filter(item => matchesListQuery(item, listQuery)));
  }, [annotatedSuggestions, listQuery, matchesListQuery, sortSuggestionItems]);

  const reviewBuckets = useMemo<Record<ReviewReason, AnnotatedMappingSuggestion[]>>(() => ({
    low_confidence: filteredReviewItems.filter(item => item.reviewReason === 'low_confidence'),
    no_match_found: filteredReviewItems.filter(item => item.reviewReason === 'no_match_found'),
    variant_mismatch: filteredReviewItems.filter(item => item.reviewReason === 'variant_mismatch'),
  }), [filteredReviewItems]);

  const currentList = useMemo<AnnotatedMappingSuggestion[]>(() => {
    if (activeTab === 'needs_review') {
      let base = filteredReviewItems;
      if (activeReviewBucket) {
        base = base.filter(item => item.reviewReason === activeReviewBucket);
      }
      if (activeReviewItemIds && activeReviewItemIds.length > 0) {
        const ids = new Set(activeReviewItemIds);
        base = base.filter(item => ids.has(item.platformProduct.id));
      }
      return base;
    }

    const base = annotatedSuggestions.filter(item => {
      if (activeTab === 'matched') {
        return (item.action === 'LINK_EXISTING' && item.resolved === true) || (item.action === 'CREATE_NEW' && item.resolved === true);
      }
      if (activeTab === 'ignored') {
        return item.action === 'IGNORE';
      }
      return true;
    });

    return sortSuggestionItems(base.filter(item => matchesListQuery(item, listQuery)));
  }, [activeReviewBucket, activeReviewItemIds, activeTab, annotatedSuggestions, filteredReviewItems, listQuery, matchesListQuery, sortSuggestionItems]);

  const groupedList = useMemo(() => {
    const groups = new Map<string, { title: string, items: AnnotatedMappingSuggestion[] }>();
    const looseItems: AnnotatedMappingSuggestion[] = [];

    currentList.forEach(item => {
      const parentId = item.platformProduct.parentId;
      if (parentId) {
        if (!groups.has(parentId)) {
          groups.set(parentId, {
            title: item.platformProduct.parentTitle || item.platformProduct.title || 'Product',
            items: []
          });
        }
        groups.get(parentId)!.items.push(item);
      } else {
        looseItems.push(item);
      }
    });

    const result: any[] = [];
    groups.forEach((group, id) => {
      if (group.items.length > 1) {
        const prices = group.items
          .map(item => item.platformProduct.price)
          .filter(p => p != null && p > 0);

        const minPrice = prices.length > 0 ? Math.min(...prices) : null;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
        const isExpanded = expandedGroups.has(id);

        result.push({
          type: 'header',
          title: group.title,
          id,
          count: group.items.length,
          minPrice,
          maxPrice,
          isExpanded,
          items: group.items,
        });

        if (isExpanded) {
          result.push(...group.items.map(s => ({ type: 'item', suggestion: s, isChild: true })));
        }
      } else {
        result.push(...group.items.map(s => ({ type: 'item', suggestion: s, isChild: false })));
      }
    });

    result.push(...looseItems.map(s => ({ type: 'item', suggestion: s, isChild: false })));

    return result;
  }, [currentList, expandedGroups]);

  useEffect(() => {
    if (activeTab !== 'needs_review') {
      setActiveReviewBucket(null);
      setActiveReviewItemIds(null);
    }
  }, [activeTab]);

  const reviewBucketMeta: Record<ReviewReason, { title: string; bulkLabel: string; description: string; badge: ReviewBadgeConfig }> = {
    low_confidence: {
      title: 'Low confidence',
      bulkLabel: 'Confirm all matches',
      description: 'These suggestions have weak confidence or need a fresh confirmation.',
      badge: { label: 'Low confidence', tone: 'warning' },
    },
    no_match_found: {
      title: 'No match found',
      bulkLabel: 'Add all as new',
      description: 'Nothing reliable was found, so these need a new item or manual search.',
      badge: { label: 'No match found', tone: 'info' },
    },
    variant_mismatch: {
      title: 'Variant mismatch',
      bulkLabel: 'Add unmatched as new',
      description: 'These variants conflict with the rest of their family and need cleanup.',
      badge: { label: 'Variant mismatch', tone: 'danger' },
    },
  };

  const annotatedSuggestionMap = useMemo(() => {
    return new Map(annotatedSuggestions.map(item => [item.platformProduct.id, item]));
  }, [annotatedSuggestions]);

  const modalContextItem = itemToMatch ? annotatedSuggestionMap.get(itemToMatch.platformProduct.id) ?? null : null;
  const showBucketOverview = activeTab === 'needs_review' && !activeReviewBucket;

  const closeSearchModal = useCallback(() => {
    setShowSearchModal(false);
    setItemToMatch(null);
    setGroupItemsToMatch(null);
    setSearchModalQuery('');
    setSearchModalResults([]);
  }, []);

  const openSearchModalForItem = useCallback((item: MappingSuggestion, groupItems: MappingSuggestion[] | null = null) => {
    setItemToMatch(item);
    setGroupItemsToMatch(groupItems);
    setSearchModalQuery('');
    setSearchModalResults([]);
    performProductSearch('');
    setShowSearchModal(true);
  }, [performProductSearch]);

  const applySuggestionUpdates = useCallback((ids: string[], updater: (item: MappingSuggestion) => MappingSuggestion) => {
    const idSet = new Set(ids);
    const next = (suggestions || []).map(item => idSet.has(item.platformProduct.id) ? updater(item) : item);
    setSuggestions(next);
    return next;
  }, [setSuggestions, suggestions]);

  const maybeOpenVariantReviewSheet = useCallback((nextList: MappingSuggestion[], ids: string[]) => {
    const idSet = new Set(ids);
    const resolvedItems = nextList.filter(item => idSet.has(item.platformProduct.id));
    const parentIds = Array.from(new Set(resolvedItems.map(item => item.platformProduct.parentId).filter(Boolean))) as string[];
    if (parentIds.length !== 1) return;

    const parentId = parentIds[0];
    const familyItems = nextList.filter(item => item.platformProduct.parentId === parentId);
    if (familyItems.length < 2) return;

    const hasNonAutoMatchedSiblings = familyItems.some(item => {
      const isAutoMatched = (item.matchType === 'SKU' || item.matchType === 'BARCODE')
        && !!item.platformProduct.sku
        && !!item.anorhaVariant?.sku
        && item.platformProduct.sku === item.anorhaVariant?.sku;
      return !isAutoMatched;
    });

    if (!hasNonAutoMatchedSiblings) return;

    setVariantReviewSheet({
      visible: true,
      parentId,
      parentTitle: familyItems[0]?.platformProduct.parentTitle || familyItems[0]?.platformProduct.title || null,
      items: familyItems,
    });
  }, []);

  const handleCreateNewForIds = useCallback((ids: string[], options?: { closeModal?: boolean }) => {
    applySuggestionUpdates(ids, (item) => ({
      ...item,
      action: 'CREATE_NEW',
      isSelected: true,
      resolved: true,
    }));

    if (options?.closeModal) {
      closeSearchModal();
    }
  }, [applySuggestionUpdates, closeSearchModal]);

  const handleIgnoreForIds = useCallback((ids: string[], options?: { closeModal?: boolean }) => {
    applySuggestionUpdates(ids, (item) => {
      if (activeTab === 'matched' || (item.action === 'CREATE_NEW' && item.resolved)) {
        return { ...item, action: 'UNMATCHED', matchType: 'TITLE', isSelected: false, resolved: false };
      }

      return {
        ...item,
        prevTab: activeTab,
        prevAction: item.action,
        action: 'IGNORE',
        isSelected: false,
        resolved: false,
      };
    });

    if (options?.closeModal) {
      closeSearchModal();
    }
  }, [activeTab, applySuggestionUpdates, closeSearchModal]);

  const handleConfirmSuggestedForIds = useCallback((ids: string[], options?: { closeModal?: boolean; openVariantSheet?: boolean }) => {
    const staleIds = new Set(
      annotatedSuggestions
        .filter(item => ids.includes(item.platformProduct.id) && item.isStaleClaim)
        .map(item => item.platformProduct.id)
    );

    const safeIds = ids.filter(id => !staleIds.has(id));
    if (safeIds.length === 0) {
      if (options?.closeModal) {
        closeSearchModal();
      }
      return;
    }

    const next = applySuggestionUpdates(safeIds, (item) => {
      if (!item.suggestedCanonicalProduct?.id) return item;
      return {
        ...item,
        action: 'LINK_EXISTING',
        resolved: true,
        isSelected: true,
      };
    });

    if (options?.openVariantSheet !== false) {
      maybeOpenVariantReviewSheet(next, safeIds);
    }

    if (options?.closeModal) {
      closeSearchModal();
    }
  }, [annotatedSuggestions, applySuggestionUpdates, closeSearchModal, maybeOpenVariantReviewSheet]);

  const openVariantReviewBucket = useCallback((items: MappingSuggestion[]) => {
    setVariantReviewSheet({
      visible: false,
      parentId: null,
      parentTitle: null,
      items: [],
    });
    setActiveTab('needs_review');
    setActiveReviewBucket('variant_mismatch');
    setActiveReviewItemIds(items.map(item => item.platformProduct.id));
  }, []);

  const getFamilyIds = useCallback((item: MappingSuggestion) => {
    if (!item.platformProduct.parentId) {
      return [item.platformProduct.id];
    }

    return annotatedSuggestions
      .filter(suggestion => suggestion.platformProduct.parentId === item.platformProduct.parentId)
      .map(suggestion => suggestion.platformProduct.id);
  }, [annotatedSuggestions]);

  const isVariantAutoMatched = useCallback((item: MappingSuggestion) => {
    return (item.matchType === 'SKU' || item.matchType === 'BARCODE')
      && !!item.platformProduct.sku
      && !!item.anorhaVariant?.sku
      && item.platformProduct.sku === item.anorhaVariant?.sku;
  }, []);

  const getReviewBadge = useCallback((item: AnnotatedMappingSuggestion): ReviewBadgeConfig | null => {
    if (item.isStaleClaim) {
      return { label: 'Match taken', tone: 'danger' };
    }
    if (!item.reviewReason) return null;
    return reviewBucketMeta[item.reviewReason].badge;
  }, [reviewBucketMeta]);

  const getPrimaryActionLabel = useCallback((item: AnnotatedMappingSuggestion) => {
    if (item.isStaleClaim) return 'Find match';
    if (item.reviewReason === 'variant_mismatch') return 'Review variants';
    if (item.action === 'UNMATCHED' || !item.suggestedCanonicalProduct?.id) return 'Find match';
    return 'Confirm match';
  }, []);

  // --- END ALWAYS-CALLED HOOKS ---

  const renderTabButton = (tab: ActiveTab, title: string, count: number) => (
    <TouchableOpacity
      style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
      onPress={() => {
        setActiveTab(tab);
      }}
      accessibilityRole="tab"
      accessibilityState={{ selected: activeTab === tab }}
      accessibilityLabel={`${title} ${count}`}
    >
      <Text style={[styles.tabButtonText, activeTab === tab && styles.tabButtonTextActive]}>
        {title} ({count})
      </Text>
    </TouchableOpacity>
  );

  const renderSuggestionItem = ({ item }: { item: MappingSuggestion }) => (
    <Animated.View layout={Layout.springify()}>
      <Card style={styles.reviewItemCard}>
        {/* Platform Product Side */}
        <View style={styles.reviewItemSection}>
          <PlaceholderImage size={40} borderRadius={6} type="icon" icon={getIconForPlatformType(platformName)} />
          <View style={styles.reviewItemDetails}>
            <Text style={styles.reviewItemTitle} numberOfLines={2}>{item.platformProduct.title || 'Unnamed Product'}</Text>
            <Text style={styles.reviewItemSku}>SKU: {item.platformProduct.sku || 'N/A'}</Text>
          </View>
        </View>

        {/* Action Icon in the middle */}
        <View style={styles.reviewItemActionIcon}>
          {item.action === 'LINK_EXISTING' && <Icon name="link-variant" size={24} color={theme.colors.secondary} />}
          {item.action === 'CREATE_NEW' && <Icon name="arrow-right-bold" size={24} color={theme.colors.success} />}
          {item.action === 'IGNORE' && <Icon name="cancel" size={24} color={theme.colors.error} />}
        </View>


        {/* Anorha Product Side */}
        <View style={styles.reviewItemSection}>
          <PlaceholderImage uri={'/src/assets/rounded_anorha.png'} size={40} borderRadius={6} />
          <View style={styles.reviewItemDetails}>
            {item.action === 'LINK_EXISTING' && item.suggestedCanonicalProduct ? (
              <>
                <Text style={styles.reviewItemTitle} numberOfLines={2}>{item.suggestedCanonicalProduct.title || 'Unnamed Product'}</Text>
                <Text style={styles.reviewItemSku}>SKU: {item.suggestedCanonicalProduct.sku || 'N/A'}</Text>
              </>
            ) : item.action === 'CREATE_NEW' ? (
              <Text style={styles.reviewItemActionText}>Will be created in Anorha</Text>
            ) : (
              <Text style={styles.reviewItemActionText}>Will be ignored</Text>
            )}
          </View>
        </View>

        {/* User Action Buttons */}
        <View style={styles.reviewItemUserActions}>
          <TouchableOpacity style={[styles.userActionButton, styles.userActionIgnore]} onPress={() => updateSuggestionAction(item.platformProduct.id, 'IGNORE')}>
            <Icon name="cancel" size={20} color="#fff" />
            <Text>Ignore Item</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.userActionButton, styles.userActionChange]} onPress={() => updateSuggestionAction(item.platformProduct.id, 'CREATE_NEW')}>
            <Icon name="new-box" size={20} color="#fff" />
            <Text>Create New Item</Text>
          </TouchableOpacity>
        </View>
      </Card>
    </Animated.View>
  );

  const renderModernSuggestionItem = ({ item }: { item: MappingSuggestion }) => (
    <View style={styles.suggestionContainer}>
      <View style={[styles.suggestionCard, !item.isSelected && styles.suggestionCardUnselected]}>
        {/* Selection indicator */}
        <TouchableOpacity
          style={styles.selectionIndicator}
          onPress={() => updateSuggestionAction(item.platformProduct.id, item.isSelected ? 'IGNORE' : item.action)}
        >
          <Icon
            name={item.isSelected ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
            size={20}
            color={item.isSelected ? theme.colors.primary : theme.colors.textSecondary}
          />
        </TouchableOpacity>

        {/* Platform Product (Left) */}
        <View style={[styles.miniCard, styles.platformMiniCard]}>
          <PlaceholderImage
            size={40}
            borderRadius={6}
            type={item.platformProduct.imageUrl ? "image" : "icon"}
            uri={item.platformProduct.imageUrl}
            icon={getIconForPlatformType(platformName)}
          />
          <View style={styles.miniCardDetails}>
            <Text style={styles.miniCardTitle} numberOfLines={2}>{item.platformProduct.title}</Text>
            <Text style={styles.miniCardSku}>SKU: {item.platformProduct.sku || 'N/A'}</Text>
            <Text style={styles.miniCardPrice}>${item.platformProduct.price.toFixed(2)}</Text>
          </View>
        </View>

        <Icon name="arrow-right-thin" size={24} color={theme.colors.textSecondary} style={{ marginHorizontal: 8 }} />

        {/* Anorha Product (Right) */}
        {item.action === 'LINK_EXISTING' && item.suggestedCanonicalProduct ? (
          <TouchableOpacity
            style={[styles.miniCard, styles.sssyncMiniCard, styles.linkedMiniCard]}
            onPress={() => {
              setItemToMatch(item);
              setGroupItemsToMatch(null);
              setSearchModalQuery('');
              setSearchModalResults([]);
              performProductSearch('');
              setShowSearchModal(true);
            }}
          >
            <PlaceholderImage
              size={40}
              borderRadius={6}
              type="image"
              uri={'/src/assets/rounded_anorha.png'}
              color={theme.colors.success}
            />
            <View style={styles.miniCardDetails}>
              <Text style={styles.miniCardTitle} numberOfLines={2}>{item.suggestedCanonicalProduct.title}</Text>
              <Text style={styles.miniCardSku}>SKU: {item.suggestedCanonicalProduct.sku || 'N/A'}</Text>
              <View style={styles.matchBadge}>
                <Icon name="link-variant" size={12} color="#fff" />
                <Text style={styles.matchBadgeText}>Linked</Text>
              </View>
            </View>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.emptyMiniCard, item.action === 'IGNORE' && styles.ignoredMiniCard]}
            onPress={() => {
              setItemToMatch(item);
              setGroupItemsToMatch(null);
              setSearchModalQuery('');
              setSearchModalResults([]);
              performProductSearch('');
              setShowSearchModal(true);
            }}
          >
            <Icon
              name={item.action === 'IGNORE' ? "help-circle-outline" : "plus-circle-outline"}
              size={24}
              color={item.action === 'IGNORE' ? theme.colors.warning : theme.colors.textSecondary}
            />
            <Text style={[styles.emptyMiniCardText, item.action === 'IGNORE' && styles.ignoredText]}>
              {item.action === 'IGNORE' ? 'Needs Review' : 'Link Product'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Action indicator */}
        <View style={styles.actionIndicator}>
          {item.action === 'CREATE_NEW' && (
            <View style={[styles.actionBadge, styles.createBadge]}>
              <Icon name="plus" size={12} color="#fff" />
              <Text style={styles.actionBadgeText}>New</Text>
            </View>
          )}
          {item.action === 'LINK_EXISTING' && (
            <View style={[styles.actionBadge, styles.linkBadge]}>
              <Icon name="link-variant" size={12} color="#fff" />
              <Text style={styles.actionBadgeText}>Link</Text>
            </View>
          )}
          {item.action === 'IGNORE' && (
            <View style={[styles.actionBadge, styles.ignoreBadge]}>
              <Icon name="help-circle" size={12} color="#fff" />
              <Text style={styles.actionBadgeText}>Review</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );

  const renderConnectionItem = (connection: PlatformConnection) => {
    const isSelected = selectedConnectionIds.includes(connection.Id);
    const isCurrentConnection = connection.Id === connectionId;

    return (
      <TouchableOpacity
        key={connection.Id}
        style={[
          styles.connectionItem,
          isSelected && styles.connectionItemSelected,
          isCurrentConnection && styles.connectionItemCurrent
        ]}
        onPress={() => toggleConnectionSelection(connection.Id)}
      >
        <View style={styles.connectionItemContent}>
          <Icon
            name={getIconForPlatformType(connection.PlatformType)}
            size={24}
            color={isSelected ? theme.colors.primary : theme.colors.textSecondary}
          />
          <View style={styles.connectionTextContainer}>
            <Text style={[
              styles.connectionName,
              isSelected && { color: theme.colors.primary }
            ]}>
              {connection.DisplayName}
            </Text>
            <Text style={styles.connectionPlatformType}>{connection.PlatformType}</Text>
          </View>
        </View>
        <Icon
          name={isSelected ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
          size={22}
          color={isSelected ? theme.colors.primary : theme.colors.textSecondary}
        />
      </TouchableOpacity>
    );
  };

  const getIconForPlatformType = (platformType: string): string => {
    const type = platformType.toLowerCase();
    if (type.includes('shopify')) return 'shopping';
    if (type.includes('square')) return 'square-medium';
    if (type.includes('clover')) return 'clover';
    if (type.includes('amazon')) return 'amazon';
    if (type.includes('ebay')) return 'tag';
    if (type.includes('facebook')) return 'facebook';
    return 'store';
  };

  const renderProgressBar = () => {
    // Show WebSocket sync progress if available
    if (syncProgress && syncProgress.status === 'syncing') {
      return (
        <View style={styles.progressContainer}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Syncing Products</Text>
            <Text style={styles.progressPercentage}>{`${Math.round(syncProgress.progress)}%`}</Text>
          </View>
          <Progress.Bar
            progress={syncProgress.progress / 100}
            width={null}
            height={12}
            borderRadius={8}
            color={theme.colors.primary}
            unfilledColor={theme.colors.surface}
            borderWidth={0}
          />
          <Text style={styles.progressSubtitle}>
            {syncProgress.description}
          </Text>
        </View>
      );
    }

    // Fallback to summary data progress
    if (!summaryData) return null;

    const {
      totalPlatformProducts = 0,
      perfectMatchCount = 0,
      newFromPlatformCount = 0,
      needsReviewCount = 0
    } = summaryData;

    if (totalPlatformProducts === 0) return null;

    // Items that are "done" are those that are perfect matches or newly created. 
    // We assume items needing review are not yet "done".
    const completedItems = (totalPlatformProducts - needsReviewCount);
    const progress = completedItems / totalPlatformProducts;
    const progressPercent = Math.round(progress * 100);

    return (
      <View style={styles.progressContainer}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>
            {isReconcileMode ? 'Reconciliation Progress' : 'Sync Progress'}
          </Text>
          <Text style={styles.progressPercentage}>{`${progressPercent}%`}</Text>
        </View>
        <Progress.Bar
          progress={progress}
          width={null} // null so it takes up the full container width
          height={12}
          borderRadius={8}
          color={theme.colors.primary}
          unfilledColor={theme.colors.surface}
          borderWidth={0}
        />
        <Text style={styles.progressSubtitle}>
          {`${completedItems} of ${totalPlatformProducts} products reviewed`}
        </Text>
      </View>
    );
  };

  // --- NEW: Add summary cards UI for batch approval ---
  // REMOVED: renderSummaryCards function - going directly to tabs view

  // --- NEW: Function to prepare and show final review ---
  // REMOVED: prepareFinalReview function - using direct activation instead

  // --- NEW: Function to reset connection and fetch suggestions directly ---
  const resetConnectionAndFetch = async () => {
    console.log(`[MappingReviewScreen] Resetting connection ${connectionId} and fetching suggestions directly`);
    setLoading(true);
    setError(null);

    try {
      const token = await waitForSupabaseToken();
      if (!token) throw new Error("Authentication token not found. Please log in again.");

      // First, try to update the connection status to 'active' to reset any stuck state
      console.log(`[MappingReviewScreen] Resetting connection status to 'active'`);
      const resetResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/platform-connections/${connectionId}/status`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'active' }),
      });

      if (resetResponse.ok) {
        console.log(`[MappingReviewScreen] Successfully reset connection status`);
      } else {
        console.warn(`[MappingReviewScreen] Failed to reset connection status: ${resetResponse.status}`);
      }

      // Now try to fetch mapping suggestions directly
      await importSession.refreshSuggestions();

    } catch (err: any) {
      console.error('[MappingReviewScreen] Error in resetConnectionAndFetch:', err);
      setError(err.message || 'Failed to reset connection and fetch suggestions.');
    } finally {
      setLoading(false);
    }
  };

  // --- NEW: Function to refresh/rescan platform products ---
  const handleRefreshPlatform = async () => {
    console.log(`[MappingReviewScreen] Refreshing platform data for ${connectionId}`);
    setIsRefreshing(true);
    setError(null);

    try {
      const token = await waitForSupabaseToken();
      if (!token) throw new Error("Authentication required");

      // Trigger a platform rescan
      const scanResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/rescan`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (scanResponse.ok) {
        console.log(`[MappingReviewScreen] Scan triggered successfully, fetching suggestions...`);
        // Wait a moment then fetch fresh suggestions
        await new Promise(resolve => setTimeout(resolve, 500));
        await importSession.refreshSuggestions();
      } else {
        // If scan endpoint fails, just refresh suggestions
        console.warn(`[MappingReviewScreen] Scan trigger failed, refreshing suggestions directly`);
        await importSession.refreshSuggestions();
      }

    } catch (err: any) {
      console.error('[MappingReviewScreen] Error refreshing platform:', err);
      setError(err.message || 'Failed to refresh platform data');
    } finally {
      setIsRefreshing(false);
    }
  };

  // --- NEW: Sync Rules UI Components ---
  const renderSyncDirectionOption = (option: SyncDirection, title: string, subtitle: string, icon: string) => (
    <TouchableOpacity
      style={[syncRulesStyles.optionButton, syncDirection === option && syncRulesStyles.optionButtonSelected]}
      onPress={() => setSyncDirection(option)}
    >
      <Icon
        name={icon}
        size={24}
        color={syncDirection === option ? theme.colors.primary : theme.colors.textSecondary}
        style={syncRulesStyles.optionIcon}
      />
      <View style={{ flex: 1 }}>
        <Text style={[syncRulesStyles.optionTitle, syncDirection === option && syncRulesStyles.optionTitleSelected]}>{title}</Text>
        <Text style={[syncRulesStyles.optionSubtitle, syncDirection === option && syncRulesStyles.optionSubtitleSelected]}>{subtitle}</Text>
      </View>
      <Icon
        name={syncDirection === option ? 'radiobox-marked' : 'radiobox-blank'}
        size={20}
        color={syncDirection === option ? theme.colors.primary : theme.colors.textSecondary}
      />
    </TouchableOpacity>
  );

  const renderSourceOption = (option: SourceOfTruth, title: string, subtitle: string, icon: string) => (
    <TouchableOpacity
      style={[syncRulesStyles.optionButton, sourceOfTruth === option && syncRulesStyles.optionButtonSelected]}
      onPress={() => setSourceOfTruth(option)}
    >
      <Icon
        name={icon}
        size={24}
        color={sourceOfTruth === option ? theme.colors.primary : theme.colors.textSecondary}
        style={syncRulesStyles.optionIcon}
      />
      <View style={{ flex: 1 }}>
        <Text style={[syncRulesStyles.optionTitle, sourceOfTruth === option && syncRulesStyles.optionTitleSelected]}>{title}</Text>
        <Text style={[syncRulesStyles.optionSubtitle, sourceOfTruth === option && syncRulesStyles.optionSubtitleSelected]}>{subtitle}</Text>
      </View>
      <Icon
        name={sourceOfTruth === option ? 'radiobox-marked' : 'radiobox-blank'}
        size={20}
        color={sourceOfTruth === option ? theme.colors.primary : theme.colors.textSecondary}
      />
    </TouchableOpacity>
  );


  // Sync rules styles
  const syncRulesStyles = StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 15,
      borderBottomWidth: 1,
      borderBottomColor: '#e0e0e0',
      backgroundColor: theme.colors.surface,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text,
    },
    doneButton: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.primary,
    },
    modalContent: {
      flex: 1,
      padding: 20,
    },
    ruleSection: {
      marginBottom: 20,
      padding: 20,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 5,
    },
    sectionSubtitle: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 15,
      lineHeight: 20,
    },
    optionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 15,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#e0e0e0',
      marginBottom: 10,
      backgroundColor: theme.colors.background,
    },
    optionButtonSelected: {
      borderColor: theme.colors.primary,
      backgroundColor: theme.colors.primary + '10',
    },
    optionIcon: {
      marginRight: 12,
    },
    optionTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.text,
    },
    optionTitleSelected: {
      color: theme.colors.primary,
    },
    optionSubtitle: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    optionSubtitleSelected: {
      color: theme.colors.primary,
    },
    switchRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#e0e0e030',
    },
    switchLabelContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    switchLabel: {
      fontSize: 16,
      color: theme.colors.text,
      marginLeft: 12,
    },
    inputRow: {
      marginBottom: 15,
    },
    inputContainer: {
      marginBottom: 15,
    },
    inputLabel: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.text,
      marginBottom: 8,
    },
    numberInput: {
      borderWidth: 1,
      borderColor: '#e0e0e0',
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: theme.colors.text,
      backgroundColor: theme.colors.background,
    },
    previewCard: {
      backgroundColor: '#f8f9fa',
      borderRadius: 8,
      padding: 15,
      marginBottom: 15,
    },
    previewRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 4,
    },
    previewRowHighlighted: {
      backgroundColor: theme.colors.primary + '10',
      paddingHorizontal: 8,
      borderRadius: 4,
      marginHorizontal: -8,
    },
    previewLabel: {
      fontSize: 14,
      color: theme.colors.text,
      fontWeight: '500',
    },
    previewValue: {
      fontSize: 14,
      color: theme.colors.text,
      fontWeight: '600',
    },
    previewValueHighlighted: {
      fontSize: 14,
      color: theme.colors.primary,
      fontWeight: '600',
    },
    infoBox: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#FFF3CD',
      borderRadius: 6,
      padding: 10,
      borderWidth: 1,
      borderColor: '#FFE69C',
    },
    infoText: {
      fontSize: 12,
      color: '#856404',
      marginLeft: 8,
      flex: 1,
    },
    advancedToggle: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 15,
    },
    advancedText: {
      fontSize: 16,
      color: theme.colors.primary,
      fontWeight: '600',
      marginLeft: 8,
    },
  });

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
      paddingTop: 50,
    },
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
      backgroundColor: theme.colors.background,
    },
    groupHeaderActionable: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      marginVertical: 4,
      borderWidth: 1,
      borderColor: theme.colors.textSecondary + '30', // 30 = 18% opacity
    },
    groupHeaderText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
    },
    groupPriceRange: {
      fontSize: 12,
      fontWeight: '500',
      color: theme.colors.success,
      marginTop: 2,
    },
    variantCountBadge: {
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      marginLeft: 8,
    },
    variantCountText: {
      fontSize: 12,
      fontWeight: '500',
      color: theme.colors.textSecondary,
    },
    expandedGroupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 8,
      backgroundColor: theme.colors.background,
      marginTop: 8,
    },
    expandedGroupHeaderText: {
      fontSize: 14,
      fontWeight: '700',
      color: theme.colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    expandedGroupLine: {
      flex: 1,
      height: 1,
      backgroundColor: theme.colors.textSecondary + '20',
      marginLeft: 10,
    },
    backToBucketsButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    backToBucketsText: {
      color: theme.colors.primary,
      fontWeight: '600',
    },
    bucketScopeHeader: {
      flex: 1,
      paddingRight: 16,
    },
    bucketScopeTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.text,
    },
    bucketScopeDescription: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    centered: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      backgroundColor: theme.colors.background,
    },
    loadingText: {
      marginTop: 10,
      fontSize: 16,
      color: theme.colors.textSecondary,
    },
    errorText: {
      marginTop: 10,
      fontSize: 16,
      color: theme.colors.error,
      textAlign: 'center',
      marginBottom: 15,
    },
    emptyText: {
      marginTop: 10,
      fontSize: 16,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginBottom: 15,
    },
    headerContainer: {
      paddingHorizontal: 20,
      marginTop: 50,
      paddingTop: 10,
      paddingBottom: 20,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.background,
    },
    title: {
      fontSize: 28,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 5,
    },
    platformText: {
      fontSize: 18,
      color: theme.colors.primary,
      marginBottom: 10,
    },
    summaryContainer: {
      flexDirection: 'column',
      marginBottom: 10,
    },
    summaryRow: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      marginVertical: 5,
    },
    summaryItem: {
      alignItems: 'center',
      padding: 8,
      borderRadius: 8,
      backgroundColor: theme.colors.surface,
      minWidth: 100,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2 },
        android: { elevation: 1 },
      }),
    },
    summaryCount: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    summaryLabel: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 4,
    },
    batchActionsContainer: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      flexDirection: 'column',
      borderBottomWidth: 1,
      borderBottomColor: '#ddd',
      backgroundColor: theme.colors.surface,
      gap: 10,
    },
    actionHubTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 15,
      textAlign: 'center',
    },
    explainerCard: {
      marginHorizontal: 15,
      marginTop: 15,
      padding: 15,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    explainerText: {
      flex: 1,
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 20,
    },
    batchButton: {
      width: '100%',
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '600',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 10,
      color: theme.colors.text,
    },
    suggestionList: {
      paddingHorizontal: 15,
      paddingBottom: 15,
    },
    itemHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    itemTitle: {
      fontSize: 16,
      fontWeight: '500',
      flex: 1,
      color: theme.colors.text,
    },
    itemSku: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginBottom: 10,
    },
    confidenceBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
      marginLeft: 10,
    },
    confidence_high: { backgroundColor: theme.colors.success + '30' },
    confidence_medium: { backgroundColor: theme.colors.warning + '30' },
    confidence_low: { backgroundColor: theme.colors.error + '30' },
    confidenceText: {
      fontSize: 10,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    itemActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
      marginLeft: 8,
    },
    approveButton: {
      backgroundColor: theme.colors.success,
    },
    rejectButton: {
      backgroundColor: theme.colors.error,
    },
    previewButton: {
      backgroundColor: theme.colors.primary + '20',
    },
    needsReviewSection: {
      padding: 20,
    },
    placeholderText: {
      fontStyle: 'italic',
      textAlign: 'center',
      paddingVertical: 20,
      color: theme.colors.textSecondary,
    },
    footerActions: {
      padding: 20,
      borderTopWidth: 1,
      borderTopColor: '#ddd',
      marginTop: 20,
    },
    actionButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      marginLeft: 10,
    },
    linkButton: {
      backgroundColor: theme.colors.success + '20',
    },
    createButton: {
      backgroundColor: theme.colors.secondary + '20',
    },
    connectionsContainer: {
      backgroundColor: theme.colors.surface,
      padding: 15,
      marginVertical: 10,
      borderRadius: 8,
      marginHorizontal: 15,
    },
    connectionsTitle: {
      fontSize: 16,
      fontWeight: '600',
      marginBottom: 10,
      color: theme.colors.text,
    },
    connectionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#f0f0f0',
    },
    connectionItemSelected: {
      backgroundColor: theme.colors.primary + '10',
    },
    connectionItemCurrent: {
      borderLeftWidth: 3,
      borderLeftColor: theme.colors.primary,
    },
    connectionItemContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    connectionTextContainer: {
      marginLeft: 10,
    },
    connectionName: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.text,
    },
    connectionPlatformType: {
      fontSize: 12,
      color: theme.colors.textSecondary,
    },
    syncButtonContainer: {
      padding: 15,
      backgroundColor: theme.colors.surface,
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      borderTopWidth: 1,
      borderTopColor: '#f0f0f0',
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: -2 }, shadowOpacity: 0.1, shadowRadius: 4 },
        android: { elevation: 5 },
      }),
    },
    progressContainer: {
      paddingHorizontal: 20,
      paddingVertical: 15,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.background,
    },
    progressHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 8,
    },
    progressTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
    },
    progressPercentage: {
      fontSize: 16,
      fontWeight: 'bold',
      color: theme.colors.primary,
    },
    progressSubtitle: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 6,
      textAlign: 'right',
    },
    summaryTextContainer: {
      marginBottom: 15,
      paddingHorizontal: 10,
    },
    summaryText: {
      fontSize: 15,
      color: theme.colors.textSecondary,
      lineHeight: 22,
      marginBottom: 5,
    },
    boldText: {
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    nextStepText: {
      fontSize: 16,
      color: theme.colors.text,
      marginTop: 8,
      textAlign: 'center',
    },
    itemContent: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    itemDetails: {
      flex: 1,
    },
    checkbox: {
      padding: 6,
      marginRight: 6,
    },
    actionBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
    },
    badgeNew: {
      backgroundColor: theme.colors.success,
    },
    badgeLink: {
      backgroundColor: theme.colors.secondary,
    },
    actionBadgeText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: 'bold',
      marginLeft: 4,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalContent: {
      width: '90%',
      backgroundColor: theme.colors.background,
      borderRadius: 12,
      padding: 20,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      marginBottom: 15,
      color: theme.colors.text,
    },
    modalSectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginTop: 10,
      marginBottom: 5,
      borderTopWidth: 1,
      borderTopColor: '#eee',
      paddingTop: 10,
    },
    modalText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 5,
    },
    modalCloseButton: {
      marginTop: 20,
    },
    backButton: {
      position: 'absolute',
      top: 20,
      left: 20,
      zIndex: 10,
      padding: 10,
      backgroundColor: theme.colors.surface,
      borderRadius: 20,
    },
    tabContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingHorizontal: 15,
      paddingTop: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#eee',
      backgroundColor: theme.colors.surface,
    },
    tabButton: {
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    tabButtonActive: {
      borderBottomColor: theme.colors.primary,
    },
    tabButtonText: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.colors.textSecondary,
    },
    tabButtonTextActive: {
      color: theme.colors.primary,
      fontWeight: '600',
    },
    listContainer: {
      marginHorizontal: 15,
      marginBottom: 15,
      marginTop: 15
    },
    progressMainTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    progressDescription: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginBottom: 25,
      paddingHorizontal: 20,
    },
    progressBarContainer: {
      width: '90%',
      marginBottom: 20,
    },
    progressMetrics: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginTop: 8,
    },
    progressPercentText: {
      fontSize: 14,
      color: theme.colors.primary,
      fontWeight: '600',
    },
    progressCountText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      fontWeight: '500',
    },
    activityListContainer: {
      marginTop: 20,
      width: '90%',
      backgroundColor: theme.colors.surface,
      borderRadius: 8,
      padding: 15,
    },
    activityListTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
      marginBottom: 10,
    },
    activityListItem: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 8,
    },
    activityListItemText: {
      fontSize: 14,
      color: theme.colors.text,
      marginLeft: 10,
    },
    summaryHeader: {
      paddingHorizontal: 20,
      paddingTop: 70, // Adjust for back button
      paddingBottom: 10,
      backgroundColor: theme.colors.background,
    },
    summaryTitle: {
      fontSize: 26,
      fontWeight: 'bold',
      color: theme.colors.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    summarySubtitle: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
    summaryCardsContainer: {
      padding: 15,
    },
    summaryCard: {
      marginBottom: 15,
      padding: 0,
      overflow: 'hidden',
    },
    summaryCardContent: {
      flexDirection: 'row',
      padding: 15,
    },
    summaryCardIcon: {
      marginRight: 15,
    },
    summaryCardTextContainer: {
      flex: 1,
    },
    summaryCardTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 5,
    },
    summaryCardDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 20,
    },
    summaryCardActions: {
      borderTopWidth: 1,
      borderTopColor: '#eee',
      padding: 15,
      gap: 10,
    },
    summaryCardPrimaryButton: {
      width: '100%',
    },
    summaryCardSecondaryButton: {
      alignItems: 'center',
      paddingVertical: 8,
    },
    summaryCardSecondaryButtonText: {
      color: theme.colors.primary,
      fontWeight: '600',
    },
    finalReviewContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.colors.background,
      padding: 20,
      paddingTop: 60,
      zIndex: 10,
    },
    finalReviewTitle: {
      fontSize: 28,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 10,
      textAlign: 'center',
    },
    finalReviewSubtitle: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      marginBottom: 30,
      textAlign: 'center',
      lineHeight: 22,
    },
    finalReviewCard: {
      padding: 20,
      marginBottom: 30,
    },
    finalReviewItem: {
      flexDirection: 'row',
      marginBottom: 20,
      alignItems: 'flex-start',
    },
    finalReviewItemContent: {
      marginLeft: 15,
      flex: 1,
    },
    finalReviewItemTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 5,
    },
    finalReviewItemDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      lineHeight: 20,
    },
    activateSyncButton: {
      marginBottom: 15,
    },
    cancelButton: {
      padding: 15,
      alignItems: 'center',
    },
    cancelButtonText: {
      color: theme.colors.textSecondary,
      fontWeight: '600',
    },
    backToSummaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 15,
      paddingBottom: 10,
    },
    backToSummaryText: {
      marginLeft: 8,
      color: theme.colors.primary,
      fontWeight: '600',
    },
    reviewItemCard: {
      padding: 15,
      marginBottom: 10,
    },
    reviewItemSection: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    reviewItemDetails: {
      marginLeft: 10,
      flex: 1,
    },
    reviewItemTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.text,
    },
    reviewItemSku: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    reviewItemActionIcon: {
      marginVertical: 15,
      alignItems: 'center',
    },
    reviewItemLongButton: {
      flex: 1,
      marginVertical: 15,
      alignItems: 'center',
    }, reviewItemActionText: {
      fontSize: 14,
      fontStyle: 'italic',
      color: theme.colors.textSecondary,
    },
    reviewItemUserActions: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      borderTopWidth: 1,
      borderTopColor: '#eee',
      marginTop: 15,
      paddingTop: 10,
    },
    userActionButton: {
      flex: 1,
      borderRadius: 25,
      justifyContent: 'center',
      alignItems: 'center',
    },
    userActionConfirm: { backgroundColor: theme.colors.success },
    userActionChange: { backgroundColor: theme.colors.secondary },
    userActionIgnore: { backgroundColor: theme.colors.error },
    userActionSearch: { backgroundColor: theme.colors.primary },
    searchModal: {
      flex: 1,
      backgroundColor: theme.colors.background,
      padding: 20,
    },
    searchModalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    searchModalTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: theme.colors.text,
    },
    searchInput: {
      borderWidth: 1,
      borderColor: theme.colors.textSecondary,
      padding: 10,
      marginBottom: 10,
    },
    searchSpinner: {
      marginTop: 20,
    },
    searchResultItem: {
      padding: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#f0f0f0',
    },
    searchResultContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    searchResultTitle: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.colors.text,
    },
    searchResultSku: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginLeft: 10,
    },
    searchResultPrice: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginLeft: 10,
    },
    searchModalOptionList: {
      paddingHorizontal: 16,
      paddingBottom: 12,
      gap: 8,
    },
    searchModalOptionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: '#F9FAFB',
      borderWidth: 1,
      borderColor: '#E5E7EB',
    },
    searchModalOptionText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
    },
    searchEmptyText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginTop: 10,
    },
    detailSearchContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 10,
    },
    detailSearchInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.colors.textSecondary,
      padding: 10,
      marginRight: 10,
    },
    detailSearchButton: {
      padding: 10,
      backgroundColor: theme.colors.primary,
      borderRadius: 5,
    },
    searchResultsCount: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginTop: 5,
    },
    emptyStateContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    clearSearchText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginTop: 10,
    },
    searchEmptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    searchEmptySubtext: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginTop: 10,
    },
    searchingText: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      marginTop: 10,
    },
    searchResultMain: {
      flex: 1,
    },
    stalledWarning: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 10,
      padding: 10,
      backgroundColor: theme.colors.warning + '20',
      borderRadius: 5,
    },
    stalledText: {
      fontSize: 14,
      color: theme.colors.warning,
      marginLeft: 5,
    },
    debugInfo: {
      marginTop: 10,
      padding: 10,
      backgroundColor: theme.colors.surface + '20',
      borderRadius: 5,
    },
    debugText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      marginBottom: 5,
    },
    skipPollingButton: {
      marginTop: 15,
      padding: 10,
      backgroundColor: theme.colors.warning,
      borderRadius: 5,
      alignItems: 'center',
    },
    skipPollingButtonText: {
      color: '#fff',
      fontWeight: '600',
    },
    headerSection: {
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 20,
      backgroundColor: theme.colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.background,
    },
    pageTitle: {
      fontSize: 28,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 5,
    },
    pageSubtitle: {
      fontSize: 16,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
    modernTabContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingHorizontal: 15,
      paddingTop: 10,
      borderBottomWidth: 1,
      borderBottomColor: '#eee',
      backgroundColor: theme.colors.surface,
    },
    searchSection: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      flexDirection: 'column',
    },
    reviewBucketCard: {
      marginBottom: 14,
      padding: 16,
    },
    reviewBucketHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      marginBottom: 14,
    },
    reviewBucketTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.colors.text,
    },
    reviewBucketDescription: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginTop: 4,
      lineHeight: 18,
    },
    reviewBucketCount: {
      minWidth: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.primary + '14',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
    },
    reviewBucketCountText: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.colors.primary,
    },
    reviewBucketActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    reviewBucketPrimaryAction: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: theme.colors.primary,
      paddingVertical: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reviewBucketPrimaryActionDisabled: {
      opacity: 0.45,
    },
    reviewBucketPrimaryActionText: {
      color: '#fff',
      fontWeight: '700',
    },
    reviewBucketSecondaryAction: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#E5E7EB',
      paddingVertical: 12,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    reviewBucketSecondaryActionText: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    modernSearchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: theme.colors.surface,
      borderWidth: 1,
      borderColor: theme.colors.textSecondary,
      borderRadius: 5,
    },
    searchIcon: {
      marginRight: 10,
    },
    modernSearchInput: {
      flex: 1,
      padding: 5,
      color: theme.colors.text,
    },
    clearSearchButton: {
      padding: 5,
      marginLeft: 10,
    },
    contentSection: {
      paddingHorizontal: 20,
      paddingVertical: 10,
      flexDirection: 'column',
      gap: 10,
    },
    productList: {
      flexDirection: 'column',
      gap: 10,
    },
    modernEmptyState: {
      marginTop: 12,
      minHeight: "35%",
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      backgroundColor: theme.colors.surface,
      borderWidth: 2,
      borderColor: "rgba(0, 0, 0, 0.31)",
      borderRadius: 12,
    },
    emptyStateIcon: {
      marginBottom: 10,
    },
    emptyStateTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: "rgba(0, 0, 0, 0.76)",
      textAlign: 'center',
    },
    emptyStateDescription: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
      lineHeight: 22,
    },
    clearSearchAction: {
      padding: 10,
      backgroundColor: theme.colors.error,
      borderRadius: 5,
      alignItems: 'center',
    },
    clearSearchActionText: {
      color: '#fff',
      fontWeight: '600',
    },
    searchResultsFooter: {
      marginTop: 10,
      paddingHorizontal: 10,
      paddingVertical: 5,
      backgroundColor: theme.colors.surface,
      borderRadius: 5,
    },
    searchResultsText: {
      fontSize: 14,
      color: theme.colors.textSecondary,
      textAlign: 'center',
    },
    successNotification: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: theme.colors.background,
      justifyContent: 'center',
      alignItems: 'center',
    },
    notificationCard: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 20,
      alignItems: 'center',
    },
    notificationContent: {
      alignItems: 'center',
    },
    notificationTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.success,
      marginBottom: 10,
      textAlign: 'center',
    },
    notificationMessage: {
      fontSize: 16,
      color: theme.colors.text,
      textAlign: 'center',
    },
    suggestionContainer: {
      paddingHorizontal: 5,
    },
    suggestionCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      padding: 10,
      marginBottom: 15,
      ...Platform.select({
        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4 },
        android: { elevation: 3 },
      }),
    },
    miniCard: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      padding: 8,
      borderRadius: 8,
      minHeight: 70, // Ensure consistent height
    },
    platformMiniCard: {
      backgroundColor: theme.colors.background,
    },
    sssyncMiniCard: {
      backgroundColor: theme.colors.background,
    },
    miniCardDetails: {
      flex: 1,
      marginLeft: 10,
    },
    miniCardTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
    },
    miniCardSku: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    emptyMiniCard: {
      flex: 1,
      minHeight: 70, // Ensure consistent height
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 15,
      backgroundColor: `${theme.colors.textSecondary}10`, // Lighter gray background
      borderRadius: 8,
      borderWidth: 2,
      borderColor: `${theme.colors.textSecondary}50`, // Lighter gray border
      borderStyle: 'dashed',
    },
    emptyMiniCardText: {
      marginTop: 5,
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.textSecondary,
    },
    // New styles for enhanced UI
    suggestionCardUnselected: {
      opacity: 0.6,
      borderColor: theme.colors.textSecondary + '30',
    },
    selectionIndicator: {
      position: 'absolute',
      top: 8,
      left: 8,
      zIndex: 10,
      backgroundColor: theme.colors.background,
      borderRadius: 12,
      padding: 2,
    },
    miniCardPrice: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.colors.primary,
      marginTop: 2,
    },
    linkedMiniCard: {
      borderColor: theme.colors.success + '50',
      borderWidth: 1,
    },
    matchBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.success,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      marginTop: 4,
    },
    matchBadgeText: {
      fontSize: 10,
      fontWeight: '600',
      color: '#fff',
      marginLeft: 2,
    },
    ignoredMiniCard: {
      borderColor: theme.colors.warning + '50',
      borderWidth: 1,
      backgroundColor: theme.colors.warning + '10',
    },
    ignoredText: {
      color: theme.colors.warning,
      fontWeight: '600',
    },
    actionIndicator: {
      position: 'absolute',
      top: 8,
      right: 8,
      zIndex: 10,
    },
    createBadge: {
      backgroundColor: theme.colors.secondary,
    },
    linkBadge: {
      backgroundColor: theme.colors.success,
    },
    ignoreBadge: {
      backgroundColor: theme.colors.warning,
    },
    // Sync Rules Button Styles
    syncRulesSection: {
      paddingHorizontal: 20,
      paddingVertical: 10,
    },
    syncRulesButton: {
      backgroundColor: theme.colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#e0e0e0',
    },
    syncRulesButtonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
    },
    syncRulesButtonText: {
      flex: 1,
      marginLeft: 12,
    },
    syncRulesButtonTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.text,
    },
    syncRulesButtonSubtitle: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginTop: 2,
    },
    variantSheet: {
      maxHeight: '78%',
      backgroundColor: '#fff',
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 24,
    },
    variantSheetHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 16,
      gap: 12,
    },
    variantSheetTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.colors.text,
    },
    variantSheetSubtitle: {
      fontSize: 13,
      color: theme.colors.textSecondary,
      marginTop: 4,
      lineHeight: 18,
    },
    variantSheetClose: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#F3F4F6',
    },
    variantSheetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#F3F4F6',
    },
    variantSheetColumn: {
      flex: 1,
    },
    variantSheetColumnLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: '#9CA3AF',
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    variantSheetName: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.colors.text,
    },
    variantSheetSku: {
      fontSize: 12,
      color: theme.colors.textSecondary,
      marginTop: 4,
    },
    variantSheetPlaceholder: {
      fontSize: 14,
      fontWeight: '600',
      color: '#B45309',
    },
    variantSheetStatusWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    variantSheetStatusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
    },
    variantSheetStatusMatch: {
      backgroundColor: '#DCFCE7',
    },
    variantSheetStatusUnmatched: {
      backgroundColor: '#FEE2E2',
    },
    variantSheetStatusText: {
      fontSize: 12,
      fontWeight: '700',
    },
    variantSheetStatusTextMatch: {
      color: '#166534',
    },
    variantSheetStatusTextUnmatched: {
      color: '#B91C1C',
    },
    variantSheetActions: {
      gap: 10,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: '#F3F4F6',
    },
    variantSheetPrimaryAction: {
      backgroundColor: theme.colors.primary,
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    variantSheetPrimaryActionText: {
      color: '#fff',
      fontWeight: '700',
    },
    variantSheetSecondaryAction: {
      borderRadius: 12,
      paddingVertical: 13,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: '#E5E7EB',
    },
    variantSheetSecondaryActionText: {
      color: theme.colors.text,
      fontWeight: '700',
    },
    variantSheetTertiaryAction: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 4,
    },
    variantSheetTertiaryActionText: {
      color: theme.colors.textSecondary,
      fontWeight: '600',
    },
  });

  // ✅ UPDATED: Show loading with progress when isPolling or isScanningActive, using WebSocket data
  if (loading && (isPolling || isScanningActive)) {
    // ✅ Use syncProgress from WebSocket as primary source, fallback to jobProgress for compatibility
    const wsProgress = syncProgress?.progress ? (syncProgress.progress / 100) : 0;
    const localProgress = jobProgress?.progress || 0;
    const progressValue = syncProgress ? wsProgress : localProgress;
    const progressPercent = Math.round((syncProgress?.progress || localProgress * 100) || 0);
    const isStalled = !syncProgress && jobProgress && !jobProgress.isActive && !jobProgress.isCompleted && !jobProgress.isFailed;
    const progressDescription = syncProgress?.description || jobProgress?.description || 'Initializing scan...';

    return (
      <View style={styles.container}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.backButton, { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, marginTop: 40 }]}
        >
          <Icon name="arrow-left" size={20} color={theme.colors.text} />
          <Text style={{ marginLeft: 6, fontSize: 16, fontWeight: '500', color: theme.colors.text }}>Back</Text>
        </TouchableOpacity>
        <View style={styles.centered}>
          <Text style={styles.progressMainTitle}>Analyzing Your Products</Text>
          <Text style={styles.progressDescription}>
            {progressDescription}
          </Text>

          {/* ✅ Estimated Time Display */}
          {(syncProgress?.details as any)?.estimatedSecondsRemaining != null && (syncProgress?.details as any)?.estimatedSecondsRemaining > 0 && (
            <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginTop: 4, marginBottom: 8, fontStyle: 'italic' }}>
              Estimated time remaining: {Math.ceil((syncProgress?.details as any)?.estimatedSecondsRemaining)}s
            </Text>
          )}

          <View style={styles.progressBarContainer}>
            <Progress.Bar
              progress={progressValue}
              width={null} // Full width
              height={12}
              borderRadius={8}
              color={isStalled ? theme.colors.warning : theme.colors.primary}
              unfilledColor={theme.colors.surface}
              borderWidth={0}
            />
            <View style={styles.progressMetrics}>
              <Text style={[styles.progressPercentText, isStalled && { color: theme.colors.warning }]}>
                {`${progressPercent}%`}
              </Text>
              {/* ✅ Show processed/total from WebSocket or fallback to jobProgress */}
              {(syncProgress?.details?.productsProcessed != null || jobProgress?.total != null) && (
                <Text style={styles.progressCountText}>
                  {syncProgress?.details?.productsProcessed != null
                    ? `${syncProgress.details.productsProcessed} products processed`
                    : `${jobProgress?.processed || 0} / ${jobProgress?.total} items`}
                </Text>
              )}
            </View>
          </View>

          {isStalled && (
            <View style={styles.stalledWarning}>
              <Icon name="alert-circle" size={20} color={theme.colors.warning} />
              <Text style={styles.stalledText}>Processing may take a moment...</Text>
            </View>
          )}

          <View style={styles.activityListContainer}>
            <Text style={styles.activityListTitle}>Progress</Text>
            {/* ✅ Real progress checkpoints based on connection status and progress */}
            <View style={styles.activityListItem}>
              <Icon name="check-circle" size={16} color={theme.colors.success} />
              <Text style={styles.activityListItemText}>Connection established</Text>
            </View>
            <View style={styles.activityListItem}>
              <Icon
                name={progressPercent >= 10 || connection?.Status === 'scanning' ? "check-circle" : "loading"}
                size={16}
                color={progressPercent >= 10 ? theme.colors.success : theme.colors.primary}
              />
              <Text style={styles.activityListItemText}>
                {progressPercent >= 10 ? 'Product list retrieved' : 'Fetching products from ' + platformName + '...'}
              </Text>
            </View>
            <View style={styles.activityListItem}>
              <Icon
                name={progressPercent >= 50 ? "check-circle" : progressPercent >= 10 ? "loading" : "circle-outline"}
                size={16}
                color={progressPercent >= 50 ? theme.colors.success : progressPercent >= 10 ? theme.colors.primary : theme.colors.textSecondary}
              />
              <Text style={styles.activityListItemText}>
                {progressPercent >= 50 ? 'Match analysis complete' : progressPercent >= 10 ? 'Analyzing for matches...' : 'Waiting to analyze...'}
              </Text>
            </View>
            <View style={styles.activityListItem}>
              <Icon
                name={progressPercent >= 90 ? "check-circle" : progressPercent >= 50 ? "loading" : "circle-outline"}
                size={16}
                color={progressPercent >= 90 ? theme.colors.success : progressPercent >= 50 ? theme.colors.primary : theme.colors.textSecondary}
              />
              <Text style={styles.activityListItemText}>
                {progressPercent >= 90 ? 'Suggestions ready!' : progressPercent >= 50 ? 'Finalizing suggestions...' : 'Waiting to finalize...'}
              </Text>
            </View>
          </View>

          <Text style={[styles.loadingText, { marginTop: 20, textAlign: 'center', color: theme.colors.textSecondary }]}>
            This usually takes 1-2 minutes depending on your store size.
          </Text>
          <Text style={[styles.loadingText, { marginTop: 12, textAlign: 'center', color: theme.colors.textSecondary, fontSize: 13, opacity: 0.8 }]}>
            You can leave this screen - your scan will continue in the background.
          </Text>
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={[styles.backButton, { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, position: 'absolute', top: insets.top + 8, left: 16, zIndex: 10 }]}
        >
          <Icon name="arrow-left" size={20} color={theme.colors.text} />
          <Text style={{ marginLeft: 6, fontSize: 16, fontWeight: '500', color: theme.colors.text }}>Back</Text>
        </TouchableOpacity>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.text }]}>Loading {platformName} Suggestions...</Text>
        {renderProgressCard()}
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Icon name="alert-circle-outline" size={48} color={theme.colors.error} />
        <Text style={[styles.errorText, { color: theme.colors.error }]}>Error: {error}</Text>
        <Button title="Retry" onPress={() => importSession.refreshSuggestions()} />
      </View>
    );
  }

  // NOTE: Removed empty state early return - always show full wizard UI
  // MappingReviewScreen is used for ongoing settings, not just product mapping

  // --- MODIFIED: If we have existing mappings but no API suggestions, show them ---
  if (false && existingMappings.length > 0 && (suggestions?.length ?? 0) === 0) {
    return (
      <View style={styles.container}>
        <ScrollView style={styles.container}>
          <View style={styles.headerContainer}>
            <Text style={styles.title}>Existing {platformName} Products</Text>
            <Text style={styles.platformText}>These products are already synced</Text>
          </View>

          <Card style={{ margin: 15 }}>
            {existingMappings.map((mapping: any) => (
              <View key={mapping.Id} style={styles.suggestionCard}>
                <View style={styles.itemContent}>
                  <PlaceholderImage
                    size={48}
                    borderRadius={8}
                    color="#f0f0f0"
                    type="icon"
                    icon="cube-outline"
                  />
                  <View style={styles.itemDetails}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {mapping.ProductVariants?.Title || mapping.ProductVariants?.Products?.Title || mapping.PlatformSku || 'Unnamed Product'}
                    </Text>
                    <Text style={styles.itemSku}>SKU: {mapping.PlatformSku || 'N/A'}</Text>
                    <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 4 }}>
                      Last synced: {mapping.LastSyncedAt ? new Date(mapping.LastSyncedAt).toLocaleString() : 'Never'}
                    </Text>
                  </View>
                </View>

                <View style={styles.itemActions}>
                  <View style={[styles.actionBadge, { backgroundColor: theme.colors.success }]}>
                    <Icon name="check-circle" size={12} color="#fff" />
                    <Text style={styles.actionBadgeText}>Synced</Text>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </ScrollView>
      </View>
    );
  }



  return (
    <View style={styles.container}>
      {/* Show the final review UI when in that state */}
      {/* {showFinalReview && renderFinalReview()} */}



      {/* Sync Rules Modal 
      {renderSyncRulesModal()}
      */}

      <Modal
        transparent={true}
        visible={!!previewingItem}
        animationType="fade"
        onRequestClose={() => setPreviewingItem(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setPreviewingItem(null)}>
          <Pressable style={styles.modalContent}>
            <Text style={styles.modalTitle}>{previewingItem?.platformProduct.title}</Text>

            <Text style={styles.modalText}>SKU: {previewingItem?.platformProduct.sku || 'N/A'}</Text>
            <Text style={styles.modalText}>Price: ${previewingItem?.platformProduct.price || 'N/A'}</Text>

            {previewingItem?.suggestedCanonicalProduct && (
              <>
                <Text style={styles.modalSectionTitle}>Suggested Match in SSSync</Text>
                <Text style={styles.modalText}>Title: {previewingItem.suggestedCanonicalProduct.title}</Text>
                <Text style={styles.modalText}>SKU: {previewingItem.suggestedCanonicalProduct.sku}</Text>
              </>
            )}

            <Text style={styles.modalSectionTitle}>Action</Text>
            <Text style={styles.modalText}>Suggested Action: {previewingItem?.action}</Text>

            <Button title="Close" onPress={() => setPreviewingItem(null)} style={styles.modalCloseButton} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Content */}
      {!loading && !error && suggestions && (
        <>
          {/* Map Products Header */}
          <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: '#111827', textAlign: 'center' }}>Map Products</Text>
            <Text style={{ fontSize: 13, color: '#6B7280', textAlign: 'center', marginTop: 2 }}>
              {counts.all} items to review
            </Text>
          </View>

          <PillTabs
            tabs={[
              { key: 'needs_review', label: 'Review', count: counts.needs_review, tone: 'warning' },
              { key: 'matched', label: 'Matched', count: counts.matched, tone: 'success' },
              { key: 'ignored', label: 'Ignored', count: counts.ignored, tone: 'default' },
            ]}
            value={activeTab}
            onChange={(k) => setActiveTab(k as ActiveTab)}
          />

          <View style={styles.searchSection}>
            <SearchBarWithScanner
              value={listQuery}
              onChangeText={setListQuery}
              placeholder="Search by name, SKU, or barcode..."
              onScan={(barcode) => setListQuery(barcode)}
              onScannerOpen={() => setShowBarcodeScanner(true)}
            />
          </View>

          {!showBucketOverview && (
            <>
              {activeTab === 'needs_review' && activeReviewBucket && (
                <TouchableOpacity
                  style={styles.backToBucketsButton}
                  onPress={() => {
                    setActiveReviewBucket(null);
                    setActiveReviewItemIds(null);
                    setExpandedGroups(new Set());
                  }}
                >
                  <Icon name="arrow-left" size={18} color={theme.colors.primary} />
                  <Text style={styles.backToBucketsText}>Back to review buckets</Text>
                </TouchableOpacity>
              )}

              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 8, marginTop: 4 }}>
                {activeTab === 'needs_review' && activeReviewBucket ? (
                  <View style={styles.bucketScopeHeader}>
                    <Text style={styles.bucketScopeTitle}>{reviewBucketMeta[activeReviewBucket].title}</Text>
                    <Text style={styles.bucketScopeDescription}>{reviewBucketMeta[activeReviewBucket].description}</Text>
                  </View>
                ) : <View />}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ position: 'relative' }}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', backgroundColor: theme.colors.primary, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 }}
                      onPress={() => setShowEffectAllDropdown(!showEffectAllDropdown)}
                    >
                      <Icon name="playlist-edit" size={18} color="#FFF" />
                      <Text style={{ marginLeft: 6, color: '#FFF', fontWeight: '700' }}>Bulk</Text>
                      <Icon name={showEffectAllDropdown ? 'chevron-up' : 'chevron-down'} size={16} color="#FFF" style={{ marginLeft: 4 }} />
                    </TouchableOpacity>
                    {showEffectAllDropdown && (
                      <View style={{
                        position: 'absolute',
                        top: 40,
                        right: -60,
                        backgroundColor: '#fff',
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#E5E7EB',
                        ...Platform.select({
                          ios: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
                          android: { elevation: 10 },
                        }),
                        zIndex: 1000,
                        minWidth: 200,
                        overflow: 'hidden',
                      }}>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}
                          onPress={() => {
                            if (activeTab === 'needs_review' && activeReviewBucket === 'low_confidence') {
                              handleConfirmSuggestedForIds(
                                currentList
                                  .filter(s => !!s.suggestedCanonicalProduct?.id && !s.isStaleClaim)
                                  .map(s => s.platformProduct.id),
                                { openVariantSheet: false }
                              );
                            } else {
                              handleConfirmSuggestedForIds(
                                currentList
                                  .filter(s => !!s.suggestedCanonicalProduct?.id)
                                  .map(s => s.platformProduct.id),
                                { openVariantSheet: false }
                              );
                            }
                            setShowEffectAllDropdown(false);
                          }}
                        >
                          <Icon name="check-all" size={18} color="#93C822" />
                          <Text style={{ marginLeft: 8, color: '#374151', fontWeight: '600' }}>Match Visible</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}
                          onPress={() => {
                            handleCreateNewForIds(currentList.map(s => s.platformProduct.id));
                            setShowEffectAllDropdown(false);
                          }}
                        >
                          <Icon name="plus-circle" size={18} color="#93C822" />
                          <Text style={{ marginLeft: 8, color: '#374151', fontWeight: '600' }}>Create Visible as New</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}
                          onPress={() => {
                            handleIgnoreForIds(currentList.map(s => s.platformProduct.id));
                            setShowEffectAllDropdown(false);
                          }}
                        >
                          <Icon name="close-circle" size={18} color="#EF4444" />
                          <Text style={{ marginLeft: 8, color: '#374151', fontWeight: '600' }}>Ignore Visible</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                  <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8 }} onPress={() => setSortBy(sortBy === 'title' ? 'sku' : 'title')} accessibilityLabel="Sort by">
                    <Icon name="sort" size={18} color={theme.colors.textSecondary} />
                    <Text style={{ marginLeft: 6, color: theme.colors.textSecondary, fontWeight: '600' }}>Sort By: {sortBy === 'title' ? 'Title' : 'SKU'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <FlatList
                data={groupedList}
                keyExtractor={(item, index) => (item as any).type === 'header' ? `header-${(item as any).id}` : `item-${(item as any).suggestion.platformProduct.id}-${index}`}
                renderItem={({ item }) => {
                  if ((item as any).type === 'header') {
                    let priceText = '';
                    if (item.minPrice != null && item.maxPrice != null) {
                      if (item.minPrice === item.maxPrice) {
                        priceText = `$${item.minPrice.toFixed(2)}`;
                      } else {
                        priceText = `$${item.minPrice.toFixed(2)} - $${item.maxPrice.toFixed(2)}`;
                      }
                    }

                    if (item.isExpanded) {
                      return (
                        <TouchableOpacity
                          style={styles.expandedGroupHeader}
                          onPress={() => {
                            setExpandedGroups(prev => {
                              const next = new Set(prev);
                              next.delete(item.id);
                              return next;
                            });
                          }}
                        >
                          <Icon name="chevron-up" size={16} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                          <Text style={styles.expandedGroupHeaderText}>{item.title}</Text>
                          <View style={styles.expandedGroupLine} />
                        </TouchableOpacity>
                      );
                    }

                    const groupItems = item.items as AnnotatedMappingSuggestion[];
                    const firstItem = groupItems[0];
                    const hasVariantMismatch = groupItems.some(s => s.reviewReason === 'variant_mismatch');
                    const allMatched = groupItems.every(s => s.suggestedCanonicalProduct?.id && !s.isStaleClaim);
                    const groupPrimaryActionLabel = hasVariantMismatch ? 'Review variants' : allMatched ? 'Confirm match' : 'Find match';
                    const groupAttributes = (() => {
                      const extractedOptions: string[] = [];
                      const parentTitle = item.title || '';
                      groupItems.forEach(gi => {
                        const variantTitle = gi.platformProduct.title || '';
                        let optionValue = variantTitle;
                        if (parentTitle && variantTitle.startsWith(parentTitle)) {
                          optionValue = variantTitle.slice(parentTitle.length).replace(/^[\s\-\/:]+/, '').trim();
                        } else if (parentTitle && variantTitle.includes(' - ')) {
                          optionValue = variantTitle.split(' - ').pop()?.trim() || variantTitle;
                        }
                        if (optionValue && optionValue !== variantTitle && optionValue !== parentTitle) {
                          extractedOptions.push(optionValue);
                        }
                      });
                      return extractedOptions.length > 0 ? [{ label: 'Options', value: extractedOptions }] : undefined;
                    })();

                    return (
                      <MappingCard
                        variant="review"
                        titleLeft={item.title}
                        variantCount={item.count}
                        priceRange={priceText}
                        imageLeft={firstItem.platformProduct.imageUrl}
                        selected={groupItems.some(s => s.isSelected)}
                        attributesLeft={groupAttributes}
                        reviewBadge={getReviewBadge(groupItems.find(s => s.isStaleClaim) || firstItem)}
                        primaryActionLabel={groupPrimaryActionLabel}
                        supportingText={`${item.count} variants need attention`}
                        onPrimaryAction={() => {
                          if (groupPrimaryActionLabel === 'Review variants') {
                            openVariantReviewBucket(groupItems);
                            return;
                          }
                          if (groupPrimaryActionLabel === 'Confirm match') {
                            handleConfirmSuggestedForIds(groupItems.filter(s => !!s.suggestedCanonicalProduct?.id && !s.isStaleClaim).map(s => s.platformProduct.id));
                            return;
                          }
                          openSearchModalForItem(firstItem, groupItems);
                        }}
                        onSearch={() => openSearchModalForItem(firstItem, groupItems)}
                        onPress={() => {
                          setExpandedGroups(prev => new Set(prev).add(item.id));
                        }}
                      />
                    );
                  }

                  const s = item.suggestion as AnnotatedMappingSuggestion;
                  const visualVariant = s.action === 'IGNORE' ? 'ignored'
                    : s.suggestedCanonicalProduct?.id ? 'matched'
                      : s.action === 'CREATE_NEW' ? 'new'
                        : 'review';
                  const primaryActionLabel = activeTab === 'needs_review' ? getPrimaryActionLabel(s) : undefined;

                  return (
                    <MappingCard
                      isChild={item.isChild}
                      variant={visualVariant as any}
                      titleLeft={s.platformProduct.title}
                      skuLeft={s.platformProduct.sku}
                      priceLeft={s.platformProduct.price}
                      imageLeft={s.platformProduct.imageUrl}
                      titleRight={s.action === 'UNMATCHED' && !s.isStaleClaim ? undefined : s.suggestedCanonicalProduct?.title}
                      skuRight={s.suggestedCanonicalProduct?.sku}
                      priceRight={s.suggestedCanonicalProduct?.price}
                      imageRight={s.suggestedCanonicalProduct?.imageUrl}
                      selected={s.isSelected}
                      isResolvedNew={s.action === 'CREATE_NEW' && !!s.resolved}
                      reviewBadge={activeTab === 'needs_review' ? getReviewBadge(s) : null}
                      primaryActionLabel={primaryActionLabel}
                      supportingText={s.isStaleClaim ? 'This match is already used elsewhere in this session.' : s.reviewReason === 'variant_mismatch' ? 'This variant family needs a quick pass.' : undefined}
                      showStaleState={s.isStaleClaim}
                      struckThroughRightTitle={s.staleDisplay?.title}
                      onPrimaryAction={primaryActionLabel ? () => {
                        if (primaryActionLabel === 'Review variants') {
                          openVariantReviewBucket(
                            annotatedSuggestions.filter(item => getFamilyIds(s).includes(item.platformProduct.id))
                          );
                          return;
                        }
                        if (primaryActionLabel === 'Confirm match') {
                          handleConfirmSuggestedForIds([s.platformProduct.id]);
                          return;
                        }
                        openSearchModalForItem(s);
                      } : undefined}
                      onEditNew={() => applySuggestionUpdates([s.platformProduct.id], (item) => ({ ...item, resolved: false, action: 'UNMATCHED', isSelected: false }))}
                      onIgnore={() => handleIgnoreForIds([s.platformProduct.id])}
                      onRestore={() => applySuggestionUpdates([s.platformProduct.id], (item) => ({ ...item, action: item.prevAction || 'UNMATCHED', isSelected: false }))}
                      onCreate={() => handleCreateNewForIds([s.platformProduct.id])}
                      onApproveMatch={() => handleConfirmSuggestedForIds([s.platformProduct.id])}
                      onSearch={() => openSearchModalForItem(s)}
                    />
                  );
                }}
                contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: bottomSafePadding }}
                initialNumToRender={10}
                windowSize={10}
                maxToRenderPerBatch={12}
                removeClippedSubviews
                pagingEnabled={false}
                style={{ flex: 1 }}
                ListEmptyComponent={(
                  <View style={styles.modernEmptyState}>
                    <View style={styles.emptyStateIcon}>
                      <Icon name={listQuery ? 'magnify' : 'package-variant-closed'} size={48} color={theme.colors.textSecondary} />
                    </View>
                    <Text style={styles.emptyStateTitle}>
                      {listQuery ? 'No matching products' : 'No items in this category'}
                    </Text>
                    <Text style={styles.emptyStateDescription}>
                      {listQuery ? 'Try adjusting your search terms' : 'Items will appear after processing'}
                    </Text>
                  </View>
                )}
              />
            </>
          )}

          {showBucketOverview && (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: bottomSafePadding }}>
              {(Object.keys(reviewBucketMeta) as ReviewReason[]).map((bucketKey) => {
                const items = reviewBuckets[bucketKey];
                if (!items.length) return null;

                const meta = reviewBucketMeta[bucketKey];
                const bulkIds = bucketKey === 'low_confidence'
                  ? items.filter(item => !!item.suggestedCanonicalProduct?.id && !item.isStaleClaim).map(item => item.platformProduct.id)
                  : items.map(item => item.platformProduct.id);

                return (
                  <Card key={bucketKey} style={styles.reviewBucketCard}>
                    <View style={styles.reviewBucketHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reviewBucketTitle}>{meta.title}</Text>
                        <Text style={styles.reviewBucketDescription}>{meta.description}</Text>
                      </View>
                      <View style={styles.reviewBucketCount}>
                        <Text style={styles.reviewBucketCountText}>{items.length}</Text>
                      </View>
                    </View>
                    <View style={styles.reviewBucketActions}>
                      <TouchableOpacity
                        style={[styles.reviewBucketPrimaryAction, bulkIds.length === 0 && styles.reviewBucketPrimaryActionDisabled]}
                        disabled={bulkIds.length === 0}
                        onPress={() => {
                          if (bucketKey === 'low_confidence') {
                            handleConfirmSuggestedForIds(bulkIds, { openVariantSheet: false });
                          } else {
                            handleCreateNewForIds(bulkIds);
                          }
                        }}
                      >
                        <Text style={styles.reviewBucketPrimaryActionText}>{meta.bulkLabel}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.reviewBucketSecondaryAction}
                        onPress={() => {
                          setActiveReviewBucket(bucketKey);
                          setActiveReviewItemIds(null);
                          setExpandedGroups(new Set());
                        }}
                      >
                        <Text style={styles.reviewBucketSecondaryActionText}>Review -&gt;</Text>
                      </TouchableOpacity>
                    </View>
                  </Card>
                );
              })}
            </ScrollView>
          )}

          {/* Search Modal - Bottom Sheet Style */}
          <Modal visible={showSearchModal} transparent={true} animationType="slide" onRequestClose={closeSearchModal}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
              <View style={{
                height: '70%',
                backgroundColor: '#fff',
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                paddingTop: 20,
                ...Platform.select({
                  ios: { shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 10 },
                  android: { elevation: 10 },
                }),
              }}>
                <View style={{ paddingHorizontal: 20, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700' }}>Select Product</Text>
                  <TouchableOpacity onPress={closeSearchModal} style={{ padding: 4, backgroundColor: '#F3F4F6', borderRadius: 20 }}>
                    <Icon name="close" size={20} color="#666" />
                  </TouchableOpacity>
                </View>

                <View style={styles.searchModalOptionList}>
                  <TouchableOpacity style={styles.searchModalOptionRow} onPress={() => handleCreateNewForIds((groupItemsToMatch || (itemToMatch ? [itemToMatch] : [])).map(item => item.platformProduct.id), { closeModal: true })}>
                    <Icon name="plus-circle-outline" size={18} color="#166534" />
                    <Text style={styles.searchModalOptionText}>Add as new</Text>
                  </TouchableOpacity>
                  {!!modalContextItem?.suggestedCanonicalProduct && !modalContextItem.isStaleClaim && (
                    <TouchableOpacity style={styles.searchModalOptionRow} onPress={() => handleConfirmSuggestedForIds((groupItemsToMatch || (itemToMatch ? [itemToMatch] : [])).map(item => item.platformProduct.id), { closeModal: true })}>
                      <Icon name="content-duplicate" size={18} color="#92400E" />
                      <Text style={styles.searchModalOptionText}>Mark duplicate</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.searchModalOptionRow} onPress={() => handleIgnoreForIds((groupItemsToMatch || (itemToMatch ? [itemToMatch] : [])).map(item => item.platformProduct.id), { closeModal: true })}>
                    <Icon name="skip-next-outline" size={18} color="#B91C1C" />
                    <Text style={styles.searchModalOptionText}>Skip</Text>
                  </TouchableOpacity>
                </View>

                <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                  <SearchBarWithScanner
                    value={searchModalQuery}
                    onChangeText={(text) => {
                      setSearchModalQuery(text);
                      performProductSearch(text);
                    }}
                    onScan={(code) => {
                      setSearchModalQuery(code);
                      performProductSearch(code);
                    }}
                    onScannerOpen={() => setShowBarcodeScanner(true)}
                    placeholder="Search by name, SKU, or barcode..."
                  />
                </View>

                <FlatList
                  data={searchModalResults}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={{ paddingBottom: 40 }}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' }}
                      onPress={() => handleManualMatch(item)}
                    >
                      <View style={{ width: 48, height: 48, backgroundColor: '#f0f0f0', borderRadius: 8, marginRight: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {item.imageUrl ? (
                          <RNImage source={{ uri: item.imageUrl }} style={{ width: 48, height: 48, borderRadius: 8 }} resizeMode="cover" />
                        ) : (
                          <Icon name="package-variant" size={24} color="#9CA3AF" />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.colors.text }}>{item.title}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{item.productTitle}</Text>
                        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginTop: 2 }}>SKU: {item.sku}</Text>
                      </View>
                      <Text style={{ fontWeight: '700', color: theme.colors.primary }}>${item.price}</Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    isSearchingProducts ?
                      <View style={{ padding: 40, alignItems: 'center' }}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                        <Text style={{ marginTop: 12, color: theme.colors.textSecondary }}>Searching...</Text>
                      </View> :
                      <View style={{ padding: 40, alignItems: 'center' }}>
                        <Icon name="magnify" size={48} color="#E5E7EB" />
                        <Text style={{ textAlign: 'center', marginTop: 16, color: theme.colors.textSecondary }}>
                          {searchModalQuery.length < 1 ? 'Start typing to search your products' : 'No products found'}
                        </Text>
                      </View>
                  }
                />
              </View>
            </View>
          </Modal>

          <Modal visible={variantReviewSheet.visible} transparent={true} animationType="slide" onRequestClose={() => setVariantReviewSheet({ visible: false, parentId: null, parentTitle: null, items: [] })}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' }}>
              <View style={styles.variantSheet}>
                <View style={styles.variantSheetHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.variantSheetTitle}>{variantReviewSheet.parentTitle || 'Review variants'}</Text>
                    <Text style={styles.variantSheetSubtitle}>Confirm the variants that lined up automatically and review the rest.</Text>
                  </View>
                  <TouchableOpacity onPress={() => setVariantReviewSheet({ visible: false, parentId: null, parentTitle: null, items: [] })} style={styles.variantSheetClose}>
                    <Icon name="close" size={20} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
                  {variantReviewSheet.items.map((variantItem) => {
                    const autoMatched = isVariantAutoMatched(variantItem);
                    return (
                      <View key={variantItem.platformProduct.id} style={styles.variantSheetRow}>
                        <View style={styles.variantSheetColumn}>
                          <Text style={styles.variantSheetColumnLabel}>Platform</Text>
                          <Text style={styles.variantSheetName} numberOfLines={2}>{variantItem.platformProduct.title}</Text>
                          <Text style={styles.variantSheetSku}>SKU: {variantItem.platformProduct.sku || 'N/A'}</Text>
                        </View>
                        <View style={styles.variantSheetStatusWrap}>
                          <View style={[styles.variantSheetStatusBadge, autoMatched ? styles.variantSheetStatusMatch : styles.variantSheetStatusUnmatched]}>
                            <Text style={[styles.variantSheetStatusText, autoMatched ? styles.variantSheetStatusTextMatch : styles.variantSheetStatusTextUnmatched]}>
                              {autoMatched ? 'Match' : 'No match'}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.variantSheetColumn}>
                          <Text style={styles.variantSheetColumnLabel}>Anora</Text>
                          {variantItem.anorhaVariant ? (
                            <>
                              <Text style={styles.variantSheetName} numberOfLines={2}>{variantItem.anorhaVariant.title || 'Unnamed Variant'}</Text>
                              <Text style={styles.variantSheetSku}>SKU: {variantItem.anorhaVariant.sku || 'N/A'}</Text>
                            </>
                          ) : (
                            <>
                              <Text style={styles.variantSheetPlaceholder}>No variant matched yet</Text>
                              <Text style={styles.variantSheetSku}>Search or add as new</Text>
                            </>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>

                <View style={styles.variantSheetActions}>
                  <TouchableOpacity
                    style={styles.variantSheetPrimaryAction}
                    onPress={() => {
                      const autoMatchedItems = variantReviewSheet.items.filter(isVariantAutoMatched);
                      applySuggestionUpdates(autoMatchedItems.map(item => item.platformProduct.id), (item) => ({
                        ...item,
                        action: 'LINK_EXISTING',
                        resolved: true,
                        isSelected: true,
                        suggestedCanonicalProduct: item.suggestedCanonicalProduct || (item.anorhaVariant ? {
                          id: item.anorhaVariant.id,
                          sku: item.anorhaVariant.sku || '',
                          title: item.anorhaVariant.title || 'Unnamed Variant',
                          price: item.anorhaVariant.price,
                          imageUrl: item.anorhaVariant.imageUrl,
                        } : item.suggestedCanonicalProduct),
                      }));
                      setVariantReviewSheet({ visible: false, parentId: null, parentTitle: null, items: [] });
                    }}
                  >
                    <Text style={styles.variantSheetPrimaryActionText}>Accept all auto-matched</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.variantSheetSecondaryAction}
                    onPress={() => {
                      openVariantReviewBucket(variantReviewSheet.items.filter(item => !isVariantAutoMatched(item)));
                    }}
                  >
                    <Text style={styles.variantSheetSecondaryActionText}>Review unmatched</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.variantSheetTertiaryAction}
                    onPress={() => setVariantReviewSheet({ visible: false, parentId: null, parentTitle: null, items: [] })}
                  >
                    <Text style={styles.variantSheetTertiaryActionText}>Skip variants</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>


          <BottomActionBar
            primaryLabel={isCSVImport
              ? `Import ${(suggestions || []).filter(s => s.isSelected).length} Products`
              : (suggestions || []).length === 0 ? 'Continue Setup' : `Confirm Mapping (${(suggestions || []).filter(s => s.isSelected).length})`}
            onPrimary={() => {
              if (isCSVImport) {
                handleImportCSV();
                return;
              }
              // Always open wizard - even with 0 items, user needs to configure settings
              setWizardVisible(true);
            }}
            primaryDisabled={false}
            secondaryLabel="Back"
            secondaryDisabled={false}
            onSecondary={() => navigation.goBack()}
          />

          {/* Import Wizard - shared component */}
          <ImportWizardSheet
            visible={wizardVisible}
            onClose={() => setWizardVisible(false)}
            platformName={platformName}
            connection={importSession.connection}
            counts={sessionCounts}
            session={importSession}
            showReselectMatches={true}
          />
        </>
      )}

      {/* Barcode Scanner Modal */}
      {showBarcodeScanner && (
        <View style={scannerStyles.scannerDock} pointerEvents="box-none">
          <View style={scannerStyles.scannerCard}>
            <CameraView
              style={{ width: '100%', height: 240 }}
              facing="back"
              onBarcodeScanned={(result: any) => {
                const code = result?.data || result?.rawValue;
                if (code) {
                  setListQuery(code);
                  setShowBarcodeScanner(false);
                }
              }}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'] }}
            />
            <TouchableOpacity
              onPress={() => setShowBarcodeScanner(false)}
              style={scannerStyles.scannerClose}
            >
              <Text style={{ color: '#fff', fontSize: 24 }}>×</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View >
  );
};

// Barcode scanner modal styles
const scannerStyles = StyleSheet.create({
  scannerDock: {
    position: 'absolute',
    top: 80,
    left: 20,
    right: 20,
    zIndex: 5000
  },
  scannerCard: {
    backgroundColor: '#000',
    borderRadius: 16,
    overflow: 'hidden'
  },
  scannerClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center'
  },
});

export default MappingReviewScreen;

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
import { useSyncProgress } from '../hooks/useSyncProgress';
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
  prevTab?: 'matched' | 'review' | 'ignore';
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

// What you SEND to the backend after user review
interface FinalizedMapping {
  action: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE'; // Update to include all possible actions
  platformProduct: {
    id: string; // The platform's unique ID for the product/variant
  };
  sssyncProduct?: {  // Optional field for LINK_EXISTING action
    id: string;
  };
}

interface FinalizedMappingPayload {
  approvedMappings: FinalizedMapping[];
}

// --- END REVISED ---

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
const SSSYNC_API_BASE_URL = 'https://api.sssync.app'; // Or your actual Railway URL

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

type ActiveTab = 'matched' | 'review' | 'ignore';

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
  const { connectionId, platformName, jobId, importedProducts, isCSVImport, isScanning, scanStartTime } = route.params as any;
  const legendState: LegendStateObservables | null = useLegendState();
  const { currentOrg } = useOrg(); // Use Org Context
  const [connection, setConnection] = useState<any>()


  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | null>(null);
  // Persist review progress
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
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
  const [activeTab, setActiveTab] = useState<ActiveTab>('matched');
  // --- NEW: State for WebSocket sync progress ---
  const { progress: syncProgress } = useSyncProgress(connectionId);

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


  const performProductSearch = useCallback(async (query: string) => {
    if (!query || query.length < 2) return;
    setIsSearchingProducts(true);
    setSearchModalResults([]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const cleanQuery = query.trim();

      // First try to get user's org ID for org-based products
      const { data: orgMember } = await supabase
        .from('OrgMembers')
        .select('OrgId')
        .eq('UserId', session.user.id)
        .single();

      const orgId = orgMember?.OrgId;

      // Build query - search by UserId OR OrgId to catch all products
      let query_builder = supabase
        .from('ProductVariants')
        .select('Id, Sku, Title, Price, Barcode, ProductId, Products(Title)')
        .or(`Title.ilike.%${cleanQuery}%,Sku.ilike.%${cleanQuery}%`)
        .limit(20);

      // Filter by user or org
      if (orgId) {
        query_builder = query_builder.or(`UserId.eq.${session.user.id},OrgId.eq.${orgId}`);
      } else {
        query_builder = query_builder.eq('UserId', session.user.id);
      }

      const { data, error } = await query_builder;

      if (error) throw error;
      setSearchModalResults((data || []).map(v => ({
        id: v.Id,
        sku: v.Sku,
        title: v.Title, // Variant title
        productTitle: Array.isArray(v.Products) ? (v.Products[0] as any)?.Title : (v.Products as any)?.Title, // Parent title
        price: v.Price,
        imageUrl: null
      })));
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearchingProducts(false);
    }
  }, []);


  const handleManualMatch = (canonicalVariant: any) => {
    if (!itemToMatch) return;

    // If we have group items (from collapsed group search), map ALL items in the group
    const itemsToMap = groupItemsToMatch || [itemToMatch];
    const idsToMap = new Set(itemsToMap.map(i => i.platformProduct.id));

    setSuggestions(prev => (prev || []).map(s => {
      if (idsToMap.has(s.platformProduct.id)) {
        return {
          ...s,
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
        };
      }
      return s;
    }));
    setShowSearchModal(false);
    setItemToMatch(null);
    setGroupItemsToMatch(null);  // Clear group items
    setSearchModalQuery('');
    setSearchModalResults([]);
  };
  const [currentJobId, setCurrentJobId] = useState<string | undefined>(jobId);
  const [isPolling, setIsPolling] = useState(!!jobId); // Will be set to true when isScanningActive is detected
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null); // Keep for compatibility
  // --- END NEW ---
  // --- NEW: Add state for existing mappings ---
  const [existingMappings, setExistingMappings] = useState<ExistingMapping[]>([]);
  const [loadingExistingMappings, setLoadingExistingMappings] = useState(false);
  // --- NEW: Add state for search functionality ---
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // --- NEW: Add state for custom notification ---
  const [showSuccessNotification, setShowSuccessNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
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
  // NEW: Scan summary
  const [scanSummary, setScanSummary] = useState<{ countProducts?: number; countVariants?: number; countLocations?: number } | null>(null);
  // NEW: State for refresh/rescan
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Inline bottom-sheet wizard state
  const [wizardVisible, setWizardVisible] = useState(false);
  const [wizardStep, setWizardStep] = useState(0); // 0 platforms, 1 sync mode, 2 delist, 3 buffer, 4 review
  const [selectedPlatformsState, setSelectedPlatformsState] = useState<string[]>([]);
  const [inventoryMergeMode, setInventoryMergeMode] = useState<'merged' | 'separate' | null>('merged');

  // Wizard step configuration - centralized titles and descriptions (description shown above divider)
  const WIZARD_STEP_CONFIG: Record<number, { title: string; description?: string }> = {
    0: { title: 'Should We Add Missing Items?', description: 'What happens when a product is missing from one platform?' },
    1: { title: 'Add Platform To Pool', description: 'Which pool should this platform be added to?' },
    2: { title: 'Set Sync Settings', description: 'Sync updates automatically or only on approval' },
    3: { title: 'Set Sync Settings', description: 'Choose how auction listings behave (like FB, Ebay, Whatnot) ' },
    4: { title: 'Set Sync Settings', description: 'Adjust prices by % per platform (Optional)' },
    5: { title: 'Set Sync Settings', description: 'Final sync configuration' },
    6: { title: 'Is This Right?', description: 'Review and confirm your settings' },
  };


  // 'sync_everywhere' = Add missing items to ALL platforms including this one (full bidirectional sync)
  // 'pull_only' = Only add missing items TO this platform (import from others)
  // 'push_only' = Push this platform's inventory to others, but don't pull items in
  // 'do_nothing' = Don't create missing items on any platform
  type ProductCreationMode = 'sync_everywhere' | 'pull_only' | 'push_only' | 'do_nothing';
  const [productCreationMode, setProductCreationMode] = useState<ProductCreationMode>('pull_only');


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
          `https://api.sssync.app/api/platform-connections/${connectionId}`,
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
            fetchMappingSuggestions(connectionId);
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
        fetchMappingSuggestions(connectionId);
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

  // Fetch current Pools on mount
  useEffect(() => {
    const fetchPools = async () => {
      try {
        setIsLoadingPools(true);
        const token = await ensureSupabaseJwt();

        let orgId = connection?.OrgId;
        console.log('[MappingReviewScreen] Initial orgId from connection:', orgId);

        // If connection doesn't have orgId, fetch user's active org
        if (!orgId) {
          console.log('[MappingReviewScreen] No orgId from connection, fetching active org...');
          const activeOrgResponse = await fetch(`https://api.sssync.app/api/organizations/me/active`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            }
          });

          if (activeOrgResponse.ok) {
            const activeOrgData = await activeOrgResponse.json();
            orgId = activeOrgData.id || activeOrgData.orgId;
            console.log('[MappingReviewScreen] Got active orgId:', orgId);
          } else {
            console.error('[MappingReviewScreen] Failed to fetch active org:', activeOrgResponse.status);
            Alert.alert('Error', 'Could not determine organization. Please try again.');
            setPools([]);
            return;
          }
        }

        console.log('[MappingReviewScreen] Fetching pools for orgId:', orgId);

        const response = await fetch(`https://api.sssync.app/api/pools/org/${orgId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            }
          });

        console.log('[MappingReviewScreen] Pools API response status:', response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error('[MappingReviewScreen] Failed to fetch pools:', response.status, errorText);
          Alert.alert('Error', `Failed to fetch pools: ${response.status}`);
          setPools([]);
          return;
        }

        const data = await response.json();
        const poolsList = Array.isArray(data) ? data : [];
        setPools(poolsList);
        console.log('[MappingReviewScreen] ✅ Loaded pools from API:', poolsList.length, poolsList);

        // Auto-select first pool if available and none selected
        if (poolsList.length > 0 && !selectedPool) {
          console.log('[MappingReviewScreen] Auto-selecting first pool:', poolsList[0].id);
          setSelectedPool(poolsList[0].id);
        }

      } catch (error) {
        console.error('[MappingReviewScreen] Error fetching pools:', error);
        Alert.alert('Error', 'Failed to load pools: ' + (error instanceof Error ? error.message : String(error)));
        setPools([]);
      } finally {
        setIsLoadingPools(false);
      }
    };

    fetchPools();
  }, [connectionId]); // Only depend on connectionId

  // Load locations for this connection (for pool assignment)
  // IMPORTANT: This now also loads EXISTING pool assignments from the backend
  useEffect(() => {
    const fetchConnectionLocations = async () => {
      if (!connectionId) return;
      // Wait for pools to be loaded before we can cross-reference
      if (pools.length === 0 && !isLoadingPools) {
        // Pools finished loading but none exist - still load locations
        console.log('[MappingReviewScreen] No pools available, loading locations without assignments');
      }

      try {
        setIsLoadingLocations(true);
        const token = await ensureSupabaseJwt();

        // Fetch locations from PlatformLocations table for this connection
        const { data: locations, error } = await supabase
          .from('PlatformLocations')
          .select('PlatformLocationId, Name, Timezone')
          .eq('PlatformConnectionId', connectionId);

        if (error) {
          console.error('[MappingReviewScreen] Error fetching locations:', error);
          setConnectionLocations([]);
          return;
        }

        const formattedLocations: ConnectionLocation[] = (locations || []).map(loc => ({
          platformLocationId: loc.PlatformLocationId,
          locationName: loc.Name || 'Unnamed Location',
          timezone: loc.Timezone || undefined,
        }));

        setConnectionLocations(formattedLocations);
        console.log('[MappingReviewScreen] ✅ Loaded connection locations:', formattedLocations.length);

        // CRITICAL: Load EXISTING pool assignments by cross-referencing with pools
        // Each pool has a locationIds array containing assigned location IDs
        const existingAssignments: Record<string, string> = {};
        let foundAnyExisting = false;

        for (const location of formattedLocations) {
          // Find which pool (if any) this location is assigned to
          const assignedPool = pools.find((pool: any) => {
            const poolLocationIds = pool.locationIds || pool.location_ids || [];
            return poolLocationIds.includes(location.platformLocationId);
          });

          if (assignedPool) {
            existingAssignments[location.platformLocationId] = assignedPool.id;
            foundAnyExisting = true;
            console.log(`[MappingReviewScreen] Location "${location.locationName}" already assigned to pool "${assignedPool.name}"`);
          }
        }

        if (foundAnyExisting) {
          // Use existing assignments from the backend - don't modify them
          console.log('[MappingReviewScreen] ✅ Loaded existing pool assignments:', Object.keys(existingAssignments).length);
          setLocationPoolAssignments(existingAssignments);

          // Also set selectedPool to match the first assigned pool (for consistency)
          const firstAssignedPoolId = Object.values(existingAssignments)[0];
          if (firstAssignedPoolId && !selectedPool) {
            setSelectedPool(firstAssignedPoolId);
          }
        } else {
          // No existing assignments found - leave them unassigned
          // User can manually assign via the wizard if needed
          console.log('[MappingReviewScreen] No existing pool assignments found, leaving locations unassigned');
          setLocationPoolAssignments({});
        }
      } catch (error) {
        console.error('[MappingReviewScreen] Error loading locations:', error);
        setConnectionLocations([]);
      } finally {
        setIsLoadingLocations(false);
      }
    };

    // Only run when we have connectionId and pools are done loading
    if (connectionId && connectionId !== 'csv-import' && !isLoadingPools) {
      fetchConnectionLocations();
    }
  }, [connectionId, pools, isLoadingPools]); // Depend on pools being loaded

  // Load existing quick settings on mount (for wizard pre-population)
  useEffect(() => {
    const loadExistingSettings = async () => {
      if (!connectionId || connectionId === 'csv-import') return;

      try {
        const token = await ensureSupabaseJwt();
        const response = await fetch(`https://api.sssync.app/api/connections/${connectionId}/quick-settings`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });

        if (response.ok) {
          const quickSettings = await response.json();
          console.log('[MappingReviewScreen] Loaded existing quick settings:', quickSettings);

          // Pre-populate wizard state with existing settings
          setSelectedPool(quickSettings.poolId || null);
          setSyncMode(quickSettings.autoSyncMode ? 'auto' : 'manual');
          setDelistMode(quickSettings.autoDelist ? 'auto' : 'manual');
          setPriceBuffer(quickSettings.priceAdjustment || {});
          setInventoryBuffer(quickSettings.inventoryBuffer || {});
        } else {
          console.log('[MappingReviewScreen] No existing quick settings found, using defaults');
          // Keep default values for new connections
        }
      } catch (error) {
        console.error('[MappingReviewScreen] Error loading existing quick settings:', error);
        // Keep default values on error
      }
    };

    loadExistingSettings();
  }, [connectionId]);

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
        const response = await fetch(`https://api.sssync.app/api/organizations/me/active`, {
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

      const response = await fetch('https://api.sssync.app/api/pools', {
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
      const poolsResponse = await fetch(`https://api.sssync.app/api/pools/org/${orgId}`, {
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


  // Effect to load platform connections
  useEffect(() => {
    const loadConnections = async () => {
      const targetOrgId = currentOrg?.id; // Prioritize Org context
      const targetUserId = legendState?.userId;

      if (targetOrgId || targetUserId) {
        try {
          let query = supabase
            .from('PlatformConnections')
            .select('*')
            .eq('IsEnabled', true);

          if (targetOrgId) {
            console.log('[MappingReview] Loading connections for Org:', targetOrgId);
            query = query.eq('OrgId', targetOrgId);
          } else {
            console.log('[MappingReview] Loading connections for User:', targetUserId);
            query = query.eq('UserId', targetUserId);
          }

          const { data, error } = await query;

          if (error) {
            console.error('[MappingReviewScreen] Error loading connections:', error);
            return;
          }

          const connections = data as PlatformConnection[];
          setPlatformConnections(connections);

          // Check if we have multiple platform types connected
          const platformTypes = new Set(connections.map(conn => conn.PlatformType));
          setMultiPlatformMode(platformTypes.size > 1);

          // Pre-select the current connection
          setSelectedConnectionIds([connectionId]);

        } catch (err) {
          console.error('[MappingReviewScreen] Error in loadConnections:', err);
        }
      }
    };

    loadConnections();
  }, [legendState, connectionId]);

  // --- Function to fetch mapping suggestions ---
  // This is the main data-loading function that tries the API first,
  // then falls back to Supabase if the API returns no results
  const fetchMappingSuggestions = useCallback(async (currentConnectionId: string) => {
    // If CSV import, we don't fetch from backend
    if (isCSVImport) return;

    // Use currentConnectionId or fall back to route param
    const connId = currentConnectionId || connectionId;
    console.log(`[MappingReviewScreen] Fetching suggestions for connection: ${connId}`);
    setLoading(true);
    setError(null);
    setSuggestions(null); // Clear previous suggestions
    setSummaryData(null); // Clear previous summary

    try {
      // Ensure the bridge has created/attached a Supabase JWT
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error("Authentication token not found. Please log in again.");

      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connId}/mapping-suggestions`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to fetch mapping suggestions. Status: ${response.status}`);
      }

      // Get response data - could be an array or object structure
      const data = await response.json();
      console.log('[MappingReviewScreen] Suggestions response type:', Array.isArray(data) ? 'Array' : typeof data);
      console.log('[MappingReviewScreen] Suggestions sample:', JSON.stringify(data).substring(0, 300));

      // Handle different response formats
      let suggestionsArray: MappingSuggestion[] = [];

      if (Array.isArray(data)) {
        // Direct array of suggestions (newer API format)
        suggestionsArray = data.map((item: any): MappingSuggestion => {
          // Determine action based on matchType and confidence
          let action: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE' | 'UNMATCHED';
          let isSelected = true;

          // NEW: Handle anorha_to_platform direction (push Anorha items to platform)
          const direction = item.direction || 'platform_to_anorha';

          // Extract parent info for grouping
          const parentId = item.platformProduct?.parentId || null;
          const parentTitle = item.platformProduct?.parentTitle || null;

          if (direction === 'anorha_to_platform') {
            // Anorha item to push to platform - default to UNMATCHED so user picks link target
            action = 'UNMATCHED';
            isSelected = false; // Don't auto-select push items

            // Extract parent product title - handle both object and array forms from Supabase
            const productData = item.anorhaVariant?.Product;
            const parentProductTitle = Array.isArray(productData)
              ? productData[0]?.Title
              : productData?.Title || null;

            return {
              action,
              platformProduct: {
                id: item.anorhaVariant?.Id || item.anorhaVariant?.id || `anorha-${Date.now()}`,
                sku: item.anorhaVariant?.Sku || item.anorhaVariant?.sku || '',
                title: item.anorhaVariant?.Title || item.anorhaVariant?.title || 'Unnamed Item',
                price: item.anorhaVariant?.Price || item.anorhaVariant?.price || 0,
                imageUrl: item.anorhaVariant?.ImageUrl || item.anorhaVariant?.imageUrl || null,
                // Use ProductId from anorhaVariant for grouping variants together
                parentId: item.anorhaVariant?.ProductId || item.anorhaVariant?.productId || null,
                parentTitle: parentProductTitle,
              },
              anorhaVariant: item.anorhaVariant ? {
                id: item.anorhaVariant.Id || item.anorhaVariant.id,
                sku: item.anorhaVariant.Sku || item.anorhaVariant.sku,
                title: item.anorhaVariant.Title || item.anorhaVariant.title,
                price: item.anorhaVariant.Price || item.anorhaVariant.price,
                barcode: item.anorhaVariant.Barcode || item.anorhaVariant.barcode,
                imageUrl: item.anorhaVariant.ImageUrl || item.anorhaVariant.imageUrl,
              } : null,
              suggestedCanonicalProduct: null, // No canonical match for Anorha→platform push
              direction: 'anorha_to_platform',
              isSelected,
              matchType: item.matchType || 'NONE',
              confidence: 0,
            };
          }

          // Standard platform_to_anorha or bidirectional handling
          if (item.matchType === 'NONE' || item.confidence === 0) {
            // No match found -> default to UNMATCHED (User intervention required)
            action = 'UNMATCHED';
            isSelected = false; // Do not auto-select
          } else if ((item.matchType === 'SKU' || item.matchType === 'BARCODE') && item.suggestedCanonicalVariant) {
            // Perfect match found - link to existing product
            action = 'LINK_EXISTING';
            isSelected = true;
          } else if (item.confidence > 0 && item.confidence < 0.8) {
            // Low confidence match - needs review, show empty slot for user to pick
            action = 'UNMATCHED';
            isSelected = false;
          } else {
            // Default to UNMATCHED for anything else - user should review
            action = 'UNMATCHED';
            isSelected = false;
          }

          return {
            action,
            platformProduct: {
              id: item.platformProduct?.id || '',
              sku: item.platformProduct?.sku || '', // Ensure SKU is not null
              title: item.platformProduct?.title || '',
              price: item.platformProduct?.price ? parseFloat(String(item.platformProduct.price)) : 0,
              imageUrl: item.platformProduct?.imageUrl || null,
              parentId,
              parentTitle,
            },
            suggestedCanonicalProduct: item.suggestedCanonicalVariant ? {
              id: item.suggestedCanonicalVariant.Id,
              sku: item.suggestedCanonicalVariant.Sku,
              title: item.suggestedCanonicalVariant.Title,
            } : null,
            direction: direction === 'bidirectional' ? 'bidirectional' : 'platform_to_anorha',
            isSelected,
            matchType: item.matchType,
            confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
          };
        });

        // DEBUG: Log parentId values to verify backend is sending them
        const itemsWithParentId = suggestionsArray.filter(s => s.platformProduct.parentId);
        console.log(`[MappingReviewScreen] DEBUG: ${itemsWithParentId.length}/${suggestionsArray.length} items have parentId`);

        // DEBUG: Specifically log Anorha items (anorha_to_platform direction)
        const anorhaItems = suggestionsArray.filter(s => s.direction === 'anorha_to_platform');
        const anorhaWithParent = anorhaItems.filter(s => s.platformProduct.parentId);
        console.log(`[MappingReviewScreen] DEBUG Anorha items: ${anorhaWithParent.length}/${anorhaItems.length} have parentId`);
        if (anorhaItems.length > 0) {
          console.log('[MappingReviewScreen] DEBUG Sample Anorha item:', JSON.stringify({
            title: anorhaItems[0].platformProduct.title,
            parentId: anorhaItems[0].platformProduct.parentId,
            parentTitle: anorhaItems[0].platformProduct.parentTitle,
            direction: anorhaItems[0].direction,
          }));
        }

        if (suggestionsArray.length > 0) {
          console.log('[MappingReviewScreen] DEBUG Sample item:', JSON.stringify({
            title: suggestionsArray[0].platformProduct.title,
            parentId: suggestionsArray[0].platformProduct.parentId,
            parentTitle: suggestionsArray[0].platformProduct.parentTitle,
          }));
        }

        console.log(`[MappingReviewScreen] Processed ${suggestionsArray.length} suggestions from array response`);
      } else if (data && typeof data === 'object') {
        // Legacy format with separate arrays for different suggestion types
        const perfectMatches = Array.isArray(data.perfectMatches) ? data.perfectMatches : [];
        const newFromPlatform = Array.isArray(data.newFromPlatform) ? data.newFromPlatform : [];
        const needsReview = Array.isArray(data.needsReview) ? data.needsReview : [];

        // Combine all suggestion types into a single array for our UI
        suggestionsArray = [
          ...perfectMatches.map((item: any) => ({ ...item, action: 'LINK_EXISTING', isSelected: true })),
          ...newFromPlatform.map((item: any) => {
            const isPush = item.direction === 'anorha_to_platform';
            // Default to UNMATCHED for push items (so they show 'Link Product' / empty slot)
            // Default to CREATE_NEW for platform items (so they show 'New Item')
            return {
              ...item,
              action: isPush ? 'UNMATCHED' : 'CREATE_NEW',
              isSelected: !isPush, // Don't select push items by default
              platformProduct: {
                ...item.platformProduct,
                // Ensure parentId is populated from anorhaVariant if missing (crucial for grouping)
                parentId: item.platformProduct.parentId || item.anorhaVariant?.ProductId,
                parentTitle: item.platformProduct.parentTitle || item.anorhaVariant?.Product?.Title,
              }
            };
          }),
          ...needsReview.map((item: any) => ({ ...item, action: 'UNMATCHED', isSelected: false }))
        ];

        // Keep the summary data for backward compatibility
        setSummaryData(data.summary || null);
        console.log(`[MappingReviewScreen] Processed legacy format: ${perfectMatches.length} matches, ${newFromPlatform.length} new, ${needsReview.length} review`);
      }

      // Deduplicate suggestions by platformProduct.id to prevent duplicate entries
      const seenIds = new Set<string>();
      const deduplicatedSuggestions = suggestionsArray.filter(suggestion => {
        const id = suggestion.platformProduct?.id;
        if (!id || seenIds.has(id)) {
          return false;
        }
        seenIds.add(id);
        return true;
      });

      if (deduplicatedSuggestions.length < suggestionsArray.length) {
        console.log(`[MappingReviewScreen] Removed ${suggestionsArray.length - deduplicatedSuggestions.length} duplicate suggestions`);
      }

      // Set the processed and deduplicated suggestions
      setSuggestions(deduplicatedSuggestions);
      // Fetch scan summary for header counts
      try {
        const token2 = await ensureSupabaseJwt();
        if (token2) {
          const sumResp = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connId}/scan-summary`, { headers: { 'Authorization': `Bearer ${token2}` } });
          if (sumResp.ok) setScanSummary(await sumResp.json());
        }
      } catch { }

      // Add detailed logging for debugging empty suggestions
      console.log(`[MappingReviewScreen] Final suggestions count: ${suggestionsArray.length}`);
      if (suggestionsArray.length === 0) {
        console.log('[MappingReviewScreen] No mapping suggestions found. Checking connection status...');

        // Check connection status to understand why no suggestions
        try {
          const connectionResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/platform-connections/${connId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` },
          });

          if (connectionResponse.ok) {
            const connectionData = await connectionResponse.json();
            console.log(`[MappingReviewScreen] Connection status: ${connectionData.Status}, PlatformSpecificData:`, connectionData.PlatformSpecificData);
          }
        } catch (connErr) {
          console.error('[MappingReviewScreen] Error checking connection status:', connErr);
        }

        console.log('[MappingReviewScreen] Fetching existing mappings from Supabase as fallback...');
        await fetchExistingMappingsFromSupabase(connId);
      } else {
        console.log(`[MappingReviewScreen] Successfully loaded ${suggestionsArray.length} suggestions:`,
          suggestionsArray.map(s => ({ action: s.action, title: s.platformProduct.title })));
      }

    } catch (err: any) {
      console.error('[MappingReviewScreen] Error fetching mapping suggestions:', err);
      setError(err.message || 'An unexpected error occurred.');

      // If there was an error fetching suggestions, try to get existing mappings as fallback
      console.log('[MappingReviewScreen] Error fetching suggestions, trying to get existing mappings as fallback...');
      await fetchExistingMappingsFromSupabase(connId);
    } finally {
      setLoading(false);
    }
  }, [connectionId, isCSVImport]);

  // Load any saved draft selections on mount/when connection changes
  useEffect(() => {
    (async () => {
      if (!connectionId || hasLoadedDraft || isCSVImport) return; // Skip draft loading for CSV import
      try {
        const token = await ensureSupabaseJwt();
        if (!token) return;
        const resp = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/draft-mappings`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) { setHasLoadedDraft(true); return; }
        const data = await resp.json();
        const draftMatches = Array.isArray(data?.confirmedMatches) ? data.confirmedMatches : [];
        if (draftMatches.length > 0 && Array.isArray(suggestions)) {
          // Merge draft into current suggestions by platformProductId
          const mapById: Record<string, any> = {};
          for (const d of draftMatches) {
            mapById[d.platformProductId || d.sourceId] = d;
          }
          setSuggestions(prev => (prev || []).map(s => {
            const d = mapById[s.platformProduct.id];
            if (!d) return s;
            const action = d.action?.toUpperCase?.() === 'LINK' ? 'LINK_EXISTING' : d.action?.toUpperCase?.() === 'CREATE' ? 'CREATE_NEW' : 'IGNORE';
            return {
              ...s,
              action: action as any,
              isSelected: action !== 'IGNORE',
              suggestedCanonicalProduct: d.sssyncVariantId ? { id: d.sssyncVariantId, sku: s.suggestedCanonicalProduct?.sku || '', title: s.suggestedCanonicalProduct?.title || '' } : s.suggestedCanonicalProduct,
            };
          }));
        }
      } catch { }
      setHasLoadedDraft(true);
    })();
  }, [connectionId, suggestions, hasLoadedDraft, isCSVImport]);

  // Debounced autosave of current review selections as draft
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        if (!connectionId || !Array.isArray(suggestions) || isCSVImport) return; // Skip draft saving for CSV import
        const confirmedMatches = suggestions.map(s => ({
          platformProductId: s.platformProduct.id,
          sssyncVariantId: s.action === 'LINK_EXISTING' ? s.suggestedCanonicalProduct?.id : null,
          action: s.action === 'LINK_EXISTING' ? 'link' : (s.action === 'CREATE_NEW' ? 'create' : 'ignore'),
        }));
        const token = await ensureSupabaseJwt();
        if (!token) return;
        await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/draft-mappings`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmedMatches }),
        });
      } catch { }
    }, 600);
    return () => clearTimeout(handle);
  }, [suggestions, connectionId, isCSVImport]);

  // --- NEW: Function to fetch existing mappings from Supabase ---
  // This is the fallback data source when the API returns no results
  // It queries the PlatformProductMappings table and joins with product data
  const fetchExistingMappingsFromSupabase = useCallback(async (connectionId: string) => {
    console.log(`[MappingReviewScreen] Fetching existing mappings from Supabase for connection: ${connectionId}`);
    setLoadingExistingMappings(true);

    try {
      // First get user ID to filter query
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("User not authenticated");
      }

      // Fetch existing mappings from Supabase - simplified query to avoid SQL alias issues
      const { data, error } = await supabase
        .from('PlatformProductMappings')
        .select(`
          *,
          ProductVariants!inner (
            Id,
            ProductId,
            Sku,
            Title,
            Price
          )
        `)
        .eq('PlatformConnectionId', connectionId);

      if (error) {
        console.error('[MappingReviewScreen] Error fetching existing mappings:', error);
        throw new Error(`Failed to fetch existing mappings: ${error.message}`);
      }

      console.log(`[MappingReviewScreen] Fetched ${data?.length || 0} existing mappings from Supabase`);
      console.log('[MappingReviewScreen] First mapping sample:', data && data.length > 0 ? JSON.stringify(data[0]).substring(0, 300) : 'No mappings');

      if (data && data.length > 0) {
        setExistingMappings(data as any); // Cast as any to handle Supabase type complexities

        // Convert existing mappings to suggestion format for display compatibility
        // This allows us to reuse the existing UI components
        const mappingsAsSuggestions: MappingSuggestion[] = data.map((mapping: any) => ({
          action: 'LINK_EXISTING' as const,
          isSelected: true,
          platformProduct: {
            id: mapping.PlatformProductId,
            sku: mapping.PlatformSku || 'N/A',
            title: mapping.ProductVariants?.Title || 'Unknown Product',
            price: mapping.ProductVariants?.Price || 0,
            imageUrl: (mapping.PlatformSpecificData as any)?.imageUrl || null,
          },
          suggestedCanonicalProduct: {
            id: mapping.ProductVariantId,
            sku: mapping.ProductVariants?.Sku || 'N/A',
            title: mapping.ProductVariants?.Title || 'Unknown Product',
          }
        }));

        console.log(`[MappingReviewScreen] Converted ${mappingsAsSuggestions.length} mappings to suggestions format`);
        setSuggestions(mappingsAsSuggestions);

        // Set summary data with counts
        setSummaryData({
          totalPlatformProducts: data.length,
          perfectMatchCount: data.length,
          newFromPlatformCount: 0,
          needsReviewCount: 0
        });
      }
    } catch (err: any) {
      console.error('[MappingReviewScreen] Error in fetchExistingMappingsFromSupabase:', err);
      // Don't set error state here to avoid blocking the UI - we just show empty state
    } finally {
      setLoadingExistingMappings(false);
    }
  }, []);

  // Effect to trigger initial data loading
  useEffect(() => {
    console.log(`[MappingReviewScreen] Effect triggered - isPolling: ${isPolling}, connectionId: ${connectionId}, jobId: ${jobId}, loading: ${loading}`);

    // Initial fetch
    if (isCSVImport && importedProducts) {
      // Initialize suggestions from CSV data
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
          originalData: p, // Store full data for import (added to interface implicitly via casting)
        }));
        setSuggestions(mappedSuggestions);
        setLoading(false);
      } catch (e) {
        console.error("Error mapping CSV data:", e);
        setLoading(false);
      }
    } else if (connectionId) {
      // Only fetch if we are NOT polling and NOT scanning
      // connection?.Status check ensures we don't race against the initial poll check
      if (!isPolling && !isScanningActive && connection) {
        console.log(`[MappingReviewScreen] Not polling and not scanning, fetching suggestions directly for connection: ${connectionId}`);
        fetchMappingSuggestions(connectionId);
      } else if (!connection) {
        // Wait for connection to load...
        console.log('[MappingReviewScreen] Waiting for connection status to load...');
        setLoading(true);
      } else {
        console.log(`[MappingReviewScreen] Scanning/Polling active (Status: ${connection?.Status}), skipping suggestion fetch`);
        setLoading(true); // Ensure loading stays true
      }
    } else if (!connectionId) {
      console.error(`[MappingReviewScreen] No connection ID provided`);
      setError("Connection ID is missing.");
      setLoading(false);
    }
  }, [connectionId, isPolling, isScanningActive, connection]); // Added connection and isScanningActive dependencies

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
        fetchMappingSuggestions(connectionId);
      } else if (syncProgress.status === 'active') {
        console.log('[MappingReviewScreen] Sync activated');
        setLoading(false);
        fetchMappingSuggestions(connectionId);
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
  }, [syncProgress, connectionId, fetchMappingSuggestions]);

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

  /**
   * Handles submitting the user's final approved mappings to start the sync.
   * This sends the selected products to the backend for processing.
   */
  const handleConfirmAndSync = async () => {
    if (!suggestions) {
      Alert.alert("Error", "No suggestions available to sync.");
      return;
    }

    const approvedItems = suggestions.filter(s => s.isSelected && s.action === 'CREATE_NEW');

    if (approvedItems.length === 0) {
      Alert.alert("Nothing to Sync", "No new products were selected for creation.");
      return;
    }

    const payload: FinalizedMappingPayload = {
      approvedMappings: approvedItems.map(item => ({
        action: 'CREATE_NEW',
        platformProduct: {
          id: item.platformProduct.id,
        },
      })),
    };

    console.log(`[MappingReviewScreen] Submitting ${payload.approvedMappings.length} mappings for final sync...`);
    setSyncing(true);
    setError(null);

    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error("Authentication token not found.");

      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to start final sync. Status: ${response.status}`);
      }

      const { jobId: finalSyncJobId } = await response.json();
      console.log(`[MappingReviewScreen] Final sync started with new job ID: ${finalSyncJobId}`);

      // Start polling the new job ID
      setSuggestions(null); // Clear old suggestions
      setJobProgress(null); // Reset progress
      setCurrentJobId(finalSyncJobId);
      setIsPolling(true);

    } catch (err: any) {
      console.error('[MappingReviewScreen] Error during final sync confirmation:', err);
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setSyncing(false);
    }
  };

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
              fetchMappingSuggestions(connectionId);
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
              fetchMappingSuggestions(connectionId);
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
        const productData = {
          userId: (legendState?.userId) || '', // Will be validated by backend token anyway
          variantData: {
            Title: item.platformProduct.title,
            Sku: item.platformProduct.sku,
            Price: item.platformProduct.price,
            Description: (item as any).originalData?.description || item.platformProduct.title, // Fallback
            // Add other fields if captured in originalData
            Barcode: (item as any).originalData?.barcode,
            Quantity: (item as any).originalData?.quantity ? Number((item as any).originalData.quantity) : 0,
            Cost: (item as any).originalData?.cost ? Number((item as any).originalData.cost) : undefined,
            Weight: (item as any).originalData?.weight ? Number((item as any).originalData.weight) : undefined,
            Size: (item as any).originalData?.size,
            Color: (item as any).originalData?.color,
            Brand: (item as any).originalData?.brand,
            Category: (item as any).originalData?.category,
            Condition: (item as any).originalData?.condition,
            PrimaryImageUrl: item.platformProduct.imageUrl,
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
            console.error(`Failed to import item ${i}: status ${res.status}`);
            failCount++;
          } else {
            successCount++;
          }
        } catch (e) {
          console.error(`Failed to import item ${i}:`, e);
          failCount++;
        }

        // Optional: Update progress UI here if we had a detailed progress bar
      }

      Alert.alert(
        "Import Complete",
        `Successfully imported ${successCount} products.${failCount > 0 ? ` Failed: ${failCount}` : ''}`,
        [{
          text: "OK",
          onPress: () => {
            navigation.navigate('TabNavigator', { screen: 'InventoryOrders' } as any);
          }
        }]
      );

    } catch (error: any) {
      console.error('[MappingReviewScreen] CSV Import Error:', error);
      Alert.alert("Import Error", error.message || "Failed to import products.");
    } finally {
      setLoading(false);
      setSyncing(false);
    }
  };

  /**
   * Handles confirming individual item mappings
   */
  const handleConfirmMappings = async (mappingsToConfirm: any) => { // Type this based on actual payload
    console.log("[MappingReviewScreen] Confirming mappings:", mappingsToConfirm);
    setLoading(true);
    setError(null);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error("Authentication token not found.");

      // ✅ Step 1: Confirm mappings
      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/confirm-mappings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmedMatches: mappingsToConfirm }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to confirm mappings. Status: ${response.status}`);
      }

      console.log("[MappingReviewScreen] Mappings confirmed successfully. Now activating sync...");

      // ✅ Step 2: Automatically activate sync so status moves: ready_to_sync → syncing → active
      const activateResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/activate-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!activateResponse.ok) {
        const errorData = await activateResponse.json().catch(() => ({ message: `HTTP error! Status: ${activateResponse.status}` }));
        throw new Error(errorData.message || `Failed to activate sync. Status: ${activateResponse.status}`);
      }

      console.log("[MappingReviewScreen] Sync activated successfully!");
      Alert.alert("Success", "Mappings confirmed and sync activated. Processing has started.");

      // Optionally refresh suggestions or navigate
      fetchMappingSuggestions(connectionId);
    } catch (err: any) {
      console.error("[MappingReviewScreen] Error confirming/activating mappings:", err);
      setError(err.message || "An unexpected error occurred while confirming mappings.");
      Alert.alert("Error", err.message || "Failed to confirm mappings. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Activates sync process for selected connections
   */
  const handleActivateSync = async () => {
    if (!suggestions || suggestions.filter(s => s.isSelected).length === 0) {
      Alert.alert("Error", "No products selected for sync. Please select some items first.");
      return;
    }

    setSyncing(true);
    setError(null);

    try {
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;

      if (!token) {
        throw new Error("Authentication token not found.");
      }

      // Prepare the mappings from selected suggestions
      const selectedSuggestions = suggestions.filter(s => s.isSelected);
      console.log(`[MappingReviewScreen] Activating sync with ${selectedSuggestions.length} selected items...`);

      // Group the mappings by action type for the payload
      const mappingsPayload = selectedSuggestions.map(s => ({
        platformProductId: s.platformProduct.id,
        sssyncVariantId: s.action === 'LINK_EXISTING' ? s.suggestedCanonicalProduct?.id : null,
        action: s.action === 'LINK_EXISTING' ? 'link' : (s.action === 'CREATE_NEW' ? 'create' : 'ignore')
      }));

      // Step 1: Confirm all mappings (mappings only, no sync rules)
      const confirmResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/confirm-mappings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmedMatches: mappingsPayload }),
      });

      if (!confirmResponse.ok) {
        const errorData = await confirmResponse.json().catch(() => ({ message: `HTTP error! Status: ${confirmResponse.status}` }));
        throw new Error(errorData.message || `Failed to confirm mappings. Status: ${confirmResponse.status}`);
      }

      console.log('[MappingReviewScreen] Mappings confirmed successfully.');

      // Step 2: Update quick settings (settings already configured during wizard)
      // CRITICAL: Include propagateCreates and propagateChanges to enable cross-platform sync
      const quickSettings = {
        poolId: selectedPool || undefined,
        autoSyncMode: syncMode === 'auto',
        autoDelist: delistMode === 'auto',
        priceAdjustment: priceBuffer,
        inventoryBuffer: inventoryBuffer,
        // Enable cross-platform product propagation by default
        syncRules: {
          propagateCreates: true,  // Sync new products to other platforms
          propagateUpdates: true,  // Sync updates to other platforms
          propagateDeletes: false, // Don't auto-delete (safer default)
          propagateInventory: true, // Sync inventory changes
          syncInventory: true,
          syncPricing: true,
        }
      };

      const settingsResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/connections/${connectionId}/quick-settings`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(quickSettings)
      });

      if (!settingsResponse.ok) {
        const errorText = await settingsResponse.text();
        throw new Error(`Failed to update quick settings: ${errorText || settingsResponse.status}`);
      }

      console.log('[MappingReviewScreen] Quick settings updated successfully.');

      // Step 3: Activate the sync (no sync rules needed - settings are in connection data)
      const activateResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/activate-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (!activateResponse.ok) {
        const errorData = await activateResponse.json().catch(() => ({ message: `HTTP error! Status: ${activateResponse.status}` }));
        throw new Error(errorData.message || `Failed to activate sync. Status: ${activateResponse.status}`);
      }

      const { jobId: activationJobId } = await activateResponse.json();
      console.log(`[MappingReviewScreen] Sync activated successfully. New Job ID: ${activationJobId}`);

      // Show custom success notification and navigate back properly
      setNotificationMessage(`Your ${platformName} connection is now active and syncing!`);
      setShowSuccessNotification(true);

      // Navigate back to the root of the stack (Profile screen) after a short delay
      setTimeout(() => {
        setShowSuccessNotification(false);
        // Use reset to ensure we go to the bottom of the stack
        navigation.reset({
          index: 0,
          routes: [{ name: 'TabNavigator', params: { refresh: Date.now() } }],
        });
      }, 2500);

    } catch (err: any) {
      console.error('[MappingReviewScreen] Error during activation:', err);
      setError(err.message || 'An unexpected error occurred during activation.');
      Alert.alert("Activation Error", err.message || "Failed to activate sync. Please try again later.");
    } finally {
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
  // Get counts for tabs
  const counts = useMemo(() => {
    const list = suggestions || [];
    const matched = list.filter(s => s.action === 'LINK_EXISTING' || s.resolved === true).length;
    const ignore = list.filter(s => s.action === 'IGNORE').length;
    const review = Math.max(0, list.filter(s => s.action !== 'LINK_EXISTING' && s.action !== 'IGNORE' && !s.resolved).length);
    // NEW: Count push items (Anorha items to push to this platform)
    const push = list.filter(s => s.direction === 'anorha_to_platform' && s.isSelected).length;
    const pushTotal = list.filter(s => s.direction === 'anorha_to_platform').length;
    return { matched, review, ignore, push, pushTotal } as any;
  }, [suggestions]);

  // Current list by active tab + query + sort
  const currentList = useMemo(() => {
    const base = (suggestions || []).filter(s => {
      if (activeTab === 'matched') return s.action === 'LINK_EXISTING' || s.resolved === true;
      if (activeTab === 'review') return s.action !== 'LINK_EXISTING' && s.action !== 'IGNORE' && !s.resolved;
      return s.action === 'IGNORE';
    });

    const filtered = listQuery
      ? base.filter(item =>
        (item.platformProduct.title || '').toLowerCase().includes(listQuery.toLowerCase()) ||
        (item.platformProduct.sku || '').toLowerCase().includes(listQuery.toLowerCase()) ||
        (item.suggestedCanonicalProduct?.title || '').toLowerCase().includes(listQuery.toLowerCase())
      )
      : base;

    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'title') {
        return (a.platformProduct.title || '').localeCompare(b.platformProduct.title || '');
      }
      return (a.platformProduct.sku || '').localeCompare(b.platformProduct.sku || '');
    });
    return sorted;
  }, [suggestions, activeTab, listQuery, sortBy]);

  // NEW: Grouping Logic
  // Groups items by parentId to show variants together
  const groupedList = useMemo(() => {
    if (!currentList) return [];

    // 1. Group items
    const groups = new Map<string, { title: string, items: MappingSuggestion[] }>();
    const looseItems: MappingSuggestion[] = [];

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

    // 2. Build flat list with headers
    const result: any[] = [];

    // Add groups - only show header if there are multiple variants
    groups.forEach((group, id) => {
      if (group.items.length > 1) {
        // Calculate price range for the group
        const prices = group.items
          .map(item => item.platformProduct.price)
          .filter(p => p != null && p > 0);

        const minPrice = prices.length > 0 ? Math.min(...prices) : null;
        const maxPrice = prices.length > 0 ? Math.max(...prices) : null;

        // Check if any item in the group is anorha_to_platform direction
        const isAnorhaToplatform = group.items.some(item => item.direction === 'anorha_to_platform');
        const isExpanded = expandedGroups.has(id);

        // Multiple variants - show a group header with price range
        result.push({
          type: 'header',
          title: group.title,
          id,
          count: group.items.length,
          minPrice,
          maxPrice,
          isAnorhaToplatform,
          isExpanded,
          items: group.items, // Pass items for collapsed group actions
        });

        // Only add individual items if the group is expanded
        if (isExpanded) {
          result.push(...group.items.map(s => ({ type: 'item', suggestion: s, isChild: true })));
        }
      } else {
        // Single item - no header, just add the item
        result.push(...group.items.map(s => ({ type: 'item', suggestion: s, isChild: false })));
      }
    });

    // Add loose items (no header needed for individual items)
    result.push(...looseItems.map(s => ({ type: 'item', suggestion: s, isChild: false })));

    return result;
  }, [currentList, expandedGroups]);

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
              setShowSearchResults(true);
              setSearchQuery('');
              (global as any).currentPlatformProduct = item.platformProduct;
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
              setShowSearchResults(true);
              setSearchQuery('');
              (global as any).currentPlatformProduct = item.platformProduct;
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

  // --- NEW: Search functionality ---
  const searchProducts = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      // Keep modal open; just clear results until enough characters
      setShowSearchResults(true);
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const session = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error("User not authenticated");
      }

      // Search in ProductVariants table
      const { data, error } = await supabase
        .from('ProductVariants')
        .select('Id, Sku, Title, Price, Barcode')
        .eq('UserId', user.id)
        // Use simple ILIKE for broad matching on Title or SKU
        .or(`Title.ilike.%${query}%,Sku.ilike.%${query}%`)
        .limit(20);

      if (error) {
        console.error('[MappingReviewScreen] Error searching products:', error);
        throw error;
      }

      setSearchResults(data || []);
      setShowSearchResults(true);
    } catch (err: any) {
      console.error('[MappingReviewScreen] Search error:', err);
      Alert.alert('Search Error', err.message || 'Failed to search products');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchChange = (text: string) => {
    setShowSearchResults(true); // ensure it stays visible
    setSearchQuery(text);
    clearTimeout((handleSearchChange as any)._t);
    (handleSearchChange as any)._t = setTimeout(() => {
      searchProducts(text);
    }, 350);
  };

  const handleLinkProduct = (searchResult: any, platformProduct: any) => {
    // Update the suggestion to link to the selected product
    setSuggestions(currentSuggestions => {
      if (!currentSuggestions) return null;
      return currentSuggestions.map(suggestion => {
        if (suggestion.platformProduct.id === platformProduct.id) {
          return {
            ...suggestion,
            action: 'LINK_EXISTING' as const,
            isSelected: true,
            suggestedCanonicalProduct: {
              id: searchResult.Id,
              sku: searchResult.Sku,
              title: searchResult.Title,
            }
          };
        }
        return suggestion;
      });
    });

    // Close search
    setShowSearchResults(false);
    setSearchQuery('');
    setSearchResults([]);

    Alert.alert('Product Linked', `${platformProduct.title} has been linked to ${searchResult.Title}`);
  };

  const renderSearchResults = () => {
    if (!showSearchResults) return null;

    return (
      <Modal visible={showSearchResults} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.searchModal}>
          <View style={styles.searchModalHeader}>
            <Text style={styles.searchModalTitle}>Search Products to Link</Text>
            <TouchableOpacity onPress={() => setShowSearchResults(false)}>
              <Icon name="close" size={24} color={theme.colors.text} />
            </TouchableOpacity>
          </View>

          <TextInput
            style={styles.searchInput}
            placeholder="Search by SKU, name, or barcode..."
            value={searchQuery}
            onChangeText={handleSearchChange}
            autoFocus
          />

          {isSearching ? (
            <View style={styles.searchSpinner}>
              <ActivityIndicator size="large" color={theme.colors.primary} />
              <Text style={styles.searchingText}>Searching your products...</Text>
            </View>
          ) : (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.Id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.searchResultItem}
                  onPress={() => {
                    const platformProduct = (global as any).currentPlatformProduct;
                    if (platformProduct) {
                      handleLinkProduct(item, platformProduct);
                    } else {
                      Alert.alert('Error', 'No platform product selected for linking');
                    }
                  }}
                >
                  <View style={styles.searchResultContent}>
                    <View style={styles.searchResultMain}>
                      <Text style={styles.searchResultTitle}>{item.Title}</Text>
                      <Text style={styles.searchResultSku}>SKU: {item.Sku || 'N/A'}</Text>
                      <Text style={styles.searchResultPrice}>Price: ${item.Price || '0.00'}</Text>
                    </View>
                    <Icon name="link-variant" size={20} color={theme.colors.primary} />
                  </View>
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.searchEmptyContainer}>
                  <Icon name="magnify" size={48} color={theme.colors.textSecondary} />
                  <Text style={styles.searchEmptyText}>
                    {searchQuery.length > 0 ? 'No products found' : 'Start typing to search...'}
                  </Text>
                  {searchQuery.length > 0 && (
                    <Text style={styles.searchEmptySubtext}>
                      Try searching by product name, SKU, or barcode
                    </Text>
                  )}
                </View>
              }
            />
          )}
        </View>
      </Modal>
    );
  };

  // --- End search functionality ---

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
      await fetchMappingSuggestions(connectionId);

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

      // Trigger a platform scan
      const scanResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/scan`, {
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
        await fetchMappingSuggestions(connectionId);
      } else {
        // If scan endpoint fails, just refresh suggestions
        console.warn(`[MappingReviewScreen] Scan trigger failed, refreshing suggestions directly`);
        await fetchMappingSuggestions(connectionId);
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
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.05,
      shadowRadius: 2,
      elevation: 1,
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
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 5,
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
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 4,
      elevation: 3,
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
        <Button title="Retry" onPress={() => fetchMappingSuggestions(connectionId)} />
      </View>
    );
  }

  // NOTE: Removed empty state early return - always show full wizard UI
  // MappingReviewScreen is used for ongoing settings, not just product mapping

  // --- MODIFIED: If we have existing mappings but no API suggestions, show them ---
  if (existingMappings.length > 0 && (!suggestions || (Array.isArray(suggestions) && suggestions.length === 0))) {
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

      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <Icon name="arrow-left" size={22} color={theme.colors.text} />
      </TouchableOpacity>

      {/* Search Modal */}
      {renderSearchResults()}

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

          <PillTabs
            tabs={[
              { key: 'matched', label: 'Matches', count: counts.matched, tone: 'success' },
              { key: 'review', label: 'Review', count: counts.review, tone: 'warning' },
              { key: 'ignore', label: 'Ignore', count: counts.ignore, tone: 'danger' },
            ]}
            value={activeTab}
            onChange={(k) => setActiveTab(k as ActiveTab)}
          />

          <View style={styles.searchSection}>
            <SearchBarWithScanner
              value={listQuery}
              onChangeText={setListQuery}
              placeholder={`Search this account's products`}
              onScan={(barcode) => setListQuery(barcode)}
              onScannerOpen={() => setShowBarcodeScanner(true)}
            />
          </View>


          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 12, marginTop: 4, }}>
            {activeTab === 'matched' && (
              <Text style={{ fontWeight: "600", color: theme.colors.textSecondary }}>
                Review Matches
              </Text>
            )}
            {activeTab === 'review' && (
              <Text style={{ fontWeight: "600", color: theme.colors.textSecondary }}>
                Verify/Review
              </Text>
            )}
            {activeTab === 'ignore' && (
              <Text style={{ fontWeight: "600", color: theme.colors.textSecondary }}>
                Ignored Products
              </Text>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* Effect All Dropdown */}
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
                    shadowColor: '#000',
                    shadowOpacity: 0.15,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 6 },
                    elevation: 10,
                    zIndex: 1000,
                    minWidth: 200,
                    overflow: 'hidden',
                  }}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}
                      onPress={() => {
                        setSuggestions(prev => (prev || []).map(s => {
                          const isReview = s.action !== 'LINK_EXISTING' && s.action !== 'IGNORE' && !s.resolved;
                          if (isReview && s.suggestedCanonicalProduct?.id) {
                            return { ...s, action: 'LINK_EXISTING', resolved: true, isSelected: true };
                          }
                          return s;
                        }));
                        setShowEffectAllDropdown(false);
                      }}
                    >
                      <Icon name="check-all" size={18} color="#93C822" />
                      <Text style={{ marginLeft: 8, color: '#374151', fontWeight: '600' }}>Match All</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}
                      onPress={() => {
                        setSuggestions(prev => (prev || []).map(s => {
                          const isReview = s.action !== 'LINK_EXISTING' && s.action !== 'IGNORE' && !s.resolved;
                          if (isReview) {
                            return { ...s, action: 'CREATE_NEW', resolved: true, isSelected: true };
                          }
                          return s;
                        }));
                        setShowEffectAllDropdown(false);
                      }}
                    >
                      <Icon name="plus-circle" size={18} color="#93C822" />
                      <Text style={{ marginLeft: 8, color: '#374151', fontWeight: '600' }}>Create All as New</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}
                      onPress={() => {
                        setSuggestions(prev => (prev || []).map(s => {
                          const isInCurrentTab = activeTab === 'matched'
                            ? (s.action === 'LINK_EXISTING' || s.resolved === true)
                            : activeTab === 'review'
                              ? (s.action !== 'LINK_EXISTING' && s.action !== 'IGNORE' && !s.resolved)
                              : s.action === 'IGNORE';
                          if (isInCurrentTab && s.action !== 'IGNORE') {
                            return { ...s, prevAction: s.action, action: 'IGNORE', isSelected: false, resolved: false };
                          }
                          return s;
                        }));
                        setShowEffectAllDropdown(false);
                      }}
                    >
                      <Icon name="close-circle" size={18} color="#EF4444" />
                      <Text style={{ marginLeft: 8, color: '#374151', fontWeight: '600' }}>Ignore All</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              {/* Sort Button - Removed Rescan button per user request */}
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8 }} onPress={() => setSortBy(sortBy === 'title' ? 'sku' : 'title')} accessibilityLabel="Sort by">
                <Icon name="sort" size={18} color={theme.colors.textSecondary} />
                <Text style={{ marginLeft: 6, color: theme.colors.textSecondary, fontWeight: '600' }}>Sort By: {sortBy === 'title' ? 'Title' : 'SKU'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            // Use groupedList instead of currentList
            data={groupedList}
            keyExtractor={(item, index) => item.type === 'header' ? `header-${item.id}` : `item-${item.suggestion.platformProduct.id}-${index}`}
            renderItem={({ item }) => {
              if (item.type === 'header') {
                // Format price range for display
                let priceText = '';
                if (item.minPrice != null && item.maxPrice != null) {
                  if (item.minPrice === item.maxPrice) {
                    priceText = `$${item.minPrice.toFixed(2)}`;
                  } else {
                    priceText = `$${item.minPrice.toFixed(2)} - $${item.maxPrice.toFixed(2)}`;
                  }
                }

                if (item.isExpanded) {
                  // Breadcrumb style for expanded group
                  return (
                    <TouchableOpacity
                      style={styles.expandedGroupHeader}
                      onPress={() => {
                        setExpandedGroups(prev => {
                          const newSet = new Set(prev);
                          newSet.delete(item.id);
                          return newSet;
                        });
                      }}
                    >
                      <Icon name="chevron-up" size={16} color={theme.colors.textSecondary} style={{ marginRight: 6 }} />
                      <Text style={styles.expandedGroupHeaderText}>{item.title}</Text>
                      <View style={styles.expandedGroupLine} />
                    </TouchableOpacity>
                  );
                }

                // Collapsed Group acts as a MappingCard
                const groupItems = item.items as MappingSuggestion[];
                const allIgnored = groupItems.every(s => s.action === 'IGNORE');
                const allMatched = groupItems.every(s => s.action === 'LINK_EXISTING');
                const allNew = groupItems.every(s => s.action === 'CREATE_NEW');

                const groupVariant = allIgnored ? 'ignored' : allMatched ? 'matched' : allNew ? 'new' : 'review';

                // Representative images/data
                const firstItem = groupItems[0];

                // Extract variant options from item titles
                // Option format examples: "Title - Option" or title contains unique suffix
                const extractedOptions: { label: string; values: string[] } = { label: 'Options', values: [] };
                const parentTitle = item.title || '';
                groupItems.forEach(gi => {
                  const variantTitle = gi.platformProduct.title || '';
                  // Try to extract the variant part by removing the parent title
                  let optionValue = variantTitle;
                  if (parentTitle && variantTitle.startsWith(parentTitle)) {
                    optionValue = variantTitle.slice(parentTitle.length).replace(/^[\s\-\/:]+/, '').trim();
                  } else if (parentTitle && variantTitle.includes(' - ')) {
                    // Common format: "Title - OptionValue"
                    optionValue = variantTitle.split(' - ').pop()?.trim() || variantTitle;
                  }
                  if (optionValue && optionValue !== variantTitle && optionValue !== parentTitle) {
                    extractedOptions.values.push(optionValue);
                  }
                });

                // Build attributesLeft if we found options
                const groupAttributes = extractedOptions.values.length > 0
                  ? [{ label: extractedOptions.label, value: extractedOptions.values }]
                  : undefined;

                return (
                  <MappingCard
                    variant={groupVariant}
                    titleLeft={item.title}
                    variantCount={item.count}
                    priceRange={priceText}
                    imageLeft={firstItem.platformProduct.imageUrl}
                    selected={groupItems.some(s => s.isSelected)}
                    attributesLeft={groupAttributes}
                    onSelect={() => {
                      const anySelected = groupItems.some(s => s.isSelected);
                      setSuggestions(prev => (prev || []).map(prevS =>
                        groupItems.some(gi => gi.platformProduct.id === prevS.platformProduct.id)
                          ? { ...prevS, isSelected: !anySelected }
                          : prevS
                      ));
                    }}
                    onIgnore={() => {
                      setSuggestions(prev => (prev || []).map(prevS =>
                        groupItems.some(gi => gi.platformProduct.id === prevS.platformProduct.id)
                          ? { ...prevS, action: allIgnored ? 'UNMATCHED' : 'IGNORE', isSelected: false }
                          : prevS
                      ));
                    }}
                    onCreate={() => {
                      setSuggestions(prev => (prev || []).map(prevS =>
                        groupItems.some(gi => gi.platformProduct.id === prevS.platformProduct.id)
                          ? { ...prevS, action: 'CREATE_NEW', isSelected: true, resolved: true }
                          : prevS
                      ));
                    }}
                    onSearch={() => {
                      // Set group items for bulk mapping when match is selected
                      setItemToMatch(firstItem);
                      setGroupItemsToMatch(groupItems);  // Pass all group items
                      setSearchModalQuery('');
                      setSearchModalResults([]);
                      setShowSearchModal(true);
                    }}
                    // Click the card itself (not buttons) to expand
                    onPress={() => {
                      setExpandedGroups(prev => new Set(prev).add(item.id));
                    }}
                  />
                );
              }

              // It's a suggestion items
              const s = item.suggestion;
              // Map UNMATCHED action to 'review' variant style (empty slot) if not ignored
              const visualVariant = s.action === 'IGNORE' ? 'ignored'
                : s.action === 'LINK_EXISTING' ? 'matched'
                  : s.action === 'UNMATCHED' ? 'review' // Shows empty Link Product slot
                    : s.action === 'CREATE_NEW' ? 'new' // Shows Green New Item card
                      : (s.confidence != null && s.confidence > 0 && s.confidence < 0.8) ? 'review'
                        : 'new';

              return (
                <MappingCard
                  isChild={item.isChild}
                  variant={visualVariant as any}
                  titleLeft={s.platformProduct.title}
                  skuLeft={s.platformProduct.sku}
                  priceLeft={s.platformProduct.price}
                  imageLeft={s.platformProduct.imageUrl}
                  // For UNMATCHED, ensure titleRight is undefined so it shows empty slot
                  titleRight={s.action === 'UNMATCHED' ? undefined : s.suggestedCanonicalProduct?.title}
                  skuRight={s.suggestedCanonicalProduct?.sku}
                  priceRight={s.suggestedCanonicalProduct?.price}
                  imageRight={s.suggestedCanonicalProduct?.imageUrl}
                  selected={s.isSelected}
                  isResolvedNew={s.action === 'CREATE_NEW' && !!s.resolved}
                  onEditNew={() => setSuggestions(prev => (prev || []).map(prevS => prevS.platformProduct.id === s.platformProduct.id ? { ...prevS, resolved: false, action: 'UNMATCHED', isSelected: false } : prevS))}
                  onSelect={() => setSuggestions(prev => (prev || []).map(prevS => prevS.platformProduct.id === s.platformProduct.id ? { ...prevS, isSelected: !prevS.isSelected, action: (!prevS.isSelected && (prevS.action === 'IGNORE' || prevS.action === 'UNMATCHED')) ? 'CREATE_NEW' : prevS.action } : prevS))}
                  onIgnore={() => {
                    setSuggestions(prev => (prev || []).map(prevS => {
                      if (prevS.platformProduct.id !== s.platformProduct.id) return prevS;
                      if (activeTab === 'matched' || (prevS.action === 'CREATE_NEW' && prevS.resolved)) {
                        // Restore to UNMATCHED if unignoring/removing link
                        return { ...prevS, action: 'UNMATCHED', matchType: 'TITLE', isSelected: false, resolved: false };
                      }
                      return { ...prevS, prevTab: activeTab, prevAction: prevS.action, action: 'IGNORE', isSelected: false, resolved: false };
                    }));
                  }}
                  onRestore={() => setSuggestions(prev => (prev || []).map(prevS => prevS.platformProduct.id === s.platformProduct.id ? { ...prevS, action: prevS.prevAction || 'UNMATCHED', isSelected: false } : prevS))}
                  onCreate={() => setSuggestions(prev => (prev || []).map(prevS => prevS.platformProduct.id === s.platformProduct.id ? { ...prevS, action: 'CREATE_NEW', isSelected: true, resolved: true } : prevS))}
                  onApproveMatch={() => setSuggestions(prev => (prev || []).map(prevS => prevS.platformProduct.id === s.platformProduct.id ? { ...prevS, action: 'LINK_EXISTING', resolved: true, isSelected: true } : prevS))}
                  onSearch={() => { setItemToMatch(s); setGroupItemsToMatch(null); setSearchModalQuery(''); setSearchModalResults([]); setShowSearchModal(true); }}
                />
              );
            }}
            contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: 120 }}
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
            onEndReachedThreshold={0.6}
            onEndReached={() => {
              // Simple client-side pagination: load more from suggestions if we later support server paging
            }}
          />

          {/* Search Modal - Bottom Sheet Style */}
          <Modal visible={showSearchModal} transparent={true} animationType="slide" onRequestClose={() => setShowSearchModal(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
              <View style={{
                height: '70%',
                backgroundColor: '#fff',
                borderTopLeftRadius: 20,
                borderTopRightRadius: 20,
                paddingTop: 20,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: -4 },
                shadowOpacity: 0.1,
                shadowRadius: 10,
                elevation: 10
              }}>
                <View style={{ paddingHorizontal: 20, marginBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 18, fontWeight: '700' }}>Select Product</Text>
                  <TouchableOpacity onPress={() => setShowSearchModal(false)} style={{ padding: 4, backgroundColor: '#F3F4F6', borderRadius: 20 }}>
                    <Icon name="close" size={20} color="#666" />
                  </TouchableOpacity>
                </View>

                <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                  <SearchBarWithScanner
                    value={searchModalQuery}
                    onChangeText={(text) => {
                      setSearchModalQuery(text);
                      if (text.length > 2) performProductSearch(text);
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
                      <View style={{ width: 48, height: 48, backgroundColor: '#f0f0f0', borderRadius: 8, marginRight: 12, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="package-variant" size={24} color="#9CA3AF" />
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
                          {searchModalQuery.length < 3 ? 'Type at least 3 characters to search' : 'No products found'}
                        </Text>
                      </View>
                  }
                />
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
            secondaryLabel="Cancel import"
            secondaryDisabled={false}
            onSecondary={() => navigation.goBack()}
          />

          {/* Inline Bottom-Sheet Wizard */}
          <Modal visible={wizardVisible} transparent animationType="fade" onRequestClose={() => setWizardVisible(false)}>
            <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.7)' }}>
              <Pressable style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0)' }} onPress={() => setWizardVisible(false)} />
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ maxHeight: '90%' }}
              >
                <ScrollView
                  contentContainerStyle={{ flexGrow: 1 }}
                  scrollEnabled={true}
                  nestedScrollEnabled={true}
                >
                  <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, paddingBottom: 32, }}>
                    {/* Wizard Header */}
                    <View style={{ paddingVertical: 12, alignItems: 'center' }}>
                      {/* Back link - ONLY on Step 0 */}
                      {wizardStep === 0 && (
                        <TouchableOpacity
                          style={{ alignSelf: 'center', marginBottom: 12 }}
                          onPress={() => setWizardVisible(false)}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Icon name="arrow-u-left-top" size={16} color="#6B7280" />
                            <Text style={{ color: '#6B7280', fontSize: 14 }}>Reselect Matches</Text>
                          </View>
                        </TouchableOpacity>
                      )}

                      {/* Title */}
                      <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text, textAlign: 'center' }}>
                        {WIZARD_STEP_CONFIG[wizardStep]?.title || 'Setup'}
                      </Text>

                      {/* Description - ABOVE divider */}
                      {WIZARD_STEP_CONFIG[wizardStep]?.description && (
                        <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', fontSize: 14, marginTop: 8 }}>
                          {WIZARD_STEP_CONFIG[wizardStep]?.description}
                        </Text>
                      )}
                    </View>

                    {/* Divider */}
                    <View style={{ height: 1, backgroundColor: '#E5E5E5', marginBottom: 16 }} />

                    {/* Step 0: Product Creation Mode - 3 cards + skip button */}
                    {wizardStep === 0 && (
                      <View style={{ paddingHorizontal: 0, minHeight: 300 }}>
                        {/* Three horizontal option cards */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginBottom: 24 }}>
                          {/* Option 1: Sync Everywhere - Dynamic platform icon stack */}
                          <TouchableOpacity
                            style={{
                              flex: 1,
                              borderWidth: 2,
                              borderColor: productCreationMode === 'sync_everywhere' ? theme.colors.primary : '#E5E7EB',
                              borderRadius: 12,
                              paddingVertical: 16,
                              paddingHorizontal: 8,
                              backgroundColor: productCreationMode === 'sync_everywhere' ? theme.colors.primary + '15' : '#fff',
                              alignItems: 'center',
                            }}
                            onPress={() => setProductCreationMode('sync_everywhere')}
                          >
                            {/* Dynamic platform icons - photo stack style */}
                            <View style={{
                              alignItems: 'center',
                              justifyContent: 'center',
                              marginBottom: 10,
                              height: 52,
                              width: '100%',
                            }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                                {/* Anorha logo first in the stack */}
                                <View style={{
                                  backgroundColor: '#fff',
                                  borderRadius: 8,
                                  padding: 3,
                                  borderWidth: 2,
                                  borderColor: theme.colors.primary,
                                  zIndex: 5,
                                  shadowColor: '#000',
                                  shadowOpacity: 0.08,
                                  shadowRadius: 2,
                                  shadowOffset: { width: 0, height: 1 },
                                  elevation: 2,
                                }}>
                                  <RNImage source={AnorhaLogo} style={{ width: 32, height: 32, borderRadius: 6 }} />
                                </View>
                                {platformConnections.slice(0, 2).map((conn, index) => {
                                  const platformType = conn.PlatformType?.toLowerCase() || '';
                                  return (
                                    <View
                                      key={conn.Id}
                                      style={{
                                        marginLeft: -12,
                                        backgroundColor: '#fff',
                                        borderRadius: 8,
                                        padding: 3,
                                        borderWidth: 1.5,
                                        borderColor: '#E5E7EB',
                                        zIndex: 3 - index,
                                        shadowColor: '#000',
                                        shadowOpacity: 0.08,
                                        shadowRadius: 2,
                                        shadowOffset: { width: 0, height: 1 },
                                        elevation: 2,
                                      }}
                                    >
                                      {platformType.includes('shopify') && <ShopifySvg width={32} height={32} />}
                                      {platformType.includes('square') && <SquareSvg width={32} height={32} />}
                                      {platformType.includes('clover') && <CloverSvg width={32} height={32} />}
                                      {platformType.includes('ebay') && <EbaySvg width={32} height={32} />}
                                      {platformType.includes('facebook') && <FacebookSvg width={32} height={32} />}
                                      {platformType.includes('amazon') && <AmazonSvg width={32} height={32} />}
                                      {!platformType.match(/shopify|square|clover|ebay|facebook|amazon/) && (
                                        <Icon name="store" size={32} color={getPlatformColor(platformType)} />
                                      )}
                                    </View>
                                  );
                                })}
                                {platformConnections.length > 3 && (
                                  <View style={{
                                    marginLeft: -10,
                                    backgroundColor: '#F3F4F6',
                                    borderRadius: 8,
                                    padding: 3,
                                    width: 38,
                                    height: 38,
                                    borderWidth: 1.5,
                                    borderColor: '#E5E7EB',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    zIndex: 0,
                                  }}>
                                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#6B7280' }}>
                                      +{platformConnections.length - 3}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            </View>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text, textAlign: 'center' }}>
                              Sync Everywhere
                            </Text>
                            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
                              Adds missing items to ALL platforms
                            </Text>
                          </TouchableOpacity>

                          {/* Option 2: Pull Only - Other platforms → arrow → This platform */}
                          <TouchableOpacity
                            style={{
                              flex: 1,
                              borderWidth: 2,
                              borderColor: productCreationMode === 'pull_only' ? theme.colors.primary : '#E5E7EB',
                              borderRadius: 12,
                              paddingVertical: 16,
                              paddingHorizontal: 4,
                              backgroundColor: productCreationMode === 'pull_only' ? theme.colors.primary + '15' : '#fff',
                              alignItems: 'center',
                            }}
                            onPress={() => setProductCreationMode('pull_only')}
                          >
                            {/* Visual flow: This platform → arrow → Anorha */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10, height: 52, gap: 2 }}>
                              {/* Current platform (Square/Shopify/etc) on LEFT */}
                              <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 3, borderWidth: 1.5, borderColor: '#E5E7EB' }}>
                                {platformName?.toLowerCase().includes('shopify') && <ShopifySvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('square') && <SquareSvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('clover') && <CloverSvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('ebay') && <EbaySvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('facebook') && <FacebookSvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('amazon') && <AmazonSvg width={32} height={32} />}
                                {!platformName?.toLowerCase().match(/shopify|square|clover|ebay|facebook|amazon/) && <Icon name="store" size={32} color="#9CA3AF" />}
                              </View>
                              {/* Arrow pointing right */}
                              <Icon name="arrow-right" size={20} color={theme.colors.primary} />
                              {/* Anorha logo on RIGHT */}
                              <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 3, borderWidth: 2, borderColor: theme.colors.primary }}>
                                <RNImage source={AnorhaLogo} style={{ width: 32, height: 32, borderRadius: 6 }} />
                              </View>
                            </View>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text, textAlign: 'center' }}>
                              Import to Anorha
                            </Text>
                            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
                              Pull items from {platformName || 'platform'}
                            </Text>
                          </TouchableOpacity>

                          {/* Option 3: Push Only - Anorha → arrow → This platform */}
                          <TouchableOpacity
                            style={{
                              flex: 1,
                              borderWidth: 2,
                              borderColor: productCreationMode === 'push_only' ? theme.colors.primary : '#E5E7EB',
                              borderRadius: 12,
                              paddingVertical: 16,
                              paddingHorizontal: 4,
                              backgroundColor: productCreationMode === 'push_only' ? theme.colors.primary + '15' : '#fff',
                              alignItems: 'center',
                            }}
                            onPress={() => setProductCreationMode('push_only')}
                          >
                            {/* Visual flow: Anorha → arrow → This platform */}
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10, height: 52, gap: 6 }}>
                              {/* Anorha logo on LEFT */}
                              <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 3, borderWidth: 1.5, borderColor: '#E5E7EB' }}>
                                <RNImage source={AnorhaLogo} style={{ width: 32, height: 32, borderRadius: 6 }} />
                              </View>
                              {/* Arrow pointing right */}
                              <Icon name="arrow-right" size={20} color={theme.colors.primary} />
                              {/* Current platform on RIGHT */}
                              <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 3, borderWidth: 2, borderColor: theme.colors.primary }}>
                                {platformName?.toLowerCase().includes('shopify') && <ShopifySvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('square') && <SquareSvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('clover') && <CloverSvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('ebay') && <EbaySvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('facebook') && <FacebookSvg width={32} height={32} />}
                                {platformName?.toLowerCase().includes('amazon') && <AmazonSvg width={32} height={32} />}
                                {!platformName?.toLowerCase().match(/shopify|square|clover|ebay|facebook|amazon/) && <Icon name="store" size={32} color={theme.colors.primary} />}
                              </View>
                            </View>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text, textAlign: 'center' }}>
                              Push to {platformName || 'Platform'}
                            </Text>
                            <Text style={{ fontSize: 11, color: theme.colors.textSecondary, textAlign: 'center', marginTop: 4 }}>
                              Send Anorha items here
                            </Text>
                          </TouchableOpacity>
                        </View>

                        {/* Continue button */}
                        <TouchableOpacity
                          style={{
                            backgroundColor: "#5C9B00",
                            borderRadius: 12,
                            paddingVertical: 14,
                            alignItems: 'center',
                            marginBottom: 10,
                          }}
                          onPress={() => setWizardStep(1)}
                        >
                          <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>
                            Continue
                          </Text>
                        </TouchableOpacity>

                        {/* Gray Skip button for "Do Nothing" */}
                        <TouchableOpacity
                          style={{
                            backgroundColor: '#E5E5E5',
                            borderRadius: 12,
                            paddingVertical: 14,
                            alignItems: 'center',
                          }}
                          onPress={() => {
                            setProductCreationMode('do_nothing');
                            setWizardStep(1);
                          }}
                        >
                          <Text style={{ color: '#71717A', fontWeight: '600', fontSize: 16 }}>
                            Skip - Don't create missing items
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Step 1: Pool Assignment (was Step 0) */}
                    {wizardStep === 1 && (
                      <View style={{ paddingHorizontal: 0, paddingTop: 0 }}>
                        {(isLoadingPools || isLoadingLocations) ? (
                          <View style={{ padding: 40, alignItems: 'center' }}>
                            <ActivityIndicator size="large" color={theme.colors.primary} />
                            <Text style={{ marginTop: 12, color: theme.colors.textSecondary }}>
                              Loading locations and pools...
                            </Text>
                          </View>
                        ) : displayConnectionLocations.length === 0 ? (
                          <View style={{ padding: 0, alignItems: 'center' }}>

                            {/*<Icon name="map-marker-off" size={48} color={theme.colors.textSecondary} />
                            <Text style={{ marginTop: 12, color: theme.colors.textSecondary, textAlign: 'center' }}>
                              No locations found for this connection.{'\n'}Sync will use default location.
                            </Text>
                            */}
                            {/* Show simple pool selection */}
                            <View style={{ width: '100%', marginTop: 20 }}>
                              {pools.length > 0 && pools.map((pool) => (
                                <TouchableOpacity
                                  key={pool.id}
                                  style={{
                                    borderWidth: 1,
                                    borderColor: selectedPool === pool.id ? theme.colors.primary : '#E5E7EB',
                                    borderRadius: 12,
                                    padding: 16,
                                    marginBottom: 8,
                                    backgroundColor: selectedPool === pool.id ? theme.colors.primary + '10' : '#fff',
                                    flexDirection: 'row',
                                    alignItems: 'center',
                                  }}
                                  onPress={() => setSelectedPool(pool.id)}
                                >
                                  <Text style={{ flex: 1, fontWeight: '600', color: theme.colors.text }}>{pool.name}</Text>
                                  <View style={{
                                    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
                                    borderColor: selectedPool === pool.id ? theme.colors.primary : '#E5E7EB',
                                    backgroundColor: selectedPool === pool.id ? theme.colors.primary : 'transparent',
                                    alignItems: 'center', justifyContent: 'center'
                                  }}>
                                    {selectedPool === pool.id && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' }} />}
                                  </View>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </View>
                        ) : (
                          <>
                            {/* Location-to-Pool Assignment Section */}
                            <View style={{ marginBottom: 20 }}>
                              <Text style={{ fontWeight: '700', fontSize: 14, color: theme.colors.text, marginBottom: 12, textTransform: 'uppercase' }}>
                                {connection?.DisplayName || platformName} Locations ({displayConnectionLocations.length})
                              </Text>

                              {displayConnectionLocations.map((location) => {
                                const assignedPoolId = locationPoolAssignments[location.platformLocationId] || selectedPool;
                                const assignedPool = pools.find(p => p.id === assignedPoolId);

                                return (
                                  <View
                                    key={location.platformLocationId}
                                    style={{
                                      borderWidth: 1,
                                      borderColor: '#E5E7EB',
                                      borderRadius: 12,
                                      padding: 16,
                                      marginBottom: 10,
                                      backgroundColor: '#fff',
                                    }}
                                  >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                                      <Icon name="map-marker" size={20} color={theme.colors.primary} style={{ marginRight: 8 }} />
                                      <View style={{ flex: 1 }}>
                                        <Text style={{ fontWeight: '600', fontSize: 15, color: theme.colors.text }}>
                                          {location.locationName}
                                        </Text>
                                        {location.timezone && (
                                          <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>
                                            {location.timezone}
                                          </Text>
                                        )}
                                      </View>
                                    </View>

                                    {/* Pool selector for this location */}
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                      {pools.map((pool) => (
                                        <TouchableOpacity
                                          key={pool.id}
                                          style={{
                                            paddingHorizontal: 12,
                                            paddingVertical: 8,
                                            borderRadius: 20,
                                            borderWidth: 1,
                                            borderColor: assignedPoolId === pool.id ? theme.colors.primary : '#D1D5DB',
                                            backgroundColor: assignedPoolId === pool.id ? theme.colors.primary + '15' : '#F9FAFB',
                                          }}
                                          onPress={() => {
                                            setLocationPoolAssignments(prev => ({
                                              ...prev,
                                              [location.platformLocationId]: pool.id,
                                            }));
                                          }}
                                        >
                                          <Text style={{
                                            fontSize: 13,
                                            fontWeight: '600',
                                            color: assignedPoolId === pool.id ? theme.colors.primary : theme.colors.textSecondary
                                          }}>
                                            {pool.name}
                                          </Text>
                                        </TouchableOpacity>
                                      ))}

                                      {/* Create New Pool option */}
                                      <TouchableOpacity
                                        style={{
                                          paddingHorizontal: 12,
                                          paddingVertical: 8,
                                          borderRadius: 20,
                                          borderWidth: 1,
                                          borderStyle: 'dashed',
                                          borderColor: assignedPoolId === 'create-new' ? theme.colors.primary : '#D1D5DB',
                                          backgroundColor: assignedPoolId === 'create-new' ? theme.colors.primary + '15' : 'transparent',
                                          flexDirection: 'row',
                                          alignItems: 'center',
                                          gap: 4,
                                        }}
                                        onPress={() => {
                                          setLocationPoolAssignments(prev => ({
                                            ...prev,
                                            [location.platformLocationId]: 'create-new',
                                          }));
                                          setSelectedPool('create-new');
                                        }}
                                      >
                                        <Icon name="plus" size={14} color={assignedPoolId === 'create-new' ? theme.colors.primary : theme.colors.textSecondary} />
                                        <Text style={{
                                          fontSize: 13,
                                          fontWeight: '600',
                                          color: assignedPoolId === 'create-new' ? theme.colors.primary : theme.colors.textSecondary
                                        }}>
                                          New Pool
                                        </Text>
                                      </TouchableOpacity>
                                    </View>
                                  </View>
                                );
                              })}
                            </View>

                            {/* Create New Pool Name Input - Show when any location assigned to create-new */}
                            {(selectedPool === 'create-new' || Object.values(locationPoolAssignments).includes('create-new')) && (
                              <View style={{
                                marginBottom: 16,
                                padding: 16,
                                backgroundColor: theme.colors.primary + '10',
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: theme.colors.primary + '30',
                              }}>
                                <Text style={{ fontWeight: '600', color: theme.colors.text, marginBottom: 8 }}>
                                  New Pool Name
                                </Text>
                                <TextInput
                                  style={{
                                    borderWidth: 1,
                                    borderColor: '#E5E7EB',
                                    borderRadius: 8,
                                    paddingHorizontal: 16,
                                    paddingVertical: 12,
                                    color: theme.colors.text,
                                    fontSize: 16,
                                    backgroundColor: '#fff'
                                  }}
                                  placeholder="e.g., 'Main Retail', 'Wholesale', 'Markets'"
                                  placeholderTextColor={theme.colors.textSecondary}
                                  value={poolNameInput}
                                  onChangeText={setPoolNameInput}
                                  editable={!isCreatingPool}
                                />
                                <Text style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 8 }}>
                                  {Object.values(locationPoolAssignments).filter(p => p === 'create-new').length} location(s) will be added to this new pool
                                </Text>
                              </View>
                            )}

                            {/* Quick assign all to one pool */}
                            {displayConnectionLocations.length > 1 && pools.length > 0 && (
                              <View style={{ marginBottom: 16 }}>
                                <Text style={{ fontSize: 13, color: theme.colors.textSecondary, marginBottom: 8 }}>
                                  Quick assign all locations:
                                </Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                  <View style={{ flexDirection: 'row', gap: 8 }}>
                                    {pools.map((pool) => (
                                      <TouchableOpacity
                                        key={`quick-${pool.id}`}
                                        style={{
                                          paddingHorizontal: 16,
                                          paddingVertical: 10,
                                          borderRadius: 8,
                                          backgroundColor: '#F3F4F6',
                                          borderWidth: 1,
                                          borderColor: '#E5E7EB',
                                        }}
                                        onPress={() => {
                                          const newAssignments: Record<string, string> = {};
                                          displayConnectionLocations.forEach(loc => {
                                            newAssignments[loc.platformLocationId] = pool.id;
                                          });
                                          setLocationPoolAssignments(newAssignments);
                                          setSelectedPool(pool.id);
                                        }}
                                      >
                                        <Text style={{ fontSize: 13, fontWeight: '600', color: theme.colors.text }}>
                                          All → {pool.name}
                                        </Text>
                                      </TouchableOpacity>
                                    ))}
                                  </View>
                                </ScrollView>
                              </View>
                            )}

                            {/* Note: Navigation uses the arrow buttons below, not a separate Continue button */}
                          </>
                        )}
                      </View>
                    )}

                    {wizardStep === 2 && (
                      <View style={{ paddingTop: 8 }}>
                        <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
                          <TouchableOpacity style={{ flex: 1, flexDirection: "column", gap: 6, alignItems: 'center', borderWidth: 1, borderColor: syncMode === 'auto' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }} onPress={() => setSyncMode('auto')}>

                            <View style={{ marginBottom: 12 }}>
                              <Sparkles width={32} height={32}></Sparkles>
                            </View>
                            <Text style={{ fontWeight: '600', color: theme.colors.text }}>Auto</Text>
                            <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>(timestamp-based)</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={{ flex: 1, flexDirection: "column", gap: 6, alignItems: 'center', borderWidth: 1, borderColor: syncMode === 'manual' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }} onPress={() => setSyncMode('manual')}>
                            <View style={{ marginBottom: 12 }}>
                              <Hammer width={32} height={32}></Hammer>
                            </View>

                            <Text style={{ fontWeight: '600', color: theme.colors.text }}>Manual</Text>
                            <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>(Manual Approval)</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {wizardStep === 3 && (
                      <View style={{ paddingTop: 20 }}>
                        {/*<Text style={{ color: theme.colors.textSecondary, marginBottom: 20, textAlign: 'center' }}>Choose how auction listings behave (FB & Ebay) </Text>*/}
                        <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
                          <TouchableOpacity style={{ flex: 1, flexDirection: "column", gap: 6, alignItems: 'center', borderWidth: 1, borderColor: delistMode === 'auto' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }} onPress={() => setDelistMode('auto')}>
                            <View style={{ marginBottom: 12 }}>
                              <Unlink width={32} height={32}></Unlink>
                            </View>
                            <Text style={{ fontWeight: '600', color: theme.colors.text }}>Auto Delist</Text>
                            <Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginTop: 4 }}>Sold listings are automatically removed</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={{ flex: 1, flexDirection: "column", gap: 6, alignItems: 'center', borderWidth: 1, borderColor: delistMode === 'manual' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }} onPress={() => setDelistMode('manual')}>
                            <View style={{ marginBottom: 12 }}>
                              <Link width={32} height={32}></Link>
                            </View>
                            <Text style={{ fontWeight: '600', color: theme.colors.text }}>Manual Delist</Text>
                            <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>Sold listings stay up</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {wizardStep === 4 && (
                      <View style={{ paddingTop: 20 }}>
                        {/*<Text style={{ color: theme.colors.textSecondary, marginBottom: 20, textAlign: 'center' }}>Adjust prices by % per platform (Optional)</Text>*/}
                        <View style={{ marginBottom: 24 }}>
                          {platformConnections.map((connection) => (
                            <View key={connection.Id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: getPlatformColor(connection.PlatformType), marginRight: 12 }} />
                                <View>
                                  <Text style={{ fontWeight: '600', color: theme.colors.text }}>{connection.DisplayName}</Text>
                                  <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{connection.PlatformType}</Text>
                                </View>
                              </View>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <TouchableOpacity style={{ padding: 8 }} onPress={() => setPriceBuffer(prev => ({ ...prev, [connection.Id]: (prev[connection.Id] || 0) - 1 }))}>
                                  <Icon name="minus" size={18} />
                                </TouchableOpacity>
                                <TextInput
                                  style={{ width: 60, textAlign: 'center', fontWeight: '700', color: theme.colors.text, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 6, paddingVertical: 4 }}
                                  value={`${(priceBuffer[connection.Id] || 0).toFixed(1)}%`}
                                  onChangeText={(text) => {
                                    const numericValue = parseFloat(text.replace('%', '')) || 0;
                                    setPriceBuffer(prev => ({ ...prev, [connection.Id]: numericValue }));
                                  }}
                                  keyboardType="numeric"
                                />
                                <TouchableOpacity style={{ padding: 8 }} onPress={() => setPriceBuffer(prev => ({ ...prev, [connection.Id]: (prev[connection.Id] || 0) + 1 }))}>
                                  <Icon name="plus" size={18} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    {wizardStep === 5 && (
                      <View style={{ paddingTop: 20 }}>
                        <Text style={{ color: theme.colors.textSecondary, marginBottom: 20, textAlign: 'center' }}>Adjust inventory buffer per platform (Optional)</Text>
                        <View style={{ marginBottom: 24 }}>
                          {platformConnections.map((connection) => (
                            <View key={connection.Id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: getPlatformColor(connection.PlatformType), marginRight: 12 }} />
                                <View>
                                  <Text style={{ fontWeight: '600', color: theme.colors.text }}>{connection.DisplayName}</Text>
                                  <Text style={{ fontSize: 12, color: theme.colors.textSecondary }}>{connection.PlatformType}</Text>
                                </View>
                              </View>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                <TouchableOpacity style={{ padding: 8 }} onPress={() =>
                                  setInventoryBuffer(prev => ({ ...prev, [connection.Id]: Math.max(0, (prev[connection.Id] || 0) - 1) }))}>
                                  <Icon name="minus" size={18} />
                                </TouchableOpacity>
                                <TextInput
                                  style={{ width: 60, textAlign: 'center', fontWeight: '700', color: theme.colors.text, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 6, paddingVertical: 4 }}
                                  value={`${(inventoryBuffer[connection.Id] || 0)}`}
                                  onChangeText={(text) => {
                                    const numericValue = parseInt(text) || 0;
                                    setInventoryBuffer(prev => ({ ...prev, [connection.Id]: Math.max(0, numericValue) }));
                                  }}
                                  keyboardType="numeric"
                                  placeholder="0"
                                />
                                <TouchableOpacity style={{ padding: 8 }} onPress={() =>
                                  setInventoryBuffer(prev => ({ ...prev, [connection.Id]: (prev[connection.Id] || 0) + 1 }))}>
                                  <Icon name="plus" size={18} />
                                </TouchableOpacity>
                              </View>
                            </View>
                          ))}
                        </View>
                      </View>
                    )}

                    {wizardStep === 6 && (
                      <View style={{ paddingTop: 20 }}>
                        {/* Dynamic sync action summary */}
                        <View style={{ backgroundColor: '#F0F9EB', borderRadius: 12, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: '#93C822' }}>
                          <Text style={{ fontWeight: '700', color: '#4A6C1C', marginBottom: 8 }}>What will happen:</Text>
                          <Text style={{ color: '#5B8325', fontSize: 14, lineHeight: 22 }}>
                            {productCreationMode === 'sync_everywhere'
                              ? `• Importing ${counts.matched + counts.review} items from ${platformName || 'platform'} → Anorha\n• Creating ${counts.review} new items on Anorha\n• Pushing ${counts.push} Anorha items → ${platformName || 'platform'}\n• All platforms will share the same unified inventory`
                              : productCreationMode === 'pull_only'
                                ? `• Importing ${counts.matched + counts.review} items from ${platformName || 'platform'} → Anorha\n• Creating ${counts.review} new items on Anorha\n• Linking ${counts.matched} existing matches`
                                : productCreationMode === 'push_only'
                                  ? `• Pushing ${counts.push} Anorha items → ${platformName || 'platform'}\n• Linking ${counts.matched} matched items`
                                  : `• Linking ${counts.matched} matched items\n• ${counts.review} items need review`
                            }
                          </Text>
                        </View>
                        <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, marginBottom: 24 }}>
                          <Text style={{ fontWeight: '700', color: theme.colors.text, marginBottom: 8 }}>Items Summary</Text>
                          <Text style={{ color: theme.colors.textSecondary, marginBottom: 16 }}>
                            {counts.matched} matched • {counts.review} new from {platformName || 'platform'} • {counts.push > 0 ? `${counts.push} push to ${platformName || 'platform'} • ` : ''}{counts.ignore} ignored
                          </Text>

                          <Text style={{ fontWeight: '700', color: theme.colors.text, marginBottom: 8 }}>Sync Direction</Text>
                          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 8 }}>
                            {productCreationMode === 'sync_everywhere' && (
                              <>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                  <View style={{ backgroundColor: '#fff', borderRadius: 6, padding: 2, borderWidth: 1.5, borderColor: theme.colors.primary }}>
                                    <RNImage source={AnorhaLogo} style={{ width: 20, height: 20, borderRadius: 4 }} />
                                  </View>
                                  <Icon name="sync" size={14} color={theme.colors.primary} />
                                  <View style={{ backgroundColor: '#fff', borderRadius: 6, padding: 2, borderWidth: 1.5, borderColor: '#E5E7EB' }}>
                                    {platformName?.toLowerCase().includes('square') && <SquareSvg width={20} height={20} />}
                                    {platformName?.toLowerCase().includes('shopify') && <ShopifySvg width={20} height={20} />}
                                    {!platformName?.toLowerCase().match(/square|shopify/) && <Icon name="store" size={20} color="#6B7280" />}
                                  </View>
                                </View>
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>Sync Everywhere</Text>
                              </>
                            )}
                            {productCreationMode === 'pull_only' && (
                              <>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                  <View style={{ backgroundColor: '#fff', borderRadius: 6, padding: 2, borderWidth: 1.5, borderColor: theme.colors.primary }}>
                                    {platformName?.toLowerCase().includes('square') && <SquareSvg width={20} height={20} />}
                                    {platformName?.toLowerCase().includes('shopify') && <ShopifySvg width={20} height={20} />}
                                    {!platformName?.toLowerCase().match(/square|shopify/) && <Icon name="store" size={20} color={theme.colors.primary} />}
                                  </View>
                                  <Icon name="arrow-right" size={14} color={theme.colors.primary} />
                                  <View style={{ backgroundColor: '#fff', borderRadius: 6, padding: 2, borderWidth: 1.5, borderColor: theme.colors.primary }}>
                                    <RNImage source={AnorhaLogo} style={{ width: 20, height: 20, borderRadius: 4 }} />
                                  </View>
                                </View>
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>Import to Anorha</Text>
                              </>
                            )}
                            {productCreationMode === 'push_only' && (
                              <>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                                  <View style={{ backgroundColor: '#fff', borderRadius: 6, padding: 2, borderWidth: 1.5, borderColor: theme.colors.primary }}>
                                    <RNImage source={AnorhaLogo} style={{ width: 20, height: 20, borderRadius: 4 }} />
                                  </View>
                                  <Icon name="arrow-right" size={14} color={theme.colors.primary} />
                                  <View style={{ backgroundColor: '#fff', borderRadius: 6, padding: 2, borderWidth: 1.5, borderColor: theme.colors.primary }}>
                                    {platformName?.toLowerCase().includes('square') && <SquareSvg width={20} height={20} />}
                                    {platformName?.toLowerCase().includes('shopify') && <ShopifySvg width={20} height={20} />}
                                    {!platformName?.toLowerCase().match(/square|shopify/) && <Icon name="store" size={20} color={theme.colors.primary} />}
                                  </View>
                                </View>
                                <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>Push to {platformName}</Text>
                              </>
                            )}
                            {productCreationMode === 'do_nothing' && (
                              <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>Link Only (no new items)</Text>
                            )}
                          </View>

                          <Text style={{ fontWeight: '700', color: theme.colors.text, marginBottom: 8 }}>Selected Platforms</Text>
                          <Text style={{ color: theme.colors.textSecondary, marginBottom: 16 }}>{selectedPlatformsState.join(', ') || 'None'}</Text>

                          <Text style={{ fontWeight: '700', color: theme.colors.text, marginBottom: 8 }}>Sync Settings</Text>
                          <Text style={{ color: theme.colors.textSecondary, marginBottom: 16 }}>Mode: {syncMode === 'auto' ? 'Auto' : 'Manual'} • Delist: {delistMode === 'auto' ? 'Auto' : 'Manual'}</Text>

                          {Object.keys(priceBuffer).length > 0 && (
                            <>
                              <Text style={{ fontWeight: '700', color: theme.colors.text, marginBottom: 8 }}>Price Adjustments</Text>
                              <Text style={{ color: theme.colors.textSecondary }}>
                                {platformConnections
                                  .filter(conn => priceBuffer[conn.Id] !== 0)
                                  .map(conn => `${conn.DisplayName}: ${priceBuffer[conn.Id] > 0 ? '+' : ''}${priceBuffer[conn.Id]}%`)
                                  .join(', ') || 'No adjustments'}
                              </Text>
                            </>
                          )}
                        </View>
                        <View style={{ marginTop: 20 }}>
                          <Button
                            title="Complete Import"
                            loading={isSubmitting}
                            onPress={async () => {
                              setIsSubmitting(true);
                              try {
                                // Get the confirmed mappings from suggestions (all selected items)
                                // Transform to match backend DTO: ConfirmMappingsDto
                                const confirmedMappings = (suggestions || [])
                                  .filter(item => item.isSelected)
                                  .map(item => {
                                    // For anorha_to_platform direction, send 'push' action
                                    let action: string;
                                    if (item.direction === 'anorha_to_platform') {
                                      action = 'push';
                                    } else if (item.action === 'CREATE_NEW') {
                                      action = 'create';
                                    } else if (item.action === 'LINK_EXISTING') {
                                      action = 'link';
                                    } else {
                                      action = 'ignore';
                                    }

                                    return {
                                      platformProductId: item.platformProduct.id,
                                      platformVariantId: item.platformProduct.id, // Same as product ID for now
                                      platformProductSku: item.platformProduct.sku,
                                      platformProductTitle: item.platformProduct.title,
                                      // For push action, sssyncVariantId is the Anorha variant ID to push
                                      sssyncVariantId: item.direction === 'anorha_to_platform'
                                        ? item.anorhaVariant?.id || item.platformProduct.id  // Use anorhaVariant ID for push
                                        : item.suggestedCanonicalProduct?.id || null,
                                      action: action as 'link' | 'create' | 'ignore' | 'push'
                                    };
                                  });

                                console.log('[MappingReview] Confirming mappings:', confirmedMappings.length);

                                // Call the confirm-mappings endpoint (mappings only, no sync rules)
                                const token = await ensureSupabaseJwt();
                                const confirmResponse = await fetch(`https://api.sssync.app/api/sync/connections/${connectionId}/confirm-mappings`, {
                                  method: 'POST',
                                  headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    confirmedMatches: confirmedMappings
                                  })
                                });

                                if (!confirmResponse.ok) {
                                  const error = await confirmResponse.text();
                                  throw new Error(`Failed to confirm mappings: ${error}`);
                                }

                                console.log('[MappingReview] Mappings confirmed, updating quick settings...');

                                // Step 2: Handle Pool Assignments & Quick Settings
                                console.log('[MappingReview] Processing pool assignments...');

                                // 2a. Determine correct pool IDs (handle creation if needed)
                                let mapPoolId = selectedPool;
                                const assignments = { ...locationPoolAssignments };

                                // Check if we need to create a new pool
                                const needsNewPool =
                                  selectedPool === 'create-new' ||
                                  Object.values(assignments).some(id => id === 'create-new');

                                if (needsNewPool && poolNameInput) {
                                  try {
                                    console.log(`[MappingReview] Creating new pool: "${poolNameInput}"`);
                                    const createPoolRes = await fetch(`${SSSYNC_API_BASE_URL}/api/pools`, {
                                      method: 'POST',
                                      headers: {
                                        'Authorization': `Bearer ${token}`,
                                        'Content-Type': 'application/json',
                                      },
                                      body: JSON.stringify({
                                        orgId: 'current', // Backend resolves this from user context or we can pass currentOrg.id
                                        name: poolNameInput,
                                        description: `Created during import from ${platformName}`,
                                        syncInventory: true,
                                        syncPricing: true,
                                        inventoryMode: 'shared'
                                      }),
                                    });

                                    if (!createPoolRes.ok) {
                                      throw new Error(`Failed to create pool: ${createPoolRes.status}`);
                                    }

                                    const newPool = await createPoolRes.json();
                                    console.log('[MappingReview] New pool created:', newPool.id);

                                    // Update our references to use the real ID
                                    if (mapPoolId === 'create-new') {
                                      mapPoolId = newPool.id;
                                    }

                                    // Update any 'create-new' assignments to the new ID
                                    Object.keys(assignments).forEach(locId => {
                                      if (assignments[locId] === 'create-new') {
                                        assignments[locId] = newPool.id;
                                      }
                                    });

                                  } catch (poolErr) {
                                    console.error('[MappingReview] Failed to create new pool:', poolErr);
                                    Alert.alert('Warning', 'Failed to create new pool. Locations may use default pool.');
                                    // Fallback to undefined or existing logic
                                  }
                                }

                                // 2b. Assign locations to their respective pools
                                // Group locations by pool ID
                                const poolToLocations = new Map<string, string[]>();

                                Object.entries(assignments).forEach(([locId, poolId]) => {
                                  if (!poolId || poolId === 'create-new') return; // Skip invalid or unhandled 'create-new'
                                  const list = poolToLocations.get(poolId) || [];
                                  list.push(locId);
                                  poolToLocations.set(poolId, list);
                                });

                                // If user picked a main pool but didn't explicitly map some locations, 
                                // maybe we should map unassigned ones to mapPoolId? 
                                // For now, we only map explicit assignments + selectedPool as global default in quickSettings.

                                // Send assignments to backend
                                for (const [pId, locIds] of poolToLocations.entries()) {
                                  try {
                                    if (locIds.length > 0) {
                                      console.log(`[MappingReview] Assigning ${locIds.length} locations to pool ${pId}`);
                                      await fetch(`${SSSYNC_API_BASE_URL}/api/pools/${pId}/locations`, {
                                        method: 'POST',
                                        headers: {
                                          'Authorization': `Bearer ${token}`,
                                          'Content-Type': 'application/json',
                                        },
                                        body: JSON.stringify({ location_ids: locIds }),
                                      });
                                    }
                                  } catch (assignErr) {
                                    console.error(`[MappingReview] Failed to assign locations to pool ${pId}:`, assignErr);
                                    // Don't block flow, just log
                                  }
                                }

                                // Step 3: Update quick settings with wizard selections
                                // CRITICAL: Include propagateCreates and propagateChanges to enable cross-platform sync
                                // productCreationMode controls whether products sync to other platforms:
                                // - sync_everywhere: Products sync bidirectionally to ALL platforms
                                // - push_only: Anorha items push TO this platform (propagateCreates = true)
                                // - pull_only: Import from platform TO Anorha only (propagateCreates = false)
                                // - do_nothing: No automatic product creation (propagateCreates = false)
                                const shouldPropagateCreates =
                                  productCreationMode === 'sync_everywhere' ||
                                  productCreationMode === 'push_only';

                                const quickSettings = {
                                  poolId: mapPoolId || undefined, // Use resolved ID (real existing or newly created)
                                  autoSyncMode: syncMode === 'auto',
                                  autoDelist: delistMode === 'auto',
                                  priceAdjustment: priceBuffer,
                                  inventoryBuffer: inventoryBuffer,
                                  // Cross-platform product propagation based on wizard Step 0 choice
                                  syncRules: {
                                    propagateCreates: shouldPropagateCreates,  // Create products on other platforms
                                    propagateUpdates: true,  // Sync updates to other platforms
                                    propagateDeletes: false, // Don't auto-delete (safer default)
                                    propagateInventory: true, // Sync inventory changes
                                    syncInventory: true,
                                    syncPricing: true,
                                    productCreationMode: productCreationMode, // Store the raw choice for reference
                                  }
                                };

                                const settingsResponse = await fetch(`https://api.sssync.app/api/connections/${connectionId}/quick-settings`, {
                                  method: 'PUT',
                                  headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify(quickSettings)
                                });

                                if (!settingsResponse.ok) {
                                  const error = await settingsResponse.text();
                                  throw new Error(`Failed to update quick settings: ${error}`);
                                }

                                console.log('[MappingReview] Quick settings updated, activating sync...');

                                // Step 3: Activate the sync
                                const syncResponse = await fetch(`https://api.sssync.app/api/sync/connections/${connectionId}/activate-sync`, {
                                  method: 'POST',
                                  headers: {
                                    'Authorization': `Bearer ${token}`,
                                    'Content-Type': 'application/json',
                                  }
                                });

                                if (!syncResponse.ok) {
                                  const error = await syncResponse.text();
                                  throw new Error(`Failed to activate sync: ${error}`);
                                }

                                const { jobId } = await syncResponse.json();
                                console.log('[MappingReview] Sync activated with job ID:', jobId);

                                // Close wizard and navigate to confirmation
                                setWizardVisible(false);
                                navigation.navigate('PublishConfirmation', {
                                  platforms: selectedPlatformsState,
                                  priceBuffer,
                                  syncMode,
                                  delistMode,
                                  jobId,
                                  origin: 'import'
                                } as any);
                              } catch (error: any) {
                                console.error('[MappingReview] Error completing import:', error);
                                Alert.alert('Import Error', error.message || 'Failed to complete import. Please try again.');
                              } finally {
                                setIsSubmitting(false);
                              }
                            }}
                          />
                        </View>
                      </View>
                    )}

                    {/* Nav controls - only show for steps 1-6 */}
                    {wizardStep > 0 && (
                      <>
                        <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 20, marginBottom: 8 }}>
                          {wizardStep === 1 && 'Pool Assignment'}
                          {wizardStep === 2 && 'Auto/Manual Sync'}
                          {wizardStep === 3 && 'Auto Delist'}
                          {wizardStep === 4 && 'Price Buffer'}
                          {wizardStep === 5 && 'Inventory Buffer'}
                          {wizardStep === 6 && 'Review'}
                        </Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, paddingHorizontal: 30 }}>
                          {/* Large Back Button */}
                          <TouchableOpacity
                            onPress={async () => {
                              if (wizardStep === 1) {
                                // If going back from step 1 (pool), go to step 0 (product creation mode)
                                setWizardStep(0);
                              } else {
                                setWizardStep((s) => Math.max(1, s - 1));
                              }
                            }}
                            style={{
                              width: 60,
                              height: 60,
                              borderRadius: 12,
                              backgroundColor: '#9CA3AF',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Icon name="chevron-left" size={28} color="#fff" />
                          </TouchableOpacity>

                          {/* Dots indicator */}
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            {[0, 1, 2, 3, 4, 5, 6].map(i => (
                              <View
                                key={`dot-${i}`}
                                style={{
                                  width: 10,
                                  height: 10,
                                  borderRadius: 5,
                                  backgroundColor: i === wizardStep ? theme.colors.primary : '#E5E7EB'
                                }}
                              />
                            ))}
                          </View>

                          {/* Large Next Button */}
                          <TouchableOpacity
                            disabled={wizardStep === 6 || (wizardStep === 1 && Object.values(locationPoolAssignments).includes('create-new') && !poolNameInput.trim())}
                            onPress={async () => {
                              // Handle pool creation when on step 1 and creating new pool
                              if (wizardStep === 1 && Object.values(locationPoolAssignments).includes('create-new')) {
                                if (!poolNameInput.trim()) {
                                  Alert.alert('Error', 'Please enter a name for the new pool');
                                  return;
                                }
                                await handleCreatePool();
                              } else if (wizardStep === 1) {
                                // Add locations to selected existing pool(s)
                                const poolLocationMap: Record<string, string[]> = {};
                                Object.entries(locationPoolAssignments).forEach(([locId, poolId]) => {
                                  if (!poolLocationMap[poolId]) poolLocationMap[poolId] = [];
                                  poolLocationMap[poolId].push(locId);
                                });

                                // Update each pool with its assigned locations
                                const token = await ensureSupabaseJwt();
                                for (const [poolId, locationIds] of Object.entries(poolLocationMap)) {
                                  try {
                                    await fetch(`https://api.sssync.app/api/pools/${poolId}/locations`, {
                                      method: 'POST',
                                      headers: {
                                        'Authorization': `Bearer ${token}`,
                                        'Content-Type': 'application/json',
                                      },
                                      body: JSON.stringify({ location_ids: locationIds }),
                                    });
                                    console.log(`[MappingReviewScreen] Added ${locationIds.length} locations to pool ${poolId}`);
                                  } catch (e) {
                                    console.error(`[MappingReviewScreen] Failed to add locations to pool ${poolId}:`, e);
                                  }
                                }
                                setWizardStep(2);
                              } else {
                                setWizardStep((s) => Math.min(6, s + 1));
                              }
                            }}
                            style={{
                              width: 60,
                              height: 60,
                              borderRadius: 12,
                              backgroundColor: (wizardStep === 6 || (wizardStep === 1 && selectedPool === 'create-new' && !poolNameInput.trim())) ? '#D1D5DB' : theme.colors.primary,
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Icon name="chevron-right" size={28} color="#fff" />
                          </TouchableOpacity>
                        </View>
                      </>
                    )}

                  </View>
                </ScrollView>
              </KeyboardAvoidingView>
            </View>
          </Modal>
        </>
      )}

      {/* Barcode Scanner Modal */}
      {
        showBarcodeScanner && (
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
    </View>
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
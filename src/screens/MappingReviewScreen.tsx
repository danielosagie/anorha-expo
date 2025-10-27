import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Alert, TouchableOpacity, Modal, Pressable, FlatList, TextInput } from 'react-native';
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
import { LegendStateObservables, PlatformConnection } from '../utils/SupaLegend';
import { useSyncProgress } from '../hooks/useSyncProgress';
import Animated, { FadeInUp, Layout } from 'react-native-reanimated';
import * as Progress from 'react-native-progress';
import PlaceholderImage from '../components/PlaceholderImage';
import PillTabs from '../components/ui/PillTabs';
import SearchBar from '../components/ui/SearchBar';
import MappingCard from '../components/mapping/MappingCard';
import BottomActionBar from '../components/BottomActionBar';
import { tokens } from '../design/tokens';
import ShopifySvg from '../assets/shopify.svg';
import SquareSvg from '../assets/square.svg';
import CloverSvg from '../assets/clover.svg';
import EbaySvg from '../assets/ebay.svg';
import FacebookSvg from '../assets/facebook.svg';
import AmazonSvg from '../assets/amazon.svg';


interface MappingSuggestion {
  action: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE';
  platformProduct: {
    id: string;         // e.g., "gid://shopify/ProductVariant/12345"
    sku: string;
    title: string;
    price: number;
    imageUrl: string | null;
  };
  suggestedCanonicalProduct: {
    id: string | null;  // will be null for CREATE_NEW
    sku: string;
    title: string;
    imageUrl?: string | null;
  } | null;
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
  prevAction?: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE';
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
    } catch {}
    await new Promise(r => setTimeout(r, stepMs));
  }
  return null;
};

// Optional: ensure bridge is configured if needed
const ensureBridge = async (getClerkToken: () => Promise<string | null>) => {
  try {
    await configureClerkSupabaseBridge({ getClerkToken, autoRefreshMinutes: 9 });
  } catch {}
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
  const { connectionId, platformName, jobId } = route.params;
  const legendState: LegendStateObservables | null = useLegendState();

  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | null>(null);
  // Persist review progress
  const [hasLoadedDraft, setHasLoadedDraft] = useState(false);
  const [loading, setLoading] = useState(true);
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
  const [currentJobId, setCurrentJobId] = useState<string | undefined>(jobId);
  const [isPolling, setIsPolling] = useState(!!jobId); // Keep for compatibility
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
  const [sortBy, setSortBy] = useState<'title' | 'sku'>('title');
  // NEW: Scan summary
  const [scanSummary, setScanSummary] = useState<{ countProducts?: number; countVariants?: number; countLocations?: number } | null>(null);
  // Inline bottom-sheet wizard state
  const [wizardVisible, setWizardVisible] = useState(false);
  const [wizardStep, setWizardStep] = useState(0); // 0 platforms, 1 sync mode, 2 delist, 3 buffer, 4 review
  const [selectedPlatformsState, setSelectedPlatformsState] = useState<string[]>([]);
  // New: inventory merge mode selection
  const [inventoryMergeMode, setInventoryMergeMode] = useState<'merged' | 'separate' | null>('merged');
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

  // Effect to load platform connections
  useEffect(() => {
    const loadConnections = async () => {
      if (legendState?.userId) {
        try {
          const { data, error } = await supabase
            .from('PlatformConnections')
            .select('*')
            .eq('UserId', legendState.userId)
            .eq('IsEnabled', true);

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
    console.log(`[MappingReviewScreen] Fetching suggestions for connection: ${currentConnectionId}`);
    setLoading(true);
    setError(null);
    setSuggestions(null); // Clear previous suggestions
    setSummaryData(null); // Clear previous summary

    try {
      // Ensure the bridge has created/attached a Supabase JWT
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error("Authentication token not found. Please log in again.");

      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${currentConnectionId}/mapping-suggestions`, {
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
          let action: 'CREATE_NEW' | 'LINK_EXISTING' | 'IGNORE';
          let isSelected = true;
          
          if (item.matchType === 'NONE' || item.confidence === 0) {
            // No match found - these are new products to create
            action = 'CREATE_NEW';
            isSelected = true;
          } else if ((item.matchType === 'SKU' || item.matchType === 'BARCODE') && item.suggestedCanonicalVariant) {
            // Perfect match found - link to existing product
            action = 'LINK_EXISTING';
            isSelected = true;
          } else if (item.confidence > 0 && item.confidence < 0.8) {
            // Low confidence match - needs review, default to create for now
            action = 'CREATE_NEW';
            isSelected = true;
          } else {
            // Default to create new for anything else
            action = 'CREATE_NEW';
            isSelected = true;
          }

          return {
            action,
            platformProduct: {
              id: item.platformProduct.id,
              sku: item.platformProduct.sku || '', // Ensure SKU is not null
              title: item.platformProduct.title,
              price: item.platformProduct.price ? parseFloat(String(item.platformProduct.price)) : 0,
              imageUrl: item.platformProduct.imageUrl,
            },
            suggestedCanonicalProduct: item.suggestedCanonicalVariant ? {
              id: item.suggestedCanonicalVariant.Id,
              sku: item.suggestedCanonicalVariant.Sku,
              title: item.suggestedCanonicalVariant.Title,
            } : null,
            isSelected,
            matchType: item.matchType,
            confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
          };
        });
        console.log(`[MappingReviewScreen] Processed ${suggestionsArray.length} suggestions from array response`);
      } else if (data && typeof data === 'object') {
        // Legacy format with separate arrays for different suggestion types
        const perfectMatches = Array.isArray(data.perfectMatches) ? data.perfectMatches : [];
        const newFromPlatform = Array.isArray(data.newFromPlatform) ? data.newFromPlatform : [];
        const needsReview = Array.isArray(data.needsReview) ? data.needsReview : [];
        
        // Combine all suggestion types into a single array for our UI
        suggestionsArray = [
          ...perfectMatches.map((item: any) => ({ ...item, action: 'LINK_EXISTING', isSelected: true })),
          ...newFromPlatform.map((item: any) => ({ ...item, action: 'CREATE_NEW', isSelected: true })),
          ...needsReview.map((item: any) => ({ ...item, action: 'IGNORE', isSelected: false }))
        ];
        
        // Keep the summary data for backward compatibility
        setSummaryData(data.summary || null);
        console.log(`[MappingReviewScreen] Processed legacy format: ${perfectMatches.length} matches, ${newFromPlatform.length} new, ${needsReview.length} review`);
      }

      // Set the processed suggestions
      setSuggestions(suggestionsArray);
      // Fetch scan summary for header counts
      try {
        const token2 = await ensureSupabaseJwt();
        if (token2) {
          const sumResp = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${currentConnectionId}/scan-summary`, { headers: { 'Authorization': `Bearer ${token2}` } });
          if (sumResp.ok) setScanSummary(await sumResp.json());
        }
      } catch {}
      
      // Add detailed logging for debugging empty suggestions
      console.log(`[MappingReviewScreen] Final suggestions count: ${suggestionsArray.length}`);
      if (suggestionsArray.length === 0) {
        console.log('[MappingReviewScreen] No mapping suggestions found. Checking connection status...');
        
        // Check connection status to understand why no suggestions
        try {
          const connectionResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/platform-connections/${currentConnectionId}`, {
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
        await fetchExistingMappingsFromSupabase(currentConnectionId);
      } else {
        console.log(`[MappingReviewScreen] Successfully loaded ${suggestionsArray.length} suggestions:`, 
          suggestionsArray.map(s => ({ action: s.action, title: s.platformProduct.title })));
      }
      
    } catch (err: any) {
      console.error('[MappingReviewScreen] Error fetching mapping suggestions:', err);
      setError(err.message || 'An unexpected error occurred.');
      
      // If there was an error fetching suggestions, try to get existing mappings as fallback
      console.log('[MappingReviewScreen] Error fetching suggestions, trying to get existing mappings as fallback...');
      await fetchExistingMappingsFromSupabase(currentConnectionId);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load any saved draft selections on mount/when connection changes
  useEffect(() => {
    (async () => {
      if (!connectionId || hasLoadedDraft) return;
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
      } catch {}
      setHasLoadedDraft(true);
    })();
  }, [connectionId, suggestions, hasLoadedDraft]);

  // Debounced autosave of current review selections as draft
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        if (!connectionId || !Array.isArray(suggestions)) return;
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
      } catch {}
    }, 600);
    return () => clearTimeout(handle);
  }, [suggestions, connectionId]);

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
    console.log(`[MappingReviewScreen] Effect triggered - isPolling: ${isPolling}, connectionId: ${connectionId}, jobId: ${jobId}`);
    
    // If not polling, fetch suggestions immediately (legacy or post-polling behavior)
    if (!isPolling && connectionId) {
      console.log(`[MappingReviewScreen] Not polling, fetching suggestions directly for connection: ${connectionId}`);
      fetchMappingSuggestions(connectionId);
    } else if (!connectionId) {
      console.error(`[MappingReviewScreen] No connection ID provided`);
      setError("Connection ID is missing.");
      setLoading(false);
    } else {
      console.log(`[MappingReviewScreen] Polling mode active for job: ${currentJobId}`);
    }
  }, [connectionId, isPolling]); // Removed fetchMappingSuggestions to prevent circular dependency

  // --- WebSocket sync progress handling ---
  useEffect(() => {
    if (syncProgress) {
      console.log('[MappingReviewScreen] Received sync progress:', syncProgress);
      
      if (syncProgress.status === 'active') {
        console.log('[MappingReviewScreen] Sync completed successfully');
        setLoading(false);
        // Navigate to success screen or refresh data
        fetchMappingSuggestions(connectionId);
      } else if (syncProgress.status === 'error') {
        console.log('[MappingReviewScreen] Sync failed');
        setLoading(false);
        setError(`Sync failed: ${syncProgress.description}`);
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
   * Handles confirming individual item mappings
   */
  const handleConfirmMappings = async (mappingsToConfirm: any) => { // Type this based on actual payload
    console.log("[MappingReviewScreen] Confirming mappings:", mappingsToConfirm);
    setLoading(true);
    setError(null);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error("Authentication token not found.");

      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/confirm-mappings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mappings: mappingsToConfirm }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to confirm mappings. Status: ${response.status}`);
      }
      Alert.alert("Mappings Confirmed", "Selected mappings have been submitted successfully.");
      // Optionally, refresh suggestions or navigate away
      fetchMappingSuggestions(connectionId);
    } catch (err: any) {
      console.error("[MappingReviewScreen] Error confirming mappings:", err);
      setError(err.message || "An unexpected error occurred while confirming mappings.");
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
      
      // Step 1: Confirm all mappings
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
      
      // Step 2: Activate the sync with sync rules
      const syncRules = {
        syncDirection,
        sourceOfTruth,
        autoCreate,
        autoUpdate,
        syncInventory,
        syncPricing,
      };
      
      const activateResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/activate-sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ syncRules }),
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

  const updateSuggestionAction = (platformProductId: string, newAction: 'LINK_EXISTING' | 'CREATE_NEW' | 'IGNORE') => {
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
    const review = Math.max(0, list.length - matched - ignore);
    return { matched, review, ignore } as any;
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

  // Item renderer (memoized)
  const renderMappingItem = useCallback(({ item }: { item: MappingSuggestion }) => {
    const isReview = (item.confidence != null && item.confidence > 0 && item.confidence < 0.8) || item.matchType === 'TITLE';
    const variant = item.action === 'IGNORE' ? 'ignored' : (item.action === 'LINK_EXISTING' ? 'matched' : (isReview ? 'review' : 'new'));
    return (
      <MappingCard
        variant={variant as any}
        titleLeft={item.platformProduct.title}
        skuLeft={item.platformProduct.sku}
        priceLeft={item.platformProduct.price}
        imageLeft={item.platformProduct.imageUrl}
        titleRight={item.suggestedCanonicalProduct?.title || undefined}
        skuRight={item.suggestedCanonicalProduct?.sku || undefined}
        imageRight={item.suggestedCanonicalProduct?.imageUrl || undefined}
        selected={item.isSelected}
        onSelect={() => setSuggestions(prev => (prev || []).map(s => s.platformProduct.id === item.platformProduct.id ? { ...s, isSelected: !s.isSelected, action: (!s.isSelected && s.action === 'IGNORE') ? 'CREATE_NEW' : s.action } : s))}
        onIgnore={() => {
          // From matched -> send to review and clear resolved flag; otherwise -> move to ignored
          setSuggestions(prev => (prev || []).map(s => {
            if (s.platformProduct.id !== item.platformProduct.id) return s;
            if (activeTab === 'matched') {
              return { ...s, action: 'CREATE_NEW', matchType: 'TITLE', isSelected: true, resolved: false };
            }
            return { ...s, prevTab: activeTab, prevAction: s.action, action: 'IGNORE', isSelected: false, resolved: false };
          }));
        }}
        onRestore={() => {
          setSuggestions(prev => (prev || []).map(s => s.platformProduct.id === item.platformProduct.id ? { ...s, action: s.prevAction || 'CREATE_NEW', isSelected: true } : s));
        }}
        onCreate={() => {
          setSuggestions(prev => (prev || []).map(s => s.platformProduct.id === item.platformProduct.id ? { ...s, action: 'CREATE_NEW', resolved: true, isSelected: true } : s));
        }}
        onApproveMatch={() => {
          setSuggestions(prev => (prev || []).map(s => s.platformProduct.id === item.platformProduct.id ? { ...s, action: 'LINK_EXISTING', resolved: true, isSelected: true } : s));
        }}
        onLink={() => setShowSearchResults(true)}
        onSearch={() => {
          setShowSearchResults(true); // keep open; do not clear immediately
          setSearchQuery('');
          (global as any).currentPlatformProduct = item.platformProduct;
        }}
      />
    );
  }, [updateSuggestionAction]);
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

        <Icon name="arrow-right-thin" size={24} color={theme.colors.textSecondary} style={{ marginHorizontal: 8 }}/>

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
              isSelected && {color: theme.colors.primary}
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
        .or(`Sku.ilike.%${query}%,Title.ilike.%${query}%,Barcode.ilike.%${query}%`)
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
      marginBottom:15,
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
      borderBottomWidth: 1,
      borderBottomColor: '#ddd', 
      backgroundColor: theme.colors.surface, 
      gap: 10,
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
      minHeight: "25%",
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      backgroundColor: theme.colors.surface,
      borderWidth: 2,
      borderColor: theme.colors.textSecondary,
      borderRadius: 12,
    },
    emptyStateIcon: {
      marginBottom: 10,
    },
    emptyStateTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.colors.text,
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

  if (loading && isPolling) {
    const progressValue = jobProgress?.progress || 0;
    const progressPercent = Math.round(progressValue * 100);
    const isStalled = jobProgress && !jobProgress.isActive && !jobProgress.isCompleted && !jobProgress.isFailed;

    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <View style={styles.centered}>
          <Text style={styles.progressMainTitle}>Analyzing Your Products</Text>
          <Text style={styles.progressDescription}>
            {jobProgress?.description || `Connecting to ${platformName}...`}
          </Text>
          
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
              {jobProgress?.total != null && (
                <Text style={styles.progressCountText}>
                  {`${jobProgress.processed || 0} / ${jobProgress.total} items`}
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
            <View style={styles.activityListItem}>
              <Icon name="check-circle" size={16} color={theme.colors.success} />
              <Text style={styles.activityListItemText}>Connection established</Text>
            </View>
            <View style={styles.activityListItem}>
              <Icon name={progressValue > 0.1 ? "check-circle" : "sync"} size={16} color={progressValue > 0.1 ? theme.colors.success : theme.colors.textSecondary} />
              <Text style={styles.activityListItemText}>Fetching product list...</Text>
            </View>
            <View style={styles.activityListItem}>
              <Icon name={progressValue > 0.5 ? "check-circle" : "sync"} size={16} color={progressValue > 0.5 ? theme.colors.success : theme.colors.textSecondary} />
              <Text style={styles.activityListItemText}>Analyzing for matches...</Text>
            </View>
            <View style={styles.activityListItem}>
              <Icon name={progressValue === 1 ? "check-circle" : "sync"} size={16} color={progressValue === 1 ? theme.colors.success : theme.colors.textSecondary} />
              <Text style={styles.activityListItemText}>Finalizing suggestions...</Text>
            </View>
          </View>

          <Text style={[styles.loadingText, { marginTop: 20, textAlign: 'center' }]}>
            This usually takes 1-2 minutes depending on your store size.
          </Text>
          
          {/* Debug information in development */}
          {__DEV__ && (
            <View style={styles.debugInfo}>
              <Text style={styles.debugText}>Debug Info:</Text>
              <Text style={styles.debugText}>Job ID: {currentJobId}</Text>
              <Text style={styles.debugText}>Connection: {connectionId}</Text>
              <Text style={styles.debugText}>Platform: {platformName}</Text>
              <Text style={styles.debugText}>Is Active: {jobProgress?.isActive ? 'Yes' : 'No'}</Text>
              <Text style={styles.debugText}>Is Completed: {jobProgress?.isCompleted ? 'Yes' : 'No'}</Text>
              <Text style={styles.debugText}>Is Failed: {jobProgress?.isFailed ? 'Yes' : 'No'}</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.text }]}>Loading {platformName} Suggestions...</Text>
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

  // --- MODIFIED: Show empty state only if both API suggestions and existing mappings are empty ---
  if ((!suggestions || (Array.isArray(suggestions) && suggestions.length === 0)) && existingMappings.length === 0 && !loadingExistingMappings) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Icon name="information-outline" size={48} color={theme.colors.textSecondary} />
        <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
          No mapping suggestions found for {platformName}.
        </Text>
        <Button title="Refresh" onPress={() => fetchMappingSuggestions(connectionId)} />
      </View>
    );
  }
  
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

          <SearchBar value={listQuery} onChangeText={setListQuery} placeholder={`Search this ${platformName} account's products`} />

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 12, marginTop: 4, }}>
            {activeTab === 'matched' && (
               <Text style={{fontWeight: "600", color: theme.colors.textSecondary}}>
                Review Instant Matches
              </Text>
            )}
            {activeTab === 'review' && (
              <Text style={{fontWeight: "600", color: theme.colors.textSecondary}}>
                Verify & Review
              </Text>
            )}
            {activeTab === 'ignore' && (
              <Text style={{fontWeight: "600", color: theme.colors.textSecondary}}>
                Ignoring These Products
              </Text>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8}}>
              {activeTab === 'review' && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', backgroundColor:"rgb(94, 41, 11, .8)", alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgb(94, 41, 11)', borderRadius: 8 }}
                  onPress={() => {
                    setSuggestions(prev => (prev || []).map(s => {
                      const isReview = s.action !== 'LINK_EXISTING' && s.action !== 'IGNORE' && !s.resolved;
                      if (isReview && s.suggestedCanonicalProduct?.id) {
                        return { ...s, action: 'LINK_EXISTING', resolved: true, isSelected: true };
                      }
                      return s;
                    }));
                  }}
                >
                  <Icon name="check-all" size={18} color="#FFF" />
                  <Text style={{ marginLeft: 6, color: '#FFF', fontWeight: '700' }}>Approve All</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8 }} onPress={() => setSortBy(sortBy === 'title' ? 'sku' : 'title')} accessibilityLabel="Sort by">
              <Icon name="sort" size={18} color={theme.colors.textSecondary} />
              <Text style={{ marginLeft: 6, color: theme.colors.textSecondary, fontWeight: '600' }}>Sort By: {sortBy === 'title' ? 'Title' : 'SKU'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={currentList}
            keyExtractor={(it) => it.platformProduct.id}
            renderItem={({ item }) => (
              <MappingCard
                variant={(item.action === 'IGNORE' ? 'ignored' : (item.action === 'LINK_EXISTING' ? 'matched' : ((item.confidence != null && item.confidence > 0 && item.confidence < 0.8) || item.matchType === 'TITLE') ? 'review' : 'new')) as any}
                titleLeft={item.platformProduct.title}
                skuLeft={item.platformProduct.sku}
                priceLeft={item.platformProduct.price}
                imageLeft={item.platformProduct.imageUrl}
                titleRight={item.suggestedCanonicalProduct?.title || undefined}
                skuRight={item.suggestedCanonicalProduct?.sku || undefined}
                imageRight={item.suggestedCanonicalProduct?.imageUrl || undefined}
                selected={item.isSelected}
                isResolvedNew={item.action === 'CREATE_NEW' && !!item.resolved}
                onEditNew={() => setSuggestions(prev => (prev || []).map(s => s.platformProduct.id === item.platformProduct.id ? { ...s, resolved: false } : s))}
                onSelect={() => setSuggestions(prev => (prev || []).map(s => s.platformProduct.id === item.platformProduct.id ? { ...s, isSelected: !s.isSelected, action: (!s.isSelected && s.action === 'IGNORE') ? 'CREATE_NEW' : s.action } : s))}
                onIgnore={() => {
                  setSuggestions(prev => (prev || []).map(s => {
                    if (s.platformProduct.id !== item.platformProduct.id) return s;
                    if (activeTab === 'matched' || (s.action === 'CREATE_NEW' && s.resolved)) {
                      return { ...s, action: 'CREATE_NEW', matchType: 'TITLE', isSelected: true, resolved: false };
                    }
                    return { ...s, prevTab: activeTab, prevAction: s.action, action: 'IGNORE', isSelected: false, resolved: false };
                  }));
                }}
                onRestore={() => setSuggestions(prev => (prev || []).map(s => s.platformProduct.id === item.platformProduct.id ? { ...s, action: s.prevAction || 'CREATE_NEW', isSelected: true } : s))}
                onCreate={() => setSuggestions(prev => (prev || []).map(s => s.platformProduct.id === item.platformProduct.id ? { ...s, action: 'CREATE_NEW', isSelected: true, resolved: true } : s))}
                onApproveMatch={() => setSuggestions(prev => (prev || []).map(s => s.platformProduct.id === item.platformProduct.id ? { ...s, action: 'LINK_EXISTING', resolved: true, isSelected: true } : s))}
                onSearch={() => { setShowSearchResults(true); setSearchQuery(''); (global as any).currentPlatformProduct = item.platformProduct; }}
              />
            )}
            contentContainerStyle={{ paddingHorizontal: 15, paddingBottom: 120 }}
            initialNumToRender={10}
            windowSize={10}
            maxToRenderPerBatch={12}
            removeClippedSubviews
            pagingEnabled={false}
            ListEmptyComponent={(
              <View style={styles.modernEmptyState}>
                <View style={styles.emptyStateIcon}>
                  <Icon name={listQuery ? 'magnify' : 'package-variant-closed'} size={48} color={theme.colors.textSecondary} />
                </View>
                <Text style={styles.emptyStateTitle}>{listQuery ? 'No matching products' : 'No items in this category'}</Text>
                <Text style={styles.emptyStateDescription}>{listQuery ? 'Try adjusting your search terms' : 'Items will appear after processing'}</Text>
              </View>
            )}
            onEndReachedThreshold={0.6}
            onEndReached={() => {
              // Simple client-side pagination: load more from suggestions if we later support server paging
            }}
          />

          <BottomActionBar
            primaryLabel={`Confirm Mapping (${(suggestions || []).filter(s => s.isSelected).length})`}
            onPrimary={() => setWizardVisible(true)}
            primaryDisabled={(suggestions || []).filter(s => s.isSelected).length === 0}
            secondaryLabel="Cancel import"
            secondaryDisabled={false}
            onSecondary={() => navigation.goBack()}
          />

          {/* Inline Bottom-Sheet Wizard */}
          <Modal visible={wizardVisible} transparent animationType="fade" onRequestClose={() => setWizardVisible(false)}>
            <View style={{ flex: 1, justifyContent: 'flex-end',  backgroundColor: 'rgba(0, 0, 0, 0.7)' }}>
              <Pressable style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0)' }} onPress={() => setWizardVisible(false)} />
              <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, paddingBottom: 32, }}>
                {/* Stepper header aligning to mock */}
                <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E5E5E5', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '700', color: theme.colors.text, fontSize: 18 }}>{
                  wizardStep===0?'Inventory: Merge or Keep Separate?':wizardStep===1?'Set Sync Settings':wizardStep===2?'Set Sync Settings':wizardStep===3?'Set Sync Settings':wizardStep===4?'Set Sync Settings':'Is This Right?'}</Text>
                </View>

                {/* Steps */}
                {wizardStep === 0 && (
                  <View style={{ paddingHorizontal: 0, paddingTop: 20 }}>
                    <Text style={{ color: theme.colors.textSecondary, marginBottom: 16, textAlign: 'center' }}>
                      How should we handle your existing inventory?
                    </Text>

                    {/* Option: Pool Inventory - Merge */}
                    <TouchableOpacity 
                      style={{ 
                        borderWidth: 2, 
                        borderColor: inventoryMergeMode === 'merged' ? theme.colors.primary : '#E5E5E5', 
                        borderRadius: 12, 
                        padding: 20, 
                        marginBottom: 16,
                        backgroundColor: inventoryMergeMode === 'merged' ? '#F0F9FF' : '#fff'
                      }}
                      onPress={() => setInventoryMergeMode('merged')}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                        <View style={{ 
                          width: 20, height: 20, borderRadius: 10, borderWidth: 2, 
                          borderColor: inventoryMergeMode === 'merged' ? theme.colors.primary : '#E5E5E5',
                          backgroundColor: inventoryMergeMode === 'merged' ? theme.colors.primary : 'transparent',
                          marginRight: 12
                        }} />
                        <Text style={{ fontWeight: '700', color: theme.colors.text, fontSize: 16 }}>
                          Pool Inventory - Merge Existing Inventory (Recommended)
                        </Text>
                      </View>
                      <Text style={{ color: theme.colors.textSecondary, marginLeft: 32, marginBottom: 8 }}>
                        Match products across platforms by SKU/barcode/title
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, marginLeft: 32, marginBottom: 8 }}>
                        Keep your existing platform listings intact
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, marginLeft: 32, fontSize: 12, fontStyle: 'italic' }}>
                        (Use when you have established stores)
                      </Text>
                    </TouchableOpacity>

                    {/* Option: Keep Separate */}
                    <TouchableOpacity 
                      style={{ 
                        borderWidth: 2, 
                        borderColor: inventoryMergeMode === 'separate' ? theme.colors.primary : '#E5E5E5', 
                        borderRadius: 12, 
                        padding: 20,
                        backgroundColor: inventoryMergeMode === 'separate' ? '#F0F9FF' : '#fff'
                      }}
                      onPress={() => setInventoryMergeMode('separate')}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                        <View style={{ 
                          width: 20, height: 20, borderRadius: 10, borderWidth: 2, 
                          borderColor: inventoryMergeMode === 'separate' ? theme.colors.primary : '#E5E5E5',
                          backgroundColor: inventoryMergeMode === 'separate' ? theme.colors.primary : 'transparent',
                          marginRight: 12
                        }} />
                        <Text style={{ fontWeight: '700', color: theme.colors.text, fontSize: 16 }}>
                          Keep Separate - Platform-Specific
                        </Text>
                      </View>
                      <Text style={{ color: theme.colors.textSecondary, marginLeft: 32, marginBottom: 8 }}>
                        Keep each platform's inventory completely separate
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, marginLeft: 32, marginBottom: 8 }}>
                        Products won't sync between platforms
                      </Text>
                      <Text style={{ color: theme.colors.textSecondary, marginLeft: 32, fontSize: 12, fontStyle: 'italic' }}>
                        (Use when selling different items on each platform)
                      </Text>
                    </TouchableOpacity>

                    <View style={{ marginTop: 20 }}>
                      <Button title="Continue" onPress={() => setWizardStep(1)} disabled={!inventoryMergeMode} />
                    </View>
                  </View>
                )}

                {wizardStep === 1 && (
                  <View style={{ paddingTop: 20 }}>
                    <Text style={{ color: theme.colors.textSecondary, marginBottom: 20, textAlign: 'center' }}>Sync updates automatically or only on approval</Text>
                    <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
                      <TouchableOpacity style={{ flex: 1, flexDirection: "column", gap: 6, alignItems: 'center', borderWidth: 1, borderColor: syncMode === 'auto' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }} onPress={() => setSyncMode('auto')}>
                        
                        <View style={{marginBottom: 12}}>
                          <Sparkles width={32} height={32}></Sparkles>
                        </View>
                        <Text style={{ fontWeight: '600', color: theme.colors.text }}>Auto</Text>
                        <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>(timestamp-based)</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={{ flex: 1,flexDirection: "column", gap: 6, alignItems: 'center', borderWidth: 1, borderColor: syncMode === 'manual' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }} onPress={() => setSyncMode('manual')}>
                        <View style={{marginBottom: 12}}>
                          <Hammer width={32} height={32}></Hammer>
                        </View>
                    
                        <Text style={{ fontWeight: '600', color: theme.colors.text }}>Manual</Text>
                        <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>(Manual Approval)</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {wizardStep === 2 && (
                  <View style={{ paddingTop: 20 }}>
                    <Text style={{ color: theme.colors.textSecondary, marginBottom: 20, textAlign: 'center' }}>Choose how auction listings behave (FB & Ebay) </Text>
                    <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
                      <TouchableOpacity style={{ flex: 1, flexDirection: "column", gap: 6, alignItems: 'center', borderWidth: 1, borderColor: delistMode === 'auto' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }} onPress={() => setDelistMode('auto')}>
                        <View style={{marginBottom: 12}}>
                          <Unlink width={32} height={32}></Unlink>  
                        </View>
                        <Text style={{ fontWeight: '600', color: theme.colors.text }}>Auto Delist</Text>
                        <Text style={{ textAlign: 'center', color: theme.colors.textSecondary, marginTop: 4 }}>Sold listings are automatically removed</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={{ flex: 1, flexDirection: "column", gap: 6, alignItems: 'center', borderWidth: 1, borderColor: delistMode === 'manual' ? theme.colors.primary : '#E5E7EB', borderRadius: 12, padding: 18 }} onPress={() => setDelistMode('manual')}>
                        <View style={{marginBottom: 12}}>
                          <Link width={32} height={32}></Link>  
                        </View>
                        <Text style={{ fontWeight: '600', color: theme.colors.text }}>Manual Delist</Text>
                        <Text style={{ color: theme.colors.textSecondary, marginTop: 4 }}>Sold listings stay up</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {wizardStep === 3 && (
                  <View style={{ paddingTop: 20 }}>
                    <Text style={{ color: theme.colors.textSecondary, marginBottom: 20, textAlign: 'center' }}>Adjust prices by % per platform (Optional)</Text>
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

                {wizardStep === 4 && (
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

                {wizardStep === 5 && (
                  <View style={{ paddingTop: 20 }}>
                    <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 16, marginBottom: 24 }}>
                      <Text style={{ fontWeight: '700', color: theme.colors.text, marginBottom: 8 }}>Matched/New/Ignored</Text>
                      <Text style={{ color: theme.colors.textSecondary, marginBottom: 16 }}>{counts.matched} matched • {counts.review} review → new • {counts.ignore} ignored</Text>
                      
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
                              .map(item => ({
                                platformProductId: item.platformProduct.id,
                                platformVariantId: item.platformProduct.id, // Same as product ID for now
                                platformProductSku: item.platformProduct.sku,
                                platformProductTitle: item.platformProduct.title,
                                sssyncVariantId: item.suggestedCanonicalProduct?.id || null,
                                action: item.action === 'CREATE_NEW' ? 'create' : item.action === 'LINK_EXISTING' ? 'link' : 'ignore'
                              }));

                            console.log('[MappingReview] Confirming mappings:', confirmedMappings.length);
                            
                            // Call the confirm-mappings endpoint
                            const token = await ensureSupabaseJwt();
                            const confirmResponse = await fetch(`https://api.sssync.app/api/sync/connections/${connectionId}/confirm-mappings`, {
                              method: 'POST',
                              headers: {
                                'Authorization': `Bearer ${token}`,
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                confirmedMatches: confirmedMappings,
                                syncRules: {
                                  inventoryBuffer: globalInventoryBuffer,
                                  syncInventory: syncInventory,
                                  syncPricing: syncPricing,
                                  productDetailsSoT: sourceOfTruth === 'sssync' ? 'ANORHA' : 'PLATFORM',
                                  inventorySoT: sourceOfTruth === 'sssync' ? 'ANORHA' : 'PLATFORM',
                                  propagateCreates: autoCreate,
                                  propagateUpdates: autoUpdate,
                                  propagateChanges: syncDirection === 'two-way' || syncDirection === 'push-only',
                                  inventoryMergeMode: inventoryMergeMode || 'merged',
                                  locationHandling: 'auto_merge'
                                }
                              })
                            });

                            if (!confirmResponse.ok) {
                              const error = await confirmResponse.text();
                              throw new Error(`Failed to confirm mappings: ${error}`);
                            }

                            console.log('[MappingReview] Mappings confirmed, activating sync...');

                            // Activate the sync
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

                {/* Nav controls - only show for steps 1-5 */}
                {wizardStep > 0 && (
                  <>
                    <Text style={{ color: theme.colors.textSecondary, textAlign: 'center', marginTop: 20, marginBottom: 8 }}>
                      {wizardStep === 1 && 'Auto/Manual'}
                      {wizardStep === 2 && 'Auto Delist'}
                      {wizardStep === 3 && 'Price Buffer'}
                      {wizardStep === 4 && 'Inventory Buffer'}
                      {wizardStep === 5 && 'Review'}
                    </Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 }}>
                      <TouchableOpacity
                        onPress={() => {
                          if (wizardStep === 1) {
                            // If going back from step 1, allow reselecting platforms
                            setWizardStep(0);
                          } else {
                            setWizardStep((s) => Math.max(1, s - 1));
                          }
                        }}
                        style={{ padding: 10, opacity: 1 }}
                      >
                        <Icon name="chevron-left" size={22} />
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        {[1, 2, 3, 4, 5].map(i => (
                          <View
                            key={`dot-${i}`}
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 4,
                              backgroundColor: i === wizardStep ? theme.colors.primary : '#E5E7EB'
                            }}
                          />
                        ))}
                      </View>
                      <TouchableOpacity
                        disabled={wizardStep === 5}
                        onPress={() => setWizardStep((s) => Math.min(5, s + 1))}
                        style={{ padding: 10, opacity: wizardStep === 5 ? 0.5 : 1 }}
                      >
                        <Icon name="chevron-right" size={22} />
                      </TouchableOpacity>
                    </View>
                  </>
                )}

              </View>
            </View>
          </Modal>
        </>
      )}
    </View>
  );
};

export default MappingReviewScreen;


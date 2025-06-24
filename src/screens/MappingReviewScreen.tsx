import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, Alert, TouchableOpacity, Modal, Pressable, FlatList, TextInput } from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator'; // Assuming this is your stack param list
import { useTheme } from '../context/ThemeContext';
import { supabase } from '../../lib/supabase';
import Button from '../components/Button';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card'; // Import Card component
import { useLegendState } from '../context/LegendStateContext';
import { LegendStateObservables, PlatformConnection } from '../utils/SupaLegend';
import Animated, { FadeInUp, Layout } from 'react-native-reanimated';
import * as Progress from 'react-native-progress';
import PlaceholderImage from '../components/PlaceholderImage';

// --- REVISED: Data Structures Aligned with Backend Guide ---

// What the backend GIVES you for review
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
  } | null;
  // This is the key part for your UI:
  // Default this to `true` for 'CREATE_NEW' and 'LINK_EXISTING'
  // Your UI should have a checkbox bound to this property.
  isSelected: boolean; 
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

type ActiveTab = 'review' | 'matched' | 'new';

const MappingReviewScreen = () => {
  const theme = useTheme();
  const route = useRoute<MappingReviewScreenRouteProp>();
  const navigation = useNavigation<MappingReviewScreenNavigationProp>();
  const { connectionId, platformName, jobId } = route.params;
  const legendState: LegendStateObservables | null = useLegendState();

  const [suggestions, setSuggestions] = useState<MappingSuggestion[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<any>(null); // Summary might not exist anymore
  const [syncing, setSyncing] = useState(false);
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [multiPlatformMode, setMultiPlatformMode] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<string[]>([]);
  const [isReconcileMode, setIsReconcileMode] = useState(false);
  const [previewingItem, setPreviewingItem] = useState<MappingSuggestion | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('new');
  // --- NEW: State for progress polling ---
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [isPolling, setIsPolling] = useState(!!jobId); // Start polling if jobId is passed
  const [currentJobId, setCurrentJobId] = useState<string | undefined>(jobId);
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
  // --- END NEW ---

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
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;

      if (!token) {
        throw new Error("Authentication token not found. Please log in again.");
      }

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
            // Low confidence match - needs review
            action = 'IGNORE';
            isSelected = false;
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

  // --- IMPROVED: Smart Job Progress Polling Function ---
  useEffect(() => {
    if (!currentJobId || !isPolling) return;

    console.log(`[MappingReviewScreen] Starting smart polling for job ID: ${currentJobId}`);
    setLoading(true);

    let pollCount = 0;
    const maxPollAttempts = 24; // 2 minutes at 5-second intervals (reduced from 10 minutes)
    let consecutiveErrors = 0;
    const maxConsecutiveErrors = 5; // Reduced from 10

    // Define a standalone polling function that can be reused
    const pollJobProgress = async () => {
      try {
        pollCount++;
        console.log(`[MappingReviewScreen] Poll attempt ${pollCount}/${maxPollAttempts} for job ${currentJobId}`);

        const session = await supabase.auth.getSession();
        const token = session?.data.session?.access_token;
        if (!token) throw new Error("Authentication token not found.");

        const response = await fetch(`${SSSYNC_API_BASE_URL}/api/sync/jobs/${currentJobId}/progress`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
        });

        if (!response.ok) {
          consecutiveErrors++;
          
          // For 404, the job might not exist yet - but only wait briefly
          if (response.status === 404 && pollCount < 3) {
            console.log(`[MappingReviewScreen] Job not found yet (${response.status}), continuing to poll briefly...`);
            return; // Continue polling
          }
          
          // If we've had several consecutive errors or 404s, assume job is processed differently
          if (consecutiveErrors >= maxConsecutiveErrors || response.status === 404) {
            console.log(`[MappingReviewScreen] Job likely processed by UltraLowQueue or completed, fetching suggestions directly`);
            setIsPolling(false);
            setLoading(false);
            
            // Try to fetch mapping suggestions directly
            try {
              await fetchMappingSuggestions(connectionId);
            } catch (fallbackError) {
              console.error('[MappingReviewScreen] Direct fetch failed:', fallbackError);
              setError('Unable to load mapping suggestions. Please try refreshing the page.');
            }
            return;
          }
          
          // For other errors, continue polling briefly
          console.warn(`[MappingReviewScreen] Error polling job progress: ${response.status}`);
          return;
        }

        // Reset consecutive errors on successful response
        consecutiveErrors = 0;

        const progressData: JobProgress = await response.json();
        setJobProgress(progressData);
        console.log('[MappingReviewScreen] Job Progress Update:', progressData);

        // Stop polling if the job is completed or has failed
        if (progressData.isCompleted || progressData.isFailed) {
          setIsPolling(false);
          setLoading(false);
          
          if (progressData.isCompleted) {
            console.log(`[MappingReviewScreen] Job ${currentJobId} completed. Fetching final mapping suggestions.`);
            
            // Small delay to ensure backend has processed everything
            setTimeout(async () => {
              try {
                await fetchMappingSuggestions(connectionId);
              } catch (connErr) {
                console.error('[MappingReviewScreen] Error fetching suggestions after completion:', connErr);
                setError('Job completed but failed to load suggestions. Please try refreshing.');
              }
            }, 1000); // Reduced delay
          } else {
            // Job failed
            setError(progressData.description || 'The background job failed to complete.');
          }
        } else if (pollCount >= maxPollAttempts) {
          // Timeout after max attempts - try direct fetch
          setIsPolling(false);
          setLoading(false);
          console.log('[MappingReviewScreen] Polling timeout, trying direct fetch');
          
          try {
            await fetchMappingSuggestions(connectionId);
          } catch (fallbackError) {
            console.error('[MappingReviewScreen] Timeout fallback fetch failed:', fallbackError);
            setError('Job polling timed out. Please try refreshing the page.');
          }
        }
      } catch (err: any) {
        consecutiveErrors++;
        console.error('[MappingReviewScreen] Error during job progress polling:', err);
        
        if (consecutiveErrors >= maxConsecutiveErrors || pollCount >= maxPollAttempts) {
          setIsPolling(false);
          setLoading(false);
          
          // Try direct fetch as final fallback
          console.log('[MappingReviewScreen] Trying direct fetch after polling errors');
          try {
            await fetchMappingSuggestions(connectionId);
          } catch (fallbackError) {
            console.error('[MappingReviewScreen] Final fallback fetch failed:', fallbackError);
            setError('Unable to load mapping suggestions. Please try refreshing the page.');
          }
        }
      }
    };

    // Start the first poll immediately, then set up the interval
    pollJobProgress();
    const intervalId = setInterval(() => {
      if (isPolling && pollCount < maxPollAttempts) {
        pollJobProgress();
      } else if (pollCount >= maxPollAttempts) {
        clearInterval(intervalId);
        setIsPolling(false);
        console.log('[MappingReviewScreen] Polling stopped due to max attempts reached');
      }
    }, 5000); // Poll every 5 seconds

    // Cleanup function to clear the interval when the component unmounts or polling stops
    return () => {
      console.log(`[MappingReviewScreen] Cleaning up polling for job ID: ${currentJobId}`);
      clearInterval(intervalId);
    };
  }, [currentJobId, isPolling, connectionId, fetchMappingSuggestions]);

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
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
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
      
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
      
      if (!token) {
        throw new Error("Authentication token not found. Please log in again.");
      }

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
        body: JSON.stringify({ mappings: mappingsPayload }),
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
        body: JSON.stringify({ mappings: mappingsPayload }),
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
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
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

  const renderTabButton = (tab: ActiveTab, title: string, count: number) => (
    <TouchableOpacity
      style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
      onPress={() => {
        setActiveTab(tab);
      }}
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

        {/* SSSync Product Side */}
        <View style={styles.reviewItemSection}>
          <PlaceholderImage size={40} borderRadius={6} type="icon" icon="cloud-outline" />
          <View style={styles.reviewItemDetails}>
            {item.action === 'LINK_EXISTING' && item.suggestedCanonicalProduct ? (
              <>
                <Text style={styles.reviewItemTitle} numberOfLines={2}>{item.suggestedCanonicalProduct.title || 'Unnamed Product'}</Text>
                <Text style={styles.reviewItemSku}>SKU: {item.suggestedCanonicalProduct.sku || 'N/A'}</Text>
              </>
            ) : item.action === 'CREATE_NEW' ? (
              <Text style={styles.reviewItemActionText}>Will be created in SSSync</Text>
            ) : (
              <Text style={styles.reviewItemActionText}>Will be ignored</Text>
            )}
          </View>
        </View>

        {/* User Action Buttons */}
        <View style={styles.reviewItemUserActions}>
          <TouchableOpacity style={[styles.userActionButton, styles.userActionIgnore]} onPress={() => updateSuggestionAction(item.platformProduct.id, 'IGNORE')}>
            <Icon name="cancel" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.userActionButton, styles.userActionChange]} onPress={() => updateSuggestionAction(item.platformProduct.id, 'CREATE_NEW')}>
            <Icon name="new-box" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.userActionButton, styles.userActionConfirm]} onPress={() => updateSuggestionAction(item.platformProduct.id, 'LINK_EXISTING')}>
            <Icon name="check" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.userActionButton, styles.userActionSearch]} 
            onPress={() => {
              setShowSearchResults(true);
              setSearchQuery('');
              // Store current platform product for linking
              (global as any).currentPlatformProduct = item.platformProduct;
            }}
          >
            <Icon name="magnify" size={20} color="#fff" />
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

        {/* SSSync Product (Right) */}
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
              type="icon" 
              icon="cloud-check-outline"
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
      setSearchResults([]);
      setShowSearchResults(false);
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
        .select(`
          *,
          Products!inner (
            Id,
            Title,
            Description
          )
        `)
        .eq('UserId', user.id)
        .or(`Sku.ilike.%${query}%, Title.ilike.%${query}%, Barcode.ilike.%${query}%`)
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
    setSearchQuery(text);
    // Debounce the search
    const timeoutId = setTimeout(() => {
      searchProducts(text);
    }, 300);
    return () => clearTimeout(timeoutId);
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
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
      
      if (!token) {
        throw new Error("Authentication token not found. Please log in again.");
      }

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

  const renderSyncRulesModal = () => (
    <Modal
      visible={showSyncRules}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowSyncRules(false)}
    >
      <View style={syncRulesStyles.modalContainer}>
        <View style={syncRulesStyles.modalHeader}>
          <TouchableOpacity onPress={() => setShowSyncRules(false)}>
            <Icon name="close" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <Text style={syncRulesStyles.modalTitle}>Sync Settings</Text>
          <TouchableOpacity onPress={() => setShowSyncRules(false)}>
            <Text style={syncRulesStyles.doneButton}>Done</Text>
          </TouchableOpacity>
        </View>
        
        <ScrollView style={syncRulesStyles.modalContent}>
          <Card style={syncRulesStyles.ruleSection}>
            <Text style={syncRulesStyles.sectionTitle}>Sync Direction</Text>
            <Text style={syncRulesStyles.sectionSubtitle}>How should data flow between SSSync and {platformName}?</Text>
            {renderSyncDirectionOption('two-way', 'Two-way sync', 'Changes flow in both directions', 'sync')}
            {renderSyncDirectionOption('push-only', 'Push to platform', 'SSSync updates your platform only', 'upload')}
            {renderSyncDirectionOption('pull-only', 'Pull from platform', 'Platform updates SSSync only', 'download')}
          </Card>

          <Card style={syncRulesStyles.ruleSection}>
            <Text style={syncRulesStyles.sectionTitle}>Conflict Resolution</Text>
            <Text style={syncRulesStyles.sectionSubtitle}>When product details differ, which should win?</Text>
            {renderSourceOption('sssync', 'SSSync wins', 'Use SSSync data when conflicts occur', 'shield-check')}
            {renderSourceOption('platform', `${platformName} wins`, `Use ${platformName} data when conflicts occur`, 'store')}
          </Card>

          <Card style={syncRulesStyles.ruleSection}>
            <Text style={syncRulesStyles.sectionTitle}>What to Sync</Text>
            <View style={syncRulesStyles.switchRow}>
              <View style={syncRulesStyles.switchLabelContainer}>
                <Icon name="package-variant" size={20} color={theme.colors.text} />
                <Text style={syncRulesStyles.switchLabel}>Inventory levels</Text>
              </View>
              <TouchableOpacity onPress={() => setSyncInventory(!syncInventory)}>
                <Icon 
                  name={syncInventory ? 'toggle-switch' : 'toggle-switch-off'} 
                  size={32} 
                  color={syncInventory ? theme.colors.primary : theme.colors.textSecondary} 
                />
              </TouchableOpacity>
            </View>
            <View style={syncRulesStyles.switchRow}>
              <View style={syncRulesStyles.switchLabelContainer}>
                <Icon name="currency-usd" size={20} color={theme.colors.text} />
                <Text style={syncRulesStyles.switchLabel}>Pricing</Text>
              </View>
              <TouchableOpacity onPress={() => setSyncPricing(!syncPricing)}>
                <Icon 
                  name={syncPricing ? 'toggle-switch' : 'toggle-switch-off'} 
                  size={32} 
                  color={syncPricing ? theme.colors.primary : theme.colors.textSecondary} 
                />
              </TouchableOpacity>
            </View>
          </Card>

          <TouchableOpacity 
            style={syncRulesStyles.advancedToggle} 
            onPress={() => setShowAdvancedRules(!showAdvancedRules)}
          >
            <Icon 
              name={showAdvancedRules ? 'chevron-down' : 'chevron-right'} 
              size={22} 
              color={theme.colors.primary} 
            />
            <Text style={syncRulesStyles.advancedText}>Advanced Settings</Text>
          </TouchableOpacity>
          
          {showAdvancedRules && (
            <Card style={syncRulesStyles.ruleSection}>
              <Text style={syncRulesStyles.sectionTitle}>Automatic Actions</Text>
              <View style={syncRulesStyles.switchRow}>
                <View style={syncRulesStyles.switchLabelContainer}>
                  <Icon name="plus-circle" size={20} color={theme.colors.text} />
                  <Text style={syncRulesStyles.switchLabel}>Auto-create new products</Text>
                </View>
                <TouchableOpacity onPress={() => setAutoCreate(!autoCreate)}>
                  <Icon 
                    name={autoCreate ? 'toggle-switch' : 'toggle-switch-off'} 
                    size={32} 
                    color={autoCreate ? theme.colors.primary : theme.colors.textSecondary} 
                  />
                </TouchableOpacity>
              </View>
              <View style={syncRulesStyles.switchRow}>
                <View style={syncRulesStyles.switchLabelContainer}>
                  <Icon name="update" size={20} color={theme.colors.text} />
                  <Text style={syncRulesStyles.switchLabel}>Auto-update existing products</Text>
                </View>
                <TouchableOpacity onPress={() => setAutoUpdate(!autoUpdate)}>
                  <Icon 
                    name={autoUpdate ? 'toggle-switch' : 'toggle-switch-off'} 
                    size={32} 
                    color={autoUpdate ? theme.colors.primary : theme.colors.textSecondary} 
                  />
                </TouchableOpacity>
              </View>
            </Card>
          )}
        </ScrollView>
      </View>
    </Modal>
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
  // --- END NEW ---

  // Moved StyleSheet.create inside the component to access theme
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
    reviewItemActionText: {
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
      width: 50,
      height: 50,
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
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
      backgroundColor: theme.colors.surface,
      borderWidth: 2,
      borderColor: theme.colors.textSecondary,
      borderRadius: 5,
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

  // Get counts for each tab from the suggestions
  const counts = {
    new: suggestions ? suggestions.filter(s => s.action === 'CREATE_NEW').length : 0,
    matched: suggestions ? suggestions.filter(s => s.action === 'LINK_EXISTING').length : 0,
    review: suggestions ? suggestions.filter(s => s.action === 'IGNORE').length : 0,
  };
  const currentList = suggestions ? suggestions.filter(s => {
    if (activeTab === 'new') return s.action === 'CREATE_NEW';
    if (activeTab === 'matched') return s.action === 'LINK_EXISTING';
    if (activeTab === 'review') return s.action === 'IGNORE';
    return false;
  }) : [];

  return (
    <View style={styles.container}>
      {/* Show the final review UI when in that state */}
      {/* {showFinalReview && renderFinalReview()} */}
      
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <Icon name="arrow-left" size={22} color={theme.colors.text} />
      </TouchableOpacity>
      
      {/* Search Modal */}
      {renderSearchResults()}
      
      {/* Sync Rules Modal */}
      {renderSyncRulesModal()}
      
      {/* Custom Success Notification */}
      {showSuccessNotification && (
        <Animated.View 
          entering={FadeInUp.duration(300)}
          style={styles.successNotification}
        >
          <View style={styles.notificationCard}>
            <Icon name="check-circle" size={32} color={theme.colors.success} />
            <View style={styles.notificationContent}>
              <Text style={styles.notificationTitle}>Sync Activated!</Text>
              <Text style={styles.notificationMessage}>{notificationMessage}</Text>
            </View>
          </View>
        </Animated.View>
      )}
      
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

      <ScrollView 
        style={styles.container} 
        contentContainerStyle={{ paddingBottom: 80 }}
      >

        {/* Show tabs view directly */}
        {!loading && !error && suggestions && (
          <>
            {/* Header Section */}
            <View style={styles.headerSection}>
              <Text style={styles.pageTitle}>Review {platformName} Products</Text>
              <Text style={styles.pageSubtitle}>
                Review and organize your products before syncing with SSSync
              </Text>
            </View>

            {/* Tab Bar */}
            <View style={styles.modernTabContainer}>
              {renderTabButton('new', 'New Products', counts.new)}
              {renderTabButton('matched', 'Found Matches', counts.matched)}
              {renderTabButton('review', 'Needs Review', counts.review)}
            </View>

            {/* Search Section */}
            <View style={styles.searchSection}>
              <View style={styles.modernSearchBar}>
                <Icon name="magnify" size={20} color={theme.colors.textSecondary} style={styles.searchIcon} />
                <TextInput
                  style={styles.modernSearchInput}
                  placeholder={`Search ${activeTab === 'new' ? 'new products' : activeTab === 'matched' ? 'matched products' : 'products needing review'}...`}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholderTextColor={theme.colors.textSecondary}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchButton}>
                    <Icon name="close-circle" size={20} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Sync Rules Section */}
            <View style={styles.syncRulesSection}>
              <TouchableOpacity 
                style={styles.syncRulesButton}
                onPress={() => setShowSyncRules(true)}
              >
                <View style={styles.syncRulesButtonContent}>
                  <Icon name="cog" size={20} color={theme.colors.primary} />
                  <View style={styles.syncRulesButtonText}>
                    <Text style={styles.syncRulesButtonTitle}>Sync Settings</Text>
                    <Text style={styles.syncRulesButtonSubtitle}>
                      {syncDirection === 'two-way' ? 'Two-way sync' : 
                       syncDirection === 'push-only' ? 'Push to platform' : 'Pull from platform'} • {sourceOfTruth === 'sssync' ? 'SSSync wins conflicts' : `${platformName} wins conflicts`}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={theme.colors.textSecondary} />
                </View>
              </TouchableOpacity>
            </View>

            {/* Content Section */}
            <Animated.View layout={Layout.springify()} style={styles.contentSection}>
              {(() => {
                const filteredList = currentList.filter(item => 
                  !searchQuery || 
                  item.platformProduct.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  item.platformProduct.sku.toLowerCase().includes(searchQuery.toLowerCase()) ||
                  (item.suggestedCanonicalProduct?.title || '').toLowerCase().includes(searchQuery.toLowerCase())
                );

                if (filteredList.length > 0) {
                  return (
                    <View style={styles.productList}>
                      {filteredList.map((item, index) => (
                        <Animated.View 
                          key={item.platformProduct.id} 
                          entering={FadeInUp.delay(index * 50).duration(300)}
                          layout={Layout.springify()}
                        >
                          {renderModernSuggestionItem({ item })}
                        </Animated.View>
                      ))}
                      {searchQuery && (
                        <View style={styles.searchResultsFooter}>
                          <Text style={styles.searchResultsText}>
                            Showing {filteredList.length} of {currentList.length} items
                          </Text>
                        </View>
                      )}
                    </View>
                  );
                } else {
                  return (
                    <View style={styles.modernEmptyState}>
                      <View style={styles.emptyStateIcon}>
                        <Icon 
                          name={searchQuery ? "magnify" : "package-variant-closed"} 
                          size={48} 
                          color={theme.colors.textSecondary} 
                        />
                      </View>
                      <Text style={styles.emptyStateTitle}>
                        {searchQuery ? 'No matching products' : 'No items in this category'}
                      </Text>
                      <Text style={styles.emptyStateDescription}>
                        {searchQuery 
                          ? 'Try adjusting your search terms or browse other categories'
                          : 'Products will appear here once they\'re processed'
                        }
                      </Text>
                      {searchQuery && (
                        <TouchableOpacity 
                          onPress={() => setSearchQuery('')}
                          style={styles.clearSearchAction}
                        >
                          <Text style={styles.clearSearchActionText}>Clear search</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }
              })()}
            </Animated.View>
          </>
        )}
      </ScrollView>

      {/* Fixed Activate Sync Button at bottom */}
      {!loading && !error && suggestions && (
        <View style={styles.syncButtonContainer}>
          <Button 
            title={`Activate Sync (${suggestions ? suggestions.filter(s => s.isSelected).length : 0} selected)`}
            onPress={handleActivateSync}
            icon="rocket-launch-outline"
            disabled={syncing || !suggestions || suggestions.filter(s => s.isSelected).length === 0}
            loading={syncing}
          />
        </View>
      )}
    </View>
  );
};

export default MappingReviewScreen;

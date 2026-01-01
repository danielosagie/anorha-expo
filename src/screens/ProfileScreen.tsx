import React, { useState, useContext, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Modal, Pressable, StyleProp, ViewStyle, ActivityIndicator, TextInput, Image, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import PlaceholderImage from '../components/Placeholder';
import OrgSwitcher from '../components/OrgSwitcher';
import ShopifySvg from '../assets/shopify.svg';
import AmazonSvg from '../assets/amazon.svg';
import FacebookSvg from '../assets/facebook.svg';
import EbaySvg from '../assets/ebay.svg';
import CloverSvg from '../assets/clover.svg';
import SquareSvg from '../assets/square.svg';
import { useNavigation, useFocusEffect, useRoute, RouteProp, useIsFocused } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { useAuth, useUser } from '@clerk/clerk-expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { RealtimeChannel } from '@supabase/supabase-js';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import * as Crypto from 'expo-crypto'; // For generating random string
import { showMessage } from 'react-native-flash-message';
import { logError, logInfo } from '../utils/logger';
import { fetchUserEntitlements } from '../utils/entitlements';
import { AuthContext } from '../context/AuthContext';
import { useLegendStateControl } from '../context/LegendStateControlContext';
import BottomNav from '../components/BottomNav';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';
import { useOrg } from '../context/OrgContext';
import CreateLocationPoolModal from '../components/CreateLocationPoolModal';

import LocationsManagerV2 from '../components/LocationsManagerV2';








const SSSYNC_API_BASE_URL = "https://api.sssync.app"; // Keep if used for constructing backend URLs
// --- Constants for Feature Flags / Testing ---
const USE_EXTERNAL_BROWSER_FOR_FACEBOOK = true; // Set to true to use Chrome/Safari instead of in-app session
// --- END Re-inlined Constants ---

// Define route param types (add other screens/params if needed)
type ProfileScreenRouteParams = {
  Profile: { refresh?: number; openAddConnection?: boolean }; // Define route params
};

// Type for navigation prop
type ProfileScreenNavigationProp = StackNavigationProp<AppStackParamList>;

// Define available platforms centrally (or import if moved)
const AVAILABLE_PLATFORMS = [
  { key: 'shopify', name: 'Shopify', icon: 'shopping' },
  { key: 'amazon', name: 'Amazon', icon: 'package' },
  { key: 'clover', name: 'Clover', icon: 'leaf' },
  { key: 'square', name: 'Square', icon: 'square-outline' },
  { key: 'ebay', name: 'eBay', icon: 'shopping' },
  { key: 'facebook', name: 'Facebook', icon: 'facebook' },
  { key: 'depop', name: 'Depop', icon: 'alpha-d' },
  { key: 'whatnot', name: 'Whatnot', icon: 'chat-processing' },
  { key: 'etsy', name: 'Etsy', icon: 'alpha-e' },
];

type PlatformId = typeof AVAILABLE_PLATFORMS[number]['key'];

// --- Backend Connection Type (ASSUMPTION - Adjust as needed) ---
interface PlatformConnection {
  Id: string; // Connection ID - Match case from data
  PlatformType: PlatformId; // e.g., 'shopify', 'amazon' - Match case from data
  DisplayName: string; // User-given name for the connection, or default - Match case from data
  Status: string; // e.g., 'active', 'inactive', 'error', 'pending' - Match case from data
  // Add other fields matching the case from fetched data if needed
  UserId: string;
  IsEnabled: boolean;
  LastSyncSuccessAt: string | null;
  NeedsReauth?: boolean; // Backend signals when OAuth token is expired/revoked
  CreatedAt: string;
  UpdatedAt: string;
}
// --- End Backend Connection Type ---

// REMOVE Top-level await for user fetching
// const { data: { user }, error: userError } = await supabase.auth.getUser();
// console.log("[ProfileScreen] User ID:", user?.id);

// if (userError || !user) {
//   Alert.alert("Authentication Error", "Could not get user information. Please log in again.");
//   console.error("[ProfileScreen] Error getting user from Supabase:", userError);
// }
// const userId = user?.id;


const SQUARE_SCOPES = [
  'ITEMS_READ',
  'ITEMS_WRITE',
  'MERCHANT_PROFILE_READ',
  'ORDERS_READ',
  'ORDERS_WRITE',
  'INVENTORY_READ',
  'WEBHOOKS_READ',
  'WEBHOOKS_WRITE',
  'INVENTORY_WRITE',
  'DEVELOPER_APPLICATION_WEBHOOKS_WRITE',
].join(' '); // Space-separated string
// --- End Square OAuth Constants ---

// Helper function to generate a random string for OAuth state using expo-crypto
// const generateRandomString = (length: number): string => { // REMOVED - state management might change with backend handling
//   const byteArray = Crypto.getRandomValues(new Uint8Array(length));
//   // Convert byte array to hex string
//   return Array.from(byteArray, (byte: number) => byte.toString(16).padStart(2, '0')).join('');
// };

const getPlatformIcon = (platformId: PlatformId): React.ComponentType<any> | null => {
  const iconMap: { [key: string]: React.ComponentType<any> } = {
    shopify: ShopifySvg,
    amazon: AmazonSvg,
    facebook: FacebookSvg,
    ebay: EbaySvg,
    clover: CloverSvg,
    square: SquareSvg,
  };
  return iconMap[platformId] || null;
};

// Connection status types
const CONNECTION_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
  REVIEW: 'review',
  READY_TO_SYNC: 'ready_to_sync',
  SCANNING: 'scanning',
  ERROR: 'error',
  SYNCING: 'syncing',
  RECONCILING: 'reconciling',
};

const getStatusDisplay = (status: string): { label: string, color: string, icon: string } => {
  switch (status?.toLowerCase()) {
    case CONNECTION_STATUS.ACTIVE:
      return { label: 'Connected', color: '#93C822', icon: 'check-circle' };
    case CONNECTION_STATUS.INACTIVE:
      return { label: 'Inactive', color: '#8E8E93', icon: 'pause-circle' };
    case CONNECTION_STATUS.PENDING:
      return { label: 'Ready to Scan', color: '#FF9500', icon: 'progress-clock' };
    case CONNECTION_STATUS.REVIEW:
      return { label: 'Review Products', color: '#FF9500', icon: 'sync-alert' };
    case CONNECTION_STATUS.READY_TO_SYNC:
      return { label: 'Ready to Sync', color: '#93C822', icon: 'check-circle' };
    case CONNECTION_STATUS.SCANNING:
      return { label: 'Scanning...', color: '#5856D6', icon: 'loading' };
    case CONNECTION_STATUS.SYNCING:
      return { label: 'Syncing...', color: '#93C822', icon: 'loading' };
    case CONNECTION_STATUS.RECONCILING:
      return { label: 'Reconciling...', color: '#5856D6', icon: 'loading' };
    case CONNECTION_STATUS.ERROR:
      return { label: 'Error', color: '#FF3B30', icon: 'alert-circle' };
    default:
      return { label: status || 'Unknown', color: '#8E8E93', icon: 'help-circle' };
  }
};

// Helper to determine recommended action for a connection in error state
type RecommendedAction = 'reconnect' | 'rescan' | 'fix_resume' | 'manage';

const getRecommendedAction = (
  connection: { Status: string; LastSyncSuccessAt: string | null; IsEnabled: boolean; NeedsReauth?: boolean },
  platformType: string
): { action: RecommendedAction; label: string; icon: string; color: string; description: string } => {
  const status = connection.Status?.toLowerCase();
  const hasEverSynced = !!connection.LastSyncSuccessAt;
  const isEnabled = connection.IsEnabled;
  const needsReauth = connection.NeedsReauth === true;

  // If connection is disabled, primary action is to re-enable
  if (!isEnabled) {
    return {
      action: 'fix_resume',
      label: 'Re-enable',
      icon: 'play-circle',
      color: '#FF9500', // warning
      description: 'Re-enable this connection and resume syncing'
    };
  }

  // PRIORITY: If backend explicitly signals needsReauth, always show Reconnect
  // This handles expired/revoked OAuth tokens regardless of previous sync success
  if (needsReauth) {
    return {
      action: 'reconnect',
      label: 'Reconnect',
      icon: 'link-variant',
      color: '#FF3B30', // error
      description: 'Your account credentials have expired. Please re-authorize.'
    };
  }

  // For error state, determine the best action
  if (status === CONNECTION_STATUS.ERROR) {
    // If never synced successfully, likely an OAuth or setup issue
    if (!hasEverSynced) {
      // Platforms that use OAuth need reconnect
      if (['shopify', 'square', 'facebook', 'ebay', 'clover'].includes(platformType.toLowerCase())) {
        return {
          action: 'reconnect',
          label: 'Reconnect',
          icon: 'link-variant',
          color: '#FF3B30', // error
          description: 'Re-authorize your account credentials'
        };
      }
      // For other platforms, try rescan
      return {
        action: 'rescan',
        label: 'Retry Scan',
        icon: 'refresh',
        color: '#FF9500', // warning
        description: 'Retry the initial product scan'
      };
    }

    // If previously synced successfully, likely a transient error - try rescan
    return {
      action: 'rescan',
      label: 'Rescan',
      icon: 'refresh',
      color: '#FF9500', // warning
      description: 'Rescan products to fix sync issues'
    };
  }

  // For non-error states, show manage
  return {
    action: 'manage',
    label: 'Manage',
    icon: 'cog',
    color: '#007AFF', // primary
    description: 'View and manage sync settings'
  };
};


// Add a function to show in-app notifications
const showStatusNotification = (title: string, message: string, type: 'success' | 'info' | 'warning' | 'danger' = 'info') => {
  try {
    showMessage({
      message: title,
      description: message,
      type: type,
      duration: 4000,
      icon: type,
    });
  } catch (error) {
    // Fallback to Alert if showMessage fails
    console.warn('[ProfileScreen] Error showing notification, falling back to Alert:', error);
    Alert.alert(title, message);
  }
};

const ProfileScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const { getToken } = useAuth();
  const authContext = useContext(AuthContext);
  const route = useRoute<RouteProp<ProfileScreenRouteParams, 'Profile'>>();
  const { resetLegendState } = useLegendStateControl();
  const { toggles } = usePlatformConnections();
  // @ts-ignore - setOrg might not be in the type definition but is likely in the context value
  const { currentOrg, setOrg } = useOrg();

  // For refresh trigger from route params
  const routeRefreshParam = route.params?.refresh || 0;
  const [refreshTrigger, setRefreshTrigger] = useState(routeRefreshParam);
  const isFocused = useIsFocused();

  // Helper function for smart date formatting
  const formatSyncDate = (dateString: string): string => {
    const syncDate = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - syncDate.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    const isToday = syncDate.toDateString() === now.toDateString();
    const isThisYear = syncDate.getFullYear() === now.getFullYear();

    if (isToday) {
      // Show time only (e.g., "2:31 PM")
      return syncDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } else if (isThisYear) {
      // Show date without year (e.g., "Dec 18")
      return syncDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } else {
      // Show full date with year (e.g., "Dec 18, 2024")
      return syncDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  useEffect(() => {
    if (route.params?.refresh) {
      setRefreshTrigger(route.params.refresh);
    }
  }, [route.params?.refresh]);

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);

  // --- NEW State for Connections ---
  const [showConnections, setShowConnections] = useState(true);
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [entitlements, setEntitlements] = useState<{ planName: string | null; maxConnections: number; aiScanLimit: number | null; isPaid: boolean } | null>(null);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  type ShopifyFlowStep = 'idle' | 'enterInfo';
  const [shopifyShopName, setShopifyShopName] = useState('');
  const [shopifyFlowStep, setShopifyFlowStep] = useState<ShopifyFlowStep>('idle');
  const [pastedShopifyUrl, setPastedShopifyUrl] = useState('');
  const [manualShopName, setManualShopName] = useState('');
  const [optimizationSummary, setOptimizationSummary] = useState<{ total: number; fullyReady: number } | null>(null);

  // Fetch optimization summary for streak bar (only when screen is focused)
  useEffect(() => {
    if (!isFocused) return;

    let isCancelled = false;
    const fetchSummary = async () => {
      try {
        const token = await getToken();
        if (!token || isCancelled) return;
        const res = await fetch(`${SSSYNC_API_BASE_URL}/api/products/publish-readiness`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok && !isCancelled) {
          const data = await res.json();
          setOptimizationSummary(data);
        }
      } catch (err) {
        console.error('[ProfileScreen] Error fetching optimization summary:', err);
      }
    };
    fetchSummary();

    return () => { isCancelled = true; };
  }, [isFocused]); // Removed getToken - it's stable from useAuth

  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [showDevOptions, setShowDevOptions] = useState(false);
  const [devMode, setDevMode] = useState(false);
  const [isAddConnectionModalVisible, setIsAddConnectionModalVisible] = useState(false);
  const [bottomNavState, setBottomNavState] = useState<'open' | 'closed'>('closed');
  const [platformActiveCounts, setPlatformActiveCounts] = useState<Record<string, number>>({});
  // Pools state (Location Groups)
  const [pools, setPools] = useState<Array<{ id: string; name: string; description?: string }>>([]);
  const [loadingPools, setLoadingPools] = useState(false);

  // New state for location pool modals
  const [showCreatePool, setShowCreatePool] = useState(false);
  const [showManagePool, setShowManagePool] = useState(false);
  const [selectedPoolId, setSelectedPoolId] = useState<string | null>(null);

  const { user } = useUser();
  const [planName, setPlanName] = useState('');
  const [stats, setStats] = useState({ products: 0, locations: 0 });

  useEffect(() => {
    (async () => {
      try {
        if (!user) return;

        // Subscription tier (optional)
        const { data: usr } = await supabase
          .from('Users')
          .select('SubscriptionTierId')
          .eq('Id', user.id)
          .maybeSingle();
        if (usr?.SubscriptionTierId) {
          const { data: tier } = await supabase
            .from('SubscriptionTiers')
            .select('Name')
            .eq('Id', usr.SubscriptionTierId)
            .maybeSingle();
          if (tier?.Name) setPlanName(tier.Name);
        }

        // Entitlements
        const e = await fetchUserEntitlements();
        setEntitlements(e);

        // Load Live Stats based on current org's connections
        let prodCount = 0;
        let locCount = 0;

        if (currentOrg?.id) {
          // Count products via platform connections that belong to this org
          const { data: connections } = await supabase
            .from('PlatformConnections')
            .select('Id')
            .eq('OrgId', currentOrg.id);

          if (connections && connections.length > 0) {
            const connectionIds = connections.map(c => c.Id);

            // Count products (via PlatformProducts linked to connections)
            const { count: pCount } = await supabase
              .from('PlatformProducts')
              .select('*', { count: 'exact', head: true })
              .in('PlatformConnectionId', connectionIds);
            prodCount = pCount || 0;

            // Count locations
            const { count: lCount } = await supabase
              .from('PlatformLocations')
              .select('*', { count: 'exact', head: true })
              .in('PlatformConnectionId', connectionIds);
            locCount = lCount || 0;
          }
        }

        setStats({
          products: prodCount,
          locations: locCount
        });

      } catch (e) {
        logError('profile_load_data', 'Failed to load profile data', { error: String(e) });
      }
    })();
  }, [user, currentOrg?.id]);

  // Auto-switch away from auto-created personal workspaces to real organization
  useEffect(() => {
    // Small delay to override any initial default set by OrgSwitcher
    const timer = setTimeout(() => {
      if (user && currentOrg && (currentOrg.name.includes('Workspace') || currentOrg.name.includes('Personal'))) {
        // Check Clerk memberships for a "Real" organization
        const memberships = user.organizationMemberships;
        const realOrgMem = memberships?.find(m =>
          !m.organization.name.includes('Workspace') &&
          !m.organization.name.includes('Personal')
        );

        if (realOrgMem && setOrg) {
          console.log('[ProfileScreen] Auto-switching to real org:', realOrgMem.organization.name);
          // Update the global OrgContext
          setOrg({
            id: realOrgMem.organization.id,
            name: realOrgMem.organization.name,
            role: realOrgMem.role,
          });
        }
      }
    }, 500); // 500ms delay

    return () => clearTimeout(timer);
  }, [user, currentOrg]);

  const integrations = [
    {
      id: 'shopify',
      name: 'Shopify',
      isConnected: true,
    },
    {
      id: 'amazon',
      name: 'Amazon',
      isConnected: true,
    },
    {
      id: 'clover',
      name: 'Clover',
      isConnected: true,
    },
    {
      id: 'square',
      name: 'Square',
      isConnected: false,
    },
  ];

  // Define loadConnections function that will be used by fetchConnections
  const loadConnections = async () => {
    setIsLoadingConnections(true);

    try {
      console.log('[ProfileScreen] Attempting to fetch user connections');

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));

      // First try to get connections from SSSync API for most up-to-date status
      const session = await supabase.auth.getSession();
      const token = session?.data?.session?.access_token;

      if (token) {
        try {
          const apiResponse = await fetch(`${SSSYNC_API_BASE_URL}/api/platform-connections`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (apiResponse.ok) {
            const apiData = await apiResponse.json();
            console.log('[ProfileScreen] Successfully fetched connections from API:', apiData.length);
            setPlatformConnections(apiData);
            setIsLoadingConnections(false);
            return; // Exit early if API succeeds
          } else {
            console.warn(`[ProfileScreen] API returned status ${apiResponse.status}, falling back to DB`);
            // Continue to fallback mechanism
          }
        } catch (apiError) {
          console.warn('[ProfileScreen] Error fetching connections from API, falling back to DB:', apiError);
          // Continue to fallback mechanism
        }
      }

      // Fallback: Get connections directly from Supabase if API fails
      console.log('[ProfileScreen] Using fallback: Fetching connections directly from DB');
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("Authentication required to fetch connections");
      }

      const { data, error } = await supabase
        .from('PlatformConnections')
        .select('*')
        .eq('UserId', user.id)
        .order('CreatedAt', { ascending: false });

      if (error) {
        console.error('[ProfileScreen] Error fetching connections from DB:', error);
        throw new Error(`Database error: ${error.message}`);
      } else {
        console.log('[ProfileScreen] Successfully fetched connections from DB:', data?.length);
        setPlatformConnections(data || []);
      }
    } catch (err: any) {
      console.error('[ProfileScreen] Critical error loading connections:', err);
      Alert.alert(
        "Connection Error",
        "Unable to load your platform connections. Please check your internet connection and try again."
      );
      setPlatformConnections([]);
    } finally {
      setIsLoadingConnections(false);
    }
  };

  // Create a fetchConnections function that calls loadConnections
  // This maintains compatibility with existing code that calls fetchConnections
  const fetchConnections = useCallback(() => {
    loadConnections();
  }, []);

  // Load platform connections from Supabase
  useFocusEffect(
    useCallback(() => {
      loadConnections();
    }, [refreshTrigger])
  );

  // --- Calculate active counts by platform for BottomNav ---
  useEffect(() => {
    const counts: Record<string, number> = {};
    platformConnections.forEach((c) => {
      if (c.Status?.toLowerCase() === 'active') {
        counts[c.PlatformType] = (counts[c.PlatformType] || 0) + 1;
      }
    });
    setPlatformActiveCounts(counts);
  }, [platformConnections]);

  // Load LocationPools for the current organization
  const loadPools = useCallback(async () => {
    try {
      if (!currentOrg?.id) {
        console.log('[ProfileScreen] No currentOrg.id yet, skipping pool load');
        setPools([]);
        return;
      }
      setLoadingPools(true);

      // Add a small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));

      // Use API endpoint instead of direct DB access
      const token = await ensureSupabaseJwt();
      const response = await fetch(`${SSSYNC_API_BASE_URL}/api/pools/org/${currentOrg.id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch pools: ${response.status}`);
      }

      const data = await response.json();
      let list = Array.isArray(data) ? data : [];

      // If not admin, restrict to assigned pools
      if (currentOrg.role !== 'org:admin' && Array.isArray(currentOrg.assignedPoolIds)) {
        const allowed = new Set(currentOrg.assignedPoolIds);
        list = list.filter((p) => allowed.has(p.id));
      }

      setPools(list.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description || '',
        sync_inventory: p.sync_inventory,
        sync_pricing: p.sync_pricing
      })));
      console.log('[ProfileScreen] Loaded pools from API:', list.length);
    } catch (e) {
      console.error('[ProfileScreen] Failed loading pools', e);
      setPools([]);
    } finally {
      setLoadingPools(false);
    }
  }, [currentOrg?.id, currentOrg?.role, currentOrg?.assignedPoolIds]);

  useEffect(() => {
    loadPools();
  }, [currentOrg?.id, loadPools, refreshTrigger]);

  // --- GLOBAL OVERLAY: wire platform start connect ---
  const overlay = usePlatformPickerOverlay();
  const handleStartConnectPlatform = useCallback(async (platform: string) => {
    if (platform === 'csv') {
      // Handle CSV import
      try {
        overlay.hide();
        const result = await DocumentPicker.getDocumentAsync({
          type: ['text/csv', 'text/comma-separated-values', 'application/csv', '*/*'],
          copyToCacheDirectory: true,
        });

        if (result.canceled || !result.assets?.[0]) {
          console.log('[ProfileScreen] CSV picking cancelled');
          return;
        }

        const file = result.assets[0];
        console.log('[ProfileScreen] CSV selected:', file.name);

        // Read file contents using legacy FileSystem API
        const fileContent = await FileSystem.readAsStringAsync(file.uri);

        // Simple CSV parsing
        const lines = fileContent.split('\n').filter((line: string) => line.trim());
        if (lines.length < 2) {
          Alert.alert('Invalid CSV', 'The file must have headers and at least one data row.');
          return;
        }

        // Parse headers (first line)
        const headers = lines[0].split(',').map((h: string) => h.trim().replace(/^"|"$/g, ''));

        // Parse data rows
        const csvData = lines.slice(1).map((line: string) => {
          const values = line.split(',').map((v: string) => v.trim().replace(/^"|"$/g, ''));
          const row: Record<string, string> = {};
          headers.forEach((header: string, i: number) => {
            row[header] = values[i] || '';
          });
          return row;
        });

        // Get sample row for preview
        const sampleRow = csvData[0] || {};

        console.log('[ProfileScreen] Parsed CSV:', { headers, rowCount: csvData.length });

        // Navigate to column mapping screen
        navigation.navigate('CSVColumnMapping' as any, {
          csvHeaders: headers,
          csvData,
          sampleRow,
        });
      } catch (error) {
        console.error('[ProfileScreen] CSV import error:', error);
        Alert.alert('Import Error', 'Failed to read the CSV file. Please try again.');
      }
    } else if (platform === 'shopify') {
      setShopifyFlowStep('enterInfo');
      setPastedShopifyUrl('');
      setManualShopName('');
    } else if (platform === 'clover') {
      handleCloverConnect();
    } else if (platform === 'square') {
      handleSquareConnect();
    } else if (platform === 'facebook') {
      handleFacebookConnect();
    } else if (platform === 'ebay') {
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const finalRedirectUri = 'anorhaapp://auth-callback?platform=ebay';
        const orgIdParam = currentOrg?.id ? `&orgId=${currentOrg.id}` : '';
        const url = `${SSSYNC_API_BASE_URL}/api/auth/ebay/login?userId=${user.id}&finalRedirectUri=${encodeURIComponent(finalRedirectUri)}${orgIdParam}`;
        await WebBrowser.openAuthSessionAsync(url, finalRedirectUri);
      })();
    } else {
      Alert.alert('Connect', `Connect logic for ${platform} not implemented yet.`);
    }
  }, [setShopifyFlowStep, setPastedShopifyUrl, setManualShopName, navigation]);

  // Use a ref to hold the handler to avoid infinite loop
  const handleStartConnectRef = React.useRef(handleStartConnectPlatform);
  handleStartConnectRef.current = handleStartConnectPlatform;

  useEffect(() => {
    console.log('[ProfileScreen] Setting up overlay for screen');
    // Use a stable wrapper that calls the ref
    const stableHandler = (platform: string) => handleStartConnectRef.current(platform);
    overlay.enableForScreen(stableHandler);
    return () => {
      console.log('[ProfileScreen] Cleaning up overlay for screen');
      overlay.disableForScreen();
    };
  }, []); // Empty deps - only run once on mount

  // Auto-open overlay if coming from onboarding
  useEffect(() => {
    if (route.params?.openAddConnection) {
      console.log('[ProfileScreen] Auto-opening add connection overlay from onboarding');
      // Small delay to ensure overlay is ready
      const timer = setTimeout(() => {
        overlay.show();
      }, 500);
      // Clear the param to prevent re-triggering
      navigation.setParams({ openAddConnection: undefined } as any);
      return () => clearTimeout(timer);
    }
  }, [route.params?.openAddConnection]);
  // --- END GLOBAL OVERLAY wiring ---

  // --- Unified API token helper (Supabase session only via bridge) ---
  const getApiToken = useCallback(async (): Promise<string | null> => {
    const token = await ensureSupabaseJwt();
    return token;
  }, []);

  // --- NEW: Delete Connection Logic ---
  const handleDisconnectPlatform = async (connectionId: string, platformName: string) => {
    Alert.alert(
      `Disconnect ${platformName}`,
      `Are you sure you want to disconnect your ${platformName} account? This will stop syncing products.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            console.log(`[ProfileScreen] Attempting to disconnect connection ID: ${connectionId}`);

            // ✅ Optimistically remove from UI immediately for instant feedback
            const previousConnections = [...platformConnections];
            setPlatformConnections(prev => prev.filter(c => c.Id !== connectionId));

            try {
              // 1. Get Auth Token
              const token = await getApiToken();
              if (!token) {
                throw new Error("Authentication token not found.");
              }

              // 2. Make API Call 
              const response = await fetch(`https://api.sssync.app/api/platform-connections/${connectionId}`, {
                method: 'DELETE',
                headers: {
                  'Authorization': `Bearer ${token}`,
                },
              });

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
                throw new Error(errorData.message || `Failed to disconnect. Status: ${response.status}`);
              }

              console.log(`[ProfileScreen] Successfully disconnected connection ID: ${connectionId}`);
              showStatusNotification('Disconnected', `${platformName} connection removed.`, 'success');

              // --- Reset Legend State to clear out old data ---
              await resetLegendState();
              console.log('[ProfileScreen] Legend state reset successfully.');

              // Refresh the connections list to ensure consistency
              fetchConnections();

            } catch (error: unknown) {
              console.error("[ProfileScreen] Error disconnecting platform:", error);
              const message = error instanceof Error ? error.message : String(error);

              // ✅ Restore connections on failure
              setPlatformConnections(previousConnections);
              Alert.alert('Error', `Failed to disconnect ${platformName}: ${message}`);
            }
          },
        },
      ]
    );
  };
  // --- END Delete Connection Logic ---

  // --- NEW: Fix & Resume for error/disabled connections ---
  const fixAndResumeConnection = async (connectionId: string, platformName: string) => {
    try {
      const token = await getApiToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch(`${SSSYNC_API_BASE_URL}/api/platform-connections/${connectionId}/enable`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        throw new Error(body?.message || `Enable failed (${res.status})`);
      }
      logInfo('connection_enable', 'Connection enabled, resuming scan', { connectionId, platformName });
      // Refresh local list first
      await loadConnections();
      // Kick off scan to make it seamless
      await startPlatformScan(connectionId, platformName);
    } catch (err) {
      logError('connection_enable_error', 'Failed to enable/reactivate connection', { connectionId, error: String(err) });
      Alert.alert('Resume Failed', err instanceof Error ? err.message : String(err));
    }
  };

  // --- NEW: Reconnect Platform (for credential refresh) ---
  const handleReconnectPlatform = async (connectionId: string, platformType: string, platformName: string) => {
    Alert.alert(
      `Reconnect ${platformName}`,
      `This will refresh your ${platformName} credentials. You'll be redirected to ${platformName} to re-authorize the connection.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reconnect",
          style: "default",
          onPress: async () => {
            console.log(`[ProfileScreen] Initiating reconnect for ${platformName} (connection ID: ${connectionId})`);
            try {
              const token = await getApiToken();
              if (!token) {
                throw new Error("Authentication token not found.");
              }

              // Use the backend's reconnect endpoint which returns an auth URL
              const finalRedirectUri = 'anorhaapp://auth-callback';
              const response = await fetch(
                `${SSSYNC_API_BASE_URL}/api/auth/${platformType}/reconnect?connectionId=${connectionId}&finalRedirectUri=${encodeURIComponent(finalRedirectUri)}`,
                {
                  method: 'GET',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                  },
                }
              );

              if (!response.ok) {
                const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
                throw new Error(errorData.message || `Failed to get reconnect URL. Status: ${response.status}`);
              }

              const { authUrl } = await response.json();
              console.log(`[ProfileScreen] Got reconnect URL for ${platformName}, opening in browser...`);

              // Open the auth URL in browser
              const supported = await Linking.canOpenURL(authUrl);
              if (supported) {
                await Linking.openURL(authUrl);
                // User will be redirected back after OAuth completes
              } else {
                throw new Error("Could not open reconnect URL.");
              }

            } catch (error: unknown) {
              console.error("[ProfileScreen] Error reconnecting platform:", error);
              const message = error instanceof Error ? error.message : String(error);
              Alert.alert('Reconnect Failed', `Failed to reconnect ${platformName}: ${message}`);
            }
          },
        },
      ]
    );
  };
  // --- END Reconnect Platform Logic ---

  // Web app base URL for opening billing and team pages
  const WEB_APP_URL = 'https://app.anorha.app';

  const handleOpenBilling = async () => {
    try {
      // Simply open the web app billing page directly
      // User will sign in through normal Clerk flow if not already authenticated
      await WebBrowser.openBrowserAsync(`${WEB_APP_URL}/billing`);
    } catch (error: any) {
      console.error('Failed to open billing:', error);
      Alert.alert('Error', `Failed to open billing: ${error.message}`);
    }
  };

  const handleOpenTeams = async () => {
    try {
      // Simply open the web app team page directly
      // User will sign in through normal Clerk flow if not already authenticated
      await WebBrowser.openBrowserAsync(`${WEB_APP_URL}/team`);
    } catch (error: any) {
      console.error('Failed to open team page:', error);
      Alert.alert('Error', `Failed to open team page: ${error.message}`);
    }
  };

  // --- NEW: Logic for Guided Shopify Flow Step 4 (Open Browser) ---
  const openShopifyForCopy = async () => {
    console.log("[ProfileScreen] Opening Shopify for user to copy URL...");
    // Get User ID directly from Supabase auth
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      Alert.alert("Authentication Error", "Could not get user information. Please log in again.");
      console.error("[ProfileScreen] Error getting user from Supabase:", userError);
      return;
    }
    const userId = user.id;

    // This URL still initiates the backend picker, which will eventually lead the user
    // to their Shopify dashboard after login/selection if needed.
    // The user just needs to copy the URL *from* that dashboard.
    const backendInitiationUrlBase = 'https://api.sssync.app/api/auth/shopify/initiate-store-picker';
    // Define and encode the final redirect URI needed by the backend
    const finalRedirectUri = 'anorhaapp://auth-callback';
    const encodedFinalRedirectUri = encodeURIComponent(finalRedirectUri);

    // Append BOTH userId and finalRedirectUri plus orgId
    const orgIdParam = currentOrg?.id ? `&orgId=${currentOrg.id}` : '';
    const backendInitiationUrl = `${backendInitiationUrlBase}?userId=${userId}&finalRedirectUri=${encodedFinalRedirectUri}${orgIdParam}`;

    console.log(`[ProfileScreen] Opening URL with Expo WebBrowser: ${backendInitiationUrl}`);
    try {
      await WebBrowser.openBrowserAsync(backendInitiationUrl);
    } catch (error: unknown) {
      console.error('[ProfileScreen] WebBrowser Error opening for copy:', error);
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Browser Error', `An error occurred opening the browser: ${message}`);
    }
  };
  // --- END Guided Shopify Flow Logic ---

  // --- NEW: Logic for Guided Shopify Flow Step 5 (Paste) ---
  const handlePasteFromClipboard = async () => {
    const text = await Clipboard.getStringAsync();
    setPastedShopifyUrl(text);
  };
  // --- END Guided Shopify Flow Logic ---

  // --- NEW: Logic for Guided Shopify Flow Steps 6 & 7 (Confirm/Connect) ---
  const connectWithExtractedShopName = async (extractedShopName: string) => {
    console.log(`[ProfileScreen] Connecting with extracted shop name: ${extractedShopName}`);
    // Get User ID
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      Alert.alert("Authentication Error", "Could not get user information. Please log in again.");
      console.error("[ProfileScreen] Error getting user:", userError);
      return;
    }
    const userId = user.id;

    // Backend endpoint for direct login/authorization with shop name
    const directLoginUrlBase = 'https://api.sssync.app/api/auth/shopify/login';
    const finalRedirectUri = 'anorhaapp://auth-callback';
    const encodedFinalRedirectUri = encodeURIComponent(finalRedirectUri);

    const orgIdParam = currentOrg?.id ? `&orgId=${currentOrg.id}` : '';
    const directLoginUrl = `${directLoginUrlBase}?userId=${userId}&shop=${extractedShopName}&finalRedirectUri=${encodedFinalRedirectUri}${orgIdParam}`;
    console.log(`[ProfileScreen] Opening Final Auth URL: ${directLoginUrl}`);

    try {
      const result = await WebBrowser.openAuthSessionAsync(
        directLoginUrl,
        finalRedirectUri
      );
      console.log('[ProfileScreen] Final WebBrowser Auth Result: ', result);
      // Success is handled by the deep link handler in App.tsx refreshing state
      // You might want to add a user-facing confirmation here or after the deep link handler works
      if (result.type === 'cancel' || result.type === 'dismiss') {
        Alert.alert('Connection Cancelled', 'You cancelled or dismissed the final Shopify connection step.');
      } else if (result.type !== 'success') {
        // Log the actual result type for debugging if it's not success/cancel/dismiss
        console.warn('[ProfileScreen] Unexpected WebBrowser Auth Result type:', result.type, result);
        // Provide a generic error, or handle specific types like 'locked' if necessary
        Alert.alert('Connection Issue', `The connection process returned an unexpected status: ${result.type}. Please try again.`);
      }

    } catch (error: unknown) {
      console.error('[ProfileScreen] Final WebBrowser Auth Error:', error);
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Connection Error', `An error occurred opening the browser for final auth: ${message}`);
    }
  };

  // REVISED: Single handler for confirm button in the combined modal
  const handleConfirmInput = () => {
    console.log(`[ProfileScreen] Confirming input: URL='${pastedShopifyUrl}', Manual='${manualShopName}'`);
    let shopNameToConnect: string | null = null;
    let isValid = false;

    // Prioritize pasted URL if both are entered
    if (pastedShopifyUrl) {
      const shopNameRegex = /admin\.shopify\.com\/store\/([a-zA-Z0-9\-]+)/;
      const match = pastedShopifyUrl.match(shopNameRegex);
      if (match && match[1]) {
        shopNameToConnect = match[1];
        isValid = true;
        console.log(`[ProfileScreen] Extracted shop name from URL: ${shopNameToConnect}`);
      } else {
        Alert.alert(
          "Invalid URL Format",
          "Could not automatically extract the shop name from the pasted URL. Please ensure it looks like 'https://admin.shopify.com/store/your-shop-name' or enter the name manually."
        );
        return; // Stop processing if URL is present but invalid
      }
    } else if (manualShopName) {
      // Basic validation for manual name (e.g., non-empty, maybe no spaces)
      const trimmedName = manualShopName.trim();

      // Try to extract shop name from URL if user pasted the full URL
      let extractedShopName = trimmedName;
      if (trimmedName.includes('admin.shopify.com')) {
        const shopNameRegex = /admin\.shopify\.com\/store\/([a-zA-Z0-9\-]+)/;
        const match = trimmedName.match(shopNameRegex);
        if (match && match[1]) {
          extractedShopName = match[1];
          console.log(`[ProfileScreen] Extracted shop name from manual URL: ${extractedShopName}`);
        }
      }

      if (extractedShopName && !extractedShopName.includes(' ')) { // Example validation
        shopNameToConnect = extractedShopName;
        isValid = true;
        console.log(`[ProfileScreen] Using manual shop name: ${shopNameToConnect}`);
      } else {
        Alert.alert(
          "Invalid Shop Name",
          "Please enter a valid shop name (usually contains letters, numbers, hyphens, no spaces) or a full Shopify admin URL."
        );
        return; // Stop processing if manual name is invalid
      }
    }

    if (isValid && shopNameToConnect) {
      // Reset state and close modal *before* calling connection function
      setShopifyFlowStep('idle');
      setPastedShopifyUrl('');
      setManualShopName('');
      // Call the connection function
      connectWithExtractedShopName(shopNameToConnect);
    } else {
      // This case should ideally not be reached if button disable logic is correct, but good fallback.
      Alert.alert("Missing Input", "Please paste the Shopify URL or enter the shop name.");
    }
  };

  // --- NEW: Function to start platform scan ---
  const startPlatformScan = async (connectionId: string, platformName: string, isReconnect: boolean = false) => {
    console.log(`[ProfileScreen] Attempting to start scan for connection ID: ${connectionId} (${platformName})`);

    // ✅ NAVIGATE IMMEDIATELY - Don't wait for API response
    // The MappingReviewScreen will show loading state and receive progress updates via WebSocket
    navigation.navigate('MappingReview', {
      connectionId,
      platformName,
      isScanning: true, // Flag to indicate scan is in progress
    });

    // Start the scan in the background (non-blocking)
    (async () => {
      try {
        const token = await getApiToken();
        if (!token) throw new Error('Authentication token not found for starting scan.');

        // Determine which endpoint to use based on isReconnect
        const endpoint = isReconnect
          ? `${SSSYNC_API_BASE_URL}/api/sync/connection/${connectionId}/reconcile` // Reconcile for reconnections
          : `${SSSYNC_API_BASE_URL}/api/sync/connections/${connectionId}/start-scan`; // Regular scan for new connections

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
          throw new Error(errorData.message || `Failed to start scan for ${platformName}. Status: ${response.status}`);
        }

        const responseData = await response.json().catch(() => ({}));
        console.log(`[ProfileScreen] Successfully initiated scan for ${platformName} (Connection ID: ${connectionId}). Job ID: ${responseData.jobId}`);

      } catch (error: unknown) {
        console.error(`[ProfileScreen] Error starting scan for ${platformName}:`, error);
        const message = error instanceof Error ? error.message : String(error);
        // Show error notification - user is already on MappingReviewScreen
        showStatusNotification('Scan Error', `Could not start scan for ${platformName}: ${message}`, 'danger');
      }
    })();
  };
  // --- END Function to start platform scan ---

  // --- NEW: Clover Connection Logic ---
  const handleCloverConnect = async () => {
    console.log("[ProfileScreen] Initiating Clover connection (New OAuth Flow)...");
    try {
      // 1. Get SSSync User ID
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        Alert.alert("Authentication Error", "Could not get user information. Please log in again.");
        console.error("[ProfileScreen] Clover Connect: Error getting user:", userError);
        return;
      }
      const sssyncUserId = user.id;

      // 2. Define finalRedirectUri
      const finalRedirectUri = "anorhaapp://auth/callback?platform=clover"; // App-specific deep link

      // 3. Construct Backend Authorization URL with orgId
      const orgIdParam = currentOrg?.id ? `&orgId=${currentOrg.id}` : '';
      const backendAuthUrl = `${SSSYNC_API_BASE_URL}/api/auth/clover/login?userId=${sssyncUserId}&finalRedirectUri=${encodeURIComponent(finalRedirectUri)}${orgIdParam}`;
      console.log("[ProfileScreen] Clover Connect: Backend Auth URL:", backendAuthUrl);

      // 4. Open WebBrowser for OAuth flow, listening for finalRedirectUri
      const result = await WebBrowser.openAuthSessionAsync(backendAuthUrl, finalRedirectUri);
      console.log("[ProfileScreen] Clover Connect: WebBrowser result:", result);

      // 5. Handle Callback from finalRedirectUri
      if (result.type === 'success' && result.url) {
        // Remove hash fragment if present (e.g., #_=_) before parsing
        const urlWithoutHash = result.url.split('#')[0];
        const urlParams = new URLSearchParams(urlWithoutHash.split('?')[1]);
        const status = urlParams.get('status');
        const message = urlParams.get('message');
        const connectionId = urlParams.get('connectionId'); // Assuming backend might send this

        console.log("[ProfileScreen] Clover Connect: Callback params:", { status, message, connectionId });

        if (status === 'success') {
          Alert.alert("Success", message || "Clover account connected successfully!");
          if (connectionId) {
            console.log(`[ProfileScreen] Clover Connect: Connection ID ${connectionId}. Syncing locations...`);
            // Sync locations first, then start scan
            try {
              const token = await ensureSupabaseJwt();
              await fetch(`${SSSYNC_API_BASE_URL}/api/pools/locations/sync/${connectionId}`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });
              console.log(`[ProfileScreen] Clover Connect: Locations synced for ${connectionId}`);
            } catch (syncError) {
              console.error(`[ProfileScreen] Clover Connect: Failed to sync locations:`, syncError);
              // Continue anyway - scan can still start
            }
            // Call startPlatformScan
            await startPlatformScan(connectionId, 'Clover');
          }
          fetchConnections(); // Refresh connections list
        } else {
          Alert.alert("Connection Failed", message || "Failed to connect Clover account.");
          console.error("[ProfileScreen] Clover Connect: Connection failed via backend callback:", { status, message });
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        Alert.alert("Cancelled", "Clover connection process was cancelled.");
        console.log("[ProfileScreen] Clover Connect: User cancelled or dismissed flow.");
      } else {
        let errorMessage = "An unexpected error occurred during Clover authentication.";
        if (result.type === 'locked') {
          errorMessage = "The authentication session is locked. Please try again or use another method.";
        }
        Alert.alert("Connection Error", errorMessage);
        console.warn("[ProfileScreen] Clover Connect: Unexpected WebBrowser result type:", result.type, result);
      }
    } catch (error: unknown) {
      console.error("[ProfileScreen] Clover Connect: General error:", error);
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert("Error", `Failed to connect Clover: ${message}`);
    }
    // No finally block for state cleanup needed for now, as state param is not sent to backend login URL
  };
  // --- END Clover Connection Logic ---

  // --- NEW: Square Connection Logic ---
  const handleSquareConnect = async () => {
    console.log("[ProfileScreen] Initiating Square connection (New OAuth Flow)...");
    try {
      // 1. Get SSSync User ID
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        Alert.alert("Authentication Error", "Could not get user information. Please log in again.");
        console.error("[ProfileScreen] Square Connect: Error getting user:", userError);
        return;
      }
      const sssyncUserId = user.id;

      // 2. Define finalRedirectUri
      const finalRedirectUri = "anorhaapp://auth/callback?platform=square"; // App-specific deep link

      // 3. Construct Backend Authorization URL with orgId
      const orgIdParam = currentOrg?.id ? `&orgId=${currentOrg.id}` : '';
      const backendAuthUrl = `${SSSYNC_API_BASE_URL}/api/auth/square/login?userId=${sssyncUserId}&finalRedirectUri=${encodeURIComponent(finalRedirectUri)}${orgIdParam}`;
      console.log("[ProfileScreen] Square Connect: Backend Auth URL:", backendAuthUrl);

      // 4. Open WebBrowser for OAuth flow, listening for finalRedirectUri
      const result = await WebBrowser.openAuthSessionAsync(backendAuthUrl, finalRedirectUri);
      console.log("[ProfileScreen] Square Connect: WebBrowser result:", result);

      // 5. Handle Callback from finalRedirectUri
      if (result.type === 'success' && result.url) {
        // Remove hash fragment if present (e.g., #_=_) before parsing
        const urlWithoutHash = result.url.split('#')[0];
        const urlParams = new URLSearchParams(urlWithoutHash.split('?')[1]);
        const status = urlParams.get('status');
        const message = urlParams.get('message');
        const connectionId = urlParams.get('connectionId'); // Assuming backend might send this

        console.log("[ProfileScreen] Square Connect: Callback params:", { status, message, connectionId });

        if (status === 'success') {
          Alert.alert("Success", message || "Square account connected successfully!");
          if (connectionId) {
            console.log(`[ProfileScreen] Square Connect: Connection ID ${connectionId}. Syncing locations...`);
            // Sync locations first, then start scan
            try {
              const token = await ensureSupabaseJwt();
              await fetch(`${SSSYNC_API_BASE_URL}/api/pools/locations/sync/${connectionId}`, {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
              });
              console.log(`[ProfileScreen] Square Connect: Locations synced for ${connectionId}`);
            } catch (syncError) {
              console.error(`[ProfileScreen] Square Connect: Failed to sync locations:`, syncError);
              // Continue anyway - scan can still start
            }
            // Call startPlatformScan
            await startPlatformScan(connectionId, 'Square');
          }
          fetchConnections(); // Refresh connections list
        } else {
          Alert.alert("Connection Failed", message || "Failed to connect Square account.");
          console.error("[ProfileScreen] Square Connect: Connection failed via backend callback:", { status, message });
        }
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        Alert.alert("Cancelled", "Square connection process was cancelled.");
        console.log("[ProfileScreen] Square Connect: User cancelled or dismissed flow.");
      } else {
        let errorMessage = "An unexpected error occurred during Square authentication.";
        if (result.type === 'locked') {
          errorMessage = "The authentication session is locked. Please try again or use another method.";
        }
        Alert.alert("Connection Error", errorMessage);
        console.warn("[ProfileScreen] Square Connect: Unexpected WebBrowser result type:", result.type, result);
      }
    } catch (error: unknown) {
      console.error("[ProfileScreen] Square Connect: General error:", error);
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert("Error", `Failed to connect Square: ${message}`);
    }
    // No finally block for state cleanup needed for now
  };
  // --- END Square Connection Logic ---

  // --- Facebook Connection Logic ---
  const handleFacebookConnect = async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        Alert.alert("Authentication Error", "Could not get user information. Please log in again.");
        return;
      }

      const finalRedirectUri = 'anorhaapp://auth-callback';
      const encodedFinalRedirectUri = encodeURIComponent(finalRedirectUri);

      // Build the auth URL with orgId so backend can associate connection with organization
      const orgIdParam = currentOrg?.id ? `&orgId=${currentOrg.id}` : '';
      const backendAuthUrl = `${SSSYNC_API_BASE_URL}/api/auth/facebook/login?userId=${user.id}&finalRedirectUri=${encodedFinalRedirectUri}${orgIdParam}`;

      console.log(`[ProfileScreen] Facebook Connect: Opening in ${USE_EXTERNAL_BROWSER_FOR_FACEBOOK ? 'External' : 'Internal'} browser...`);

      if (USE_EXTERNAL_BROWSER_FOR_FACEBOOK) {
        // Option A: Open in Chrome/Safari - user will be redirected back via custom scheme
        const supported = await Linking.canOpenURL(backendAuthUrl);
        if (supported) {
          await Linking.openURL(backendAuthUrl);
          // No alert needed - user will be redirected back automatically after completing OAuth
        } else {
          Alert.alert("Error", "Could not open Facebook login. Please try again.");
        }
      } else {
        // Option B: Open in System-native Auth Session (Better UX, returns automatically)
        const result = await WebBrowser.openAuthSessionAsync(
          backendAuthUrl,
          finalRedirectUri
        );

        console.log('[ProfileScreen] Facebook Auth Result:', result.type);
        if (result.type === 'cancel' || result.type === 'dismiss') {
          // User cancelled
        } else if (result.type !== 'success') {
          console.warn('[ProfileScreen] Facebook Auth Result type:', result.type);
        }
      }

    } catch (error: unknown) {
      console.error("[ProfileScreen] Facebook Connect Error:", error);
      Alert.alert("Error", "Failed to open Facebook login. Please try again.");
    }
  };
  // --- END Facebook Connection Logic ---



  // --- NEW: Handler for Review & Sync ---
  const handleReviewAndSync = (connectionId: string, platformName: string) => {
    console.log(`[ProfileScreen] Initiating Review & Sync for Connection ID: ${connectionId}, Platform: ${platformName}`);

    // Navigate to the MappingReview screen
    navigation.navigate('MappingReview', { connectionId, platformName });
  };
  // --- END Handler for Review & Sync ---

  // --- Simple audit log viewer: open recent ActivityLogs for this connection ---
  const openAuditLogs = async (connectionId: string) => {
    try {
      const token = await getApiToken();
      if (!token) throw new Error('Auth required');
      const base = SSSYNC_API_BASE_URL;
      const res = await fetch(`${base}/api/products/activities?platformConnectionId=${encodeURIComponent(connectionId)}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed to load logs (${res.status})`);
      const logs = await res.json();
      Alert.alert('Recent Activity', Array.isArray(logs) && logs.length > 0 ? `Showing ${logs.length} events (latest first).` : 'No recent activity.');
    } catch (e: any) {
      Alert.alert('Audit Logs', e?.message || 'Failed to fetch logs');
    }
  };

  const handleLogout = async () => {
    console.log("[ProfileScreen] handleLogout initiated...");
    try {
      // Use global auth context signOut which also stops Supabase bridge and Clerk session
      await authContext?.signOut();
      // Don't manually reset to a root route from a child navigator; SignedOut gating will switch the shell.
      // If you want an immediate visual change, you can optionally navigate to a local screen here.
    } catch (error) {
      console.error('Logout Error in handleLogout:', error);
    }
  };

  const logCurrentUserToken = async () => {
    try {
      const token = await getApiToken();
      if (token) {
        console.log('Current API token:', token);
      } else {
        console.log('No active API token found.');
      }
    } catch (catchError: any) {
      console.error("Caught unexpected error getting session:", catchError.message);
    }
  };

  // Add state for dev mode
  const [isDevMode, setIsDevMode] = useState(false);

  // Billing modal state
  const [showBillingPortal, setShowBillingPortal] = useState(false);
  const [billingPortalUrl, setBillingPortalUrl] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);

  // Load dev mode setting on component mount
  useEffect(() => {
    const loadDevMode = async () => {
      try {
        const devMode = await AsyncStorage.getItem('devMode');
        setIsDevMode(devMode === 'true');
      } catch (error) {
        console.error('Error loading dev mode setting:', error);
      }
    };
    loadDevMode();
  }, []);

  // Toggle dev mode and persist it
  const toggleDevMode = async (value: boolean) => {
    try {
      await AsyncStorage.setItem('devMode', value.toString());
      setIsDevMode(value);
    } catch (error) {
      console.error('Error saving dev mode setting:', error);
    }
  };

  // Modify the menuItems array to be dynamic based on dev mode
  const menuItems = [
    {
      icon: 'credit-card',
      title: 'Subscription & Billing',

      onPress: () => handleOpenBilling()
    },
    {
      icon: 'account-group',
      title: 'Team',
      onPress: () => handleOpenTeams()
    },
    {
      icon: 'help-circle',
      title: 'Please Give Feedback',
      onPress: async () => {
        await WebBrowser.openBrowserAsync('https://anorha.userjot.com/');
      }
    },
    // Developer Mode switch - its state is independent of the token button now

    // Billing portal entry

    // "Show Auth Token" button is now always present

    { icon: 'logout', title: 'Logout', isDestructive: true, onPress: handleLogout },
  ];

  // Modify the menu item rendering to handle custom components
  {/*
    icon: 'key',
    title: 'Show Auth Token',
    onPress: logCurrentUserToken,
  */}

  const renderMenuItem = (item: any, index: number) => (
    <TouchableOpacity
      key={item.title}
      style={[
        styles.menuItem,
        index < menuItems.length - 1 ? styles.menuItemBorder : null
      ]}
      onPress={item.onPress}
    >
      <View style={styles.menuItemLeft}>
        <Icon
          name={item.icon}
          size={24}
          color={item.isDestructive ? theme.colors.error : '#555'}
          style={styles.menuIcon}
        />
        {item.customComponent || (
          <Text
            style={[
              styles.menuText,
              item.isDestructive ? { color: theme.colors.error } : null
            ]}
          >
            {item.title}
          </Text>
        )}
      </View>

      {item.badge ? (
        <View style={[styles.menuBadge, { backgroundColor: theme.colors.primary + '20' }]}>
          <Text style={[styles.menuBadgeText, { color: theme.colors.primary }]}>{item.badge}</Text>
        </View>
      ) : !item.customComponent && (
        <Icon name="chevron-right" size={20} color="#999" />
      )}
    </TouchableOpacity>
  );

  // Add a state for the realtime channel
  const [realtimeChannel, setRealtimeChannel] = useState<RealtimeChannel | null>(null);

  // Hide tab bar when platform picker overlay is visible
  useEffect(() => {
    const parentNav: any = (navigation as any)?.getParent?.();
    try {
      parentNav?.setOptions?.({ tabBarStyle: { display: overlay.visible ? 'none' : 'flex' } });
    } catch (e) {
      // no-op if parent isn't a tab navigator
    }
    return () => {
      try {
        parentNav?.setOptions?.({ tabBarStyle: { display: 'flex' } });
      } catch { }
    };
  }, [overlay.visible]);

  // Add this function to set up the real-time subscription
  const setupRealtimeSubscription = async () => {
    try {
      // Get the current user
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        console.error('[ProfileScreen] No authenticated user for realtime subscription');
        return;
      }

      // Unsubscribe from any existing channel
      if (realtimeChannel) {
        console.log('[ProfileScreen] Unsubscribing from existing realtime channel');
        realtimeChannel.unsubscribe();
      }

      // Subscribe to changes on the PlatformConnections table for this user
      console.log('[ProfileScreen] Setting up realtime subscription for PlatformConnections');
      const channel = supabase
        .channel('platform-connections-changes')
        .on(
          'postgres_changes',
          {
            event: 'UPDATE', // Listen to UPDATE events
            schema: 'public',
            table: 'PlatformConnections',
            filter: `UserId=eq.${user.id}`, // Only listen to changes for this user
          },
          (payload) => {
            console.log('[ProfileScreen] Received realtime update:', payload);
            const oldStatus = payload.old.Status;
            const newStatus = payload.new.Status;
            const platformName = payload.new.DisplayName || payload.new.PlatformType;

            if (oldStatus !== newStatus) {
              showStatusNotification(
                `${platformName} Status Update`,
                `Your connection is now ${newStatus}.`,
                'info'
              );
            }

            // Refresh connections when a change is detected
            loadConnections();
          }
        )
        .subscribe((status) => {
          console.log('[ProfileScreen] Realtime subscription status:', status);
        });

      setRealtimeChannel(channel);
    } catch (error) {
      console.error('[ProfileScreen] Error setting up realtime subscription:', error);
    }
  };

  // Note: Clerk team sync is now handled automatically via backend webhooks
  // The sync-clerk-teams endpoint was removed - orgs are synced on login

  // Clean up the subscription when the component unmounts
  useEffect(() => {
    setupRealtimeSubscription();

    return () => {
      if (realtimeChannel) {
        console.log('[ProfileScreen] Cleaning up realtime subscription');
        realtimeChannel.unsubscribe();
        setRealtimeChannel(null);
      }
    };
  }, []);  // Empty dependency array means this runs once on mount and cleanup on unmount


  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollViewContent}
      showsVerticalScrollIndicator={false}
    >

      {/*
      <OrgSwitcher 
        onOrgChanged={(orgId, orgName) => {
          // Reload TeamScreen data when org changes
          setRefreshTrigger(prev => prev + 1);
        }}
        currentOrgId={currentOrg?.id}
      />
      */}


      <Animated.View entering={FadeInUp.delay(100).duration(500)}>

        {/* Account Card */}
        <Card style={styles.card}>
          <View style={styles.accountHeader}>
            {user?.imageUrl ? (
              <Image
                source={{ uri: user.imageUrl }}
                style={{ width: 64, height: 64, borderRadius: 32 }}
              />
            ) : (
              <PlaceholderImage
                size={64}
                borderRadius={32}
                color="#6A5ACD"
                type="gradient"
                text={user?.firstName?.[0] || 'U'}
              />
            )}
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>{user?.fullName || user?.firstName || 'User'}</Text>
              <Text style={styles.accountEmail}>{user?.primaryEmailAddress?.emailAddress || ''}</Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                <Text style={styles.orgLabel}>Organization: </Text>
                <Text style={styles.orgName}>
                  {currentOrg?.name || user?.organizationMemberships?.[0]?.organization?.name || 'No Organization'}
                </Text>
              </View>

              {currentOrg?.name?.includes('Workspace') && (
                <TouchableOpacity
                  onPress={() => {
                    const real = user?.organizationMemberships?.find(m => !m.organization.name.includes('Workspace'));
                    if (real && setOrg) setOrg({ id: real.organization.id, name: real.organization.name, role: real.role });
                  }}
                  style={{ marginTop: 8 }}
                >
                  <Text style={{ fontSize: 12, color: theme.colors.primary, fontWeight: 'bold', textDecorationLine: 'underline' }}>
                    Switch to {user?.organizationMemberships?.find(m => !m.organization.name.includes('Workspace'))?.organization?.name || 'Real Org'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

          </View>





          {/* Seller Stats Section 
          <View style={[styles.sellerStatsSection, { backgroundColor: theme.colors.surface }]}>
            <Text style={[styles.sellerStatsSectionTitle, { color: theme.colors.text }]}>Your Activity</Text>
            <View style={styles.sellerStatsRow}>
              <View style={styles.sellerStatItem}>
                <Text style={[styles.sellerStatValue, { color: theme.colors.primary }]}>{filteredInventory.length}</Text>
                <Text style={[styles.sellerStatLabel, { color: theme.colors.textSecondary }]}>Products Listed</Text>
              </View>
              <View style={styles.sellerStatItem}>
                <Text style={[styles.sellerStatValue, { color: theme.colors.primary }]}>
                  {legendObservables?.marketplaceListings$ && legendObservables.userId ?
                    Object.values(activeMarketplaceListings)
                      .filter((listing: MarketplaceListing) => {
                        const productForListing = enrichedProductVariants.find(p => p.Id === listing.ProductVariantId);
                        return listing.IsEnabled &&
                          listing.SellerUserId === legendObservables.userId &&
                          (productForListing !== undefined);
                      }).length
                    : 0}
                </Text>
                <Text style={[styles.sellerStatLabel, { color: theme.colors.textSecondary }]}>Active Listings</Text>
              </View>
              <View style={styles.sellerStatItem}>
                <Text style={[styles.sellerStatValue, { color: theme.colors.primary }]}>
                  {platformLocations.filter((loc: PlatformLocation) => loc.IsPOS).length}
                </Text>
                <Text style={[styles.sellerStatLabel, { color: theme.colors.textSecondary }]}>POS Locations</Text>
              </View>
            </View>
          </View>
          */}


          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.products}</Text>
              <Text style={styles.statLabel}>Products</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{platformConnections.length}</Text>
              <Text style={styles.statLabel}>Platforms</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{stats.locations}</Text>
              <Text style={styles.statLabel}>Locations</Text>
            </View>
          </View>
        </Card>
      </Animated.View>

      {/* Integrations Card */}
      <Animated.View entering={FadeInUp.delay(200).duration(500)}>
        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Connected Platforms</Text>
            <TouchableOpacity style={styles.manageBtn} onPress={() => setIsEditMode(!isEditMode)}>
              <Text style={styles.manageBtnText}>
                {isEditMode ? 'Done' : 'Manage'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* --- UPDATED Integrations Rendering --- */}
          {isLoadingConnections ? (
            <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginVertical: 20 }} />
          ) : (
            <View style={styles.integrationsContainer}>
              {/* Map over FETCHED connections, not AVAILABLE_PLATFORMS */}
              {(() => {
                // Calculate filteredConnections first

                // --- DEBUG: Log connections right before filter --- 
                // console.log(`[ProfileScreen PRE-FILTER DEBUG] connections at filter time: ${JSON.stringify(platformConnections)}`);
                // --- END DEBUG ---

                // --- REMOVE THE FILTER BASED ON STATUS ---
                const filteredConnections = platformConnections; // Display all connections
                // --- END REMOVAL ---

                // Perform logging and return JSX
                if (!(platformConnections.length > 0)) {
                  // console.log("[ProfileScreen RENDER DEBUG] connections.length is NOT > 0");
                  // Note: This case might be redundant if filteredConnections handles it, but keep for explicit logging
                } else {
                  // console.log(`[ProfileScreen RENDER DEBUG] connections.length > 0 ? true`);
                }

                // console.log(`[ProfileScreen FILTERED DEBUG] Filtered connections count: ${filteredConnections.length}`);
                // console.log(`[ProfileScreen FILTERED DEBUG] Filtered connections data: ${JSON.stringify(filteredConnections)}`);

                if (filteredConnections.length === 0) {
                  // console.log("[ProfileScreen RENDER DEBUG] No connections after filtering.");
                  // Return null here, the text below will handle the message
                  return null;
                } else {
                  // console.log("[ProfileScreen RENDER DEBUG] Mapping filtered connections...");
                  // Now map the filtered array
                  return filteredConnections.map((connection) => {
                    const platformConfig = AVAILABLE_PLATFORMS.find(p => p.key === connection.PlatformType);
                    if (!platformConfig) {
                      // console.log(`[ProfileScreen MAP DEBUG] Skipping connection ID: ${connection.Id} - No platform config found for type: ${connection.PlatformType}`);
                      return null;
                    }

                    // console.log(`[ProfileScreen MAP DEBUG] Rendering item for connection ID: ${connection.Id}, Name: ${connection.DisplayName || platformConfig.name}`);

                    // --- NEW: Parse Shopify Display Name ---
                    let displayShopName = connection.DisplayName || platformConfig.name;
                    if (connection.PlatformType === 'shopify' && connection.DisplayName.includes('.myshopify.com')) {
                      displayShopName = connection.DisplayName.replace('.myshopify.com', '');
                    }
                    // --- END Parsing ---

                    // Render connection item
                    const PlatformIconComponent = getPlatformIcon(platformConfig.key);

                    return (
                      <View key={connection.Id} style={styles.integrationItem}>


                        {/* Left column: icon + name + status/timestamp */}
                        <View style={styles.integrationLeft}>
                          {/* Platform Icon (SVG) */}
                          <View style={styles.platformIconContainer}>
                            {PlatformIconComponent ? (
                              <PlatformIconComponent width={32} height={32} />
                            ) : (
                              <Icon name="store" size={32} color="#555" />
                            )}
                          </View>

                          <View style={styles.integrationMain}>
                            {/* Display Name */}
                            <Text
                              style={styles.integrationName}
                              numberOfLines={1}
                              ellipsizeMode="tail"
                            >
                              {displayShopName}
                            </Text>

                            {/* Status + Last Synced under name (non-edit mode only) */}
                            {!isEditMode && (
                              <View style={styles.statusContainer}>
                                {(() => {
                                  const statusInfo = getStatusDisplay(connection.Status);
                                  return (
                                    <View style={styles.statusRow}>
                                      {statusInfo.icon === 'loading' ? (
                                        <ActivityIndicator
                                          size="small"
                                          color={statusInfo.color}
                                          style={styles.statusIcon}
                                        />
                                      ) : (
                                        <Icon
                                          name={statusInfo.icon}
                                          size={16}
                                          color={statusInfo.color}
                                          style={styles.statusIcon}
                                        />
                                      )}
                                      <Text
                                        style={[
                                          styles.statusText,
                                          { color: statusInfo.color },
                                        ]}
                                      >
                                        {statusInfo.label}
                                      </Text>
                                    </View>
                                  );
                                })()}

                                {connection.LastSyncSuccessAt && (
                                  <Text style={styles.lastSyncText}>
                                    Last synced: {formatSyncDate(connection.LastSyncSuccessAt)}
                                  </Text>
                                )}
                              </View>
                            )}
                          </View>
                        </View>

                        {/* Right column: action buttons (non-edit mode only) */}
                        {!isEditMode && connection && (

                          <View style={styles.connectionActions}>
                            {/* Pending: Start Scan */}
                            {connection.Status === CONNECTION_STATUS.PENDING && (
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: theme.colors.primary + '20' }]}
                                onPress={() => startPlatformScan(connection.Id, platformConfig.name)}
                              >
                                <Icon name="play-circle" size={18} color={theme.colors.primary} />
                                <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>Start Scan</Text>
                              </TouchableOpacity>
                            )}

                            {/* Review: Review products */}
                            {connection.Status === CONNECTION_STATUS.REVIEW && (
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: '#FF9500' + '20' }]}
                                onPress={() => handleReviewAndSync(connection.Id, platformConfig.name)}
                              >
                                <Icon name="eye" size={18} color="#FF9500" />
                                <Text style={[styles.actionButtonText, { color: '#FF9500' }]}>Review Products</Text>
                              </TouchableOpacity>
                            )}

                            {connection.Status === CONNECTION_STATUS.READY_TO_SYNC && (
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: theme.colors.success + '15' }]}
                                onPress={() => navigation.navigate('MappingReview', { connectionId: connection.Id, platformName: platformConfig.name })}
                              >
                                <Icon name="check-circle" size={18} color={theme.colors.success} />
                                <Text style={[styles.actionButtonText, { color: theme.colors.success }]}>Ready to Sync</Text>
                              </TouchableOpacity>
                            )}

                            {(connection.Status === CONNECTION_STATUS.INACTIVE) && (
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: theme.colors.success + '15' }]}
                                onPress={() => startPlatformScan(connection.Id, platformConfig.name)}
                              >
                                <Icon name="play-circle" size={18} color={theme.colors.success} />
                                <Text style={[styles.actionButtonText, { color: theme.colors.success }]}>Activate</Text>
                              </TouchableOpacity>
                            )}

                            {/* For error state, show context-aware action */}
                            {connection.Status === CONNECTION_STATUS.ERROR && (() => {
                              const recommended = getRecommendedAction(connection, platformConfig.key);

                              const handleAction = () => {
                                switch (recommended.action) {
                                  case 'reconnect':
                                    handleReconnectPlatform(connection.Id, platformConfig.key, platformConfig.name);
                                    break;
                                  case 'rescan':
                                    startPlatformScan(connection.Id, platformConfig.name, true);
                                    break;
                                  case 'fix_resume':
                                    fixAndResumeConnection(connection.Id, platformConfig.name);
                                    break;
                                  case 'manage':
                                    navigation.navigate('MappingReview', {
                                      connectionId: connection.Id,
                                      platformName: platformConfig.name,
                                    });
                                    break;
                                }
                              };

                              return (
                                <TouchableOpacity
                                  style={[styles.actionButton, { backgroundColor: recommended.color + '15' }]}
                                  onPress={handleAction}
                                >
                                  <Icon name={recommended.icon} size={18} color={recommended.color} />
                                  <Text style={[styles.actionButtonText, { color: recommended.color }]}>
                                    {recommended.label}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })()}


                            {/* Active connections: Manage (no reconnect in normal mode - moved to edit mode) */}
                            {connection.Status === CONNECTION_STATUS.ACTIVE && (
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: theme.colors.primary + '15' }]}
                                onPress={() =>
                                  navigation.navigate('MappingReview', {
                                    connectionId: connection.Id,
                                    platformName: platformConfig.name,
                                  })
                                }
                              >
                                <Icon name="cog" size={18} color={theme.colors.primary} />
                                <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>
                                  Manage
                                </Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                        {/* Edit Mode: Refresh Login + Disconnect buttons */}
                        {isEditMode && (
                          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                            {/* Refresh Login - for refreshing OAuth credentials (all OAuth platforms) */}
                            {['square', 'shopify', 'facebook', 'clover', 'ebay'].includes(platformConfig.key) && (
                              <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: theme.colors.primary + '10' }]}
                                onPress={() => handleReconnectPlatform(connection.Id, platformConfig.key, platformConfig.name)}
                              >
                                <Icon name="link-variant" size={18} color={theme.colors.primary} />
                                <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>Reconnect</Text>
                              </TouchableOpacity>
                            )}
                            {/* Disconnect */}
                            <TouchableOpacity
                              style={styles.deleteButton}
                              onPress={() => handleDisconnectPlatform(connection.Id, platformConfig.name)}
                            >
                              <Icon name="minus-circle-outline" size={24} color={theme.colors.error} />
                              <Text style={{ color: "red", fontSize: 14 }}>Disconnect</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                      </View>
                    );
                  });
                }
              })()}

              {/* Render "No active connections yet" text if needed */}
              {/* --- ADJUSTED CONDITION: Show text only if the connections array is truly empty --- */}
              {platformConnections.length === 0 && (
                <Text style={styles.noConnectionsText}>No connections yet.</Text>
              )}
              {/* --- END ADJUSTED CONDITION --- */}
              {/* Always render Add Connection Button (unless error/loading) */}
              <Button
                title="Import Inventory/Connect Platform"
                onPress={() => {
                  console.log('[ProfileScreen] Add Connection button pressed');
                  console.log('[ProfileScreen] Before show - overlay.visible:', overlay.visible);
                  overlay.show();
                  console.log('[ProfileScreen] After show - overlay.visible:', overlay.visible);
                }}
                style={styles.addConnectionButton}
              />
              {/* --- END Add Connection Button --- */}

            </View>
          )}
          {/* --- END UPDATED Integrations Rendering --- */}
        </Card>
      </Animated.View>



      {/* Optimize Listings Card - between Locations and Settings 
      <Animated.View entering={FadeInUp.delay(320).duration(500)}>
        <TouchableOpacity
          style={styles.optimizeCard}
          onPress={() => navigation.navigate('BackfillOptimizer' as any)}
          activeOpacity={0.7}
        >
          <View style={styles.optimizeHeader}>
            <LinearGradient
              colors={['#8cc63f', '#70a826']}
              style={styles.optimizeIconBadge}
            >
              <Icon name="tune" size={20} color="#fff" />
            </LinearGradient>
            <View style={styles.optimizeTextContainer}>
              <Text style={styles.optimizeTitle}>Optimize Listings</Text>
              <Text style={styles.optimizeSubtitle}>Fill missing data for platforms</Text>
            </View>
            <Icon name="chevron-right" size={24} color="#9ca3af" />
          </View>
          <View style={styles.streakBarContainer}>
            <View style={styles.streakBar}>
              <View style={[styles.streakFill, {
                width: `${optimizationSummary && optimizationSummary.total > 0
                  ? Math.round((optimizationSummary.fullyReady / optimizationSummary.total) * 100)
                  : 0}%`
              }]} />
            </View>
            <Text style={styles.streakText}>
              {optimizationSummary && optimizationSummary.total > 0
                ? Math.round((optimizationSummary.fullyReady / optimizationSummary.total) * 100)
                : 0}% complete
            </Text>
          </View>
        </TouchableOpacity>
      </Animated.View>
      */}

      {/* Locations & Pools Card (v2) - render unconditionally; component resolves orgId */}
      <Animated.View entering={FadeInUp.delay(250).duration(500)}>
        <Card style={styles.card}>
          <LocationsManagerV2
            orgId={currentOrg?.id}
            platformConnections={platformConnections}
            disableScroll={true}
            onPressConnect={() => overlay.show()}
          />
        </Card>
      </Animated.View>

      {/* Menu Card */}
      <Animated.View entering={FadeInUp.delay(400).duration(500)}>
        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Settings</Text>
          </View>

          <View style={styles.menuContainer}>
            {menuItems.map((item, index) => renderMenuItem(item, index))}
          </View>
        </Card>
      </Animated.View>

      {/* --- NEW: Add Connection Modal --- */}
      {/* --- Platform Picker Bottom Bar Overlay (no modal) --- */}
      {isAddConnectionModalVisible && (
        <View style={styles.overlayContainer}>
          <Pressable style={styles.overlayBackdrop} onPress={() => setIsAddConnectionModalVisible(false)} />
          <View style={styles.overlayBottomSheet}>
            <BottomNav
              state={'platformPicker'}
              selectedCount={0}
              selectedTemplate={null}
              selectedPlatforms={[]}
              isConnected={(p) => platformConnections.some((c) => c.PlatformType === p && c.Status === 'active')}
              platformActiveCounts={platformActiveCounts}
              onShowSelection={() => { }}
              onShowTemplates={() => { }}
              onBackToEmpty={() => { }}
              onBackToSelection={() => { }}
              onOpenTemplateModal={() => { }}
              onTemplateSelect={() => { }}
              onPlatformToggle={() => { }}
              onGeneratePress={() => { }}
              onStartConnect={(platform) => {
                setIsAddConnectionModalVisible(false);
                if (platform === 'shopify') {
                  setShopifyFlowStep('enterInfo');
                  setPastedShopifyUrl('');
                  setManualShopName('');
                } else if (platform === 'clover') {
                  handleCloverConnect();
                } else if (platform === 'square') {
                  handleSquareConnect();
                } else if (platform === 'facebook') {
                  handleFacebookConnect();
                } else if (platform === 'ebay') {
                  (async () => {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    const finalRedirectUri = 'anorhaapp://auth-callback?platform=ebay';
                    const url = `${SSSYNC_API_BASE_URL}/api/auth/ebay/login?userId=${user.id}&finalRedirectUri=${encodeURIComponent(finalRedirectUri)}`;
                    await WebBrowser.openAuthSessionAsync(url, finalRedirectUri);
                  })();
                } else {
                  Alert.alert('Connect', `Connect logic for ${platform} not implemented yet.`);
                }
              }}
            />

          </View>
        </View>
      )}
      {/* --- END Platform Picker Bottom Bar Overlay --- */}

      {/* --- REVISED: Guided Shopify Flow UI (Single Modal) --- */}
      <Modal
        transparent={true}
        animationType="fade"
        visible={shopifyFlowStep === 'enterInfo'}
        onRequestClose={() => setShopifyFlowStep('idle')}
      >
        <Pressable style={styles.shopifyModalOverlay} onPress={() => setShopifyFlowStep('idle')}>
          <Pressable style={styles.shopifyModalContent} onPress={() => { }}>
            {/* Header with Icon */}
            <View style={styles.shopifyModalHeader}>
              <View style={styles.shopifyIconContainer}>
                <ShopifySvg width={40} height={40} />
              </View>
              <Text style={styles.shopifyModalTitle}>Connect Shopify</Text>
              <TouchableOpacity
                onPress={() => setShopifyFlowStep('idle')}
                style={styles.shopifyCloseButton}
              >
                <Icon name="close" size={24} color="#999" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.shopifyModalBody} showsVerticalScrollIndicator={false}>
              {/* Option 1: Guided Setup */}
              <View style={styles.shopifyOption}>
                <View style={styles.shopifyOptionHeader}>
                  <View style={[styles.stepNumber, { backgroundColor: theme.colors.primary }]}>
                    <Text style={styles.stepNumberText}>1</Text>
                  </View>
                  <Text style={styles.shopifyOptionTitle}>Guided Setup (Recommended)</Text>
                </View>

                <View style={styles.shopifySteps}>
                  <Text style={styles.shopifyStep}>1. Tap to open your Shopify store</Text>
                  <Text style={styles.shopifyStep}>2. Copy your admin URL</Text>
                  <Text style={styles.shopifyStep}>3. Paste it below</Text>
                </View>

                <Button
                  title="Open Shopify"
                  icon="open-in-new"
                  onPress={openShopifyForCopy}
                  style={styles.shopifyOpenButton}
                />

                <View style={styles.shopifyPasteContainer}>
                  <TextInput
                    style={styles.shopifyPasteInput}
                    placeholder="Paste your Shopify admin URL..."
                    placeholderTextColor="#bbb"
                    value={pastedShopifyUrl}
                    onChangeText={(text) => { setPastedShopifyUrl(text); if (text) setManualShopName(''); }}
                    autoCapitalize="none"
                    keyboardType="url"
                    selectTextOnFocus
                  />
                  <TouchableOpacity
                    onPress={handlePasteFromClipboard}
                    style={styles.shopifyPasteButton}
                  >
                    <Icon name="content-paste" size={20} color={theme.colors.primary} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Divider */}
              <View style={styles.shopifyDivider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>

              {/* Option 2: Manual Entry */}
              <View style={styles.shopifyOption}>
                <View style={styles.shopifyOptionHeader}>
                  <View style={[styles.stepNumber, { backgroundColor: '#ccc' }]}>
                    <Text style={styles.stepNumberText}>2</Text>
                  </View>
                  <Text style={styles.shopifyOptionTitle}>Enter Shop Name</Text>
                </View>

                <Text style={styles.shopifyManualDescription}>
                  Enter your shop's name (e.g., <Text style={{ fontWeight: '600' }}>my-store</Text> from <Text style={{ fontFamily: 'Menlo' }}>my-store.myshopify.com</Text>)
                </Text>

                <TextInput
                  style={styles.shopifyManualInput}
                  placeholder="my-store"
                  placeholderTextColor="#bbb"
                  value={manualShopName}
                  onChangeText={(text) => { setManualShopName(text); if (text) setPastedShopifyUrl(''); }}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View style={{ height: 20 }} />
            </ScrollView>

            {/* Action Buttons */}
            <View style={styles.shopifyActionButtons}>
              <Button
                title="Cancel"
                outlined
                onPress={() => {
                  setShopifyFlowStep('idle');
                  setPastedShopifyUrl('');
                  setManualShopName('');
                }}
                style={styles.shopifyCancelButton}
              />
              <Button
                title="Connect Shopify"
                onPress={handleConfirmInput}
                disabled={!pastedShopifyUrl && !manualShopName.trim()}
                style={styles.shopifyConnectButton}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      {/* --- END REVISED Guided Shopify Flow UI --- */}

      <View style={styles.footer}>
        <Text style={styles.versionText}>Anorha v0.1</Text>
      </View>

      {/* Create Location Pool Modal */}
      <CreateLocationPoolModal
        visible={showCreatePool}
        orgId={currentOrg?.id || ''}
        onClose={() => setShowCreatePool(false)}
        onSuccess={() => {
          setRefreshTrigger((prev) => prev + 1);
          loadPools();
        }}
      />

    </ScrollView>
  );
};

export default ProfileScreen;


// Move styles definition here to fix "used before declaration" errors
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB',
  },
  scrollViewContent: {
    padding: 16,
    paddingTop: 60,
    paddingBottom: 50,
  },
  card: {
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginVertical: 16,
  },
  accountHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  accountInfo: {
    flex: 1,
    marginLeft: 16,
  },
  accountName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  accountEmail: {
    fontSize: 14,
    color: '#777',
    marginBottom: 4,
  },
  orgBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  orgLabel: {
    fontSize: 13,
    color: '#999',
    fontWeight: '500',
  },
  orgName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  planBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  planText: {
    fontSize: 12,
    fontWeight: '500',
  },
  editButton: {
    padding: 8,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: '#777',
  },
  statDivider: {
    width: 1,
    height: '100%',
    backgroundColor: '#f0f0f0',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  sectionAction: {
    fontSize: 14,
  },
  integrationsContainer: {
    marginBottom: 8,
  },
  integrationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  integrationLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 3,
  },
  integrationMain: {
    flex: 1,
    flexDirection: "column",
    alignContent: 'flex-start',
    gap: 3,
  },
  platformIconContainer: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    marginRight: 12,
  },
  integrationName: {
    fontSize: 16,
    flex: 1,
    marginRight: 8,
  },
  connectedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  connectedText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 4,
  },
  connectButton: {
    height: 32,
    paddingHorizontal: 12,
    flex: 0,
  },
  connectButtonText: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingIcon: {
    marginRight: 16,
  },
  settingText: {
    fontSize: 16,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuIcon: {
    marginRight: 16,
  },
  menuText: {
    fontSize: 16,
  },
  menuBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  menuBadgeText: {
    fontSize: 12,
    fontWeight: '500',
  },
  footer: {
    alignItems: 'center',
    marginVertical: 24,
  },
  versionText: {
    fontSize: 12,
    color: '#999',
  },
  settingsContainer: {
  },
  menuContainer: {
  },
  errorContainer: {
    padding: 15,
    marginVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 5,
    marginBottom: 10,
  },
  connectedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
  connectedIcon: {
    marginRight: 4,
  },
  manageButton: {
    padding: 4,
    marginLeft: 8,
  },
  disconnectButton: {
    padding: 4,
    marginLeft: 4,
  },
  addConnectionButton: {
    marginTop: 20,
    marginBottom: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 25,
    width: '90%',
    maxWidth: '90%',
    maxHeight: '80%',
    minHeight: '70%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,

  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
    color: '#333',
    textAlign: 'center',
  },
  modalPlatformGridContent: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
  },
  expandedBottomNav: {
    alignItems: 'center',
    gap: 12,
    paddingLeft: 30,
    paddingRight: 30,
    justifyContent: 'space-between',
    marginTop: 10,
    minHeight: 550,
    maxHeight: 600,
    backgroundColor: 'rgb(255, 255, 255)'
  },
  bottomNavStepContainer: {
    alignItems: 'center',
    gap: 12,
    paddingLeft: 30,
    paddingRight: 30,
    marginTop: 10,
    backgroundColor: 'rgba(255, 255, 255, 0)',
    minHeight: 100,
    paddingBottom: 12,
  },
  emptyBottomNavStepContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
    gap: 12,
    maxHeight: 100,
  },
  platformListContainer: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  platformListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  platformListItemDisabled: {
    opacity: 0.5,
  },
  platformListLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  platformListName: {
    fontSize: 16,
    marginLeft: 12,
    color: '#333',
  },
  platformListRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalBottomBar: {
    width: '100%',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  modalBottomBarButton: {
    alignSelf: 'stretch',
    marginTop: 5,
  },
  // --- END revised Add Connection list styles ---
  modalPlatformColumns: {


  },
  modalPlatformColumnsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    width: '100%',
  },
  modalColumn: {
    width: '48%',
  },
  // --- NEW: Styles for Modal Platform Items ---
  modalPlatformCard: {
    width: '100%', // Two columns
    aspectRatio: 1.2, // Adjust aspect ratio
    justifyContent: 'center',
    alignItems: 'center',
    margin: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#ddd',
    backgroundColor: '#fff',

    position: 'relative', // For the checkmark icon positioning
  },
  modalPlatformCardDisabled: {
    opacity: 0.5, // Make disabled cards faded
    backgroundColor: '#f5f5f5',
  },
  modalPlatformName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#555',
    textAlign: 'center',
    marginTop: 8,
  },
  modalConnectedIcon: {
    position: 'absolute',
    top: 5,
    right: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.8)', // Slight background for visibility
    borderRadius: 10,
  },
  // --- END Modal Platform Item Styles ---
  // --- NEW: Styles for Guided Flow --- 
  guidedFlowText: {
    // This style might be replaced by sectionDescription or removed
  },
  // --- END Guided Flow Styles ---
  // --- NEW: Styles for Paste UI ---
  pasteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 15, // Space before confirm button
  },
  pasteInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginRight: 8,
    backgroundColor: '#fff',
  },
  pasteButton: {
    paddingHorizontal: 12,
    height: 42, // Match input height approximately
    justifyContent: 'center', // Center icon vertically if needed
    alignItems: 'center', // Center icon horizontally if needed
    paddingLeft: 10, // Adjust padding for icon spacing
  },
  pasteButtonText: {
    fontSize: 14,
  },
  pasteIcon: {
    // Specific styles for the icon itself if needed
  },
  pasteHintText: {
    fontSize: 12,
    color: '#777',
    marginTop: 4,
    width: '100%', // Take full width
    textAlign: 'right', // Align hint text right below input
  },
  // --- END Paste UI Styles ---
  noConnectionsText: {
    textAlign: 'center',
    color: '#888',
    paddingVertical: 20,
    fontStyle: 'italic',
  },
  promptPasteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
  },
  promptPasteText: {
    flex: 1,
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 10,
  },
  pasteSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8, // Adjusted spacing
    color: '#333',
    alignSelf: 'flex-start', // Align title left
    width: '100%', // Take full width
  },
  manualInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
    backgroundColor: '#fff',
  },
  // --- NEW Styles for Combined Modal & Shadcn feel ---
  inputSection: {
    width: '100%',
    paddingBottom: 20,
  },
  inputSectionManualOnly: { // Style for the container of the manual input only
    width: '100%',
    paddingTop: 15, // Add some space above
    marginTop: -10, // Adjust spacing relative to section above if needed
  },
  manualInputLabel: { // Style for the label above the manual input
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
    fontWeight: '500',
  },
  sectionDescription: {

    fontSize: 14,
    color: '#555',
    marginBottom: 40,
    lineHeight: 20,
  },
  modalButton: {
    alignSelf: 'stretch', // Make buttons take full width within their container
    marginTop: 10,
    // height: 45, // Slightly larger buttons
  },
  manualInputSingle: { // Style for the single manual input field
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
    width: '100%', // Take full width
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '90%',
    marginVertical: 15,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#ddd',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#777',
    fontWeight: '500',
  },
  actionButtonContainer: {
    flexDirection: 'row-reverse', // Put primary action (Connect) on the right
    justifyContent: 'space-between', // Spread buttons
    width: '100%',
    marginTop: 20,
    paddingTop: 20,
    borderTopWidth: 1, // Separator line above actions
    borderTopColor: '#eee',
  },
  cancelButton: {
    // Properly define as a ViewStyle object with real properties
    flex: 0.48, // Take slightly less than half the space
    backgroundColor: '#f5f5f5', // Light gray background
  },
  connectButtonModal: {
    // Properly define as a ViewStyle object with real properties
    flex: 0.48, // Take slightly less than half the space
    marginLeft: 10, // Add some space between buttons
  },
  // --- NEW: Style for Delete Button in Edit Mode ---
  deleteButton: {
    paddingHorizontal: 10, // Add padding to make it easier to tap
    marginRight: 8, // Add some space between delete button and platform icon
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: "row",
    gap: 4,
    backgroundColor: "rgb(255, 226, 226)",
    paddingVertical: 6,
    borderRadius: 4,
  },
  // --- END Style ---
  devModeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
  },
  devModeText: {
    fontSize: 16,
    color: '#555',
  },
  // --- NEW: Styles for Review & Sync Button ---
  reviewSyncButton: {
    marginLeft: 'auto',
  },
  manageText: {
    fontSize: 12,
    fontWeight: '600',
  },
  connectionInfoContainer: {
    flex: 1,
    marginLeft: 8,
  },
  statusContainer: {
    marginTop: -2,
    marginBottom: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    marginRight: 4,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  lastSyncText: {
    fontSize: 11,
    color: '#777',
    marginTop: 2,
  },
  connectionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 32,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  // --- NEW: Overlay styles ---
  overlayContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    zIndex: 9999,
    elevation: 5,
  },
  overlayBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  overlayBottomSheet: {
    backgroundColor: 'rgb(251, 15, 15)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 0,
    maxHeight: '20%',
  },
  // --- END Overlay styles ---
  poolCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  poolHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  poolTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  poolName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  poolDescription: {
    fontSize: 14,
    color: '#666',
  },
  poolBadge: {
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  poolBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  poolConnectionsList: {
    marginTop: 8,
  },
  poolConnectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  poolConnectionInfo: {
    flex: 1,
    marginLeft: 4,
  },
  poolConnectionName: {
    fontSize: 14,
    fontWeight: '500',
  },
  poolConnectionStatus: {
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '500',
  },
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  // Beautiful Shopify Modal Styles
  shopifyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shopifyModalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    width: '88%',
    maxHeight: '85%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 12,
  },
  shopifyModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  shopifyIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#96C740',
    justifyContent: 'center',
    alignItems: 'center',
  },
  shopifyModalTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: '#1a1a1a',
    marginLeft: 12,
  },
  shopifyCloseButton: {
    padding: 8,
    marginRight: -8,
  },
  shopifyModalBody: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  shopifyOption: {
    marginBottom: 24,
  },
  shopifyOptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  stepNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stepNumberText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  shopifyOptionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  shopifySteps: {
    marginLeft: 48,
    marginBottom: 14,
    gap: 8,
  },
  shopifyStep: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  shopifyOpenButton: {
    marginLeft: 48,
    marginBottom: 12,
  },
  shopifyPasteContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 48,
    marginBottom: 0,
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    paddingRight: 4,
  },
  shopifyPasteInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    color: '#333',
  },
  shopifyPasteButton: {
    padding: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  shopifyDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
  },
  shopifyManualDescription: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
    marginBottom: 12,
    marginLeft: 48,
  },
  shopifyManualInput: {
    marginLeft: 48,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    fontSize: 14,
    color: '#333',
    backgroundColor: '#f8f9fa',
  },
  shopifyActionButtons: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  shopifyCancelButton: {
    flex: 1,
  },
  shopifyConnectButton: {
    flex: 1,
  },
  manageBtn: {
    borderWidth: 1,
    borderColor: '#d9d9d9',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f6f6f6',
    minWidth: 20,
  },
  manageBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  // Optimize Listings styles
  optimizeCard: {
    width: '100%',
    backgroundColor: '#fff',
    marginHorizontal: 0,
    marginBottom: 16,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#ffffff68',
    shadowColor: '#8cc63f',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  optimizeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  optimizeIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#70a826ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  optimizeTextContainer: {
    flex: 1,
  },
  optimizeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  optimizeSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  streakBarContainer: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  streakBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    overflow: 'hidden',
  },
  streakFill: {
    height: '100%',
    backgroundColor: '#8cc63f',
    borderRadius: 3,
  },
  streakText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
});


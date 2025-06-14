import React, { useState, useContext, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Modal, Pressable, StyleProp, ViewStyle, ActivityIndicator, TextInput } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import PlaceholderImage from '../components/Placeholder';
import { useNavigation, useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { RealtimeChannel } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto'; // For generating random string
import { showMessage } from 'react-native-flash-message';

import { AuthContext } from '../context/AuthContext';
import { useLegendStateControl } from '../context/LegendStateControlContext';

// --- BEGIN Re-inlined Constants ---
// TODO: Replace placeholder values with your actual credentials and URLs
// const CLOVER_APP_ID = "YOUR_CLOVER_APP_ID"; // REMOVED - Backend handles this
// const CLOVER_FRONTEND_REDIRECT_URI = "sssyncapp://clover-auth-callback"; // REMOVED - Backend handles this
// const CLOVER_AUTHORIZE_URL = "https://sandbox.dev.clover.com/oauth/authorize"; // REMOVED - Backend handles this
// const SSSYNC_CLOVER_CALLBACK_URL = "https://api.sssync.app/api/auth/clover/callback"; // REMOVED - Backend handles this

// const SQUARE_APP_ID = "YOUR_SQUARE_APP_ID"; // REMOVED - Backend handles this
// const SQUARE_FRONTEND_REDIRECT_URI = "sssyncapp://square-auth-callback"; // REMOVED - Backend handles this
// const SQUARE_AUTHORIZE_URL = "https://connect.squareup.com/oauth2/authorize"; // REMOVED - Backend handles this
// const SSSYNC_SQUARE_CALLBACK_URL = "https://api.sssync.app/api/auth/square/callback"; // REMOVED - Backend handles this

const SSSYNC_API_BASE_URL = "https://api.sssync.app"; // Keep if used for constructing backend URLs
// --- END Re-inlined Constants ---

// Define route param types (add other screens/params if needed)
type ProfileScreenRouteParams = {
  Profile: { refresh?: number }; // Define the refresh param as optional number
};

// Type for navigation prop
type ProfileScreenNavigationProp = StackNavigationProp<AppStackParamList>;

// Define available platforms centrally (or import if moved)
const AVAILABLE_PLATFORMS = [
  { key: 'shopify', name: 'Shopify', icon: 'shopping' },
  { key: 'amazon', name: 'Amazon', icon: 'package' },
  { key: 'clover', name: 'Clover', icon: 'leaf' },
  { key: 'square', name: 'Square', icon: 'square-outline' },
  // Add other platforms here as needed
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
  'INVENTORY_WRITE'
].join(' '); // Space-separated string
// --- End Square OAuth Constants ---

// Helper function to generate a random string for OAuth state using expo-crypto
// const generateRandomString = (length: number): string => { // REMOVED - state management might change with backend handling
//   const byteArray = Crypto.getRandomValues(new Uint8Array(length));
//   // Convert byte array to hex string
//   return Array.from(byteArray, (byte: number) => byte.toString(16).padStart(2, '0')).join('');
// };

const getPlatformColor = (platformId: PlatformId): string => {
  switch (platformId) {
    case 'shopify':
      return '#0E8F7F';
    case 'amazon':
      return '#F17F5F';
    case 'clover':
      return '#3CAD46';
    case 'square':
      return '#6C757D';
    default:
      return '#555555';
  }
};

const getIconForPlatform = (platform: PlatformId): string => {
  switch (platform) {
    case 'shopify':
      return 'shopping';
    case 'amazon':
      return 'package';
    case 'clover':
      return 'leaf';
    case 'square':
      return 'square-outline';
    default:
      return 'store';
  }
};

// Add new connection status types and helper functions
const CONNECTION_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  PENDING: 'pending',
  NEEDS_REVIEW: 'needs_review',
  SCANNING: 'scanning',
  ERROR: 'error',
  SYNCING: 'syncing',
  RECONCILING: 'reconciling', // Added for manual resync
  NEW: 'new',           // Added for newly created connections
  RECONNECT: 'reconnect' // Added for reconnecting existing accounts
};

const getStatusDisplay = (status: string, isNewConnection: boolean = false): { label: string, color: string, icon: string } => {
  // For new connections, show a special "New" status regardless of backend status
  if (isNewConnection) {
    return { label: 'New Connection', color: '#30B4FF', icon: 'new-box' };
  }
  
  switch (status?.toLowerCase()) {
    case CONNECTION_STATUS.ACTIVE:
      return { label: 'Connected', color: '#34C759', icon: 'check-circle' };
    case CONNECTION_STATUS.INACTIVE:
      return { label: 'Inactive', color: '#8E8E93', icon: 'pause-circle' };
    case CONNECTION_STATUS.PENDING:
      return { label: 'Setup Needed', color: '#FF9500', icon: 'progress-clock' };
    case CONNECTION_STATUS.NEEDS_REVIEW:
      return { label: 'Products Need Review', color: '#FF3B30', icon: 'sync-alert' };
    case CONNECTION_STATUS.SCANNING:
      return { label: 'Scanning Products...', color: '#5856D6', icon: 'sync' };
    case CONNECTION_STATUS.SYNCING:
      return { label: 'Syncing...', color: '#007AFF', icon: 'sync' };
    case CONNECTION_STATUS.RECONCILING:
      return { label: 'Reconciling...', color: '#5856D6', icon: 'sync' };
    case CONNECTION_STATUS.ERROR:
      return { label: 'Connection Error', color: '#FF3B30', icon: 'alert-circle' };
    case 'reconcile': // Match the string value used in code
      return { label: 'Data Reconciliation Needed', color: '#FF9500', icon: 'sync-alert' };
    case CONNECTION_STATUS.NEW:
      return { label: 'New Connection', color: '#30B4FF', icon: 'new-box' };
    case CONNECTION_STATUS.RECONNECT:
      return { label: 'Reconnecting', color: '#5856D6', icon: 'connection' };
    default:
      return { label: status || 'Unknown', color: '#8E8E93', icon: 'help-circle' };
  }
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
  const authContext = useContext(AuthContext);
  const route = useRoute<RouteProp<ProfileScreenRouteParams, 'Profile'>>();
  const { resetLegendState } = useLegendStateControl();
  
  // For refresh trigger from route params
  const routeRefreshParam = route.params?.refresh || 0;
  const [refreshTrigger, setRefreshTrigger] = useState(routeRefreshParam);
  
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
  // New state for tracking which connections are using fallback data
  const [fallbackConnectionIds, setFallbackConnectionIds] = useState<string[]>([]);
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [shopifyShopName, setShopifyShopName] = useState('');
  const [shopifyFlowStep, setShopifyFlowStep] = useState<ShopifyFlowStep>('idle');
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [showDevOptions, setShowDevOptions] = useState(false);
  const [devMode, setDevMode] = useState(false);
  // --- NEW: State for Add Connection Modal ---
  const [isAddConnectionModalVisible, setIsAddConnectionModalVisible] = useState(false);
  // --- END State ---

  // --- REVISED State for Guided Shopify Flow ---
  type ShopifyFlowStep = 'idle' | 'enterInfo'; // Simplified states
  const [pastedShopifyUrl, setPastedShopifyUrl] = useState('');
  const [manualShopName, setManualShopName] = useState('');
  // --- END REVISED Guided Shopify Flow State ---
  
  const accountInfo = {
    name: 'African Caribbean Seafood',
    email: 'support@theacsm.com',
    plan: 'Business Pro',
  };
  
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
  
  // Move styles definition here to fix "used before declaration" errors
  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#F8F9FB',
    },
    scrollViewContent: {
      padding: 16,
      paddingTop: 60,
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
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: '#f0f0f0',
    },
    integrationIcon: {
      width: 32,
      height: 32,
      marginRight: 12,
    },
    integrationName: {
      fontSize: 16,
      flex: 1,
      marginLeft: 12,
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
      width: '100%', 
      maxWidth: 500,
      maxHeight: '80%',
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
    modalPlatformGrid: { 
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-around', // Better spacing for grid items
        alignItems: 'center',
        width: '100%',
        maxHeight: '70%', 
        marginBottom: 20, // Add space before close button
    },
    // --- NEW: Styles for Modal Platform Items ---
    modalPlatformCard: {
      width: '40%', // Adjust width for grid layout
      aspectRatio: 1.2, // Adjust aspect ratio
      justifyContent: 'center', 
      alignItems: 'center', 
      margin: 10, 
      borderRadius: 12, 
      borderWidth: 1.5, 
      borderColor: '#ddd', 
      backgroundColor: '#fff', 
      padding: 10, 
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
    fallbackIndicator: {
      flexDirection: 'row',
      alignItems: 'center', 
      backgroundColor: theme.colors.warning + '25', // Brighter background for pill
      paddingHorizontal: 10, // More horizontal padding for pill shape
      paddingVertical: 5,    // Vertical padding for pill shape
      borderRadius: 15,      // Fully rounded corners for pill
      marginLeft: 8,
      marginTop: 2, // Add a small top margin if needed to separate from status text
    },
    fallbackText: {
      fontSize: 11, // Slightly larger for better readability in a pill
      color: theme.colors.warning, // Keep warning color for text
      fontWeight: '500', // Make text a bit bolder
      marginLeft: 4, // Adjust spacing from icon if needed
    },
    connectionInfoContainer: {
      flex: 1,
      marginLeft: 8,
    },
    statusContainer: {
      marginBottom: 4,
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
      marginTop: 4,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
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
  });

  // Define loadConnections function that will be used by fetchConnections
  const loadConnections = async () => {
    setIsLoadingConnections(true);
    setFallbackConnectionIds([]); // Reset fallback connections list
    
    try {
      console.log('[ProfileScreen] Attempting to fetch user connections');
      
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
        
        if (data && data.length > 0) {
          // Mark all connections as using fallback data
          const fallbackIds = data.map(conn => conn.Id);
          setFallbackConnectionIds(fallbackIds);
          
          // Use connections from DB
          setPlatformConnections(data);
        } else {
          setPlatformConnections([]);
        }
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

  // --- DEBUG: Add useEffect to log connections state changes ---
  useEffect(() => {
    console.log('[ProfileScreen STATE DEBUG] Connections state updated:', JSON.stringify(platformConnections, null, 2));
  }, [platformConnections]);
  // --- END DEBUG ---

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
            try {
              // 1. Get Auth Token
              const session = await supabase.auth.getSession();
              const token = session?.data.session?.access_token;
              if (!token) {
                throw new Error("Authentication token not found.");
              }

              // 2. Make API Call (ASSUMED ENDPOINT - Backend needs to implement this)
              const response = await fetch(`https://api.sssync.app/api/platform-connections/${connectionId}`, { // <-- BACKEND NEEDS THIS ROUTE
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
              Alert.alert('Disconnected', `${platformName} connection removed.`);
              
              // --- NEW: Reset Legend State to clear out old data ---
              await resetLegendState();
              console.log('[ProfileScreen] Legend state reset successfully.');
              // --- END NEW ---

              // 3. Refresh the connections list
              fetchConnections(); 

            } catch (error: unknown) {
              console.error("[ProfileScreen] Error disconnecting platform:", error);
              const message = error instanceof Error ? error.message : String(error);
              Alert.alert('Error', `Failed to disconnect ${platformName}: ${message}`);
            }
          },
        },
      ]
    );
  };
  // --- END Delete Connection Logic ---

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
    const finalRedirectUri = 'sssyncapp://auth-callback';
    const encodedFinalRedirectUri = encodeURIComponent(finalRedirectUri);

    // Append BOTH userId and finalRedirectUri
    const backendInitiationUrl = `${backendInitiationUrlBase}?userId=${userId}&finalRedirectUri=${encodedFinalRedirectUri}`;

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
    const finalRedirectUri = 'sssyncapp://auth-callback';
    const encodedFinalRedirectUri = encodeURIComponent(finalRedirectUri);

    const directLoginUrl = `${directLoginUrlBase}?userId=${userId}&shop=${extractedShopName}&finalRedirectUri=${encodedFinalRedirectUri}`;
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
      if (trimmedName && !trimmedName.includes(' ')) { // Example validation
         shopNameToConnect = trimmedName;
         isValid = true;
         console.log(`[ProfileScreen] Using manual shop name: ${shopNameToConnect}`);
      } else {
          Alert.alert(
             "Invalid Shop Name",
             "Please enter a valid shop name (usually contains letters, numbers, hyphens, no spaces)."
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
    try {
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!token) {
        throw new Error("Authentication token not found for starting scan.");
      }

      // If this is a reconciliation, first update the status to 'reconciling'
      if (isReconnect) {
        await fetch(`${SSSYNC_API_BASE_URL}/api/platform-connections/${connectionId}/status`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ status: 'reconciling' })
        });
        // Optimistically update local state or just reload after
        loadConnections(); 
      }

      // Show a loading notification
      showStatusNotification('Processing', `Starting scan for ${platformName}...`, 'info');

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
      
      // --- MODIFIED: Show notification and navigate with Job ID ---
      showStatusNotification(
        'Scan Initialized', 
        `Now analyzing products for ${platformName}. You can monitor the progress on the next screen.`,
        'info' // Use 'info' as it's a start, not a final success
      );
      
      console.log(`[ProfileScreen] Successfully initiated scan for ${platformName} (Connection ID: ${connectionId}). Response:`, responseData);
      
      // Navigate to MappingReviewScreen immediately, passing the jobId to monitor progress.
      navigation.navigate('MappingReview', { 
        connectionId, 
        platformName,
        jobId: responseData.jobId, // Pass the jobId from the API response
      });

    } catch (error: unknown) {
      console.error(`[ProfileScreen] Error starting scan for ${platformName}:`, error);
      const message = error instanceof Error ? error.message : String(error);
      
      // Show an error notification
      showStatusNotification('Error', `Could not start scan for ${platformName}: ${message}`, 'danger');
    }
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
      const finalRedirectUri = "sssyncapp://auth/callback?platform=clover"; // App-specific deep link

      // 3. Construct Backend Authorization URL
      const backendAuthUrl = `${SSSYNC_API_BASE_URL}/auth/clover/login?userId=${sssyncUserId}&finalRedirectUri=${encodeURIComponent(finalRedirectUri)}`;
      console.log("[ProfileScreen] Clover Connect: Backend Auth URL:", backendAuthUrl);

      // 4. Open WebBrowser for OAuth flow, listening for finalRedirectUri
      const result = await WebBrowser.openAuthSessionAsync(backendAuthUrl, finalRedirectUri);
      console.log("[ProfileScreen] Clover Connect: WebBrowser result:", result);

      // 5. Handle Callback from finalRedirectUri
      if (result.type === 'success' && result.url) {
        const urlParams = new URLSearchParams(result.url.split('?')[1]);
        const status = urlParams.get('status');
        const message = urlParams.get('message');
        const connectionId = urlParams.get('connectionId'); // Assuming backend might send this

        console.log("[ProfileScreen] Clover Connect: Callback params:", { status, message, connectionId });

        if (status === 'success') {
          Alert.alert("Success", message || "Clover account connected successfully!");
          if (connectionId) {
            console.log(`[ProfileScreen] Clover Connect: Connection ID ${connectionId}. Proceed to start scan.`);
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
      const finalRedirectUri = "sssyncapp://auth/callback?platform=square"; // App-specific deep link

      // 3. Construct Backend Authorization URL
      const backendAuthUrl = `${SSSYNC_API_BASE_URL}/auth/square/login?userId=${sssyncUserId}&finalRedirectUri=${encodeURIComponent(finalRedirectUri)}`;
      console.log("[ProfileScreen] Square Connect: Backend Auth URL:", backendAuthUrl);

      // 4. Open WebBrowser for OAuth flow, listening for finalRedirectUri
      const result = await WebBrowser.openAuthSessionAsync(backendAuthUrl, finalRedirectUri);
      console.log("[ProfileScreen] Square Connect: WebBrowser result:", result);

      // 5. Handle Callback from finalRedirectUri
      if (result.type === 'success' && result.url) {
        const urlParams = new URLSearchParams(result.url.split('?')[1]);
        const status = urlParams.get('status');
        const message = urlParams.get('message');
        const connectionId = urlParams.get('connectionId'); // Assuming backend might send this

        console.log("[ProfileScreen] Square Connect: Callback params:", { status, message, connectionId });

        if (status === 'success') {
          Alert.alert("Success", message || "Square account connected successfully!");
           if (connectionId) {
            console.log(`[ProfileScreen] Square Connect: Connection ID ${connectionId}. Proceed to start scan.`);
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

  // --- NEW: Handler for Review & Sync ---
  const handleReviewAndSync = (connectionId: string, platformName: string) => {
    console.log(`[ProfileScreen] Initiating Review & Sync for Connection ID: ${connectionId}, Platform: ${platformName}`);
    
    // Show a notification that we're opening the review screen
    showStatusNotification('Opening Review', `Preparing product review for ${platformName}...`, 'info');
    
    // Navigate to the MappingReview screen
    navigation.navigate('MappingReview', { connectionId, platformName });
  };
  // --- END Handler for Review & Sync ---

  const handleLogout = async () => {
    console.log("[ProfileScreen] handleLogout initiated..."); // Add log
    try {
      // Call context signOut first (now synchronous state update)
      if (authContext && authContext.signOut) {
        authContext.signOut(); 
        console.log("[ProfileScreen] authContext.signOut() called."); // Add log
      } else {
        console.warn("[ProfileScreen] AuthContext not available during logout.");
      }
      
      // Then sign out from Supabase
      console.log("[ProfileScreen] Calling Supabase signOut..."); // Add log
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("[ProfileScreen] Supabase signOut error:", error); // Log specific error
        throw error; // Re-throw to be caught below
      }
      console.log("[ProfileScreen] Supabase signOut successful."); // Add log
      
      // Then remove local token
      console.log("[ProfileScreen] Removing userToken from AsyncStorage..."); // Add log
      await AsyncStorage.removeItem('userToken');
      console.log("[ProfileScreen] AsyncStorage token removed."); // Add log
      
    } catch (error: unknown) {
      console.error('Logout Error in handleLogout:', error); // Change console message
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert('Logout Error', message);
    }
  };

  const logCurrentUserToken = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error("Error getting session:", error.message);
        return;
      }

      if (session) {
        const accessToken = session.access_token;
        console.log("Current User Access Token:", accessToken);
        // Now you can copy this logged token and paste it into Postman's
        // "Bearer Token" field under the Authorization tab.
      } else {
        console.log("No active user session found.");
      }
    } catch (catchError: any) {
      console.error("Caught unexpected error getting session:", catchError.message);
    }
  };
  
  // Add state for dev mode
  const [isDevMode, setIsDevMode] = useState(false);

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
    { icon: 'credit-card', title: 'Subscription & Billing', badge: 'Pro' },
    { icon: 'shield-check', title: 'Privacy & Security' },
    { icon: 'bell', title: 'Notifications' },
    { icon: 'help-circle', title: 'Help & Support' },
    // Developer Mode switch - its state is independent of the token button now
    {
      icon: 'code',
      title: 'Developer Mode Switch', // Renamed for clarity in this context
      customComponent: (
        <View style={styles.devModeContainer}>
          <Text style={styles.devModeText}>Developer Mode</Text>
          <Switch
            value={isDevMode}
            onValueChange={toggleDevMode}
            trackColor={{ false: '#767577', true: theme.colors.primary }}
          />
        </View>
      )
    },
    // "Show Auth Token" button is now always present
    {
      icon: 'key',
      title: 'Show Auth Token',
      onPress: logCurrentUserToken,
    },
    { icon: 'logout', title: 'Logout', isDestructive: true, onPress: handleLogout },
  ];

  // Modify the menu item rendering to handle custom components
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
  
  // Add this log to see the state value during each render
  console.log('[ProfileScreen] Rendering with shopifyFlowStep:', shopifyFlowStep);
  
  // Add these logs to check the state and menuItems content
  console.log('[ProfileScreen] Rendering - isDevMode:', isDevMode);
  console.log('[ProfileScreen] Rendering - menuItems:', JSON.stringify(menuItems.map(item => ({ title: item.title, hasCustomComponent: !!item.customComponent }))));
  
  // Add a state for the realtime channel
  const [realtimeChannel, setRealtimeChannel] = useState<RealtimeChannel | null>(null);

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

  // Add detection for new connections (created within the last hour)
  const isRecentlyCreated = (connection: PlatformConnection): boolean => {
    const createdAt = new Date(connection.CreatedAt);
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    return createdAt > oneHourAgo;
  };

  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.scrollViewContent}
      showsVerticalScrollIndicator={false}
    >
      <Animated.View entering={FadeInUp.delay(100).duration(500)}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Profile</Text>
        
        {/* Account Card */}
        <Card style={styles.card}>
          <View style={styles.accountHeader}>
            <PlaceholderImage 
              size={64} 
              borderRadius={32} 
              color="#6A5ACD"
              type="gradient"
              text="AC"
            />
            <View style={styles.accountInfo}>
              <Text style={styles.accountName}>{accountInfo.name}</Text>
              <Text style={styles.accountEmail}>{accountInfo.email}</Text>
              <View style={[styles.planBadge, { backgroundColor: theme.colors.primary + '20' }]}>
                <Text style={[styles.planText, { color: theme.colors.primary }]}>{accountInfo.plan}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.editButton}>
              <Icon name="pencil" size={20} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>
          
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>45</Text>
              <Text style={styles.statLabel}>Products</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>4</Text>
              <Text style={styles.statLabel}>Integrations</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>$8.5k</Text>
              <Text style={styles.statLabel}>Revenue</Text>
            </View>
          </View>
        </Card>
      </Animated.View>
      
      {/* Integrations Card */}
      <Animated.View entering={FadeInUp.delay(200).duration(500)}>
        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Connected Platforms</Text>
            <TouchableOpacity onPress={() => setIsEditMode(!isEditMode)}> 
              <Text style={[styles.sectionAction, { color: theme.colors.primary }]}>
                {isEditMode ? 'Done' : 'Edit'}
              </Text>
            </TouchableOpacity>
          </View>
          
          {/* --- UPDATED Integrations Rendering --- */}
          {isLoadingConnections ? (
             <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginVertical: 20 }}/>
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

                      // --- Restore Original Code & Add Edit Mode Logic ---
                      return (
                        <View key={connection.Id} style={styles.integrationItem}>
                          {/* --- Conditional Delete Button (Edit Mode) --- */}
                          {isEditMode && (
                            <TouchableOpacity 
                              style={styles.deleteButton} // Add this style
                              onPress={() => handleDisconnectPlatform(connection.Id, platformConfig.name)} 
                            >
                              <Icon name="minus-circle-outline" size={24} color={theme.colors.error} />
                            </TouchableOpacity>
                          )}
                          {/* --- Platform Icon (using Placeholder for now) --- */}
                           <PlaceholderImage 
                            size={32} 
                            borderRadius={4} 
                            color={getPlatformColor(platformConfig.key)}
                            type="icon"
                            icon={getIconForPlatform(platformConfig.key)} // Keep using this function
                          />
                          {/* --- Display Name (Parsed) --- */}
                          <Text style={styles.integrationName}>{displayShopName}</Text> 
                          
                          {/* --- Conditional Right-Side Elements (Not Edit Mode) --- */}
                          {!isEditMode && connection && (
                            <View style={styles.connectionInfoContainer}>
                              {/* Status display section */}
                              <View style={styles.statusContainer}>
                                {(() => {
                                  // Pass isRecentlyCreated to getStatusDisplay to show a special "New Connection" status
                                  const statusInfo = getStatusDisplay(connection.Status, isRecentlyCreated(connection));
                                  return (
                                    <View style={styles.statusRow}>
                                      <Icon name={statusInfo.icon} size={18} color={statusInfo.color} style={styles.statusIcon} />
                                      <Text style={[styles.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
                                      
                                      {/* Display fallback data indicator */}
                                      {fallbackConnectionIds.includes(connection.Id) && (
                                        <View style={styles.fallbackIndicator}>
                                          <Icon name="cloud-off-outline" size={14} color={theme.colors.warning} />
                                          <Text style={styles.fallbackText}>Using saved data</Text>
                                        </View>
                                      )}
                                    </View>
                                  );
                                })()}
                                
                                {/* Last sync time if available */}
                                {connection.LastSyncSuccessAt && (
                                  <Text style={styles.lastSyncText}>
                                    Last synced: {new Date(connection.LastSyncSuccessAt).toLocaleString()}
                                  </Text>
                                )}
                              </View>
                              
                              {/* Action buttons based on status */}
                              <View style={styles.connectionActions}>
                                {/* For new connections, show a prominent "Start Sync" button */}
                                {isRecentlyCreated(connection) && connection.Status === CONNECTION_STATUS.PENDING && (
                                  <TouchableOpacity 
                                    style={[styles.actionButton, { backgroundColor: theme.colors.primary + '25' }]}
                                    onPress={() => startPlatformScan(connection.Id, platformConfig.name)}
                                  >
                                    <Icon name="rocket-launch" size={18} color={theme.colors.primary} />
                                    <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>Start Initial Sync</Text>
                              </TouchableOpacity>
                                )}

                                {/* For connections that need review (not new), show the Review & Sync button */}
                                {!isRecentlyCreated(connection) && (connection.Status === CONNECTION_STATUS.NEEDS_REVIEW || connection.Status === 'reconcile') && (
                              <TouchableOpacity 
                                    style={[styles.actionButton, { backgroundColor: theme.colors.primary + '15' }]}
                                    onPress={() => handleReviewAndSync(connection.Id, platformConfig.name)}
                              >
                                    <Icon name="sync-alert" size={18} color={theme.colors.primary} />
                                    <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>
                                      {connection.Status === 'reconcile' ? 'Reconcile Data' : 'Review & Sync'}
                                    </Text>
                              </TouchableOpacity>
                                )}
                                
                                {/* For connections in pending state (not new), show "Complete Setup" button */}
                                {!isRecentlyCreated(connection) && connection.Status === CONNECTION_STATUS.PENDING && (
                              <TouchableOpacity 
                                    style={[styles.actionButton, { backgroundColor: theme.colors.secondary + '15' }]}
                                    onPress={() => startPlatformScan(connection.Id, platformConfig.name, false /* Set to false to trigger a scan, not a reconcile */)}
                              >
                                    <Icon name="cog" size={18} color={theme.colors.secondary} />
                                    <Text style={[styles.actionButtonText, { color: theme.colors.secondary }]}>Complete Setup</Text>
                              </TouchableOpacity>
                                )}
                                
                                {connection.Status === CONNECTION_STATUS.INACTIVE && (
                                  <TouchableOpacity 
                                    style={[styles.actionButton, { backgroundColor: theme.colors.success + '15' }]}
                                    onPress={() => startPlatformScan(connection.Id, platformConfig.name)}
                                  >
                                    <Icon name="play-circle" size={18} color={theme.colors.success} />
                                    <Text style={[styles.actionButtonText, { color: theme.colors.success }]}>Activate</Text>
                                  </TouchableOpacity>
                                )}
                                
                                {/* Active connections get a manage button and a reconcile button */}
                                {connection.Status === CONNECTION_STATUS.ACTIVE && (
                                  <>
                                    <TouchableOpacity 
                                      style={[styles.actionButton, { backgroundColor: theme.colors.primary + '15' }]}
                                      onPress={() => navigation.navigate('MappingReview', { connectionId: connection.Id, platformName: platformConfig.name })}
                                    >
                                      <Icon name="cog" size={18} color={theme.colors.primary} />
                                      <Text style={[styles.actionButtonText, { color: theme.colors.primary }]}>Manage</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity 
                                      style={[styles.actionButton, { backgroundColor: theme.colors.secondary + '15' }]}
                                      onPress={() => startPlatformScan(connection.Id, platformConfig.name, true)}
                                    >
                                      <Icon name="sync" size={18} color={theme.colors.secondary} />
                                      <Text style={[styles.actionButtonText, { color: theme.colors.secondary }]}>Reconcile</Text>
                                    </TouchableOpacity>
                                  </>
                                )}
                              </View>
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
                title="Add Connection" 
                onPress={() => setIsAddConnectionModalVisible(true)}
                style={styles.addConnectionButton} 
              />
              {/* --- END Add Connection Button --- */}

              </View>
          )}
          {/* --- END UPDATED Integrations Rendering --- */}
        </Card>
      </Animated.View>
      
      {/* Settings Card */}
      <Animated.View entering={FadeInUp.delay(300).duration(500)}>
        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Settings</Text>
          </View>
          
          <View style={styles.settingsContainer}>
            <View style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Icon name="bell" size={24} color="#555" style={styles.settingIcon} />
                <Text style={styles.settingText}>Notifications</Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={setNotificationsEnabled}
                trackColor={{ false: '#e0e0e0', true: theme.colors.primary + '50' }}
                thumbColor={notificationsEnabled ? theme.colors.primary : '#f4f3f4'}
              />
            </View>
            
            <View style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Icon name="theme-light-dark" size={24} color="#555" style={styles.settingIcon} />
                <Text style={styles.settingText}>Dark Mode</Text>
              </View>
              <Switch
                value={darkModeEnabled}
                onValueChange={setDarkModeEnabled}
                trackColor={{ false: '#e0e0e0', true: theme.colors.primary + '50' }}
                thumbColor={darkModeEnabled ? theme.colors.primary : '#f4f3f4'}
              />
            </View>
          </View>
        </Card>
      </Animated.View>
      
      {/* Menu Card */}
      <Animated.View entering={FadeInUp.delay(400).duration(500)}>
        <Card style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>More</Text>
          </View>
          
          <View style={styles.menuContainer}>
            {menuItems.map((item, index) => renderMenuItem(item, index))}
          </View>
        </Card>
      </Animated.View>
      
      {/* --- NEW: Add Connection Modal --- */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isAddConnectionModalVisible}
        onRequestClose={() => setIsAddConnectionModalVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setIsAddConnectionModalVisible(false)}>
          <Pressable style={styles.modalContent} onPress={() => {}}> 
            <Text style={styles.modalTitle}>Add New Platform Connection</Text>
            
            <View style={styles.modalPlatformGrid}> 
              {AVAILABLE_PLATFORMS.map((platform) => {
                // Check if this platform is already connected and active
                const isAlreadyConnected = platformConnections.some(
                  (conn) => conn.PlatformType === platform.key && conn.Status === 'active'
                );

                return (
                  <TouchableOpacity
                    key={platform.key}
                    style={[
                      styles.modalPlatformCard,
                      isAlreadyConnected && styles.modalPlatformCardDisabled // Style for disabled/connected
                    ]}
                    disabled={isAlreadyConnected} // Disable button if already connected
                    onPress={() => {
                      setIsAddConnectionModalVisible(false); // Close modal
                      if (platform.key === 'shopify') {
                        // Set state to show the combined input modal
                        setShopifyFlowStep('enterInfo');
                        // Clear previous inputs when starting fresh
                        setPastedShopifyUrl('');
                        setManualShopName('');
                      } else {
                        // --- NEW: Call Clover Connect Logic ---
                        if (platform.key === 'clover') {
                          handleCloverConnect();
                        } else if (platform.key === 'square') { // --- NEW: Call Square Connect Logic ---
                          handleSquareConnect();
                        } else {
                           Alert.alert('Connect', `Connect logic for ${platform.name} not implemented yet.`);
                        }
                        // --- END NEW ---                       
                      }
                    }}
                    activeOpacity={isAlreadyConnected ? 1 : 0.7} // Reduce opacity feedback if disabled
                  >
                    <PlaceholderImage 
                      size={40} // Smaller icon for modal grid
                      borderRadius={4} 
                      color={getPlatformColor(platform.key)}
                      type="icon"
                      icon={getIconForPlatform(platform.key)}
                    />
                    <Text style={styles.modalPlatformName}>{platform.name}</Text>
                    {isAlreadyConnected && (
                        <Icon name="check-circle" size={16} color={theme.colors.success} style={styles.modalConnectedIcon} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <Button
              title="Close"
              outlined
              onPress={() => setIsAddConnectionModalVisible(false)}
              style={{ marginTop: 15, alignSelf: 'stretch' }} // Stretch close button
            />
          </Pressable>
        </Pressable>
      </Modal>
      {/* --- END Add Connection Modal --- */}

      {/* --- REVISED: Guided Shopify Flow UI (Single Modal) --- */}
      <Modal
          transparent={true}
          animationType="fade"
          visible={shopifyFlowStep === 'enterInfo'} // Modal visible when in 'enterInfo' state
          onRequestClose={() => setShopifyFlowStep('idle')} // Allow closing via back button etc.
      >
          <Pressable style={styles.modalOverlay} onPress={() => setShopifyFlowStep('idle')}>
            <Pressable style={styles.modalContent} onPress={() => {}}> {/* Prevent closing on inner press */}
              <Text style={styles.modalTitle}>Connect Shopify</Text>

              {/* --- Option A: Guided Copy/Paste --- */}
              <View style={styles.inputSection}>
                 <Text style={styles.sectionTitle}>Option 1: Guided Setup (Recommended)</Text>
                 <Text style={styles.sectionDescription}>
                   1. Tap below to open Shopify. Log in if needed.{"\\n"} {/* Correct newline syntax */}
                   2. Copy the URL from your Shopify Admin dashboard address bar.{"\\n"} {/* Correct newline syntax */}
                   3. Return here and paste the URL below.
                 </Text>
                 <Button
                   title="Open Shopify & Copy URL"
                   onPress={openShopifyForCopy}
                   style={styles.modalButton}
                   // Optional: Add icon
                 />
                 <View style={styles.pasteContainer}>
                    <TextInput
                      style={styles.pasteInput}
                      placeholder="Paste full Shopify URL here..."
                      value={pastedShopifyUrl}
                      onChangeText={(text) => { setPastedShopifyUrl(text); if (text) setManualShopName(''); }} // Clear manual if pasting URL
                      autoCapitalize="none"
                      keyboardType="url"
                      selectTextOnFocus
                    />
                    {/* Replace Text Button with Icon Button */}
                    <TouchableOpacity 
                      onPress={handlePasteFromClipboard} 
                      style={styles.pasteButton} // Reuse/adjust style for Touchable area
                    >
                      <Icon name="content-paste" size={24} color={theme.colors.primary} style={styles.pasteIcon} />
                    </TouchableOpacity>
                 </View>
                 {/* Add clarification text */}
                 <Text style={styles.pasteHintText}>(Paste URL then tap 'Connect Shopify' below)</Text>
              </View>

              {/* --- REVISED Option B: Manual Input (Integrated) --- */}
              <View style={styles.inputSectionManualOnly}>
                 <Text style={styles.manualInputLabel}>Or, enter shop name directly:</Text>
                 {/* <Text style={styles.sectionDescription}>
                   Enter your shop's unique name (e.g., <Text style={{fontWeight: 'bold'}}>your-store-name</Text> from your *.myshopify.com URL or admin URL).
                 </Text> */}
                 <TextInput
                   style={styles.manualInputSingle} // Use existing style
                   placeholder="your-shop-name"
                   value={manualShopName}
                   onChangeText={(text) => { setManualShopName(text); if (text) setPastedShopifyUrl(''); }} // Clear URL if typing name
                   autoCapitalize="none"
                   autoCorrect={false}
                 />
              </View>

              {/* --- Action Buttons --- */}
              <View style={styles.actionButtonContainer}>
                <Button
                    title="Cancel"
                    outlined
                    onPress={() => {
                      setShopifyFlowStep('idle');
                      setPastedShopifyUrl('');
                      setManualShopName('');
                    }}
                    style={{
                      alignSelf: 'stretch',
                      marginTop: 10,
                      flex: 0.48,
                      backgroundColor: '#f5f5f5'
                    }}
                  />
                 <Button
                   title="Connect Shopify"
                   onPress={handleConfirmInput} // Use the single confirm handler
                   // Disable if BOTH URL and manual name are empty or invalid (basic check)
                   disabled={!pastedShopifyUrl && !manualShopName.trim()}
                   style={{
                      alignSelf: 'stretch',
                      marginTop: 10,
                      flex: 0.48,
                      marginLeft: 10
                    }}
                 />
              </View>

            </Pressable>
          </Pressable>
        </Modal>
      {/* --- END REVISED Guided Shopify Flow UI --- */}
      
      <View style={styles.footer}>
        <Text style={styles.versionText}>sssync v1.0.0</Text>
      </View>
    </ScrollView>
  );
};

export default ProfileScreen; 
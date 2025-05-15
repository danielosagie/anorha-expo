import React, { useState, useContext, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Modal, Pressable, StyleProp, ViewStyle, ActivityIndicator, TextInput } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import PlaceholderImage from '../components/Placeholder';
import { useNavigation, useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';
import * as Clipboard from 'expo-clipboard';
import { RealtimeChannel } from '@supabase/supabase-js';

import { AuthContext } from '../context/AuthContext';

// Define route param types (add other screens/params if needed)
type ProfileScreenRouteParams = {
  Profile: { refresh?: number }; // Define the refresh param as optional number
};

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

const ProfileScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<ProfileScreenRouteParams, 'Profile'>>();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);
  const authContext = useContext(AuthContext);
  
  // --- NEW State for Connections ---
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  // --- NEW: State for Add Connection Modal ---
  const [isAddConnectionModalVisible, setIsAddConnectionModalVisible] = useState(false);
  // --- NEW: State for Edit Mode ---
  const [isEditMode, setIsEditMode] = useState(false);
  // --- END State ---

  // --- REVISED State for Guided Shopify Flow ---
  type ShopifyFlowStep = 'idle' | 'enterInfo'; // Simplified states
  const [shopifyFlowStep, setShopifyFlowStep] = useState<ShopifyFlowStep>('idle');
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
  
  // --- Fetch Connections Logic ---
  const fetchConnections = useCallback(async () => {
    // Get user ID inside the function directly
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      console.warn("[ProfileScreen] Fetch connections called without user ID.", userError);
      setConnectionError("User not available.");
      setIsLoadingConnections(false);
      return;
    }
    const currentUserId = user.id;
    console.log("[ProfileScreen] Fetching platform connections for user:", currentUserId);
    setIsLoadingConnections(true);
    setConnectionError(null);

    try {
      // --- TEMPORARY: Direct Supabase Query for Debugging --- 
      console.log("[ProfileScreen DEBUG] Querying Supabase directly for connections...");
      const { data: directData, error: directError } = await supabase
        .from('PlatformConnections') 
        .select('*')
        .eq('UserId', currentUserId); 

      if (directError) {
        console.error("[ProfileScreen DEBUG] Direct Supabase query error:", directError);
      } else {
        console.log("[ProfileScreen DEBUG] Direct Supabase query result:", JSON.stringify(directData, null, 2));
      }
      // --- END TEMPORARY DEBUG --- 

      // 1. Get Auth Token (Still good practice for API calls)
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!token) {
        throw new Error("Authentication token not found.");
      }

      // 2. Make API Call 
      const response = await fetch('https://api.sssync.app/platform-connections', { 
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: `HTTP error! Status: ${response.status}` }));
        throw new Error(errorData.message || `Failed to fetch connections. Status: ${response.status}`);
      }

      const data: PlatformConnection[] = await response.json();
      console.log("[ProfileScreen] Fetched connections:", data);
      setConnections(data || []); // Ensure it's an array

    } catch (error: unknown) {
      console.error("[ProfileScreen] Error fetching connections:", error);
      const message = error instanceof Error ? error.message : String(error);
      setConnectionError(message);
      setConnections([]); // Clear connections on error
    } finally {
      setIsLoadingConnections(false);
    }
  }, []); // Remove user.id dependency, it's fetched inside

  // --- DEBUG: Add useEffect to log connections state changes ---
  useEffect(() => {
    console.log('[ProfileScreen STATE DEBUG] Connections state updated:', JSON.stringify(connections, null, 2));
  }, [connections]);
  // --- END DEBUG ---

  // Fetch connections on initial mount/focus (kept for initial load)
  useFocusEffect(
    useCallback(() => {
      console.log("[ProfileScreen] Focus effect triggered");
      fetchConnections();
      // Dependency array now only includes fetchConnections
    }, [fetchConnections])
  );

  // --- REVISED: Realtime Subscription for Connections ---
  useEffect(() => {
    let channel: RealtimeChannel | null = null;

    const initializeSubscription = async () => {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      
      if (userError || !user) {
        console.error("[ProfileScreen] Cannot setup realtime subscription without user.", userError);
        return;
      }

      const currentUserId = user.id;
      const tableName = 'PlatformConnections'; // Match DB schema (PascalCase)
      const userIdColumn = 'UserId';       // Match DB schema (PascalCase)
      console.log(`[ProfileScreen] Setting up realtime subscription for ${tableName} table, user: ${currentUserId}`);

      channel = supabase
        .channel(`public:${tableName}:${currentUserId}`) // Unique channel name per user
        .on(
          'postgres_changes',
          { 
            event: '*', 
            schema: 'public',
            table: tableName, // Use correct table name
            filter: `${userIdColumn}=eq.${currentUserId}` // Use correct column name
          },
          (payload) => {
            console.log('[ProfileScreen] Realtime change received:', payload);
            // Re-fetch with a slight delay
            setTimeout(() => fetchConnections(), 500); 
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log('[ProfileScreen] Realtime subscribed!');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Use string concatenation to avoid syntax issues
            console.error('[ProfileScreen] Realtime subscription error/closed: ' + status, err);
          } else {
            // Log other statuses for debugging if needed
            console.log(`[ProfileScreen] Realtime status: ${status}`);
          }
        });
    };
    
    initializeSubscription();

    // Cleanup function
    return () => {
      if (channel) {
        const channelToRemove = channel; // Capture channel in closure
        channel = null; // Set to null immediately
        console.log('[ProfileScreen] Removing realtime subscription');
        supabase.removeChannel(channelToRemove)
          .then(() => console.log('[ProfileScreen] Realtime channel removed successfully.'))
          .catch(err => console.error('[ProfileScreen] Error removing realtime channel:', err));
      }
    };
  }, [fetchConnections]);
  // --- END Realtime Subscription ---

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
              const response = await fetch(`https://api.sssync.app/platform-connections/${connectionId}`, { // <-- BACKEND NEEDS THIS ROUTE
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
    const backendInitiationUrlBase = 'https://api.sssync.app/auth/shopify/initiate-store-picker';
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
    const directLoginUrlBase = 'https://api.sssync.app/auth/shopify/login';
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

  const handleLogout = async () => {
    console.log("[ProfileScreen] handleLogout initiated..."); // Add log
    try {
      // Call context signOut first (now synchronous state update)
      if (authContext) {
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
  
  const menuItems = [
    { icon: 'credit-card', title: 'Subscription & Billing', badge: 'Pro' },
    { icon: 'shield-check', title: 'Privacy & Security' },
    { icon: 'bell', title: 'Notifications' },
    { icon: 'help-circle', title: 'Help & Support' },
    { icon: 'information', title: 'About' },
    { icon: 'logout', title: 'Logout', isDestructive: true, onPress: handleLogout },
  ];
  
  // Add this log to see the state value during each render
  console.log('[ProfileScreen] Rendering with shopifyFlowStep:', shopifyFlowStep);
  
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
          ) : connectionError ? (
            <View style={[styles.errorContainer, { backgroundColor: theme.colors.error + '15' }]}>
              <Icon name="alert-circle-outline" size={24} color={theme.colors.error} />
              <Text style={[styles.errorText, { color: '#FFFFFF' }]}>
                Error loading connections: {' '}
                <Text style={{ color: theme.colors.error, fontWeight: 'bold' }}>
                  {connectionError}
                </Text>
              </Text>
              <Button title="Retry" onPress={fetchConnections} outlined style={{ alignSelf: 'center' }}/>
            </View>
          ) : (
          <View style={styles.integrationsContainer}>
              {/* Map over FETCHED connections, not AVAILABLE_PLATFORMS */}
              {(() => {
                // Calculate filteredConnections first
                
                // --- DEBUG: Log connections right before filter --- 
                // console.log(`[ProfileScreen PRE-FILTER DEBUG] connections at filter time: ${JSON.stringify(connections)}`);
                // --- END DEBUG ---

                // --- REMOVE THE FILTER BASED ON STATUS ---
                const filteredConnections = connections; // Display all connections
                // --- END REMOVAL ---

                // Perform logging and return JSX
                if (!(connections.length > 0)) {
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
                          {!isEditMode && (
                            <View style={styles.connectedContainer}> 
                              <Icon name="check-circle" size={18} color={theme.colors.success} style={styles.connectedIcon} />
                              <Text style={[styles.connectedText, { color: theme.colors.success, fontWeight: '600' }]}>Connected</Text>
                              {/* --- REMOVED Manage/Disconnect Buttons from Default View --- */}
                              {/* 
                              <TouchableOpacity style={styles.manageButton} onPress={() => Alert.alert('Manage', `Manage ${platformConfig.name} (Not Implemented)`)}>
                                <Icon name="cog-outline" size={18} color={theme.colors.textSecondary || '#888'} />
                              </TouchableOpacity>
                              <TouchableOpacity 
                                style={styles.disconnectButton} 
                                onPress={() => handleDisconnectPlatform(connection.Id, platformConfig.name)} // Original disconnect still here if needed outside edit mode
                              >
                                <Icon name="close-circle-outline" size={18} color={theme.colors.error} />
                              </TouchableOpacity>
                              */}
                            </View>
                          )}
                        </View>
                      );
                   });
                }
              })()} 

              {/* Render "No active connections yet" text if needed */}
              {/* --- ADJUSTED CONDITION: Show text only if the connections array is truly empty --- */}
              {connections.length === 0 && (
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
            {menuItems.map((item, index) => (
              <TouchableOpacity 
                key={item.title} 
                style={[
                  styles.menuItem,
                  index < menuItems.length - 1 ? styles.menuItemBorder : null
                ]}
                onPress={logCurrentUserToken}
              >
                <View style={styles.menuItemLeft}>
                  <Icon 
                    name={item.icon} 
                    size={24} 
                    color={item.isDestructive ? theme.colors.error : '#555'} 
                    style={styles.menuIcon} 
                  />
                  <Text 
                    style={[
                      styles.menuText, 
                      item.isDestructive ? { color: theme.colors.error } : null
                    ]}
                  >
                    {item.title}
                  </Text>
                </View>
                
                {item.badge ? (
                  <View style={[styles.menuBadge, { backgroundColor: theme.colors.primary + '20' }]}>
                    <Text style={[styles.menuBadgeText, { color: theme.colors.primary }]}>{item.badge}</Text>
                  </View>
                ) : (
                  <Icon name="chevron-right" size={20} color="#999" />
                )}
              </TouchableOpacity>
            ))}
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
                const isAlreadyConnected = connections.some(
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
                        Alert.alert('Connect', `Connect logic for ${platform.name} not implemented.`);
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
    fontSize: 12,
    marginRight: 8,
    fontWeight: '600',
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
});

export default ProfileScreen; 
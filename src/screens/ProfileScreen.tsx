import React, { useState, useContext, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Modal, Pressable, StyleProp, ViewStyle, ActivityIndicator } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import PlaceholderImage from '../components/Placeholder';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import * as WebBrowser from 'expo-web-browser';

import { AuthContext } from '../context/AuthContext';

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
  id: string; // Connection ID
  platformType: PlatformId; // e.g., 'shopify', 'amazon'
  displayName: string; // User-given name for the connection, or default
  status: string; // e.g., 'active', 'inactive', 'error', 'pending'
  // Add other relevant fields from your backend, like createdAt, lastSync etc.
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(false);
  const authContext = useContext(AuthContext);
  
  // --- NEW State for Connections ---
  const [connections, setConnections] = useState<PlatformConnection[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  // --- NEW: State for Add Connection Modal ---
  const [isAddConnectionModalVisible, setIsAddConnectionModalVisible] = useState(false);
  // --- END State ---

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
    console.log("[ProfileScreen] Fetching platform connections...");
    setIsLoadingConnections(true);
    setConnectionError(null);

    try {
      // 1. Get Auth Token
      const session = await supabase.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!token) {
        throw new Error("Authentication token not found.");
      }

      // 2. Make API Call (ASSUMED ENDPOINT - Update if needed)
      const response = await fetch('https://api.sssync.app/platform-connections', { // <-- UPDATE THIS URL
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
  }, []); // Add dependencies if needed, e.g., userId if not using token

  // Fetch connections on initial mount and when screen focuses
  useFocusEffect(
    useCallback(() => {
      fetchConnections();
    }, [fetchConnections])
  );
  // --- END Fetch Connections Logic ---

  const handleConnectShopify = async () => {
    console.log("[ProfileScreen] Initiating Shopify connection via Backend Store Picker...");
    
    // Get User ID directly from Supabase auth
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !user) {
      Alert.alert("Authentication Error", "Could not get user information. Please log in again.");
      console.error("[ProfileScreen] Error getting user from Supabase:", userError);
      return;
    }
    const userId = user.id;
    console.log(`[ProfileScreen] User ID: ${userId}`);

    const backendInitiationUrlBase = 'https://api.sssync.app/auth/shopify/initiate-store-picker';
    const appRedirectUri = 'sssyncapp://auth-callback';
    
    const encodedFinalAppRedirectUri = encodeURIComponent(appRedirectUri);
    const backendInitiationUrl = `${backendInitiationUrlBase}?userId=${userId}&finalRedirectUri=${encodedFinalAppRedirectUri}`;
    
    console.log(`[ProfileScreen] Opening Backend Initiation URL with Expo WebBrowser: ${backendInitiationUrl}`);

    try {
      const result = await WebBrowser.openAuthSessionAsync(
        backendInitiationUrl,
        appRedirectUri
      );

      console.log('[ProfileScreen] WebBrowser Auth Result: ', result);

      if (result.type === 'success' && result.url) {
        console.log("[ProfileScreen] WebBrowser successful redirect URL:", result.url);
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        Alert.alert('Connection Cancelled', 'You cancelled or dismissed the Shopify connection process.');
      }

    } catch (error: unknown) {
       console.error('[ProfileScreen] WebBrowser Error:', error);
       const message = error instanceof Error ? error.message : String(error);
       Alert.alert('Connection Error', `An error occurred opening the browser: ${message}`);
     }
  };

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      
      await AsyncStorage.removeItem('userToken');
      
      if (authContext) {
        await authContext.signOut();
      }
      
    } catch (error: unknown) {
      console.error('Logout Error:', error);
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
            <TouchableOpacity>
              <Text style={[styles.sectionAction, { color: theme.colors.primary }]}>Manage</Text>
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
              {connections.length > 0 ? (
                 connections
                   .filter(conn => conn.status === 'active') // Ensure we only show active connections
                   .map((connection) => {
                      // Find the matching platform config from AVAILABLE_PLATFORMS
                      const platformConfig = AVAILABLE_PLATFORMS.find(p => p.key === connection.platformType);
                      if (!platformConfig) return null; // Skip if config not found

                      return (
                        <View key={connection.id} style={styles.integrationItem}>
                          <PlaceholderImage 
                            size={32} 
                            borderRadius={4} 
                            color={getPlatformColor(platformConfig.key)}
                            type="icon"
                            icon={getIconForPlatform(platformConfig.key)}
                          />
                          {/* Use display name from connection or fallback to config name */}
                          <Text style={styles.integrationName}>{connection.displayName || platformConfig.name}</Text>
                          
                          {/* Keep Connected/Manage/Disconnect logic */}
                          <View style={styles.connectedContainer}> 
                            <Icon name="check-circle" size={18} color={theme.colors.success} style={styles.connectedIcon} />
                            <Text style={[styles.connectedText, { color: theme.colors.success, fontWeight: '600' }]}>Connected</Text>
                            <TouchableOpacity style={styles.manageButton} onPress={() => Alert.alert('Manage', `Manage ${platformConfig.name}`)}>
                              <Icon name="cog-outline" size={18} color={theme.colors.textSecondary || '#888'} />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.disconnectButton} onPress={() => Alert.alert('Disconnect', `Disconnect ${platformConfig.name}?`)}>
                              <Icon name="close-circle-outline" size={18} color={theme.colors.error} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                 })
              ) : (
                  <Text style={styles.noConnectionsText}>No active connections yet.</Text>
              )}
             
              {/* --- NEW: Add Connection Button --- */}    
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
                onPress={item.onPress || (() => {})}
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
                  (conn) => conn.platformType === platform.key && conn.status === 'active'
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
                        handleConnectShopify();
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
  noConnectionsText: { 
    textAlign: 'center',
    color: '#888',
    paddingVertical: 20,
    fontStyle: 'italic',
  },
});

export default ProfileScreen; 
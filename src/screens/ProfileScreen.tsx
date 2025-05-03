import React, { useState, useContext } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, Alert, Modal, TextInput, Pressable, StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import PlaceholderImage from '../components/Placeholder';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import InAppBrowser from 'react-native-inappbrowser-reborn';

import { AuthContext } from '../context/AuthContext';

type PlatformId = 'shopify' | 'amazon' | 'clover' | 'square' | string;

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
  
  const handleConnectShopify = async () => {
    console.log("[ProfileScreen] Initiating Shopify connection via Store Login...");
    
    const backendStoreLoginCallbackUri = 'https://api.sssync.app/auth/shopify/store-login-callback';
    const finalAppRedirectUri = 'sssyncapp://auth-callback';
    
    const encodedBackendCallback = encodeURIComponent(backendStoreLoginCallbackUri);
    const shopifyStoreLoginUrl = `https://accounts.shopify.com/store-login?redirect_uri=${encodedBackendCallback}`;

    console.log(`[ProfileScreen] Opening Shopify Store Login URL: ${shopifyStoreLoginUrl}`);

    try {
      if (await InAppBrowser.isAvailable()) {
        console.log(`[ProfileScreen] Calling InAppBrowser.openAuth with URL: ${shopifyStoreLoginUrl} and Redirect URI: ${finalAppRedirectUri}`);
        const result = await InAppBrowser.openAuth(shopifyStoreLoginUrl, finalAppRedirectUri, {
          ephemeralWebSession: false, 
          showTitle: false,
          enableUrlBarHiding: true,
          enableDefaultShare: false,
        });

        console.log('[ProfileScreen] InAppBrowser Auth Result (browser dismissed): ', result);
        if (result.type === 'cancel') {
           Alert.alert('Connection Cancelled', 'You cancelled the Shopify connection process.');
        }

      } else {
        console.error('[ProfileScreen] InAppBrowser is not available');
        Alert.alert('Error', 'Could not open secure browser. Please try again later.');
      }
    } catch (error: unknown) {
       console.error('[ProfileScreen] InAppBrowser Error:', error);
       const message = error instanceof Error ? error.message : String(error);
       Alert.alert('Connection Error', `An error occurred: ${message}`);
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
          
          <View style={styles.integrationsContainer}>
            {integrations.map((integration, index) => (
              <View key={integration.name} style={styles.integrationItem}>
                <PlaceholderImage 
                  size={32} 
                  borderRadius={4} 
                  color={getPlatformColor(integration.id)}
                  type="icon"
                  icon={getIconForPlatform(integration.id)}
                />
                <Text style={styles.integrationName}>{integration.name}</Text>
                {integration.isConnected ? (
                  <View style={[styles.connectedBadge, { backgroundColor: theme.colors.success + '20' }]}>
                    <Text style={[styles.connectedText, { color: theme.colors.success }]}>Connected</Text>
                  </View>
                ) : (
                  <Button 
                    title="Connect" 
                    outlined 
                    onPress={handleConnectShopify} 
                    style={styles.connectButton} 
                    textStyle={styles.connectButtonText}
                  />
                )}
              </View>
            ))}
          </View>
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
    fontWeight: '500',
  },
  connectButton: {
    height: 32,
    paddingHorizontal: 12,
    flex: 0,
  },
  connectButtonText: {
    fontSize: 12,
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
});

export default ProfileScreen; 
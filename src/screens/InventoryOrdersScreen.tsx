import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, ScrollView, Image, Modal, ActivityIndicator } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import PlaceholderImage from '../components/PlaceholderImage';
import { mockOrders } from '../data/mockData';
import { Platform } from 'react-native';
import { observer } from '@legendapp/state/react';
import { useLegendState } from '../context/LegendStateContext';
import { ProductVariant as ProductVariantData, ProductImage, InventoryLevel, PlatformProductMapping, LegendStateObservables, MarketplaceListing, PlatformLocation, PlatformConnection } from '../utils/SupaLegend';
import { useNavigation } from '@react-navigation/native';
import { AppStackParamList } from '../navigation/AppNavigator';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../../lib/supabase';
// No need to import images, we'll use icons from react-native-vector-icons

type InventoryOrdersScreenNavigationProp = StackNavigationProp<AppStackParamList, 'TabNavigator'>;

// Enhanced ProductVariant type for combined data
type EnrichedProductVariant = ProductVariantData & {
  imageUrl?: string;
  totalQuantity?: number;
  platformNames?: string[]; // Array of PlatformConnectionIds or derived names
  // Platform boolean flags for fast filtering
  OnShopify?: boolean;
  OnSquare?: boolean;
  OnClover?: boolean;
  OnAmazon?: boolean;
  OnEbay?: boolean;
  OnFacebook?: boolean;
};

interface MockOrderItemData {
  id: string;
  platform: string;
  date: string;
  customer: string;
  items: number;
  status: string;
  total: number;
}

// Platform Icons Map
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

const InventoryOrdersScreen = observer(() => {
  const theme = useTheme();
  const navigation = useNavigation<InventoryOrdersScreenNavigationProp>();
  const legendState: LegendStateObservables | null = useLegendState();
  
  const [activeTab, setActiveTab] = useState('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [displayCount, setDisplayCount] = useState(50);
  const ITEMS_PER_LOAD = 20;
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [selectedPlatformType, setSelectedPlatformType] = useState<string | null>(null);
  const [availableLocations, setAvailableLocations] = useState<PlatformLocation[]>([]);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [isLocationDropdownVisible, setIsLocationDropdownVisible] = useState(false);
  const [isLocationSelectModalVisible, setIsLocationSelectModalVisible] = useState(false);
  
  // Real platform connections and locations from Supabase
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [platformLocations, setPlatformLocations] = useState<PlatformLocation[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const legendObservables: LegendStateObservables | null = useLegendState();

  // Fetch real platform connections and locations from Supabase
  useEffect(() => {
    const fetchPlatformData = async () => {
      if (!legendState?.userId) return;
      
      setIsLoadingConnections(true);
      try {
        // Fetch platform connections
        const { data: connectionsData, error: connectionsError } = await supabase
          .from('PlatformConnections')
          .select('*')
          .eq('UserId', legendState.userId);

        if (connectionsError) {
          console.error('[InventoryScreen] Error fetching platform connections:', connectionsError);
        } else {
          console.log('[InventoryScreen] Platform connections fetched:', connectionsData);
          console.log('[InventoryScreen] Enabled connections:', connectionsData?.filter(conn => conn.IsEnabled));
          setPlatformConnections(connectionsData || []);
        }

        // Fetch platform locations for these connections
        if (connectionsData && connectionsData.length > 0) {
          const connectionIds = connectionsData.map(conn => conn.Id);
          const { data: locationsData, error: locationsError } = await supabase
            .from('PlatformLocations')
            .select('*')
            .in('PlatformConnectionId', connectionIds);

          if (locationsError) {
            console.error('[InventoryScreen] Error fetching platform locations:', locationsError);
          } else {
            console.log('[InventoryScreen] Platform locations fetched:', locationsData);
            setPlatformLocations(locationsData || []);
          }
        }
      } catch (error) {
        console.error('[InventoryScreen] Exception fetching platform data:', error);
      } finally {
        setIsLoadingConnections(false);
      }
    };

    fetchPlatformData();
  }, [legendState?.userId]);

  useEffect(() => {
    if (legendState && legendState.productVariants$) {
      const variants = legendState.productVariants$.get() || {};
      console.log('[InventoryScreen - legendState effect] productVariants$ count:', Object.keys(variants).length);
      // console.log('[InventoryScreen - legendState effect] productVariants$ data:', JSON.stringify(variants, null, 2)); // Potentially very verbose
    } else {
      console.log('[InventoryScreen - legendState effect] legendState or productVariants$ not yet available.');
    }
  }, [legendState]);
  
  useEffect(() => {
    const directFetchProducts = async () => {
      if (supabase && legendState?.userId) {
        console.log(`[InventoryScreen - Direct Fetch] Attempting to fetch ProductVariants for UserId: ${legendState.userId}`);
        try {
          const { data, error } = await supabase
            .from('ProductVariants')
            .select('*')
            .eq('UserId', legendState.userId);

          if (error) {
            console.error('[InventoryScreen - Direct Fetch] Error fetching products:', error);
          } else {
            console.log('[InventoryScreen - Direct Fetch] Successfully fetched products directly:', data);
            if (data && data.length === 0) {
              console.warn('[InventoryScreen - Direct Fetch] Direct query returned 0 products for this user.');
            }
          }
        } catch (e) {
            console.error('[InventoryScreen - Direct Fetch] Exception during direct fetch:', e);
        }
      } else {
        console.log('[InventoryScreen - Direct Fetch] Skipping direct fetch: Supabase client or legendState.userId not available.', { hasSupabase: !!supabase, userId: legendState?.userId });
      }
    };

    if (legendState?.userId) {
        directFetchProducts();
    }
  }, [legendState]);
  
  useEffect(() => {
    // This effect will update available locations when a platform type is selected
    if (selectedPlatformType && platformConnections.length > 0) {
      const connectionsOfPlatformType = platformConnections
        .filter((conn: PlatformConnection) => conn.PlatformType === selectedPlatformType);
      
      const relevantConnectionIds = connectionsOfPlatformType.map((conn: PlatformConnection) => conn.Id);
      
      // For Shopify, include both POS and online locations. For others, include all locations.
      const locations = platformLocations
        .filter((loc: PlatformLocation) => relevantConnectionIds.includes(loc.PlatformConnectionId));
      
      setAvailableLocations(locations);
      setIsLocationDropdownVisible(locations.length > 0);
      setSelectedLocationIds([]); // Reset selected locations when platform changes (start with "All" selected)
    } else {
      setAvailableLocations([]);
      setIsLocationDropdownVisible(false);
      setSelectedLocationIds([]);
    }
  }, [selectedPlatformType, platformConnections, platformLocations]);
  
  const activeProductVariants = useMemo(() => {
    if (!legendObservables?.productVariants$) return {};
    return legendObservables.productVariants$.get() || {};
  }, [legendObservables]);

  const activePlatformMappings = useMemo(() => {
    if (!legendObservables?.platformProductMappings$) return {};
    return (legendObservables.platformProductMappings$.get() || {}) as Record<string, PlatformProductMapping>;
  }, [legendObservables]);

  const activeInventoryLevels = useMemo(() => {
    if (!legendObservables?.inventoryLevels$) return {};
    return (legendObservables.inventoryLevels$.get() || {}) as Record<string, InventoryLevel>;
  }, [legendObservables]);

  const activeProductImages = useMemo(() => {
    if (!legendObservables?.productImages$) return {};
    return (legendObservables.productImages$.get() || {}) as Record<string, ProductImage>;
  }, [legendObservables]);

  const activeMarketplaceListings = useMemo(() => {
    if (!legendObservables?.marketplaceListings$) return {};
    return (legendObservables.marketplaceListings$.get() || {}) as Record<string, MarketplaceListing>;
  }, [legendObservables]);
  
  const enrichedProductVariants = useMemo((): EnrichedProductVariant[] => {
    const variants = activeProductVariants;
    const images = activeProductImages;
    const levels = activeInventoryLevels; 
    const mappings = activePlatformMappings;

    if (Object.keys(variants).length === 0 || platformConnections.length === 0) return [];

    let productVariantIdsToDisplay = Object.keys(variants);

    if (selectedPlatformType) {
      // Fast platform filtering using boolean columns or fallback to mapping logic
      const platformFilter = selectedPlatformType.toLowerCase();
      
      productVariantIdsToDisplay = productVariantIdsToDisplay.filter(variantId => {
        const variant = variants[variantId];
        if (!variant) return false;
        
        // First check if platform boolean flags are available
        switch (platformFilter) {
          case 'shopify': 
            if (variant.OnShopify !== undefined) return variant.OnShopify === true;
            break;
          case 'square': 
            if (variant.OnSquare !== undefined) return variant.OnSquare === true;
            break;
          case 'clover': 
            if (variant.OnClover !== undefined) return variant.OnClover === true;
            break;
          case 'amazon': 
            if (variant.OnAmazon !== undefined) return variant.OnAmazon === true;
            break;
          case 'ebay': 
            if (variant.OnEbay !== undefined) return variant.OnEbay === true;
            break;
          case 'facebook': 
            if (variant.OnFacebook !== undefined) return variant.OnFacebook === true;
            break;
        }
        
        // Fallback to existing mapping logic if platform flags aren't available
        const relevantConnectionIds = platformConnections
          .filter((conn: PlatformConnection) => 
            conn.PlatformType.toLowerCase() === selectedPlatformType.toLowerCase() && conn.IsEnabled)
          .map((conn: PlatformConnection) => conn.Id);

        const hasMapping = Object.values(mappings).some((mapping: PlatformProductMapping) => 
          mapping.ProductVariantId === variantId && 
          relevantConnectionIds.includes(mapping.PlatformConnectionId) &&
          mapping.IsEnabled
        );
        
        return hasMapping;
      });
      
      console.log(`[InventoryScreen] Filtered to ${productVariantIdsToDisplay.length} variants for ${selectedPlatformType}`);
    }

    // Apply location filter if specific locations are selected
    if (selectedLocationIds.length > 0 && !selectedLocationIds.includes('all')) {
      productVariantIdsToDisplay = productVariantIdsToDisplay.filter(variantId => {
        return Object.values(levels).some((level: InventoryLevel) => 
          level.ProductVariantId === variantId && 
          selectedLocationIds.includes(level.PlatformLocationId || 'unknown')
        );
      });
      
      console.log(`[InventoryScreen] After location filter: ${productVariantIdsToDisplay.length} variants`);
    }

    const enrichedVariants: EnrichedProductVariant[] = productVariantIdsToDisplay.map(variantId => {
      const variant = variants[variantId];
      const variantImages = Object.values(images).filter((img: ProductImage) => img.ProductVariantId === variantId);
      const imageUrl = variantImages.length > 0 ? variantImages[0].ImageUrl : undefined;

      const variantLevels = Object.values(levels).filter((level: InventoryLevel) => level.ProductVariantId === variantId);
      const totalQuantity = variantLevels.reduce((sum, level) => sum + level.Quantity, 0);

      const variantMappings = Object.values(mappings).filter((mapping: PlatformProductMapping) => mapping.ProductVariantId === variantId);
      const platformNames = variantMappings.map((mapping: PlatformProductMapping) => {
        const connection = platformConnections.find((conn: PlatformConnection) => conn.Id === mapping.PlatformConnectionId);
        return connection ? `${connection.PlatformType} (${connection.DisplayName})` : 'Unknown Platform';
      });

      return {
        ...variant,
        imageUrl,
        totalQuantity,
        platformNames,
      };
    });

    return enrichedVariants;
  }, [activeProductVariants, activeProductImages, activeInventoryLevels, activePlatformMappings, platformConnections, selectedPlatformType, selectedLocationIds]);
  
  const renderInventoryItem = ({ item }: { item: EnrichedProductVariant }) => {
    const navigateToDetail = () => {
      navigation.navigate('ProductDetail', { productId: item.Id });
    };

    return (
      <TouchableOpacity style={styles.gridItem} onPress={navigateToDetail}>
        <Card style={styles.gridItemCard}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.gridItemImage} />
          ) : (
            <PlaceholderImage 
              size={120} 
              borderRadius={8} 
              type="gradient"
              icon="cube"
              color={getRandomColor(item.Id || 'default-id')}
              style={styles.gridItemImage}
            />
          )}
          
          <View style={styles.gridItemDetails}>
            <Text style={styles.gridItemTitle} numberOfLines={2}>{item.Title}</Text>
            <Text style={styles.gridItemPrice}>${item.Price?.toFixed(2) ?? '0.00'}</Text>
            <Text style={styles.gridItemStock}>{item.totalQuantity ?? 0} in stock</Text>
            
            <View style={styles.platformBadges}>
              {(item.platformNames || []).slice(0, 2).map((platformId: string) => {
                const platformDisplayName = platformId.substring(0, 3);
                return (
                  <View 
                    key={platformId} 
                    style={[
                      styles.platformBadge,
                      { backgroundColor: getRandomColor(platformId) }
                    ]}
                  >
                    <Text style={styles.platformBadgeText}>
                      {platformDisplayName[0]?.toUpperCase()}
                    </Text>
                  </View>
                );
              })}
              {(item.platformNames || []).length > 2 && (
                <View style={styles.platformBadgeMore}>
                  <Text style={styles.platformBadgeMoreText}>+{(item.platformNames || []).length - 2}</Text>
                </View>
              )}
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };
  
  const renderOrderItem = ({ item }: { item: MockOrderItemData }) => {
    const trackButtonStyle = {
      backgroundColor: theme.colors.primary + '00'
    };

    return (
      <Card style={styles.orderCard}>
        <View style={styles.orderHeader}>
          <View style={styles.orderIdContainer}>
            <Text style={styles.orderId}>#{item.id || 'Unknown'}</Text>
            <View style={[
              styles.orderPlatformDisplayBadge,
              { backgroundColor: getPlatformColor(item.platform, theme) + '20' }
            ]}>
              <Text style={[
                styles.platformName, 
                { color: getPlatformColor(item.platform, theme) }
              ]}>
                {item.platform || 'Unknown'}
              </Text>
            </View>
          </View>
          <Text style={styles.orderDate}>{formatDate(item.date)}</Text>
        </View>
        
        <View style={styles.customerRow}>
          <View style={styles.customerInfo}>
            <Icon name="account" size={14} color="#777" style={styles.customerIcon} />
            <Text style={styles.customerName}>{item.customer || 'Unknown customer'}</Text>
          </View>
          <Text style={styles.orderItems}>
            {item.items ? `${item.items} item${item.items > 1 ? 's' : ''}` : ''}
          </Text>
        </View>
        
        <View style={styles.orderFooter}>
          <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status, theme) + '20' }]}>
            <Icon 
              name={getStatusIcon(item.status)} 
              size={14} 
              color={getStatusColor(item.status, theme)} 
              style={styles.statusIcon} 
            />
            <Text 
              style={[styles.statusText, { color: getStatusColor(item.status, theme) }]}
            >
              {item.status ? item.status.charAt(0).toUpperCase() + item.status.slice(1) : 'Unknown'}
            </Text>
          </View>
          
          <Text style={styles.orderTotal}>${item.total ? item.total.toFixed(2) : '0.00'}</Text>
        </View>
        
        <View style={styles.divider} />
        
        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => console.log('View details', item.id)}
          >
            <Icon name="information-outline" size={16} color="#777" />
            <Text style={styles.actionButtonText}>Details</Text>
          </TouchableOpacity>
          
          <View style={styles.buttonDivider} />

          <TouchableOpacity 
            style={[styles.actionButton, trackButtonStyle]}
            onPress={() => console.log('Track order', item.id)}
          >
            <Icon name="truck-delivery-outline" size={16} color={theme.colors.primary} />
            <Text style={[styles.actionButtonText, {color: theme.colors.primary}]}>Track</Text>
          </TouchableOpacity>
          
          
        </View>
      </Card>
    );
  };
  
  const getPlatformColor = (platform: string | undefined, theme: any): string => {
    if (!platform) return '#999';
    
    const platformLower = platform.toLowerCase();
    
    if (platformLower.includes('shopify')) return theme.colors.primary;
    if (platformLower.includes('amazon')) return '#F17F5F';
    if (platformLower.includes('ebay')) return '#E53238';
    if (platformLower.includes('clover')) return theme.colors.accent || theme.colors.primary;
    if (platformLower.includes('square')) return '#6C757D';
    if (platformLower.includes('etsy')) return '#F56400';
    if (platformLower.includes('facebook')) return '#1877F2';
    
    return theme.colors.primary;
  };
  
  const getStatusIcon = (status: string | undefined): string => {
    if (!status) return 'help-circle-outline';
    
    const statusLower = status.toLowerCase();
    
    if (statusLower.includes('pending')) return 'timer-sand';
    if (statusLower.includes('processing')) return 'progress-check';
    if (statusLower.includes('intransit') || statusLower.includes('in transit')) return 'truck-delivery';
    if (statusLower.includes('delivered') || statusLower.includes('completed')) return 'check-circle';
    if (statusLower.includes('returned')) return 'keyboard-return';
    if (statusLower.includes('offloaded') || statusLower.includes('off-loaded')) return 'package-variant';
    
    return 'help-circle-outline';
  };
  
  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return 'No date';
    
    const date = new Date(dateString);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) {
      return 'Today';
    }
    
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };
  
  const getStatusColor = (status: string | undefined, theme: any): string => {
    const s = status?.toLowerCase();
    switch (s) {
      case 'delivered':
      case 'completed':
        return theme.colors.success || theme.colors.primary;
      case 'in transit':
      case 'intransit':
        return theme.colors.primary;
      case 'processing':
        return theme.colors.secondary || theme.colors.primary;
      case 'returned':
        return theme.colors.error || theme.colors.primary;
      default:
        return theme.colors.text || '#000000';
    }
  };
  
  const getRandomColor = (id: string | number): string => {
    const colors = ['#4B0082', '#1E90FF', '#32CD32', '#FF8C00', '#8A2BE2', '#20B2AA'];
    const numId = typeof id === 'string' ? 
                  id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 
                  id;
    return colors[numId % colors.length];
  };
  
  const filteredInventory = useMemo(() => {
    return enrichedProductVariants.filter((item: EnrichedProductVariant) => {
      if (searchQuery && item.Title && !item.Title.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [enrichedProductVariants, searchQuery, filterStatus]);
  
  const inventoryToDisplay = useMemo(() => {
    return filteredInventory.slice(0, displayCount);
  }, [filteredInventory, displayCount]);
  
  // Handle infinite scroll
  const handleLoadMore = () => {
    console.log(`[InventoryScreen] Loading more items. Current: ${displayCount}, Total: ${filteredInventory.length}`);
    if (displayCount < filteredInventory.length && !isLoadingMore) {
      setIsLoadingMore(true);
      // Small delay to show loading indicator and prevent multiple calls
      setTimeout(() => {
        setDisplayCount(prevCount => prevCount + ITEMS_PER_LOAD);
        setIsLoadingMore(false);
      }, 500);
    }
  };
  
  console.log('Enriched and Filtered Inventory (in screen):', filteredInventory.length);
  console.log('Inventory to Display:', inventoryToDisplay.length);
  
  const filteredOrders = mockOrders.filter((order: MockOrderItemData) =>
    filterStatus === 'all' || order.status === filterStatus
  );
  
  return (
    <View style={[styles.container, {paddingTop: 60}]}>
      <Animated.View entering={FadeInUp.delay(100).duration(500)}>
        <Text style={[styles.title, { color: theme.colors.text }]}>
          {activeTab === 'inventory' ? 'Inventory' : 'Orders'}
        </Text>
        
        <View style={styles.tabSelector}>
          <TouchableOpacity 
            style={[
              styles.tab, 
              activeTab === 'inventory' && [styles.activeTab, { backgroundColor: theme.colors.primary + '20' }]
            ]}
            onPress={() => setActiveTab('inventory')}
          >
            <Icon 
              name="cube-outline" 
              size={20} 
              color={activeTab === 'inventory' ? theme.colors.primary : '#777'} 
              style={styles.tabIcon}
            />
            <Text style={[
              styles.tabText,
              { color: activeTab === 'inventory' ? theme.colors.primary : '#777' }
            ]}>Inventory</Text>
          </TouchableOpacity>
          
          {/* Orders temporarily disabled */}
        </View>
        
        <View style={styles.searchContainer}>
          <View style={styles.searchBar}>
            <Icon name="magnify" size={20} color="#999" style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder={`Search ${activeTab === 'inventory' ? 'products' : 'orders'}...`}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Icon name="close" size={20} color="#999" />
              </TouchableOpacity>
            ) : null}
          </View>
          
          <TouchableOpacity style={styles.filterButton} onPress={() => setIsFilterModalVisible(true)}>
            <Icon name="filter-variant" size={20} color="#777" />
          </TouchableOpacity>
        </View>
      </Animated.View>
      
      {/* Filter Modal (Original Content) */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={isFilterModalVisible}
        onRequestClose={() => {
          setIsFilterModalVisible(!isFilterModalVisible);
        }}
      >
        <View style={styles.centeredView}>
          <View style={[styles.modalView, {backgroundColor: theme.colors.surface}]}>
            <Text style={[styles.modalText, {color: theme.colors.text}]}>Filter & Sort Options</Text>
            <Text style={{color: theme.colors.textSecondary, marginVertical: 20}}>(Filter controls will go here)</Text>
            <Button title="Apply Filters" onPress={() => setIsFilterModalVisible(false)} />
            <TouchableOpacity style={styles.closeModalButton} onPress={() => setIsFilterModalVisible(false)}>
              <Text style={{color: theme.colors.primary}}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      
      {/* Location Selection Modal */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={isLocationSelectModalVisible}
        onRequestClose={() => setIsLocationSelectModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.centeredView} 
          activeOpacity={1} 
          onPressOut={() => setIsLocationSelectModalVisible(false)} // Close on outer press
        >
          <View style={[styles.modalView, styles.locationSelectModalView, {backgroundColor: theme.colors.surface}]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.modalText, {color: theme.colors.text}]}>Select Locations for {selectedPlatformType}</Text>
            <ScrollView style={styles.locationListScrollView}>
              {/* All Locations Option */}
              <TouchableOpacity 
                style={[styles.locationSelectItem, styles.allLocationItem]}
                onPress={() => {
                  const isAllSelected = selectedLocationIds.length === 0 || selectedLocationIds.length === availableLocations.length;
                  if (isAllSelected) {
                    // If "All" is currently selected, deselect all
                    setSelectedLocationIds([]);
                  } else {
                    // If some or none are selected, select all
                    setSelectedLocationIds(availableLocations.map(loc => loc.Id));
                  }
                }}
              >
                <Icon 
                  name={
                    selectedLocationIds.length === 0 || selectedLocationIds.length === availableLocations.length 
                      ? "checkbox-marked-outline" 
                      : selectedLocationIds.length > 0 
                        ? "minus-box-outline"
                        : "checkbox-blank-outline"
                  }
                  size={24} 
                  color={
                    selectedLocationIds.length === 0 || selectedLocationIds.length === availableLocations.length
                      ? theme.colors.primary 
                      : selectedLocationIds.length > 0 
                        ? theme.colors.warning 
                        : theme.colors.textSecondary
                  }
                  style={styles.checkboxIcon}
                />
                <Text style={[styles.locationNameText, styles.allLocationText, {color: theme.colors.text}]}>
                  All Locations
                </Text>
              </TouchableOpacity>
              
              {/* Individual Location Options */}
              {availableLocations.map(location => (
                <TouchableOpacity 
                  key={location.Id}
                  style={styles.locationSelectItem}
                  onPress={() => {
                    setSelectedLocationIds(prevSelected => {
                      const newSelected = prevSelected.includes(location.Id) 
                        ? prevSelected.filter(id => id !== location.Id)
                        : [...prevSelected, location.Id];
                      
                      // If we now have all locations selected, clear the array to represent "All"
                      if (newSelected.length === availableLocations.length) {
                        return [];
                      }
                      return newSelected;
                    });
                  }}
                >
                  <Icon 
                    name={selectedLocationIds.includes(location.Id) || selectedLocationIds.length === 0 ? "checkbox-marked-outline" : "checkbox-blank-outline"}
                    size={24} 
                    color={selectedLocationIds.includes(location.Id) || selectedLocationIds.length === 0 ? theme.colors.primary : theme.colors.textSecondary}
                    style={styles.checkboxIcon}
                  />
                  <Text style={[styles.locationNameText, {color: theme.colors.text}]}>{location.Name}</Text>
                </TouchableOpacity>
              ))}
              {availableLocations.length === 0 && (
                <Text style={{color: theme.colors.textSecondary, textAlign: 'center', paddingVertical: 20}}>No locations available for this platform.</Text>
              )}
            </ScrollView>
            <Button title="Done" onPress={() => setIsLocationSelectModalVisible(false)} style={{marginTop:10}}/>
          </View>
        </TouchableOpacity>
      </Modal>
      
      {activeTab === 'inventory' && (
        <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
          {/* Clean Apple-inspired Platform Filter */}
          <View style={styles.filtersSection}>
            <Text style={[styles.filtersSectionTitle, { color: theme.colors.text }]}>Platforms</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              style={styles.platformFiltersContainer}
              contentContainerStyle={styles.platformFiltersContent}
            >
              {/* All Filter - Always available */}
              <TouchableOpacity
                key="All"
                style={[
                  styles.platformFilterChip,
                  !selectedPlatformType && {
                    backgroundColor: theme.colors.primary,
                    borderColor: theme.colors.primary,
                  }
                ]}
                onPress={() => setSelectedPlatformType(null)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.platformFilterChipText,
                    !selectedPlatformType && {
                      color: '#FFFFFF',
                      fontWeight: '600'
                    }
                  ]}
                >
                  All
                </Text>
              </TouchableOpacity>

              {/* Dynamic Platform Filters based on actual connections */}
              {['shopify', 'square', 'clover', 'amazon', 'ebay', 'facebook'].map(platformType => {
                // Check if we have any connections of this platform type
                const hasConnection = platformConnections.some((conn: PlatformConnection) => 
                  conn.PlatformType.toLowerCase() === platformType && conn.IsEnabled
                );
                
                // Count how many connections of this type we have
                const connectionCount = platformConnections.filter((conn: PlatformConnection) => 
                  conn.PlatformType.toLowerCase() === platformType && conn.IsEnabled
                ).length;
                
                const displayName = platformType.charAt(0).toUpperCase() + platformType.slice(1);
                
                // Check if this platform is currently selected
                const isSelected = selectedPlatformType?.toLowerCase() === platformType.toLowerCase();
                
                return (
                  <TouchableOpacity
                    key={platformType}
                    style={[
                      styles.platformFilterChip,
                      {
                        opacity: hasConnection ? 1 : 0.4,
                        borderColor: hasConnection ? '#E0E0E0' : '#F0F0F0',
                      },
                      isSelected && hasConnection && {
                        backgroundColor: theme.colors.primary,
                        borderColor: theme.colors.primary,
                      }
                    ]}
                    onPress={() => {
                      if (hasConnection) {
                        // If already selected, deselect it
                        if (isSelected) {
                          setSelectedPlatformType(null);
                        } else {
                          setSelectedPlatformType(displayName);
                        }
                        console.log(`[InventoryScreen] Selected platform: ${displayName}`);
                      }
                    }}
                    activeOpacity={hasConnection ? 0.7 : 1}
                    disabled={!hasConnection}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text
                        style={[
                          styles.platformFilterChipText,
                          {
                            color: hasConnection 
                              ? (isSelected ? '#FFFFFF' : theme.colors.text)
                              : theme.colors.textSecondary,
                          },
                          isSelected && hasConnection && {
                            fontWeight: '600'
                          }
                        ]}
                      >
                        {displayName}
                      </Text>
                      {connectionCount > 1 && (
                        <View style={[
                          styles.connectionCountBadge,
                          isSelected && { backgroundColor: '#FFFFFF' }
                        ]}>
                          <Text style={[
                            styles.connectionCountText,
                            isSelected && { color: theme.colors.primary }
                          ]}>
                            {connectionCount}
                          </Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            
            {/* Location Dropdown - Only show when platform is selected and has locations */}
            {isLocationDropdownVisible && selectedPlatformType && availableLocations.length > 0 && (
              <View style={styles.locationDropdownSection}>
                <Text style={[styles.locationSectionTitle, { color: theme.colors.text }]}>Locations</Text>
                <TouchableOpacity 
                  style={[styles.locationDropdown, { borderColor: theme.colors.textSecondary + '40' }]}
                  onPress={() => setIsLocationSelectModalVisible(true)}
                  activeOpacity={0.7}
                >
                  <View style={styles.locationDropdownContent}>
                    <Icon name="map-marker-outline" size={18} color={theme.colors.textSecondary} />
                    <Text style={[styles.locationDropdownText, { color: theme.colors.text }]}>
                      {selectedLocationIds.length === 0 
                        ? `All Locations` 
                        : selectedLocationIds.length === availableLocations.length
                          ? `All Locations`
                          : selectedLocationIds.length === 1 
                            ? availableLocations.find(loc => loc.Id === selectedLocationIds[0])?.Name
                            : `${selectedLocationIds.length} of ${availableLocations.length} Locations`}
                    </Text>
                  </View>
                  <Icon name="chevron-down" size={18} color={theme.colors.textSecondary} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          <FlatList
            data={inventoryToDisplay} 
            renderItem={renderInventoryItem}
            keyExtractor={item => item.Id.toString()}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.listContent}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={21}
            ListFooterComponent={
              <>
                {isLoadingMore && (
                  <View style={styles.loadingMoreContainer}>
                    <ActivityIndicator size="small" color={theme.colors.primary} />
                    <Text style={[styles.loadingMoreText, { color: theme.colors.textSecondary }]}>
                      Loading more products...
                    </Text>
                  </View>
                )}
                {displayCount < filteredInventory.length && !isLoadingMore && (
                  <TouchableOpacity 
                    style={styles.loadMoreButton}
                    onPress={handleLoadMore}
                  >
                    <Text style={[styles.loadMoreButtonText, { color: theme.colors.primary }]}>
                      Load more ({filteredInventory.length - displayCount} remaining)
                    </Text>
                  </TouchableOpacity>
                )}
                <View style={styles.listFooter} />
              </>
            }
            ListHeaderComponent={
              <>
                {/* Seller Stats Section - Now in ListHeaderComponent */}
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
                        {selectedPlatformType 
                          ? availableLocations.filter(loc => selectedLocationIds.length === 0 || selectedLocationIds.includes(loc.Id)).length
                          : platformLocations.filter((loc: PlatformLocation) => loc.IsPOS).length} 
                      </Text>
                      <Text style={[styles.sellerStatLabel, { color: theme.colors.textSecondary }]}>POS Locations</Text>
                    </View>
                  </View>
                </View>
                
                {/* Categories Section would also go in ListHeaderComponent if enabled */}
              </>
            }
            ListEmptyComponent={
              isLoadingConnections ? (
                <View style={styles.loadingContainer}>
                  <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
                    Loading platform connections...
                  </Text>
                </View>
              ) : (
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  No {activeTab === 'inventory' ? 'products' : 'orders'} found.
                  {selectedPlatformType && ` Try selecting a different platform or location.`}
                </Text>
              )
            }
            /* ListFooterComponent already defined above */
          />
        </Animated.View>
      )}
      
      {activeTab === 'orders' && (
        <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
          <View style={styles.filtersSection}>
            <Text style={[styles.filtersSectionTitle, { color: theme.colors.text }]}>Order Status</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              style={styles.platformFiltersContainer}
              contentContainerStyle={styles.platformFiltersContent}
            >
              {['all', 'Delivered', 'In Transit', 'Processing', 'Returned'].map(status => (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.platformFilterChip,
                    filterStatus === status && {
                      backgroundColor: theme.colors.primary,
                      borderColor: theme.colors.primary,
                    }
                  ]}
                  onPress={() => setFilterStatus(status)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.platformFilterChipText,
                      filterStatus === status && {
                        color: '#FFFFFF',
                        fontWeight: '600'
                      }
                    ]}
                  >
                    {status === 'all' ? 'All' : status}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
          
          <FlatList
            data={filteredOrders}
            renderItem={renderOrderItem}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No orders matching your filters.</Text>
            }
            contentContainerStyle={styles.listContent}
            ListFooterComponent={
              <View style={styles.listFooter} />
            }
          />
        </Animated.View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB',
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginVertical: 16,
  },
  tabSelector: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: '#F0F0F0',
    borderRadius: 8,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
  },
  activeTab: {
    backgroundColor: 'white',
  },
  tabIcon: {
    marginRight: 6,
  },
  tabText: {
    fontWeight: '500',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 48,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
  },
  filterButton: {
    padding: 12,
    backgroundColor: 'white',
    borderRadius: 8,
    marginLeft: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  filtersContainer: {
    marginBottom: 16,
  },

  listContainer: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  gridRow: {
    justifyContent: 'space-between',
    width: '100%',
  },
  gridItem: {
    width: '48%',
    marginBottom: 12,
  },
  gridItemCard: {
    padding: 0,
    overflow: 'hidden',
  },
  gridItemImage: {
    width: '100%',
    height: 120,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
  },
  gridItemDetails: {
    padding: 10,
  },
  gridItemTitle: {
    fontSize: 14,
    fontWeight: '500',

    marginBottom: 4,
  },
  gridItemPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  gridItemStock: {
    fontSize: 12,
    color: '#777',
    marginBottom: 4,
  },
  platformBadges: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  platformBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
  },
  platformBadgeText: {
    fontSize: 10,
    color: 'white',
    fontWeight: 'bold',
  },
  platformBadgeMore: {
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 2,
    backgroundColor: '#777',
  },
  platformBadgeMoreText: {
    fontSize: 10,
    color: 'white',
    fontWeight: 'bold',
  },
  categoriesSection: {
    marginBottom: 16,
  },
  categoriesSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  categoriesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  categoryItem: {
    width: '48%',
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '500',
  },
  sellerStatsSection: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  sellerStatsSectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  sellerStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sellerStatItem: {
    alignItems: 'center',
  },
  sellerStatValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0E8F7F',
  },
  sellerStatLabel: {
    fontSize: 12,
    color: '#777',
    marginTop: 4,
  },
  orderCard: {
    marginBottom: 12,
    borderRadius: 12,
    padding: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  orderIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  orderId: {
    fontSize: 15,
    fontWeight: 'bold',
    marginRight: 8,
  },
  orderDate: {
    fontSize: 13,
    color: '#777',
  },
  customerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  customerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customerIcon: {
    marginRight: 4,
  },
  customerName: {
    fontSize: 14,
    color: '#444',
  },
  orderItems: {
    fontSize: 13,
    color: '#777',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  orderFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  orderPlatformDisplayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  platformName: {
    fontSize: 12,
    fontWeight: '500',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  statusIcon: {
    marginRight: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  orderTotal: {
    fontSize: 15,
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 16,
  },
  actionButtons: {
    flexDirection: 'row',
    height: 44,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDivider: {
    width: 1,
    backgroundColor: '#f0f0f0',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
    color: '#555',
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 16,
    color: '#777',
    padding: 24,
  },
  listFooter: {
    height: 100,
  },
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)', // Semi-transparent background
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 35,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '80%',
  },
  modalText: {
    marginBottom: 15,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
  },
  closeModalButton: {
    marginTop: 10,
    padding: 10,
  },
  // Styles for Location Filter
  locationFilterContainer: {
    marginVertical: 8,
    paddingHorizontal: 8, 
  },
  locationDropdownButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF', // Static white
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0', // Static light gray
  },
  locationDropdownButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333', // Static dark gray
  },
  locationSelectModalView: {
    width: '90%',
    maxHeight: '70%',
  },
  locationListScrollView: {
    width: '100%',
    marginBottom: 10,
  },
  locationSelectItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0', // static light gray
  },
  checkboxIcon: {
    marginRight: 15,
  },
  locationNameText: {
    fontSize: 16,
  },
  allLocationItem: {
    borderBottomWidth: 2,
    borderBottomColor: '#E0E0E0',
    marginBottom: 8,
  },
  allLocationText: {
    fontWeight: '600',
  },
  // New Apple-inspired Filter Styles
  filtersSection: {
    marginBottom: 16,
  },
  filtersSectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 12,
    marginLeft: 8,
  },
  platformFiltersContainer: {
    marginBottom: 16,
  },
  platformFiltersContent: {
    paddingHorizontal: 8,
  },
  platformFilterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
    marginRight: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  platformFilterChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333333',
  },
  locationDropdownSection: {
    marginTop: 8,
  },
  locationSectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 12,
    marginLeft: 8,
  },
  locationDropdown: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    marginHorizontal: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  locationDropdownContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  locationDropdownText: {
    marginLeft: 8,
    fontSize: 15,
    fontWeight: '500',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    textAlign: 'center',
    fontSize: 16,
  },
  connectionCountBadge: {
    backgroundColor: '#F0F0F0',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  connectionCountText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#555555',
  },
  loadingMoreContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingMoreText: {
    marginLeft: 10,
    fontSize: 14,
  },
  loadMoreButton: {
    alignItems: 'center',
    paddingVertical: 15,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  loadMoreButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default InventoryOrdersScreen; 


import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, ScrollView, Image, Modal } from 'react-native';
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
import { ProductVariant as ProductVariantData, ProductImage, InventoryLevel, PlatformProductMapping, LegendStateObservables, MarketplaceListing } from '../utils/SupaLegend';
import { useNavigation } from '@react-navigation/native';
import { AppStackParamList } from '../navigation/AppNavigator';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../../lib/supabase';

type InventoryOrdersScreenNavigationProp = StackNavigationProp<AppStackParamList, 'TabNavigator'>;

// Enhanced ProductVariant type for combined data
type EnrichedProductVariant = ProductVariantData & {
  imageUrl?: string;
  totalQuantity?: number;
  platformNames?: string[]; // Array of PlatformConnectionIds or derived names
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

const InventoryOrdersScreen = observer(() => {
  const theme = useTheme();
  const navigation = useNavigation<InventoryOrdersScreenNavigationProp>();
  const legendState: LegendStateObservables | null = useLegendState();
  
  const [activeTab, setActiveTab] = useState('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [filterStatus, setFilterStatus] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [displayCount, setDisplayCount] = useState(30);
  const ITEMS_PER_LOAD = 10;
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  
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
  
  const enrichedProductVariants = useMemo(() => {
    if (!legendState || 
        !legendState.productVariants$ || 
        !legendState.platformProductMappings$ ||
        !legendState.productImages$ || 
        !legendState.inventoryLevels$ ||
        !legendState.marketplaceListings$) {
      console.log("[InventoryScreen] LegendState or one of its critical observables is not ready for enrichment.");
      return [];
    }
    
    const variants = legendState.productVariants$.get() || {};
    const images = (legendState.productImages$?.get() || {}) as Record<string, ProductImage>;
    const levels = (legendState.inventoryLevels$?.get() || {}) as Record<string, InventoryLevel>;
    const mappings = (legendState.platformProductMappings$?.get() || {}) as Record<string, PlatformProductMapping>;

    console.log("Raw data for enrichment (after defaulting to {} if get() was undefined):", 
      { 
        variantsCount: Object.keys(variants || {}).length, 
        imagesCount: Object.keys(images || {}).length, 
        levelsCount: Object.keys(levels || {}).length, 
        mappingsCount: Object.keys(mappings || {}).length 
      }
    );

    return Object.values(variants).map((variant: ProductVariantData): EnrichedProductVariant => {
      const variantImages = Object.values(images || {}).filter((img: ProductImage) => img.ProductVariantId === variant.Id);
      const primaryImage = variantImages.sort((a: ProductImage, b: ProductImage) => a.Position - b.Position)[0];

      const variantLevels = Object.values(levels || {}).filter((level: InventoryLevel) => level.ProductVariantId === variant.Id);
      const totalQuantity = variantLevels.reduce((sum, level: InventoryLevel) => sum + level.Quantity, 0);

      const variantMappings = Object.values(mappings || {}).filter((mapping: PlatformProductMapping) => mapping.ProductVariantId === variant.Id);
      const platformNames = variantMappings.map(m => m.PlatformConnectionId);

      const enriched = {
        ...variant,
        imageUrl: primaryImage?.ImageUrl,
        totalQuantity: totalQuantity,
        platformNames: platformNames,
      };
      return enriched;
    });
  }, [legendState]);
  
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
          
          <TouchableOpacity 
            style={[
              styles.tab, 
              activeTab === 'orders' && [styles.activeTab, { backgroundColor: theme.colors.primary + '20' }]
            ]}
            onPress={() => setActiveTab('orders')}
          >
            <Icon 
              name="shopping-outline" 
              size={20} 
              color={activeTab === 'orders' ? theme.colors.primary : '#777'} 
              style={styles.tabIcon}
            />
            <Text style={[
              styles.tabText,
              { color: activeTab === 'orders' ? theme.colors.primary : '#777' }
            ]}>Orders</Text>
          </TouchableOpacity>
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
      
      {/* Filter Modal */} 
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
            {/* Add filter controls here: Platform, Stock Status, Sort By etc. */}
            <Text style={{color: theme.colors.textSecondary, marginVertical: 20}}>(Filter controls will go here)</Text>
            <Button title="Apply Filters" onPress={() => setIsFilterModalVisible(false)} />
            <TouchableOpacity style={styles.closeModalButton} onPress={() => setIsFilterModalVisible(false)}>
              <Text style={{color: theme.colors.primary}}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      
      {activeTab === 'inventory' && (
        <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
          <FlatList
            data={inventoryToDisplay}
            renderItem={renderInventoryItem}
            keyExtractor={item => item.Id.toString()}
            numColumns={2}
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersContainer}>
                  {['all', 'Shopify', 'Amazon', 'Ebay', 'Clover', 'Square', 'Facebook'].map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.filterChip,
                        filterStatus === status && { backgroundColor: theme.colors.primary + '20' }
                      ]}
                      onPress={() => setFilterStatus(status)}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          filterStatus === status && { color: theme.colors.primary }
                        ]}
                      >
                        {status === 'all' ? 'All' : status}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={styles.sellerStatsSection}>
                  <Text style={styles.sellerStatsSectionTitle}>Your Activity</Text>
                  <View style={styles.sellerStatsRow}>
                    <View style={styles.sellerStatItem}>
                      <Text style={styles.sellerStatValue}>{Object.keys(legendState?.productVariants$?.get() || {}).length}</Text>
                      <Text style={styles.sellerStatLabel}>Products Listed</Text>
                    </View>
                    <View style={styles.sellerStatItem}>
                      <Text style={styles.sellerStatValue}>
                        {legendState?.marketplaceListings$ ? 
                          Object.values(legendState.marketplaceListings$.get() || {} as Record<string, MarketplaceListing>)
                            .filter(listing => listing.IsEnabled && listing.SellerUserId === legendState.userId).length 
                          : 0}
                      </Text>
                      <Text style={styles.sellerStatLabel}>Active Listings</Text>
                    </View>
                    <View style={styles.sellerStatItem}>
                      <Text style={styles.sellerStatValue}>86%</Text>
                      <Text style={styles.sellerStatLabel}>Response Rate</Text>
                    </View>
                  </View>
                </View>
                
                {/*
                <View style={styles.categoriesSection}>
                  <Text style={styles.categoriesSectionTitle}>Categories</Text>
                  <View style={styles.categoriesGrid}>
                    <TouchableOpacity style={styles.categoryItem}>
                      <View style={[styles.categoryIcon, {backgroundColor: '#0E8F7F20'}]}>
                        <Icon name="tag-outline" size={24} color="#0E8F7F" />
                      </View>
                      <Text style={styles.categoryName}>Clothing</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.categoryItem}>
                      <View style={[styles.categoryIcon, {backgroundColor: '#F17F5F20'}]}>
                        <Icon name="food-apple-outline" size={24} color="#F17F5F" />
                      </View>
                      <Text style={styles.categoryName}>Food</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.categoryItem}>
                      <View style={[styles.categoryIcon, {backgroundColor: '#3CAD4620'}]}>
                        <Icon name="laptop" size={24} color="#3CAD46" />
                      </View>
                      <Text style={styles.categoryName}>Electronics</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.categoryItem}>
                      <View style={[styles.categoryIcon, {backgroundColor: '#865AF020'}]}>
                        <Icon name="sofa-outline" size={24} color="#865AF0" />
                      </View>
                      <Text style={styles.categoryName}>Home</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                */}
              </>
            }
            ListFooterComponent={<View style={styles.listFooter} />}
            onEndReached={() => {
              if (displayCount < filteredInventory.length) {
                console.log('Reached end, loading more inventory items...');
                setDisplayCount(prevCount => Math.min(prevCount + ITEMS_PER_LOAD, filteredInventory.length));
              }
            }}
            onEndReachedThreshold={0.5}
          />
        </Animated.View>
      )}
      
      {activeTab === 'orders' && (
        <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtersContainer}>
            {['all', 'Delivered', 'In Transit', 'Processing', 'Returned'].map(status => (
              <TouchableOpacity
                key={status}
                style={[
                  styles.filterChip,
                  filterStatus === status && { backgroundColor: theme.colors.primary + '20' }
                ]}
                onPress={() => setFilterStatus(status)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    filterStatus === status && { color: theme.colors.primary }
                  ]}
                >
                  {status === 'all' ? 'All' : status}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          
          <FlatList
            data={filteredOrders}
            renderItem={renderOrderItem}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={styles.emptyText}>No orders matching your filters.</Text>
            }
            contentContainerStyle={styles.listContent}
            ListFooterComponent={<View style={styles.listFooter} />}
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
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#EEE',
    marginRight: 8,
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '500',
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
  }
});

export default InventoryOrdersScreen; 

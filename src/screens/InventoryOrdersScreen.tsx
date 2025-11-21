import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ScrollView, Modal, ActivityIndicator, Alert, SafeAreaView } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Button from '../components/Button';
import { mockOrders } from '../data/mockData';
import { observer } from '@legendapp/state/react';
import { useLegendState } from '../context/LegendStateContext';
import { ProductVariant as ProductVariantData, ProductImage, InventoryLevel, PlatformProductMapping, LegendStateObservables, MarketplaceListing, PlatformLocation, PlatformConnection } from '../utils/SupaLegend';
import { useNavigation, useRoute } from '@react-navigation/native';
import { AppStackParamList } from '../navigation/AppNavigator';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import SearchBarWithScanner from '../components/SearchBarWithScanner';
import PlatformFilterChips from '../components/PlatformFilterChips';
import PoolLocationCombobox from '../components/PoolLocationCombobox';
import InventoryListCard from '../components/InventoryListCard';
import SortByDropdown from '../components/SortByDropdown';
import { CameraView } from 'expo-camera';

type InventoryOrdersScreenNavigationProp = StackNavigationProp<AppStackParamList, 'TabNavigator'>;

type EnrichedProductVariant = ProductVariantData & {
  imageUrl?: string;
  totalQuantity?: number;
  platformNames?: string[];
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

const InventoryOrdersScreen = observer(() => {
  const theme = useTheme();
  const navigation = useNavigation<InventoryOrdersScreenNavigationProp>();
  const route = useRoute<any>();
  const legendState: LegendStateObservables | null = useLegendState();

  // Filter & Search State
  const [activeTab, setActiveTab] = useState('inventory');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedPlatformType, setSelectedPlatformType] = useState<string | null>(null);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [barcodeSearchError, setBarcodeSearchError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const scannerResultHandlerRef = useRef<((code: string) => void) | null>(null);

  // Handle route params
  useEffect(() => {
    const p = route.params;
    if (p) {
        console.log('[InventoryOrdersScreen] applying params:', p);
        if (typeof p.initialSearch === 'string') setSearchQuery(p.initialSearch);
        if (p.initialSortBy) setSortBy(p.initialSortBy);
        if (p.initialLocationIds) setSelectedLocationIds(p.initialLocationIds);
        if (p.lowStockOnly !== undefined) setLowStockOnly(p.lowStockOnly);
        
        if (p.openScannerOnMount) {
             setTimeout(() => {
                 setScannerOpen(true);
                 scannerResultHandlerRef.current = (code: string) => {
                    handleBarcodeScan(code);
                    setScannerOpen(false);
                    scannerResultHandlerRef.current = null;
                 };
             }, 100);
        }
        
        if (p.openLocationPicker) {
             setLocationPickerOpen(true);
        }
    }
  }, [route.params]);

  // Loading & Data State
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [platformLocations, setPlatformLocations] = useState<PlatformLocation[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [displayCount, setDisplayCount] = useState(50);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const ITEMS_PER_LOAD = 20;

  const legendObservables: LegendStateObservables | null = useLegendState();

  // Fetch platform connections and locations
  useEffect(() => {
    const fetchPlatformData = async () => {
      if (!legendState?.userId) return;

      setIsLoadingConnections(true);
      try {
        const { data: connectionsData, error: connectionsError } = await supabase
          .from('PlatformConnections')
          .select('*')
          .eq('UserId', legendState.userId);

        if (connectionsError) {
          console.error('[InventoryScreen] Error fetching platform connections:', connectionsError);
        } else {
          setPlatformConnections(connectionsData || []);
        }

        if (connectionsData && connectionsData.length > 0) {
          const connectionIds = connectionsData.map(conn => conn.Id);
          const { data: locationsData, error: locationsError } = await supabase
            .from('PlatformLocations')
            .select('*')
            .in('PlatformConnectionId', connectionIds);

          if (locationsError) {
            console.error('[InventoryScreen] Error fetching platform locations:', locationsError);
          } else {
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
    const directFetchProducts = async () => {
      if (supabase && legendState?.userId) {
        try {
          const { data, error } = await supabase
            .from('ProductVariants')
            .select('*')
            .eq('UserId', legendState.userId);

          if (error) {
            console.error('[InventoryScreen - Direct Fetch] Error fetching products:', error);
          } else {
            console.log('[InventoryScreen - Direct Fetch] Successfully fetched products:', data?.length);
          }
        } catch (e) {
          console.error('[InventoryScreen - Direct Fetch] Exception during direct fetch:', e);
        }
      }
    };

    if (legendState?.userId) {
      directFetchProducts();
    }
  }, [legendState]);

  // Direct access to observables - observer() will track these automatically for reactivity
  const activeProductVariants = legendObservables?.productVariants$?.get() || {};
  const activePlatformMappings = (legendObservables?.platformProductMappings$?.get() || {}) as Record<string, PlatformProductMapping>;
  const activeInventoryLevels = (legendObservables?.inventoryLevels$?.get() || {}) as Record<string, InventoryLevel>;
  const activeProductImages = (legendObservables?.productImages$?.get() || {}) as Record<string, ProductImage>;
  const activeMarketplaceListings = (legendObservables?.marketplaceListings$?.get() || {}) as Record<string, MarketplaceListing>;

  const enrichedProductVariants = useMemo((): EnrichedProductVariant[] => {
    const variants = activeProductVariants;
    const images = activeProductImages;
    const levels = activeInventoryLevels;
    const mappings = activePlatformMappings;

    if (Object.keys(variants).length === 0 || platformConnections.length === 0) return [];

    let productVariantIdsToDisplay = Array.from(new Set(Object.keys(variants)));

    // Filter by platform
    if (selectedPlatformType) {
      const platformFilter = selectedPlatformType.toLowerCase();
      productVariantIdsToDisplay = productVariantIdsToDisplay.filter(variantId => {
        const variant = variants[variantId];
        if (!variant) return false;

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
    }

    // Filter by location
    if (selectedLocationIds.length > 0) {
      productVariantIdsToDisplay = productVariantIdsToDisplay.filter(variantId => {
        return Object.values(levels).some((level: InventoryLevel) =>
          level.ProductVariantId === variantId &&
          selectedLocationIds.includes(level.PlatformLocationId || 'unknown')
        );
      });
    }

    const enrichedVariants: EnrichedProductVariant[] = productVariantIdsToDisplay.map(variantId => {
      const variant = variants[variantId];
      const variantImages = Object.values(images).filter((img: ProductImage) => img.ProductVariantId === variantId);
      const imageUrl = variantImages.length > 0 ? variantImages[0].ImageUrl : undefined;

      const variantLevels = Object.values(levels).filter((level: InventoryLevel) => level.ProductVariantId === variantId);
      const totalQuantity = variantLevels.reduce((sum, level) => sum + level.Quantity, 0);

      // Use the actual boolean flags from ProductVariants to determine platform status
      const platformNames: string[] = [];
      if (variant.OnShopify) platformNames.push('shopify');
      if (variant.OnSquare) platformNames.push('square');
      if (variant.OnClover) platformNames.push('clover');
      if (variant.OnAmazon) platformNames.push('amazon');
      if (variant.OnEbay) platformNames.push('ebay');
      if (variant.OnFacebook) platformNames.push('facebook');

      return {
        ...variant,
        imageUrl,
        totalQuantity,
        platformNames,
      };
    });

    // Deduplicate by Id to prevent duplicates (defensive coding for real-time updates)
    // Keep the most recent version (last one encountered) to ensure we have latest updates
    const uniqueVariants = new Map<string, EnrichedProductVariant>();
    enrichedVariants.forEach(variant => {
      // Always set (overwrite) to ensure we get the latest version
      uniqueVariants.set(variant.Id, variant);
    });

    return Array.from(uniqueVariants.values());
  }, [activeProductVariants, activeProductImages, activeInventoryLevels, activePlatformMappings, platformConnections, selectedPlatformType, selectedLocationIds, legendObservables]);

  // Apply search and sort filters
  const filteredInventory = useMemo(() => {
    let filtered = enrichedProductVariants;

    // Search by title
    if (searchQuery) {
      filtered = filtered.filter((item: EnrichedProductVariant) =>
        item.Title?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Low stock filter
    if (lowStockOnly && !searchQuery) {
       filtered = filtered.filter((item: EnrichedProductVariant) => 
         (item.totalQuantity || 0) <= 5
       );
    }

    // Barcode search
    if (scannedBarcode && !searchQuery) {
      filtered = filtered.filter((item: EnrichedProductVariant) =>
        item.Barcode?.toLowerCase().includes(scannedBarcode.toLowerCase())
      );

      if (filtered.length === 0) {
        setBarcodeSearchError(`No product found with barcode: ${scannedBarcode}`);
      } else {
        setBarcodeSearchError(null);
      }
    }

    // Sort
    switch (sortBy) {
      case 'name':
        filtered.sort((a, b) => (a.Title || '').localeCompare(b.Title || ''));
        break;
      case 'price-low':
        filtered.sort((a, b) => (a.Price || 0) - (b.Price || 0));
        break;
      case 'price-high':
        filtered.sort((a, b) => (b.Price || 0) - (a.Price || 0));
        break;
      case 'stock-low':
        filtered.sort((a, b) => (a.totalQuantity || 0) - (b.totalQuantity || 0));
        break;
      case 'stock-high':
        filtered.sort((a, b) => (b.totalQuantity || 0) - (a.totalQuantity || 0));
        break;
      case 'date':
      default:
        // Keep existing order
        break;
    }

    return filtered;
  }, [enrichedProductVariants, searchQuery, scannedBarcode, sortBy]);

  const inventoryToDisplay = useMemo(() => {
    return filteredInventory.slice(0, displayCount);
  }, [filteredInventory, displayCount]);

  const handleLoadMore = () => {
    if (displayCount < filteredInventory.length && !isLoadingMore) {
      setIsLoadingMore(true);
      setTimeout(() => {
        setDisplayCount(prevCount => prevCount + ITEMS_PER_LOAD);
        setIsLoadingMore(false);
      }, 500);
    }
  };

  const handleBarcodeScan = (barcode: string) => {
    setScannedBarcode(barcode);
    setSearchQuery('');
    // New: Make API call to search backend for barcode
    searchBarcodeOnBackend(barcode);
  };

  const searchBarcodeOnBackend = async (barcode: string) => {
    try {
      setBarcodeSearchError(null);
      console.log(`[InventoryOrdersScreen] Searching backend for barcode: ${barcode}`);

      const token = await ensureSupabaseJwt();
      if (!token) {
        setBarcodeSearchError('Authentication required. Please log in again.');
        return;
      }

      const response = await fetch(`https://api.sssync.app/api/products/search-by-barcode?barcode=${encodeURIComponent(barcode)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          setBarcodeSearchError(`Product not found with barcode: ${barcode}`);
        } else {
          setBarcodeSearchError(`Search failed: ${response.statusText}`);
        }
        setScannedBarcode(null);
        return;
      }

      const data = await response.json();

      if (data.error) {
        setBarcodeSearchError(data.error);
        setScannedBarcode(null);
        return;
      }

      console.log(`[InventoryOrdersScreen] Backend found variant:`, data.variant);
      // Result will be used in filteredInventory below
      // Don't clear the scannedBarcode - it's already set and will filter the list
    } catch (error) {
      console.error(`[InventoryOrdersScreen] Barcode search error:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setBarcodeSearchError(`Error searching for barcode: ${errorMessage}`);
      setScannedBarcode(null);
    }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    setScannedBarcode(null);
    setBarcodeSearchError(null);
  };

  const handleSearchClear = () => {
    setSearchQuery('');
    setScannedBarcode(null);
    setBarcodeSearchError(null);
  };

  const renderInventoryItem = ({ item }: { item: EnrichedProductVariant }) => {
    const navigateToDetail = () => {
      navigation.navigate('ProductDetail', { productId: item.Id });
    };

    return (
      <InventoryListCard
        id={item.Id}
        title={item.Title}
        price={item.Price}
        sku={item.Sku}
        imageUrl={item.imageUrl}
        totalQuantity={item.totalQuantity}
        platformNames={item.platformNames}
        onPress={navigateToDetail}
      />
    );
  };

  const renderOrderItem = ({ item }: { item: MockOrderItemData }) => {
    const trackButtonStyle = {
      backgroundColor: theme.colors.primary + '00'
    };

    return (
      <TouchableOpacity
        onPress={() => {}}
        activeOpacity={0.7}
      >
        <Text style={[styles.mockOrderText, { color: theme.colors.textSecondary }]}>
          Orders view coming soon
        </Text>
      </TouchableOpacity>
    );
  };

  const filteredOrders = mockOrders.filter((order: MockOrderItemData) =>
    filterStatus === 'all' || order.status === filterStatus
  );

  const platformsForChips = ['shopify', 'square', 'clover', 'amazon', 'ebay', 'facebook']
    .map(platformType => {
      const connectionCount = platformConnections.filter((conn: PlatformConnection) =>
        conn.PlatformType.toLowerCase() === platformType && conn.IsEnabled
      ).length;

      return {
        name: platformType,
        type: platformType,
        connectionCount,
      };
    })
    .filter(p => p.connectionCount > 0);

  return (
    <View style={[styles.background]}>

    
      <View style={[styles.container, { marginTop: 60, paddingTop: 20, backgroundColor: "#FFF", }]}>

        {activeTab === 'inventory' && (
          <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
            {/* Search Bar with Scanner */}
            <View style={{ paddingHorizontal: 16, marginBottom: 8, backgroundColor: "#FFF",}}>
              <SearchBarWithScanner
                placeholder="Search for a product"
                value={searchQuery}
                onChangeText={handleSearchChange}
                onScan={handleBarcodeScan}
                onScannerOpen={() => {
                  console.log('[InventoryOrdersScreen] Scanner button pressed, opening scanner');
                  setScannerOpen(true);
                  scannerResultHandlerRef.current = (code: string) => {
                    handleBarcodeScan(code);
                    setScannerOpen(false);
                    scannerResultHandlerRef.current = null;
                  };
                }}
                onClear={handleSearchClear}
              />

              {/* Barcode Search Error Message */}
              {barcodeSearchError && (
                <View style={[styles.errorMessage, { backgroundColor: theme.colors.error + '15' }]}>
                  <Icon name="alert-circle-outline" size={16} color={theme.colors.error} style={{ marginRight: 8 }} />
                  <Text style={[styles.errorText, { color: theme.colors.error }]}>
                    {barcodeSearchError}
                  </Text>
                </View>
              )}
            </View>

            {/* Platform Filter Chips */}
            <View style={{ paddingHorizontal: 8 }}>
              <PlatformFilterChips
                platforms={platformsForChips}
                selectedPlatform={selectedPlatformType}
                onSelectPlatform={setSelectedPlatformType}
                activeColor={theme.colors.primary}
              />
            </View>

            {/* Pool/Location Combobox and Sort Dropdown */}
            <View style={styles.filterRow}>
              <View style={{ flex: 1 }}>
                <PoolLocationCombobox
                  orgId={legendState?.userId || ''}
                  selectedItems={selectedLocationIds}
                  onSelectionChange={setSelectedLocationIds}
                  startOpen={locationPickerOpen}
                />
              </View>
              <View style={{ marginLeft: 8, marginRight: 0 }}>
                <SortByDropdown
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                />
              </View>
            </View>

            {/* Inventory List */}
            <FlatList
              data={inventoryToDisplay}
              renderItem={renderInventoryItem}
              keyExtractor={item => item.Id.toString()}
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
                    No products found.
                    {selectedPlatformType && ` Try selecting a different platform or location.`}
                  </Text>
                )
              }
            />
          </Animated.View>
        )}

        {activeTab === 'orders' && (
          <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
            <View style={styles.comingSoonContainer}>
              <Icon name="package-outline" size={48} color={theme.colors.textSecondary} />
              <Text style={[styles.comingSoonText, { color: theme.colors.textSecondary }]}>
                Orders view coming soon
              </Text>
            </View>
          </Animated.View>
        )}
      </View>

      {/* Full-screen Scanner Modal - renders above everything */}
      {scannerOpen && (
      <View style={styles.scannerDockFull} pointerEvents="box-none">
        <View style={styles.scannerFullBleed}>
          <CameraView
            style={styles.scannerCamera}
            facing="back"
            onBarcodeScanned={(result: any) => {
              const code = result?.data || result?.rawValue;
              if (code && scannerResultHandlerRef.current) {
                scannerResultHandlerRef.current(code);
              }
            }}
            barcodeScannerSettings={{
              barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
            }}
          />
          <TouchableOpacity
            onPress={() => {
              console.log('[InventoryOrdersScreen] Scanner close button pressed');
              setScannerOpen(false);
            }}
            style={styles.scannerCloseButton}
          >
            <Icon name="close" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
      )}

    </View>
  );
});

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "rgb(208, 255, 170)",
  },
  container: {
    borderTopRightRadius: 36,
    borderTopLeftRadius: 36,
    flex: 1,
    backgroundColor: '#F8F9FB',
    padding: 8,
  },
  listContainer: {
    backgroundColor: "#FFF",
    flex: 1,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginBottom: 16,
    justifyContent: "space-between",
  },
  listContent: {
    paddingBottom: 16,
  },
  sellerStatsSection: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    marginHorizontal: 8,
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
  },
  sellerStatLabel: {
    fontSize: 12,
    marginTop: 4,
  },
  errorMessage: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    fontSize: 16,
    padding: 24,
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
  listFooter: {
    height: 100,
  },
  mockOrderText: {
    textAlign: 'center',
    fontSize: 16,
    padding: 24,
  },
  comingSoonContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  comingSoonText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
  },
  scannerModalContainer: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerCamera: {
    flex: 1,
  },
  scannerCloseButton: {
    position: 'absolute',
    top: 100,
    right: 20,
    zIndex: 10,
  },
  scannerDockFull: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5000,
    height: 240,
    width: "100%", 
  },
  scannerFullBleed: {
    flex: 1,
    backgroundColor: '#000',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    overflow: 'hidden',
  },
  scannerCloseFull: {
    position: 'absolute',
    top: 100,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default InventoryOrdersScreen; 


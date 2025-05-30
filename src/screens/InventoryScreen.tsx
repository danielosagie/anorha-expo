import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ScrollView, Image, ActivityIndicator } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import PlaceholderImage from '../components/Placeholder';
import { observer } from '@legendapp/state/react';
import { productVariants$, ProductVariant as ProductVariantData } from '../utils/SupaLegend';
import { useNavigation } from '@react-navigation/native';

interface ConnectionStatusResponse {
  Status: string;
}

const apiClient = {
  post: async (url: string, data?: any): Promise<{ data: { jobId: string, success: boolean } }> => { 
    console.log('API POST:', url, data); 
    return { data: { jobId: 'dummy-job-id', success: true } }; 
  },
  get: async (url: string): Promise<{ data: any }> => { 
    console.log('API GET:', url);
    if (url.includes('scan-summary')) return { data: { countProducts: 0 } }; 
    if (url.includes('mapping-suggestions')) return { data: [] };
    if (url.includes('platform-connections')) return { data: { Status: 'idle' } as ConnectionStatusResponse }; 
    return { data: {} }; 
  },
};

const InventoryItem = observer(({ item }: { item: ProductVariantData }) => {
  const theme = useTheme();
  const navigation = useNavigation<any>();

  const navigateToDetail = () => {
    navigation.navigate('ProductDetail', { productId: item.Id, item: item });
  };

  const usePlaceholder = !item.image;
  const price = typeof item.Price === 'number' ? item.Price.toFixed(2) : '0.00';
  const quantity = item.quantity || 0;
  const platforms = item.platforms || [];

  return (
    <TouchableOpacity onPress={navigateToDetail}> 
      <Card style={[styles.itemCard, { backgroundColor: theme.colors.surface }]}>
        <View style={styles.itemContainer}>
          {usePlaceholder ? 
            <PlaceholderImage size={60} borderRadius={8} /> :
            <Image source={{ uri: item.image }} style={styles.itemImage} />
          }
          
          <View style={styles.itemDetails}>
            <Text style={[styles.itemTitle, { color: theme.colors.text}]} numberOfLines={2}>{item.Title}</Text>
            
            <View style={styles.itemMeta}>
              <View style={styles.priceQuantityContainer}>
                <Text style={[styles.itemPrice, { color: theme.colors.text}]}>${price}</Text>
                <Text style={[styles.itemQuantity, { color: theme.colors.textSecondary}]}>{quantity} in stock</Text>
              </View>
              
              <View style={styles.platformsContainer}>
                {platforms.map(platform => (
                  <View 
                    key={platform} 
                    style={[
                      styles.platformBadge,
                      { backgroundColor: getPlatformColor(platform, theme) }
                    ]}
                  >
                    <Text style={styles.platformBadgeText}>
                      {platform[0].toUpperCase()}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
          
          <TouchableOpacity style={styles.itemMenu}>
            <Icon name="dots-vertical" size={20} color="#777" />
          </TouchableOpacity>
        </View>
      </Card>
    </TouchableOpacity>
  );
});

const getPlatformColor = (platform: string, theme: any): string => {
  switch (platform) {
    case 'shopify':
      return theme.colors.primary;
    case 'amazon':
      return theme.colors.secondary;
    case 'clover':
      return theme.colors.accent;
    case 'square':
      return '#6C757D';
    default:
      return theme.colors.primary;
  }
};

const InventoryScreen = observer(() => {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('date');
  
  const [showDemo, setShowDemo] = useState(false);
  const [hasSyncedConnections, setHasSyncedConnections] = useState(false);
  const [migrationState, setMigrationState] = useState<'idle' | 'prompt' | 'scanning' | 'reviewing' | 'confirming' | 'activating' | 'error'>('idle');
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<any | null>(null);
  const [mappingSuggestions, setMappingSuggestions] = useState<any[]>([]);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  const allItemsObject = productVariants$.get();
  const allItemsArray = Object.values(allItemsObject);

  useEffect(() => {
    const checkConnections = async () => {
      const anySynced = false; 
      setHasSyncedConnections(anySynced);
      if (!anySynced && allItemsArray.length === 0) {
        setMigrationState('prompt'); 
      } else {
        setMigrationState('idle');
      }
    };
    checkConnections();
  }, [allItemsArray.length, theme.colors.background]);
  
  const startInitialScan = async (connectionId: string) => {
    try {
      setMigrationState('scanning');
      setMigrationError(null);
      setActiveConnectionId(connectionId);
      const response = await apiClient.post(`/sync/connections/${connectionId}/start-scan`);
      console.log('Initial Scan Started:', response.data);
      pollConnectionStatus(connectionId);
    } catch (error: any) {
      console.error(`Error starting initial scan for ${connectionId}:`, error);
      setMigrationState('error');
      setMigrationError(error.message || 'Failed to start scan.');
    }
  };

  const pollConnectionStatus = async (connectionId: string, targetState: string = 'needs_review') => {
    console.log(`Polling status for ${connectionId}, waiting for ${targetState}`);
    const intervalId = setInterval(async () => {
      try {
        const response = await apiClient.get(`/platform-connections/${connectionId}`);
        const currentStatus = (response.data as ConnectionStatusResponse).Status; 
        console.log(`Polling: Current status for ${connectionId} is ${currentStatus}`);

        if (currentStatus === targetState) {
          clearInterval(intervalId);
          console.log(`Reached target state ${targetState} for ${connectionId}`);
          if (targetState === 'needs_review') {
            setMigrationState('reviewing');
            fetchScanResults(connectionId);
          } else if (targetState === 'active' || targetState === 'syncing') {
            setMigrationState('idle'); 
            setHasSyncedConnections(true); 
          }
        } else if (currentStatus === 'error') {
          clearInterval(intervalId);
          console.error(`Polling Error: Connection ${connectionId} entered error state.`);
          setMigrationState('error');
          setMigrationError('An error occurred during the process.');
        }
      } catch (error: any) {
        clearInterval(intervalId);
        console.error(`Error polling status for ${connectionId}:`, error);
        setMigrationState('error');
        setMigrationError(error.message || 'Failed to poll status.');
      }
    }, 5000); 
  };

  const fetchScanResults = async (connectionId: string) => {
    try {
      const summaryRes = await apiClient.get(`/sync/connections/${connectionId}/scan-summary`);
      console.log('Scan Summary:', summaryRes.data);
      setScanSummary(summaryRes.data);

      const suggestionsRes = await apiClient.get(`/sync/connections/${connectionId}/mapping-suggestions`);
      console.log('Mapping Suggestions:', suggestionsRes.data);
      setMappingSuggestions(suggestionsRes.data || []);
    } catch (error: any) {
      console.error(`Error fetching scan results for ${connectionId}:`, error);
      setMigrationState('error');
      setMigrationError(error.message || 'Failed to fetch scan results.');
    }
  };

  interface ConfirmMappingsDto {
    confirmedMatches: any[]; 
    syncRules?: any; 
  }

  const submitConfirmedMappings = async (connectionId: string, confirmedMatches: any[]) => {
    try {
      setMigrationState('confirming'); 
      const dto: ConfirmMappingsDto = { confirmedMatches: confirmedMatches };
      const response = await apiClient.post(`/sync/connections/${connectionId}/confirm-mappings`, dto);
      console.log('Confirm Mappings Response:', response.data);
      if (response.data.success) {
        activateSync(connectionId);
      } else {
        throw new Error('Failed to save confirmations.');
      }
    } catch (error: any) {
      console.error(`Error confirming mappings for ${connectionId}:`, error);
      setMigrationState('error');
      setMigrationError(error.message || 'Failed to save confirmations.');
    }
  };

  const activateSync = async (connectionId: string) => {
    try {
      setMigrationState('activating');
      const response = await apiClient.post(`/sync/connections/${connectionId}/activate-sync`);
      console.log('Activate Sync Response:', response.data);
      pollConnectionStatus(connectionId, 'active'); 
    } catch (error: any) {
      console.error(`Error activating sync for ${connectionId}:`, error);
      setMigrationState('error');
      setMigrationError(error.message || 'Failed to activate sync.');
    }
  };
  
  const filteredItems = allItemsArray.filter((item: ProductVariantData) => {
    if (searchQuery && !item.Title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (filter !== 'all' && !(item.platforms || []).includes(filter)) {
      return false;
    }
    return true;
  });
  
  const sortedItems = [...filteredItems].sort((a: ProductVariantData, b: ProductVariantData) => {
    if (sort === 'price-high') return (b.Price || 0) - (a.Price || 0);
    if (sort === 'price-low') return (a.Price || 0) - (b.Price || 0);
    if (sort === 'quantity') return (b.quantity || 0) - (a.quantity || 0);
    return new Date(b.UpdatedAt || b.CreatedAt).getTime() - new Date(a.UpdatedAt || a.CreatedAt).getTime();
  });
  
  const renderSortLabel = () => {
    switch (sort) {
      case 'date':
        return 'Newest First';
      case 'price-high':
        return 'Price: High to Low';
      case 'price-low':
        return 'Price: Low to High';
      case 'quantity':
        return 'Most Stock';
      default:
        return 'Sort by';
    }
  };
  
  const renderMigrationStatus = () => {
    switch (migrationState) {
      case 'scanning':
        return (
          <View style={styles.statusContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.statusText, {color: theme.colors.text}]}>Scanning platform data...</Text>
            <Text style={[styles.statusSubText, {color: theme.colors.textSecondary}]}>This might take a few minutes.</Text>
          </View>
        );
      case 'reviewing':
        return (
          <View style={styles.reviewContainer}> 
            <Text style={[styles.reviewTitle, {color: theme.colors.text}]}>Review Scan Results</Text>
            {scanSummary && (
              <Text style={[styles.reviewText, {color: theme.colors.text}]}>Found {scanSummary.countProducts || 0} products.</Text>
            )}
            <Text style={[styles.reviewText, {color: theme.colors.text}]}>{mappingSuggestions.length || 0} mapping suggestions need review.</Text>
            <Text style={styles.todoText}>(Mapping Review UI to be built)</Text>
            <Button 
              title="Confirm Mappings (Dummy)"
              onPress={() => {
                if (activeConnectionId) {
                  submitConfirmedMappings(activeConnectionId, []); 
                }
              }} 
            />
          </View>
        );
      case 'confirming':
      case 'activating':
         return (
          <View style={styles.statusContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={[styles.statusText, {color: theme.colors.text}]}>
              {migrationState === 'confirming' ? 'Saving confirmations...' : 'Activating sync...'}
            </Text>
          </View>
        );
      case 'error':
        return (
          <View style={[styles.errorContainer, { backgroundColor: theme.colors.error + '10' }]}>
            <Icon name="alert-circle-outline" size={40} color={theme.colors.error} />
            <Text style={[styles.errorTitle, {color: theme.colors.error}]}>Migration Error</Text>
            <Text style={[styles.errorText, {color: theme.colors.textSecondary}]}>{migrationError || 'An unknown error occurred.'}</Text>
            <Button title="Retry" onPress={() => { setMigrationState('prompt'); }} />
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Animated.View entering={FadeInUp.delay(100).duration(500)}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Inventory</Text>
      </Animated.View>

      {migrationState === 'prompt' && (
        <View style={styles.promptContainer}>
          <Card style={[styles.promptCard, {backgroundColor: theme.colors.surface}]}>
            <Icon name="database-sync-outline" size={50} color={theme.colors.primary} style={{ marginBottom: 15 }} />
            <Text style={[styles.promptTitle, { color: theme.colors.text }]}>Sync Your Inventory</Text>
            <Text style={[styles.promptText, { color: theme.colors.textSecondary }]}>
              Connect your platforms to start syncing products and manage everything in one place.
            </Text>
            <Button 
              title="Start First Sync / Migration" 
              style={styles.promptButton}
              onPress={() => {
                const connectionToMigrate = 'dummy-connection-id'; 
                startInitialScan(connectionToMigrate);
              }}
            />
            <TouchableOpacity onPress={() => { setShowDemo(true); setMigrationState('idle');}} style={styles.demoButton}>
              <Text style={[styles.demoButtonText, { color: theme.colors.primary }]}>View Demo Inventory</Text>
            </TouchableOpacity>
          </Card>
        </View>
      )}

      {(migrationState === 'scanning' || migrationState === 'reviewing' || migrationState === 'confirming' || migrationState === 'activating' || migrationState === 'error') && (
        renderMigrationStatus()
      )}

      {(migrationState === 'idle' && (hasSyncedConnections || showDemo || allItemsArray.length > 0)) && (
        <>
          <Animated.View entering={FadeInUp.delay(100).duration(500)}>
            <Card style={[styles.searchCard, {backgroundColor: theme.colors.surface}]}>
              <View style={styles.searchContainer}>
                <Icon name="magnify" size={20} color="#777" style={styles.searchIcon} />
                <TextInput
                  style={[styles.searchInput, {color: theme.colors.text}] }
                  placeholder="Search inventory..."
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  editable={!showDemo}
                />
                {searchQuery ? (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Icon name="close" size={20} color="#777" />
                  </TouchableOpacity>
                ) : null}
              </View>
              
              <View style={styles.filterContainer}>
                <Text style={[styles.filterLabel, {color: theme.colors.textSecondary}]}>Platform:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {['all', 'shopify', 'amazon', 'clover', 'square'].map((platformFilter) => (
                    <TouchableOpacity
                      key={platformFilter}
                      style={[
                        styles.filterChip,
                        {borderColor: theme.colors.textSecondary},
                        filter === platformFilter && { backgroundColor: theme.colors.primary }
                      ]}
                      onPress={() => setFilter(platformFilter)}
                      disabled={showDemo} 
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          {color: theme.colors.textSecondary},
                          filter === platformFilter && { color: 'white' },
                          showDemo && { opacity: 0.5 } 
                        ]}
                      >
                        {platformFilter === 'all' ? 'All' : platformFilter.charAt(0).toUpperCase() + platformFilter.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              
              <View style={styles.sortContainer}>
                <Text style={[styles.sortLabel, {color: theme.colors.textSecondary}]}>Sort by:</Text>
                <TouchableOpacity
                  style={[styles.sortButton, {borderColor: theme.colors.textSecondary} ]}
                  onPress={() => {
                    if (showDemo) return; 
                    if (sort === 'date') setSort('price-high');
                    else if (sort === 'price-high') setSort('price-low');
                    else if (sort === 'price-low') setSort('quantity');
                    else setSort('date');
                  }}
                  disabled={showDemo}
                >
                  <Text style={[styles.sortButtonText, {color: theme.colors.textSecondary}, showDemo && { opacity: 0.5 }]}>{renderSortLabel()}</Text>
                  <Icon name="chevron-down" size={16} color="#777" />
                </TouchableOpacity>
              </View>
              {showDemo && (
                <TouchableOpacity onPress={() => {setShowDemo(false); if(!hasSyncedConnections && allItemsArray.length === 0) setMigrationState('prompt');}} style={styles.exitDemoButton}>
                   <Text style={[styles.exitDemoText, { color: theme.colors.textSecondary }]}>Exit Demo</Text>
                </TouchableOpacity>
              )}
            </Card>
          </Animated.View>
          
          <FlatList
            data={sortedItems}
            keyExtractor={(item) => item.Id}
            renderItem={({ item, index }: { item: ProductVariantData, index: number }) => ( 
              <Animated.View entering={FadeInUp.delay(100 + index * 50).duration(300)}>
                <InventoryItem item={item} />
              </Animated.View>
            )}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Card style={{backgroundColor: theme.colors.surface}}>
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  {showDemo ? 'No demo items found' : (allItemsArray.length === 0 && !hasSyncedConnections ? 'Sync a platform or add items to begin.' : 'No products match your search/filters.')}
                </Text>
              </Card>
            }
            ListFooterComponent={<View style={styles.listFooter} />}
          />
          
          {!showDemo && (
            <View style={styles.fab}>
              <TouchableOpacity 
                style={[styles.fabButton, { backgroundColor: theme.colors.primary }]}
                onPress={() => {/* TODO: Navigate to Add Product/Variant Screen */}}
              >
                <Icon name="plus" size={24} color="white" />
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginVertical: 16,
  },
  searchCard: {
    marginBottom: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  searchIcon: { marginRight: 8, color: '#777' },
  searchInput: { flex: 1, height: 40, fontSize: 16 },
  filterContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, },
  filterLabel: { fontSize: 14, marginRight: 8, },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, marginRight: 8, borderWidth: 1, backgroundColor: '#f5f5f5' },
  filterChipText: { fontSize: 14, },
  sortContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', },
  sortLabel: { fontSize: 14, marginRight: 8, },
  sortButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#f5f5f5', borderRadius: 6, borderWidth: 1, },
  sortButtonText: { fontSize: 14, marginRight: 4, },
  itemCard: { marginBottom: 12, },
  itemContainer: { flexDirection: 'row', alignItems: 'center', padding: 12, },
  itemImage: { width: 60, height: 60, borderRadius: 8, marginRight: 12, backgroundColor: '#eee' },
  itemDetails: { flex: 1, },
  itemTitle: { fontSize: 16, fontWeight: '500', marginBottom: 4, },
  itemMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', },
  priceQuantityContainer: { },
  itemPrice: { fontSize: 15, fontWeight: '600', marginBottom: 2, },
  itemQuantity: { fontSize: 13, },
  platformsContainer: { flexDirection: 'row', },
  platformBadge: { width: 20, height: 20, borderRadius: 4, justifyContent: 'center', alignItems: 'center', marginLeft: 4, },
  platformBadgeText: { color: 'white', fontSize: 10, fontWeight: 'bold', },
  itemMenu: { padding: 8, marginLeft: 8, },
  promptContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  promptCard: {
    alignItems: 'center',
    padding: 30,
    width: '90%',
    maxWidth: 450,
  },
  promptTitle: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
  },
  promptText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 25,
    lineHeight: 22,
  },
  promptButton: {
    alignSelf: 'stretch',
    marginBottom: 15,
  },
  demoButton: {
    marginTop: 10,
  },
  demoButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
  statusContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  statusText: {
    fontSize: 18,
    fontWeight: '500',
    marginTop: 15,
    textAlign: 'center',
  },
  statusSubText: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  reviewContainer: {
    flex: 1,
    padding: 20,
  },
  reviewTitle: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 20,
  },
  reviewText: {
    fontSize: 16,
    marginBottom: 10,
  },
  todoText: {
    fontStyle: 'italic',
    color: '#888',
    textAlign: 'center',
    marginTop: 30,
    marginBottom: 20,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
    borderRadius: 8,
    margin: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 21,
  },
  exitDemoButton: {
     position: 'absolute',
     top: 10,
     right: 10,
     padding: 8,
     borderRadius: 4,
     backgroundColor: '#eee' 
  },
  exitDemoText: {
     fontWeight: '500'
  },
  emptyText: {
    textAlign: 'center',
    padding: 20,
  },
  listFooter: {
    height: 80,
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
  },
  fabButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
});

export default InventoryScreen; 
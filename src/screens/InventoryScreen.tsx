import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ScrollView, Image, ActivityIndicator } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Card from '../components/Card';
import Button from '../components/Button';
import { mockInventoryItems } from '../data/mockData';
import PlaceholderImage from '../components/Placeholder';

// Define types for Inventory Item and API responses (adjust as needed)
interface InventoryItemData {
  id: number;
  title: string;
  price: number;
  quantity: number;
  platforms: string[];
  image?: any; // Or specific ImageSourcePropType
  usePlaceholder?: boolean;
  date: string; // Or Date object
}

interface ConnectionStatusResponse {
  Status: string;
  // Add other relevant fields if needed
}

// --- NEW: Placeholder for API Client ---
// TODO: Replace with your actual configured API client instance (e.g., axios)
const apiClient = {
  post: async (url: string, data?: any): Promise<{ data: { jobId: string, success: boolean } }> => { 
    console.log('API POST:', url, data); 
    return { data: { jobId: 'dummy-job-id', success: true } }; 
  },
  get: async (url: string): Promise<{ data: any }> => { // Use 'any' for simplicity, refine later
    console.log('API GET:', url);
    if (url.includes('scan-summary')) return { data: { countProducts: 0 } }; 
    if (url.includes('mapping-suggestions')) return { data: [] };
    if (url.includes('platform-connections')) return { data: { Status: 'idle' } as ConnectionStatusResponse }; // Simulate status for polling
    return { data: {} }; 
  },
};
// --- END Placeholder ---

const InventoryItem = ({ item }: { item: InventoryItemData }) => {
  const theme = useTheme();
  
  return (
    <Card style={styles.itemCard}>
      <View style={styles.itemContainer}>
        {item.usePlaceholder ? 
          <PlaceholderImage size={60} borderRadius={8} /> :
          <Image source={item.image} style={styles.itemImage} />
        }
        
        <View style={styles.itemDetails}>
          <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
          
          <View style={styles.itemMeta}>
            <View style={styles.priceQuantityContainer}>
              <Text style={styles.itemPrice}>${item.price.toFixed(2)}</Text>
              <Text style={styles.itemQuantity}>{item.quantity} in stock</Text>
            </View>
            
            <View style={styles.platformsContainer}>
              {item.platforms.map(platform => (
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
  );
};

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

const InventoryScreen = () => {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('date');
  
  // --- NEW: Migration/Sync State ---
  const [showDemo, setShowDemo] = useState(false); // Toggle demo view
  const [hasSyncedConnections, setHasSyncedConnections] = useState(false); // Track if any connection is active/synced
  const [migrationState, setMigrationState] = useState<'idle' | 'prompt' | 'scanning' | 'reviewing' | 'confirming' | 'activating' | 'error'>('idle');
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null); // ID of connection being migrated
  const [scanSummary, setScanSummary] = useState<any | null>(null); // Store scan results (replace any)
  const [mappingSuggestions, setMappingSuggestions] = useState<any[]>([]); // Store suggestions (replace any)
  const [migrationError, setMigrationError] = useState<string | null>(null);
  // --- END Migration/Sync State ---
  
  // --- NEW: Effect to check connection status on load ---
  useEffect(() => {
    // TODO: Replace this with actual logic to fetch connections
    // from context or API and check their statuses.
    const checkConnections = async () => {
      // Simulated check - assume no connections are synced initially
      const anySynced = false; // Replace with actual check
      setHasSyncedConnections(anySynced);
      if (!anySynced) {
        setMigrationState('prompt'); // Show migration prompt if no synced connections
      } else {
        // Fetch actual inventory data if connections are synced
        // fetchRealInventoryData(); 
      }
    };
    checkConnections();
  }, []); // Run only once on mount
  // --- END Effect ---
  
  // --- NEW: API Call Functions ---
  const startInitialScan = async (connectionId: string) => {
    try {
      setMigrationState('scanning');
      setMigrationError(null);
      setActiveConnectionId(connectionId);
      const response = await apiClient.post(`/sync/connections/${connectionId}/start-scan`);
      console.log('Initial Scan Started:', response.data);
      // TODO: Start polling connection status
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
            setMigrationState('idle'); // Or a 'sync_complete' state
            setHasSyncedConnections(true); // Mark as synced
            // fetchRealInventoryData(); // Fetch real data
          }
        } else if (currentStatus === 'error') {
          clearInterval(intervalId);
          console.error(`Polling Error: Connection ${connectionId} entered error state.`);
          setMigrationState('error');
          setMigrationError('An error occurred during the process.'); // Get specific error if possible
        }
      } catch (error: any) {
        clearInterval(intervalId);
        console.error(`Error polling status for ${connectionId}:`, error);
        setMigrationState('error');
        setMigrationError(error.message || 'Failed to poll status.');
      }
    }, 5000); // Poll every 5 seconds - adjust as needed

    // TODO: Add timeout logic to clearInterval eventually
  };

  const fetchScanResults = async (connectionId: string) => {
    try {
      const summaryRes = await apiClient.get(`/sync/connections/${connectionId}/scan-summary`);
      console.log('Scan Summary:', summaryRes.data);
      setScanSummary(summaryRes.data);

      const suggestionsRes = await apiClient.get(`/sync/connections/${connectionId}/mapping-suggestions`);
      console.log('Mapping Suggestions:', suggestionsRes.data);
      setMappingSuggestions(suggestionsRes.data || []);
      // UI should now display these results in the 'reviewing' state
    } catch (error: any) {
      console.error(`Error fetching scan results for ${connectionId}:`, error);
      setMigrationState('error');
      setMigrationError(error.message || 'Failed to fetch scan results.');
    }
  };

  // Define ConfirmMappingsDto structure (adjust based on actual backend DTO)
  interface ConfirmMappingsDto {
    confirmedMatches: any[]; // Replace 'any' with your actual match structure
    syncRules?: any; // Optional sync rules
  }

  const submitConfirmedMappings = async (connectionId: string, confirmedMatches: any[]) => {
    try {
      setMigrationState('confirming'); // Indicate saving
      const dto: ConfirmMappingsDto = { confirmedMatches: confirmedMatches };
      const response = await apiClient.post(`/sync/connections/${connectionId}/confirm-mappings`, dto);
      console.log('Confirm Mappings Response:', response.data);
      if (response.data.success) {
        // Confirmation successful, trigger activation
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
      // Start polling again, waiting for 'active' or 'syncing'
      pollConnectionStatus(connectionId, 'active'); // Or 'syncing' depending on backend
    } catch (error: any) {
      console.error(`Error activating sync for ${connectionId}:`, error);
      setMigrationState('error');
      setMigrationError(error.message || 'Failed to activate sync.');
    }
  };
  // --- END API Call Functions ---
  
  const filteredItems = mockInventoryItems.filter((item: InventoryItemData) => {
    // Search filter
    if (searchQuery && !item.title.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    
    // Platform filter
    if (filter !== 'all' && !item.platforms.includes(filter)) {
      return false;
    }
    
    return true;
  });
  
  const sortedItems = [...filteredItems].sort((a: InventoryItemData, b: InventoryItemData) => {
    if (sort === 'price-high') return b.price - a.price;
    if (sort === 'price-low') return a.price - b.price;
    if (sort === 'quantity') return b.quantity - a.quantity;
    // Default to date
    return new Date(b.date).getTime() - new Date(a.date).getTime();
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
  
  // --- Helper to render migration state UI ---
  const renderMigrationStatus = () => {
    switch (migrationState) {
      case 'scanning':
        return (
          <View style={styles.statusContainer}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.statusText}>Scanning platform data...</Text>
            <Text style={styles.statusSubText}>This might take a few minutes.</Text>
          </View>
        );
      case 'reviewing':
        return (
          <View style={styles.reviewContainer}> 
            <Text style={styles.reviewTitle}>Review Scan Results</Text>
            {scanSummary && (
              <Text style={styles.reviewText}>Found {scanSummary.countProducts || 0} products.</Text>
            )}
            <Text style={styles.reviewText}>{mappingSuggestions.length || 0} mapping suggestions need review.</Text>
            {/* TODO: Build the actual review UI here */} 
            <Text style={styles.todoText}>(Mapping Review UI to be built)</Text>
            <Button 
              title="Confirm Mappings (Dummy)"
              onPress={() => {
                if (activeConnectionId) {
                  // Pass dummy confirmation data for now
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
            <Text style={styles.statusText}>
              {migrationState === 'confirming' ? 'Saving confirmations...' : 'Activating sync...'}
            </Text>
          </View>
        );
      case 'error':
        return (
          <View style={[styles.errorContainer, { backgroundColor: theme.colors.error + '10' }]}>
            <Icon name="alert-circle-outline" size={40} color={theme.colors.error} />
            <Text style={styles.errorTitle}>Migration Error</Text>
            <Text style={styles.errorText}>{migrationError || 'An unknown error occurred.'}</Text>
            <Button title="Retry" onPress={() => { /* TODO: Implement retry logic */ setMigrationState('prompt'); }} />
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* --- Title --- */} 
      <Animated.View entering={FadeInUp.delay(100).duration(500)}>
        <Text style={[styles.title, { color: theme.colors.text }]}>Inventory</Text>
      </Animated.View>

      {/* --- Conditional Content --- */} 
      {migrationState === 'prompt' && (
        <View style={styles.promptContainer}>
          <Card style={styles.promptCard}>
            <Icon name="database-sync-outline" size={50} color={theme.colors.primary} style={{ marginBottom: 15 }} />
            <Text style={[styles.promptTitle, { color: theme.colors.text }]}>Sync Your Inventory</Text>
            <Text style={[styles.promptText, { color: theme.colors.textSecondary }]}>
              Connect your platforms to start syncing products and manage everything in one place.
            </Text>
            <Button 
              title="Start First Sync / Migration" 
              style={styles.promptButton}
              onPress={() => {
                // TODO: Need logic to select which connection to migrate
                // For now, assume we have a default or the first available connection ID
                const connectionToMigrate = 'dummy-connection-id'; // Replace with actual ID
                startInitialScan(connectionToMigrate);
              }}
            />
            <TouchableOpacity onPress={() => setShowDemo(true)} style={styles.demoButton}>
              <Text style={[styles.demoButtonText, { color: theme.colors.primary }]}>View Demo Inventory</Text>
            </TouchableOpacity>
          </Card>
        </View>
      )}

      {(migrationState === 'scanning' || migrationState === 'reviewing' || migrationState === 'confirming' || migrationState === 'activating' || migrationState === 'error') && (
        renderMigrationStatus()
      )}

      {(migrationState === 'idle' && (hasSyncedConnections || showDemo)) && (
        <> 
          {/* --- Search/Filter/Sort Card (Only show for actual/demo inventory) --- */}
          <Animated.View entering={FadeInUp.delay(100).duration(500)}> 
            <Card style={styles.searchCard}>
              <View style={styles.searchContainer}>
                <Icon name="magnify" size={20} color="#777" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search inventory..."
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  editable={!showDemo} // Disable search in demo
                />
                {searchQuery ? (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Icon name="close" size={20} color="#777" />
                  </TouchableOpacity>
                ) : null}
              </View>
              
              <View style={styles.filterContainer}>
                <Text style={styles.filterLabel}>Platform:</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {['all', 'shopify', 'amazon', 'clover', 'square'].map((platform) => (
                    <TouchableOpacity
                      key={platform}
                      style={[
                        styles.filterChip,
                        filter === platform && { backgroundColor: theme.colors.primary }
                      ]}
                      onPress={() => setFilter(platform)}
                      disabled={showDemo} // Disable filter in demo
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          filter === platform && { color: 'white' },
                          showDemo && { opacity: 0.5 } // Indicate disabled
                        ]}
                      >
                        {platform === 'all' ? 'All' : platform.charAt(0).toUpperCase() + platform.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
              
              <View style={styles.sortContainer}>
                <Text style={styles.sortLabel}>Sort by:</Text>
                <TouchableOpacity
                  style={styles.sortButton}
                  onPress={() => {
                    if (showDemo) return; // Disable sort in demo
                    // Cycle through sort options
                    if (sort === 'date') setSort('price-high');
                    else if (sort === 'price-high') setSort('price-low');
                    else if (sort === 'price-low') setSort('quantity');
                    else setSort('date');
                  }}
                  disabled={showDemo}
                >
                  <Text style={[styles.sortButtonText, showDemo && { opacity: 0.5 }]}>{renderSortLabel()}</Text>
                  <Icon name="chevron-down" size={16} color="#777" />
                </TouchableOpacity>
              </View>
              {showDemo && (
                <TouchableOpacity onPress={() => setShowDemo(false)} style={styles.exitDemoButton}>
                   <Text style={[styles.exitDemoText, { color: theme.colors.textSecondary }]}>Exit Demo</Text>
                </TouchableOpacity>
              )}
            </Card>
          </Animated.View>
          
          {/* --- Inventory List --- */}
          <FlatList
            // Use mock data if showDemo is true, otherwise use real data (needs fetching)
            data={showDemo ? sortedItems : [] /* Replace with real data state */}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item, index }: { item: InventoryItemData, index: number }) => ( 
              <Animated.View entering={FadeInUp.delay(100 + index * 50).duration(300)}>
                <InventoryItem item={item} />
              </Animated.View>
            )}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Card style={{}}>
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  {showDemo ? 'No demo items found' : 'Your inventory is empty. Sync a platform to begin.'}
                </Text>
              </Card>
            }
            ListFooterComponent={<View style={styles.listFooter} />}
          />
          
          {/* --- FAB (Only show if not in demo mode) --- */}
          {!showDemo && (
            <View style={styles.fab}>
              <TouchableOpacity 
                style={[styles.fabButton, { backgroundColor: theme.colors.primary }]}
                onPress={() => {/* Navigate to Add Listing */}}
              >
                <Icon name="plus" size={24} color="white" />
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </View>
  );
};

// --- Move StyleSheet back OUTSIDE component ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FB', // Static background
    padding: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginVertical: 16,
    // color applied inline
  },
  searchCard: {
    marginBottom: 8,
    // background applied inline
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5', // Static
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
  },
  searchIcon: { marginRight: 8, color: '#777' }, // Static color
  searchInput: { flex: 1, height: 40, fontSize: 16, /* color: theme.colors.text */ }, // Color from theme or default
  filterContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, },
  filterLabel: { fontSize: 14, color: '#555', marginRight: 8, },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15, marginRight: 8, borderWidth: 1, borderColor: '#ddd', backgroundColor: '#f5f5f5', },
  filterChipText: { fontSize: 14, color: '#555', },
  sortContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', },
  sortLabel: { fontSize: 14, color: '#555', marginRight: 8, },
  sortButton: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#f5f5f5', borderRadius: 6, borderWidth: 1, borderColor: '#ddd', },
  sortButtonText: { fontSize: 14, color: '#555', marginRight: 4, },
  // --- Styles for items (assuming InventoryItem handles its own themeing) ---
  itemCard: { marginBottom: 12, /* background: theme.colors.card */ },
  itemContainer: { flexDirection: 'row', alignItems: 'center', padding: 12, },
  itemImage: { width: 60, height: 60, borderRadius: 8, marginRight: 12, backgroundColor: '#eee' },
  itemDetails: { flex: 1, },
  itemTitle: { fontSize: 16, fontWeight: '500', marginBottom: 4, /* color: theme.colors.text */ },
  itemMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', },
  priceQuantityContainer: { },
  itemPrice: { fontSize: 15, fontWeight: '600', marginBottom: 2, /* color: theme.colors.text */ },
  itemQuantity: { fontSize: 13, color: '#777', /* color: theme.colors.textSecondary */ },
  platformsContainer: { flexDirection: 'row', },
  platformBadge: { width: 20, height: 20, borderRadius: 4, justifyContent: 'center', alignItems: 'center', marginLeft: 4, /* background set dynamically */ },
  platformBadgeText: { color: 'white', fontSize: 10, fontWeight: 'bold', },
  itemMenu: { padding: 8, marginLeft: 8, },
  // --- Migration Styles ---
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
    // background applied inline
  },
  promptTitle: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 10,
    color: '#333',
  },
  promptText: {
    fontSize: 16,
    color: '#666',
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
    // color applied inline
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
    color: '#555',
  },
  statusSubText: {
    fontSize: 14,
    color: '#777',
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
    // color applied inline
  },
  reviewText: {
    fontSize: 16,
    marginBottom: 10,
    color: '#444',
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
    // background applied inline
    borderRadius: 8,
    margin: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '600',
    // color applied inline
    marginBottom: 10,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    color: '#666',
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
     backgroundColor: '#eee' // Static background
  },
  exitDemoText: {
     color: '#555',
     fontWeight: '500'
  },
  emptyText: {
    textAlign: 'center',
    // color applied inline
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
    // background applied inline
  },
});

export default InventoryScreen; 
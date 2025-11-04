import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Platform,
  TextInput,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { observer } from '@legendapp/state/react';
import { useLegendState } from '../context/LegendStateContext';
import { supabase } from '../../lib/supabase';
import PlatformFilterChips from '../components/PlatformFilterChips';
import PoolLocationCombobox from '../components/PoolLocationCombobox';
import SortByDropdown from '../components/SortByDropdown';
import { PlatformConnection, PlatformLocation } from '../utils/SupaLegend';

type ActivityFeedScreenNavigationProp = StackNavigationProp<AppStackParamList, 'ActivityFeed'>;

interface ActivityEvent {
  id: string;
  timestamp: string;
  eventType: string;
  message: string;
  details: Record<string, any>;
  productVariantId?: string;
  platformConnectionId?: string;
  platformType?: string;
  variantTitle?: string;
  primaryImageUrl?: string;
  status: string;
}

const ActivityFeedScreen = observer(() => {
  const theme = useTheme();
  const navigation = useNavigation<ActivityFeedScreenNavigationProp>();
  const legendState = useLegendState();

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filter & Search State (similar to InventoryOrdersScreen)
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [selectedPlatformType, setSelectedPlatformType] = useState<string | null>(null);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Platform data state
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [platformLocations, setPlatformLocations] = useState<PlatformLocation[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);

  // Fetch activity feed from backend
  const fetchActivityFeed = useCallback(async (cursor?: string, append = false) => {
    if (!legendState?.userId) {
      console.log('[ActivityFeed] Skipping fetch: no userId');
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData?.session) {
        console.log('[ActivityFeed] No session available');
        setLoading(false);
        return;
      }

      const token = sessionData.session.access_token;
      
      // Build query string with cursor if provided
      let queryString = `limit=50`;
      if (cursor) {
        queryString += `&cursor=${encodeURIComponent(cursor)}`;
      }

      // Add date filters if set
      if (startDate) {
        queryString += `&startDate=${encodeURIComponent(startDate.toISOString())}`;
      }
      if (endDate) {
        queryString += `&endDate=${encodeURIComponent(endDate.toISOString())}`;
      }

      console.log(`[ActivityFeed] Fetching activity feed: ${queryString}`);

      const response = await fetch(
        `https://api.sssync.app/api/activity?${queryString}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.error(`[ActivityFeed] Failed to fetch: ${response.status} ${response.statusText}`);
        const errorText = await response.text();
        console.error(`[ActivityFeed] Error response:`, errorText);
        setLoading(false);
        return;
      }

      const data = await response.json();
      console.log(`[ActivityFeed] Received response:`, {
        eventsCount: data.events?.length || 0,
        hasMore: data.hasMore,
        nextCursor: data.nextCursor ? 'present' : 'null',
      });

      if (!data.events || data.events.length === 0) {
        console.log('[ActivityFeed] No events in response');
        if (!append) {
          setEvents([]);
          setNextCursor(null);
          setHasMore(false);
        }
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        return;
      }

      // Transform backend response to match UI interface
      const transformedEvents: ActivityEvent[] = data.events.map((event: any) => ({
        id: event.Id,
        timestamp: event.Timestamp,
        eventType: event.EventType,
        message: event.Message,
        details: event.Details || {},
        productVariantId: event.ProductVariantId,
        platformConnectionId: event.PlatformConnectionId,
        platformType: event.PlatformType,
        status: event.Status,
      }));

      console.log(`[ActivityFeed] Transformed ${transformedEvents.length} events`);

      if (append) {
        setEvents(prev => [...prev, ...transformedEvents]);
      } else {
        setEvents(transformedEvents);
      }

      // Update pagination state
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (error) {
      console.error('[ActivityFeed] Error fetching activity feed:', error);
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [legendState?.userId, startDate, endDate]);

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
          console.error('[ActivityFeedScreen] Error fetching platform connections:', connectionsError);
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
            console.error('[ActivityFeedScreen] Error fetching platform locations:', locationsError);
          } else {
            setPlatformLocations(locationsData || []);
          }
        }
      } catch (error) {
        console.error('[ActivityFeedScreen] Exception fetching platform data:', error);
      } finally {
        setIsLoadingConnections(false);
      }
    };

    fetchPlatformData();
  }, [legendState?.userId]);

  // Initial load
  useEffect(() => {
    const loadInitial = async () => {
      setLoading(true);
      await fetchActivityFeed();
      setLoading(false);
    };
    loadInitial();
  }, [fetchActivityFeed]);

  // TODO: Add realtime subscription when backend is ready
  // For now, we'll rely on pull-to-refresh for updates

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchActivityFeed();
    setRefreshing(false);
  }, [fetchActivityFeed]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || !nextCursor) return;

    setLoadingMore(true);
    await fetchActivityFeed(nextCursor, true);
    setLoadingMore(false);
  }, [hasMore, loadingMore, nextCursor, fetchActivityFeed]);

  const getEventIcon = (eventType: string) => {
    if (eventType.includes('ORDER')) return 'shopping-outline';
    if (eventType.includes('INVENTORY_CHANGE')) return 'package-variant';
    if (eventType.includes('PRICE_CHANGE')) return 'tag-outline';
    if (eventType.includes('LISTING')) return 'store-outline';
    if (eventType.includes('SYNC')) return 'sync';
    return 'information-outline';
  };

  const getEventColor = (eventType: string) => {
    if (eventType.includes('ERROR') || eventType.includes('FAILED')) return '#ef4444';
    if (eventType.includes('ORDER')) return '#10b981';
    if (eventType.includes('INVENTORY_CHANGE')) return '#3b82f6';
    if (eventType.includes('PRICE_CHANGE')) return '#f59e0b';
    if (eventType.includes('SYNC')) return '#8b5cf6';
    return '#6b7280';
  };

  // Events are already filtered in fetchActivityFeed, just sort them
  const filteredEvents = useMemo(() => {
    let filtered = [...events];

    // Sort
    switch (sortBy) {
      case 'name':
        filtered.sort((a, b) => (a.variantTitle || '').localeCompare(b.variantTitle || ''));
        break;
      default:
        // Keep existing order (most recent first)
        break;
    }

    return filtered;
  }, [events, sortBy]);

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

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString();
  };

  const renderEvent = ({ item }: { item: ActivityEvent }) => (
    <Animated.View entering={FadeInUp.delay(100).duration(300)}>
      <TouchableOpacity
        style={[styles.eventItem, { backgroundColor: theme.colors.surface }]}
        onPress={() => {
          // Navigate to product detail if it's product-related
          if (item.productVariantId) {
            navigation.navigate('ProductDetail', { productId: item.productVariantId });
          }
        }}
      >
        <View style={styles.eventIcon}>
          <Icon
            name={getEventIcon(item.eventType)}
            size={20}
            color={getEventColor(item.eventType)}
          />
        </View>

        <View style={styles.eventContent}>
          <Text style={[styles.eventMessage, { color: theme.colors.text }]}>
            {item.message}
          </Text>

          <View style={styles.eventMeta}>
            <Text style={[styles.eventTime, { color: theme.colors.textSecondary }]}>
              {formatTimestamp(item.timestamp)}
            </Text>

            {item.platformType && (
              <View style={styles.platformBadge}>
                <Text style={styles.platformText}>
                  {item.platformType}
                </Text>
              </View>
            )}
          </View>

          {item.variantTitle && (
            <Text style={[styles.variantTitle, { color: theme.colors.primary }]}>
              {item.variantTitle}
            </Text>
          )}
        </View>

        {item.primaryImageUrl && (
          <View style={styles.eventImage}>
            {/* Placeholder for image - you can add Image component here */}
            <View style={styles.imagePlaceholder}>
              <Icon name="image" size={16} color={theme.colors.textSecondary} />
            </View>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={[styles.loadingText, { color: theme.colors.textSecondary }]}>
          Loading activity...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.background]}>
      <View style={[styles.container, { marginTop: 60, paddingTop: 20 }]}>
        <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
          

          {/* Search Bar */}
          <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
            <View style={[styles.searchBar, { backgroundColor: "#FFF" }]}>
              <Icon name="magnify" size={20} color="#999" style={styles.searchIcon} />
              <TextInput
                style={[styles.searchInput, { color: theme.colors.text }]}
                placeholder="Search for orders/changes"
                placeholderTextColor="#999"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery ? (
                <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
                  <Icon name="close" size={20} color="#999" />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {/* Platform Filter Chips */}
          <View style={{ paddingHorizontal: 8 }}>
            <PlatformFilterChips
              platforms={platformsForChips}
              selectedPlatform={selectedPlatformType}
              onSelectPlatform={setSelectedPlatformType}
            />
          </View>

          {/* Pool/Location Combobox and Date Range Filter */}
          <View style={styles.filterRow}>
            <View style={{ flex: 1 }}>
              <PoolLocationCombobox
                orgId={legendState?.userId || ''}
                selectedItems={selectedLocationIds}
                onSelectionChange={setSelectedLocationIds}
              />
            </View>
            <View style={{ marginLeft: 8, marginRight: 0 }}>
              <TouchableOpacity
                style={[styles.dateFilterButton, { backgroundColor: theme.colors.primary }]}
                onPress={() => setShowDatePicker(true)}
              >
                <Icon name="calendar" size={18} color="white" />
                <Text style={styles.dateFilterButtonText}>Filter</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={filteredEvents}
            renderItem={renderEvent}
            keyExtractor={(item) => item.id}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.loadingMore}>
                  <ActivityIndicator size="small" color={theme.colors.primary} />
                  <Text style={[styles.loadingMoreText, { color: theme.colors.textSecondary }]}>
                    Loading more...
                  </Text>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Icon name="timeline-outline" size={48} color={theme.colors.textSecondary} />
                <Text style={[styles.emptyText, { color: theme.colors.textSecondary }]}>
                  No activity yet
                </Text>
                <Text style={[styles.emptySubtext, { color: theme.colors.textSecondary }]}>
                  Activity from orders and sync operations will appear here
                </Text>
              </View>
            }
          />
        </Animated.View>
      </View>

      {/* Date Range Picker Modal */}
      {showDatePicker && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Filter by Date Range</Text>
              <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                <Icon name="close" size={24} color={theme.colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              {/* Start Date */}
              <View style={styles.dateSection}>
                <Text style={[styles.dateLabel, { color: theme.colors.text }]}>Start Date</Text>
                <TouchableOpacity
                  style={[styles.dateInput, { borderColor: theme.colors.primary }]}
                  onPress={() => {
                    // TODO: Open native date picker
                    // For now, show placeholder
                  }}
                >
                  <Icon name="calendar" size={18} color={theme.colors.primary} />
                  <Text style={[styles.dateInputText, { color: startDate ? theme.colors.text : '#999' }]}>
                    {startDate ? startDate.toLocaleDateString() : 'Select start date'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* End Date */}
              <View style={styles.dateSection}>
                <Text style={[styles.dateLabel, { color: theme.colors.text }]}>End Date</Text>
                <TouchableOpacity
                  style={[styles.dateInput, { borderColor: theme.colors.primary }]}
                  onPress={() => {
                    // TODO: Open native date picker
                    // For now, show placeholder
                  }}
                >
                  <Icon name="calendar" size={18} color={theme.colors.primary} />
                  <Text style={[styles.dateInputText, { color: endDate ? theme.colors.text : '#999' }]}>
                    {endDate ? endDate.toLocaleDateString() : 'Select end date'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: '#f0f0f0' }]}
                onPress={() => {
                  setStartDate(null);
                  setEndDate(null);
                  setShowDatePicker(false);
                  fetchActivityFeed();
                }}
              >
                <Text style={[styles.modalButtonText, { color: '#666' }]}>Clear</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalButton, { backgroundColor: theme.colors.primary }]}
                onPress={() => {
                  setShowDatePicker(false);
                  fetchActivityFeed();
                }}
              >
                <Text style={[styles.modalButtonText, { color: 'white' }]}>Apply</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#FDF3D7",
  },
  container: {
    borderTopRightRadius: 36,
    borderTopLeftRadius: 36,
    flex: 1,
    backgroundColor: '#FFF',
    padding: 8,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContainer: {
    backgroundColor: "#FFF",
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
  },
  listContent: {
    paddingBottom: 16,
  },
  eventItem: {
    flexDirection: 'row',
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 4,
    borderRadius: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
      },
      android: {
        elevation: 2,
      },
    }),
  },
  eventIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  eventContent: {
    flex: 1,
  },
  eventMessage: {
    fontSize: 14,
    lineHeight: 18,
    marginBottom: 4,
  },
  eventMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  eventTime: {
    fontSize: 12,
    marginRight: 8,
  },
  platformBadge: {
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  platformText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#3730A3',
  },
  variantTitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  eventImage: {
    marginLeft: 12,
  },
  imagePlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  loadingMore: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadingMoreText: {
    marginLeft: 10,
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 8,
    borderColor: "rgba(102,102,102,0.26)",
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
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
    fontSize: 16,
  },
  clearButton: {
    padding: 4,
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    marginBottom: 16,
    justifyContent: "space-between",
  },
  dateFilterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 8,
  },
  dateFilterButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modalContent: {
    width: '80%',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalBody: {
    width: '100%',
    marginBottom: 20,
  },
  dateSection: {
    marginBottom: 15,
  },
  dateLabel: {
    fontSize: 14,
    marginBottom: 8,
  },
  dateInput: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  dateInputText: {
    marginLeft: 10,
    fontSize: 16,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  modalButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ActivityFeedScreen;

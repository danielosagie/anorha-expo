import React, { useMemo, useState, useEffect, useContext } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Dimensions, Image } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import Card from '../components/Card';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LegendStateContext } from '../context/LegendStateContext';
import { supabase } from '../../lib/supabase';
import InventoryListCard from '../components/InventoryListCard';
import ActivityEventCard from '../components/ActivityEventCard';
import SearchBarWithScanner from '../components/SearchBarWithScanner';
import { useOrg } from '../context/OrgContext';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { useProductVariantRealtime } from '../hooks/useProductVariantRealtime';
import { useOrgNudges, trackInsightAction } from '../hooks/useOrgNudges';

// User-relevant event types for activity display (excludes system/webhook events)
const USER_RELEVANT_EVENT_TYPES = [
  'ORDER_CREATED',
  'ORDER_UPDATED', 
  'INVENTORY_UPDATED',
  'INVENTORY_ADJUSTMENT',
  'PRODUCT_CREATED',
  'PRODUCT_UPDATED',
  'PRICE_CHANGE',
];

// Pool Performance Heatmap - shows real pool performance data
interface PoolPerformance {
  id: string;
  name: string;
  percentage: number;
  barLength: number; // 0-10 bars
}

const PoolPerformanceHeatmap: React.FC<{ 
  pools: PoolPerformance[]; 
  timeframe: 'Last 7d' | '30d' | '90d' | 'YTD' | '1Y';
  onTimeframeChange: (tf: 'Last 7d' | '30d' | '90d' | 'YTD' | '1Y') => void;
}> = ({ pools, timeframe, onTimeframeChange }) => {
  const maxBars = 10;
  
  // Show empty state if no data
  if (!pools || pools.length === 0) {
    return (
      <View style={styles.poolHeatmapContainer}>
        <View style={styles.emptyHeatmapState}>
          <Text style={styles.emptyHeatmapText}>No data available</Text>
        </View>
        {/* Timeframe Toggle */}
        <View style={styles.timeframeToggle}>
          {(['Last 7d', '30d', '90d', 'YTD', '1Y'] as const).map((tf) => (
            <TouchableOpacity
              key={tf}
              onPress={() => onTimeframeChange(tf)}
              style={[
                styles.timeframeBtn,
                tf === timeframe && styles.timeframeBtnActive,
              ]}
            >
              <Text 
                style={[
                  styles.timeframeLabel,
                  tf === timeframe && styles.timeframeActive,
                ]}
              >
                {tf}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }
  
  return (
    <View style={styles.poolHeatmapContainer}>
      {pools.map((pool) => (
        <View key={pool.id} style={styles.poolRow}>
          <Text style={styles.poolName} numberOfLines={1}>{pool.name}</Text>
          <View style={styles.poolBarsContainer}>
            {Array.from({ length: maxBars }).map((_, idx) => (
              <View
                key={idx}
                style={[
                  styles.poolBar,
                  {
                    backgroundColor: idx < pool.barLength ? 'rgb(147, 200, 34)' : '#F3F4F6',
                    opacity: idx < pool.barLength ? 1 : 0.5,
                  },
                ]}
              />
            ))}
          </View>
          <Text style={styles.poolPercentage}>{pool.percentage}%</Text>
        </View>
      ))}
      
      {/* Timeframe Toggle */}
      <View style={styles.timeframeToggle}>
        {(['Last 7d', '30d', '90d', 'YTD', '1Y'] as const).map((tf) => (
          <TouchableOpacity
            key={tf}
            onPress={() => onTimeframeChange(tf)}
            style={[
              styles.timeframeBtn,
              tf === timeframe && styles.timeframeBtnActive,
            ]}
          >
            <Text 
              style={[
                styles.timeframeLabel,
                tf === timeframe && styles.timeframeActive,
              ]}
            >
              {tf}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const DashboardScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const legendCtx = useContext(LegendStateContext);
  const { currentOrg, isLoading: isOrgLoading } = useOrg();
  
  // Subscribe to real-time product variant changes
  useProductVariantRealtime();
  
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Tab state for "Needs Attention"
  const [activeTab, setActiveTab] = useState<'low_stock' | 'pending_orders'>('low_stock');

  // Track if initial data has loaded
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);

  // Pool performance data
  const [poolPerformance, setPoolPerformance] = useState<PoolPerformance[]>([]);
  const [locationPerformance, setLocationPerformance] = useState<PoolPerformance[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [activeTimeframe, setActiveTimeframe] = useState<'Last 7d' | '30d' | '90d' | 'YTD' | '1Y'>('Last 7d');
  const [showPoolsMode, setShowPoolsMode] = useState(true); // true = pools, false = locations

  // AI-generated insights
  const { insight, loading: loadingInsight, error: insightError, refetch: refetchInsight, forceRefresh: forceRefreshInsight } = useOrgNudges(currentOrg?.id);

  // Fetch pool performance data from DB
  const fetchPoolPerformance = async () => {
    if (!currentOrg?.id) return;
    
    try {
      setLoadingPools(true);
      const token = await ensureSupabaseJwt();
      
      // Fetch pools for this org
      const poolsRes = await fetch(`https://api.sssync.app/api/pools/org/${currentOrg.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!poolsRes.ok) {
        console.error(`Pool fetch failed: ${poolsRes.status} ${poolsRes.statusText}`);
        setPoolPerformance([]);
        return;
      }
      
      const poolsData = await poolsRes.json();
      
      // Compute real performance data from inventory levels
      const levels = legendCtx?.inventoryLevels$?.get?.() || {};
      const performanceData: PoolPerformance[] = poolsData.map((pool: any) => {
        // Calculate total inventory for this pool
        let poolTotal = 0;
        Object.values(levels).forEach((level: any) => {
          // Match inventory levels to pool via location
          if (level.Quantity) {
            poolTotal += level.Quantity;
          }
        });
        
        // Calculate as percentage of total inventory
        const allInventory = Object.values(levels).reduce((sum: number, level: any) => sum + (level.Quantity || 0), 0);
        const percentage = allInventory > 0 ? Math.round((poolTotal / allInventory) * 100) : 0;
        const barLength = Math.ceil((percentage / 100) * 10);
        
        return {
          id: pool.id,
          name: pool.name,
          percentage: Math.max(0, Math.min(100, percentage)), // Clamp 0-100
          barLength: Math.max(0, Math.min(10, barLength)), // Clamp 0-10
        };
      });
      
      setPoolPerformance(performanceData);
    } catch (e) {
      console.error('Failed to fetch pool performance:', e);
      setPoolPerformance([]);
    } finally {
      setLoadingPools(false);
    }
  };

  // Fetch location performance data (inventory by location)
  const fetchLocationPerformance = async () => {
    if (!currentOrg?.id) return;
    
    try {
      setLoadingLocations(true);
      const token = await ensureSupabaseJwt();
      
      // Fetch platform locations for this org
      const locationsRes = await fetch(`https://api.sssync.app/api/pools/locations/available?orgId=${currentOrg.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      
      if (!locationsRes.ok) {
        console.error(`Locations fetch failed: ${locationsRes.status} ${locationsRes.statusText}`);
        // Fallback: compute from local inventory levels
        computeLocationPerformanceFromLegend();
        return;
      }
      
      const locationsData = await locationsRes.json();
      const levels = legendCtx?.inventoryLevels$?.get?.() || {};
      
      // Calculate total inventory across all locations
      const allInventory = Object.values(levels).reduce((sum: number, level: any) => sum + (level.Quantity || 0), 0);
      
      // Group inventory by location
      const locationInventory: Record<string, number> = {};
      Object.values(levels).forEach((level: any) => {
        const locId = level.PlatformLocationId || level.LocationId;
        if (locId) {
          locationInventory[locId] = (locationInventory[locId] || 0) + (level.Quantity || 0);
        }
      });
      
      // Map locations with their inventory percentages
      const performanceData: PoolPerformance[] = (Array.isArray(locationsData) ? locationsData : [])
        .slice(0, 5) // Show top 5 locations
        .map((loc: any) => {
          const locTotal = locationInventory[loc.Id] || locationInventory[loc.PlatformLocationId] || 0;
          const percentage = allInventory > 0 ? Math.round((locTotal / allInventory) * 100) : 0;
          const barLength = Math.ceil((percentage / 100) * 10);
          
          return {
            id: loc.Id || loc.PlatformLocationId,
            name: loc.Name || loc.DisplayName || 'Location',
            percentage: Math.max(0, Math.min(100, percentage)),
            barLength: Math.max(0, Math.min(10, barLength)),
          };
        })
        .filter((loc: PoolPerformance) => loc.name); // Filter out unnamed locations
      
      setLocationPerformance(performanceData);
    } catch (e) {
      console.error('Failed to fetch location performance:', e);
      // Fallback: compute from local inventory levels
      computeLocationPerformanceFromLegend();
    } finally {
      setLoadingLocations(false);
    }
  };

  // Fallback: compute location performance from local legend state
  const computeLocationPerformanceFromLegend = () => {
    const levels = legendCtx?.inventoryLevels$?.get?.() || {};
    const allInventory = Object.values(levels).reduce((sum: number, level: any) => sum + (level.Quantity || 0), 0);
    
    // Group by location
    const locationMap: Record<string, { name: string; total: number }> = {};
    Object.values(levels).forEach((level: any) => {
      const locId = level.PlatformLocationId || level.LocationId || 'default';
      const locName = level.LocationName || level.PlatformLocationName || `Location ${Object.keys(locationMap).length + 1}`;
      if (!locationMap[locId]) {
        locationMap[locId] = { name: locName, total: 0 };
      }
      locationMap[locId].total += level.Quantity || 0;
    });
    
    const performanceData: PoolPerformance[] = Object.entries(locationMap)
      .map(([id, data]) => {
        const percentage = allInventory > 0 ? Math.round((data.total / allInventory) * 100) : 0;
        return {
          id,
          name: data.name,
          percentage: Math.max(0, Math.min(100, percentage)),
          barLength: Math.max(0, Math.min(10, Math.ceil((percentage / 100) * 10))),
        };
      })
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 5);
    
    setLocationPerformance(performanceData);
    setLoadingLocations(false);
  };

  const refreshData = async () => {
    setRefreshing(true);
    // Trigger re-fetches here
    await fetchActivity();
    await fetchPoolPerformance();
    await fetchLocationPerformance();
    await refetchInsight();
    setRefreshing(false);
  };

  // 1. Compute Live Inventory Stats & Low Stock Items
  const { lowStockItems, lowStockCount, totalInventory } = useMemo(() => {
    const pv = legendCtx?.productVariants$?.get?.() || {};
    const levels = legendCtx?.inventoryLevels$?.get?.() || {};
    const images = legendCtx?.productImages$?.get?.() || {};
    
    let total = 0;
    const variantQuantities: Record<string, number> = {};
    
    Object.values(levels).forEach((level: any) => {
        const qty = level.Quantity || 0;
        total += qty;
        const vid = level.ProductVariantId;
        if (vid) {
            variantQuantities[vid] = (variantQuantities[vid] || 0) + qty;
        }
    });

    const threshold = 5;
    const items = Object.keys(variantQuantities)
        .filter(vid => variantQuantities[vid] <= threshold)
        .map(vid => {
            const variant = pv[vid];
            // Find image
            const img = Object.values(images).find((i: any) => i.ProductVariantId === vid);
            
            // Determine platforms (mock logic if not strictly in variants, but we have OnShopify flags)
            const platforms = [];
            if (variant?.OnShopify) platforms.push('shopify');
            if (variant?.OnSquare) platforms.push('square');
            if (variant?.OnAmazon) platforms.push('amazon');

            return {
                id: vid,
                title: variant?.Title || 'Unknown Product',
                quantity: variantQuantities[vid],
                sku: variant?.Sku,
                price: variant?.Price,
                imageUrl: img?.ImageUrl,
                platformNames: platforms
            };
        })
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 5); // Top 5

    return { 
        totalInventory: total, 
        lowStockItems: items,
        lowStockCount: Object.keys(variantQuantities).filter(vid => variantQuantities[vid] <= threshold).length
    };
  }, [legendCtx?.productVariants$, legendCtx?.inventoryLevels$, legendCtx?.productImages$]);

  // 2. Fetch Recent Activity (filtered to user-relevant events only)
  const fetchActivity = async () => {
    if (!currentOrg?.id) {
      console.warn('[Dashboard] Skipping activity fetch: no current org');
      setLoadingActivity(false);
      setRecentActivity([]);
      return;
    }

    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        console.warn('[Dashboard] No JWT available for activity fetch');
        setLoadingActivity(false);
        setRecentActivity([]);
        return;
      }

      const base = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
      // Fetch more events so we can filter and still have enough to show
      const url = `${base}/api/activity?limit=20&orgId=${encodeURIComponent(currentOrg.id)}`;
      
      console.log(`[Dashboard] Fetching activity from ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });
      
      if (!response.ok) {
        console.error(`[Dashboard] Activity fetch failed: ${response.status} ${response.statusText}`);
        const errorBody = await response.text();
        console.error(`[Dashboard] Error: ${errorBody}`);
        setRecentActivity([]);
        setLoadingActivity(false);
        return;
      }
      
      const json = await response.json();
      console.log(`[Dashboard] Activity response:`, {
        eventsCount: json.events?.length || 0,
        hasMore: json.hasMore,
      });
      
      if (json.events && Array.isArray(json.events)) {
        // Filter to prefer user-relevant events (not webhooks, system events, etc.)
        const filteredEvents = json.events.filter((event: any) => {
          const eventType = event.EventType || '';
          // Exclude webhook/system events explicitly
          const isSystemEvent = eventType.includes('WEBHOOK') || 
                                eventType.includes('SYNC_') ||
                                eventType.includes('USER_VIEWED') ||
                                eventType.includes('DASHBOARD') ||
                                eventType.includes('ACCESS_REQUEST') ||
                                eventType.includes('SCAN_') ||
                                eventType.includes('RECONCILE');
          return !isSystemEvent;
        });
        
        console.log(`[Dashboard] Filtered ${json.events.length} → ${filteredEvents.length} non-system events`);
        // If we have filtered events, use them; otherwise fall back to all events (except webhooks)
        const eventsToShow = filteredEvents.length > 0 ? filteredEvents : json.events;
        setRecentActivity(eventsToShow.slice(0, 5)); // Show top 5 events
      } else {
        console.warn('[Dashboard] Activity response missing events array:', json);
        setRecentActivity([]);
      }
    } catch (e) {
      console.error('[Dashboard] Failed to fetch activity:', e);
      setRecentActivity([]);
    } finally {
      setLoadingActivity(false);
      setInitialDataLoaded(true);
    }
  };

  // Only fetch data when org context has finished loading AND we have an org ID
  useEffect(() => {
    if (isOrgLoading) {
      console.log('[Dashboard] Waiting for org context to load...');
      return;
    }
    
    if (!currentOrg?.id) {
      console.log('[Dashboard] No org ID available after org context loaded');
      setLoadingActivity(false);
      setInitialDataLoaded(true);
      return;
    }

    console.log(`[Dashboard] Org context loaded, fetching data for org: ${currentOrg.id}`);
    fetchActivity();
    fetchPoolPerformance();
    fetchLocationPerformance();
  }, [currentOrg?.id, isOrgLoading]);

  // Handle insight action clicks
  const handleInsightAction = async (actionLink: string, insightTitle: string) => {
    if (!currentOrg?.id) return;
    
    // Track the action
    await trackInsightAction(currentOrg.id, actionLink, insightTitle);
    
    // Navigate based on link
    if (actionLink.includes('/inventory')) {
      const params: any = {};
      if (actionLink.includes('filter=low_stock')) {
        params.initialFilter = 'low_stock';
      } else if (actionLink.includes('filter=slow')) {
        params.initialFilter = 'slow';
      }
      navigation.navigate('Inventory', params);
    } else if (actionLink.includes('/orders')) {
      navigation.navigate('Orders');
    } else if (actionLink.includes('/pools')) {
      navigation.navigate('Profile'); // Pools are managed in Profile
    }
  };

  const formatActivityTime = (timestamp: string) => {
    try {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  const [searchQuery, setSearchQuery] = useState('');

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
  };

  // Show loading state while org context is still loading
  if (isOrgLoading) {
    return (
      <View style={styles.fullScreenContainer}>
        <View style={styles.greenHeader} />
        <View style={[styles.container, styles.loadingContainer]}>
          <ActivityIndicator size="large" color="#93C822" />
          <Text style={styles.loadingText}>Loading your dashboard...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.fullScreenContainer}>
      {/* Green Header Background */}
      <View style={styles.greenHeader} />

      <ScrollView 
        style={styles.container} 
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshData} tintColor="#333" />}
        contentContainerStyle={{ paddingBottom: 10 }}
      >

        {/* Search Bar - Works across Activities & Inventory */}
        <SearchBarWithScanner
          placeholder="Search across products & activity"
          value={searchQuery}
          onChangeText={handleSearchChange}
          onScan={(barcode) => {
            // When barcode is scanned, navigate to Inventory with barcode search
            navigation.navigate('Inventory', { 
              initialSearch: barcode, 
              initialSortBy: 'name',
              searchType: 'barcode'
            });
            setSearchQuery('');
          }}
          onScannerOpen={() => {
            // Open scanner in Inventory screen
            navigation.navigate('Inventory', { openScannerOnMount: true });
          }}
          onClear={handleClearSearch}
        />

        {/* Today Card */}
        <View style={styles.todayCardContainer}>
            
            <View style={styles.todayCard}>
                <View style={styles.todayCardContent}>
                    <View style={styles.todayLeft}>
                        <Text style={styles.sectionTitle}>Today</Text>
                        <Text style={styles.lastUpdated}>Updated at {new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})}</Text>
                        
                        <Text style={styles.quickStatusTitle}>Quick Status:</Text>
                        {loadingInsight ? (
                          <View style={styles.insightLoading}>
                            <ActivityIndicator size="small" color="#93C822" />
                            <Text style={styles.insightLoadingText}>Loading insights...</Text>
                          </View>
                        ) : insightError ? (
                          <View style={styles.insightError}>
                            <Text style={styles.insightErrorText}>Unable to load insights</Text>
                            <View style={styles.insightErrorActions}>
                              <TouchableOpacity onPress={refetchInsight}>
                                <Text style={styles.insightRetryText}>Retry</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={forceRefreshInsight} style={styles.forceRefreshBtn}>
                                <Text style={styles.forceRefreshText}>Force Refresh</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ) : insight ? (
                          <>
                            
                            <Text style={styles.quickStatusSubtext}>
                              {insight.title}- 
                              {insight.description}
                            </Text>
                            <View style={styles.insightActions}>
                              {insight.action && (
                                <TouchableOpacity 
                                  onPress={() => handleInsightAction(insight.action!.link, insight.title)}
                                >
                                  <Text style={styles.quickStatusLink}>
                                    {insight.action.label}
                                    {insight.action.count !== undefined && ` (${insight.action.count})`}
                                  </Text>
                                </TouchableOpacity>
                              )}
                              <TouchableOpacity 
                                onPress={forceRefreshInsight}
                                style={styles.refreshIconBtn}
                              >
                                <Icon name="refresh" size={16} color="#6B7280" />
                              </TouchableOpacity>
                            </View>
                          </>
                        ) : (
                          <View style={styles.noInsightContainer}>
                            <Text style={styles.quickStatusSubtext}>
                              No insights available at this time.
                            </Text>
                            <TouchableOpacity onPress={forceRefreshInsight} style={styles.forceRefreshBtn}>
                              <Text style={styles.forceRefreshText}>Generate Insight</Text>
                            </TouchableOpacity>
                          </View>
                        )}
                    </View>
                    <View style={styles.todayRight}>
                        <Text style={styles.chartTitle}>Most Active {showPoolsMode ? 'Pools' : 'Locations'}</Text>
                        {(showPoolsMode ? loadingPools : loadingLocations) ? (
                          <ActivityIndicator size="small" color="#93C822" style={styles.poolLoader} />
                        ) : (
                          <PoolPerformanceHeatmap 
                            pools={showPoolsMode ? poolPerformance : locationPerformance} 
                            timeframe={activeTimeframe}
                            onTimeframeChange={setActiveTimeframe}
                          />
                        )}
                        <View style={styles.poolToggle}>
                            <TouchableOpacity
                              onPress={() => setShowPoolsMode(true)}
                              style={[styles.poolToggleBtn, showPoolsMode && styles.poolToggleActive]}
                            >
                              <Text style={[styles.poolToggleText, showPoolsMode && styles.poolToggleTextActive]}>Pools</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => setShowPoolsMode(false)}
                              style={[styles.poolToggleBtn, !showPoolsMode && styles.poolToggleActive]}
                            >
                              <Text style={[styles.poolToggleText, !showPoolsMode && styles.poolToggleTextActive]}>Locations</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </View>
        </View>

        {/* Needs Attention */}
        <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Needs Attention</Text>

            <View style={[styles.todayCard, {padding: 0}]}>
            
              <View style={[styles.tabsContainer, {margin: 8 }]}>
                  <TouchableOpacity 
                      style={[styles.tab, activeTab === 'low_stock' && styles.activeTab]}
                      onPress={() => setActiveTab('low_stock')}
                  >
                      <Icon name="package-variant" size={16} color={activeTab === 'low_stock' ? '#1F2937' : '#6B7280'} style={{marginRight: 6}} />
                      <Text style={[styles.tabText, activeTab === 'low_stock' && styles.activeTabText]}>Low Stock</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                      style={[styles.tab, activeTab === 'pending_orders' && styles.activeTab]}
                      onPress={() => setActiveTab('pending_orders')}
                  >
                      <Icon name="cube-send" size={16} color={activeTab === 'pending_orders' ? '#1F2937' : '#6B7280'} style={{marginRight: 6}} />
                      <Text style={[styles.tabText, activeTab === 'pending_orders' && styles.activeTabText]}>Pending Orders</Text>
                  </TouchableOpacity>
              </View>

              {activeTab === 'low_stock' && (
                  <View style={styles.listContainer}>
                      {lowStockItems.map((item) => (
                          <InventoryListCard
                              key={item.id}
                              id={item.id}
                              title={item.title}
                              sku={item.sku}
                              price={item.price}
                              totalQuantity={item.quantity}
                              imageUrl={item.imageUrl}
                              platformNames={item.platformNames}
                              onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
                          />
                      ))}
                      {lowStockItems.length === 0 && (
                          <View style={styles.emptyState}>
                              <Icon name="check-circle" size={32} color="rgb(208, 255, 170)" />
                              <Text style={styles.emptyText}>Everything is stocked!</Text>
                          </View>
                      )}
                </View>
            )}

            {activeTab === 'pending_orders' && (
                <View style={styles.listContainer}>
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>No pending orders</Text>
                    </View>
                </View>
            )}
            </View>
        </View>

        {/* Recent Activity */}
        <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            
            <View style={[styles.todayCard, {padding: 0}]}>
                {recentActivity.slice(0, 3).map((event, idx) => {
                    // Look up image and details if ProductVariantId exists
                    let imageUrl = undefined;
                    let productTitle = event.Details?.productTitle || event.Message;
                    let sku = event.Details?.sku;
                    
                    if (event.ProductVariantId) {
                        const images = legendCtx?.productImages$?.get?.() || {};
                        const variants = legendCtx?.productVariants$?.get?.() || {};
                        
                        const img = Object.values(images).find((i: any) => i.ProductVariantId === event.ProductVariantId);
                        imageUrl = img?.ImageUrl;
                        
                        const variant = variants[event.ProductVariantId];
                        if (variant) {
                             if (!event.Details?.productTitle) productTitle = variant.Title;
                             if (!sku) sku = variant.Sku;
                        }
                    }

                    return (
                        <ActivityEventCard 
                            key={event.Id || idx} 
                            id={event.Id || `activity-${idx}`}
                            title={productTitle}
                            displayTitle={event.EventType === 'INVENTORY_UPDATE' ? 'Inventory Adjustment' : 'System Update'}
                            sku={sku}
                            timestamp={event.Timestamp}
                            imageUrl={imageUrl}
                            reasonText={event.Details?.reason}
                            eventType={event.EventType}
                            ownerLabel={event.Details?.platform}
                            onPress={() => event.ProductVariantId && navigation.navigate('ProductDetail', { productId: event.ProductVariantId })}
                        />
                    );
                })}
            </View>
        </View>

      </ScrollView>
      
      {/* Floating Tab Bar provided by Navigator, but we ensure spacing */}
    </View>
  );
};

const styles = StyleSheet.create({
  fullScreenContainer: {
    flex: 1,
    backgroundColor: 'rgb(208, 255, 170)', 
  },
  greenHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'rgb(208, 255, 170)', // Match InventoryOrdersScreen
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    marginTop: 60,
    borderTopRightRadius: 32,
    borderTopLeftRadius: 32,
    backgroundColor: '#FAFAFA', // Slightly off-white for better card contrast
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  
  // Today Card
  todayCardContainer: {
    marginBottom: 24,

    backgroundColor: "transparent",
    minWidth: "100%",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  lastUpdated: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
  },
  todayCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,

  },
  todayCardContent: {
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  todayLeft: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  quickStatusTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 4,
  },
  quickStatusHeadline: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
    lineHeight: 18,
  },
  quickStatusSubtext: {
    fontSize: 13,
    color: '#4B5563',
    marginBottom: 12,
    lineHeight: 18,
  },
  quickStatusLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
    textDecorationLine: 'underline',
  },
  // Insight states
  insightLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 12,
  },
  insightLoadingText: {
    fontSize: 13,
    color: '#6B7280',
  },
  insightError: {
    marginTop: 4,
    marginBottom: 12,
  },
  insightErrorText: {
    fontSize: 13,
    color: '#DC2626',
    marginBottom: 4,
  },
  insightRetryText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  insightIcon: {
    fontSize: 18,
    marginBottom: 4,
  },
  insightCritical: {
    color: '#DC2626',
  },
  insightWarning: {
    color: '#F59E0B',
  },
  insightGood: {
    color: '#10B981',
  },
  noInsightContainer: {
    marginTop: 8,
  },
  insightErrorActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  forceRefreshBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 6,
  },
  forceRefreshText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
  },
  insightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  refreshIconBtn: {
    padding: 4,
  },
  todayRight: {
    width: 220,
    justifyContent: 'space-between',
  },
  chartTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111',
    marginBottom: 8,
  },
  // Pool Performance Heatmap Styles
  poolHeatmapContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    width: '100%',
  },
  poolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  poolName: {
    fontSize: 11,
    fontWeight: '500',
    color: '#374151',
    width: 60,
  },
  poolBarsContainer: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  poolBar: {
    flex: 1,
    height: 8,
    borderRadius: 4,
  },
  poolPercentage: {
    fontSize: 9,
    fontWeight: '600',
    color: '#111827',
    width: 30,
    textAlign: 'right',
  },
  timeframeToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 6,
  },
  timeframeBtn: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  timeframeBtnActive: {
    backgroundColor: '#F3F4F6',
  },
  timeframeLabel: {
    fontSize: 10,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  timeframeActive: {
    color: '#111827',
    fontWeight: '700',
  },
  poolLoader: {
    height: 100,
    justifyContent: 'center',
  },
  emptyHeatmapState: {
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyHeatmapText: {
    fontSize: 12,
    color: '#9CA3AF',
    fontStyle: 'italic',
  },
  // Pool Toggle
  poolToggle: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    padding: 2,
    width: '100%',
  },
  poolToggleBtn: {
    flex: 1,
    paddingVertical: 4,
    alignItems: 'center',
    borderRadius: 6,
  },
  poolToggleActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  poolToggleText: {
    fontSize: 10,
    color: '#6B7280',
    fontWeight: '500',
  },
  poolToggleTextActive: {
    fontSize: 10,
    color: '#111',
    fontWeight: '600',
  },

  // Section Container
  sectionContainer: {
    marginBottom: 24,

    gap: 8,

  },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
  },
  activeTabText: {
    color: '#111',
    fontWeight: '600',
  },
  listContainer: {
    gap: 12,
  },
  emptyState: {
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  emptyText: {
    marginTop: 8,
    color: '#6B7280',
    fontSize: 14,
  },

  // Activity List
  activityList: {
    marginHorizontal: -8, // Compensate for card margin
  },
});

export default DashboardScreen;
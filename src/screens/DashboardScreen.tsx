import React, { useMemo, useState, useEffect, useContext } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Dimensions, Image, Modal, Pressable } from 'react-native';
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
  
  // Tab state for Overview
  const [activeTab, setActiveTab] = useState<'low_stock' | 'recent_activity'>('low_stock');

  // Track if initial data has loaded
  const [initialDataLoaded, setInitialDataLoaded] = useState(false);

  // Pool performance data
  const [poolPerformance, setPoolPerformance] = useState<PoolPerformance[]>([]);
  const [locationPerformance, setLocationPerformance] = useState<PoolPerformance[]>([]);
  const [loadingPools, setLoadingPools] = useState(false);
  const [loadingLocations, setLoadingLocations] = useState(false);
  const [activeTimeframe, setActiveTimeframe] = useState<'Last 7d' | '30d' | '90d' | 'YTD' | '1Y'>('Last 7d');
  const [showPoolsMode, setShowPoolsMode] = useState(true); // true = pools, false = locations
  const [sourcesVisible, setSourcesVisible] = useState(false);

  // AI-generated insights
  const { insight, loading: loadingInsight, error: insightError, refetch: refetchInsight, forceRefresh: forceRefreshInsight } = useOrgNudges(currentOrg?.id);

  // Guard against legacy insight shape without DIN fields
  const safeInsight = useMemo(() => {
    if (!insight) return null;
    if ((insight as any).topDIN && (insight as any).bottomDIN) {
      return insight as any;
    }
    // Legacy fallback mapping
    const legacy: any = insight;
    return {
      topDIN: {
        category: 'Priority',
        headline: legacy.title || 'Status',
      },
      bottomDIN: {
        title: legacy.title || 'Details',
        description: legacy.description || 'Review your metrics.',
        metrics: legacy.metrics,
        action: legacy.action,
      },
      severity: legacy.severity || 'neutral',
      urgency: legacy.urgency,
      timestamp: legacy.timestamp,
    };
  }, [insight]);

  const formatImpactHeadline = (impact?: { value: number; unit: string; context?: string; headline?: string }) => {
    if (!impact) return '';
    if (impact.headline) return impact.headline;
    const value = Math.round(impact.value).toLocaleString();
    if (impact.unit === 'dollars') {
      return `$${value}${impact.context ? ` ${impact.context}` : ''}`;
    }
    if (impact.unit === 'days') {
      return `${value} days ${impact.context || ''}`.trim();
    }
    return `${value} ${impact.context || ''}`.trim();
  };

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

  // Sources bottom sheet data
  const insightSources = safeInsight?.sources || [];
  const hasSources = insightSources.length > 0;
  const getFavicon = (url?: string) => {
    if (!url) return null;
    try {
      const domain = new URL(url).hostname;
      return `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
    } catch {
      return null;
    }
  };

  const renderSourceItem = (source: any, idx: number) => {
    const isDb = source.type === 'database';
    const favicon = !isDb ? getFavicon(source.url) : null;
    return (
      <View key={idx} style={styles.sourceItem}>
        <View style={styles.sourceIconWrap}>
          {isDb ? (
            <Icon name="database" size={18} color="#10B981" />
          ) : favicon ? (
            <Image source={{ uri: favicon }} style={styles.favicon} />
          ) : (
            <Icon name="web" size={18} color="#3B82F6" />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sourceTitle}>
            {isDb ? 'Supabase (Anorha)' : source.title || source.url || 'Source'}
          </Text>
          {source.query ? (
            <Text style={styles.sourceSub} numberOfLines={2}>
              {source.query}
            </Text>
          ) : null}
          {typeof source.rowsReturned === 'number' ? (
            <Text style={styles.sourceMeta}>{source.rowsReturned} rows</Text>
          ) : null}
          {source.sampleRows && source.sampleRows.length > 0 ? (
            <Text style={styles.sourceMeta}>Sample: {JSON.stringify(source.sampleRows.slice(0, 2))}</Text>
          ) : null}
          {source.url ? (
            <Text style={[styles.sourceMeta, { color: '#2563EB' }]} numberOfLines={1}>
              {source.url}
            </Text>
          ) : null}
        </View>
      </View>
    );
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
                {loadingInsight ? (
                  // Loading state with nice animation
                  <View style={styles.insightCardGreen}>
                    <View style={styles.insightGreenHeader}>
                      <Text style={styles.todayTitle}>Sprout's Insight</Text>
                      <Text style={styles.todayMeta}>Analyzing...</Text>
                    </View>
                    <View style={[styles.insideContainer, { alignItems: 'center', paddingVertical: 32 }]}>
                      <ActivityIndicator size="large" color="#93C822" />
                      <Text style={[styles.insightGreenDesc, { textAlign: 'center', marginTop: 16 }]}>
                        Analyzing your inventory, sales trends, and market data...
                      </Text>
                    </View>
                  </View>
                ) : insightError ? (
                  // Error state with retry options
                  <View style={styles.insightCardGreen}>
                    <View style={styles.insightGreenHeader}>
                      <Text style={styles.todayTitle}>Sprout's Insight</Text>
                      <Text style={styles.todayMeta}>Offline</Text>
                    </View>
                    <View style={styles.insideContainer}>
                      <Text style={styles.insightGreenHeadline}>Connection issue</Text>
                      <Text style={styles.insightGreenDesc}>
                        Unable to fetch insights right now. This might be a network issue - check your connection and try again.
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
                        <TouchableOpacity onPress={refetchInsight} style={[styles.insightGreenBtn, { flex: 1, backgroundColor: '#F3F4F6' }]}>
                          <Text style={[styles.insightGreenBtnText, { color: '#374151' }]}>Retry</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={forceRefreshInsight} style={[styles.insightGreenBtn, { flex: 1 }]}>
                          <Text style={styles.insightGreenBtnText}>Force Refresh</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                ) : safeInsight && safeInsight.topDIN && safeInsight.bottomDIN ? (
                  <TouchableOpacity
                    activeOpacity={0.95}
                    style={styles.insightCardGreen}
                    onPress={() => safeInsight.bottomDIN.action ? handleInsightAction(safeInsight.bottomDIN.action.link, safeInsight.bottomDIN.title) : undefined}
                  >
                    <View style={styles.insightGreenHeader}>
                      
                      <Text style={styles.todayTitle}>Sprout's Insight</Text>
                      <Text style={styles.todayMeta}>
                        Updated {safeInsight.timestamp ? new Date(safeInsight.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '2m ago'}
                      </Text>
                    </View>
                    <View style={styles.insideContainer}>
                      
                      {/* Outcome Headline */}
                      <Text style={styles.insightGreenHeadline}>
                        {safeInsight.topDIN.headline || 'Recover value today'}
                      </Text>

                      {/* Description */}
                      <Text style={styles.insightGreenDesc} numberOfLines={4}>
                        {safeInsight.bottomDIN.description}
                      </Text>

                      {/* Metrics: Two-column layout */}
                      {safeInsight.bottomDIN.metrics && safeInsight.bottomDIN.metrics.length >= 2 && (
                        <View style={styles.insightGreenMetrics}>
                          {safeInsight.bottomDIN.metrics[0] ? (
                            <View style={styles.insightGreenMetricCol}>
                              <Text style={styles.insightGreenMetricLabel}>{safeInsight.bottomDIN.metrics[0].label}</Text>
                              <Text style={styles.insightGreenMetricValue}>{safeInsight.bottomDIN.metrics[0].value}</Text>
                            </View>
                          ) : null}
                          {safeInsight.bottomDIN.metrics[1] ? (
                            <View style={styles.insightGreenMetricCol}>
                              <Text style={styles.insightGreenMetricLabel}>{safeInsight.bottomDIN.metrics[1].label}</Text>
                              <Text style={[styles.insightGreenMetricValue, styles.insightGreenMetricPositive]}>
                                {safeInsight.bottomDIN.metrics[1].value}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      )}

                      {/* Primary Action or Suggestion-only message */}
                      {safeInsight.suggestionOnly ? (
                        <View style={[styles.insightGreenBtn, { backgroundColor: '#E5E7EB' }]}>
                          <Icon name="lightbulb-on-outline" size={18} color="#374151" style={{ marginRight: 8 }} />
                          <Text style={[styles.insightGreenBtnText, { color: '#111827' }]}>
                            {safeInsight.suggestionText || 'Best course of action suggested above'}
                          </Text>
                        </View>
                      ) : safeInsight.bottomDIN.action ? (
                        <TouchableOpacity
                          onPress={() =>
                            handleInsightAction(
                              safeInsight.bottomDIN.action!.link,
                              safeInsight.bottomDIN.title,
                            )
                          }
                          style={styles.insightGreenBtn}
                        >
                          <Text style={styles.insightGreenBtnText}>
                            {safeInsight.bottomDIN.action.label || 'Take action'}
                          </Text>
                          <Icon name="arrow-right" size={20} color="#fff" />
                        </TouchableOpacity>
                      ) : null}

                      {/* Footer: Product breakdown or meta actions */}
                      {safeInsight.bottomDIN.affectedProducts && safeInsight.bottomDIN.affectedProducts.length > 0 ? (
                        <View style={[styles.insightGreenFooter, { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB', flexDirection: 'column', alignItems: 'flex-start' }]}>
                          <Text style={[styles.insightGreenSourcesText, { fontSize: 12, fontWeight: '600', marginBottom: 4 }]}>
                            Based on {safeInsight.bottomDIN.affectedProducts.length} product{safeInsight.bottomDIN.affectedProducts.length > 1 ? 's' : ''}:
                          </Text>
                          {safeInsight.bottomDIN.affectedProducts.slice(0, 2).map((product: any, idx: number) => (
                            <Text key={idx} style={[styles.insightGreenSourcesText, { fontSize: 11, marginTop: 2 }]}>
                              • {product.name} ({product.quantity} units)
                            </Text>
                          ))}
                          {safeInsight.bottomDIN.affectedProducts.length > 2 && (
                            <Text style={[styles.insightGreenSourcesText, { fontSize: 11, marginTop: 2, fontWeight: '500', color: '#6366F1' }]}>
                              + {safeInsight.bottomDIN.affectedProducts.length - 2} more
                            </Text>
                          )}
                        </View>
                      ) : (
                        <View style={styles.insightGreenFooter}>
                          <View style={styles.insightGreenMetaLeft}>
                            <TouchableOpacity style={styles.insightGreenIconBtn}>
                              <Icon name="content-copy" size={16} color="#6B7280" />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.insightGreenIconBtn}>
                              <Icon name="thumb-up-outline" size={16} color="#6B7280" />
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.insightGreenIconBtn}>
                              <Icon name="thumb-down-outline" size={16} color="#6B7280" />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={forceRefreshInsight} style={styles.insightGreenIconBtn}>
                              <Icon name="refresh" size={16} color="#6B7280" />
                            </TouchableOpacity>
                          </View>
                          <TouchableOpacity style={styles.insightGreenSources} onPress={() => setSourcesVisible(true)}>
                            <View style={styles.insightGreenAvatars}>
                              <View style={[styles.avatar, { backgroundColor: '#A78BFA', marginRight: -8 }]} />
                              <View style={[styles.avatar, { backgroundColor: '#60A5FA', marginRight: -8 }]} />
                              <View style={[styles.avatar, { backgroundColor: '#F87171', marginRight: -8 }]} />
                              <View style={[styles.avatar, { backgroundColor: '#FBBF24' }]} />
                            </View>
                            <Text style={styles.insightGreenSourcesText}>Sources</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                ) : (
                  // Beautiful default empty state - shows when no insight is available
                  <TouchableOpacity
                    activeOpacity={0.95}
                    style={styles.insightCardGreen}
                    onPress={forceRefreshInsight}
                  >
                    <View style={styles.insightGreenHeader}>
                      <Text style={styles.todayTitle}>Sprout's Insight</Text>
                      <Text style={styles.todayMeta}>Ready to analyze</Text>
                    </View>
                    <View style={styles.insideContainer}>
                      {/* Welcome headline */}
                      <Text style={styles.insightGreenHeadline}>
                        {currentOrg ? `Let's grow ${currentOrg.name}` : "Welcome to Anorha"}
                      </Text>

                      {/* Description based on state */}
                      <Text style={styles.insightGreenDesc}>
                        {lowStockCount > 0 || totalInventory > 0
                          ? `You have ${totalInventory} items tracked. Tap to get insights about your inventory, sales velocity, and opportunities.`
                          : "Connect your first platform to get started"}
                      </Text>

                      {/* Quick metrics if we have data */}
                      {totalInventory > 0 && (
                        <View style={styles.insightGreenMetrics}>
                          <View style={styles.insightGreenMetricCol}>
                            <Text style={styles.insightGreenMetricLabel}>Total Items</Text>
                            <Text style={styles.insightGreenMetricValue}>{totalInventory.toLocaleString()}</Text>
                          </View>
                          <View style={styles.insightGreenMetricCol}>
                            <Text style={styles.insightGreenMetricLabel}>Low Stock</Text>
                            <Text style={[styles.insightGreenMetricValue, lowStockCount > 0 ? styles.insightGreenMetricWarning : styles.insightGreenMetricPositive]}>
                              {lowStockCount}
                            </Text>
                          </View>
                        </View>
                      )}

                      {/* CTA Button */}
                      <TouchableOpacity
                        onPress={forceRefreshInsight}
                        style={styles.insightGreenBtn}
                      >
                        <Text style={styles.insightGreenBtnText}>
                          {loadingInsight ? 'Analyzing...' : 'Generate Insight'}
                        </Text>
                        <Icon name={loadingInsight ? "loading" : "sparkles"} size={20} color="#fff" />
                      </TouchableOpacity>

                      {/* Footer - Show product sources or default footer */}
                      <View style={styles.insightGreenFooter}>
                        <View style={styles.insightGreenMetaLeft}>
                          <Icon name="robot-outline" size={16} color="#6B7280" style={{marginRight: 4}} />
                          <Text style={styles.insightGreenSourcesText}>Powered by AI</Text>
                        </View>
                        <View style={styles.insightGreenSources}>
                          <View style={styles.insightGreenAvatars}>
                            <View style={[styles.avatar, { backgroundColor: '#93C822', marginRight: -8 }]} />
                            <View style={[styles.avatar, { backgroundColor: '#60A5FA', marginRight: -8 }]} />
                            <View style={[styles.avatar, { backgroundColor: '#FBBF24' }]} />
                          </View>
                          <Text style={styles.insightGreenSourcesText}>Your data</Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                )}
            </View>
        </View>

        {/* Overview */}
        <View style={styles.sectionContainer}>
            <View style={[styles.todayCard, {padding: 0}]}>
              <View style={[styles.tabsContainer, {margin: 8, marginTop: 7, backgroundColor: "#fff", justifyContent: 'space-between'}]}>
                <Text style={[styles.sectionTitle, {marginBottom: 0}]}>Overview</Text>
              </View>
            
              <View style={[styles.tabsContainer, {marginHorizontal: 8, marginTop: 0}]}>
                  <TouchableOpacity 
                      style={[styles.tab, activeTab === 'low_stock' && styles.activeTab]}
                      onPress={() => setActiveTab('low_stock')}
                  >
                      <Icon name="package-variant" size={16} color={activeTab === 'low_stock' ? '#1F2937' : '#6B7280'} style={{marginRight: 6}} />
                      <Text style={[styles.tabText, activeTab === 'low_stock' && styles.activeTabText]}>Low Stock</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                      style={[styles.tab, activeTab === 'recent_activity' && styles.activeTab]}
                      onPress={() => setActiveTab('recent_activity')}
                  >
                      <Icon name="clock-outline" size={16} color={activeTab === 'recent_activity' ? '#1F2937' : '#6B7280'} style={{marginRight: 6}} />
                      <Text style={[styles.tabText, activeTab === 'recent_activity' && styles.activeTabText]}>Recent Activity</Text>
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

            {activeTab === 'recent_activity' && (
                <View style={styles.listContainer}>
                    {recentActivity.slice(0, 3).map((event, idx) => {
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
                    {recentActivity.length === 0 && (
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyText}>No recent activity</Text>
                      </View>
                    )}
                </View>
            )}
            </View>
        </View>

      </ScrollView>
      
      {/* Sources Bottom Sheet */}
      <Modal
        visible={sourcesVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSourcesVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSourcesVisible(false)}>
          <View />
        </Pressable>
        <View style={styles.sourcesSheet}>
          <View style={styles.sourcesHeader}>
            <Text style={styles.sourcesTitle}>Data & Sources</Text>
            <TouchableOpacity onPress={() => setSourcesVisible(false)}>
              <Icon name="close" size={22} color="#111827" />
            </TouchableOpacity>
          </View>
          {hasSources ? (
            <ScrollView style={{ maxHeight: 420 }}>
              {insightSources.map(renderSourceItem)}
            </ScrollView>
          ) : (
            <View style={styles.emptyState}>
              <Icon name="database-off" size={28} color="#9CA3AF" />
              <Text style={styles.emptyText}>No sources available</Text>
            </View>
          )}
        </View>
      </Modal>
      
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
    backgroundColor: 'rgb(208, 255, 170)',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    marginTop: 60,
    borderTopRightRadius: 32,
    borderTopLeftRadius: 32,
    backgroundColor: '#FAFAFA',
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
  },
  todayHeader: {
    marginBottom: 12,
  },
  todayTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  todayMeta: {
    fontSize: 13,
    color: '#6B7280',
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
    padding: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },

  insideContainer: {
    backgroundColor: 'rgb(255, 255, 255)',
    borderRadius: 20,
    padding: 20,
    gap: 14,
    borderWidth: 2,
    borderColor: 'rgba(153, 153, 153, 0.4)',
    
  },
  // Green Card Insight
  insightCardGreen: {
    backgroundColor: 'rgb(208, 255, 170)',
    borderRadius: 20,
    padding: 20,
    gap: 14,
    borderWidth: 2,
    borderColor: 'rgb(180, 230, 50)',
  },
  insightGreenHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  insightBranding: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  insightBrandIcon: {
    fontSize: 18,
  },
  insightBrandName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  insightGreenTimestamp: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '500',
  },
  insightGreenHeadline: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 32,
  },
  insightGreenDesc: {
    fontSize: 14,
    color: '#4B5563',
    lineHeight: 20,
  },
  insightGreenMetrics: {
    flexDirection: 'row',
    gap: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 12,
    padding: 12,
  },
  insightGreenMetricCol: {
    flex: 1,
  },
  insightGreenMetricLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  insightGreenMetricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  insightGreenMetricPositive: {
    color: '#059669',
  },
  insightGreenMetricWarning: {
    color: '#D97706',
  },
  insightGreenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgb(147, 200, 34)',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  insightGreenBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  sourcesSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  sourcesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sourcesTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  sourceItem: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  sourceIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  favicon: {
    width: 18,
    height: 18,
    borderRadius: 4,
  },
  sourceTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  sourceSub: {
    fontSize: 12,
    color: '#4B5563',
  },
  sourceMeta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  insightGreenFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.1)',
  },
  insightGreenMetaLeft: {
    flexDirection: 'row',
    gap: 12,
  },
  insightGreenIconBtn: {
    padding: 6,
  },
  insightGreenSources: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  insightGreenAvatars: {
    flexDirection: 'row',
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(182, 182, 182, 0.86)',
  },
  insightGreenSourcesText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },

  quickStatusSubtext: {
    fontSize: 13,
    color: '#4B5563',
    marginBottom: 12,
    lineHeight: 18,
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
});

export default DashboardScreen;

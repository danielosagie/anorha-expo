import React, { useMemo, useState, useEffect, useContext, useCallback, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl, Dimensions, Image, Modal, Pressable, Platform, type DimensionValue } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import AppPagerView from '../components/AppPagerView';
import Animated, { FadeInUp } from 'react-native-reanimated';
import spinners from 'unicode-animations';
import { useTheme } from '../context/ThemeContext';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Card from '../components/Card';
import InsightCard from '../components/InsightCard';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LegendStateContext } from '../context/LegendStateContext';
import { API_BASE_URL } from '../config/env';
import { supabase } from '../../lib/supabase';
import InventoryListCard from '../components/InventoryListCard';
import ActivityEventCard from '../components/ActivityEventCard';
import SearchBarWithScanner from '../components/SearchBarWithScanner';
import ShadowSurface from '../components/ui/ShadowSurface';
import Button from '../components/Button';
import { useOrg } from '../context/OrgContext';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { useProductVariantRealtime } from '../hooks/useProductVariantRealtime';
import { useOrgNudges, trackInsightAction } from '../hooks/useOrgNudges';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { QuickSellCard } from '../components/liquidation/QuickSellCard';
import ShopifySvg from '../assets/shopify.svg';
import SquareSvg from '../assets/square.svg';
import CloverSvg from '../assets/clover.svg';
import { PartnerWelcomeModal } from '../components/PartnerWelcomeModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SessionContext } from '../context/SessionContext';


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

type UnicodeSpinnerDefinition = {
  frames: string[];
  interval: number;
};

const NUDGE_REFRESH_WINDOW_MS = 6 * 60 * 60 * 1000;
const DASHBOARD_TRACKER_SPINNER = (spinners.braillewave || spinners.breathe) as UnicodeSpinnerDefinition;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const formatCountdownClock = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

const formatCountdownShort = (ms: number) => {
  if (ms <= 0) return 'Ready now';

  const totalMinutes = Math.max(1, Math.ceil(ms / (1000 * 60)));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
};

const UnicodeSpinner: React.FC<{
  spinner: UnicodeSpinnerDefinition;
  color?: string;
  size?: number;
  style?: any;
}> = ({ spinner, color = '#9A7B54', size = 13, style }) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    const intervalId = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % spinner.frames.length);
    }, spinner.interval);

    return () => clearInterval(intervalId);
  }, [spinner]);

  return (
    <Text style={[styles.dashboardTrackerSpinnerText, { color, fontSize: size }, style]}>
      {spinner.frames[frameIndex]}
    </Text>
  );
};

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

const TAB_BAR_HEIGHT = 84;
const TAB_BAR_BOTTOM_OFFSET = 18;

const DashboardScreen = () => {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const legendCtx = useContext(LegendStateContext);
  const session = useContext(SessionContext);
  const { currentOrg, isLoading: isOrgLoading } = useOrg();
  const { connections } = usePlatformConnections();
  const insets = useSafeAreaInsets();
  const bottomSafePadding = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_OFFSET + insets.bottom + 16;
  // Subscribe to real-time product variant changes
  useProductVariantRealtime();

  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Tab state for Overview
  const [activeTab, setActiveTab] = useState<'low_stock' | 'recent_activity'>('low_stock');
  const [currentInsightPage, setCurrentInsightPage] = useState(0);

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

  // Fallback state for when Legend observables are empty
  const [directFetchVariants, setDirectFetchVariants] = useState<Record<string, any>>({});
  const [directFetchLevels, setDirectFetchLevels] = useState<Record<string, any>>({});

  const PRODUCT_VARIANT_SELECT = 'Id, ProductId, UserId, Sku, Barcode, Title, Description, Price, CompareAtPrice, Options, status, OnShopify, OnSquare, OnClover, OnAmazon, OnEbay, OnFacebook, VariantType, IsArchived, Tags, PrimaryImageUrl, CreatedAt, UpdatedAt';

  const fetchAllProductVariants = useCallback(async (userId: string) => {
    const pageSize = 200;
    const allRows: any[] = [];
    let from = 0;

    while (true) {
      const to = from + pageSize - 1;
      const { data, error } = await supabase
        .from('ProductVariants')
        .select(PRODUCT_VARIANT_SELECT)
        .eq('UserId', userId)
        .not('Sku', 'like', 'DRAFT-%')
        .range(from, to);

      if (error) throw error;

      const rows = data || [];
      allRows.push(...rows);

      if (rows.length < pageSize) break;
      from += pageSize;
    }

    return allRows;
  }, []);

  // Partner FTUX modal - shows for partners with forked products but no platforms
  const [showPartnerWelcome, setShowPartnerWelcome] = useState(false);
  const [partnerSourceName, setPartnerSourceName] = useState('');

  // Detect if user is a partner FTUX (has forked products, no platforms, modal not dismissed)
  useEffect(() => {
    const checkPartnerFTUX = async () => {
      // Check if connections exist - if so, no need for welcome modal
      const hasConnections = connections && connections.length > 0;
      if (hasConnections) return;

      // Check if dismissed
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) return;

      const dismissedKey = `partner_welcome_dismissed_dashboard_${userId}`;
      const dismissed = await AsyncStorage.getItem(dismissedKey);
      if (dismissed === 'true') return;

      // Check for forked products (have SourceVariantId)
      const { data: forkedProducts } = await supabase
        .from('ProductVariants')
        .select('Id, SourceVariantId, SourceOrgId')
        .eq('UserId', userId)
        .not('SourceVariantId', 'is', null)
        .limit(1);

      if (forkedProducts && forkedProducts.length > 0) {
        // Get source org name
        const sourceOrgId = forkedProducts[0].SourceOrgId;
        if (sourceOrgId) {
          const { data: sourceOrg } = await supabase
            .from('Organizations')
            .select('Name')
            .eq('Id', sourceOrgId)
            .single();
          setPartnerSourceName(sourceOrg?.Name || 'your partner');
        } else {
          setPartnerSourceName('your partner');
        }
        setShowPartnerWelcome(true);
      }
    };

    checkPartnerFTUX();
  }, [connections]);

  const handleDismissPartnerWelcome = useCallback(async () => {
    setShowPartnerWelcome(false);
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user?.id) {
      await AsyncStorage.setItem(`partner_welcome_dismissed_dashboard_${userData.user.id}`, 'true');
    }
  }, []);

  // Fetch data directly from Supabase (paginated, no cap) - used for low stock and when Legend is underfilled
  useEffect(() => {
    const fetchDirectData = async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData?.user?.id) return;

        const variants = await fetchAllProductVariants(userData.user.id);

        if (variants && variants.length > 0) {
          const variantMap: Record<string, any> = {};
          const variantIds: string[] = [];
          variants.forEach((v: any) => {
            variantMap[v.Id] = v;
            variantIds.push(v.Id);
          });
          setDirectFetchVariants(variantMap);
          console.log(`[Dashboard] Direct fetch: ${variants.length} variants`);

          const { data: levels, error: levelErr } = await supabase
            .from('InventoryLevels')
            .select('Id, ProductVariantId, PlatformConnectionId, PlatformLocationId, PoolId, OrgId, Quantity, Price, CompareAtPrice, Currency, UpdatedAt')
            .in('ProductVariantId', variantIds);

          if (!levelErr && levels) {
            const levelMap: Record<string, any> = {};
            levels.forEach((l: any) => { levelMap[l.Id] = l; });
            setDirectFetchLevels(levelMap);
            console.log(`[Dashboard] Direct fetch: ${levels.length} inventory levels`);
          }
        }
      } catch (e) {
        console.error('[Dashboard] Direct fetch error:', e);
      }
    };

    fetchDirectData();
  }, [fetchAllProductVariants]);

  // Refresh products on focus (e.g. after editing product or CSV import)
  const isFirstRender = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (isFirstRender.current) {
        isFirstRender.current = false;
        return;
      }

      const refreshOnFocus = async () => {
        try {
          const { data: userData } = await supabase.auth.getUser();
          if (!userData?.user?.id) return;

          const variants = await fetchAllProductVariants(userData.user.id);

          if (variants) {
            const variantMap: Record<string, any> = {};
            const variantIds: string[] = [];
            variants.forEach((v: any) => {
              variantMap[v.Id] = v;
              variantIds.push(v.Id);
            });
            setDirectFetchVariants(variantMap);

            if (variantIds.length > 0) {
              const { data: levels } = await supabase
                .from('InventoryLevels')
                .select('Id, ProductVariantId, PlatformConnectionId, PlatformLocationId, PoolId, OrgId, Quantity, Price, CompareAtPrice, Currency, UpdatedAt')
                .in('ProductVariantId', variantIds);

              if (levels && levels.length > 0) {
                const levelMap: Record<string, any> = {};
                levels.forEach((l: any) => { levelMap[l.Id] = l; });
                setDirectFetchLevels(levelMap);
              }
            }
            console.log(`[Dashboard] Focus refresh complete: ${variants.length} products`);
          }
        } catch (e) {
          console.error('[Dashboard] Focus refresh error:', e);
        }
      };

      refreshOnFocus();
    }, [fetchAllProductVariants])
  );

  // AI-generated insights
  // Defer nudges fetch until org is stable (avoid 403 from stale cached org vs server active org)
  const nudgesOrgId = !isOrgLoading ? currentOrg?.id : undefined;
  const { insight, loading: loadingInsight, error: insightError, cacheExpiresAt: insightCacheExpiresAt, refetch: refetchInsight, forceRefresh: forceRefreshInsight } = useOrgNudges(nudgesOrgId);
  const [dashboardNowMs, setDashboardNowMs] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => {
      setDashboardNowMs(Date.now());
    }, 1000);

    return () => clearInterval(intervalId);
  }, []);

  // Handle insight feedback (thumbs up/down) - log for now, can extend to API
  const handleInsightFeedback = useCallback((feedback: 'up' | 'down', insightHeadline: string) => {
    console.log(`[Dashboard] Insight feedback: ${feedback} for "${insightHeadline}"`);
    // TODO: Send to API to affect future insight generation
    // Example: POST /api/insights/feedback { orgId, feedback, insightHeadline }
  }, []);

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
    if (!session?.bridgeReady) {
      console.log('[Dashboard] Skipping pool performance fetch until auth bridge is ready');
      setLoadingPools(false);
      return;
    }

    try {
      setLoadingPools(true);
      const token = await ensureSupabaseJwt();
      if (!token) {
        console.warn('[Dashboard] No JWT available for pool performance fetch');
        setPoolPerformance([]);
        return;
      }

      // Fetch pools for this org
      const poolsRes = await fetch(`${API_BASE_URL}/api/pools/org/${currentOrg.id}`, {
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
    if (!session?.bridgeReady) {
      console.log('[Dashboard] Skipping location performance fetch until auth bridge is ready');
      computeLocationPerformanceFromLegend();
      return;
    }

    try {
      setLoadingLocations(true);
      const token = await ensureSupabaseJwt();
      if (!token) {
        console.warn('[Dashboard] No JWT available for location performance fetch');
        computeLocationPerformanceFromLegend();
        return;
      }

      // Fetch platform locations for this org
      const locationsRes = await fetch(`${API_BASE_URL}/api/pools/locations/available?orgId=${currentOrg.id}`, {
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
    // SECURITY: Guard against showing data when no org is active
    if (!currentOrg?.id) {
      return {
        totalInventory: 0,
        lowStockItems: [],
        lowStockCount: 0
      };
    }

    // Get data from Legend and direct fetch - pick whichever has MORE rows (fixes underfilled Legend)
    const legendPv = legendCtx?.productVariants$?.get?.() ?? {};
    const legendLevels = legendCtx?.inventoryLevels$?.get?.() ?? {};
    const images = legendCtx?.productImages$?.get?.() ?? {};

    const legendVariantCount = Object.keys(legendPv).length;
    const directVariantCount = Object.keys(directFetchVariants).length;
    const pv = legendVariantCount >= directVariantCount ? legendPv : directFetchVariants;

    const legendLevelCount = Object.keys(legendLevels).length;
    const directLevelCount = Object.keys(directFetchLevels).length;
    const levels = legendLevelCount >= directLevelCount ? legendLevels : directFetchLevels;

    // Guard against no data at all
    if (Object.keys(pv).length === 0 && Object.keys(levels).length === 0) {
      console.log('[Dashboard] No data available (Legend or fallback), skipping low stock computation');
      return {
        totalInventory: 0,
        lowStockItems: [],
        lowStockCount: 0
      };
    }

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

    // CRITICAL: Only show 'base' or 'flat' variants, aggregate inventory from option variants
    // Build product grouping map: ProductId -> { baseVariantId, totalQuantity }
    const productGroups: Record<string, { baseVariantId: string; totalQuantity: number; optionQuantities: number }> = {};

    Object.entries(pv).forEach(([vid, variant]: [string, any]) => {
      const productId = variant?.ProductId;
      if (!productId) return;

      const variantType = variant?.VariantType || 'flat';
      const qty = variantQuantities[vid] || 0;

      if (!productGroups[productId]) {
        productGroups[productId] = { baseVariantId: '', totalQuantity: 0, optionQuantities: 0 };
      }

      if (variantType === 'base' || variantType === 'flat') {
        productGroups[productId].baseVariantId = vid;
        productGroups[productId].totalQuantity += qty;
      } else if (variantType === 'option') {
        productGroups[productId].optionQuantities += qty;
      }
    });

    // Aggregate option quantities into base
    Object.values(productGroups).forEach(group => {
      group.totalQuantity += group.optionQuantities;
    });

    const items = Object.values(productGroups)
      .filter(group => group.baseVariantId && group.totalQuantity <= threshold)
      .map(group => {
        const vid = group.baseVariantId;
        const variant = pv[vid];
        const img = Object.values(images).find((i: any) => i.ProductVariantId === vid);

        const platforms = [];
        if (variant?.OnShopify) platforms.push('shopify');
        if (variant?.OnSquare) platforms.push('square');
        if (variant?.OnAmazon) platforms.push('amazon');

        return {
          id: vid,
          title: variant?.Title || 'Unknown Product',
          quantity: group.totalQuantity,
          sku: variant?.Sku,
          price: variant?.Price,
          imageUrl: img?.ImageUrl || variant?.PrimaryImageUrl,
          platformNames: platforms
        };
      })
      .sort((a, b) => a.quantity - b.quantity)
      .slice(0, 5); // Top 5

    return {
      totalInventory: total,
      lowStockItems: items,
      lowStockCount: Object.values(productGroups).filter(g => g.baseVariantId && g.totalQuantity <= threshold).length
    };
  }, [legendCtx?.productVariants$, legendCtx?.inventoryLevels$, legendCtx?.productImages$, currentOrg?.id, initialDataLoaded, directFetchVariants, directFetchLevels]);

  // 2. Fetch Recent Activity (filtered to user-relevant events only)
  const fetchActivity = async () => {
    if (!currentOrg?.id) {
      console.warn('[Dashboard] Skipping activity fetch: no current org');
      setLoadingActivity(false);
      setRecentActivity([]);
      return;
    }

    if (!session?.bridgeReady) {
      console.log('[Dashboard] Skipping activity fetch until auth bridge is ready');
      setLoadingActivity(false);
      setInitialDataLoaded(true);
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

      const base = API_BASE_URL;
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

    if (!session?.bridgeReady) {
      console.log('[Dashboard] Waiting for auth bridge to become ready...');
      setLoadingActivity(false);
      setInitialDataLoaded(true);
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
    // Ensure insights are fetched when org becomes available
    refetchInsight();
  }, [currentOrg?.id, isOrgLoading, refetchInsight, session?.bridgeReady]);

  // Check for connections ready to sync
  const readyConnection = useMemo(() => {
    return connections.find(c => c.Status === 'ready_to_sync');
  }, [connections]);

  const handleReviewMappings = () => {
    if (readyConnection) {
      // Find platform name from ID or use type? Assuming MappingReview needs platformName.
      // We can try to guess or just pass a generic name if needed, but MappingReview probably wants it for display.
      // Let's pass PlatformType as platformName or DisplayName.
      navigation.navigate('ImportOverview', {
        connectionId: readyConnection.Id,
        platformName: readyConnection.DisplayName || readyConnection.PlatformType
      });
    }
  };


  // Handle insight action clicks
  const handleInsightAction = async (actionLink: string, insightTitle?: string) => {
    if (!currentOrg?.id) return;

    // Track the action
    await trackInsightAction(currentOrg.id, actionLink, insightTitle || 'Insight Action');

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
      navigation.navigate('AccountSettings'); // Pools are managed in Profile
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
  const insightsDisabled = !currentOrg?.id || !session?.bridgeReady;
  const hasInsightContent = Boolean(safeInsight && (safeInsight.topDIN || safeInsight.insights));
  const dashboardRefreshDeadlineMs = insightCacheExpiresAt ? new Date(insightCacheExpiresAt).getTime() : Number.NaN;
  const hasDashboardRefreshTimeline = Boolean(insightCacheExpiresAt && Number.isFinite(dashboardRefreshDeadlineMs));
  const dashboardRefreshStartMs = hasDashboardRefreshTimeline ? dashboardRefreshDeadlineMs - NUDGE_REFRESH_WINDOW_MS : dashboardNowMs;
  const dashboardRefreshRemainingMs = hasDashboardRefreshTimeline ? Math.max(dashboardRefreshDeadlineMs - dashboardNowMs, 0) : 0;
  const dashboardRefreshProgress = hasDashboardRefreshTimeline
    ? clamp((dashboardNowMs - dashboardRefreshStartMs) / NUDGE_REFRESH_WINDOW_MS, 0, 1)
    : 0;
  const dashboardTrackerWidth: DimensionValue = dashboardRefreshRemainingMs <= 0
    ? '100%'
    : `${Math.max(dashboardRefreshProgress * 100, 5)}%`;
  const dashboardTrackerClock = dashboardRefreshRemainingMs <= 0 ? 'Open' : formatCountdownClock(dashboardRefreshRemainingMs);
  const dashboardTrackerPillLabel = hasDashboardRefreshTimeline ? dashboardTrackerClock : 'Open';
  const dashboardTrackerEta = dashboardRefreshRemainingMs <= 0 ? 'Ready now' : formatCountdownShort(dashboardRefreshRemainingMs);
  const dashboardTrackerMessage = dashboardRefreshRemainingMs <= 0
    ? 'The next analysis window is open.'
    : 'Watching live activity so the next nudge arrives with better timing.';
  const dashboardTrackerHeadline = !hasDashboardRefreshTimeline
    ? 'Sprout is watching for the next insight'
    : dashboardRefreshRemainingMs <= 0
      ? 'Window open'
      : 'Next nudge is lining up';
  const dashboardTrackerDescription = !hasDashboardRefreshTimeline
    ? currentOrg?.name
      ? `Sprout is watching ${currentOrg.name} in the background and will surface the next nudge automatically when enough signal builds up.`
      : 'Sprout is watching in the background and will surface the next nudge automatically when enough signal builds up.'
    : currentOrg?.name
      ? `Sprout is watching ${currentOrg.name} in the background and will surface the next nudge automatically when the window opens.`
      : 'Sprout is watching in the background and will surface the next nudge automatically when the window opens.';
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
        contentContainerStyle={[styles.scrollContentContainer, { paddingBottom: bottomSafePadding }]}
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

        {/* Today Card / Insight */}
        <View style={styles.todayCardContainer}>
          {loadingInsight ? (
            <InsightCard
              insight={safeInsight}
              loading={loadingInsight}
              error={null}
              onAction={handleInsightAction}
              onRefresh={forceRefreshInsight}
              onFeedback={handleInsightFeedback}
              cacheExpiresAt={insightCacheExpiresAt || undefined}
            />
          ) : hasInsightContent ? (
            (safeInsight?.insights?.length || 0) > 0 ? (
              <View>
                <AppPagerView style={{ width: '100%', height: 420 }} initialPage={0} onPageSelected={e => setCurrentInsightPage(e.nativeEvent.position)}>
                  {safeInsight!.insights!.map((ins: any, index: number) => (
                    <View key={index} style={{ paddingHorizontal: 4 }}>
                      <InsightCard
                        insight={ins}
                        loading={loadingInsight}
                        error={insightError}
                        onAction={handleInsightAction}
                        onRefresh={forceRefreshInsight}
                        onFeedback={handleInsightFeedback}
                        cacheExpiresAt={insightCacheExpiresAt || undefined}
                      />
                    </View>
                  ))}
                </AppPagerView>
                {/* Pagination Dots */}
                <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8, gap: 8 }}>
                  {safeInsight!.insights!.map((_: any, idx: number) => (
                    <View
                      key={idx}
                      style={{
                        width: 8, height: 8, borderRadius: 4,
                        backgroundColor: currentInsightPage === idx ? '#647653' : '#E5E7EB'
                      }}
                    />
                  ))}
                </View>
              </View>
            ) : (
              <InsightCard
                insight={safeInsight}
                loading={loadingInsight}
                error={insightError}
                onAction={handleInsightAction}
                onRefresh={forceRefreshInsight}
                onFeedback={handleInsightFeedback}
                cacheExpiresAt={insightCacheExpiresAt || undefined}
              />
            )
          ) : insightsDisabled ? (
            <ShadowSurface shadow="sm" radius={20} style={styles.todayCardShadow} innerStyle={styles.todayCard}>
              <ShadowSurface shadow="sm" radius={20} style={styles.insightCardGreenShadow} innerStyle={styles.insightCardGreenSurface}>
                <View style={styles.insightCardGreenContent}>
                  <View style={styles.insightEmptyHeader}>
                    <View style={styles.insightEmptyHeaderLeft}>
                      <Icon name="sprout-outline" size={20} color="rgba(72, 72, 72, 1)" />
                      <Text style={styles.insightEmptyHeaderTitle}>{"Sprout's Insight"}</Text>
                    </View>
                    <View style={styles.dashboardTrackerPill}>
                      <Icon name="clock-outline" size={14} color="#9A7B54" />
                      <Text style={styles.dashboardTrackerPillText}>{dashboardTrackerPillLabel}</Text>
                    </View>
                  </View>

                  <View style={styles.insightEmptyContentCard}>
                    <Text style={styles.insightEmptyHeadline}>Live insights are currently paused</Text>
                    <Text style={styles.insightEmptyDescription}>
                      Come back later when they have been re-enabled, contact support if unexpected.
                    </Text>
                    <Button
                      title="Refresh Insights"
                      onPress={refetchInsight}
                      icon="refresh"
                      style={styles.insightEmptyActionButton}
                      textStyle={styles.insightEmptyActionButtonText}
                    />
                  </View>
                </View>
              </ShadowSurface>
            </ShadowSurface>
          ) : insightError ? (
            <ShadowSurface shadow="sm" radius={20} style={styles.todayCardShadow} innerStyle={styles.todayCard}>
              <ShadowSurface shadow="sm" radius={20} style={styles.insightCardGreenShadow} innerStyle={styles.insightCardGreenSurface}>
                <View style={styles.insightCardGreenContent}>
                  <View style={styles.insightEmptyHeader}>
                    <View style={styles.insightEmptyHeaderLeft}>
                      <Icon name="sprout-outline" size={20} color="rgba(72, 72, 72, 1)" />
                      <Text style={styles.insightEmptyHeaderTitle}>{"Sprout's Insight"}</Text>
                    </View>
                    <Text style={styles.insightEmptyHeaderMeta}>Unable to load</Text>
                  </View>

                  <View style={styles.insightEmptyContentCard}>
                    <Text style={styles.insightEmptyHeadline}>Unable to load insights</Text>
                    <Text style={styles.insightEmptyDescription}>
                      Try again once your connection is stable.
                    </Text>
                    <Button
                      title="Retry"
                      onPress={forceRefreshInsight}
                      icon="refresh"
                      style={styles.insightEmptyActionButton}
                      textStyle={styles.insightEmptyActionButtonText}
                    />
                  </View>
                </View>
              </ShadowSurface>
            </ShadowSurface>
          ) : (
            <ShadowSurface shadow="sm" radius={20} style={styles.todayCardShadow} innerStyle={styles.todayCard}>
              <ShadowSurface shadow="sm" radius={20} style={styles.insightCardGreenShadow} innerStyle={styles.insightCardGreenSurface}>
                <View style={styles.insightCardGreenContent}>
                  <View style={styles.insightEmptyHeader}>
                    <View style={styles.insightEmptyHeaderLeft}>
                      <Icon name="sprout-outline" size={20} color="rgba(72, 72, 72, 1)" />
                      <Text style={styles.insightEmptyHeaderTitle}>{"Sprout's Insight"}</Text>
                    </View>

                    <View style={styles.dashboardTrackerPill}>
                      <Icon name="clock-outline" size={14} color="#9A7B54" />
                      <Text style={styles.dashboardTrackerPillText}>{dashboardTrackerPillLabel}</Text>
                    </View>
                  </View>

                  <View style={styles.insightEmptyContentCard}>
                    <View style={styles.dashboardTrackerBadge}>
                      <UnicodeSpinner spinner={DASHBOARD_TRACKER_SPINNER} />
                      <Text style={styles.dashboardTrackerBadgeText}>Tracking the next opening</Text>
                    </View>

                    <Text style={styles.dashboardTrackerHeadline}>{dashboardTrackerHeadline}</Text>

                    <Text style={styles.dashboardTrackerDescription}>{dashboardTrackerDescription}</Text>

                    <View style={styles.dashboardTrackerChipRow}>
                      <View style={styles.dashboardTrackerChip}>
                        <Text style={styles.dashboardTrackerChipText}>Inventory pulse</Text>
                      </View>
                      <View style={styles.dashboardTrackerChip}>
                        <Text style={styles.dashboardTrackerChipText}>Sales activity</Text>
                      </View>
                      <View style={styles.dashboardTrackerChip}>
                        <Text style={styles.dashboardTrackerChipText}>Price pressure</Text>
                      </View>
                    </View>

                    {hasDashboardRefreshTimeline ? (
                      <View style={styles.dashboardTrackerTimelineCard}>
                        <View style={styles.dashboardTrackerTimelineMetaRow}>
                          <View style={styles.dashboardTrackerTimelineStatusRow}>
                            <View style={styles.dashboardTrackerDotHalo}>
                              <View style={styles.dashboardTrackerDot} />
                            </View>
                            <Text style={styles.dashboardTrackerTimelineStatusText}>{dashboardTrackerMessage}</Text>
                          </View>
                          <Text style={styles.dashboardTrackerTimelineEtaText}>{dashboardTrackerEta}</Text>
                        </View>

                        <View style={styles.dashboardTrackerTimelineTrack}>
                          <View style={[styles.dashboardTrackerTimelineFill, { width: dashboardTrackerWidth }]}>
                            <View style={styles.dashboardTrackerTimelineCurrentDot} />
                          </View>
                        </View>

                        <View style={styles.dashboardTrackerTimelineLabelsRow}>
                          <Text style={styles.dashboardTrackerTimelineLabelText}>now</Text>
                          <Text style={styles.dashboardTrackerTimelineLabelText}>next pass</Text>
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.dashboardTrackerPassiveRow}>
                      <Icon name="tray-full" size={15} color="#8B6C49" />
                      <Text style={styles.dashboardTrackerPassiveText}>
                        No refresh needed. The next nudge is served here automatically.
                      </Text>
                    </View>
                  </View>
                </View>
              </ShadowSurface>
            </ShadowSurface>
          )}
        </View>


        {/* Quick Sell Card
        <QuickSellCard onRefreshed={refreshData} />
        */}

        {/* Overview */}
        <View style={styles.sectionContainer}>
          <ShadowSurface shadow="sm" radius={20} style={styles.todayCardShadow} innerStyle={[styles.todayCard, { padding: 8, paddingTop: 4 }]}>
            <View style={[styles.tabsContainer, { marginHorizontal: 4, marginTop: 8, marginBottom: 4, backgroundColor: "#fff", justifyContent: 'space-between' }]}>
              <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>Overview</Text>
            </View>

            <View style={[styles.tabsContainer, { marginHorizontal: 8, marginTop: 0 }]}>
              <ShadowSurface shadow={activeTab === 'low_stock' ? 'xs' : 'none'} radius={8} style={styles.tabShadow} innerStyle={styles.tabInner}>
                <TouchableOpacity
                  style={[styles.tab, activeTab === 'low_stock' && styles.activeTab]}
                  onPress={() => setActiveTab('low_stock')}
                >
                  <Icon name="package-variant" size={16} color={activeTab === 'low_stock' ? '#1F2937' : '#6B7280'} style={{ marginRight: 6 }} />
                  <Text style={[styles.tabText, activeTab === 'low_stock' && styles.activeTabText]}>Low Stock</Text>
                </TouchableOpacity>
              </ShadowSurface>
              <ShadowSurface shadow={activeTab === 'recent_activity' ? 'xs' : 'none'} radius={8} style={styles.tabShadow} innerStyle={styles.tabInner}>
                <TouchableOpacity
                  style={[styles.tab, activeTab === 'recent_activity' && styles.activeTab]}
                  onPress={() => setActiveTab('recent_activity')}
                >
                  <Icon name="clock-outline" size={16} color={activeTab === 'recent_activity' ? '#1F2937' : '#6B7280'} style={{ marginRight: 6 }} />
                  <Text style={[styles.tabText, activeTab === 'recent_activity' && styles.activeTabText]}>Recent Activity</Text>
                </TouchableOpacity>
              </ShadowSurface>
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
                    <Icon name="check-circle-outline" size={32} color="rgb(147, 200, 34)" />
                    <Text style={[styles.emptyText, { color: '#374151', marginTop: 8 }]}>Inventory levels are healthy.</Text>
                    <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>No low stock items detected.</Text>
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
          </ShadowSurface>
        </View>

      </ScrollView >

      {/* Sources Bottom Sheet */}
      < Modal
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
      </Modal >

      {/* Notification Banner for Ready Mappings */}
      {
        readyConnection && (
          <Animated.View
            entering={FadeInUp.delay(500).springify()}
            style={styles.notificationBanner}
          >
            <View style={styles.bannerContent}>
              <View style={styles.bannerIcon}>
                <Icon name="check-circle" size={24} color="#93C822" />
              </View>
              <View style={styles.bannerTextContainer}>
                <Text style={styles.bannerTitle}>Mappings Ready</Text>
                <Text style={styles.bannerSubtitle}>
                  {readyConnection.DisplayName} is ready for review.
                </Text>
              </View>
              <TouchableOpacity
                style={styles.bannerButton}
                onPress={handleReviewMappings}
              >
                <Text style={styles.bannerButtonText}>Review</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )
      }

      {/* Partner FTUX Welcome Modal */}
      <PartnerWelcomeModal
        visible={showPartnerWelcome}
        partnerName={partnerSourceName}
        onDismiss={handleDismissPartnerWelcome}
        onConnectPlatform={() => navigation.navigate('AccountSettings')}
      />

      {/* Floating Tab Bar provided by Navigator, but we ensure spacing */}
    </View >
  );
};

const styles = StyleSheet.create({
  fullScreenContainer: {
    flex: 1,
    backgroundColor: 'rgba(254, 244, 221, 1)',
  },
  greenHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'rgba(254, 244, 221, 1)',
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 24,
    marginTop: 60,
    borderTopRightRadius: 32,
    borderTopLeftRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 1)',
  },
  scrollContentContainer: {
    flexGrow: 1,
    minHeight: '100%',
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
  todayCardShadow: {
    marginBottom: 0,
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
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)', // slightly darker lime-200 for better edge definition
  },

  insideContainer: {
    backgroundColor: 'rgb(255, 255, 255)',
    borderRadius: 20,
    padding: 20,
    gap: 14,
    borderWidth: 2,
    borderColor: 'rgba(153, 153, 153, 0.4)',

  },
  // Green Card Insight - Updated to match new theme
  insightCardGreenShadow: {
    marginTop: 0,
  },
  insightCardGreenSurface: {
    backgroundColor: '#FEF4DD',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  insightCardGreenContent: {
    padding: 16,
    gap: 12,
  },
  insightEmptyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  insightEmptyHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  insightEmptyHeaderTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: 'rgba(72, 72, 72, 1)',
    letterSpacing: -0.3,
  },
  insightEmptyHeaderMeta: {
    fontSize: 12,
    color: 'rgba(72, 72, 72, 1)',
    fontWeight: '500',
  },
  insightEmptyContentCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  insightEmptyHeadline: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 8,
    lineHeight: 24,
    letterSpacing: -0.3,
  },
  insightEmptyDescription: {
    fontSize: 15,
    color: '#4B5563',
    lineHeight: 22,
    marginBottom: 20,
  },
  insightEmptyMetrics: {
    flexDirection: 'row',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  insightEmptyMetricColumn: {
    flex: 1,
  },
  insightEmptyMetricDivider: {
    width: 1,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 16,
  },
  insightEmptyMetricLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 6,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  insightEmptyMetricValue: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    letterSpacing: -0.3,
  },
  insightEmptyMetricSub: {
    fontSize: 12,
    color: '#9CA3AF',
    marginTop: 4,
  },
  insightEmptyMetricPositive: {
    color: '#059669',
  },
  insightEmptyMetricWarning: {
    color: '#D97706',
  },
  insightEmptyRecommendation: {
    backgroundColor: '#FEF4DD',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FEF08A',
  },
  insightEmptyRecommendationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 6,
  },
  insightEmptyRecommendationTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#854D0E',
    textTransform: 'uppercase',
  },
  insightEmptyRecommendationText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 20,
  },
  insightEmptyActionButton: {
    width: '100%',
    backgroundColor: '#8B5E3C',
    borderRadius: 14,
    paddingVertical: 14,
  },
  insightEmptyActionButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  dashboardTrackerSpinnerText: {
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  dashboardTrackerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(173, 138, 96, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(154, 123, 84, 0.12)',
  },
  dashboardTrackerPillText: {
    fontSize: 12,
    color: '#8B6C49',
    fontWeight: '700',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },
  dashboardTrackerBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F6EFE5',
    marginBottom: 14,
  },
  dashboardTrackerBadgeText: {
    fontSize: 12,
    color: '#8B6C49',
    fontWeight: '700',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  dashboardTrackerHeadline: {
    fontSize: 24,
    lineHeight: 29,
    fontWeight: '700',
    color: '#2F241A',
    letterSpacing: -0.7,
    marginBottom: 10,
  },
  dashboardTrackerDescription: {
    fontSize: 15,
    lineHeight: 22,
    color: '#6A5B49',
    marginBottom: 18,
  },
  dashboardTrackerChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 18,
  },
  dashboardTrackerChip: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#F7F4EE',
    borderWidth: 1,
    borderColor: '#EFE6D8',
  },
  dashboardTrackerChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7B684E',
  },
  dashboardTrackerTimelineCard: {
    backgroundColor: '#FAF6EF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#EFE4D4',
  },
  dashboardTrackerTimelineMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  dashboardTrackerTimelineStatusRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  dashboardTrackerDotHalo: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(175, 132, 74, 0.16)',
    marginTop: 1,
  },
  dashboardTrackerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#A37740',
  },
  dashboardTrackerTimelineStatusText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#6E5A42',
    fontWeight: '600',
  },
  dashboardTrackerTimelineEtaText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8B6C49',
    fontVariant: ['tabular-nums'],
  },
  dashboardTrackerTimelineTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#EBDDCA',
    overflow: 'hidden',
    marginBottom: 10,
  },
  dashboardTrackerTimelineFill: {
    height: '100%',
    minWidth: 10,
    backgroundColor: '#C9A06C',
    borderRadius: 999,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: 1,
  },
  dashboardTrackerTimelineCurrentDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#6F4D2A',
    borderWidth: 2,
    borderColor: '#FFF7EC',
  },
  dashboardTrackerTimelineLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dashboardTrackerTimelineLabelText: {
    fontSize: 12,
    color: '#9A866B',
    fontWeight: '500',
  },
  dashboardTrackerPassiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 2,
  },
  dashboardTrackerPassiveText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#8B6C49',
    fontWeight: '600',
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
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 24,
    letterSpacing: -0.3,
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
    fontWeight: '600',
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
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
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
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 8 },
      android: { elevation: 5 },
    }),
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
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 1 },
      android: { elevation: 1 },
    }),
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
  tabShadow: {
    flex: 1,
  },
  tabInner: {
    borderRadius: 8,
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
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
    lineHeight: 16,
    includeFontPadding: false,
    textAlignVertical: 'center',
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

  // Notification Banner
  notificationBanner: {
    position: 'absolute',
    bottom: 20, // Adjust based on tab bar height if needed, usually 80-90
    left: 16,
    right: 16,
    backgroundColor: '#1F2937',
    borderRadius: 16,
    padding: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8 },
      android: { elevation: 8 },
    }),
    zIndex: 100,
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(147, 200, 34, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTextContainer: {
    flex: 1,
  },
  bannerTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  bannerSubtitle: {
    color: '#D1D5DB', // gray-300
    fontSize: 13,
  },
  bannerButton: {
    backgroundColor: '#93C822',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  bannerButtonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});

export default DashboardScreen;

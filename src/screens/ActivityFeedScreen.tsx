import React, { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { listPlatforms } from '../config/platforms';
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
  Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme } from '../context/ThemeContext';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { observer } from '@legendapp/state/react';
import { useLegendState } from '../context/LegendStateContext';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/apiClient';
import { useOrg } from '../context/OrgContext';
import PlatformFilterChips from '../components/PlatformFilterChips';
import InventoryListCard from '../components/InventoryListCard';
import ActivityEventCard from '../components/ActivityEventCard';
import PoolLocationCombobox from '../components/PoolLocationCombobox';
import SortByDropdown from '../components/SortByDropdown';
import CampaignCard from '../components/CampaignCard';
import { PlatformConnection, PlatformLocation } from '../utils/SupaLegend';
import { useProductVariantRealtime } from '../hooks/useProductVariantRealtime';
import { useUser } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SessionContext } from '../context/SessionContext';
import { createLogger } from '../utils/logger';
const log = createLogger('ActivityFeedScreen');


const TAB_BAR_HEIGHT = 84;
const TAB_BAR_BOTTOM_OFFSET = 18;

// User-relevant event types - ONLY show orders, inventory updates, and product updates/publishes
// Filtered per user request: inventory updates, product updates/publish, and orders
const USER_RELEVANT_EVENT_TYPES = [
  'INVENTORY_ADJUSTMENT',
  'INVENTORY_UPDATED',
  'INVENTORY_SET',
  'PRODUCT_PUBLISH_COMPLETED',
  'PRODUCT_PUBLISH_STARTED',
  'PRODUCT_PUBLISHED',
  'PRODUCT_UPDATED',
  'UPDATE_CANONICAL_DRAFT',
  'PRODUCT_CREATED',
  'ORDER_CREATED',
  'ORDER_UPDATED',
  'ORDER_FULFILLED',
];

// System event types to explicitly exclude
const SYSTEM_EVENT_TYPES = [
  'WEBHOOK',
  'SYNC_',
  'USER_VIEWED',
  'DASHBOARD',
  'ACCESS_REQUEST',
  'SCAN_',
  'RECONCILE',
];

type ActivityFeedScreenNavigationProp = StackNavigationProp<AppStackParamList, 'ActivityFeed'>;

interface ActivityEvent {
  id: string;
  timestamp: string;
  userId?: string | null;
  orgId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
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

interface ActivityListItem {
  type: 'header' | 'event';
  dateLabel?: string; // for headers
  event?: ActivityEvent; // for event items
  key: string;
}

// Event types that support undo (must have reversible details in backend)
const REVERSIBLE_EVENT_TYPES = ['INVENTORY_ADJUSTMENT', 'INVENTORY_SET', 'INVENTORY_UPDATED'];

// Helper to check if an event is user-relevant (ONLY orders, inventory, product updates/publishes)
const isUserRelevantEvent = (eventType: string): boolean => {
  const et = (eventType || '').toUpperCase();

  const isInventory = et.includes('INVENTORY_ADJUSTMENT') || et.includes('INVENTORY_UPDATED') || et.includes('INVENTORY_SET');
  const isProductPublish = et.includes('PRODUCT_PUBLISH') || et.includes('PRODUCT_PUBLISHED');
  const isProductUpdate = et.includes('PRODUCT_UPDATED') || et.includes('UPDATE_CANONICAL_DRAFT') || et.includes('PRODUCT_CREATED');
  const isOrder = et.includes('ORDER_CREATED') || et.includes('ORDER_UPDATED') || et.includes('ORDER_FULFILLED');

  return isInventory || isProductPublish || isProductUpdate || isOrder;
};

// Helper to get relative date label
const getDateLabel = (isoTimestamp: string): string => {
  try {
    const eventDate = new Date(isoTimestamp);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const eventDateStr = eventDate.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const todayStr = today.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
    const yesterdayStr = yesterday.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });

    if (eventDateStr === todayStr) return 'Today';
    if (eventDateStr === yesterdayStr) return 'Yesterday';
    return eventDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
};

// Helper to group events by date
const getEventsByDate = (events: ActivityEvent[]): Map<string, ActivityEvent[]> => {
  const grouped = new Map<string, ActivityEvent[]>();

  events.forEach(event => {
    const dateLabel = getDateLabel(event.timestamp);
    if (!grouped.has(dateLabel)) {
      grouped.set(dateLabel, []);
    }
    grouped.get(dateLabel)?.push(event);
  });

  return grouped;
};

// Helper to create activity list with date headers
const createActivityListWithHeaders = (events: ActivityEvent[]): ActivityListItem[] => {
  const grouped = getEventsByDate(events);
  const listItems: ActivityListItem[] = [];

  grouped.forEach((groupEvents, dateLabel) => {
    // Add date header
    listItems.push({
      type: 'header',
      dateLabel,
      key: `header-${dateLabel}`,
    });

    // Add events for this date
    groupEvents.forEach(event => {
      listItems.push({
        type: 'event',
        event,
        key: `event-${event.id}`,
      });
    });
  });

  return listItems;
};

const HIGHLIGHT_ORANGE = '#FF9900';

const ActivityFeedScreen = observer(() => {
  const theme = useTheme();
  const navigation = useNavigation<ActivityFeedScreenNavigationProp>();
  const legendState = useLegendState();
  const { currentOrg, isLoading: isOrgLoading } = useOrg();
  const session = useContext(SessionContext);
  const { user: clerkUser } = useUser();
  const insets = useSafeAreaInsets();
  const bottomSafePadding = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_OFFSET + insets.bottom + 16;

  // Subscribe to real-time product variant changes
  useProductVariantRealtime();

  // Get current user's profile image for "You" attribution
  const currentUserImageUrl = clerkUser?.imageUrl;

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
  const [activeDateField, setActiveDateField] = useState<'start' | 'end' | null>(null);

  // Platform data state
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [platformLocations, setPlatformLocations] = useState<PlatformLocation[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);

  // User profile images cache - maps userId to Clerk image URL
  const [userImageMap, setUserImageMap] = useState<Record<string, string>>({});

  // Legend observables for live product data (titles, SKUs, images)
  const productVariantsMap = useMemo(
    () => legendState?.productVariants$?.get?.() || {},
    [legendState?.productVariants$],
  );

  // Fetch org members and build user image map
  const fetchOrgMembersWithImages = useCallback(async () => {
    if (!currentOrg?.id) return;
    if (!session?.bridgeReady) {
      return;
    }

    try {
      // Fetch org members from backend (should include Clerk data)
      const membersRes = await apiFetch(`/api/organizations/${currentOrg.id}/members`);

      if (membersRes.ok) {
        const members = await membersRes.json();
        const newUserImageMap: Record<string, string> = {};

        // Build map of userId -> image URL
        (Array.isArray(members) ? members : members.members || []).forEach((member: any) => {
          if (member.UserId && member.ClerkImageUrl) {
            newUserImageMap[member.UserId] = member.ClerkImageUrl;
          } else if (member.Id && member.ImageUrl) {
            newUserImageMap[member.Id] = member.ImageUrl;
          }
        });

        // Add current user
        if (clerkUser?.id && clerkUser?.imageUrl) {
          newUserImageMap[clerkUser.id] = clerkUser.imageUrl;
        }

        setUserImageMap(newUserImageMap);
      }
    } catch (e) {
      log.warn('[ActivityFeed] Failed to fetch org members:', e);
      // Fallback: at least have current user
      if (clerkUser?.id && clerkUser?.imageUrl) {
        setUserImageMap({ [clerkUser.id]: clerkUser.imageUrl });
      }
    }
  }, [currentOrg?.id, clerkUser?.id, clerkUser?.imageUrl, session?.bridgeReady]);

  // Fetch activity feed from backend
  const fetchActivityFeed = useCallback(async (cursor?: string, append = false) => {
    // Wait for org context to be available (like ProfileScreen does)
    if (!currentOrg?.id) {
      setLoading(false);
      return;
    }

    if (!legendState?.userId) {
      setLoading(false);
      return;
    }

    if (!session?.bridgeReady) {
      setLoading(false);
      return;
    }

    try {
      // Build query string with cursor and orgId if provided
      let queryString = `limit=50`;
      if (cursor) {
        queryString += `&cursor=${encodeURIComponent(cursor)}`;
      }
      // Pass orgId explicitly to ensure backend has it (fallback if JWT doesn't have it)
      if (currentOrg?.id) {
        queryString += `&orgId=${encodeURIComponent(currentOrg.id)}`;
      }

      const response = await apiFetch(`/api/activity?${queryString}`);

      if (!response.ok) {
        log.error(`[ActivityFeed] HTTP ${response.status} ${response.statusText}`);
        const errorText = await response.text();
        log.error(`[ActivityFeed] Error body:`, errorText);
        setEvents([]);
        setLoading(false);
        return;
      }

      const data = await response.json();

      if (!data.events || data.events.length === 0) {
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
      // Filter out obvious system events (webhooks, dashboard views) - prefer user-relevant events
      const allTransformedEvents: ActivityEvent[] = data.events.map((event: any) => ({
        id: event.Id,
        timestamp: event.Timestamp,
        userId: event.UserId ?? null,
        orgId: event.OrgId ?? null,
        entityType: event.EntityType ?? null,
        entityId: event.EntityId ?? null,
        eventType: event.EventType,
        message: event.Message,
        details: event.Details || {},
        productVariantId: event.ProductVariantId,
        platformConnectionId: event.PlatformConnectionId,
        platformType: event.PlatformType,
        status: event.Status,
      }));

      // Filter to show user-relevant events, but fall back to all if none found
      const userRelevantEvents = allTransformedEvents.filter(event =>
        isUserRelevantEvent(event.eventType)
      );

      // Use user-relevant events if available, otherwise show all (excluding pure webhook noise)
      const transformedEvents = userRelevantEvents.length > 0
        ? userRelevantEvents
        : allTransformedEvents.filter(event => {
          const et = (event.eventType || '').toUpperCase();
          // At minimum, exclude webhook processing noise
          return !et.includes('WEBHOOK') && !et.includes('USER_VIEWED');
        });

      if (append) {
        setEvents(prev => [...prev, ...transformedEvents]);
      } else {
        setEvents(transformedEvents);
      }

      // Update pagination state
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch (error) {
      log.error('[ActivityFeed] Error fetching activity feed:', error);
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [legendState?.userId, currentOrg?.id, session?.bridgeReady, startDate, endDate]);

  // Fetch platform connections and locations
  useEffect(() => {
    const fetchPlatformData = async () => {
      if (!legendState?.userId) return;
      if (!session?.bridgeReady) {
        log.debug('[ActivityFeedScreen] Skipping platform data fetch until auth bridge is ready');
        setIsLoadingConnections(false);
        return;
      }

      setIsLoadingConnections(true);
      try {
        const { data: connectionsData, error: connectionsError } = await supabase
          .from('PlatformConnections')
          .select('Id, UserId, OrgId, PlatformType, DisplayName, Status, IsEnabled, LastSyncAttemptAt, LastSyncSuccessAt, CreatedAt, UpdatedAt')
          .eq('UserId', legendState.userId);

        if (connectionsError) {
          log.error('[ActivityFeedScreen] Error fetching platform connections:', connectionsError);
        } else {
          setPlatformConnections((connectionsData || []) as unknown as PlatformConnection[]);
        }

        if (connectionsData && connectionsData.length > 0) {
          const connectionIds = connectionsData.map(conn => conn.Id);
          const { data: locationsData, error: locationsError } = await supabase
            .from('PlatformLocations')
            .select('Id, PlatformConnectionId, PlatformLocationId, Name, IsActive, IsPrimary')
            .in('PlatformConnectionId', connectionIds);

          if (locationsError) {
            log.error('[ActivityFeedScreen] Error fetching platform locations:', locationsError);
          } else {
            setPlatformLocations((locationsData || []) as unknown as PlatformLocation[]);
          }
        }
      } catch (error) {
        log.error('[ActivityFeedScreen] Exception fetching platform data:', error);
      } finally {
        setIsLoadingConnections(false);
      }
    };

    fetchPlatformData();
  }, [legendState?.userId, session?.bridgeReady]);

  // Initial load
  useEffect(() => {
    const loadInitial = async () => {
      setLoading(true);
      await Promise.all([
        fetchActivityFeed(),
        fetchOrgMembersWithImages(),
      ]);
      setLoading(false);
    };
    loadInitial();
  }, [fetchActivityFeed, fetchOrgMembersWithImages]);

  // TODO: Add realtime subscription when backend is ready
  // For now, we'll rely on pull-to-refresh for updates

  // Campaigns Fetching
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const fetchCampaigns = useCallback(async () => {
    if (!currentOrg?.id) return;
    if (!session?.bridgeReady) {
      log.debug('[ActivityFeed] Skipping campaigns fetch until auth bridge is ready');
      return;
    }
    try {
      const response = await apiFetch('/api/liquidation/campaigns');
      if (response.ok) {
        const data = await response.json();
        if (data.success) setCampaigns(data.campaigns || []);
      }
    } catch (e) {
      log.debug('Error fetching campaigns', e);
    }
  }, [currentOrg?.id, session?.bridgeReady]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleUndo = useCallback(async (activityId: string) => {
    const orgId = currentOrg?.id;
    if (!orgId) return;
    try {
      const res = await apiFetch(
        `/api/organizations/${encodeURIComponent(orgId)}/activity/${encodeURIComponent(activityId)}/undo`,
        { method: 'POST' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Undo failed');
      await fetchActivityFeed();
    } catch (e) {
      Alert.alert('Undo failed', (e as Error).message);
    }
  }, [currentOrg?.id, fetchActivityFeed]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([fetchActivityFeed(), fetchCampaigns()]);
    setRefreshing(false);
  }, [fetchActivityFeed, fetchCampaigns]);

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

  const platformTypeByConnectionId = useMemo(() => {
    const map: Record<string, string> = {};
    platformConnections.forEach((conn: PlatformConnection) => {
      if (conn.Id && conn.PlatformType) {
        map[conn.Id] = conn.PlatformType.toLowerCase();
      }
    });
    return map;
  }, [platformConnections]);



  const getOwnerLabel = useCallback(
    (event: ActivityEvent): string | null => {
      const source = (event.details?.source || '').toString().toLowerCase();
      const explicitPlatform = (event.platformType || event.details?.platformType || event.details?.platform || '').toString();

      // User-originated events
      if (source === 'user' || (!source && event.userId)) {
        if (legendState?.userId && event.userId === legendState.userId) {
          return 'You';
        }
        return 'Teammate';
      }

      // Platform or automated events
      if (explicitPlatform) {
        const normalized =
          explicitPlatform.charAt(0).toUpperCase() + explicitPlatform.slice(1).toLowerCase();
        if (source) {
          return `${normalized} · ${source}`;
        }
        return normalized;
      }

      return null;
    },
    [legendState?.userId],
  );

  const getDateRangeLabel = useMemo(() => {
    if (!startDate && !endDate) return 'Any time';
    if (startDate && !endDate) return `From ${startDate.toLocaleDateString()}`;
    if (!startDate && endDate) return `Until ${endDate.toLocaleDateString()}`;
    if (startDate && endDate) {
      return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
    }
    return 'Any time';
  }, [startDate, endDate]);

  // Apply search, platform, location, date filters and sort
  const filteredEvents = useMemo(() => {
    let filtered = [...events];

    // Search filter
    if (searchQuery.trim().length > 0) {
      const query = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(event => {
        const messageMatch = event.message?.toLowerCase().includes(query);
        const eventTypeMatch = event.eventType?.toLowerCase().includes(query);

        const details = event.details || {};
        const detailFields = [
          details.title,
          details.sku,
          details.reason,
          details.locationName,
          details.platformName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        const variant =
          event.productVariantId && productVariantsMap[event.productVariantId]
            ? productVariantsMap[event.productVariantId]
            : undefined;
        const variantMatch = variant
          ? `${variant.Title || ''} ${variant.Sku || ''}`.toLowerCase().includes(query)
          : false;

        return messageMatch || eventTypeMatch || detailFields.includes(query) || variantMatch;
      });
    }

    // Platform filter
    if (selectedPlatformType) {
      const target = selectedPlatformType.toLowerCase();
      filtered = filtered.filter(event => {
        const explicit = event.platformType?.toLowerCase();
        const detailPlatform =
          (event.details?.platformType || event.details?.platform || '').toString().toLowerCase();
        const fromConnection = event.platformConnectionId
          ? platformTypeByConnectionId[event.platformConnectionId]?.toLowerCase()
          : undefined;

        return [explicit, detailPlatform, fromConnection].some(
          value => value && value === target,
        );
      });
    }

    // Location filter
    if (selectedLocationIds.length > 0) {
      filtered = filtered.filter(event => {
        const details = event.details || {};
        const locationId =
          details.locationId || details.PlatformLocationId || details.location_id || null;
        if (!locationId) return false;
        return selectedLocationIds.includes(String(locationId));
      });
    }

    // Date range filter (inclusive)
    if (startDate || endDate) {
      const startMs =
        startDate != null
          ? new Date(startDate.toDateString()).getTime()
          : null;
      const endMs =
        endDate != null
          ? new Date(endDate.toDateString()).getTime() + 24 * 60 * 60 * 1000 - 1
          : null;

      filtered = filtered.filter(event => {
        const ts = new Date(event.timestamp).getTime();
        if (Number.isNaN(ts)) return false;
        if (startMs != null && ts < startMs) return false;
        if (endMs != null && ts > endMs) return false;
        return true;
      });
    }

    // Sort
    switch (sortBy) {
      case 'name':
        filtered.sort((a, b) => {
          const aTitle =
            (a.productVariantId && productVariantsMap[a.productVariantId]?.Title) ||
            a.variantTitle ||
            '';
          const bTitle =
            (b.productVariantId && productVariantsMap[b.productVariantId]?.Title) ||
            b.variantTitle ||
            '';
          return aTitle.localeCompare(bTitle);
        });
        break;
      default:
        // Keep existing order (most recent first)
        break;
    }

    return filtered;
  }, [
    events,
    sortBy,
    searchQuery,
    selectedPlatformType,
    selectedLocationIds,
    startDate,
    endDate,
    platformTypeByConnectionId,
    productVariantsMap,
  ]);

  const platformsForChips = listPlatforms({ connectableOnly: true }).map((d) => d.key)
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

  const renderEvent = ({ item }: { item: ActivityEvent }) => {
    const variant =
      item.productVariantId && productVariantsMap[item.productVariantId]
        ? productVariantsMap[item.productVariantId]
        : undefined;

    const quantityDelta =
      typeof item.details?.quantityDelta === 'number'
        ? item.details.quantityDelta
        : typeof item.details?.quantity_delta === 'number'
          ? item.details.quantity_delta
          : undefined;

    const reason =
      typeof item.details?.reason === 'string'
        ? item.details.reason
        : typeof item.details?.adjustment_reason === 'string'
          ? item.details.adjustment_reason
          : undefined;

    // Build reason text (e.g., "Reason: -5 Units (Damaged)")
    const reasonParts: string[] = [];
    if (typeof quantityDelta === 'number' && quantityDelta !== 0) {
      const sign = quantityDelta > 0 ? '+' : '';
      reasonParts.push(`${sign}${quantityDelta} Units`);
    }
    if (reason) {
      reasonParts.push(`(${reason})`);
    }
    const reasonText = reasonParts.length > 0 ? `Reason: ${reasonParts.join(' ')}` : null;

    const ownerLabel = getOwnerLabel(item);

    // Get the profile image URL from our user image map (works for any org member)
    const ownerImageUrl = item.userId
      ? userImageMap[item.userId]
      : item.details?.userImageUrl || item.details?.actorImageUrl || undefined;

    // Format display title based on event type
    const displayTitle = (() => {
      const et = (item.eventType || '').toUpperCase();
      if (et.includes('INVENTORY_ADJUSTMENT')) return 'Inventory Adjustment';
      if (et.includes('INVENTORY')) return 'Inventory Update';
      if (et.includes('PRODUCT_PUBLISH_COMPLETED')) return 'Product Published';
      if (et.includes('PRODUCT_PUBLISH')) return 'Publishing Product';
      if (et.includes('UPDATE_CANONICAL_DRAFT')) return 'Product Updated';
      if (et.includes('PRODUCT_UPDATED')) return 'Product Updated';
      if (et.includes('PRODUCT_CREATED')) return 'Product Created';
      if (et.includes('ORDER_CREATED')) {
        const orderNumber = item.details?.orderNumber || item.details?.order_id || item.details?.name || item.details?.Order;
        return orderNumber ? `Order #${orderNumber}` : 'Order Created';
      }
      if (et.includes('ORDER')) {
        const orderNumber = item.details?.orderNumber || item.details?.order_id || item.details?.name || item.details?.Order;
        return orderNumber ? `Order #${orderNumber}` : 'Order';
      }
      return 'Activity';
    })();

    // Get product image from variant (ImageUrls array) or details
    const productImageUrl = (variant?.ImageUrls && variant.ImageUrls.length > 0 ? variant.ImageUrls[0] : variant?.PrimaryImageUrl ?? null)
      || item.details?.imageUrl
      || item.details?.image_url
      || item.primaryImageUrl
      || undefined;

    // Get price from variant or order details
    const price = variant?.Price
      || item.details?.price
      || item.details?.total_price
      || item.details?.subtotal_price
      || undefined;

    return (
      <Animated.View entering={FadeInUp.delay(100).duration(300)}>
        <ActivityEventCard
          id={item.id}
          title={variant?.Title || item.details?.title || item.variantTitle || item.message || 'Activity'}
          displayTitle={displayTitle}
          sku={variant?.Sku || item.details?.sku || item.details?.SKU || undefined}
          imageUrl={productImageUrl}
          timestamp={item.timestamp}
          reasonText={reasonText ?? undefined}
          price={typeof price === 'number' ? price : undefined}
          ownerLabel={ownerLabel ?? undefined}
          ownerImageUrl={ownerImageUrl}
          eventType={item.eventType}
          onPress={() => {
            if (item.productVariantId) {
              navigation.navigate('ProductDetail', { productId: item.productVariantId });
            }
          }}
          canUndo={REVERSIBLE_EVENT_TYPES.includes((item.eventType || '').toUpperCase())}
          onUndo={() => handleUndo(String(item.id))}
          undone={Boolean(item.details?.undone)}
        />
      </Animated.View>
    );
  };

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

  // Check if we have a critical auth issue (no orgId)
  const hasAuthError = !legendState?.userId;
  if (hasAuthError) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Icon name="alert-circle-outline" size={48} color="#ef4444" />
        <Text style={[styles.loadingText, { color: '#ef4444', marginTop: 16 }]}>
          Organization context missing
        </Text>
        <Text style={[styles.emptySubtext, { color: theme.colors.textSecondary, marginTop: 8 }]}>
          Unable to load activity feed. Please try logging in again.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.background]}>
      <View style={[styles.container, { marginTop: 60, paddingTop: 20 }]}>

        {/* Campaigns Section */}
        {campaigns.length > 0 && (
          <View style={{ marginBottom: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginBottom: 12, alignItems: 'center' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>Active Liquidation</Text>
              <TouchableOpacity onPress={() => navigation.navigate('CampaignsList' as any)}>
                <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>See All</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={campaigns}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              keyExtractor={item => item.Id}
              renderItem={({ item }) => (
                <CampaignCard
                  id={item.Id}
                  name={item.DisplayName || item.Goal?.targetRevenue + ' Target'}
                  itemsSold={item.ItemsSold || 0}
                  totalItems={item.TotalItems || 0}
                  revenue={item.RevenueGenerated || 0}
                  daysRemaining={item.Goal?.timeframeDays - (item.Progress?.daysElapsed || 0) || 0}
                  status={item.Status}
                  onPress={() => navigation.navigate('CampaignDetail' as any, { campaignId: item.Id })}
                />
              )}
            />
          </View>
        )}

        {/* Global Search & Filter Header (Sticky) */}
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
              activeColor={HIGHLIGHT_ORANGE}
            />
          </View>

          {/* Pool/Location Combobox and Date Range Filter */}
          <View style={styles.filterRow}>
            <View style={{ flex: 1 }}>
              <PoolLocationCombobox
                platformConnections={platformConnections}
                selectedItems={selectedLocationIds}
                onSelectionChange={setSelectedLocationIds}
              />
            </View>
            <View style={{ marginLeft: 8, marginRight: 0 }}>
              <TouchableOpacity
                style={[styles.dateFilterButton, { backgroundColor: HIGHLIGHT_ORANGE }]}
                onPress={() => {
                  setShowDatePicker(true);
                  setActiveDateField(null);
                }}
              >
                <Icon name="calendar" size={18} color="white" />
                <Text style={styles.dateFilterButtonText}>{getDateRangeLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <FlatList
            data={createActivityListWithHeaders(filteredEvents)}
            renderItem={({ item }: { item: ActivityListItem }) =>
              item.type === 'header' ? (
                <View style={styles.dateHeader}>
                  <Text style={[styles.dateHeaderText, { color: theme.colors.textSecondary }]}>
                    {item.dateLabel}
                  </Text>
                </View>
              ) : (
                renderEvent({ item: item.event! })
              )
            }
            keyExtractor={(item) => item.key}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            contentContainerStyle={[styles.listContent, { paddingBottom: bottomSafePadding }]}
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
                  onPress={() => setActiveDateField('start')}
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
                  onPress={() => setActiveDateField('end')}
                >
                  <Icon name="calendar" size={18} color={theme.colors.primary} />
                  <Text style={[styles.dateInputText, { color: endDate ? theme.colors.text : '#999' }]}>
                    {endDate ? endDate.toLocaleDateString() : 'Select end date'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {activeDateField && (
              <View style={{ width: '100%', marginTop: 8 }}>
                <DateTimePicker
                  value={
                    (activeDateField === 'start' ? startDate : endDate) || new Date()
                  }
                  mode="date"
                  textColor="#000"
                  accentColor="#D9D9D9"
                  themeVariant="light"
                  display={Platform.OS === 'ios' ? 'inline' : 'default'}
                  onChange={(_event, selectedDate) => {
                    if (!selectedDate) {
                      if (Platform.OS === 'android') {
                        setActiveDateField(null);
                      }
                      return;
                    }
                    if (activeDateField === 'start') {
                      setStartDate(selectedDate);
                    } else {
                      setEndDate(selectedDate);
                    }
                    if (Platform.OS === 'android') {
                      setActiveDateField(null);
                    }
                  }}
                />
              </View>
            )}

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
    backgroundColor: "#FFE9AC",
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
  listContent: {},
  dateHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
    marginBottom: 8,
  },
  dateHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  variantMeta: {
    fontSize: 12,
    marginBottom: 4,
  },
  ownerBadge: {
    backgroundColor: '#FFE4D0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginLeft: 6,
  },
  ownerText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#9A3412',
  },
  reasonPill: {
    marginTop: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#F3F4F6',
  },
  reasonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#374151',
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
    paddingVertical: 12,
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

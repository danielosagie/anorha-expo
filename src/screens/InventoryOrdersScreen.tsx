import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { API_BASE_URL } from '../config/env';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ScrollView,
  Modal,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  TextInput,
  View as KeyboardAvoidingView, // ALIASING KAV TO VIEW temporarily if needed, but no, I'll just import View
  Platform,
  Keyboard,
  PanResponder,
  PanResponderInstance,
  LayoutChangeEvent,
  Animated as RNAnimated,
  Easing
} from 'react-native';
import Animated, { FadeInUp, FadeInDown, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import { ListFilter } from 'lucide-react-native';
import { ChevronsUpDownIcon } from 'lucide-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Button from '../components/Button';
import { observer } from '@legendapp/state/react';
import { useLegendState } from '../context/LegendStateContext';
import { ProductVariant as ProductVariantData, ProductImage, InventoryLevel, PlatformProductMapping, LegendStateObservables, MarketplaceListing, PlatformLocation, PlatformConnection } from '../utils/SupaLegend';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { AppStackParamList } from '../navigation/AppNavigator';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase, ensureSupabaseJwt } from '../../lib/supabase';
import SearchBarWithScanner from '../components/SearchBarWithScanner';
import { AppMenu } from '../components/ui/AppMenu';
import OrdersTab from './inventory/OrdersTab';
import PlatformFilterChips from '../components/PlatformFilterChips';
import InventoryListCard from '../components/InventoryListCard';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import BaseModal from '../components/BaseModal';
import { SmartCommandInput } from '../components/SmartCommandInput';
import { VoiceRecorder } from '../components/VoiceRecorder';
import SortByDropdown, { DEFAULT_SORT_OPTIONS } from '../components/SortByDropdown';
import InventoryFilterSheet from '../components/inventory/InventoryFilterSheet';
import { CameraView } from 'expo-camera';
import { useProductVariantRealtime, useInventoryLevelsRealtime } from '../hooks/useProductVariantRealtime';
import { useOrg } from '../context/OrgContext';
import { parseFilterQuery } from '../utils/parseFilterQuery';
import { logFlowEvent, FlowEvents, startTrace, getTraceHeaders } from '../lib/mobileFlowLogger';
import { getVariantPlatforms } from '../lib/platforms';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createLogger } from '../utils/logger';
const log = createLogger('InventoryOrdersScreen');


const TAB_BAR_HEIGHT = 84;
const TAB_BAR_BOTTOM_OFFSET = 18;
const SCANNER_GROW_HEIGHT = 240;
const SCANNER_CLOSE_DURATION = 220;

type InventoryOrdersScreenNavigationProp = StackNavigationProp<AppStackParamList, 'TabNavigator'>;

type MatchLocation = 'title' | 'description' | 'sku' | 'barcode' | 'tags';

type EnrichedProductVariant = ProductVariantData & {
  imageUrl?: string;
  totalQuantity?: number;
  platformNames?: string[];
  minPrice?: number;  // Lowest price across all option variants
  maxPrice?: number;  // Highest price across all option variants
  OnShopify?: boolean;
  OnSquare?: boolean;
  OnClover?: boolean;
  OnAmazon?: boolean;
  OnEbay?: boolean;
  OnFacebook?: boolean;
  VariantType?: 'flat' | 'base' | 'option' | null;
  IsArchived?: boolean;
  optionVariantCount?: number; // Count of option variants for this product
  CreatedAt?: string; // For date-based sorting
  lastSyncedAt?: string | null;
  isStale?: boolean;
  matchLocations?: MatchLocation[]; // Where the search query matched
  matchSnippet?: string; // Snippet of text where match occurred
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
  const { currentOrg } = useOrg();
  const insets = useSafeAreaInsets();
  const bottomSafePadding = TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_OFFSET + insets.bottom + 16;

  // Subscribe to real-time product variant and inventory changes
  // These hooks return updateCounter values that we'll use to trigger useMemo re-computation
  const { updateCounter: variantUpdateCounter } = useProductVariantRealtime();
  const { updateCounter: inventoryUpdateCounter } = useInventoryLevelsRealtime();

  // Filter & Search State
  const [activeTab, setActiveTab] = useState('inventory');
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedPlatformType, setSelectedPlatformType] = useState<string | null>(null);
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [presetVariantIds, setPresetVariantIds] = useState<string[] | null>(null);
  const [loadingSlowMovers, setLoadingSlowMovers] = useState(false);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [barcodeSearchError, setBarcodeSearchError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMounted, setScannerMounted] = useState(false);
  const scannerHeight = useRef(new RNAnimated.Value(0)).current;
  // Unified filter sheet (Order / Location / Status) — location lives fully in-sheet now.
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const STATUS_OPTIONS = useMemo(() => ([
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },   // live / published on any platform
    { value: 'draft', label: 'Drafts' },    // not published anywhere yet (Anorha or platform drafts)
  ]), []);
  const scannerResultHandlerRef = useRef<((code: string) => void) | null>(null);
  const openScanner = useCallback((handler: (code: string) => void, source: string) => {
    logFlowEvent(FlowEvents.BARCODE_SCANNER_OPENED, { source });
    scannerHeight.stopAnimation();
    scannerHeight.setValue(0);
    setScannerMounted(true);
    setScannerOpen(true);
    scannerResultHandlerRef.current = handler;
    RNAnimated.spring(scannerHeight, {
      toValue: SCANNER_GROW_HEIGHT,
      speed: 18,
      bounciness: 6,
      useNativeDriver: false,
    }).start();
  }, [scannerHeight]);
  const closeScanner = useCallback(() => {
    logFlowEvent(FlowEvents.BARCODE_SCANNER_CLOSED, {});
    scannerResultHandlerRef.current = null;
    setScannerOpen(false);
    scannerHeight.stopAnimation();
    RNAnimated.timing(scannerHeight, {
      toValue: 0,
      duration: SCANNER_CLOSE_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        setScannerMounted(false);
      }
    });
  }, [scannerHeight]);

  // Handle route params
  useEffect(() => {
    const p = route.params;
    if (p) {
      log.debug('[InventoryOrdersScreen] applying params:', p);
      if (typeof p.initialSearch === 'string') setSearchQuery(p.initialSearch);
      if (p.initialSortBy) setSortBy(p.initialSortBy);
      if (p.initialLocationIds) setSelectedLocationIds(p.initialLocationIds);
      if (p.lowStockOnly !== undefined) setLowStockOnly(p.lowStockOnly);
      if (p.initialVariantIds != null) {
        const ids = Array.isArray(p.initialVariantIds) ? p.initialVariantIds : String(p.initialVariantIds).split(',').filter(Boolean);
        setPresetVariantIds(ids.length > 0 ? ids : null);
      }

      if (p.openScannerOnMount) {
        setTimeout(() => {
          openScanner((code: string) => {
            handleBarcodeScan(code);
            closeScanner();
          }, 'deep_link');
        }, 100);
      }

      if (p.openLocationPicker) {
        setFilterSheetOpen(true); // location now lives inside the unified filter sheet
      }

      if ((p as any).selectForCampaign?.campaignId) {
        setAddToCampaign((p as any).selectForCampaign);
        setIsSelectionMode(true);
      }
    }
  }, [route.params, closeScanner, openScanner]);

  // Loading & Data State
  const [platformConnections, setPlatformConnections] = useState<PlatformConnection[]>([]);
  const [platformLocations, setPlatformLocations] = useState<PlatformLocation[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(true);
  const [displayCount, setDisplayCount] = useState(50);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const ITEMS_PER_LOAD = 20;

  // Bulk Selection State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [addToCampaign, setAddToCampaign] = useState<{ campaignId: string; title: string } | null>(null);
  const [addingToCampaign, setAddingToCampaign] = useState(false);
  const campaignAdapter = useMemo(() => new HybridConversationDataAdapter(), []);

  const handleAddToClearout = useCallback(async () => {
    if (!addToCampaign || selectedItems.size === 0 || addingToCampaign) return;
    setAddingToCampaign(true);
    try {
      await campaignAdapter.addCampaignItems(addToCampaign.campaignId, Array.from(selectedItems));
      const camp = addToCampaign;
      setSelectedItems(new Set());
      setIsSelectionMode(false);
      setAddToCampaign(null);
      (navigation as any).navigate('LiquidationCampaignScreen', { campaignId: camp.campaignId, entryPoint: 'detail' });
    } catch (e: any) {
      Alert.alert('Could not add items', e?.message || 'Please try again.');
    } finally {
      setAddingToCampaign(false);
    }
  }, [addToCampaign, selectedItems, addingToCampaign, campaignAdapter, navigation]);

  // Bulk action modal: filter by type/voice, review, then apply Delete/Archive/Liquidate
  const [bulkActionModalVisible, setBulkActionModalVisible] = useState(false);
  const [bulkActionModalQuery, setBulkActionModalQuery] = useState('');
  const [bulkActionModalMatchIds, setBulkActionModalMatchIds] = useState<string[] | null>(null);
  const [speechModalVisible, setSpeechModalVisible] = useState(false);

  // Bulk action review flow state
  type PlannedAction = {
    itemId: string;
    title: string;
    thumbnail?: string;
    actionType: string;
    description: string;
    changes: { field: string; from: string; to: string }[];
    approved: boolean;
  };
  const [bulkPhase, setBulkPhase] = useState<'command' | 'planning' | 'review'>('command');
  const [plannedActions, setPlannedActions] = useState<PlannedAction[]>([]);
  const [planSummary, setPlanSummary] = useState('');
  const [planLoading, setPlanLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);

  // Bulk Selection Handlers
  // Bulk Selection Handlers
  const handleLongPressItem = (id: string) => {
    // Standardize: Long press ALWAYS enters drag mode for that item
    setIsSelectionMode(true);

    // Select the item if not selected (or ensure it's the start of drag)
    const newSet = new Set(selectedItems);
    newSet.add(id);
    setSelectedItems(newSet);

    // Start Drag Session
    isDraggingSelection.current = true;
    lastSelectedId.current = id;
    setScrollEnabled(false);
  };

  const handleToggleSelection = useCallback((id: string, forceState?: boolean) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      const isSelected = next.has(id);

      if (forceState !== undefined) {
        if (forceState) next.add(id);
        else next.delete(id);
      } else {
        if (isSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const handleExitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedItems(new Set());
    setBulkActionModalVisible(false);
  };

  // Preset: fetch slow movers variant IDs from nudges API (reuses insights data)
  const fetchSlowMoversVariantIds = useCallback(async () => {
    const orgId = currentOrg?.id;
    if (!orgId) {
      Alert.alert('No organization', 'Select an organization to load slow movers.');
      return;
    }
    setLoadingSlowMovers(true);
    try {
      const token = await ensureSupabaseJwt();
      if (!token) {
        Alert.alert('Error', 'Not authenticated.');
        return;
      }
      const response = await fetch(`${API_BASE_URL}/api/insights/orgs/${encodeURIComponent(orgId)}/nudges`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Nudges failed: ${response.status}`);
      }
      const data = await response.json();
      const insight = data?.insight ?? data;
      const link = insight?.bottomDIN?.action?.link ?? '';
      const affected = insight?.bottomDIN?.affectedProducts ?? [];
      let ids: string[] = [];
      const match = link.match(/variantIds=([^&]+)/);
      if (match) {
        ids = match[1].split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      if (ids.length === 0 && affected.length > 0) {
        ids = affected.map((p: { id: string }) => p.id).filter(Boolean);
      }
      setPresetVariantIds(ids.length > 0 ? ids : null);
      if (ids.length === 0) {
        Alert.alert('No slow movers', 'No slow-moving products data right now. Try again later.');
      }
    } catch (err) {
      log.error('[InventoryOrdersScreen] fetchSlowMovers failed', err);
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed to load slow movers.');
    } finally {
      setLoadingSlowMovers(false);
    }
  }, [currentOrg?.id]);

  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [archiveModalVisible, setArchiveModalVisible] = useState(false);
  const [liquidationModalVisible, setLiquidationModalVisible] = useState(false);
  const [tagsModalVisible, setTagsModalVisible] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [liquidationTimeline, setLiquidationTimeline] = useState("");
  const [liquidationAmount, setLiquidationAmount] = useState("");
  const [liquidationStrategy, setLiquidationStrategy] = useState<'aggressive' | 'moderate' | 'conservative'>('moderate');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // Drag-to-select refs
  const itemLayouts = useRef<{ [key: string]: { y: number; height: number } }>({});
  const listRef = useRef<FlatList>(null);
  const isDraggingSelection = useRef(false);
  const lastSelectedId = useRef<string | null>(null);

  // Auto-scroll refs
  const listHeight = useRef(0);
  const autoScrollActive = useRef(false);
  const autoScrollSpeed = useRef(0);
  const currentTouchY = useRef(0);

  const performSelectionAt = (touchY: number, offset: number) => {
    const absoluteY = touchY + offset;
    for (const [id, layout] of Object.entries(itemLayouts.current)) {
      if (absoluteY >= layout.y && absoluteY <= layout.y + layout.height) {
        if (lastSelectedId.current !== id) {
          handleToggleSelection(id, true);
          lastSelectedId.current = id;
        }
        break;
      }
    }
  };

  const runAutoScroll = () => {
    if (!autoScrollActive.current) return;

    const speed = autoScrollSpeed.current;
    if (speed === 0) {
      requestAnimationFrame(runAutoScroll);
      return;
    }

    const newOffset = Math.max(0, scrollOffset.current + speed);
    listRef.current?.scrollToOffset({ offset: newOffset, animated: false });

    // We manually update scrollOffset here because the onScroll event might be slightly delayed
    // and we need precise calculation for selection.
    // However, onScroll will eventually fire and correct it. 
    // For smoother selection during scroll, we optimistically use newOffset.
    performSelectionAt(currentTouchY.current, newOffset);

    requestAnimationFrame(runAutoScroll);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (evt, gestureState) => {
        // Only capture if we are explicitly in a drag session (triggered by long press)
        // AND there is movement.
        return isDraggingSelection.current && Math.abs(gestureState.dy) > 2;
      },
      onPanResponderGrant: () => {
        // Already handled in long press, but ensure state
        autoScrollActive.current = false;
      },
      onPanResponderMove: (evt, gestureState) => {
        if (!isDraggingSelection.current) return;

        const y = evt.nativeEvent.locationY;
        currentTouchY.current = y;

        // Auto-scroll logic
        const threshold = 100;
        const maxSpeed = 20;
        let speed = 0;

        if (y < threshold) {
          // Top edge - scroll up
          // closer to 0 (top) -> faster
          const ratio = (threshold - y) / threshold;
          speed = -maxSpeed * ratio;
        } else if (listHeight.current > 0 && y > listHeight.current - threshold) {
          // Bottom edge - scroll down
          const ratio = (y - (listHeight.current - threshold)) / threshold;
          speed = maxSpeed * ratio;
        }

        autoScrollSpeed.current = speed;

        if (speed !== 0) {
          if (!autoScrollActive.current) {
            autoScrollActive.current = true;
            runAutoScroll();
          }
        } else {
          autoScrollActive.current = false;
        }

        // Standard selection
        performSelectionAt(y, scrollOffset.current);
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => {
        isDraggingSelection.current = false;
        lastSelectedId.current = null;
        autoScrollActive.current = false;
        setScrollEnabled(true);
      },
      onPanResponderTerminate: () => {
        isDraggingSelection.current = false;
        lastSelectedId.current = null;
        autoScrollActive.current = false;
        setScrollEnabled(true);
      },
    })
  ).current;

  // Track scroll offset
  const scrollOffset = useRef(0);
  const handleScroll = (event: any) => {
    scrollOffset.current = event.nativeEvent.contentOffset.y;
  };




  useEffect(() => {
    const keyboardShowListener = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const keyboardHideListener = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      keyboardShowListener.remove();
      keyboardHideListener.remove();
    };
  }, []);

  const handleSelectAll = () => {
    // Select all currently filtered items
    const allIds = filteredInventory.map(item => item.Id);
    setSelectedItems(new Set(allIds));
  };

  const runBulkDeleteByIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const { error } = await supabase
        .from('ProductVariants')
        .update({ IsArchived: true })
        .in('Id', ids);
      if (error) throw error;
      setBulkActionModalVisible(false);
      handleExitSelectionMode();
    } catch (err) {
      log.error('Bulk delete failed', err);
      Alert.alert('Error', 'Failed to delete items. Please try again.');
    }
  }, []);

  const handleBulkDelete = () => {
    const idsToDelete = Array.from(selectedItems);
    Alert.alert(
      'Delete Items',
      `Are you sure you want to delete ${idsToDelete.length} items? This will archive them from your inventory.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => runBulkDeleteByIds(idsToDelete) },
      ]
    );
  };

  const runBulkArchiveByIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    try {
      const { error } = await supabase
        .from('ProductVariants')
        .update({ IsArchived: true })
        .in('Id', ids);
      if (error) throw error;
      setBulkActionModalVisible(false);
      handleExitSelectionMode();
    } catch (err) {
      log.error('Bulk archive failed', err);
      Alert.alert('Error', 'Failed to archive items. Please try again.');
    }
  }, []);



  const legendObservables: LegendStateObservables | null = useLegendState();

  // Fetch platform connections and locations
  useEffect(() => {
    const fetchPlatformData = async () => {
      if (!legendState?.userId) return;

      setIsLoadingConnections(true);
      try {
        const { data: connectionsData, error: connectionsError } = await supabase
          .from('PlatformConnections')
          .select('Id, UserId, OrgId, PlatformType, DisplayName, Status, IsEnabled, LastSyncAttemptAt, LastSyncSuccessAt, CreatedAt, UpdatedAt')
          .eq('UserId', legendState.userId);

        if (connectionsError) {
          log.error('[InventoryScreen] Error fetching platform connections:', connectionsError);
        } else {
          const normalizedConnections: PlatformConnection[] = (connectionsData || []).map((conn: any) => ({
            ...conn,
            Credentials: conn?.Credentials ?? null,
          }));
          setPlatformConnections(normalizedConnections);
        }

        if (connectionsData && connectionsData.length > 0) {
          const connectionIds = connectionsData.map(conn => conn.Id);
          const { data: locationsData, error: locationsError } = await supabase
            .from('PlatformLocations')
            .select('Id, PlatformConnectionId, PlatformLocationId, Name, IsActive, IsPrimary')
            .in('PlatformConnectionId', connectionIds);

          if (locationsError) {
            log.error('[InventoryScreen] Error fetching platform locations:', locationsError);
          } else {
            const normalizedLocations: PlatformLocation[] = (locationsData || []).map((location: any) => ({
              Id: location.Id,
              PlatformConnectionId: location.PlatformConnectionId,
              PlatformGeneratedLocationId: location.PlatformGeneratedLocationId ?? location.PlatformLocationId ?? location.Id,
              Name: location.Name ?? 'Location',
              IsPOS: Boolean(location.IsPOS),
              id: location.Id,
            }));
            setPlatformLocations(normalizedLocations);
          }
        }
      } catch (error) {
        log.error('[InventoryScreen] Exception fetching platform data:', error);
      } finally {
        setIsLoadingConnections(false);
      }
    };

    fetchPlatformData();
  }, [legendState?.userId]);

  // Fallback state for when Legend observable is empty
  const [directFetchVariants, setDirectFetchVariants] = useState<Record<string, ProductVariantData>>({});
  const [directFetchLevels, setDirectFetchLevels] = useState<Record<string, InventoryLevel>>({});
  const [sharedLinkQuantities, setSharedLinkQuantities] = useState<Record<string, { quantity: number; poolId?: string }>>({});
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

  useEffect(() => {
    const directFetchProducts = async () => {
      if (supabase && legendState?.userId) {
        try {
          // Fetch ProductVariants
          const data = await fetchAllProductVariants(legendState.userId);

          if (!data) {
            log.error('[InventoryScreen - Direct Fetch] Error fetching products: empty response');
          } else {
            log.debug('[InventoryScreen - Direct Fetch] Successfully fetched products:', data?.length);
            // Store in fallback state, keyed by Id
            if (data && data.length > 0) {
              const variantMap: Record<string, ProductVariantData> = {};
              const variantIds: string[] = [];
              data.forEach((v: any) => {
                variantMap[v.Id] = v;
                variantIds.push(v.Id);
              });
              setDirectFetchVariants(variantMap);

              // Fetch CrossOrgProductLinks for shared inventory quantities
              if (variantIds.length > 0) {
                const { data: linksData, error: linksError } = await supabase
                  .from('CrossOrgProductLinks')
                  .select('TargetVariantId, AvailableQuantity, TargetPoolId, Status')
                  .in('TargetVariantId', variantIds)
                  .eq('Status', 'active');

                if (linksError) {
                  log.warn('[InventoryScreen - Direct Fetch] Error fetching shared links:', linksError);
                } else {
                  const linkMap: Record<string, { quantity: number; poolId?: string }> = {};
                  (linksData || []).forEach((link: any) => {
                    if (link.TargetVariantId) {
                      linkMap[link.TargetVariantId] = {
                        quantity: link.AvailableQuantity || 0,
                        poolId: link.TargetPoolId || undefined,
                      };
                    }
                  });
                  setSharedLinkQuantities(linkMap);
                }
              }

              // Also fetch InventoryLevels for these variants
              if (variantIds.length > 0) {
                const { data: levelsData, error: levelsError } = await supabase
                  .from('InventoryLevels')
                  .select('Id, ProductVariantId, PlatformConnectionId, PlatformLocationId, PoolId, OrgId, Quantity, Price, CompareAtPrice, Currency, UpdatedAt')
                  .in('ProductVariantId', variantIds);

                if (levelsError) {
                  log.error('[InventoryScreen - Direct Fetch] Error fetching inventory levels:', levelsError);
                } else {
                  log.debug('[InventoryScreen - Direct Fetch] Successfully fetched inventory levels:', levelsData?.length);
                  if (levelsData && levelsData.length > 0) {
                    const levelsMap: Record<string, InventoryLevel> = {};
                    levelsData.forEach((l: any) => {
                      levelsMap[l.Id] = l;
                    });
                    setDirectFetchLevels(levelsMap);
                  }
                }
              }
            }
          }
        } catch (e) {
          log.error('[InventoryScreen - Direct Fetch] Exception during direct fetch:', e);
        }
      }
    };

    if (legendState?.userId) {
      directFetchProducts();
    }
  }, [fetchAllProductVariants, legendState]);

  // Track if this is the first render to avoid double-fetching on initial mount
  const isFirstRender = useRef(true);

  // CRITICAL: Refresh data when screen comes into focus (e.g., after editing product or CSV import)
  // This ensures updated products show fresh data without requiring a full app restart
  // UPDATED: Always refetch on focus since count-only check misses product UPDATES
  useFocusEffect(
    useCallback(() => {
      // Skip the first render since directFetchProducts already runs on mount
      if (isFirstRender.current) {
        isFirstRender.current = false;
        return;
      }

      const refreshOnFocus = async () => {
        if (!legendState?.userId) return;

        log.debug('[InventoryOrdersScreen] Screen focused - refreshing products...');

        try {
          // Always refetch products to get latest data (covers both new AND updated products)
          const data = await fetchAllProductVariants(legendState.userId);

          if (data) {
            const variantMap: Record<string, ProductVariantData> = {};
            const variantIds: string[] = [];
            data.forEach((v: any) => {
              variantMap[v.Id] = v;
              variantIds.push(v.Id);
            });
            setDirectFetchVariants(variantMap);

            // Refresh CrossOrgProductLinks for shared inventory quantities
            if (variantIds.length > 0) {
              const { data: linksData, error: linksError } = await supabase
                .from('CrossOrgProductLinks')
                .select('TargetVariantId, AvailableQuantity, TargetPoolId, Status')
                .in('TargetVariantId', variantIds)
                .eq('Status', 'active');

              if (linksError) {
                log.warn('[InventoryOrdersScreen] Error refreshing shared links:', linksError);
              } else {
                const linkMap: Record<string, { quantity: number; poolId?: string }> = {};
                (linksData || []).forEach((link: any) => {
                  if (link.TargetVariantId) {
                    linkMap[link.TargetVariantId] = {
                      quantity: link.AvailableQuantity || 0,
                      poolId: link.TargetPoolId || undefined,
                    };
                  }
                });
                setSharedLinkQuantities(linkMap);
              }
            }

            // Also refresh inventory levels
            if (variantIds.length > 0) {
              const { data: levelsData } = await supabase
                .from('InventoryLevels')
                .select('Id, ProductVariantId, PlatformConnectionId, PlatformLocationId, PoolId, OrgId, Quantity, Price, CompareAtPrice, Currency, UpdatedAt')
                .in('ProductVariantId', variantIds);

              if (levelsData && levelsData.length > 0) {
                const levelsMap: Record<string, InventoryLevel> = {};
                levelsData.forEach((l: any) => {
                  levelsMap[l.Id] = l;
                });
                setDirectFetchLevels(levelsMap);
              }
            }
            log.debug('[InventoryOrdersScreen] Refresh complete, now showing', data.length, 'products');
          }
        } catch (e) {
          log.error('[InventoryOrdersScreen] Error during focus refresh:', e);
        }
      };

      refreshOnFocus();
    }, [fetchAllProductVariants, legendState?.userId])
  );


  // CRITICAL FIX: Use useSelector to properly track observable changes for real-time reactivity
  // Direct .get() calls outside useMemo don't trigger re-renders when data changes
  // useSelector creates a subscription that re-renders the component when the observable changes
  const legendProductVariants = legendObservables?.productVariants$?.get() || {};
  const activePlatformMappings = (legendObservables?.platformProductMappings$?.get() || {}) as Record<string, PlatformProductMapping>;
  const legendInventoryLevels = (legendObservables?.inventoryLevels$?.get() || {}) as Record<string, InventoryLevel>;
  const activeProductImages = (legendObservables?.productImages$?.get() || {}) as Record<string, ProductImage>;
  const activeMarketplaceListings = (legendObservables?.marketplaceListings$?.get() || {}) as Record<string, MarketplaceListing>;

  // Use Legend data if available, otherwise fall back to direct fetch
  const legendVariantCount = Object.keys(legendProductVariants).length;
  const directVariantCount = Object.keys(directFetchVariants).length;
  const activeProductVariants = legendVariantCount >= directVariantCount
    ? legendProductVariants
    : directFetchVariants;

  // Use Legend InventoryLevels if available, otherwise fall back to direct fetch
  const legendLevelCount = Object.keys(legendInventoryLevels).length;
  const directLevelCount = Object.keys(directFetchLevels).length;
  const activeInventoryLevels = legendLevelCount >= directLevelCount
    ? legendInventoryLevels
    : directFetchLevels;

  // Debug: Log when observables update (helps diagnose real-time issues)
  useEffect(() => {
    log.debug('[InventoryOrdersScreen] Observable state updated:', {
      variantCount: Object.keys(activeProductVariants).length,
      legendCount: Object.keys(legendProductVariants).length,
      fallbackCount: Object.keys(directFetchVariants).length,
      levelCount: Object.keys(activeInventoryLevels).length,
      legendLevelCount: Object.keys(legendInventoryLevels).length,
      fallbackLevelCount: Object.keys(directFetchLevels).length,
      imageCount: Object.keys(activeProductImages).length,
      mappingCount: Object.keys(activePlatformMappings).length,
      sharedLinkCount: Object.keys(sharedLinkQuantities).length,
    });
  }, [activeProductVariants, legendProductVariants, directFetchVariants, activeInventoryLevels, legendInventoryLevels, directFetchLevels, activeProductImages, activePlatformMappings, sharedLinkQuantities]);

  const enrichedProductVariants = useMemo((): EnrichedProductVariant[] => {
    const variants = activeProductVariants;
    const images = activeProductImages;
    const baseLevels = activeInventoryLevels;
    const mappings = activePlatformMappings;
    // CRITICAL: Don't require platformConnections - partners may have products shared with them
    // without having connected any platforms yet
    if (Object.keys(variants).length === 0) return [];

    // Merge shared link quantities into inventory levels when pool levels are missing/zero
    const levels: Record<string, InventoryLevel> = { ...baseLevels };
    const poolQtyByVariant = new Map<string, number>();
    Object.values(baseLevels).forEach((level: InventoryLevel) => {
      if (!level.PlatformConnectionId && (level as any).PoolId) {
        const current = poolQtyByVariant.get(level.ProductVariantId) || 0;
        poolQtyByVariant.set(level.ProductVariantId, current + (level.Quantity || 0));
      }
    });
    Object.entries(sharedLinkQuantities).forEach(([variantId, info]) => {
      const existingPoolQty = poolQtyByVariant.get(variantId) || 0;
      if (info.quantity > 0 && existingPoolQty <= 0) {
        const syntheticId = `shared-${variantId}-${info.poolId || 'pool'}`;
        levels[syntheticId] = {
          Id: syntheticId,
          ProductVariantId: variantId,
          Quantity: info.quantity,
          PoolId: info.poolId,
          PlatformConnectionId: null,
          PlatformLocationId: info.poolId || 'shared',
          UpdatedAt: new Date().toISOString(),
        } as unknown as InventoryLevel;
      }
    });

    // CRITICAL FIX: Group variants by ProductId to properly handle base/option architecture
    // Build a map of ProductId -> option variants for inventory aggregation
    const optionVariantsByProduct = new Map<string, Array<{ id: string; variant: any }>>();
    const allVariantIds = Object.keys(variants);

    // Build connection -> platformType lookup to filter inventory by platform
    const connectionToPlatform = new Map<string, string>();
    platformConnections.forEach(conn => {
      connectionToPlatform.set(conn.Id, conn.PlatformType.toLowerCase());
    });

    allVariantIds.forEach(variantId => {
      const variant = variants[variantId];
      if (!variant) return;

      // Cast to access VariantType which may not be on the base interface yet
      const variantWithType = variant as any;

      // Only track option variants for aggregation
      if (variantWithType.VariantType === 'option') {
        const productId = variant.ProductId;
        if (!optionVariantsByProduct.has(productId)) {
          optionVariantsByProduct.set(productId, []);
        }
        optionVariantsByProduct.get(productId)!.push({ id: variantId, variant });
      }
    });

    /**
     * CRITICAL FIX: Helper to get inventory levels for a variant from PRIMARY platform only.
     * This prevents double-counting when the same product exists on multiple platforms.
     * Priority order: shopify > square > clover > amazon > ebay > facebook
     * Also handles pool-based inventory (no platform connection) for partners
     */
    const getPrimaryPlatformInventory = (variantId: string): number => {
      const variantLevels = Object.values(levels).filter((level: InventoryLevel) =>
        level.ProductVariantId === variantId
      );

      // If no levels found, return 0
      if (variantLevels.length === 0) {
        return 0;
      }

      const hasRealPlatformLevels = variantLevels.some(level => !!level.PlatformConnectionId);

      // Group by platform (or 'pool' for levels without connection)
      // IMPORTANT: if real platform levels exist, ignore pool/synthetic rows so list matches editor/platform truth.
      const byPlatform: Record<string, number> = {};
      variantLevels.forEach(level => {
        if (hasRealPlatformLevels && !level.PlatformConnectionId) {
          return;
        }
        // For pool-based inventory (partner shares), use 'pool' as platform
        const platform = level.PlatformConnectionId
          ? (connectionToPlatform.get(level.PlatformConnectionId) || 'unknown')
          : 'pool';
        byPlatform[platform] = (byPlatform[platform] || 0) + (level.Quantity || 0);
      });

      // Pick PRIMARY platform only (priority order) - include 'pool' at end for partners
      const platformPriority = ['shopify', 'square', 'clover', 'amazon', 'ebay', 'facebook', 'pool'];
      for (const plat of platformPriority) {
        if (byPlatform[plat] !== undefined && byPlatform[plat] > 0) {
          return byPlatform[plat];
        }
      }

      // If all are zero, fall back to the first available platform entry
      for (const plat of platformPriority) {
        if (byPlatform[plat] !== undefined) {
          return byPlatform[plat];
        }
      }

      // Fallback: sum all if no known platform
      return Object.values(byPlatform).reduce((sum, qty) => sum + qty, 0);
    };

    // FILTER 1: Only show 'flat' or 'base' variants (not 'option' variants)
    // Option variants are sub-items that belong to a base variant and shouldn't appear separately
    // Also filter out archived variants
    let productVariantIdsToDisplay = allVariantIds.filter(variantId => {
      const variant = variants[variantId];
      if (!variant) return false;

      const variantWithType = variant as any;

      // Filter out archived variants (soft delete)
      if (variantWithType.IsArchived === true) {
        log.debug(`[InventoryScreen] Filtering out archived variant: ${variant.Title} (${variantId})`);
        return false;
      }

      // Filter out DRAFT variants (safety check)
      if (variant.Sku && variant.Sku.startsWith('DRAFT-')) {
        log.debug(`[InventoryScreen] Filtering out DRAFT variant: ${variant.Title} (${variant.Sku})`);
        return false;
      }

      // Filter out 'option' variants - these should not appear as separate list items
      // They are aggregated into their base variant
      if (variantWithType.VariantType === 'option') {
        log.debug(`[InventoryScreen] Filtering out option variant: ${variant.Sku} (parent: ${variant.ProductId})`);
        return false;
      }

      return true; // Show 'flat', 'base', or null/undefined VariantType
    });

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

    // Filter by location - check both base variant AND its option variants
    // Status filter by PUBLISH state (not the raw status string):
    //  active = live/posted on at least one platform; drafts = published nowhere yet
    //  (covers Anorha-made inventory + per-platform drafts, combined).
    if (filterStatus === 'active' || filterStatus === 'draft') {
      productVariantIdsToDisplay = productVariantIdsToDisplay.filter(variantId => {
        const v = variants[variantId] as any;
        if (!v) return false;
        const isLive = v.OnShopify === true || v.OnSquare === true || v.OnClover === true
          || v.OnAmazon === true || v.OnEbay === true || v.OnFacebook === true;
        return filterStatus === 'active' ? isLive : !isLive;
      });
    }

    if (selectedLocationIds.length > 0) {
      productVariantIdsToDisplay = productVariantIdsToDisplay.filter(variantId => {
        const variant = variants[variantId];
        if (!variant) return false;

        // Check if base variant has inventory at selected locations
        const baseHasInventory = Object.values(levels).some((level: InventoryLevel) => {
          const locationId = level.PlatformLocationId || 'unknown';
          const poolId = level.PoolId;

          // Match if location ID is selected OR if Pool ID is selected (for partner pools)
          const isLocationMatch = selectedLocationIds.includes(locationId);
          const isPoolMatch = poolId && selectedLocationIds.includes(poolId);

          return (level.ProductVariantId === variantId) && (isLocationMatch || isPoolMatch);
        });

        if (baseHasInventory) return true;

        // Also check option variants for inventory
        const optionVariants = optionVariantsByProduct.get(variant.ProductId) || [];
        const optionHasInventory = optionVariants.some(ov =>
          Object.values(levels).some((level: InventoryLevel) => {
            const locationId = level.PlatformLocationId || 'unknown';
            const poolId = level.PoolId;

            // Match if location ID is selected OR if Pool ID is selected
            const isLocationMatch = selectedLocationIds.includes(locationId);
            const isPoolMatch = poolId && selectedLocationIds.includes(poolId);

            return (level.ProductVariantId === ov.id) && (isLocationMatch || isPoolMatch);
          })
        );

        return optionHasInventory;
      });
    }

    const enrichedVariants: EnrichedProductVariant[] = productVariantIdsToDisplay.map(variantId => {
      const variant = variants[variantId];
      const variantWithType = variant as any;

      // Get images - check variant first, then product-level images
      const variantImages = Object.values(images).filter((img: ProductImage) => img.ProductVariantId === variantId);
      const imageUrl = variantImages.length > 0
        ? variantImages[0].ImageUrl
        : (variantWithType.PrimaryImageUrl || undefined);

      // CRITICAL: Aggregate inventory and prices from OPTION variants when this is a 'base' variant
      // Use getPrimaryPlatformInventory to avoid cross-platform double-counting
      let totalQuantity = 0;
      let minPrice: number | undefined = undefined;
      let maxPrice: number | undefined = undefined;
      const optionVariants = optionVariantsByProduct.get(variant.ProductId) || [];

      if (variantWithType.VariantType === 'base' && optionVariants.length > 0) {
        // For base variants, aggregate inventory from BOTH:
        // 1. The base variant's OWN inventory (for partner-shared products)
        // 2. All option variants' inventory
        // CRITICAL: Use getPrimaryPlatformInventory to avoid counting same product on multiple platforms

        // Start with base variant's own inventory (important for partner shares)
        totalQuantity = getPrimaryPlatformInventory(variantId);

        const optionPrices: number[] = [];
        // Also include base variant's price in the range
        if (variant.Price !== undefined && variant.Price !== null) {
          optionPrices.push(variant.Price);
        }

        optionVariants.forEach(ov => {
          // Add each option variant's inventory
          totalQuantity += getPrimaryPlatformInventory(ov.id);
          // Collect price from option variant
          if (ov.variant.Price !== undefined && ov.variant.Price !== null) {
            optionPrices.push(ov.variant.Price);
          }
        });

        // Calculate min/max prices from all variants (base + options)
        if (optionPrices.length > 0) {
          minPrice = Math.min(...optionPrices);
          maxPrice = Math.max(...optionPrices);
        }
        log.debug(`[InventoryScreen] Base variant ${variant.Sku}: aggregated ${totalQuantity} qty (base + ${optionVariants.length} options), price range: $${minPrice} - $${maxPrice}`);
      } else {
        // For flat variants (no options), use getPrimaryPlatformInventory to avoid cross-platform duplication
        totalQuantity = getPrimaryPlatformInventory(variantId);
        // Use the variant's own price
        minPrice = variant.Price;
        maxPrice = variant.Price;
      }

      // Platforms a variant is listed on (Track B seam — see src/lib/platforms.ts).
      const platformNames: string[] = getVariantPlatforms(variant);

      const variantIdsForSync = [variantId, ...optionVariants.map(ov => ov.id)];
      const syncTimestamps = Object.values(mappings)
        .filter((mapping: PlatformProductMapping) =>
          variantIdsForSync.includes(mapping.ProductVariantId) &&
          mapping.IsEnabled !== false
        )
        .map((mapping: PlatformProductMapping) => mapping.LastSyncedAt || mapping.UpdatedAt)
        .filter((value: any) => typeof value === 'string' && value.length > 0) as string[];
      const latestSyncMs = syncTimestamps.reduce((max, value) => {
        const parsed = new Date(value).getTime();
        return Number.isFinite(parsed) ? Math.max(max, parsed) : max;
      }, 0);
      const lastSyncedAt = latestSyncMs > 0 ? new Date(latestSyncMs).toISOString() : null;
      const staleThresholdMs = 24 * 60 * 60 * 1000;
      const isStale = !lastSyncedAt || (Date.now() - latestSyncMs) > staleThresholdMs;

      return {
        ...variant,
        imageUrl,
        totalQuantity,
        platformNames,
        lastSyncedAt,
        isStale,
        minPrice,
        maxPrice,
        VariantType: variantWithType.VariantType,
        IsArchived: variantWithType.IsArchived,
        optionVariantCount: optionVariants.length,
        CreatedAt: variant.CreatedAt, // Pass through for date sorting
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
  }, [activeProductVariants, activeProductImages, activeInventoryLevels, activePlatformMappings, platformConnections, selectedPlatformType, selectedLocationIds, filterStatus, legendObservables, variantUpdateCounter, inventoryUpdateCounter, sharedLinkQuantities]);

  // Apply search and sort filters
  const filteredInventory = useMemo(() => {
    // CRITICAL FIX: Clone the array to ensure reference changes for useMemo
    let filtered = [...enrichedProductVariants];

    // Search across multiple fields: title, description, sku, barcode, tags
    if (searchQuery) {
      const queryLower = searchQuery.toLowerCase();
      filtered = filtered.filter((item: EnrichedProductVariant) => {
        const matches: MatchLocation[] = [];
        let snippet = '';

        // Check title
        if (item.Title?.toLowerCase().includes(queryLower)) {
          matches.push('title');
          snippet = item.Title;
        }

        // Check description
        if (item.Description?.toLowerCase().includes(queryLower)) {
          matches.push('description');
          if (!snippet) snippet = item.Description.substring(0, 60) + '...';
        }

        // Check SKU
        if (item.Sku?.toLowerCase().includes(queryLower)) {
          matches.push('sku');
          if (!snippet) snippet = `SKU: ${item.Sku}`;
        }

        // Check barcode
        if (item.Barcode?.toLowerCase().includes(queryLower)) {
          matches.push('barcode');
          if (!snippet) snippet = `Barcode: ${item.Barcode}`;
        }

        // Check tags
        const hasTagMatch = item.Tags?.some(tag => tag.toLowerCase().includes(queryLower));
        if (hasTagMatch) {
          matches.push('tags');
          if (!snippet) {
            const matchedTag = item.Tags?.find(tag => tag.toLowerCase().includes(queryLower));
            snippet = `Tag: ${matchedTag}`;
          }
        }

        if (matches.length > 0) {
          item.matchLocations = matches;
          item.matchSnippet = snippet || item.Title || 'Match found';
          return true;
        }
        return false;
      });
    }

    // Low stock filter
    if (lowStockOnly && !searchQuery) {
      filtered = filtered.filter((item: EnrichedProductVariant) =>
        (item.totalQuantity || 0) <= 5
      );
    }

    // Preset allowlist (e.g. slow movers from nudges or route param)
    if (presetVariantIds && presetVariantIds.length > 0) {
      const allowSet = new Set(presetVariantIds);
      filtered = filtered.filter((item: EnrichedProductVariant) => allowSet.has(item.Id));
    }

    // Price max preset (e.g. "Under $50")
    if (priceMax != null && priceMax > 0) {
      filtered = filtered.filter((item: EnrichedProductVariant) => {
        const p = item.minPrice ?? item.Price ?? 0;
        return p <= priceMax;
      });
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
        // Sort by CreatedAt descending (most recent first)
        filtered.sort((a, b) => {
          const dateA = a.CreatedAt ? new Date(a.CreatedAt).getTime() : 0;
          const dateB = b.CreatedAt ? new Date(b.CreatedAt).getTime() : 0;
          return dateB - dateA;
        });
        break;
    }

    return filtered;
  }, [enrichedProductVariants, searchQuery, scannedBarcode, sortBy, lowStockOnly, presetVariantIds, priceMax]);

  // Bulk action modal: apply filter query to current list and set match IDs (used inside modal)
  const applyBulkActionModalFilter = useCallback((query: string): string[] => {
    const parsed = parseFilterQuery(query);
    let list = [...filteredInventory];
    if (parsed.priceMax != null && parsed.priceMax > 0) {
      list = list.filter((item: EnrichedProductVariant) => (item.minPrice ?? item.Price ?? 0) <= parsed.priceMax!);
    }
    if (parsed.lowStockOnly === true) {
      list = list.filter((item: EnrichedProductVariant) => (item.totalQuantity ?? 0) <= 5);
    }
    if (parsed.platform) {
      const plat = parsed.platform.toLowerCase();
      list = list.filter((item: EnrichedProductVariant) =>
        item.platformNames?.includes(plat) ?? false
      );
    }
    if (parsed.triggerSlowMovers === true && presetVariantIds?.length) {
      const allowSet = new Set(presetVariantIds);
      list = list.filter((item: EnrichedProductVariant) => allowSet.has(item.Id));
    }
    return list.map((item: EnrichedProductVariant) => item.Id);
  }, [filteredInventory, presetVariantIds]);

  const handleBulkActionModalApply = useCallback(() => {
    const ids = applyBulkActionModalFilter(bulkActionModalQuery);
    setBulkActionModalMatchIds(ids.length > 0 ? ids : null);
  }, [bulkActionModalQuery, applyBulkActionModalFilter]);

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
    startTrace();
    try {
      setBarcodeSearchError(null);
      log.debug(`[InventoryOrdersScreen] Searching backend for barcode: ${barcode}`);

      const token = await ensureSupabaseJwt();
      if (!token) {
        logFlowEvent(FlowEvents.BARCODE_SCAN_FAILED, { barcode, error: 'no_auth_token' });
        setBarcodeSearchError('Authentication required. Please log in again.');
        return;
      }

      const traceHeaders = await getTraceHeaders();
      const response = await fetch(`${API_BASE_URL}/api/products/search-by-barcode?barcode=${encodeURIComponent(barcode)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...traceHeaders,
        },
      });

      if (!response.ok) {
        const errMsg = response.status === 404 ? `Product not found with barcode: ${barcode}` : `Search failed: ${response.statusText}`;
        logFlowEvent(FlowEvents.BARCODE_SCAN_FAILED, { barcode, status: response.status, error: errMsg });
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
        logFlowEvent(FlowEvents.BARCODE_SCAN_FAILED, { barcode, error: data.error });
        setBarcodeSearchError(data.error);
        setScannedBarcode(null);
        return;
      }

      logFlowEvent(FlowEvents.BARCODE_SCAN_COMPLETED, {
        barcode,
        variantId: data.variant?.Id ?? data.variant?.id ?? null,
      });
      log.debug(`[InventoryOrdersScreen] Backend found variant:`, data.variant);
      // Result will be used in filteredInventory below
      // Don't clear the scannedBarcode - it's already set and will filter the list
    } catch (error) {
      log.error(`[InventoryOrdersScreen] Barcode search error:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      logFlowEvent(FlowEvents.BARCODE_SCAN_FAILED, { barcode, error: errorMessage });
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

  // Memoized callback for list items
  const handleItemPress = useCallback((id: string) => {
    if (isSelectionMode) {
      handleToggleSelection(id);
    } else {
      navigation.navigate('ProductDetail', { productId: id });
    }
  }, [isSelectionMode, navigation, handleToggleSelection]); // Dependencies need check

  // Needs to be defined before renderInventoryItem

  const renderInventoryItem = ({ item, index }: { item: EnrichedProductVariant; index: number }) => {
    return (
      <InventoryListCard
        id={item.Id}
        title={item.Title}
        price={item.Price}
        minPrice={item.minPrice}
        maxPrice={item.maxPrice}
        sku={item.Sku}
        imageUrl={item.imageUrl}
        totalQuantity={item.totalQuantity}
        platformNames={item.platformNames}
        lastSyncedAt={item.lastSyncedAt}
        isStale={item.isStale}
        matchLocations={item.matchLocations}
        matchSnippet={item.matchSnippet}
        searchQuery={searchQuery}
        onPress={handleItemPress}
        onLongPress={() => handleLongPressItem(item.Id)}
        isSelectionMode={isSelectionMode}
        isSelected={selectedItems.has(item.Id)}
        onLayout={(e) => {
          // Approximate layout tracking (index * estimated height) is faster but less accurate.
          // Accurate: use event. But unrelated to scroll.
          // Actually, in FlatList `onLayout` gives relative-to-item coords (0,0)?
          // We need `index`. 
          // If implementing drag, we might need a simpler fixed-height assumption or `onLayout` of the container?
          // Let's use simple estimation for now: index * 130 (card height + margin).
          // Or aggregate heights.

          // Correction: inside FlatList, item onLayout x/y are relative to parent list content.
          // So event.nativeEvent.layout.y IS the scroll position Y.
          itemLayouts.current[item.Id] = {
            y: e.nativeEvent.layout.y,
            height: e.nativeEvent.layout.height
          };
        }}
      />
    );
  };

  const renderOrderItem = ({ item }: { item: MockOrderItemData }) => {
    const trackButtonStyle = {
      backgroundColor: theme.colors.primary + '00'
    };

    return (
      <TouchableOpacity
        onPress={() => { }}
        activeOpacity={0.7}
      >
        <Text style={[styles.mockOrderText, { color: theme.colors.textSecondary }]}>
          Orders view coming soon
        </Text>
      </TouchableOpacity>
    );
  };

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
      {/* Tappable header title → AppMenu (Inventory / Orders / Scan inventory). */}
      <View style={[styles.titleBar, { top: insets.top + 6 }]} pointerEvents="box-none">
        <TouchableOpacity style={styles.titleTap} onPress={() => setHeaderMenuOpen(true)} activeOpacity={0.7}>
          <Text style={styles.titleText}>{activeTab === 'inventory' ? 'Inventory' : 'Orders'}</Text>
          <ChevronsUpDownIcon color="#2c2c2c" fontWeight={500}/>
        </TouchableOpacity>
      </View>

      <View style={[styles.container, { marginTop: 110, paddingTop: 20, backgroundColor: "#FFF", }]}>

        {activeTab === 'inventory' && (
          <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
            {/* Search + filters now live in the FlatList header (below) so they scroll away
                with the list instead of staying sticky. */}

            {/* Inventory List */}
            <View
              style={{ flex: 1 }}
              {...panResponder.panHandlers}
              onLayout={(e) => {
                listHeight.current = e.nativeEvent.layout.height;
              }}
            >
              <FlatList
                ref={listRef}
                scrollEnabled={scrollEnabled}
                data={inventoryToDisplay}
                renderItem={renderInventoryItem}
                keyExtractor={item => item.Id.toString()}
                contentContainerStyle={styles.listContent}
                onScroll={handleScroll}
                scrollEventThrottle={16}
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
                  <View>
                    {isSelectionMode ? (
                      <Animated.View entering={FadeInDown} style={styles.selectionHeader}>
                        <View style={styles.selectionHeaderLeft}>
                          <TouchableOpacity onPress={handleExitSelectionMode} style={styles.closeButton}>
                            <Icon name="close" size={24} color="#333" />
                          </TouchableOpacity>
                          <Text style={styles.selectionCountText}>
                            {selectedItems.size} Selected
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.selectAllButton}
                          onPress={() => {
                            if (selectedItems.size === filteredInventory.length && filteredInventory.length > 0) {
                              setSelectedItems(new Set());
                            } else {
                              handleSelectAll();
                            }
                          }}
                        >
                          <Text style={styles.selectAllButtonText}>
                            {selectedItems.size === filteredInventory.length && filteredInventory.length > 0 ? "Deselect All" : "Select All"}
                          </Text>
                        </TouchableOpacity>
                      </Animated.View>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8, backgroundColor: "#fff", }}>
                        {/* Search + compact location/sort buttons on one row (chat-search style). */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={{ flex: 1, justifyContent: 'center' }}>
                            <SearchBarWithScanner
                              noBottomMargin
                              placeholder="Search for a product"
                              value={searchQuery}
                              onChangeText={handleSearchChange}
                              onScan={handleBarcodeScan}
                              onScannerOpen={() => {
                                openScanner((code: string) => {
                                  handleBarcodeScan(code);
                                  closeScanner();
                                }, 'search_bar');
                              }}
                              onClear={handleSearchClear}
                              onVoicePress={() => setSpeechModalVisible(true)}
                            />
                          </View>
                          {/* One entry point: opens the unified filter sheet (Order / Location / Status). */}
                          <TouchableOpacity
                            onPress={() => setFilterSheetOpen(true)}
                            activeOpacity={0.8}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: "center", width: 48, height: 48, borderRadius: 32, borderWidth: 2, borderColor: 'rgba(153, 153, 153, 0.20)', backgroundColor: '#fff' }}
                          >
                      
                            <ListFilter  size={24} fontWeight={500} color="#666"/>
                            
                          </TouchableOpacity>
                        </View>
                        {barcodeSearchError && (
                          <View style={[styles.errorMessage, { backgroundColor: theme.colors.error + '15' }]}>
                            <Icon name="alert-circle-outline" size={16} color={theme.colors.error} style={{ marginRight: 8 }} />
                            <Text style={[styles.errorText, { color: theme.colors.error }]}>
                              {barcodeSearchError}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    <View style={{ paddingHorizontal: 8 }}>
                      <PlatformFilterChips
                        platforms={platformsForChips}
                        selectedPlatform={selectedPlatformType}
                        onSelectPlatform={setSelectedPlatformType}
                        activeColor={theme.colors.primary}
                      />
                    </View>
                  </View>
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
            </View>
          </Animated.View>
        )}

        {activeTab === 'orders' && (
          <Animated.View entering={FadeInUp.delay(200).duration(500)} style={styles.listContainer}>
            <OrdersTab />
          </Animated.View>
        )}
      </View>

      {/* Header dropdown — reusable Linear-like menu, used for all app dropdowns. */}
      <AppMenu
        visible={headerMenuOpen}
        onClose={() => setHeaderMenuOpen(false)}
        anchor={{ top: insets.top + 44, left: 16 }}
        sections={[
          [
            { key: 'inventory', label: 'Inventory', icon: 'package-variant', active: activeTab === 'inventory', onPress: () => { setActiveTab('inventory'); setHeaderMenuOpen(false); } },
            { key: 'orders', label: 'Orders', icon: 'receipt-text-outline', active: activeTab === 'orders', onPress: () => { setActiveTab('orders'); setHeaderMenuOpen(false); } },
          ],
          [
            { key: 'scan', label: 'Scan inventory', icon: 'barcode-scan', onPress: () => { setHeaderMenuOpen(false); openScanner((code: string) => { handleBarcodeScan(code); closeScanner(); }, 'header_menu'); } },
          ],
        ]}
      />

      {/* Full-screen Scanner Modal - renders above everything */}
      {
        scannerMounted && (
          <View style={styles.scannerDockFull} pointerEvents="box-none">
            <RNAnimated.View pointerEvents={scannerOpen ? 'auto' : 'none'} style={[styles.scannerFullBleed, { height: scannerHeight }]}>
              <CameraView
                style={styles.scannerCamera}
                facing="back"
                onBarcodeScanned={scannerOpen ? (result: any) => {
                  const code = result?.data || result?.rawValue;
                  if (code && scannerResultHandlerRef.current) {
                    scannerResultHandlerRef.current(code);
                  }
                } : undefined}
                barcodeScannerSettings={{
                  barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
                }}
              />
              <TouchableOpacity
                onPress={() => {
                  log.debug('[InventoryOrdersScreen] Scanner close button pressed');
                  closeScanner();
                }}
                style={styles.scannerCloseButton}
              >
                <Icon name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </RNAnimated.View>
          </View>
        )
      }

      {/* Bulk Action Bar - Cleaner Light Mode */}
      {
        isSelectionMode && !bulkActionModalVisible && (
          <Animated.View
            entering={SlideInDown.duration(300)}
            exiting={SlideOutDown}
            style={styles.bulkActionBar}
          >
            <View style={styles.bulkActionContent}>
              {/* Left: Count Badge with Cancel */}
              <TouchableOpacity
                onPress={handleExitSelectionMode}
                style={styles.countBadge}
              >
                <Icon name="close-circle" size={18} color="#4B5563" />
                <Text style={styles.countBadgeText}>{selectedItems.size}</Text>
              </TouchableOpacity>

              {/* Center: Horizontal Scrollable Actions */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.actionsScrollContent}
                style={styles.actionsScroll}
              >
                {addToCampaign ? (
                  <TouchableOpacity
                    style={[styles.actionChip, styles.addToClearoutChip]}
                    onPress={handleAddToClearout}
                    disabled={addingToCampaign || selectedItems.size === 0}
                  >
                    {addingToCampaign ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Icon name="sprout-outline" size={18} color="#FFFFFF" />
                    )}
                    <Text style={[styles.actionChipText, { color: '#FFFFFF' }]}>
                      Add {selectedItems.size || ''} to {addToCampaign.title}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity style={styles.actionChip} onPress={() => setBulkActionModalVisible(true)}>
                  <Icon name="filter-variant-plus" size={18} color="#374151" />
                  <Text style={styles.actionChipText}>Bulk action</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionChip} onPress={() => setLiquidationModalVisible(true)}>
                  <Icon name="tag-outline" size={18} color="#374151" />
                  <Text style={styles.actionChipText}>Liquidate</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionChip} onPress={handleBulkDelete}>
                  <Icon name="trash-can-outline" size={18} color="#374151" />
                  <Text style={styles.actionChipText}>Delete</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.actionChip} onPress={() => setArchiveModalVisible(true)}>
                  <Icon name="archive-outline" size={18} color="#374151" />
                  <Text style={styles.actionChipText}>Archive</Text>
                </TouchableOpacity>



                <TouchableOpacity style={styles.actionChip} onPress={() => setTagsModalVisible(true)}>
                  <Icon name="tag-plus-outline" size={18} color="#374151" />
                  <Text style={styles.actionChipText}>Tags</Text>
                </TouchableOpacity>
              </ScrollView>

              {/* Right: More Menu */}
              <TouchableOpacity
                style={styles.moreButton}
                onPress={() => setMoreMenuVisible(true)}
              >
                <Icon name="dots-horizontal" size={24} color="#374151" />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )
      }

      {/* Bulk Action Inline Card — replaces BaseModal, acts as command entry */}
      {
        bulkActionModalVisible && (
          <View
            style={{
              position: 'absolute',
              bottom: keyboardHeight > 0 ? keyboardHeight : (Platform.OS === 'ios' ? 140 : 120),
              left: 0,
              right: 0,
              zIndex: 1001,
            }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => setBulkActionModalVisible(false)}
              style={{ position: 'absolute', top: -1000, left: 0, right: 0, bottom: -500, backgroundColor: 'transparent' }}
            />

            <View style={{
              backgroundColor: 'rgba(255, 255, 255, 1)',
              borderRadius: 32,
              borderWidth: keyboardHeight > 0 ? 0 : 1,
              borderColor: '#F3F4F6',
              paddingHorizontal: 20,
              marginHorizontal: 12,
              paddingBottom: 16,
              marginBottom: 16,
              paddingTop: 16,
              ...Platform.select({
                ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12 },
                android: { elevation: 8 },
              }),
            }}>
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#111' }}>Bulk Action</Text>
                <TouchableOpacity
                  onPress={() => {
                    setBulkActionModalVisible(false);
                    setBulkActionModalQuery('');
                    setBulkActionModalMatchIds(null);
                    setBulkPhase('command');
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Icon name="close" size={20} color="#9CA3AF" />
                </TouchableOpacity>
              </View>

              {bulkPhase === 'command' && (
                <View style={{ paddingHorizontal: 4, paddingBottom: 4 }}>
                  <SmartCommandInput
                    mode="voice_filter"
                    startExpanded={true}
                    initialMode="text"
                    variant="inline"
                    disableKeyboardHandling={true}
                    fullWidth={true}
                    apiBaseUrl={API_BASE_URL}
                    getAuthToken={ensureSupabaseJwt}
                    onSubmit={async (text) => {
                      setBulkActionModalQuery(text);
                      setBulkPhase('planning');
                      setPlanLoading(true);

                      try {
                        const baseUrl = API_BASE_URL;
                        const token = await ensureSupabaseJwt();
                        if (!baseUrl || !token) throw new Error('Missing config');

                        // Gather selected items data for the planner
                        const selectedIds = Array.from(selectedItems);
                        const itemsForPlanner = filteredInventory
                          .filter(item => selectedIds.includes(item.Id))
                          .map(item => ({
                            id: item.Id,
                            title: item.Title || 'Untitled',
                            price: item.Price ?? item.minPrice ?? 0,
                            quantity: item.totalQuantity ?? 0,
                            sku: item.Sku || '',
                            platform: item.platformNames?.join(', ') || '',
                            tags: item.Tags || '',
                            imageUrl: item.imageUrl || '',
                          }));

                        const res = await fetch(`${baseUrl}/api/products/bulk-actions/plan`, {
                          method: 'POST',
                          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                          body: JSON.stringify({ command: text, items: itemsForPlanner }),
                        });

                        if (!res.ok) throw new Error(`Plan failed: ${res.status}`);
                        const plan = await res.json();

                        const actionsWithApproval = (plan.actions || []).map((a: any) => ({ ...a, approved: true }));
                        setPlannedActions(actionsWithApproval);
                        setPlanSummary(plan.summary || `${actionsWithApproval.length} actions planned`);
                        setBulkPhase('review');
                        setBulkActionModalVisible(false);
                        setReviewModalVisible(true);
                      } catch (err) {
                        log.error('[BulkAction] Planning failed:', err);
                        Alert.alert('Error', 'Failed to plan bulk actions. Please try again.');
                        setBulkPhase('command');
                      } finally {
                        setPlanLoading(false);
                      }
                    }}
                    onCollapse={() => {
                      setBulkActionModalVisible(false);
                      setBulkPhase('command');
                    }}
                  />
                </View>
              )}

              {bulkPhase === 'planning' && (
                <View style={{ paddingVertical: 32, alignItems: 'center', gap: 12 }}>
                  <ActivityIndicator size="large" color={BRAND_PRIMARY} />
                  <Text style={{ color: '#6B7280', fontSize: 14, fontWeight: '500' }}>Planning actions…</Text>
                </View>
              )}
            </View>
          </View>
        )
      }

      {/* Full-Screen Review Modal */}
      <Modal
        visible={reviewModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setReviewModalVisible(false);
          setBulkPhase('command');
          setPlannedActions([]);
        }}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#F9FAFB' }}>
          {/* Review Header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111' }}>Review Changes</Text>
              <Text style={{ fontSize: 13, color: '#6B7280', marginTop: 2 }}>{planSummary}</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setReviewModalVisible(false);
                setBulkPhase('command');
                setPlannedActions([]);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="close" size={24} color="#6B7280" />
            </TouchableOpacity>
          </View>

          {/* Select All / Deselect All bar */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F3F4F6' }}>
            <Text style={{ fontSize: 13, color: '#6B7280' }}>
              {plannedActions.filter(a => a.approved).length} of {plannedActions.length} approved
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => setPlannedActions(prev => prev.map(a => ({ ...a, approved: true })))}>
                <Text style={{ fontSize: 13, color: BRAND_PRIMARY, fontWeight: '600' }}>Select All</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPlannedActions(prev => prev.map(a => ({ ...a, approved: false })))}>
                <Text style={{ fontSize: 13, color: '#9CA3AF', fontWeight: '600' }}>Deselect All</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Action Cards List */}
          <FlatList
            data={plannedActions}
            keyExtractor={(item) => item.itemId}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: bottomSafePadding }}
            renderItem={({ item, index }) => (
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setPlannedActions(prev => prev.map((a, i) => i === index ? { ...a, approved: !a.approved } : a))}
                style={{
                  backgroundColor: '#fff',
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: item.approved ? BRAND_PRIMARY : '#E5E7EB',
                  padding: 14,
                  opacity: item.approved ? 1 : 0.5,
                  ...Platform.select({
                    ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4 },
                    android: { elevation: 1 },
                  }),
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  {/* Checkbox */}
                  <View style={{
                    width: 22, height: 22, borderRadius: 6,
                    borderWidth: 2, borderColor: item.approved ? BRAND_PRIMARY : '#D1D5DB',
                    backgroundColor: item.approved ? BRAND_PRIMARY : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {item.approved && <Icon name="check" size={14} color="#fff" />}
                  </View>

                  {/* Item info */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: '#111' }} numberOfLines={1}>{item.title}</Text>
                    <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>{item.description}</Text>
                  </View>
                </View>

                {/* Changes */}
                {item.changes.length > 0 && (
                  <View style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F3F4F6' }}>
                    {item.changes.map((change, ci) => (
                      <View key={ci} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <Text style={{ fontSize: 12, color: '#9CA3AF', fontWeight: '500', textTransform: 'capitalize' }}>{change.field}:</Text>
                        <Text style={{ fontSize: 12, color: '#EF4444', textDecorationLine: 'line-through' }}>{change.from}</Text>
                        <Icon name="arrow-right" size={12} color="#D1D5DB" />
                        <Text style={{ fontSize: 12, color: '#10B981', fontWeight: '600' }}>{change.to}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </TouchableOpacity>
            )}
          />

          {/* Bottom Action Bar */}
          <View style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E5E7EB',
            paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 34 : 16,
            flexDirection: 'row', gap: 12,
          }}>
            <TouchableOpacity
              style={{
                flex: 1, paddingVertical: 14, borderRadius: 12,
                backgroundColor: '#F3F4F6', alignItems: 'center',
              }}
              onPress={() => {
                setReviewModalVisible(false);
                setBulkPhase('command');
                setPlannedActions([]);
              }}
            >
              <Text style={{ color: '#6B7280', fontSize: 15, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                flex: 2, paddingVertical: 14, borderRadius: 12,
                backgroundColor: plannedActions.some(a => a.approved) ? BRAND_PRIMARY : '#D1D5DB',
                alignItems: 'center',
                ...Platform.select({
                  ios: { shadowColor: BRAND_PRIMARY, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 6 },
                  android: { elevation: 3 },
                }),
              }}
              disabled={!plannedActions.some(a => a.approved) || executeLoading}
              onPress={async () => {
                const approved = plannedActions.filter(a => a.approved);
                if (approved.length === 0) return;

                setExecuteLoading(true);
                try {
                  const baseUrl = API_BASE_URL;
                  const token = await ensureSupabaseJwt();
                  if (!baseUrl || !token) throw new Error('Missing config');

                  const res = await fetch(`${baseUrl}/api/products/bulk-actions/execute`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      actions: approved.map(a => ({
                        itemId: a.itemId,
                        actionType: a.actionType,
                        changes: a.changes,
                      })),
                    }),
                  });

                  if (!res.ok) throw new Error(`Execute failed: ${res.status}`);
                  const result = await res.json();

                  Alert.alert(
                    'Done',
                    `${result.successful} of ${result.total} changes applied successfully.`,
                    [{ text: 'OK' }]
                  );

                  setReviewModalVisible(false);
                  setBulkPhase('command');
                  setPlannedActions([]);
                  handleExitSelectionMode();
                } catch (err) {
                  log.error('[BulkAction] Execute failed:', err);
                  Alert.alert('Error', 'Failed to execute bulk actions. Please try again.');
                } finally {
                  setExecuteLoading(false);
                }
              }}
            >
              {executeLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>
                  Approve {plannedActions.filter(a => a.approved).length} changes
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Voice Search Modal - Dedicated voice recorder for instant recording */}
      <Modal
        visible={speechModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSpeechModalVisible(false)}
      >
        <View
          style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
        >
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setSpeechModalVisible(false)}
          />
          <View style={{
            backgroundColor: 'transparent',
            paddingHorizontal: 16,
            paddingBottom: bottomSafePadding
          }}>
            <VoiceRecorder
              apiBaseUrl={API_BASE_URL}
              getAuthToken={ensureSupabaseJwt}
              onTranscription={(text) => {
                setSearchQuery(text);
                setScannedBarcode(null);
                setBarcodeSearchError(null);
                setSpeechModalVisible(false);
              }}
              onCancel={() => setSpeechModalVisible(false)}
            />
          </View>
        </View>
      </Modal>

      {/* Unified filter sheet (Order / Location / Status) */}
      <InventoryFilterSheet
        visible={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        sortBy={sortBy}
        sortOptions={DEFAULT_SORT_OPTIONS}
        onSortChange={setSortBy}
        filterStatus={filterStatus}
        statusOptions={STATUS_OPTIONS}
        onStatusChange={setFilterStatus}
        platformConnections={platformConnections}
        selectedLocationIds={selectedLocationIds}
        onLocationChange={setSelectedLocationIds}
        onReset={() => { setSortBy('date'); setFilterStatus('all'); setSelectedLocationIds([]); }}
      />

      {/* More Actions Modal - Cleaner "Lowkey" Design */}
      <BaseModal
        visible={moreMenuVisible}
        onClose={() => setMoreMenuVisible(false)}
        showCloseButton={true}
        containerStyle={{ width: '85%', borderRadius: 24, padding: 24 }}
      >
        <View style={{ width: '100%' }}>
          {/* Header - Subtler */}
          <View style={{ marginBottom: 20 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 4 }}>
              Actions
            </Text>
            <Text style={{ fontSize: 13, color: '#6B7280', fontWeight: '500' }}>
              {selectedItems.size} items selected
            </Text>
          </View>

          <View style={{ gap: 12 }}>
            <TouchableOpacity style={styles.modalOption} onPress={() => {
              log.debug('[Analytics] Print low stock');
              setMoreMenuVisible(false);
              Alert.alert("Coming Soon", "Low stock report will be generated as PDF");
            }}>
              <View style={styles.modalOptionIconBg}>
                <Icon name="printer-outline" size={20} color="#4B5563" />
              </View>
              <Text style={styles.modalOptionText}>Print Low Stock Report</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalOption} onPress={() => {
              log.debug('[Analytics] Fastest movers');
              setMoreMenuVisible(false);
              Alert.alert("Coming Soon", "Velocity analysis across platforms/locations");
            }}>
              <View style={styles.modalOptionIconBg}>
                <Icon name="trending-up" size={20} color="#4B5563" />
              </View>
              <Text style={styles.modalOptionText}>Show Fastest Movers</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modalOption} onPress={() => {
              log.debug('[BulkDraft] Setting as draft');
              setMoreMenuVisible(false);
            }}>
              <View style={styles.modalOptionIconBg}>
                <Icon name="file-document-edit-outline" size={20} color="#4B5563" />
              </View>
              <Text style={styles.modalOptionText}>Set as Draft</Text>
            </TouchableOpacity>
          </View>
        </View>
      </BaseModal>

      {/* Archive Modal */}
      <BaseModal
        visible={archiveModalVisible}
        onClose={() => setArchiveModalVisible(false)}
        showCloseButton={true}
        containerStyle={{ width: '85%', borderRadius: 24, padding: 24 }}
      >
        <Text style={styles.modalTitle}>Archive Items</Text>
        <Text style={styles.modalSubtitle}>
          Are you sure you want to archive {selectedItems.size} items? They will be hidden from the main inventory list.
        </Text>
        <View style={styles.modalButtonsRow}>
          <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setArchiveModalVisible(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalButton, styles.confirmButton]}
            onPress={() => runBulkArchiveByIds(Array.from(selectedItems))}
          >
            <Text style={styles.confirmButtonText}>Archive</Text>
          </TouchableOpacity>
        </View>
      </BaseModal>

      {/* Tags Modal */}
      <BaseModal
        visible={tagsModalVisible}
        onClose={() => setTagsModalVisible(false)}
        showCloseButton={true}
        containerStyle={{ width: '85%', borderRadius: 24, padding: 24 }}
      >
        <Text style={styles.modalTitle}>Add Tags</Text>
        <Text style={styles.modalSubtitle}>Add a tag to {selectedItems.size} items.</Text>

        <TextInput
          style={styles.tagsInput}
          placeholder="Enter tag name..."
          value={tagInput}
          onChangeText={setTagInput}
          autoFocus={true}
        />

        <View style={styles.modalButtonsRow}>
          <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setTagsModalVisible(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalButton, styles.confirmButton]}
            onPress={() => {
              log.debug('[BulkTags] Adding tag:', tagInput, 'to', Array.from(selectedItems));
              setTagInput("");
              setTagsModalVisible(false);
              handleExitSelectionMode();
            }}
          >
            <Text style={styles.confirmButtonText}>Add Tag</Text>
          </TouchableOpacity>
        </View>
      </BaseModal>

      {/* Liquidation Modal */}
      <BaseModal
        visible={liquidationModalVisible}
        onClose={() => setLiquidationModalVisible(false)}
        showCloseButton={true}
        containerStyle={{ width: '85%', borderRadius: 24, padding: 24 }}
      >
        <Text style={styles.modalTitle}>Start Liquidation</Text>
        <Text style={styles.modalSubtitle}>Configure campaign for {selectedItems.size} items.</Text>

        <View style={{ width: '100%', marginBottom: 16 }}>
          <Text style={styles.inputLabel}>Timeline (Days)</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="e.g. 30"
            placeholderTextColor="#9ca3af"
            keyboardType="number-pad"
            returnKeyType="done"
            value={liquidationTimeline}
            onChangeText={setLiquidationTimeline}
          />

          <Text style={styles.inputLabel}>Target Recovery ($)</Text>
          <TextInput
            style={styles.modalInput}
            placeholder="e.g. 1500"
            placeholderTextColor="#9ca3af"
            keyboardType="numeric"
            returnKeyType="done"
            value={liquidationAmount}
            onChangeText={setLiquidationAmount}
          />
        </View>

        <Text style={styles.inputLabel}>Pricing Strategy</Text>
        <View style={styles.strategyContainer}>
          {(['aggressive', 'moderate', 'conservative'] as const).map(strategy => (
            <TouchableOpacity
              key={strategy}
              style={[
                styles.strategyOption,
                liquidationStrategy === strategy && styles.strategyOptionSelected
              ]}
              onPress={() => setLiquidationStrategy(strategy)}
            >
              <Text style={[
                styles.strategyText,
                liquidationStrategy === strategy && styles.strategyTextSelected
              ]}>
                {strategy.charAt(0).toUpperCase() + strategy.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.modalButtonsRow}>
          <TouchableOpacity style={[styles.modalButton, styles.cancelButton]} onPress={() => setLiquidationModalVisible(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modalButton, styles.confirmButton]}
            onPress={async () => {
              try {
                const token = await ensureSupabaseJwt();
                if (!token) {
                  Alert.alert('Error', 'Not authenticated');
                  return;
                }

                // Get the selected product IDs
                const selectedProductIds = Array.from(selectedItems);

                // Build the request body
                const requestBody = {
                  targetRevenue: parseFloat(liquidationAmount) || 500,
                  timeframeDays: parseInt(liquidationTimeline) || 30,
                  productIds: selectedProductIds,
                  aggressiveness: liquidationStrategy === 'moderate' ? 'balanced' : liquidationStrategy,
                };

                log.debug('[BulkLiquidate] Starting campaign with:', requestBody);

                // Call the actual API
                const response = await fetch(`${API_BASE_URL}/api/agent/quick/liquidation`, {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(requestBody),
                });

                if (!response.ok) {
                  const errorData = await response.json().catch(() => ({}));
                  throw new Error(errorData.message || `Failed to start campaign: ${response.status}`);
                }

                const result = await response.json();
                log.debug('[BulkLiquidate] Campaign created:', result);

                setLiquidationModalVisible(false);
                handleExitSelectionMode();

                // Navigate to campaign screen with real session ID
                navigation.navigate('LiquidationCampaignScreen', {
                  campaignId: result.sessionId
                });

              } catch (error: any) {
                log.error('[BulkLiquidate] Failed:', error);
                Alert.alert('Error', error.message || 'Failed to start liquidation campaign');
              }
            }}
          >
            <Text style={styles.confirmButtonText}>Start Campaign</Text>
          </TouchableOpacity>
        </View>
      </BaseModal>

    </View >
  );
});

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: "#F2F2F7", // CHAT_COLORS.brand — align with the chat-style palette
  },
  titleBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleTap: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  titleText: { fontSize: 26, fontWeight: '700', color: '#2c2c2c' },
  container: {
    borderTopRightRadius: 32,
    borderTopLeftRadius: 32,
    borderColor: "#99999962",
    borderWidth: 1,
    flex: 1,
    backgroundColor: '#F4F4F1', // CHAT_COLORS.surface
    padding: 4,
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
  filterActRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  filterActChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterActChipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  filterMatchStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  filterMatchText: {
    fontSize: 15,
    fontWeight: '600',
  },
  filterMatchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterMatchButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  filterMatchButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  filterMatchButtonSecondary: {
    backgroundColor: 'transparent',
  },
  filterMatchButtonTextSecondary: {
    fontSize: 14,
    fontWeight: '500',
  },
  presetChipsScroll: {
    marginBottom: 8,
  },
  presetChipsRow: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  presetChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F9FAFB',
    flexDirection: 'row',
    alignItems: 'center',
  },
  presetChipText: {
    fontSize: 13,
    color: '#374151',
  },
  nlFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  nlFilterInput: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  nlFilterMicButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nlFilterApplyButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  nlFilterApplyText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
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
    width: '100%',
    height: '100%',
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
    width: '100%',
  },
  scannerFullBleed: {
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
  optimizeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eef2ff',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginLeft: 8,
    gap: 4,
  },
  optimizeButtonText: {
    color: '#6366f1',
    fontSize: 13,
    fontWeight: '600',
  },

  // Selection Styles
  selectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    height: 60,
    marginBottom: 16, // Added spacing below header
  },
  selectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  closeButton: {
    padding: 8,
    marginRight: 12,
  },
  selectionCountText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111',
  },
  bulkActionBar: {
    position: 'absolute',
    bottom: 130, // Increased to clear tab bar
    left: 12,
    right: 12,
    backgroundColor: '#FFFFFF', // Light background
    borderRadius: 32, // Pill shape
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15, // Softer shadow
    shadowRadius: 12,
    elevation: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    zIndex: 1000,
    borderWidth: 1,
    borderColor: '#F3F4F6', // Subtle border
  },
  bulkActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6', // Light gray standard
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    gap: 6,
  },
  countBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151', // Dark gray text
  },
  actionsScroll: {
    flex: 1,
    marginHorizontal: 8,
  },
  actionsScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6', // Light gray standard
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  addToClearoutChip: {
    backgroundColor: '#93C822',
  },
  actionChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151', // Dark text
  },
  moreButton: {
    padding: 8,
    backgroundColor: '#F3F4F6', // Light gray standard
    borderRadius: 20,
  },
  // Legacy styles (kept for backwards compatibility)
  bulkActionText: {
    fontSize: 15,
    color: '#374151',
    fontWeight: '600',
    marginLeft: 8,
  },
  bulkActionButtons: {
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  bulkActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  bulkActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  selectAllButton: {
    backgroundColor: '#84CC16', // Lime green
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  selectAllButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#F9FAFB', // Very subtle background
    borderRadius: 12,
    width: '100%',
  },
  modalOptionIconBg: {
    width: 36,
    height: 36,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  modalOptionText: {
    fontSize: 15, // Slightly smaller/cleaner
    color: '#374151',
    marginLeft: 12,
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111',
    marginBottom: 8,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 20,
    lineHeight: 20,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#F3F4F6',
  },
  confirmButton: {
    backgroundColor: '#111',
  },
  cancelButtonText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 14,
  },
  confirmButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 14,
  },
  tagsInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: '#111',
  },
  modalInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: '#111',
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 6,
    marginTop: 4,
  },
  strategyContainer: {
    width: '100%',
    gap: 8,
  },
  strategyOption: {
    width: '100%',
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    alignItems: 'center',
  },
  strategyOptionSelected: {
    borderColor: '#111',
    backgroundColor: '#F9FAFB',
  },
  strategyText: {
    fontSize: 15,
    color: '#6B7280',
    fontWeight: '500',
  },
  strategyTextSelected: {
    color: '#111',
    fontWeight: '600',
  },
});

export default InventoryOrdersScreen;

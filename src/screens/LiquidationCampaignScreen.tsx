import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronLeft, Menu, Box, MessageSquare, Settings as SettingsIcon, Pencil, Trash2, Check,
  Search, X, Plus, PlusCircle, ChevronRight, AlertCircle, CheckCircle2,
} from 'lucide-react-native';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { useLiquidationConversationController } from '../features/liquidationConversation/useLiquidationConversationController';
import type { CampaignItem, ItemStatus } from '../features/liquidationConversation/types';
import InventoryListCard from '../components/InventoryListCard';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

/* ── helpers ────────────────────────────────────────────────────────── */

const STATUS_STYLE: Record<ItemStatus, { bg: string; fg: string }> = {
  negotiating: { bg: '#faeeda', fg: '#854F0B' },
  listed:      { bg: '#F3F4F6', fg: '#6B7280' },
  sold:        { bg: '#eaf3de', fg: '#3B6D11' },
  at_floor:    { bg: '#fcebeb', fg: '#A32D2D' },
  paused:      { bg: '#F3F4F6', fg: '#9CA3AF' },
};

const STATUS_LABEL: Record<ItemStatus, string> = {
  negotiating: 'negotiating',
  listed: 'listed',
  sold: 'sold ✓',
  at_floor: 'at floor',
  paused: 'paused',
};

/* ── main component ─────────────────────────────────────────────────── */

const LiquidationCampaignScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { getToken } = useAuth();
  const isTabRootEntry = route?.name === 'Clearouts' || (route.params as any)?.entryPoint === 'tab';
  const initialCampaignId = (route.params as any)?.campaignId as string | undefined;

  const getTokenRef = useRef(getToken);
  useEffect(() => { getTokenRef.current = getToken; }, [getToken]);

  const adapter = useMemo(
    () => new HybridConversationDataAdapter({
      getClerkToken: () => getTokenRef.current({ template: CONVEX_TEMPLATE }).catch(async () => getTokenRef.current()),
    }),
    [],
  );

  const controller = useLiquidationConversationController({ adapter, initialCampaignId });

  /* ── local state ──────────────────────────────────────────────────── */
  const [isConfigSheetOpen, setIsConfigSheetOpen] = useState(false);
  const [configCampaignTarget, setConfigCampaignTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameTarget, setRenameTarget] = useState<null | { kind: 'thread' | 'campaign'; id: string; title: string }>(null);
  const [renameValue, setRenameValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const [headerH, setHeaderH] = useState(104);
  const [platformFilter, setPlatformFilter] = useState('All');
  const [showAddChooser, setShowAddChooser] = useState(false);

  // Items table
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isRepriceSheetOpen, setIsRepriceSheetOpen] = useState(false);
  const [isFloorSheetOpen, setIsFloorSheetOpen] = useState(false);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<CampaignItem | null>(null);
  const [repriceValue, setRepriceValue] = useState('');
  const [repriceDropPct, setRepriceDropPct] = useState<number | null>(10);
  const [floorValue, setFloorValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // We load actual inventory rather than mock data. Our current controller doesn't output the raw products
  // natively attached to the mock UI, so we will use the `activeCampaign` guardrails as a proxy to fetch
  // product details or handle them. For now, we will simulate the list from `controller.campaignConfig?.productIds`
  // if an API adapter method isn't explicitly exposing `fetchProducts`.
  // Note: The mock items here are removed in favor of fetching real ones.
  const [items, setItems] = useState<any[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  const loadItems = useCallback(async () => {
    if (!initialCampaignId) return;
    setLoadingItems(true);
    try {
      const fetched = await adapter.getCampaignItems(initialCampaignId);
      // Defensive de-dupe so the same item never renders twice (by item id, then by the
      // underlying product/variant id) even if the backend ever returns overlapping rows.
      const seen = new Set<string>();
      const unique = fetched.filter((it: any) => {
        const key = String(it.id || it.productId || '');
        const vkey = it.productId ? `v:${it.productId}` : '';
        if (seen.has(key) || (vkey && seen.has(vkey))) return false;
        seen.add(key);
        if (vkey) seen.add(vkey);
        return true;
      });
      setItems(unique);
    } catch {
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, [adapter, initialCampaignId]);

  // Reload items whenever the screen regains focus (e.g. after picking items).
  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems]),
  );

  const itemCount = items.length;
  const hasPendingAsks = (controller.campaignOverview?.needsInput?.length || 0) > 0;
  const latestAsk = controller.campaignOverview?.needsInput?.[0];
  const soldCount = controller.campaignOverview?.summary24h?.sold || 0;
  const totalCount = itemCount;
  const progressPct = totalCount > 0 ? Math.round((soldCount / totalCount) * 100) : 0;

  /* ── handlers ─────────────────────────────────────────────────────── */

  const confirmThen = (title: string, msg: string, onConfirm: () => void) => {
    Alert.alert(title, msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', onPress: onConfirm }]);
  };

  const sendAction = (actionType: string, title: string, payload?: Record<string, unknown>) => {
    controller.dispatchAction({ actionType, title, payload }).catch(() => controller.setNotice(null));
  };

  const openAddChooser = () => setShowAddChooser(true);

  const addFromInventory = () => {
    setShowAddChooser(false);
    const cam = controller.activeCampaign;
    const cid = initialCampaignId || cam?.id;
    if (!cid) return;
    navigation.navigate('CampaignInventorySelect', { campaignId: cid, title: cam?.title || 'Clearout' });
  };

  const addNewProduct = () => {
    setShowAddChooser(false);
    navigation.navigate('AddProduct');
  };

  // Per-platform filter chips, derived from the items' channels
  const platforms = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      String(it.channels || '').split(/[·,]/).map(s => s.trim()).filter(Boolean).forEach(p => set.add(p));
    }
    return Array.from(set);
  }, [items]);

  const visibleItems = useMemo(() => {
    let list = items;
    if (platformFilter !== 'All') {
      list = list.filter(it => String(it.channels || '').toLowerCase().includes(platformFilter.toLowerCase()));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) list = list.filter(it => String(it.name || '').toLowerCase().includes(q));
    return list;
  }, [items, platformFilter, searchQuery]);

  const openCampaignConfig = async (campaignId: string, title: string) => {
    setConfigCampaignTarget({ id: campaignId, title });
    controller.setActiveCampaignId(campaignId);
    controller.setCampaignConfig(null);
    setIsConfigSheetOpen(true);
    try { await controller.loadCampaignDetails(campaignId); }
    catch (e: any) { Alert.alert('Could not load settings', e?.message || 'Unable to load'); }
  };

  const deleteCampaign = (campaignId: string, title: string) => {
    confirmThen('Delete campaign', `Delete "${title}"?`, () => {
      controller.deleteCampaign(campaignId).catch((e: any) => Alert.alert('Delete failed', e?.message || 'Unable'));
      navigation.goBack();
    });
  };

  const saveConfig = async () => {
    const campaignId = configCampaignTarget?.id || controller.activeCampaignId;
    if (!campaignId || !controller.campaignConfig) return;
    try {
      const updated = await adapter.updateCampaignConfig(campaignId, {
        targetRevenue: controller.campaignConfig.targetRevenue,
        timeframeDays: controller.campaignConfig.timeframeDays,
        aggressiveness: controller.campaignConfig.aggressiveness,
        inventoryScope: controller.campaignConfig.inventoryScope,
        poolId: controller.campaignConfig.poolId,
        productIds: controller.campaignConfig.productIds,
        guardrails: controller.campaignConfig.guardrails,
      });
      controller.setCampaignConfig(updated);
      setIsConfigSheetOpen(false);
      setConfigCampaignTarget(null);
      controller.setNotice('Settings updated');
      await controller.loadCampaignDetails(campaignId);
    } catch (e: any) { Alert.alert('Save failed', e?.message || 'Failed'); }
  };

  const openRename = (kind: 'thread' | 'campaign', id: string, title: string) => {
    setRenameTarget({ kind, id, title });
    setRenameValue(title);
  };

  const submitRename = async () => {
    const title = renameValue.trim();
    if (!renameTarget || !title) return;
    try {
      if (renameTarget.kind === 'thread') {
        await controller.renameThread(renameTarget.id, title);
      } else {
        await controller.renameCampaign(renameTarget.id, title);
      }
      controller.setNotice('Renamed');
      setRenameTarget(null);
      setRenameValue('');
    } catch (e: any) { Alert.alert('Rename failed', e?.message || 'Unable'); }
  };

  // Items table handlers
  const toggleItem = (id: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === items.length && items.length > 0) setSelectedItems(new Set());
    else setSelectedItems(new Set(items.map(i => i.id)));
  };

  // After a mutation, clear the selection, refresh the list, and surface a notice.
  const reloadAfter = useCallback(async (msg: string) => {
    setSelectedItems(new Set());
    await loadItems();
    controller.setNotice(msg);
  }, [loadItems, controller]);

  const pauseItems = useCallback(async (ids: string[]) => {
    const cid = initialCampaignId;
    if (!cid || ids.length === 0) return;
    try {
      const { updated } = await adapter.updateCampaignItems(cid, ids, { status: 'paused' });
      await reloadAfter(`Paused ${updated} item${updated === 1 ? '' : 's'}`);
    } catch (e: any) {
      Alert.alert('Could not pause', e?.message || 'Please try again.');
    }
  }, [adapter, initialCampaignId, reloadAfter]);

  const removeItems = useCallback(async (ids: string[]) => {
    const cid = initialCampaignId;
    if (!cid || ids.length === 0) return;
    try {
      const { removed } = await adapter.removeCampaignItems(cid, ids);
      await reloadAfter(`Removed ${removed} item${removed === 1 ? '' : 's'}`);
    } catch (e: any) {
      Alert.alert('Could not remove', e?.message || 'Please try again.');
    }
  }, [adapter, initialCampaignId, reloadAfter]);

  const confirmRemoveItems = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    confirmThen(
      'Remove items',
      `Remove ${ids.length} item${ids.length === 1 ? '' : 's'} from this clearout? The product stays in your inventory.`,
      () => { void removeItems(ids); },
    );
  }, [removeItems]);

  const applyReprice = useCallback(async (ids: string[]) => {
    const cid = initialCampaignId;
    if (!cid || ids.length === 0) return;
    try {
      const flat = parseFloat(repriceValue);
      if (Number.isFinite(flat) && flat > 0) {
        // Flat new price for every selected item.
        await adapter.updateCampaignItems(cid, ids, { price: Math.round(flat * 100) / 100 });
      } else if (repriceDropPct != null) {
        // Percentage drop starts from each item's own price (clamped to its floor), so items
        // can land on different targets. Group by the computed price and issue one call per
        // distinct price instead of one per item.
        const byId = new Map(items.map((it: any) => [it.id, it]));
        const idsByPrice = new Map<number, string[]>();
        for (const id of ids) {
          const it: any = byId.get(id);
          const cur = Number(it?.currentPrice || 0);
          if (!cur) continue;
          let next = Math.round(cur * (1 - repriceDropPct / 100) * 100) / 100;
          const floor = Number(it?.floorPrice || 0);
          if (floor && next < floor) next = floor;
          const bucket = idsByPrice.get(next);
          if (bucket) bucket.push(id); else idsByPrice.set(next, [id]);
        }
        await Promise.all(
          Array.from(idsByPrice.entries()).map(([price, groupIds]) =>
            adapter.updateCampaignItems(cid, groupIds, { price }),
          ),
        );
      } else {
        Alert.alert('Enter a new price or pick a drop %');
        return;
      }
      setIsRepriceSheetOpen(false);
      await reloadAfter(`Repriced ${ids.length} item${ids.length === 1 ? '' : 's'}`);
    } catch (e: any) {
      Alert.alert('Could not reprice', e?.message || 'Please try again.');
    }
  }, [adapter, initialCampaignId, repriceValue, repriceDropPct, items, reloadAfter]);

  const applyFloor = useCallback(async (ids: string[]) => {
    const cid = initialCampaignId;
    if (!cid || ids.length === 0) return;
    const floor = parseFloat(floorValue);
    if (!Number.isFinite(floor) || floor <= 0) { Alert.alert('Enter a floor price'); return; }
    try {
      await adapter.updateCampaignItems(cid, ids, { floorPrice: Math.round(floor * 100) / 100 });
      setIsFloorSheetOpen(false);
      await reloadAfter(`Floor set on ${ids.length} item${ids.length === 1 ? '' : 's'}`);
    } catch (e: any) {
      Alert.alert('Could not set floor', e?.message || 'Please try again.');
    }
  }, [adapter, initialCampaignId, floorValue, reloadAfter]);

  const openItemDetail = (item: CampaignItem) => {
    setDetailItem(item);
    setIsDetailSheetOpen(true);
  };

  const handleItemRowPress = (item: CampaignItem) => {
    if (selectedItems.size > 0) toggleItem(item.id);
    // CampaignItem.productId holds the ProductVariantId, which is what ProductDetail loads by.
    else navigation.navigate('ProductDetail', { productId: item.productId });
  };

  const handleEllipsis = () => setMenuOpen(open => !open);

  /* ── render ───────────────────────────────────────────────────────── */

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="dark-content" />
      <KeyboardAvoidingView
        style={s.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 72 : 0}
      >
        {/* ── Main content (scrolls under the floating glass header) ── */}
        {controller.loading ? (
          <View style={[s.loadingWrap, { paddingTop: headerH }]}>
            <ActivityIndicator size="large" color={BRAND_PRIMARY} />
            <Text style={s.loadingText}>Loading...</Text>
          </View>
        ) : (
          <View style={s.container}>
            {/* Search + add row */}
            <View style={[s.searchRow, { paddingTop: headerH + 4 }]}>
              <View style={s.searchBox}>
                <Search size={18} color="#9CA3AF" />
                <TextInput
                  style={s.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search items"
                  placeholderTextColor="#9CA3AF"
                  returnKeyType="search"
                />
                {searchQuery ? (
                  <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <X size={16} color="#9CA3AF" />
                  </TouchableOpacity>
                ) : null}
              </View>
              <TouchableOpacity style={s.addBtn} onPress={openAddChooser} activeOpacity={0.85}>
                <Plus size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* Per-platform filter chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={s.filterScroll}
              contentContainerStyle={s.filterRow}
            >
              {['All', ...platforms].map(p => {
                const active = platformFilter === p;
                const count = p === 'All'
                  ? items.length
                  : items.filter(it => String(it.channels || '').toLowerCase().includes(p.toLowerCase())).length;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[s.filterChip, active && s.filterChipActive]}
                    onPress={() => setPlatformFilter(p)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.filterChipText, active && s.filterChipTextActive]}>{p}</Text>
                    <Text style={[s.filterCount, active && s.filterCountActive]}>{count}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <FlatList
              data={visibleItems}
              keyExtractor={item => item.id}
              contentContainerStyle={{ paddingHorizontal: 6, paddingTop: 4, paddingBottom: selectedItems.size > 0 ? 200 : 120 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={s.emptyState}>
                  <Text style={s.emptyStateText}>
                    {searchQuery || platformFilter !== 'All' ? 'No items match.' : 'No items in this clearout yet.'}
                  </Text>
                  <TouchableOpacity style={s.emptyAddBtn} onPress={openAddChooser}>
                    <Plus size={16} color="#FFFFFF" />
                    <Text style={s.emptyAddBtnText}>Add items</Text>
                  </TouchableOpacity>
                </View>
              }
              renderItem={({ item }) => {
                const sel = selectedItems.has(item.id);
                // Channels string ("shopify, amazon") → platform avatar names.
                const platformNames = String(item.channels || '')
                  .split(/[,/|]+|\s+/)
                  .map(p => p.trim())
                  .filter(Boolean);
                return (
                  <InventoryListCard
                    id={item.id}
                    title={item.name || 'Unknown item'}
                    price={item.currentPrice}
                    sku={item.sku}
                    imageUrl={item.imageUrl}
                    totalQuantity={item.totalQuantity}
                    platformNames={platformNames}
                    lastSyncedAt={item.lastSyncedAt}
                    isStale={item.isStale}
                    isSelectionMode={selectedItems.size > 0}
                    isSelected={sel}
                    onPress={() => handleItemRowPress(item)}
                    onLongPress={() => toggleItem(item.id)}
                  />
                );
              }}
            />

            {/* Bulk action bar — sits ABOVE the floating tab bar (TAB_ROW_HEIGHT 64 +
                bottom inset) so its buttons are tappable, instead of being hidden behind the
                app navigator. Mirrors the fix already in InventoryOrdersScreen. */}
            {selectedItems.size > 0 ? (
              <View style={[s.bulkBar, { bottom: Math.max(18, insets.bottom) + 64 + 10 }]}>
                <TouchableOpacity style={[s.baBtn, s.baPrimary]} onPress={() => { setRepriceValue(''); setIsRepriceSheetOpen(true); }}>
                  <Text style={s.baBtnText}>Reprice</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.baBtn, s.baDefault]} onPress={() => { setFloorValue(''); setIsFloorSheetOpen(true); }}>
                  <Text style={s.baBtnText}>Set floor</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.baBtn, s.baDefault]} onPress={() => pauseItems(Array.from(selectedItems))}>
                  <Text style={s.baBtnText}>Pause</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.baBtn, s.baDanger]} onPress={() => confirmRemoveItems(Array.from(selectedItems))}>
                  <Text style={[s.baBtnText, { color: '#A32D2D' }]}>Remove</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        )}

        {/* ── Footer ─────────────────────────── */}
        <View style={s.footerStack}>
          {controller.error ? (
            <View style={s.errorBanner}>
              <AlertCircle size={14} color="#EF4444" />
              <Text style={s.errorText}>{controller.error}</Text>
              <TouchableOpacity onPress={controller.onRefresh}><Text style={s.errorRetry}>Retry</Text></TouchableOpacity>
            </View>
          ) : null}
          {controller.notice ? (
            <View style={s.noticeBanner}>
              <CheckCircle2 size={14} color="#5D7E16" />
              <Text style={s.noticeText}>{controller.notice}</Text>
              <TouchableOpacity onPress={() => controller.setNotice(null)}>
                <X size={14} color="#5D7E16" />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        {/* ── Floating glass header (matches the chat) ──────────────── */}
        <View
          style={[s.header, { paddingTop: 6 }]}
          onLayout={e => setHeaderH(e.nativeEvent.layout.height)}
        >
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <BlurView intensity={Platform.OS === 'ios' ? 24 : 14} tint="light" style={StyleSheet.absoluteFill} />
            <LinearGradient
              colors={['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
              locations={[0, 0.55, 1]}
              style={StyleSheet.absoluteFill}
            />
          </View>
          <View style={s.headerRow}>
            <TouchableOpacity style={s.navCircle} onPress={() => navigation.goBack()} activeOpacity={0.85}>
              <ChevronLeft size={22} color="#18181B" />
            </TouchableOpacity>

            <View style={s.titlePill}>
              <Text style={s.pillTitle} numberOfLines={1}>{controller.activeCampaign?.title || 'Campaign'}</Text>
              <Text style={s.pillSub} numberOfLines={1}>
                {soldCount}/{totalCount} sold · {controller.campaignConfig?.aggressiveness || 'balanced'}
              </Text>
            </View>

            <TouchableOpacity style={s.chatPill} onPress={handleEllipsis} activeOpacity={0.85}>
              <Menu size={16} color="#18181B" />
              <Text style={s.chatPillText}>Chat</Text>
            </TouchableOpacity>
          </View>

          {hasPendingAsks && latestAsk ? (
            <TouchableOpacity
              style={s.ambientTray}
              activeOpacity={0.85}
              onPress={() => { if (latestAsk.threadId) controller.openThread(latestAsk.threadId); }}
            >
              <View style={s.trayDot} />
              <Text style={s.trayText} numberOfLines={1}>{latestAsk.title} needs you</Text>
              <Text style={s.trayAction}>Review</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {/* ── Clean dropdown menu (Items / Settings / Rename / Delete) ── */}
      {menuOpen ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMenuOpen(false)} />
          <View style={[s.dropdown, { top: insets.top + 64 }]}>
            <View style={s.dropItem}>
              <Box size={18} color="#43631A" />
              <Text style={[s.dropText, { color: '#43631A' }]}>Items</Text>
              <View style={{ flex: 1 }} />
              <Check size={17} color="#43631A" />
            </View>
            <View style={s.dropDivider} />
            <TouchableOpacity style={s.dropItem} activeOpacity={0.7}
              onPress={() => { const cam = controller.activeCampaign; setMenuOpen(false); navigation.navigate('CampaignThreadScreen', { campaignId: cam?.id, title: cam?.title }); }}>
              <MessageSquare size={18} color="#3F3F46" />
              <Text style={s.dropText}>Chat</Text>
            </TouchableOpacity>
            <View style={s.dropDivider} />
            <TouchableOpacity style={s.dropItem} activeOpacity={0.7}
              onPress={() => { const cam = controller.activeCampaign; setMenuOpen(false); navigation.navigate('CampaignSettings', { campaignId: cam?.id, title: cam?.title }); }}>
              <SettingsIcon size={18} color="#3F3F46" />
              <Text style={s.dropText}>Settings</Text>
            </TouchableOpacity>
            <View style={s.dropDivider} />
            <TouchableOpacity style={s.dropItem} activeOpacity={0.7}
              onPress={() => { const cam = controller.activeCampaign; setMenuOpen(false); if (cam) openRename('campaign', cam.id, cam.title); }}>
              <Pencil size={18} color="#3F3F46" />
              <Text style={s.dropText}>Rename</Text>
            </TouchableOpacity>
            <View style={s.dropDivider} />
            <TouchableOpacity style={s.dropItem} activeOpacity={0.7}
              onPress={() => { const cam = controller.activeCampaign; setMenuOpen(false); if (cam) deleteCampaign(cam.id, cam.title); }}>
              <Trash2 size={18} color="#DC2626" />
              <Text style={[s.dropText, { color: '#DC2626' }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* ═══════════════ MODALS ═══════════════════════════════════════ */}

      {/* Add-items chooser */}
      <Modal visible={showAddChooser} transparent animationType="fade" onRequestClose={() => setShowAddChooser(false)}>
        <View style={s.chooserRoot}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowAddChooser(false)} />
          <View style={[s.chooserSheet, { paddingBottom: insets.bottom + 14 }]}>
            <View style={s.chooserHandle} />
            <Text style={s.chooserTitle}>Add items to this clearout</Text>
            <TouchableOpacity style={s.chooserOption} onPress={addFromInventory} activeOpacity={0.8}>
              <View style={s.chooserIcon}><Box size={22} color="#43631A" /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.chooserOptTitle}>Select from inventory</Text>
                <Text style={s.chooserOptSub}>Pick from products you already have</Text>
              </View>
              <ChevronRight size={18} color="#A1A1AA" />
            </TouchableOpacity>
            <View style={s.chooserDivider} />
            <TouchableOpacity style={s.chooserOption} onPress={addNewProduct} activeOpacity={0.8}>
              <View style={s.chooserIcon}><PlusCircle size={22} color="#43631A" /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.chooserOptTitle}>Add a new product</Text>
                <Text style={s.chooserOptSub}>Scan or create one, then add it here</Text>
              </View>
              <ChevronRight size={18} color="#A1A1AA" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Config sheet */}
      <Modal visible={isConfigSheetOpen} transparent animationType="fade"
        onRequestClose={() => { setIsConfigSheetOpen(false); setConfigCampaignTarget(null); }}>
        <View style={s.sheetBackdrop}>
          <Pressable style={s.sheetBackdropTap} onPress={() => { setIsConfigSheetOpen(false); setConfigCampaignTarget(null); }} />
          <View style={s.sheetPanel}>
            <Text style={s.sheetTitle}>Campaign settings</Text>
            <Text style={s.sheetHint}>{configCampaignTarget?.title || controller.activeCampaign?.title || 'Selected'}</Text>
            <ConfigInput label="Target revenue" value={String(controller.campaignConfig?.targetRevenue || '')}
              onChangeText={v => controller.setCampaignConfig(prev => prev ? ({ ...prev, targetRevenue: Number(v || 0) }) : prev)} />
            <ConfigInput label="Timeline (days)" value={String(controller.campaignConfig?.timeframeDays || '')}
              onChangeText={v => controller.setCampaignConfig(prev => prev ? ({ ...prev, timeframeDays: Number(v || 0) }) : prev)} />
            <ConfigInput label="Aggressiveness" value={controller.campaignConfig?.aggressiveness || 'balanced'}
              onChangeText={v => controller.setCampaignConfig(prev => prev ? ({ ...prev, aggressiveness: (v || 'balanced').toLowerCase() as any }) : prev)} />
            <ConfigInput label="Min offer (%)" value={String(controller.campaignConfig?.guardrails.minAcceptableOfferPercent || '')}
              onChangeText={v => controller.setCampaignConfig(prev => prev ? ({ ...prev, guardrails: { ...prev.guardrails, minAcceptableOfferPercent: Number(v || 0) } }) : prev)} />
            <ConfigInput label="Max drop (%)" value={String(controller.campaignConfig?.guardrails.maxAutoPriceDropPercent || '')}
              onChangeText={v => controller.setCampaignConfig(prev => prev ? ({ ...prev, guardrails: { ...prev.guardrails, maxAutoPriceDropPercent: Number(v || 0) } }) : prev)} />
            <TouchableOpacity style={s.primaryBtn} onPress={saveConfig}><Text style={s.primaryBtnText}>Save settings</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Rename */}
      <Modal visible={!!renameTarget} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
        <View style={s.renameBackdrop}>
          <Pressable style={s.sheetBackdropTap} onPress={() => setRenameTarget(null)} />
          <View style={s.renamePanel}>
            <Text style={s.sheetTitle}>Rename</Text>
            <TextInput style={s.configInput} value={renameValue} onChangeText={setRenameValue} autoFocus placeholderTextColor="#9CA3AF" />
            <View style={s.rowActions}>
              <TouchableOpacity style={[s.secondaryBtn, { flex: 1 }]} onPress={() => setRenameTarget(null)}>
                <Text style={s.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.primaryBtn, { flex: 1 }]} onPress={submitRename}>
                <Text style={s.primaryBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Reprice sheet */}
      <Modal visible={isRepriceSheetOpen} transparent animationType="fade" onRequestClose={() => setIsRepriceSheetOpen(false)}>
        <View style={s.sheetBackdrop}>
          <Pressable style={s.sheetBackdropTap} onPress={() => setIsRepriceSheetOpen(false)} />
          <View style={s.sheetPanel}>
            <Text style={s.sheetTitle}>Reprice {selectedItems.size} items</Text>
            <Text style={s.sheetHint}>Set a new price or drop by percentage</Text>
            <ConfigInput label="NEW PRICE" value={repriceValue} onChangeText={setRepriceValue} />
            <Text style={[s.configLabel, { marginTop: 8 }]}>OR DROP BY</Text>
            <View style={s.pctRow}>
              {[5, 10, 15, 20].map(p => (
                <TouchableOpacity key={p} style={[s.pctOpt, repriceDropPct === p && s.pctOptSel]} onPress={() => setRepriceDropPct(p)}>
                  <Text style={[s.pctOptText, repriceDropPct === p && s.pctOptTextSel]}>{p}%</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={s.primaryBtn} onPress={() => applyReprice(Array.from(selectedItems))}>
              <Text style={s.primaryBtnText}>Apply to selected</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Floor sheet */}
      <Modal visible={isFloorSheetOpen} transparent animationType="fade" onRequestClose={() => setIsFloorSheetOpen(false)}>
        <View style={s.sheetBackdrop}>
          <Pressable style={s.sheetBackdropTap} onPress={() => setIsFloorSheetOpen(false)} />
          <View style={s.sheetPanel}>
            <Text style={s.sheetTitle}>Override floor</Text>
            <Text style={s.sheetHint}>Overrides campaign-level floor for these items only.</Text>
            <ConfigInput label="FLOOR PRICE" value={floorValue} onChangeText={setFloorValue} />
            <TouchableOpacity style={s.primaryBtn} onPress={() => applyFloor(Array.from(selectedItems))}>
              <Text style={s.primaryBtnText}>Set floor</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Item detail sheet */}
      <Modal visible={isDetailSheetOpen} transparent animationType="fade" onRequestClose={() => setIsDetailSheetOpen(false)}>
        <View style={s.sheetBackdrop}>
          <Pressable style={s.sheetBackdropTap} onPress={() => setIsDetailSheetOpen(false)} />
          <View style={s.sheetPanel}>
            {detailItem ? (
              <>
                <View style={s.detailTopRow}>
                  <View style={s.detailThumb}><Text style={{ fontSize: 26 }}>{detailItem.emoji || '📦'}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.detailName}>{detailItem.name}</Text>
                    <Text style={s.detailCh}>{detailItem.channels} · <Text style={{ color: STATUS_STYLE[detailItem.status].fg }}>{STATUS_LABEL[detailItem.status]}</Text></Text>
                  </View>
                </View>
                <View style={s.priceHist}>
                  <Text style={s.configLabel}>PRICE HISTORY</Text>
                  {(detailItem.priceHistory || [{ date: 'Today', price: detailItem.currentPrice, reason: 'current' }]).map((h, i) => (
                    <View key={i} style={s.phRow}>
                      <Text style={s.phDate}>{h.date}</Text>
                      <Text style={s.phPrice}>${h.price}</Text>
                      <Text style={s.phReason}>{h.reason}</Text>
                    </View>
                  ))}
                </View>
                <View style={s.chStatus}>
                  {detailItem.channels.split(' · ').map(ch => (
                    <View key={ch} style={[s.chPill, s.chPillLive]}><Text style={s.chPillText}>{ch} · live</Text></View>
                  ))}
                  <View style={s.chPill}><Text style={s.chPillText}>Craigslist · not listed</Text></View>
                </View>
                <View style={s.detailActions}>
                  <TouchableOpacity style={[s.daBtn, s.daBtnPrimary]} onPress={() => { setIsDetailSheetOpen(false); setRepriceValue(''); setSelectedItems(new Set([detailItem.id])); setIsRepriceSheetOpen(true); }}>
                    <Text style={s.daBtnText}>Reprice</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.daBtn} onPress={() => { setIsDetailSheetOpen(false); setFloorValue(''); setSelectedItems(new Set([detailItem.id])); setIsFloorSheetOpen(true); }}>
                    <Text style={s.daBtnText}>Set floor</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.daBtn} onPress={() => { const id = detailItem.id; setIsDetailSheetOpen(false); confirmRemoveItems([id]); }}>
                    <Text style={s.daBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

/* ── helper components ──────────────────────────────────────────────── */

const ConfigInput = ({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) => (
  <View style={s.configField}>
    <Text style={s.configLabel}>{label}</Text>
    <TextInput style={s.configInput} value={value} onChangeText={onChangeText} placeholderTextColor="#9CA3AF" />
  </View>
);

/* ── styles ─────────────────────────────────────────────────────────── */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },

  // Floating glass header (matches the chat)
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  navCircle: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  titlePill: {
    flexShrink: 1, alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  titlePillRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pillTitle: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_700Bold' },
  pillSub: { fontSize: 12, color: '#71717A', marginTop: 1, fontFamily: 'Inter_500Medium' },
  chatPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 9,
    shadowColor: '#000', shadowOpacity: 0.10, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  chatPillText: { fontSize: 14, color: '#18181B', fontFamily: 'Inter_600SemiBold' },

  // Ambient "needs you" tray (floats under the pills)
  ambientTray: {
    marginTop: 8, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(250,253,245,0.97)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  trayDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#BA7517' },
  trayText: { fontSize: 12, color: '#3B6D11', fontFamily: 'Inter_500Medium' },
  trayAction: { fontSize: 12, color: '#BA7517', fontFamily: 'Inter_600SemiBold' },

  // Loading
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: '#71717A', fontFamily: 'Inter_500Medium', fontSize: 13 },

  // Controls row
  controlsRow: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  ctrlBtn: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 10, borderWidth: 0.5, borderColor: '#E5E5E5', backgroundColor: '#F9FAFB' },
  ctrlBtnText: { fontSize: 11, color: '#71717A', fontFamily: 'Inter_500Medium' },
  selCount: { fontSize: 11, color: '#3B6D11', fontWeight: '500' },

  // Search + add row
  searchRow: { paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBox: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F4F4F1', borderRadius: 24, paddingHorizontal: 16, height: 48 },
  searchInput: { flex: 1, fontSize: 15, color: '#18181B', fontFamily: 'Inter_500Medium', paddingVertical: 0 },
  addBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#18181B', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 },

  // Per-platform filter chips
  filterScroll: { flexGrow: 0, flexShrink: 0 },
  filterRow: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, gap: 8, flexDirection: 'row', alignItems: 'center' },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F1F2EE' },
  filterChipActive: { backgroundColor: '#18181B' },
  filterChipText: { fontSize: 13, color: '#52525B', fontFamily: 'Inter_600SemiBold' },
  filterChipTextActive: { color: '#FFFFFF' },
  filterCount: { fontSize: 12, color: '#9CA3AF', fontFamily: 'Inter_600SemiBold' },
  filterCountActive: { color: 'rgba(255,255,255,0.7)' },

  // Add-items chooser
  chooserRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  chooserSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 10 },
  chooserHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E7', marginBottom: 14 },
  chooserTitle: { fontSize: 18, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 8, paddingHorizontal: 4 },
  chooserOption: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 4 },
  chooserDivider: { height: 1, backgroundColor: '#F1F1EE', marginLeft: 62 },
  chooserIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(147,200,34,0.14)', alignItems: 'center', justifyContent: 'center' },
  chooserOptTitle: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold', marginBottom: 2 },
  chooserOptSub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular' },

  // Items list
  emptyState: { padding: 40, alignItems: 'center', gap: 16 },
  emptyStateText: { color: '#9CA3AF', fontSize: 13, fontFamily: 'Inter_500Medium' },
  emptyAddBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#93C822', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12 },
  emptyAddBtnText: { color: '#FFFFFF', fontFamily: 'Inter_700Bold', fontSize: 13 },
  addItemsBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#eaf3de', borderWidth: 0.5, borderColor: '#97C459', paddingHorizontal: 11, paddingVertical: 5, borderRadius: 10 },
  addItemsBtnText: { fontSize: 11, color: '#3B6D11', fontFamily: 'Inter_600SemiBold' },
  cb: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center' },
  cbChecked: { backgroundColor: '#639922', borderColor: '#639922' },

  // Clean Shop-style item rows
  itemSep: { height: 1, backgroundColor: '#F1F1EE', marginLeft: 76 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 6 },
  itemRowSel: { backgroundColor: 'rgba(132,204,22,0.08)', borderRadius: 14 },
  itemThumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: '#F4F4F1', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)', overflow: 'hidden' },
  itemThumbImg: { width: '100%', height: '100%' },
  itemInfo: { flex: 1, marginLeft: 14, marginRight: 8 },
  itemTitle: { fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold', marginBottom: 3 },
  itemSub: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_400Regular' },
  itemChip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  itemChipText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  // Clean dropdown menu (centered under the title pill)
  dropdown: {
    position: 'absolute', left: '50%', marginLeft: -110, width: 220,
    backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 6,
    shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },
  dropItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  dropText: { color: '#27272A', fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  dropDivider: { height: 1, backgroundColor: '#F1F2EE', marginHorizontal: 12 },

  // Bulk action bar
  bulkBar: { position: 'absolute', bottom: 12, left: 12, right: 12, backgroundColor: '#FFF', borderWidth: 0.5, borderColor: '#D1D5DB', borderRadius: 14, padding: 10, flexDirection: 'row', gap: 6, flexWrap: 'wrap', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 2 }, elevation: 12, zIndex: 1000 },
  baBtn: { flex: 1, paddingVertical: 7, paddingHorizontal: 8, borderRadius: 10, borderWidth: 0.5, alignItems: 'center' },
  baPrimary: { borderColor: '#97C459', backgroundColor: '#eaf3de' },
  baDefault: { borderColor: '#D1D5DB', backgroundColor: '#F9FAFB' },
  baDanger: { borderColor: '#F7C1C1', backgroundColor: '#fcebeb' },
  baBtnText: { fontSize: 11, fontWeight: '500', color: '#111827' },

  // Footer
  footerStack: { backgroundColor: '#FFFFFF', paddingTop: 4 },
  footerStackLifted: { paddingBottom: 68 },
  errorBanner: { marginHorizontal: 12, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: '#FECACA', backgroundColor: '#FEF2F2', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { flex: 1, color: '#B91C1C', fontFamily: 'Inter_500Medium', fontSize: 12 },
  errorRetry: { color: '#DC2626', fontFamily: 'Inter_700Bold', fontSize: 12 },
  noticeBanner: { marginHorizontal: 12, marginTop: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(147,200,34,0.3)', backgroundColor: 'rgba(147,200,34,0.12)', paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  noticeText: { flex: 1, color: '#5D7E16', fontFamily: 'Inter_500Medium', fontSize: 12 },

  // Sheet common
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdropTap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.24)' },
  sheetPanel: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 28, maxHeight: '78%' },
  sheetTitle: { color: '#111827', fontFamily: 'Inter_700Bold', fontSize: 22 },
  sheetHint: { marginTop: 8, marginBottom: 12, color: '#71717A', fontFamily: 'Inter_500Medium', fontSize: 13 },



  // Buttons
  primaryBtn: { height: 48, borderRadius: 14, backgroundColor: BRAND_PRIMARY, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryBtnText: { color: '#1F2937', fontFamily: 'Inter_700Bold', fontSize: 14 },
  secondaryBtn: { height: 48, borderRadius: 14, borderWidth: 1, borderColor: '#D1D5DB', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  secondaryBtnText: { color: '#111827', fontFamily: 'Inter_700Bold', fontSize: 14 },
  rowActions: { flexDirection: 'row', gap: 12 },

  // Config
  configField: { marginBottom: 12 },
  configLabel: { marginBottom: 6, color: '#374151', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  configInput: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: '#D1D5DB', backgroundColor: '#FFF', paddingHorizontal: 12, color: '#111827', fontFamily: 'Inter_500Medium', fontSize: 14 },

  // Rename
  renameBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.24)' },
  renamePanel: { borderRadius: 24, backgroundColor: '#FFF', paddingHorizontal: 18, paddingTop: 18, paddingBottom: 22 },

  // Reprice pct
  pctRow: { flexDirection: 'row', gap: 7, marginTop: 6, marginBottom: 10 },
  pctOpt: { flex: 1, borderWidth: 0.5, borderColor: '#E5E5E5', borderRadius: 10, paddingVertical: 9, alignItems: 'center' },
  pctOptSel: { borderColor: '#97C459', backgroundColor: '#eaf3de' },
  pctOptText: { fontSize: 12, color: '#71717A' },
  pctOptTextSel: { color: '#3B6D11', fontWeight: '500' },

  // Detail sheet
  detailTopRow: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 12 },
  detailThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  detailName: { fontSize: 16, fontWeight: '500', color: '#111827' },
  detailCh: { fontSize: 12, color: '#71717A', marginTop: 2 },
  priceHist: { backgroundColor: '#F9FAFB', borderRadius: 11, padding: 10, marginBottom: 10 },
  phRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: '#F3F4F6' },
  phDate: { fontSize: 12, color: '#9CA3AF' },
  phPrice: { fontSize: 12, fontWeight: '500', color: '#111827' },
  phReason: { fontSize: 12, color: '#71717A' },
  chStatus: { flexDirection: 'row', gap: 7, flexWrap: 'wrap', marginBottom: 12 },
  chPill: { paddingHorizontal: 11, paddingVertical: 4, borderRadius: 10, borderWidth: 0.5, borderColor: '#E5E5E5' },
  chPillLive: { borderColor: '#97C459', backgroundColor: '#eaf3de' },
  chPillText: { fontSize: 11, color: '#71717A' },
  detailActions: { flexDirection: 'row', gap: 7 },
  daBtn: { flex: 1, paddingVertical: 10, borderRadius: 11, borderWidth: 0.5, borderColor: '#E5E5E5', alignItems: 'center' },
  daBtnPrimary: { backgroundColor: '#eaf3de', borderColor: '#97C459' },
  daBtnText: { fontSize: 12, fontWeight: '500', color: '#111827' },
});

export default LiquidationCampaignScreen;

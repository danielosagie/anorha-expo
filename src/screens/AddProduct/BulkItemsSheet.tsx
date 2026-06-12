import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, TextInput, StyleSheet, Dimensions, Modal, Pressable, ActivityIndicator, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, FadeIn } from 'react-native-reanimated';
import { PanGestureHandler, TapGestureHandler, State, Swipeable } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Camera as CameraIcon, RotateCcw } from 'lucide-react-native';
import spinners from 'unicode-animations';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { API_BASE_URL } from '../../config/env';
import BottomActionBar from '../../components/BottomActionBar';
import { CapturedPhoto } from '../../components/camera/PhotoStack';
import { ShelfScanPlaceholderRow, ShelfScanProgressCard } from '../../components/camera/ShelfScanProgressCard';
import { UnicodeSpinner } from './UnicodeSpinner';
import { getShelfProgressPresentation } from './utils';
import { MatchResponse, JobResponse, QuickMatchSelection, ItemLoadingState, ShelfProgressState, UnicodeSpinnerDefinition } from './types';
import type { CartTreeNode } from './hooks/useBulkItems';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAX_BATCH_ITEMS = 100;

export const BulkItemsSheet: React.FC<{
  onClose: () => void;
  onStartBroadSearch: () => void;
  sheetStyle: any;
  photos: CapturedPhoto[];
  isBulkMode: boolean;
  bulkItems: Array<{ id: string; photos: CapturedPhoto[]; title?: string; isActive?: boolean; preSelectedSource?: any; quantity?: number; }>;
  activeItemId: string | null;
  onAddNewItem: () => void;
  onImageUpload: () => void;
  setJobResponse: (jobResponse: JobResponse | null) => void;
  onDeleteItem: (itemId: string) => void;
  onMovePhoto: (fromItemId: string, toItemId: string, photoId: string) => void;
  onSelectItem: (itemId: string) => void;
  onSetCoverPhoto: (itemId: string, photoId: string) => void;
  onRemovePhoto: (itemId: string, photoId: string) => void;
  performAnalyze: (
    firstPhotos: CapturedPhoto[],
    quickMatchHintsByItemId?: Record<string, QuickMatchSelection>,
    itemsForAnalyze?: Array<{ id: string }>,
  ) => Promise<any>;
  sheetTranslateY: any;
  jobResponse: JobResponse | null;
  navigation: any;
  quickScanStore?: Record<string, { matchData: MatchResponse; serpApiData: any[] }>;
  onOpenQuickMatches?: (itemId: string) => void;
  onOpenItemPreview?: (itemId: string) => void;
  cartTree?: CartTreeNode[];
  onOpenFolder?: (folderId: string) => void;
  /** Queue items for in-place async generation instead of navigating to LoadingScreen. */
  onQueueGeneration?: (itemJobs: Array<{ itemId: string; jobId: string; processType: 'generate' | 'match' }>) => void;
  onRetryItemScan?: (itemId: string) => void;
  onOpenPhotoModal?: (itemId: string) => void;
  itemLoadingStates: Record<string, ItemLoadingState>;
  setItemLoadingStates: React.Dispatch<React.SetStateAction<Record<string, ItemLoadingState>>>;
  /** Flow stage per item (from AddProductScreen's state machine) — 'generated' marks done rows. */
  itemStageById?: Record<string, string>;
  confirmedQuickMatchByItemId?: Record<string, QuickMatchSelection>;
  connectedPlatformKeys?: string[];
  currentInstruction?: string | null;
  onOpenLocalMatch?: (itemId: string) => void;
  shelfPhotoUri?: string | null;
  shelfProgress?: ShelfProgressState;
  onRetryShelfScan?: () => void;
  onRetakeShelfScan?: () => void;
  onUpdateItemQuery?: (id: string, newQuery: string) => void;
  onUpdateItemTitle?: (id: string, newTitle: string) => void;
  onUpdateItemQuantity?: (id: string, quantity: number) => void;
  onSubmitItemsForProcessing?: (items: Array<{ id: string }>) => void;
  onSaveDraft?: () => void;
  cameraMode?: 'camera' | 'barcode' | 'manifest' | 'receipt' | 'shelf';
  /** Item ids set aside via "Save for later" (excluded from list/subtotal/checkout). */
  savedForLaterIds?: string[];
  onToggleSavedForLater?: (itemId: string, saved: boolean) => void;
  /** Open the Add-details page for an item that needs more context. */
  onOpenAddDetails?: (itemId: string) => void;
  /** Free-tier usage; when exhausted the cart doubles as the upgrade surface. */
  freemium?: { usageCount: number; freeLimit: number; exhausted: boolean } | null;
  onUpgrade?: () => void;
  onAddCredits?: () => void;
}> = ({ onClose, onStartBroadSearch, sheetStyle, photos, isBulkMode, bulkItems, activeItemId, onAddNewItem, onImageUpload, performAnalyze, onDeleteItem, onMovePhoto, onSelectItem, onSetCoverPhoto, onRemovePhoto, sheetTranslateY, navigation, setJobResponse, jobResponse, quickScanStore, onOpenQuickMatches, onOpenItemPreview, cartTree, onOpenFolder, onQueueGeneration, onRetryItemScan, onOpenPhotoModal, itemLoadingStates, setItemLoadingStates, itemStageById, confirmedQuickMatchByItemId = {}, connectedPlatformKeys = [], currentInstruction, onOpenLocalMatch, shelfPhotoUri, shelfProgress, onRetryShelfScan, onRetakeShelfScan, onUpdateItemQuery, onUpdateItemTitle, onUpdateItemQuantity, onSubmitItemsForProcessing, onSaveDraft, cameraMode = 'camera', savedForLaterIds, onToggleSavedForLater, onOpenAddDetails, freemium, onUpgrade, onAddCredits }) => {


  // SIMPLIFIED: Always use bulkItems (no more virtual items)
  let displayItems: Array<{ id: string; photos: CapturedPhoto[]; title?: string; isActive?: boolean; quantity?: number; }>;


  // Active cart = bulkItems minus the "Save for later" pile. Saved items render in
  // their own section and are excluded from counts, subtotal, select-all, and checkout
  // (everything downstream reads displayItems).
  const savedSet = new Set(savedForLaterIds ?? []);
  const savedItems = bulkItems.filter((i) => savedSet.has(i.id));
  displayItems = bulkItems.filter((i) => !savedSet.has(i.id));

  // One close per pull gesture on the items list.
  const pullCloseRef = useRef(false);

  // Multi-select: list "a few" vs "the whole cart". Empty set = list everything.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectionActive = selectedIds.size > 0;
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const toggleMany = (ids: string[], select: boolean) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      ids.forEach((id) => (select ? n.add(id) : n.delete(id)));
      return n;
    });

  // Render list: a shelf folder shows as a single card (tap → opens the folder page),
  // interleaved with single items. Falls back to the flat list when there are no folders.
  type RenderEntry =
    | { kind: 'folderCard'; id: string; label?: string; childCount: number; sourcePhotoUri?: string; childIds: string[] }
    | { kind: 'item'; item: { id: string; photos: CapturedPhoto[]; title?: string; isActive?: boolean; quantity?: number }; index: number };
  const renderList: RenderEntry[] = [];
  if (cartTree && cartTree.length > 0) {
    let idx = 0;
    for (const node of cartTree) {
      if (node.kind === 'folder') {
        renderList.push({ kind: 'folderCard', id: node.id, label: node.label, childCount: node.childCount, sourcePhotoUri: node.sourcePhotoUri, childIds: node.children.map((c) => c.id) });
      } else if (!savedSet.has(node.item.id)) {
        renderList.push({ kind: 'item', item: node.item, index: idx++ });
      }
    }
  } else {
    displayItems.forEach((item, i) => renderList.push({ kind: 'item', item, index: i }));
  }

  const totalItems = displayItems.length;
  // Subtotal = sum of matched prices × qty (for the Ruggable-style subtotal row).
  // Candidate price arrives as a number (ranked candidates) OR a serpApi object
  // ({ value, extracted_value, currency }) once a match is confirmed — accept both.
  const extractPrice = (p: any): number | undefined =>
    typeof p === 'number' ? p : typeof p?.extracted_value === 'number' ? p.extracted_value : undefined;
  const cartSubtotal = displayItems.reduce((sum, it) => {
    const conf = confirmedQuickMatchByItemId?.[it.id];
    const qs = quickScanStore?.[it.id];
    const cand: any = (conf?.serpApiData && conf.preSelectedIndices?.length)
      ? conf.serpApiData[conf.preSelectedIndices[0]]
      : qs?.matchData?.rankedCandidates?.[0];
    return sum + (extractPrice(cand?.price) ?? 0) * ((it as any).quantity ?? 1);
  }, 0);
  const [editingItemId, setEditingItemId] = React.useState<string | null>(null);
  const [editQueryText, setEditQueryText] = React.useState("");
  const [countDraftByItemId, setCountDraftByItemId] = React.useState<Record<string, string>>({});
  const insets = useSafeAreaInsets();

  useEffect(() => {
    setCountDraftByItemId(prev => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const item of bulkItems) {
        const existingDraft = prev[item.id];
        let nextValue: string;
        if (typeof existingDraft === 'string') {
          nextValue = existingDraft;
        } else {
          const quantity = item.quantity ?? 1;
          nextValue = String(quantity);
        }
        next[item.id] = nextValue;
        if (prev[item.id] !== nextValue) changed = true;
      }
      if (Object.keys(prev).length !== Object.keys(next).length) changed = true;
      return changed ? next : prev;
    });
  }, [bulkItems]);

  const handleCountDraftChange = useCallback((itemId: string, rawText: string) => {
    const sanitized = rawText
      .replace(',', '.')
      .replace(/[^0-9.]/g, '')
      .replace(/(\..*?)\..*/g, '$1');
    setCountDraftByItemId(prev => ({ ...prev, [itemId]: sanitized }));
  }, []);

  const commitCountDraft = useCallback((itemId: string) => {
    const draft = (countDraftByItemId[itemId] ?? '').trim();
    const parsed = Number.parseFloat(draft);
    const quantity = Number.isFinite(parsed) && parsed > 0 ? Number(parsed.toFixed(2)) : 1;

    setCountDraftByItemId(prev => ({ ...prev, [itemId]: String(quantity) }));
    onUpdateItemQuantity?.(itemId, quantity);
  }, [countDraftByItemId, onUpdateItemQuantity]);


  // Keep a tall, consistent sheet so actions never get clipped on smaller devices.
  const sheetMaxHeight = SCREEN_HEIGHT * 0.88;

  console.log('[SHEET LAYOUT] Heights calculated:', {
    screenHeight: SCREEN_HEIGHT,
    sheetMaxHeight,
  });
  const dynamicSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
    // Full-screen cart that rises from below: translateY 0 = fully covering, = open;
    // SCREEN_HEIGHT = off the bottom, = closed. Paired with the capture screen's
    // reachability lift in AddProductScreen so the two move as one connected piece.
    height: SCREEN_HEIGHT,
  }));

  const bottomMargin = Math.max(insets.bottom, 20);
  const shelfPresentation = shelfProgress ? getShelfProgressPresentation(shelfProgress) : null;
  const shouldShowShelfRetryActions = Boolean(
    shelfProgress && (shelfProgress.stalled || shelfProgress.status === 'no_items' || shelfProgress.status === 'timeout' || shelfProgress.status === 'error')
  );
  const activeBulkItemIds = new Set(displayItems.map((item) => item.id));
  const hasLoadingItems = Object.entries(itemLoadingStates || {}).some(([id, state]) => {
    const loadingState = state as ItemLoadingState;
    return loadingState.isLoading && activeBulkItemIds.has(id);
  });

  // "Scanned earlier this session": two cart rows whose best match resolves to
  // the same listing (same listing URL, else same normalized title). The LATER
  // row gets flagged so the user merges instead of silently listing a duplicate.
  // Cheap O(n) over the cart; recomputed per render on purpose.
  const sessionDupOwnerByItemId: Record<string, string> = {};
  {
    const firstByKey = new Map<string, string>();
    for (const it of displayItems) {
      const mi = confirmedQuickMatchByItemId?.[it.id];
      const confirmed = (mi && mi.serpApiData && mi.preSelectedIndices && mi.preSelectedIndices.length > 0)
        ? mi.serpApiData[mi.preSelectedIndices[0]]
        : null;
      const m: any = confirmed || quickScanStore?.[it.id]?.matchData?.rankedCandidates?.[0];
      if (!m) continue;
      const url = String(m.productUrl || m.link || m.sourceUrl || '').trim().toLowerCase();
      const title = String(m.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
      const key = url || (title.length >= 12 ? title : '');
      if (!key) continue;
      const owner = firstByKey.get(key);
      if (owner && owner !== it.id) sessionDupOwnerByItemId[it.id] = owner;
      else if (!owner) firstByKey.set(key, it.id);
    }
  }
  const hasAnyPhotos = displayItems.some(item => item.photos.length > 0);
  const hasAnyItems = totalItems > 0;
  const isAnalyzeInFlightRef = React.useRef(false);
  const shouldShowBottomActions =
    cameraMode === 'shelf'
      ? totalItems > 0
      : hasAnyItems || hasAnyPhotos;
  const shouldShowShelfFailureBar = Boolean(cameraMode === 'shelf' && totalItems === 0 && shouldShowShelfRetryActions);
  const scrollBottomPadding = shouldShowShelfFailureBar || shouldShowBottomActions
    ? bottomMargin + 126
    : bottomMargin;

  const submitDirectGenerateJob = React.useCallback(async (
    products: Array<{
      productIndex: number;
      productId: string;
      variantId?: string;
      imageUrls: string[];
      coverImageIndex: number;
      selectedMatches?: any[];
      quantity?: number;
    }>
  ) => {
    const token = await ensureSupabaseJwt();
    if (!token) {
      throw new Error('No auth token available for generate request');
    }

    const rawApiBase = API_BASE_URL;
    const API_BASE = rawApiBase;
    const response = await fetch(`${API_BASE}/api/products/generate/jobs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        products,
        selectedPlatforms: connectedPlatformKeys,
        options: { useScraping: true },
      }),
    });

    const responseText = await response.text();
    let parsed: any = null;
    try {
      parsed = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText} :: ${responseText.slice(0, 200)}`);
    }

    return parsed as JobResponse | null;
  }, [connectedPlatformKeys]);

  // Shared handler: analyze and navigate to match/generate flow (accounts for quick scan selections).
  // keepSheetOpen: swipe-to-generate fires this per-card and the cart stays up so the
  // row's in-place spinner is visible (in-place async; nothing navigates away).
  const handleAnalyzeAndNavigate = React.useCallback(async (itemsOverride?: typeof bulkItems, opts?: { keepSheetOpen?: boolean }) => {
    if (isAnalyzeInFlightRef.current) {
      return;
    }
    isAnalyzeInFlightRef.current = true;
    onSaveDraft?.();
    if (!opts?.keepSheetOpen) {
      onClose();
    }
    // Multi-select: when a subset is passed, only those items are listed; otherwise the whole cart.
    const targetItems = itemsOverride && itemsOverride.length > 0 ? itemsOverride : bulkItems;
    const firstPhotos = targetItems.map(item => item.photos[0]).filter(Boolean);
    if (firstPhotos.length === 0) {
      Alert.alert('No Photos', 'Please take some photos first before searching.');
      isAnalyzeInFlightRef.current = false;
      return;
    }

    onStartBroadSearch();

    const loadingStates: Record<string, ItemLoadingState> = {};
    targetItems.forEach(item => {
      if (item.photos.length > 0) {
        loadingStates[item.id] = { isLoading: true, stage: 'Processing...' };
      }
    });
    setItemLoadingStates(loadingStates);

    try {
      const mergedConfirmedQuickMatch = { ...confirmedQuickMatchByItemId };
      targetItems.forEach(item => {
        if (item.preSelectedSource) {
          mergedConfirmedQuickMatch[item.id] = {
            serpApiData: [item.preSelectedSource],
            preSelectedIndices: [0],
            source: 'quick_scan_confirmed',
          };
        }
      });

      const queueEntries = targetItems.map((item, index) => {
        const confirmedMatch = mergedConfirmedQuickMatch[item.id];
        const selectedIndex = typeof confirmedMatch?.preSelectedIndices?.[0] === 'number'
          ? confirmedMatch.preSelectedIndices[0]
          : null;
        // F2: A confirmed quick-match — whether the user picked it explicitly
        // ('quick_scan_confirmed') or auto-pre-selected by SmartPicker and then
        // implicitly confirmed by tapping Analyze ('quick_scan_auto') — is a
        // valid match source. We route both to direct-generate, which skips
        // the redundant /orchestrate/match round-trip (Tier 0/1/2/3 search +
        // SmartPicker rerank were already done in quick-scan).
        const isUsableSource =
          confirmedMatch?.source === 'quick_scan_confirmed' ||
          confirmedMatch?.source === 'quick_scan_auto';
        const selectedCandidate = (
          isUsableSource &&
          selectedIndex != null &&
          Array.isArray(confirmedMatch.serpApiData) &&
          confirmedMatch.serpApiData[selectedIndex]
        )
          ? confirmedMatch.serpApiData[selectedIndex]
          : null;
        const imageUrls = item.photos.map((photo) => photo.uri).filter(Boolean);
        const fallbackId = item.id || `quick-generate-${index}`;

        return {
          originalIndex: index,
          item,
          selectedCandidate,
          generateProduct: selectedCandidate ? {
            productIndex: index,
            productId: String(selectedCandidate.productId || selectedCandidate.variantId || fallbackId),
            variantId: selectedCandidate.variantId ? String(selectedCandidate.variantId) : undefined,
            imageUrls,
            coverImageIndex: 0,
            selectedMatches: [selectedCandidate],
            quantity: item.quantity,
          } : null,
        };
      });

      const directGenerateEntries = queueEntries.filter((entry) => (
        entry.selectedCandidate &&
        entry.generateProduct &&
        Array.isArray(entry.generateProduct.imageUrls) &&
        entry.generateProduct.imageUrls.length > 0
      ));
      const analyzeEntries = queueEntries.filter((entry) => !directGenerateEntries.includes(entry));
      const userImagesByIndex = Object.fromEntries(
        bulkItems.map((item, index) => [index, item.photos.map((photo) => photo.uri).filter(Boolean)])
      );

      if (directGenerateEntries.length > 0 && analyzeEntries.length === 0) {
        const generateProductsPayload = directGenerateEntries.flatMap((entry) => (
          entry.generateProduct ? [{ ...entry.generateProduct, productIndex: entry.originalIndex }] : []
        ));
        const directJobResponse = await submitDirectGenerateJob(generateProductsPayload);

        const directJobId = directJobResponse?.jobId;
        if (!directJobId) {
          throw new Error('Generate job response missing jobId');
        }

        // In-place: queue the generate job; items stay in the cart and process async.
        // Only the items actually in this job (directGenerateEntries) — not all bulkItems.
        onQueueGeneration?.(
          directGenerateEntries.map((entry) => ({ itemId: entry.item.id, jobId: directJobId, processType: 'generate' as const })),
        );
        return;
      }

      const directJobMap = directGenerateEntries.length > 0 ? (() => {
        const payload = directGenerateEntries.flatMap((entry) => (
          entry.generateProduct ? [{ ...entry.generateProduct, productIndex: entry.originalIndex }] : []
        ));
        return payload;
      })() : [];

      let directJobResponse: JobResponse | null = null;
      let directJobId: string | undefined;
      if (directJobMap.length > 0) {
        directJobResponse = await submitDirectGenerateJob(directJobMap);
        directJobId = directJobResponse?.jobId || undefined;
        if (!directJobId) {
          throw new Error('Generate job response missing jobId');
        }
      }

      const analyzeFirstPhotos = analyzeEntries.map((entry) => entry.item.photos[0]).filter(Boolean);
      const analyzeItems = analyzeEntries.map((entry) => ({ id: entry.item.id }));
      const analyzeQuickMatchHints = Object.fromEntries(
        analyzeEntries.flatMap((entry) => (
          mergedConfirmedQuickMatch[entry.item.id]
            ? [[entry.item.id, mergedConfirmedQuickMatch[entry.item.id]]]
            : []
        ))
      );

      if (analyzeFirstPhotos.length === 0 && directJobId) {
        // Only the direct-generate items are in this job — photo-less non-direct items must not be queued.
        onQueueGeneration?.(
          directGenerateEntries.map((entry) => ({ itemId: entry.item.id, jobId: directJobId as string, processType: 'generate' as const })),
        );
        return;
      }

      const jobResponseData: JobResponse = await performAnalyze(
        analyzeFirstPhotos,
        analyzeQuickMatchHints,
        analyzeItems,
      );
      setJobResponse(jobResponseData);
      const jobId = jobResponseData?.jobId;

      if (jobId) {
        // In-place: direct items generate, analyze items match (auto-generates) — all async in the cart.
        onQueueGeneration?.([
          ...(directJobId
            ? directGenerateEntries.map((entry) => ({ itemId: entry.item.id, jobId: directJobId as string, processType: 'generate' as const }))
            : []),
          ...analyzeEntries.map((entry) => ({ itemId: entry.item.id, jobId, processType: 'match' as const })),
        ]);
      } else {
        Alert.alert('Error', 'Failed to start analysis. Please try again.');
      }
    } catch (error) {
      console.error('[ANALYZE] Error:', error);
      Alert.alert('Error', 'Failed to start analysis. Please try again.');
    } finally {
      isAnalyzeInFlightRef.current = false;
    }
  }, [
    bulkItems,
    confirmedQuickMatchByItemId,
    connectedPlatformKeys,
    performAnalyze,
    onStartBroadSearch,
    setJobResponse,
    setItemLoadingStates,
    navigation,
    onSubmitItemsForProcessing,
    onSaveDraft,
    onClose,
    submitDirectGenerateJob,
  ]);

  return (
    <Animated.View style={[styles.bulkItemsSheet, dynamicSheetStyle, { marginTop: insets.top + 6, paddingTop: 12 }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 0}
      >
        {/* Drag handle + header share one pan: drag DOWN anywhere on this top zone
            (not just the handle) closes the cart. activeOffsetY keeps the header
            buttons tappable; the list below closes via pull-down overscroll. */}
        <PanGestureHandler
          activeOffsetY={[-18, 18]}
          failOffsetX={[-24, 24]}
          onGestureEvent={(event) => {
            const { translationY } = event.nativeEvent;
            // Open position is 0; dragging DOWN raises translateY toward closed,
            // lowering the cart and bringing the capture screen back down in lockstep.
            const newY = Math.max(0, Math.min(SCREEN_HEIGHT, translationY));
            sheetTranslateY.value = newY;
          }}
          onHandlerStateChange={(event) => {
            if (event.nativeEvent.state === State.END) {
              const { translationY, velocityY } = event.nativeEvent;
              // Dragged / flung down far enough → close; otherwise spring back open.
              if (translationY > SCREEN_HEIGHT * 0.18 || velocityY > 800) {
                onClose();
              } else {
                sheetTranslateY.value = withSpring(0);
              }
            }
          }}
        >
          <Animated.View>
            <View style={styles.dragHandle}>
              <TouchableOpacity onPress={onClose} style={styles.dragHandleButton}>
                <View style={styles.dragHandleBar} />
              </TouchableOpacity>
            </View>

            {/* Header: [✕] [Cart · count] [+ New] */}
            <View style={styles.sheetHeader}>
              <View style={{minWidth: 75}}>
                <TouchableOpacity
                onPress={onClose}
                style={styles.headerBackButton}
                activeOpacity={0.8}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Icon name="close" size={20} color="#18181B" />
                </TouchableOpacity>
              </View>
              
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={styles.sheetTitle}>
                  {totalItems === 0 ? (cameraMode === 'shelf' ? 'Scan a shelf' : 'Cart') : 'Cart'}
                </Text>
                <Text style={{ marginTop: 2, fontSize: 12, color: '#71717A', fontWeight: '600' }}>
                  {totalItems} item{totalItems === 1 ? '' : 's'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  // + New → start another item and drop back to the live camera.
                  onAddNewItem();
                  onClose();
                }}
                style={styles.headerNewButton}
                activeOpacity={0.8}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                disabled={totalItems >= MAX_BATCH_ITEMS}
              >
                <Icon name="plus" size={16} color={totalItems >= MAX_BATCH_ITEMS ? '#C7C7CC' : '#18181B'} />
                <Text style={[styles.headerNewButtonText, totalItems >= MAX_BATCH_ITEMS && { color: '#C7C7CC' }]}>New</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </PanGestureHandler>

        {/* Selection toolbar removed (Shop-style): the cart checks out as one; swipe a
            card right to generate just that item. */}


        {/* Main Camera View */}
        <View style={styles.sheetContent}>


        {/* (No subtitle line — the empty-state card below carries the prompt.) */}

        {/* Scrollable Items Container */}
        <ScrollView
          style={[
            styles.itemsScrollContainer,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
          scrollEventThrottle={16}
          // Pull the list down past its top → close the cart (so "drag down
          // anywhere" works, not just the handle/header zone).
          onScroll={(e) => {
            if (e.nativeEvent.contentOffset.y < -55 && !pullCloseRef.current) {
              pullCloseRef.current = true;
              onClose();
            }
          }}
          onScrollEndDrag={() => {
            pullCloseRef.current = false;
          }}
          contentContainerStyle={[
            styles.scrollContent,
            {
              flexGrow: 1,
              paddingBottom: scrollBottomPadding,
            }
          ]}
        >
          {/* Out of free scans → the cart IS the upgrade surface: the limit and
              the two ways forward (plan stepper / credits) live here. No nag
              banner anywhere else; this appears only once they've actually run out. */}
          {freemium?.exhausted ? (
            <View style={styles.usageLimitCard}>
              <Text style={styles.usageLimitTitle}>You're out of free scans</Text>
              <Text style={styles.usageLimitSub}>{freemium.usageCount} of {freemium.freeLimit} used</Text>
              <TouchableOpacity style={styles.usageLimitPrimary} onPress={onUpgrade} activeOpacity={0.85}>
                <Text style={styles.usageLimitPrimaryText}>See plans</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.usageLimitSecondary} onPress={onAddCredits} activeOpacity={0.7}>
                <Text style={styles.usageLimitSecondaryText}>Add credits instead</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {displayItems.length === 0 ? (
            (() => {
              if (cameraMode === 'shelf' && shelfPhotoUri && shelfProgress && shelfProgress.status !== 'idle') {
                return (
                  <ShelfScanProgressCard
                    photoUri={shelfPhotoUri}
                    title={shelfPresentation?.title || 'Inspecting shelf'}
                    subtitle={shelfPresentation?.subtitle || 'Reading the shelf image.'}
                    phase={shelfProgress.phase}
                    status={shelfProgress.status}
                    progress={shelfProgress.progress}
                    totalItems={shelfProgress.totalItems}
                    completedItems={shelfProgress.completedItems}
                    stalled={shelfProgress.stalled}
                  />
                );
              }

              if (currentInstruction && currentInstruction !== 'ready') {
                if (shelfPhotoUri) {
                  return (
                    <ShelfScanProgressCard
                      photoUri={shelfPhotoUri}
                      title="Inspecting shelf"
                      subtitle="Reading the photo and building the first item list."
                      phase="inspecting_shelf"
                      progress={0.18}
                      totalItems={0}
                      completedItems={0}
                    />
                  );
                }
                return (
                  <View style={{ padding: 20 }}>
                    {/* Skeleton 1 */}
                    <View style={[styles.bulkItemContainer, { opacity: 0.7 }]}>
                      <View style={styles.itemHeader}>
                        <View style={[styles.itemLabelContainer, { width: 100, height: 20, backgroundColor: '#E0E0E0', borderRadius: 4 }]} />
                        <View style={[styles.loadingBadge, { width: 80, height: 20, backgroundColor: '#E0E0E0', borderRadius: 10 }]} />
                      </View>
                      <View style={[styles.photoSlotsContainer, { marginTop: 15 }]}>
                        <View style={[styles.photoSlot, { backgroundColor: '#F5F5F5' }]} />
                        <View style={[styles.addPhotoButton, { backgroundColor: '#F5F5F5' }]} />
                      </View>
                    </View>
                    {/* Skeleton 2 */}
                    <View style={[styles.bulkItemContainer, { opacity: 0.4, marginTop: 10 }]}>
                      <View style={styles.itemHeader}>
                        <View style={[styles.itemLabelContainer, { width: 120, height: 20, backgroundColor: '#E0E0E0', borderRadius: 4 }]} />
                      </View>
                      <View style={[styles.photoSlotsContainer, { marginTop: 15 }]}>
                        <View style={[styles.photoSlot, { backgroundColor: '#F5F5F5' }]} />
                        <View style={[styles.addPhotoButton, { backgroundColor: '#F5F5F5' }]} />
                      </View>
                    </View>

                    <Text style={{ marginTop: 24, fontSize: 16, color: '#666', textAlign: 'center', fontWeight: '500' }}>
                      {'Recognizing...'}
                    </Text>
                  </View>
                );
              }

              // Empty cart: one quiet card. Tap → back to the camera (the
              // headline's promise); the library path is a small link below.
              return (
                <View style={styles.emptyState}>
                  <TouchableOpacity style={styles.emptyStateCard} onPress={onClose} activeOpacity={0.85}>
                    <View style={styles.emptyStateIconCircle}>
                      <Icon name="camera-outline" size={24} color="#18181B" />
                    </View>
                    <Text style={styles.emptyStateTitle}>
                      {cameraMode === 'shelf' ? 'Scan a shelf' : 'Scan your first item'}
                    </Text>
                    <Text style={styles.emptyStateSub}>
                      {cameraMode === 'shelf' ? 'One photo, we find every item' : 'Snap a photo and we build the listing'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={onImageUpload} hitSlop={{ top: 10, bottom: 10, left: 16, right: 16 }}>
                    <Text style={styles.emptyStateUploadLink}>or upload from your library</Text>
                  </TouchableOpacity>
                </View>
              );
            })()
          ) : (
            (() => {
              return (
                <>
                  {renderList.map((entry) => {
                    if (entry.kind === 'folderCard') {
                      return (
                        <TouchableOpacity
                          key={`folder-${entry.id}`}
                          style={styles.folderCard}
                          activeOpacity={0.85}
                          onPress={() => onOpenFolder?.(entry.id)}
                        >
                          {entry.sourcePhotoUri ? (
                            <Image source={{ uri: entry.sourcePhotoUri }} style={styles.folderCardThumb} />
                          ) : (
                            <View style={[styles.folderCardThumb, styles.folderCardThumbEmpty]}>
                              <Icon name="folder-image" size={26} color="#93C822" />
                            </View>
                          )}
                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.folderCardTitle} numberOfLines={1}>{entry.label || 'Shelf'}</Text>
                            <Text style={styles.folderCardSub}>
                              {entry.childCount} item{entry.childCount === 1 ? '' : 's'} · Tap to review
                            </Text>
                          </View>
                          <Icon name="chevron-right" size={24} color="#94A3B8" />
                        </TouchableOpacity>
                      );
                    }
                    const item = entry.item;
                    const id = entry.index;
                    const loadingState = itemLoadingStates[item.id];
                    const matchInfo = confirmedQuickMatchByItemId?.[item.id];
                    const hasQuickScanData = quickScanStore?.[item.id];
                    const matchCount = hasQuickScanData?.matchData?.totalMatches || 0;
                    const topMatch = hasQuickScanData?.matchData?.rankedCandidates?.[0];
                    const confirmedMatch = (matchInfo && matchInfo.serpApiData && matchInfo.preSelectedIndices && matchInfo.preSelectedIndices.length > 0)
                      ? matchInfo.serpApiData[matchInfo.preSelectedIndices[0]]
                      : null;
                    const selectedMatch = confirmedMatch || topMatch;
                    const selectedMatchImage = selectedMatch?.imageUrl || selectedMatch?.image || null;
                    const selectedMatchTitle = selectedMatch?.title || 'Selected match';
                    const isLocalInventoryMatch = Boolean(selectedMatch?.isLocalMatch);
                    const scannedEarlierThisSession = !isLocalInventoryMatch && Boolean(sessionDupOwnerByItemId[item.id]);
                    const selectedMatchLabel = isLocalInventoryMatch
                      ? 'Already in Inventory'
                      : scannedEarlierThisSession
                        ? 'Already scanned'
                        : confirmedMatch
                          ? (matchInfo?.source === 'quick_scan_auto' ? 'Auto-selected Match' : 'Selected Match')
                          : `${matchCount} Match${matchCount > 1 ? 'es' : ''} Found`;
                    const countDraft = countDraftByItemId[item.id] ?? String(item.quantity ?? 1);
                    const thumbUri = selectedMatchImage || item.photos.find((p: CapturedPhoto) => p.isCover)?.uri || item.photos[0]?.uri;
                    const matchPrice = extractPrice(selectedMatch?.price);
                    const rowTitle = (selectedMatch && selectedMatchTitle) ? selectedMatchTitle : (item.title && !/^Item \d+$/.test(item.title) ? item.title : `Item ${id + 1}`);
                    const isGenerated = itemStageById?.[item.id] === 'generated';
                    const statusSubtitle = loadingState?.isLoading
                      ? (loadingState.stage || 'Working…')
                      : loadingState?.error
                        ? 'Match failed · tap retry'
                        : isGenerated
                          ? 'Details ready · tap to review'
                          : isLocalInventoryMatch
                            ? 'Already in inventory'
                            : scannedEarlierThisSession
                              ? 'Already scanned this session'
                              : confirmedMatch
                                ? 'Match confirmed'
                                : selectedMatch
                                  ? `${matchCount} match${matchCount === 1 ? '' : 'es'} found`
                                  : null; // no-match: the detail chip below is the ONE ask

                    if (currentInstruction === 'extracting' || currentInstruction === 'optimizing') {
                      return (
                        <ShelfScanPlaceholderRow
                          key={`shelf-placeholder-${item.id}`}
                          title={item.title || `Item ${id + 1}`}
                          subtitle={currentInstruction === 'optimizing' ? 'Refining the best search wording.' : 'Splitting the shelf into distinct packages.'}
                        />
                      );
                    }

                    if (currentInstruction === 'searching' && !hasQuickScanData && !loadingState?.isLoading) {
                      return (
                        <ShelfScanPlaceholderRow
                          key={`searching-placeholder-${item.id}`}
                          title={item.title || `Item ${id + 1}`}
                          subtitle="Searching matches and streaming results into this row."
                        />
                      );
                    }

                    return (
                      <Swipeable
                        key={`bulk-item-${item.id}`}
                        overshootLeft={false}
                        leftThreshold={56}
                        renderLeftActions={() => (
                          <View style={styles.swipeGenerateAction}>
                            <Icon name="auto-fix" size={20} color="#0A0A0B" />
                            <Text style={styles.swipeGenerateText}>Generate</Text>
                          </View>
                        )}
                        onSwipeableOpen={(direction, swipeable) => {
                          if (direction !== 'left') return;
                          swipeable.close();
                          if (loadingState?.isLoading) return;
                          // One item, in place: the row spins while it matches/generates.
                          handleAnalyzeAndNavigate([item], { keepSheetOpen: true });
                        }}
                      >
                      <TouchableOpacity
                        style={[styles.cartRow, item.isActive && styles.cartRowActive]}
                        activeOpacity={0.85}
                        onPress={() => {
                          if (isLocalInventoryMatch) { onOpenLocalMatch?.(item.id); return; }
                          (onOpenItemPreview || onSelectItem)?.(item.id);
                        }}
                      >
                        <View style={styles.cartRowTop}>
                          <TouchableOpacity
                            style={styles.cartThumbWrap}
                            activeOpacity={0.8}
                            onPress={(e) => { e.stopPropagation?.(); onOpenPhotoModal?.(item.id); }}
                          >
                            {thumbUri ? (
                              <Image source={{ uri: thumbUri }} style={styles.cartThumb} />
                            ) : (
                              <View style={[styles.cartThumb, styles.cartThumbEmpty]}>
                                <Icon name="camera-plus-outline" size={20} color="#9CA3AF" />
                              </View>
                            )}
                            {item.photos.length > 1 ? (
                              <View style={styles.cartThumbBadge}><Text style={styles.cartThumbBadgeText}>{item.photos.length}</Text></View>
                            ) : null}
                          </TouchableOpacity>
                          <View style={styles.cartRowMid}>
                            <Text style={styles.cartTitle} numberOfLines={2}>{rowTitle}</Text>
                            {statusSubtitle ? (
                              <View style={styles.cartSubRow}>
                                {loadingState?.isLoading ? (
                                  <UnicodeSpinner spinner={(spinners.braillewave || spinners.dots) as UnicodeSpinnerDefinition} color="#93C822" size={11} />
                                ) : (
                                  <View style={[styles.cartStatusDot, { backgroundColor: loadingState?.error ? '#F87171' : isGenerated ? '#93C822' : isLocalInventoryMatch ? '#60A5FA' : confirmedMatch ? '#93C822' : '#94A3B8' }]} />
                                )}
                                <Text style={styles.cartSub} numberOfLines={1}>{statusSubtitle}</Text>
                              </View>
                            ) : null}
                          </View>
                          {matchPrice != null ? (
                            <Text style={styles.cartPrice}>${Math.round(matchPrice)}</Text>
                          ) : (
                            <Icon name="chevron-right" size={20} color="#C7C7CC" />
                          )}
                        </View>

                        {/* Needs-detail tag — only when the item still NEEDS it (no match yet);
                            matched rows stay Shop-clean. Opens the camera-area
                            Add-details sheet; no inline editing on the card. */}
                        {!selectedMatch && !loadingState?.isLoading && !isGenerated ? (
                          <TouchableOpacity
                            style={styles.detailChip}
                            activeOpacity={0.7}
                            onPress={(e) => { e.stopPropagation?.(); onOpenAddDetails?.(item.id); }}
                          >
                            <Icon name="tag-plus-outline" size={15} color="#64748B" />
                            <Text style={styles.detailChipText}>No match yet · add a detail</Text>
                          </TouchableOpacity>
                        ) : null}

                        <View style={styles.cartActions}>
                          <View style={styles.qtyStepper}>
                            <TouchableOpacity
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              onPress={(e) => {
                                e.stopPropagation?.();
                                const q = item.quantity ?? 1;
                                if (q <= 1) onDeleteItem(item.id);
                                else onUpdateItemQuantity?.(item.id, q - 1);
                              }}
                            >
                              <Icon name={(item.quantity ?? 1) <= 1 ? 'trash-can-outline' : 'minus'} size={16} color="#52525B" />
                            </TouchableOpacity>
                            <Text style={styles.qtyText}>{item.quantity ?? 1}</Text>
                            <TouchableOpacity
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              onPress={(e) => { e.stopPropagation?.(); onUpdateItemQuantity?.(item.id, (item.quantity ?? 1) + 1); }}
                            >
                              <Icon name="plus" size={16} color="#52525B" />
                            </TouchableOpacity>
                          </View>
                          {onToggleSavedForLater ? (
                            <TouchableOpacity
                              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                              onPress={(e) => { e.stopPropagation?.(); onToggleSavedForLater(item.id, true); }}
                            >
                              <Text style={styles.saveForLaterText}>Save for later</Text>
                            </TouchableOpacity>
                          ) : <View style={{ flex: 1 }} />}
                          {/* Per-card pills stripped (Shop-style): tap the row to review,
                              swipe right to generate. Error recovery keeps its pill. */}
                          {loadingState?.error ? (
                            <TouchableOpacity style={styles.cartReviewPill} onPress={(e) => { e.stopPropagation?.(); onRetryItemScan?.(item.id); }}>
                              <Text style={styles.cartReviewPillText}>Retry</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                      </Swipeable>
                    );
                  })}
                </>
              );
            })()
          )}

          {/* Saved for later — set aside, one tap back into the cart */}
          {savedItems.length > 0 && (
            <View style={styles.savedSection}>
              <Text style={styles.savedSectionTitle}>Saved for later</Text>
              {savedItems.map((sItem) => {
                const sConf = confirmedQuickMatchByItemId?.[sItem.id];
                const sQs = quickScanStore?.[sItem.id];
                const sCand: any = (sConf?.serpApiData && sConf.preSelectedIndices?.length)
                  ? sConf.serpApiData[sConf.preSelectedIndices[0]]
                  : sQs?.matchData?.rankedCandidates?.[0];
                const sThumb = sCand?.imageUrl || sCand?.image || sItem.photos.find((p: CapturedPhoto) => p.isCover)?.uri || sItem.photos[0]?.uri;
                const sTitle = sCand?.title || sItem.title || 'Saved item';
                const sPrice = extractPrice(sCand?.price);
                return (
                  <View key={`saved-${sItem.id}`} style={styles.savedRow}>
                    {sThumb ? (
                      <Image source={{ uri: sThumb }} style={styles.savedThumb} />
                    ) : (
                      <View style={[styles.savedThumb, styles.cartThumbEmpty]}>
                        <Icon name="image-outline" size={16} color="#5A5A5E" />
                      </View>
                    )}
                    <View style={{ flex: 1, marginHorizontal: 10 }}>
                      <Text style={styles.savedTitle} numberOfLines={1}>{sTitle}</Text>
                      <Text style={styles.savedSub} numberOfLines={1}>
                        {sPrice != null ? `$${Math.round(sPrice)} · ` : ''}Qty {sItem.quantity ?? 1}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.savedMovePill}
                      activeOpacity={0.8}
                      onPress={() => onToggleSavedForLater?.(sItem.id, false)}
                    >
                      <Text style={styles.savedMovePillText}>Move to cart</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>

        {shouldShowShelfFailureBar && onRetryShelfScan && onRetakeShelfScan ? (
          <View style={[styles.bottomActions, { paddingBottom: bottomMargin }]}>
            <BottomActionBar
              primaryLabel="Retry scan"
              onPrimary={onRetryShelfScan}
              primaryIcon={<RotateCcw size={18} color="#FFFFFF" />}
              secondaryLabel="Retake photo"
              onSecondary={onRetakeShelfScan}
              secondaryIcon={<CameraIcon size={18} color="#334155" />}
              primaryButtonStyle={{ backgroundColor: '#0F172A' }}
              secondaryButtonStyle={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1' }}
              secondaryTextStyle={{ color: '#0F172A' }}
              style={{ position: 'relative', left: 0, right: 0, bottom: 0 }}
            />
          </View>
        ) : null}

        {/* Fixed Bottom Actions */}
        {shouldShowBottomActions && (
          <View style={[styles.bottomActions, { paddingBottom: bottomMargin + 40, flexDirection: 'column', gap: 8 }]}>
            {cartSubtotal > 0 ? (
              <View style={styles.subtotalRow}>
                <Text style={styles.subtotalLabel}>Subtotal</Text>
                <Text style={styles.subtotalValue}>${Math.round(cartSubtotal)}</Text>
              </View>
            ) : null}
            <TouchableOpacity
              style={[
                styles.searchForProductButton,
                { backgroundColor: hasLoadingItems || (cameraMode !== 'shelf' && totalItems === 0) ? '#A3A3A3' : '#93C822' },
              ]}
              disabled={hasLoadingItems || (cameraMode !== 'shelf' && totalItems === 0)}
              onPress={() => {
                if (cameraMode === 'shelf' && totalItems > 0) {
                  // Direct transition from shelf to camera mode
                  onStartBroadSearch(); // We'll hijack this prop or close modal
                } else {
                  // Checkout the selection, or the whole active cart — never saved-for-later items.
                  handleAnalyzeAndNavigate(
                    bulkItems.filter((i) => !savedSet.has(i.id) && (!selectionActive || selectedIds.has(i.id))),
                  );
                }
              }}
            >
              {hasLoadingItems && (
                <UnicodeSpinner
                  spinner={(spinners.braillewave || spinners.dots) as UnicodeSpinnerDefinition}
                  color="#FFFFFF"
                  size={13}
                  style={{ marginRight: 8 }}
                />
              )}
              <Text style={styles.searchForProductButtonText}>
                {cameraMode === 'shelf' && totalItems > 0
                    ? `Take Photos for ${totalItems} Item${totalItems > 1 ? 's' : ''}`
                    : cameraMode !== 'shelf' && totalItems === 0
                      ? 'Take a photo to continue'
                      : hasLoadingItems
                        ? 'Analyzing...'
                        : `Checkout ${selectionActive ? selectedIds.size : totalItems} Item${(selectionActive ? selectedIds.size : totalItems) === 1 ? '' : 's'}`}
              </Text>
            </TouchableOpacity>
          </View>
        )}
        </View>
      </KeyboardAvoidingView>
    </Animated.View>
  );
};

// Styles

const styles = StyleSheet.create({
  bulkItemsSheet: {
    position: 'absolute',
    top: 0, // full-screen cart; rises from below as the capture screen lifts away (reachability)
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#F6F7F4',
    paddingTop: 12, // overridden inline (marginTop carries the top peek gap)
    paddingBottom: 20,
    // Full-width cart. The capture screen peeks above it (transparent Modal) and
    // the camera card's own rounded bottom (28) bleeds down into this rounded top
    // — that's the "rounded up toward the camera" peek. Tapping the exposed peek
    // springs the cart back down (go back up). marginTop (inline) sizes the peek.
    marginHorizontal: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  swipeGenerateAction: {
    width: 104,
    borderRadius: 18,
    backgroundColor: '#93C822',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginRight: 10,
    marginVertical: 4,
  },
  swipeGenerateText: {
    color: '#0A0A0B',
    fontSize: 12,
    fontWeight: '700',
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#18181B',
  },
  headerNewItemButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(147, 200, 34, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  sheetSubtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  bulkItemContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#D9D9D9',
    minHeight: 100,
  },
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#ECEBE6',
  },
  folderCardThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#F1F1EE' },
  folderCardThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  folderCardTitle: { fontSize: 16, fontWeight: '700', color: '#18181B' },
  folderCardSub: { fontSize: 13, color: '#71717A', marginTop: 3 },
  detailChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 12, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(245,158,11,0.12)' },
  detailChipText: { fontSize: 13, color: '#A2611A', fontWeight: '600' },
  detailEditor: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  detailInput: { flex: 1, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECEBE6', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: '#18181B' },
  detailIconBtn: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F1F1EE', alignItems: 'center', justifyContent: 'center' },
  // Dark Ruggable-style cart row
  cartRow: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#ECEBE6' },
  cartRowActive: { borderWidth: 1, borderColor: 'rgba(147,200,34,0.5)' },
  cartRowTop: { flexDirection: 'row', alignItems: 'center' },
  cartThumbWrap: { marginLeft: 10, position: 'relative' },
  cartThumb: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#F1F1EE' },
  cartThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  cartThumbBadge: { position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#93C822', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  cartThumbBadgeText: { fontSize: 11, fontWeight: '700', color: '#0A0A0B' },
  cartRowMid: { flex: 1, marginHorizontal: 12 },
  cartTitle: { fontSize: 15, fontWeight: '600', color: '#18181B', lineHeight: 20 },
  cartSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  cartStatusDot: { width: 7, height: 7, borderRadius: 4 },
  cartSub: { fontSize: 13, color: '#71717A', flex: 1 },
  cartPrice: { fontSize: 16, fontWeight: '700', color: '#18181B', marginLeft: 6 },
  cartActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#F1F1EE', borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  qtyText: { fontSize: 15, fontWeight: '700', color: '#18181B', minWidth: 16, textAlign: 'center' },
  cartReviewPill: { backgroundColor: '#18181B', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8 },
  cartReviewPillText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  cartAddDetailsPill: { backgroundColor: '#93C822' },
  saveForLaterText: { fontSize: 13, fontWeight: '600', color: '#71717A', textDecorationLine: 'underline' },
  // Wireframe header buttons + select toolbar
  headerBackButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  // Matches the ✕ exit button: white pill, black text, same soft shadow.
  headerNewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerNewButtonText: { fontSize: 14, fontWeight: '700', color: '#18181B' },
  // Out-of-free-scans panel — the cart's one upgrade surface.
  usageLimitCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  usageLimitTitle: { fontSize: 17, fontWeight: '700', color: '#18181B' },
  usageLimitSub: { fontSize: 13, fontWeight: '600', color: '#71717A', marginTop: 4, marginBottom: 14 },
  usageLimitPrimary: {
    alignSelf: 'stretch',
    backgroundColor: '#93C822',
    borderRadius: 22,
    paddingVertical: 13,
    alignItems: 'center',
  },
  usageLimitPrimaryText: { fontSize: 15, fontWeight: '700', color: '#0A0A0B' },
  usageLimitSecondary: { marginTop: 10, paddingVertical: 6, paddingHorizontal: 12 },
  usageLimitSecondaryText: { fontSize: 14, fontWeight: '600', color: '#5A8F12' },
  // Empty cart
  emptyState: { alignItems: 'center', paddingTop: 28 },
  emptyStateCard: { alignItems: 'center', paddingVertical: 8, paddingHorizontal: 24 },
  emptyStateIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  emptyStateTitle: { fontSize: 17, fontWeight: '700', color: '#18181B', marginTop: 14 },
  emptyStateSub: { fontSize: 13, color: '#71717A', marginTop: 4, textAlign: 'center' },
  emptyStateUploadLink: { fontSize: 14, fontWeight: '600', color: '#5A8F12', marginTop: 14 },
  listToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  listToolbarCount: { fontSize: 13, fontWeight: '600', color: '#71717A' },
  // Saved for later
  savedSection: { marginTop: 20 },
  savedSectionTitle: { fontSize: 15, fontWeight: '700', color: '#18181B', marginBottom: 10 },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#ECEBE6',
  },
  savedThumb: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F1F1EE' },
  savedTitle: { fontSize: 14, fontWeight: '600', color: '#18181B' },
  savedSub: { fontSize: 12, color: '#71717A', marginTop: 1 },
  savedMovePill: {
    backgroundColor: 'rgba(147, 200, 34, 0.15)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  savedMovePillText: { fontSize: 13, fontWeight: '700', color: '#5A8F12' },
  photoSlotsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  photoSlotWrapper: {
    position: 'relative',
    width: 60,
    height: 60,
  },
  photoSlot: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
    position: 'relative',
  },
  photoSlotImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoSlotNumberBadge: {
    position: 'absolute',
    bottom: 36,
    left: 0,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoSlotNumberBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
  },
  photoSlotLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 2,
  },
  photoSlotLabelText: {
    color: 'white',
    fontSize: 10,
    textAlign: 'center',
    fontWeight: '500',
  },
  addPhotoButton: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#f5f5f5ff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'column',
  },
  newItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F1F22',
    borderRadius: 14,
    paddingVertical: 15,
    marginBottom: 4,
    gap: 8,
  },
  newItemButtonText: {
    fontSize: 16,
    color: '#C7C7CC',
    fontWeight: '600',
  },
  searchForProductButton: {
    backgroundColor: '#93C822',
    borderRadius: 16,
    paddingVertical: 17,
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  searchForProductButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 6,
    marginBottom: 2,
  },
  subtotalLabel: { fontSize: 15, color: '#71717A', fontWeight: '600' },
  subtotalValue: { fontSize: 20, color: '#18181B', fontWeight: '800' },
  dragHandle: {
    alignItems: 'center',
    marginBottom: 10,
  },
  dragHandleButton: {
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 15,
  },
  dragHandleBar: {
    width: 60,
    height: 4,
    backgroundColor: '#ddd',
    borderRadius: 2,
  },
  itemsScrollContainer: {
    flex: 1,
    marginBottom: 0,
  },
  scrollContent: {
    paddingBottom: 24,
    paddingHorizontal: 10,
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  itemLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333333',
  },
  itemLabelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  activeItemContainer: {
    borderColor: '#93C822',
    borderWidth: 2,
    backgroundColor: '#f8fff8',
  },
  activeItemLabel: {
    color: '#93C822',
    fontWeight: '700',
  },
  activeItemBadge: {
    backgroundColor: '#93C822',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
  },
  activeItemBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },
  loadingBadge: {
    backgroundColor: '#f0f8ff',
    borderColor: '#93C822',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingBadgeText: {
    color: '#93C822',
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },
  matchSkeletonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 10,
    gap: 10,
  },
  matchSkeletonThumb: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  matchSkeletonLineShort: {
    width: '50%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
    marginBottom: 6,
  },
  matchSkeletonLineLong: {
    width: '80%',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E2E8F0',
  },
  selectedMatchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 10,
  },
  selectedMatchCardLocalInventory: {
    backgroundColor: '#F0FDF4',
    borderColor: '#86EFAC',
  },
  selectedMatchImage: {
    width: 38,
    height: 38,
    borderRadius: 8,
    marginRight: 10,
  },
  selectedMatchLabel: {
    fontSize: 10,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  selectedMatchLabelLocalInventory: {
    color: '#15803D',
  },
  selectedMatchTitle: {
    fontSize: 13,
    color: '#1E293B',
    fontWeight: '600',
  },
  selectedMatchSubtitle: {
    marginTop: 3,
    fontSize: 11,
    color: '#475569',
  },
  noMatchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 10,
    marginTop: 10,
  },
  noMatchTitle: {
    fontSize: 13,
    color: '#475569',
    fontWeight: '600',
  },
  noMatchHint: {
    marginTop: 3,
    fontSize: 11,
    color: '#64748B',
  },
  matchErrorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: 10,
    gap: 10,
  },
  matchErrorTitle: {
    color: '#991B1B',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  matchErrorText: {
    color: '#B91C1C',
    fontSize: 12,
  },
  matchActionPill: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  matchActionPillText: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '700',
  },
  matchActionPillLocalInventory: {
    backgroundColor: '#DCFCE7',
  },
  matchActionPillLocalInventoryText: {
    color: '#166534',
  },
  matchActionPillDisabled: {
    opacity: 0.55,
  },
  matchActionPillDisabledText: {
    color: '#64748B',
  },
  matchActionPillDanger: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  matchActionPillDangerText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
  },
  itemFooterRow: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  itemFooterRemoveButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEE2E2',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  itemFooterRemoveText: {
    color: '#991B1B',
    fontSize: 13,
    fontWeight: '700',
  },
  itemFooterCountBlock: {
    flex: 1,
    minHeight: 38,
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemFooterCountLabel: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  itemFooterCountInput: {
    textAlign: 'right',
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    paddingVertical: 4,
  },
  bulkPhotoDeleteButton: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  coverPhotoSlot: {
    borderColor: '#93C822',
    borderWidth: 2,
  },
  coverPhotoLabel: {
    backgroundColor: '#93C822',
  },
  addPhotoText: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
    textAlign: 'center',
  },
  maxPhotosText: {
    fontSize: 12,
    color: '#ff6b6b',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 8,
  },
  bottomActions: {
    borderTopWidth: 1,
    borderTopColor: '#ECEBE6',
    paddingTop: 10,
    marginTop: 10,
    marginBottom: 10,
  },
  exitButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    minHeight: 34,
    maxHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2C2C2E',
    backgroundColor: '#1F1F22',
    flexDirection: 'row',
    alignItems: 'center',
  },
  exitButtonText: {
    color: '#C7C7CC',
    fontWeight: '600',
    marginLeft: 6,
    fontSize: 15,
  },
  sheetHeaderSpacer: {
    minWidth: 72,
    minHeight: 34,
  },
  selectAllButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    minHeight: 34,
    maxHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectAllText: {
    color: '#52525B',
    fontWeight: '600',
    marginLeft: 6,
    fontSize: 15,
  },
});

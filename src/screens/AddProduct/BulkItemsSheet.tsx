import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, TextInput, StyleSheet, Dimensions, Modal, Pressable, ActivityIndicator, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, FadeIn } from 'react-native-reanimated';
import { PanGestureHandler, TapGestureHandler, State } from 'react-native-gesture-handler';
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
  onRetryItemScan?: (itemId: string) => void;
  onOpenPhotoModal?: (itemId: string) => void;
  itemLoadingStates: Record<string, ItemLoadingState>;
  setItemLoadingStates: React.Dispatch<React.SetStateAction<Record<string, ItemLoadingState>>>;
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
}> = ({ onClose, onStartBroadSearch, sheetStyle, photos, isBulkMode, bulkItems, activeItemId, onAddNewItem, onImageUpload, performAnalyze, onDeleteItem, onMovePhoto, onSelectItem, onSetCoverPhoto, onRemovePhoto, sheetTranslateY, navigation, setJobResponse, jobResponse, quickScanStore, onOpenQuickMatches, onRetryItemScan, onOpenPhotoModal, itemLoadingStates, setItemLoadingStates, confirmedQuickMatchByItemId = {}, connectedPlatformKeys = [], currentInstruction, onOpenLocalMatch, shelfPhotoUri, shelfProgress, onRetryShelfScan, onRetakeShelfScan, onUpdateItemQuery, onUpdateItemTitle, onUpdateItemQuantity, onSubmitItemsForProcessing, onSaveDraft, cameraMode = 'camera' }) => {

  console.log('[SHEET RENDER] ==================');
  console.log('[SHEET RENDER] BulkItemsSheet RE-RENDERED at:', new Date().toISOString());
  console.log('[SHEET RENDER] Props received:');
  console.log('[SHEET RENDER] - photos.length:', photos.length);
  console.log('[SHEET RENDER] - bulkItems.length:', bulkItems.length);
  console.log('[SHEET RENDER] - bulkItems array:', JSON.stringify(bulkItems, null, 2));
  console.log('[SHEET RENDER] - activeItemId:', activeItemId);
  console.log('[SHEET RENDER] ==================');

  // SIMPLIFIED: Always use bulkItems (no more virtual items)
  let displayItems: Array<{ id: string; photos: CapturedPhoto[]; title?: string; isActive?: boolean; quantity?: number; }>;

  console.log('[DISPLAY LOGIC] ==================');
  console.log('[DISPLAY LOGIC] Using simplified logic - always show bulkItems');
  console.log('[DISPLAY LOGIC] bulkItems.length:', bulkItems.length);
  console.log('[DISPLAY LOGIC] photos (capturedPhotos) length:', photos.length, '(legacy - should be same as total photos in bulkItems)');

  // Always use bulkItems - much simpler!
  displayItems = bulkItems;

  console.log('[DISPLAY LOGIC] Final displayItems (same as bulkItems):');
  displayItems.forEach((item, index) => {
    console.log(`[DISPLAY LOGIC] Item ${index + 1}:`, {
      id: item.id,
      photosCount: item.photos.length,
      photoIds: item.photos.map(p => p.id),
      isActive: item.isActive
    });
  });
  console.log('[DISPLAY LOGIC] ==================');

  const totalItems = displayItems.length;
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

  console.log('[SHEET DEBUG] ==================');
  console.log('[SHEET DEBUG] isBulkMode:', isBulkMode);
  console.log('[SHEET DEBUG] bulkItems length:', bulkItems.length);
  console.log('[SHEET DEBUG] photos length:', photos.length);
  console.log('[SHEET DEBUG] photos array:', photos.map(p => ({ id: p.id, uri: p.uri.substring(0, 30) + '...' })));
  console.log('[SHEET DEBUG] displayItems COUNT:', displayItems.length);
  console.log('[SHEET DEBUG] totalItems:', totalItems);
  console.log('[SHEET DEBUG] Sheet State:', totalItems === 0 ? 'EMPTY' : 'HAS_ITEMS');
  console.log('[SHEET DEBUG] ==================');

  // Keep a tall, consistent sheet so actions never get clipped on smaller devices.
  const sheetMaxHeight = SCREEN_HEIGHT * 0.88;

  console.log('[SHEET LAYOUT] Heights calculated:', {
    screenHeight: SCREEN_HEIGHT,
    sheetMaxHeight,
  });
  const dynamicSheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
    height: sheetMaxHeight,
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

  // Shared handler: analyze and navigate to match/generate flow (accounts for quick scan selections)
  const handleAnalyzeAndNavigate = React.useCallback(async () => {
    if (isAnalyzeInFlightRef.current) {
      return;
    }
    isAnalyzeInFlightRef.current = true;
    onSaveDraft?.();
    onClose();
    const firstPhotos = bulkItems.map(item => item.photos[0]).filter(Boolean);
    if (firstPhotos.length === 0) {
      Alert.alert('No Photos', 'Please take some photos first before searching.');
      isAnalyzeInFlightRef.current = false;
      return;
    }

    onStartBroadSearch();

    const loadingStates: Record<string, ItemLoadingState> = {};
    bulkItems.forEach(item => {
      if (item.photos.length > 0) {
        loadingStates[item.id] = { isLoading: true, stage: 'Processing...' };
      }
    });
    setItemLoadingStates(loadingStates);

    try {
      const mergedConfirmedQuickMatch = { ...confirmedQuickMatchByItemId };
      bulkItems.forEach(item => {
        if (item.preSelectedSource) {
          mergedConfirmedQuickMatch[item.id] = {
            serpApiData: [item.preSelectedSource],
            preSelectedIndices: [0],
            source: 'quick_scan_confirmed',
          };
        }
      });

      const queueEntries = bulkItems.map((item, index) => {
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

        onSubmitItemsForProcessing?.(bulkItems.map((item) => ({ id: item.id })));
        const itemsForGenerate = bulkItems.map((item, index) => {
          const selectedCandidate = queueEntries[index]?.selectedCandidate;
          return {
            index,
            title: item.title || selectedCandidate?.title || `Item ${index + 1}`,
            thumb: item.photos?.[0]?.uri || selectedCandidate?.image || selectedCandidate?.thumbnail || '',
            matchesCount: 1,
            matchJobId: undefined,
          };
        });

        navigation.navigate('LoadingScreen', {
          processType: 'generate',
          payload: {
            jobId: directJobId,
            firstPhotos,
            bulkItems,
          },
          onCompleteRoute: {
            screen: 'GenerateDetailsScreen',
            params: {
              jobId: directJobId,
              matchJobId: '',
              items: itemsForGenerate,
              jobMap: {},
              userImagesByIndex,
            },
          },
        });
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
        onSubmitItemsForProcessing?.(bulkItems.map((item) => ({ id: item.id })));
        navigation.navigate('LoadingScreen', {
          processType: 'generate',
          payload: {
            jobId: directJobId,
            firstPhotos,
            bulkItems,
          },
          onCompleteRoute: {
            screen: 'GenerateDetailsScreen',
            params: {
              jobId: directJobId,
              matchJobId: '',
              items: bulkItems.map((item, index) => ({
                index,
                title: item.title || queueEntries[index]?.selectedCandidate?.title || `Item ${index + 1}`,
                thumb: item.photos?.[0]?.uri || queueEntries[index]?.selectedCandidate?.image || queueEntries[index]?.selectedCandidate?.thumbnail || '',
                matchesCount: 1,
                matchJobId: undefined,
              })),
              jobMap: {},
              userImagesByIndex,
            },
          },
        });
        return;
      }

      const jobResponseData: JobResponse = await performAnalyze(
        analyzeFirstPhotos,
        analyzeQuickMatchHints,
        analyzeItems,
      );
      console.log('[ANALYZE] Job Response:', jobResponseData);
      setJobResponse(jobResponseData);
      const jobId = jobResponseData?.jobId;

      if (jobId) {
        onSubmitItemsForProcessing?.(bulkItems.map((item) => ({ id: item.id })));
        const itemsForGenerate = bulkItems.map((item, index) => ({
          index,
          title: item.title || queueEntries[index]?.selectedCandidate?.title || `Item ${index + 1}`,
          thumb: item.photos?.[0]?.uri || queueEntries[index]?.selectedCandidate?.image || queueEntries[index]?.selectedCandidate?.thumbnail || '',
          matchesCount: directGenerateEntries.some((entry) => entry.originalIndex === index) ? 1 : 0,
          matchJobId: analyzeEntries.some((entry) => entry.originalIndex === index) ? jobId : undefined,
        }));
        const jobMap = directJobId
          ? Object.fromEntries(
              directGenerateEntries.map((entry) => [
                entry.originalIndex,
                { jobId: directJobId as string, status: directJobResponse?.status },
              ])
            )
          : {};
        const resultIndexMap = Object.fromEntries(
          analyzeEntries.map((entry, analyzeIndex) => [analyzeIndex, entry.originalIndex])
        );

        navigation.navigate('LoadingScreen', {
          processType: 'match',
          payload: {
            jobId,
            bulkItems: analyzeEntries.map((entry) => entry.item),
            firstPhotos: analyzeFirstPhotos,
            confirmedQuickMatchByItemId: analyzeQuickMatchHints,
            skipMatchSelection: true,
            autoGenerateAllPlatforms: true,
            resultIndexMap,
          },
          onCompleteRoute: {
            screen: 'GenerateDetailsScreen',
            params: {
              jobId: '',
              status: 'processing',
              results: [],
              summary: [],
              completedAt: '',
              matchJobId: jobId,
              items: itemsForGenerate,
              jobMap,
              userImagesByIndex,
            },
          },
        });
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
    <Animated.View style={[styles.bulkItemsSheet, dynamicSheetStyle]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 84 : 0}
      >
        {/* Drag Handle */}
        <PanGestureHandler
          onGestureEvent={(event) => {
            const { translationY } = event.nativeEvent;
            const minY = 0; // Fully visible
            const maxY = SCREEN_HEIGHT * 0.5; // Drag down before close
            const currentY = sheetTranslateY.value;

            // Calculate new position based on drag
            const newY = Math.max(minY, Math.min(maxY, currentY + translationY * 0.5));
            sheetTranslateY.value = newY;
          }}
          onHandlerStateChange={(event) => {
            if (event.nativeEvent.state === State.END) {
              const { velocityY } = event.nativeEvent;

              // Snap to positions based on velocity
              if (velocityY > 500) {
                // Prevent accidental auto-close from gesture noise; explicit Exit handles closing.
                sheetTranslateY.value = withSpring(0);
              } else if (velocityY < -500) {
                // Fast upward swipe - expand to fully visible
                sheetTranslateY.value = withSpring(0);
              } else {
                // Snap to nearest position
                const currentY = sheetTranslateY.value;
                const midPoint = SCREEN_HEIGHT * 0.25;

                if (currentY < midPoint) {
                  // Closer to top - stay fully visible
                  sheetTranslateY.value = withSpring(0);
                } else {
                  // Closer to bottom - default open
                  sheetTranslateY.value = withSpring(0);
                }
              }
            }
          }}
        >
          <Animated.View style={styles.dragHandle}>
            <TouchableOpacity onPress={onClose} style={styles.dragHandleButton}>
              <View style={styles.dragHandleBar} />
            </TouchableOpacity>
          </Animated.View>
        </PanGestureHandler>

        <View style={styles.sheetHeader}>
        <View style={styles.sheetHeaderSpacer} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={styles.sheetTitle}>
            {totalItems === 0
              ? (cameraMode === 'shelf' ? 'Scan a shelf' : 'Ready to Create Items')
              : `Analyze & List ${totalItems} New Item${totalItems > 1 ? 's' : ''}`
            }
          </Text>
          <Text style={{ marginTop: 2, fontSize: 12, color: '#64748B', fontWeight: '600' }}>
            {totalItems}/{MAX_BATCH_ITEMS}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          style={styles.exitButton}
          activeOpacity={0.8}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name="close" size={18} color="#64748B" />
          <Text style={styles.exitButtonText}>Exit</Text>
        </TouchableOpacity>

        {/* New Item button
        <TouchableOpacity style={styles.headerNewItemButton} onPress={onAddNewItem}>
          <Icon name="plus" size={20} color="#93C822" />
        </TouchableOpacity>
         */}
        </View>


        {/* Main Camera View */}
        <View style={styles.sheetContent}>


        <Text style={styles.sheetSubtitle}>
          {totalItems === 0
            ? (cameraMode === 'shelf' ? 'One photo, we detect all items' : 'Take a photo to automatically create your first item')
            : ''
          }
        </Text>

        {/* Scrollable Items Container */}
        <ScrollView
          style={[
            styles.itemsScrollContainer,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
          contentContainerStyle={[
            styles.scrollContent,
            {
              flexGrow: 1,
              paddingBottom: scrollBottomPadding,
            }
          ]}
        >
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

              console.log('[RENDER] Showing EMPTY STATE (no items to display)');
              return (
                <TouchableOpacity
                  style={{ padding: 20, alignItems: 'center' }}
                  onPress={onImageUpload}
                  activeOpacity={0.8}
                >
                  <Icon name="camera-plus-outline" size={48} color="#ccc" />
                  <Text style={{ marginTop: 12, fontSize: 16, color: '#666', textAlign: 'center' }}>
                    {cameraMode === 'shelf' ? 'Scan multiple items' : 'Take your first photo to get started'}
                  </Text>
                  <Text style={{ marginTop: 4, fontSize: 14, color: '#999', textAlign: 'center' }}>
                    {cameraMode === 'shelf' ? 'Tap to capture' : 'Tap to take or upload a photo'}
                  </Text>
                </TouchableOpacity>
              );
            })()
          ) : (
            (() => {
              console.log('[RENDER] Showing', displayItems.length, 'ITEMS');
              return (
                <>
                  {displayItems.map((item, id) => {
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
                    const selectedMatchLabel = isLocalInventoryMatch
                      ? 'Already in Inventory'
                      : confirmedMatch
                        ? (matchInfo?.source === 'quick_scan_auto' ? 'Auto-selected Match' : 'Selected Match')
                        : `${matchCount} Match${matchCount > 1 ? 'es' : ''} Found`;
                    const countDraft = countDraftByItemId[item.id] ?? String(item.quantity ?? 1);

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
                      <TouchableOpacity
                        key={`bulk-item-${item.id}`}
                        style={[
                          styles.bulkItemContainer,
                          item.isActive && styles.activeItemContainer,
                          { backgroundColor: item.isActive ? '#e8f5e8' : '#ffffff' }
                        ]}
                        onPress={() => onSelectItem(item.id)}
                      >
                        <View style={styles.itemHeader}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <Text style={[styles.itemLabel, item.isActive && styles.activeItemLabel]} numberOfLines={1}>
                              Item {id + 1}
                            </Text>
                            {item.quantity != null && item.quantity > 1 && (
                              <View style={{ backgroundColor: '#93C822', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 }}>
                                <Text style={{ fontSize: 11, color: 'white', fontWeight: '600' }}>x{item.quantity}</Text>
                              </View>
                            )}
                            {item.isActive && (
                              <View style={styles.activeItemBadge}>
                                <Text style={styles.activeItemBadgeText}>ACTIVE</Text>
                              </View>
                            )}
                          </View>
                          {loadingState?.isLoading ? (
                            <View style={styles.loadingBadge}>
                              <UnicodeSpinner
                                spinner={(spinners.braillewave || spinners.dots) as UnicodeSpinnerDefinition}
                                color="#93C822"
                                size={12}
                              />
                              <Text style={styles.loadingBadgeText}>{loadingState.stage}</Text>
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.photoSlotsContainer}>
                          {item.photos.map((photo: CapturedPhoto, photoIndex: number) => (
                            <View key={`photo-${item.id}-${photo.id}`} style={styles.photoSlotWrapper}>
                              <TapGestureHandler
                                numberOfTaps={2}
                                onHandlerStateChange={(event) => {
                                  if (event.nativeEvent.state === State.ACTIVE) {
                                    onSetCoverPhoto(item.id, photo.id);
                                  }
                                }}
                              >
                                <Animated.View style={[styles.photoSlot, photo.isCover && styles.coverPhotoSlot]}>
                                  <TouchableOpacity
                                    style={StyleSheet.absoluteFill}
                                    onPress={() => onOpenPhotoModal?.(item.id)}
                                    onLongPress={() => {
                                      Alert.alert(
                                        'Photo Options',
                                        `Photo ${photoIndex + 1}${photo.isCover ? ' (Cover)' : ''}`,
                                        [
                                          { text: 'Set as Cover', onPress: () => onSetCoverPhoto(item.id, photo.id) },
                                          { text: 'Remove from Item', onPress: () => onRemovePhoto(item.id, photo.id) },
                                          { text: 'Cancel', style: 'cancel' },
                                        ]
                                      );
                                    }}
                                  >
                                    <Image source={{ uri: photo.uri }} style={styles.photoSlotImage} />
                                    <View style={styles.photoSlotNumberBadge}>
                                      <Text style={styles.photoSlotNumberBadgeText}>{photoIndex + 1}</Text>
                                    </View>
                                    {photo.isCover && (
                                      <View style={[styles.photoSlotLabel, styles.coverPhotoLabel]}>
                                        <Text style={styles.photoSlotLabelText}>COVER</Text>
                                      </View>
                                    )}
                                  </TouchableOpacity>
                                </Animated.View>
                              </TapGestureHandler>
                              <TouchableOpacity
                                style={styles.bulkPhotoDeleteButton}
                                onPress={() => onRemovePhoto(item.id, photo.id)}
                                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                                activeOpacity={1}
                              >
                                <Icon name="close-circle" size={18} color="#ff4444" />
                              </TouchableOpacity>
                            </View>
                          ))}

                          {item.photos.length < 12 && (
                            <TouchableOpacity style={styles.addPhotoButton} onPress={onImageUpload}>
                              <Icon name="camera-plus-outline" size={20} color="#999" />
                              <Text style={styles.addPhotoText}>Add Photo</Text>
                            </TouchableOpacity>
                          )}
                        </View>

                        {item.photos.length >= 12 && (
                          <Text style={styles.maxPhotosText}>Maximum 12 photos per item</Text>
                        )}

                        {loadingState?.isLoading ? (
                          <View style={styles.matchSkeletonCard}>
                            <View style={styles.matchSkeletonThumb} />
                            <View style={{ flex: 1 }}>
                              <View style={styles.matchSkeletonLineShort} />
                              <View style={styles.matchSkeletonLineLong} />
                            </View>
                          </View>
                        ) : loadingState?.error ? (
                          <View style={styles.matchErrorCard}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.matchErrorTitle}>Match failed</Text>
                              <Text style={styles.matchErrorText} numberOfLines={2}>{loadingState.error}</Text>
                            </View>
                            <TouchableOpacity
                              style={styles.matchActionPillDanger}
                              onPress={(e) => {
                                e.stopPropagation?.();
                                onRetryItemScan?.(item.id);
                              }}
                            >
                              <Text style={styles.matchActionPillDangerText}>Retry</Text>
                            </TouchableOpacity>
                          </View>
                        ) : selectedMatch ? (
                          <TouchableOpacity
                            style={[
                              styles.selectedMatchCard,
                              isLocalInventoryMatch && styles.selectedMatchCardLocalInventory,
                            ]}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              if (isLocalInventoryMatch) {
                                onOpenLocalMatch?.(item.id);
                                return;
                              }
                              onOpenQuickMatches?.(item.id);
                            }}
                          >
                            {selectedMatchImage ? (
                              <Image source={{ uri: selectedMatchImage }} style={styles.selectedMatchImage} />
                            ) : (
                              <View style={[styles.selectedMatchImage, { backgroundColor: '#E2E8F0' }]} />
                            )}
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <Text style={[
                                styles.selectedMatchLabel,
                                isLocalInventoryMatch && styles.selectedMatchLabelLocalInventory,
                              ]}>
                                {selectedMatchLabel}
                              </Text>
                              <Text style={styles.selectedMatchTitle} numberOfLines={1}>{selectedMatchTitle}</Text>
                              {isLocalInventoryMatch ? (
                                <Text style={styles.selectedMatchSubtitle} numberOfLines={1}>
                                  Open stock details and clear it from this queue.
                                </Text>
                              ) : null}
                            </View>
                            <View style={[styles.matchActionPill, isLocalInventoryMatch && styles.matchActionPillLocalInventory]}>
                              <Text style={[styles.matchActionPillText, isLocalInventoryMatch && styles.matchActionPillLocalInventoryText]}>
                                {isLocalInventoryMatch ? 'View' : (confirmedMatch ? 'Manage' : 'Review')}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ) : (
                          <View style={styles.noMatchCard}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.noMatchTitle}>No quick match yet.</Text>
                              <Text style={styles.noMatchHint}>Deep analysis will keep searching, or retake cover photo.</Text>
                            </View>
                            <TouchableOpacity style={[styles.matchActionPill, styles.matchActionPillDisabled]} disabled={true}>
                              <Text style={[styles.matchActionPillText, styles.matchActionPillDisabledText]}>Find Match</Text>
                            </TouchableOpacity>
                          </View>
                        )}

                        <View style={styles.itemFooterRow}>
                          {bulkItems.length > 0 && (
                            <TouchableOpacity
                              style={styles.itemFooterRemoveButton}
                              onPress={(e) => {
                                e.stopPropagation?.();
                                onDeleteItem(item.id);
                              }}
                            >
                              <Icon name="trash-can-outline" size={16} color="#991B1B" />
                              <Text style={styles.itemFooterRemoveText}>Remove</Text>
                            </TouchableOpacity>
                          )}
                          <View style={styles.itemFooterCountBlock}>
                            <Text style={styles.itemFooterCountLabel}>Count: </Text>
                            <TextInput
                              value={countDraft}
                              onChangeText={(text) => handleCountDraftChange(item.id, text)}
                              onBlur={() => commitCountDraft(item.id)}
                              onEndEditing={() => commitCountDraft(item.id)}
                              style={styles.itemFooterCountInput}
                              keyboardType={Platform.OS === 'ios' ? 'decimal-pad' : 'numeric'}
                              inputMode="decimal"
                              returnKeyType="done"
                              placeholder="1"
                              placeholderTextColor="#94A3B8"
                            />
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </>
              );
            })()
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
          <View style={[styles.bottomActions, { paddingBottom: bottomMargin, flexDirection: 'column', gap: 6 }]}>
            {totalItems >= 1 && (cameraMode === 'shelf' || cameraMode === 'camera') && (
              <TouchableOpacity
                style={[styles.newItemButton, totalItems >= MAX_BATCH_ITEMS && { opacity: 0.45 }]}
                onPress={onAddNewItem}
                disabled={totalItems >= MAX_BATCH_ITEMS}
              >
                <Icon name="plus" size={18} color="#666" />
                <Text style={styles.newItemButtonText}>
                  {totalItems >= MAX_BATCH_ITEMS ? 'Item Limit Reached' : 'Add Item'}
                </Text>
              </TouchableOpacity>
            )}
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
                  handleAnalyzeAndNavigate();
                }
              }}
            >
              {hasLoadingItems ? (
                <UnicodeSpinner
                  spinner={{ frames: ['■□■', '□■□', '▪□▪', '□▪□'], interval: 180 }}
                  color="#FFFFFF"
                  size={12}
                  style={{ marginRight: 8 }}
                />
              ) : (
                <Icon
                  name="rocket-launch-outline"
                  size={20}
                  color="white"
                />
              )}
              <Text style={[styles.searchForProductButtonText, { marginLeft: 8 }]}>
                {cameraMode === 'shelf' && totalItems > 0
                    ? `Take Photos for ${totalItems} Item${totalItems > 1 ? 's' : ''}`
                    : cameraMode !== 'shelf' && totalItems === 0
                      ? 'Take a photo to continue'
                      : hasLoadingItems
                        ? 'Analyzing...'
                        : `Analyze & List ${totalItems} Items`}
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
    top: SCREEN_HEIGHT * 0.12,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    paddingBottom: 20,
    marginBottom: 0,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
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
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 10,
    gap: 8,
  },
  newItemButtonText: {
    fontSize: 16,
    color: '#666',
    fontWeight: '500',
  },
  searchForProductButton: {
    backgroundColor: '#93C822',
    borderRadius: 12,
    paddingVertical: 16,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  searchForProductButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
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
    borderTopColor: '#eee',
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
    borderColor: '#E2E8F0',
    backgroundColor: '#F2F2F7',
    flexDirection: 'row',
    alignItems: 'center',
  },
  exitButtonText: {
    color: '#64748B',
    fontWeight: '600',
    marginLeft: 6,
    fontSize: 15,
  },
  sheetHeaderSpacer: {
    minWidth: 72,
    minHeight: 34,
  },
});

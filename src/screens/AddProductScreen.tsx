import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  SafeAreaView,
  Dimensions,
  Platform,
  Alert,
  StatusBar,
  Pressable,
  Clipboard,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Camera, CameraView, CameraType, FlashMode, BarcodeScanningResult } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { decode as base64Decode } from 'base64-arraybuffer';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  runOnJS,
  cancelAnimation,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  withRepeat,
} from 'react-native-reanimated';
import { PanGestureHandler, TapGestureHandler, State, PanGestureHandlerGestureEvent } from 'react-native-gesture-handler';
import { useTheme } from '../context/ThemeContext';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { MaterialIcons } from '@expo/vector-icons';

import { useNavigation, useRoute, useIsFocused, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { SvgXml } from 'react-native-svg';
import PhotoStack, { CapturedPhoto } from '../components/camera/PhotoStack';
import ViewPhotosModal from '../components/camera/ViewPhotosModal';
import CameraControls from '../components/camera/CameraControls';
import BusinessTemplateModal, { BusinessTemplate } from '../components/camera/BusinessTemplateModal';
import ItemNavigationBar from '../components/camera/ItemNavigationBar';
import QuickProductDetailSheet from '../components/QuickProductDetailSheet';
import ManifestReviewSheet from '../components/ManifestReviewSheet';
import ReceiptReviewSheet from '../components/ReceiptReviewSheet';
import TierSelectorModal from '../components/TierSelectorModal';
import UsageCounter from '../components/UsageCounter';
import useFreemiumUsage from '../hooks/useFreemiumUsage';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import BarcodeEntrySheet from '../components/camera/BarcodeEntrySheet';
import EventSource from "react-native-sse";
import { ENABLE_DOC_MODES } from '../config/features';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { PricingResearchModal } from '../components/PricingResearchModal';
import {
  startTrace,
  getTraceHeaders,
  logFlowEvent,
  FlowEvents,
} from '../lib/mobileFlowLogger';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BULK_MODAL_FTUX_KEY = '@anorha_hasSeenBulkItemsModal';
const MAX_BATCH_ITEMS = 100;
const QUICK_SCAN_QUEUE_LIMIT = 100;

// Types

export interface Analysis {
  jobId: string;
  userId: string;
  status: string;
  currentStage: string;
  progress: {
    totalProducts: number;
    completedProducts: number;
    currentProductIndex: number;
    failedProducts: number;
    stagePercentage: number;
  };
  results: Array<{
    productIndex: number;
    productId: string;
    variantId: string;
    serpApiData: Array<{
      position?: number;
      title?: string;
      link?: string;
      source?: string;
      source_icon?: string;
      thumbnail?: string;
      thumbnail_width?: number;
      thumbnail_height?: number;
      image?: string;
      image_width?: number;
      image_height?: number;
      rating?: number;
      reviews?: number;
      price?: {
        value?: string;
        extracted_value?: number;
        currency?: string;
      };
      condition?: string;
      in_stock?: boolean;
    }>;
    rerankedResults: Array<{
      position?: number;
      title?: string;
      link?: string;
      source?: string;
      source_icon?: string;
      thumbnail?: string;
      thumbnail_width?: number;
      thumbnail_height?: number;
      image?: string;
      image_width?: number;
      image_height?: number;
      rank?: number;
      score?: number;
      rating?: number;
      reviews?: number;
      price?: {
        value?: string;
        extracted_value?: number;
        currency?: string;
      };
      condition?: string;
      in_stock?: boolean;
    }>;
    confidence: string; // Changed from number to string based on the JSON example
    vectorSearchFoundResults: boolean;
    originalTargetImage: string;
    timing: {
      quickScanMs: number;
      serpApiMs: number;
      embeddingMs: number;
      vectorSearchMs: number;
      rerankingMs: number;
      totalMs: number;
    };
  }>;
  startedAt: string;
  updatedAt: string;
  summary: {
    highConfidenceCount: number;
    mediumConfidenceCount: number;
    lowConfidenceCount: number;
    totalEmbeddingsStored: number | null;
    averageProcessingTimeMs: number | null;
  };
  completedAt: string;
}

interface MatchCandidate {
  id: string;
  title: string;
  description: string;
  price: number;
  imageUrl: string;
  matchPercentage: number;
  sourceUrl: string;
  estimatedShippingMin?: number;
  estimatedShippingMax?: number;
  estimatedShippingMidpoint?: number;
  estimatedShippingLabel?: string;
  pricingResearch?: any;
}

interface JobResponse {
  jobId: string;
  status: string;
  estimatedTimeMinutes: number,
  totalProducts: number,
  message: string,
}

interface MatchResponse {
  systemAction: 'show_single_match' | 'show_multiple_matches' | 'show_multiple_candidates' | 'fallback_to_manual';
  confidence: 'high' | 'medium' | 'low';
  rankedCandidates: MatchCandidate[];
  totalMatches: number;
  reranker?: {
    type: 'llama4-groq' | 'jina-modal' | 'fast-text' | 'none';
    rankingMethod?: 'exact_match' | 'semantic_similarity' | 'fuzzy_match' | 'vector_fallback';
    confidence?: number;
    reasoning?: string;
    processingTimeMs?: number;
    alternatives?: any[];
  };
}

type ItemLoadingState = {
  isLoading: boolean;
  stage: string;
  error?: string;
};

type AddProductScreenProps = StackScreenProps<AppStackParamList, 'AddProduct'>;

type CameraInstruction =
  | 'ready'
  | 'move_closer'
  | 'move_back'
  | 'add_light'
  | 'focus'
  | 'processing'
  | 'matches_found'
  | 'no_matches'
  | 'barcode_scanned'
  | 'analyzing'
  | 'extracting'
  | 'optimizing'
  | 'searching'
  | 'capturing'
  | 'recognizing'
  | 'matched'
  | 'needs_review';

type CameraMode = 'camera' | 'barcode' | 'manifest' | 'receipt' | 'shelf';

const AddProductScreen: React.FC<AddProductScreenProps | {}> = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const theme = useTheme();
  const rawParams = (route.params ?? {}) as any;
  const params = ((rawParams?.params && typeof rawParams.params === 'object') ? rawParams.params : rawParams) as { sessionId?: string; firstPhotos?: any[]; bulkItems?: any[] };
  const sessionIdParam = params?.sessionId;

  const sessionIdRef = useRef<string | null>(null);
  const shelfPhotoUriForDraftRef = useRef<string | null>(null);
  const saveDraftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSessionCreatePromiseRef = useRef<Promise<string | null> | null>(null);

  console.log('[RENDER] AddProductScreen rendered');

  // Camera state
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraMode, setCameraMode] = useState<'camera' | 'barcode' | 'manifest' | 'receipt' | 'shelf'>('camera');

  // Barcode state
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [barcodeNotificationCount, setBarcodeNotificationCount] = useState(0);
  const [barcodeSearchResult, setBarcodeSearchResult] = useState<any | null>(null);
  const [barcodeSearching, setBarcodeSearching] = useState(false);
  const [showBarcodeResultModal, setShowBarcodeResultModal] = useState(false);
  const [platformLocations, setPlatformLocations] = useState<{ id: string; name: string; platformType?: string; connectionId: string }[]>([]);
  const [manualBarcode, setManualBarcode] = useState('');
  const [showBarcodeEntry, setShowBarcodeEntry] = useState(false);
  const [barcodeEntryError, setBarcodeEntryError] = useState<string | null>(null);

  // Manifest state
  const [showManifestSheet, setShowManifestSheet] = useState(false);
  const [manifestJobId, setManifestJobId] = useState<string | null>(null);

  // Receipt state
  const [showReceiptSheet, setShowReceiptSheet] = useState(false);
  const [receiptJobId, setReceiptJobId] = useState<string | null>(null);

  // Shelf state
  const [shelfPhotoUri, setShelfPhotoUri] = useState<string | null>(null);
  const [isProcessingShelfScan, setIsProcessingShelfScan] = useState(false);

  // Fetch platform locations on mount (with platformType from connections)
  useEffect(() => {
    const fetchLocations = async () => {
      try {
        // Fetch locations with their connection's platformType
        const { data, error } = await supabase
          .from('PlatformLocations')
          .select('Id, Name, PlatformLocationId, PlatformConnectionId, PlatformConnections!inner(PlatformType)');
        if (data) {
          setPlatformLocations(data.map((l: any) => ({
            id: l.PlatformLocationId || l.Id,
            name: l.Name,
            platformType: l.PlatformConnections?.PlatformType,
            connectionId: l.PlatformConnectionId,
          })));
        }
      } catch (e) {
        console.error('[AddProduct] Error fetching locations:', e);
      }
    };
    fetchLocations();
  }, []);

  // Hydrate from draft session when sessionId param is present
  const isHydratingRef = useRef(false);
  useEffect(() => {
    if (!sessionIdParam || isHydratingRef.current) return;
    let cancelled = false;
    isHydratingRef.current = true;
    (async () => {
      try {
        const token = await ensureSupabaseJwt();
        const API_BASE = (process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app').replace(/\/+$/, '');
        const res = await fetch(`${API_BASE}/api/products/quick-scan-sessions/${sessionIdParam}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const session = await res.json();
        const items = session.ScannedItems ?? session.scannedItems ?? [];
        const matchCtx = session.MatchContext ?? session.matchContext ?? {};
        const shelfUri = session.ShelfPhotoUri ?? session.shelfPhotoUri ?? null;
        const activeId = session.ActiveItemId ?? session.activeItemId ?? null;
        if (items.length > 0 && !cancelled) {
          setBulkItems(items);
          setQuickScanStore(matchCtx);
          setShelfPhotoUri(shelfUri);
          setActiveItemId(activeId || items[0]?.id || null);
          setIsBulkMode(true);
          setCameraMode('shelf');
          setShowDeepSearchSheet(true);
          sheetTranslateY.value = withSpring(0);  // Fully visible, bottom aligned to screen
          sessionIdRef.current = session.Id ?? session.id ?? sessionIdParam;
          if (shelfUri) shelfPhotoUriForDraftRef.current = shelfUri;
        }
      } catch (e) {
        console.error('[AddProduct] Hydrate draft failed:', e);
      } finally {
        if (!cancelled) isHydratingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [sessionIdParam]);

  // Save draft to backend (create or update)
  const ensureDraftSessionId = useCallback(async (payload: { scannedItems: any[]; matchContext: Record<string, any>; shelfPhotoUri?: string | null; activeItemId?: string | null }): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (draftSessionCreatePromiseRef.current) return draftSessionCreatePromiseRef.current;

    draftSessionCreatePromiseRef.current = (async () => {
      const token = await ensureSupabaseJwt();
      const API_BASE = (process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app').replace(/\/+$/, '');
      const res = await fetch(`${API_BASE}/api/products/quick-scan-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const newSessionId = data.Id ?? data.id ?? null;
      if (newSessionId) {
        sessionIdRef.current = newSessionId;
      }
      return newSessionId;
    })();

    try {
      return await draftSessionCreatePromiseRef.current;
    } finally {
      draftSessionCreatePromiseRef.current = null;
    }
  }, []);

  const saveDraftToBackend = useCallback(async (payload: { scannedItems: any[]; matchContext: Record<string, any>; shelfPhotoUri?: string | null; activeItemId?: string | null }) => {
    if (isHydratingRef.current) return;
    try {
      const token = await ensureSupabaseJwt();
      const API_BASE = (process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app').replace(/\/+$/, '');
      let sid = sessionIdRef.current;
      if (!sid) {
        sid = await ensureDraftSessionId(payload);
      }
      if (!sid) return;

      await fetch(`${API_BASE}/api/products/quick-scan-sessions/${sid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...payload }),
      });
    } catch (e) {
      console.warn('[AddProduct] Save draft failed:', e);
    }
  }, [ensureDraftSessionId]);

  // UI state
  const [currentInstruction, setCurrentInstruction] = useState<CameraInstruction>('ready');
  const [showMatchSheet, setShowMatchSheet] = useState(false);
  const [showViewPhotosModal, setShowViewPhotosModal] = useState(false);
  const [showDeepSearchSheet, setShowDeepSearchSheet] = useState(false);
  const [hasSeenBulkModalFtux, setHasSeenBulkModalFtux] = useState<boolean | null>(null);
  const [matchData, setMatchData] = useState<MatchResponse | null>(null);
  // Quick scan storage per item and current sheet context
  const [quickScanStore, setQuickScanStore] = useState<Record<string, { matchData: MatchResponse; serpApiData: any[] }>>({});
  const [currentMatchItemId, setCurrentMatchItemId] = useState<string | null>(null);
  // Confirmed quick-match per item: when user taps "List Product" we store it so bulk Continue uses it instead of re-searching
  const [confirmedQuickMatchByItemId, setConfirmedQuickMatchByItemId] = useState<Record<string, { serpApiData: any[]; preSelectedIndices: number[] }>>({});

  // Loading state tracking per item
  const [itemLoadingStates, setItemLoadingStates] = useState<Record<string, ItemLoadingState>>({});

  // Bulk mode state
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkItems, setBulkItems] = useState<Array<{
    id: string;
    photos: CapturedPhoto[];
    title?: string;
    isActive?: boolean;
    preSelectedSource?: any;
    quantity?: number;
  }>>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // Debounced auto-save when scan state changes (so drafts appear in Scan Drafts)
  useEffect(() => {
    if (isHydratingRef.current || bulkItems.length === 0) return;
    if (saveDraftTimeoutRef.current) clearTimeout(saveDraftTimeoutRef.current);
    saveDraftTimeoutRef.current = setTimeout(() => {
      saveDraftTimeoutRef.current = null;
      saveDraftToBackend({
        scannedItems: bulkItems,
        matchContext: quickScanStore,
        shelfPhotoUri: shelfPhotoUriForDraftRef.current || shelfPhotoUri,
        activeItemId,
      });
    }, 800);
    return () => { if (saveDraftTimeoutRef.current) clearTimeout(saveDraftTimeoutRef.current); };
  }, [bulkItems, quickScanStore, activeItemId, shelfPhotoUri, saveDraftToBackend]);

  // Auto-scan state
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [quickScanResults, setQuickScanResults] = useState<any[]>([]);

  // Job response state
  const [jobResponse, setJobResponse] = useState<JobResponse | null>(null);
  const quickScanCancelledRef = useRef(false);
  const quickScanQueueRef = useRef<Array<{ photo: CapturedPhoto; itemId: string }>>([]);
  const shelfQueryToItemIdRef = useRef<Record<string, string>>({});
  const hasTriggeredBulkModalFtuxRef = useRef(false);
  const closeRequestIdRef = useRef(0);
  // Track whether we've already opened the sheet for the first scan result
  const hasOpenedSheetForScanRef = useRef(false);

  // Notification and progress state
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [showProgressBar, setShowProgressBar] = useState(false);

  // Freemium / Paywall state
  const { status: freemiumStatus, refresh: refreshFreemiumStatus, incrementLocalUsage } = useFreemiumUsage();
  const [showTierSelector, setShowTierSelector] = useState(false);

  // Experimental Text Search


  // Camera ref
  const cameraRef = useRef<CameraView>(null);
  const isFocused = useIsFocused();

  // Stable item ID generator to prevent key collisions
  const itemIdCounterRef = useRef(0);
  const generateItemId = useCallback(() => {
    itemIdCounterRef.current += 1;
    return `item-${Date.now()}-${itemIdCounterRef.current}`;
  }, []);

  // Debug useEffects to track state changes
  useEffect(() => {
    console.log('[EFFECT] bulkItems changed! New value:', {
      length: bulkItems.length,
      items: bulkItems.map(item => ({
        id: item.id,
        photosCount: item.photos.length,
        isActive: item.isActive
      }))
    });
  }, [bulkItems]);

  useEffect(() => {
    console.log('[EFFECT] activeItemId changed! New value:', activeItemId);
  }, [activeItemId]);


  // Animation values - separate for each modal
  const sheetTranslateY = useSharedValue(SCREEN_HEIGHT);
  const matchSheetTranslateY = useSharedValue(SCREEN_HEIGHT);

  // Force re-render counter for debugging
  const [forceRenderCount, setForceRenderCount] = useState(0);
  const forceRerender = useCallback(() => {
    console.log('[FORCE RENDER] Forcing component re-render');
    setForceRenderCount(prev => prev + 1);
  }, []);
  const captureButtonScale = useSharedValue(1);
  const flashOpacity = useSharedValue(0);
  const overlayOpacity = useSharedValue(0.3);

  // Progress and notification animations
  const progressWidth = useSharedValue(0);
  const spinRotation = useSharedValue(0);
  const notificationOpacity = useSharedValue(0);
  const notificationTranslateY = useSharedValue(-100);

  // Request camera permission on mount
  useEffect(() => {
    (async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  // Show notification function
  const showNotificationMessage = useCallback((message: string, duration: number = 3000) => {
    setNotificationMessage(message);
    setShowNotification(true);

    // Animate in
    notificationOpacity.value = withTiming(1, { duration: 300 });
    notificationTranslateY.value = withTiming(0, { duration: 300 });

    // Auto hide
    setTimeout(() => {
      notificationOpacity.value = withTiming(0, { duration: 300 });
      notificationTranslateY.value = withTiming(-100, { duration: 300 }, () => {
        runOnJS(setShowNotification)(false);
      });
    }, duration);
  }, [notificationOpacity, notificationTranslateY]);

  const canAddAnotherItem = useCallback((currentCount: number) => {
    if (currentCount < MAX_BATCH_ITEMS) return true;
    showNotificationMessage(`Batch limit reached (${MAX_BATCH_ITEMS}/${MAX_BATCH_ITEMS}).`, 2500);
    return false;
  }, [showNotificationMessage]);

  // Start progress bar animation
  const startProgressAnimation = useCallback(() => {
    setShowProgressBar(true);
    progressWidth.value = 0;

    // Spinning circle animation
    spinRotation.value = withRepeat(
      withTiming(360, { duration: 1000 }),
      -1,
      false
    );

    // Progress bar fill animation
    progressWidth.value = withTiming(100, { duration: 2000 });
  }, [progressWidth, spinRotation]);

  // Stop progress bar animation
  const stopProgressAnimation = useCallback(() => {
    setShowProgressBar(false);
    progressWidth.value = 0;
    spinRotation.value = 0;
  }, [progressWidth, spinRotation]);

  // Transform quick-scan ranked candidates to serpApiData for MatchSelection overrides
  const candidatesToSerpApiData = useCallback((candidates: Array<{
    id: string;
    title?: string;
    description?: string;
    price?: number;
    imageUrl?: string;
    sourceUrl?: string;
  }>): any[] => {
    const out: any[] = [];
    candidates.forEach((c, idx) => {
      out.push({
        position: idx + 1,
        title: c.title || 'Unknown Product',
        link: c.sourceUrl || '',
        source: 'quickscan',
        source_icon: '',
        thumbnail: c.imageUrl || '',
        image: c.imageUrl || '',
        price: typeof c.price === 'number' ? { value: `$${c.price}`, extracted_value: c.price, currency: 'USD' } : undefined,
      });
    });
    return out;
  }, []);

  // Instructions mapping
  const getInstructionText = (instruction: CameraInstruction): string => {
    // Throughput-first deterministic labels for intake lifecycle.
    if (cameraMode === 'camera' || cameraMode === 'shelf') {
      if (instruction === 'matches_found' || instruction === 'matched') return 'Matched';
      if (instruction === 'no_matches' || instruction === 'needs_review') return 'Needs review';
      if (
        instruction === 'processing' ||
        instruction === 'analyzing' ||
        instruction === 'extracting' ||
        instruction === 'optimizing' ||
        instruction === 'searching' ||
        instruction === 'recognizing'
      ) {
        return 'Recognizing';
      }
      return 'Capturing';
    }

    switch (instruction) {
      case 'ready':
        if (cameraMode === 'barcode') return 'Scan barcode on product';
        if (cameraMode === 'manifest') return 'Take photos of manifest';
        if (cameraMode === 'receipt') return 'Take photos of receipt';
        return 'Capturing';
      case 'move_closer': return 'Move closer to product';
      case 'move_back': return 'Move back from product';
      case 'add_light': return 'Add more light to scene';
      case 'focus': return 'Tap to focus';
      case 'processing': return 'Recognizing';
      case 'matches_found': return 'Matched';
      case 'no_matches': return 'Needs review';
      case 'barcode_scanned': return scannedBarcode || 'Barcode scanned';
      default: return 'Take photos to get started';
    }
  };

  // Handle focus tap
  const handleFocusTap = useCallback((event: any) => {
    const { locationX, locationY } = event.nativeEvent;
    setCurrentInstruction('focus');

    // TODO: Implement actual focus at coordinates
    console.log('Focus at:', locationX, locationY);

    setTimeout(() => {
      setCurrentInstruction('ready');
    }, 1000);
  }, []);

  // Handle photo capture
  const handleCapture = useCallback(async () => {
    // BARCODE MODE: Open results sheet if we have a result
    if (cameraMode === 'barcode') {
      if (barcodeSearchResult) {
        setShowBarcodeResultModal(true);
      } else {
        Alert.alert('No Result', 'Point the camera at a barcode to scan.');
      }
      return;
    }

    if (!cameraRef.current || isCapturing) return;

    try {
      setIsCapturing(true);
      setCurrentInstruction('processing');

      // Start progress animation
      startProgressAnimation();

      // Animate capture button
      captureButtonScale.value = withSpring(0.8, { duration: 100 }, () => {
        captureButtonScale.value = withSpring(1, { duration: 200 });
      });

      // Flash effect
      if (flash === 'on') {
        flashOpacity.value = withTiming(1, { duration: 100 }, () => {
          flashOpacity.value = withTiming(0, { duration: 200 });
        });
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
      });

      if (photo) {
        const newPhoto: CapturedPhoto = {
          id: `photo-${Date.now()}`,
          uri: photo.uri,
          width: photo.width || SCREEN_WIDTH,
          height: photo.height || SCREEN_HEIGHT,
          timestamp: Date.now(),
          isCover: capturedPhotos.length === 0, // First photo is cover by default
        };

        setCapturedPhotos(prev => {
          const updated = [...prev, newPhoto];
          return updated;
        });

        if (cameraMode === 'shelf' && bulkItems.length === 0) {
          setShelfPhotoUri(newPhoto.uri);
          handleShelfModeScan(newPhoto);
        } else {
          // SIMPLIFIED: Always create real items, regardless of mode
          if (bulkItems.length === 0) {
            // Very first photo ever - create first item
            console.log('[ITEM CREATION] Creating FIRST ITEM (no items exist yet)');
            const firstItem = {
              id: `item-${Date.now()}`,
              photos: [newPhoto],
              title: undefined,
              isActive: true
            };
            setBulkItems([firstItem]);
            setActiveItemId(firstItem.id);
            capture(AnalyticsEvents.PRODUCT_ADDED, { source: 'camera' });
            console.log('[ITEM CREATION] Created first item:', firstItem.id);
            console.log('[ITEM CREATION] Triggering quick scan (first photo of first item)');

            console.log('[FIRST ITEM] Created first item with ID:', firstItem.id);
            setTimeout(() => {
              console.log('[FIRST ITEM] About to call performQuickScan for first item:', firstItem.id);
              performQuickScan(newPhoto, firstItem.id);
            }, 500);

          } else {
            // Use current state (prev) to avoid stale closures. Prefer active item by isActive flag.
            setBulkItems(prev => {
              if (prev.length === 0) {
                // First item
                const firstId = `item-${Date.now()}`;
                setActiveItemId(firstId);
                setTimeout(() => performQuickScan(newPhoto, firstId), 500);
                return [{ id: firstId, photos: [newPhoto], title: undefined, isActive: true }];
              }

              const activeIndex = prev.findIndex(it => it.isActive);
              if (activeIndex >= 0) {
                const activeItemIdLocal = prev[activeIndex].id;
                const next = prev.map((it, idx) => {
                  if (idx !== activeIndex) return it;
                  const wasFirstPhoto = it.photos.length === 0;
                  const updated = { ...it, photos: [...it.photos, newPhoto] };
                  if (wasFirstPhoto) setTimeout(() => performQuickScan(newPhoto, activeItemIdLocal), 500);
                  return updated;
                });
                return next;
              }

              // No active item flagged; create a new active item
              if (!canAddAnotherItem(prev.length)) {
                if (prev[0]) {
                  const fallbackId = prev[0].id;
                  setActiveItemId(fallbackId);
                  setTimeout(() => performQuickScan(newPhoto, fallbackId), 500);
                  return prev.map((it, idx) => {
                    if (idx === 0) {
                      return { ...it, isActive: true, photos: [...it.photos, newPhoto] };
                    }
                    return { ...it, isActive: false };
                  });
                }
                return prev;
              }
              const newId = `item-${Date.now()}`;
              setActiveItemId(newId);
              setTimeout(() => performQuickScan(newPhoto, newId), 500);
              return [...prev.map(it => ({ ...it, isActive: false })), { id: newId, photos: [newPhoto], title: undefined, isActive: true }];
            });
          }

          setCurrentInstruction('ready');
          stopProgressAnimation();
        }
      }

    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
      setCurrentInstruction('ready');
      stopProgressAnimation();
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, capturedPhotos.length, flash, captureButtonScale, flashOpacity, canAddAnotherItem]);

  // Handle barcode scan - with debouncing to prevent duplicates
  const barcodeLastScannedRef = useRef<string | null>(null);
  const barcodeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBarCodeScanned = useCallback((scanningResult: BarcodeScanningResult) => {
    if (cameraMode !== 'barcode' || !scanningResult.data) return;

    // Debounce: Ignore if same barcode scanned within last 2 seconds
    if (barcodeLastScannedRef.current === scanningResult.data) {
      return; // Same barcode, ignore duplicate
    }

    // Clear any existing debounce timer
    if (barcodeDebounceRef.current) {
      clearTimeout(barcodeDebounceRef.current);
    }

    // Set the barcode and lock it for 2 seconds
    barcodeLastScannedRef.current = scanningResult.data;
    setScannedBarcode(scanningResult.data);
    setCurrentInstruction('barcode_scanned');
    setBarcodeNotificationCount(prev => prev + 1);

    console.log('Barcode scanned:', scanningResult.data);

    // Search backend for this barcode (once only)
    searchBarcodeOnBackend(scanningResult.data);

    // Reset the lock after 2 seconds to allow same barcode to be scanned again
    barcodeDebounceRef.current = setTimeout(() => {
      barcodeLastScannedRef.current = null;
      setCurrentInstruction('ready');
    }, 2000);
  }, [cameraMode]);

  // Search backend for product by barcode
  const searchBarcodeOnBackend = useCallback(async (barcode: string) => {
    try {
      setBarcodeSearching(true);
      setCurrentInstruction('processing');
      console.log(`[BARCODE] Searching backend for barcode: ${barcode}`);

      const token = await ensureSupabaseJwt();
      if (!token) {
        Alert.alert('Authentication Error', 'Please log in again.');
        setBarcodeSearching(false);
        setCurrentInstruction('ready');
        return;
      }

      const response = await fetch(
        `https://api.sssync.app/api/products/search-by-barcode?barcode=${encodeURIComponent(barcode)}`,
        {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.log(`[BARCODE] Search returned status ${response.status}`);
        setBarcodeSearching(false);
        setCurrentInstruction('ready');
        return;
      }

      const data = await response.json();

      if (data.error) {
        console.log(`[BARCODE] Product not found: ${data.error}`);
        Alert.alert('Product Not Found', data.error);
        setBarcodeSearching(false);
        setCurrentInstruction('ready');
        return;
      }

      console.log(`[BARCODE] Found product:`, data.variant.Title);
      setBarcodeSearchResult(data);
      setShowBarcodeResultModal(true);
      setBarcodeSearching(false);
      setCurrentInstruction('ready');
    } catch (error) {
      console.error(`[BARCODE] Search error:`, error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      Alert.alert('Search Error', `Failed to search: ${errorMessage}`);
      setBarcodeSearching(false);
      setCurrentInstruction('ready');
    }
  }, []);

  const handleShelfModeScan = useCallback(async (photo: CapturedPhoto) => {
    try {
      shelfPhotoUriForDraftRef.current = photo.uri;
      setCurrentInstruction('processing');
      setIsProcessingShelfScan(true);
      // Open sheet when user takes/uploads shelf photo so they see loading
      setShowDeepSearchSheet(true);
      sheetTranslateY.value = withSpring(0);

      // Compress image before converting to base64
      const compressedImage = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ resize: { width: 1200 } }], // Resize to max 1200px width
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG } // Compress aggressively to reduce payload
      );

      // Convert compressed image to base64
      const response = await fetch(compressedImage.uri);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] || result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const token = await ensureSupabaseJwt();
      const rawApiBase = (process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app').replace(/\/+$/, '');
      const API_BASE = /localhost|127\.0\.0\.1/i.test(rawApiBase) ? 'https://api.sssync.app' : rawApiBase;

      // 1. Establish SSE Connection for Agentic Stream
      console.log(`[SHELF MODE] Starting SSE stream with ${base64.length} bytes`);
      const sseUrl = `${API_BASE}/api/products/orchestrate/quick-scan-stream`;

      const es = new EventSource(sseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          images: [{ base64 }],
          mode: 'vlm-multi'
        })
      });



      es.addEventListener("open", () => {
        console.log("[SSE] Connection opened");
        setCurrentInstruction('processing');
      });

      es.addEventListener("message", (event) => {
        if (!event.data) return;
        try {
          const parsed = JSON.parse(event.data);
          console.log("[SSE] Message Type:", parsed.type);

          if (parsed.type === 'START_ANALYSIS') {
            setCurrentInstruction('analyzing');
            // Clear out prior states if starting fresh
            setBulkItems([]);
            setQuickScanStore({});
            shelfQueryToItemIdRef.current = {};

            // IMMEDIATELY show the sheet so the user sees loading skeletons
            setShowDeepSearchSheet(true);
            sheetTranslateY.value = withSpring(0);  // Fully visible, bottom aligned to screen
          }
          else if (parsed.type === 'EXTRACTED_ITEMS') {
            if (!parsed.items || parsed.items.length === 0) {
              Alert.alert('No Items Found', 'Could not detect any items on this shelf.');
              setCurrentInstruction('ready');
              setIsProcessingShelfScan(false);
              es.close();
              return;
            }
            // Support both formats: items as string[] or Array<{ query, quantity }>
            const items = parsed.items as Array<string | { query: string; quantity?: number }>;
            const newBulkItems = items.map((item: string | { query: string; quantity?: number }, idx: number) => {
              const query = typeof item === 'string' ? item : item.query;
              const quantity = typeof item === 'object' && item.quantity != null ? item.quantity : 1;
              return {
                id: `shelf-${Date.now()}-${idx}`,
                photos: [],
                title: query,
                quantity,
                isActive: idx === 0
              };
            });

            // Store mapping from extracted search string to bulk item ID
            items.forEach((item: string | { query: string; quantity?: number }, idx: number) => {
              const query = typeof item === 'string' ? item : item.query;
              shelfQueryToItemIdRef.current[query] = newBulkItems[idx].id;
            });

            setBulkItems(newBulkItems);
            setIsBulkMode(true);
            setActiveItemId(newBulkItems[0].id);
            setCurrentInstruction('extracting');
          }
          else if (parsed.type === 'OPTIMIZING_QUERIES') {
            setCurrentInstruction('optimizing');
          }
          else if (parsed.type === 'SEARCHING_ITEMS') {
            setCurrentInstruction('searching'); // Show user that we are searching
          }
          else if (parsed.type === 'SEARCH_RESULT') {
            const res = parsed.result;
            // The Original VLM query or type that was returned
            const originalQuery = res.extractedItem?.ocrText || res.extractedItem?.paraphrases?.[0] || res.extractedItem?.type || res.usedQuery;

            const itemId = shelfQueryToItemIdRef.current[originalQuery] || shelfQueryToItemIdRef.current[res.usedQuery];

            if (itemId) {
              // Update bulk item's title and quantity if Groq optimized it / dedup provided quantity
              const quantity = typeof res.quantity === 'number' ? res.quantity : 1;
              setBulkItems(prev => prev.map(item => item.id === itemId ? { ...item, title: res.usedQuery, quantity } : item));

              // Add matches to quickScanStore
              if (res.matches && res.matches.length > 0) {
                setQuickScanStore(prev => ({
                  ...prev,
                  [itemId]: {
                    matchData: {
                      systemAction: 'show_multiple_matches',
                      confidence: res.confidence || 'medium',
                      rankedCandidates: res.matches,
                      totalMatches: res.matches.length
                    },
                    serpApiData: res.matches
                  }
                }));
              }
            }
          }
          else if (parsed.type === 'COMPLETE') {
            setCurrentInstruction('ready');
            setIsProcessingShelfScan(false);
            es.close();

            // Ensure sheet is at a good height upon completion
            sheetTranslateY.value = withSpring(0);  // Fully visible, bottom aligned to screen
          }
          else if (parsed.type === 'ERROR') {
            console.error("[SSE] Agent error:", parsed.message);
            Alert.alert('Scan Error', parsed.message || 'Error processing shelf scan');
            setCurrentInstruction('ready');
            setIsProcessingShelfScan(false);
            es.close();
          }
        } catch (err) {
          console.error("[SSE Parse Error]", err);
        }
      });

      es.addEventListener("error", (event) => {
        console.error("[SSE] Connection error", event);
        setCurrentInstruction('ready');
        setIsProcessingShelfScan(false);
        es.close();
      });

    } catch (error: any) {
      console.error(`[SHELF MODE] Error:`, error);
      Alert.alert('Extraction Error', error?.message || 'Failed to extract items from the image.');
      setCurrentInstruction('ready');
      setIsProcessingShelfScan(false);
    }
  }, [ensureSupabaseJwt]);

  const handleManualBarcodeSubmit = useCallback(async () => {
    const trimmed = manualBarcode.trim();
    if (!trimmed) {
      setBarcodeEntryError('Please enter a barcode.');
      return;
    }

    setBarcodeEntryError(null);
    setScannedBarcode(trimmed);
    setCurrentInstruction('barcode_scanned');
    setShowBarcodeEntry(false);

    await searchBarcodeOnBackend(trimmed);
  }, [manualBarcode, searchBarcodeOnBackend]);

  // Toggle flash mode
  const toggleFlash = useCallback(() => {
    setFlash(current => {
      switch (current) {
        case 'off': return 'on';
        case 'on': return 'auto';
        case 'auto': return 'off';
        default: return 'off';
      }
    });
  }, []);

  // Toggle camera facing
  const toggleFacing = useCallback(() => {
    setFacing(current => current === 'back' ? 'front' : 'back');
  }, []);

  // Get flash icon
  const getFlashIcon = useCallback(() => {
    switch (flash) {
      case 'on': return 'flash';
      case 'auto': return 'flash-auto';
      case 'off': return 'flash-off';
      default: return 'flash-off';
    }
  }, [flash]);

  const handleContinue = useCallback(async () => {
    console.log('[CONTINUE] Button pressed, opening search sheet');
    console.log('[CONTINUE] Current state:', {
      capturedPhotosCount: capturedPhotos.length,
      isBulkMode,
      bulkItemsCount: bulkItems.length,
      activeItemId,
      cameraMode,
      hasBarcodeResult: !!barcodeSearchResult
    });

    // SHELF MODE: identification first, then explicit one-tap transition to listing flow.
    if (cameraMode === 'shelf') {
      if (bulkItems.length === 0) {
        Alert.alert(
          'Shelf Mode',
          'Take or upload one shelf photo first. We will identify items, then move them into listing flow.',
          [{ text: 'OK' }]
        );
        return;
      }
      setCameraMode('camera');
      setCurrentInstruction('capturing');
      setShowMatchSheet(false);
      matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 150 });
      setShowDeepSearchSheet(true);
      sheetTranslateY.value = withSpring(0);
      showNotificationMessage('Moved to listing flow', 1800);
      return;
    }

    // BARCODE MODE: Open barcode result modal if we have a result
    if (cameraMode === 'barcode' && barcodeSearchResult) {
      console.log('[CONTINUE] Barcode mode - opening barcode result modal');
      setShowBarcodeResultModal(true);
      return;
    }

    // MANIFEST MODE: Parse manifest pages
    if (cameraMode === 'manifest') {
      const allPhotos = bulkItems.flatMap(item => item.photos);
      if (allPhotos.length === 0) {
        Alert.alert('No Pages', 'Please capture at least one manifest page first.');
        return;
      }

      console.log('[CONTINUE] Manifest mode - parsing', allPhotos.length, 'pages');
      showNotificationMessage('Parsing manifest...', 10000);

      try {
        // Convert photos to base64 using fetch
        const images = await Promise.all(
          allPhotos.map(async (photo, index) => {
            try {
              // Use fetch to get the image as blob, then convert to base64
              const response = await fetch(photo.uri);
              const blob = await response.blob();
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const result = reader.result as string;
                  // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
                  const base64Data = result.split(',')[1] || result;
                  resolve(base64Data);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              return { base64, filename: `page_${index + 1}.jpg` };
            } catch (e) {
              console.error('[MANIFEST] Failed to read photo:', e);
              return null;
            }
          })
        );

        const validImages = images.filter(Boolean);
        if (validImages.length === 0) {
          throw new Error('Failed to process any images');
        }

        // Call the manifest parsing API
        const jwt = await ensureSupabaseJwt();
        const API_URL = process.env.EXPO_PUBLIC_SSSYNC_BACKEND_URL || 'https://sssync-bknd.onrender.com';

        const response = await fetch(`${API_URL}/products/manifests/parse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt}`,
          },
          body: JSON.stringify({ images: validImages }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('[MANIFEST] Job started:', data.jobId);

        // Show the ManifestReviewSheet with the job ID
        setManifestJobId(data.jobId);
        setShowManifestSheet(true);

        // Clear photos after successful submission
        setBulkItems([]);
        setActiveItemId(null);

      } catch (error: any) {
        console.error('[MANIFEST] Error:', error);
        Alert.alert('Error', error.message || 'Failed to parse manifest');
      }

      return;
    }

    // RECEIPT MODE: Process receipt for inventory intake
    if (cameraMode === 'receipt') {
      const allPhotos = bulkItems.flatMap(item => item.photos);
      if (allPhotos.length === 0) {
        Alert.alert('No Receipts', 'Please capture at least one receipt first.');
        return;
      }

      console.log('[CONTINUE] Receipt mode - processing', allPhotos.length, 'receipts');
      showNotificationMessage('Processing receipt...', 10000);

      try {
        // Convert photos to base64 using fetch
        const images = await Promise.all(
          allPhotos.map(async (photo, index) => {
            try {
              const response = await fetch(photo.uri);
              const blob = await response.blob();
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  const result = reader.result as string;
                  const base64Data = result.split(',')[1] || result;
                  resolve(base64Data);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              return { base64, filename: `receipt_${index + 1}.jpg` };
            } catch (e) {
              console.error('[RECEIPT] Failed to read photo:', e);
              return null;
            }
          })
        );

        const validImages = images.filter(Boolean);
        if (validImages.length === 0) {
          throw new Error('Failed to process any images');
        }

        // Call the receipt parsing API
        const jwt = await ensureSupabaseJwt();
        const API_URL = process.env.EXPO_PUBLIC_SSSYNC_BACKEND_URL || 'https://sssync-bknd.onrender.com';

        const response = await fetch(`${API_URL}/products/receipts/parse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${jwt}`,
          },
          body: JSON.stringify({ images: validImages }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('[RECEIPT] Job started:', data.jobId);

        // Show the ReceiptReviewSheet with the job ID
        setReceiptJobId(data.jobId);
        setShowReceiptSheet(true);

        // Clear photos after successful submission
        setBulkItems([]);
        setActiveItemId(null);

      } catch (error: any) {
        console.error('[RECEIPT] Error:', error);
        Alert.alert('Error', error.message || 'Failed to process receipt');
      }

      return;
    }

    // Always open sheet - it will show empty state if no photos
    setShowMatchSheet(false);
    matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 150 });
    setShowDeepSearchSheet(true);
    sheetTranslateY.value = withSpring(0);  // Fully visible, bottom aligned to screen
  }, [sheetTranslateY, matchSheetTranslateY, capturedPhotos.length, isBulkMode, bulkItems, activeItemId, cameraMode, barcodeSearchResult, showNotificationMessage]);

  // Handle image picker - SIMPLIFIED: Always add to bulkItems
  const handleImageUpload = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need camera roll permissions to upload images.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length) {
      const assets = result.assets;
      console.log('[IMAGE UPLOAD] Adding', assets.length, 'uploaded image(s)');

      // Build CapturedPhoto for each selected asset (no crop frame)
      const newPhotos: CapturedPhoto[] = assets.map((asset, idx) => ({
        id: `upload-${Date.now()}-${idx}`,
        uri: asset.uri,
        width: asset.width || SCREEN_WIDTH,
        height: asset.height || SCREEN_HEIGHT,
        timestamp: Date.now(),
        isCover: false,
      }));

      // SHELF MODE: Route uploaded image to shelf extraction instead of normal bulkItems
      // ONLY if we don't already have items. If we have items, we are likely adding photos to one of them.
      if (cameraMode === 'shelf' && newPhotos.length > 0 && bulkItems.length === 0) {
        console.log('[IMAGE UPLOAD] Shelf mode - routing to handleShelfModeScan');
        const shelfPhoto = newPhotos[0];
        setCapturedPhotos(prev => [...prev, shelfPhoto]);
        setShelfPhotoUri(shelfPhoto.uri);
        handleShelfModeScan(shelfPhoto);
        return;
      }

      if (bulkItems.length === 0) {
        const firstItem = {
          id: `item-${Date.now()}`,
          photos: newPhotos.map((p, i) => ({ ...p, isCover: i === 0 })),
          title: undefined,
          isActive: true
        };
        setBulkItems([firstItem]);
        setActiveItemId(firstItem.id);
        setCapturedPhotos(prev => [...prev, ...newPhotos]);
        if (newPhotos[0]) {
          setTimeout(() => performQuickScan(newPhotos[0], firstItem.id), 500);
        }
      } else if (activeItemId) {
        setBulkItems(prev => prev.map(item => {
          if (item.id !== activeItemId) return item;
          const wasEmpty = item.photos.length === 0;
          const added = newPhotos.map((p, i) => ({ ...p, isCover: wasEmpty && i === 0 }));
          return { ...item, photos: [...item.photos, ...added] };
        }));
        setCapturedPhotos(prev => [...prev, ...newPhotos]);
        const activeItem = bulkItems.find(i => i.id === activeItemId);
        if (activeItem?.photos.length === 0 && newPhotos[0]) {
          setTimeout(() => performQuickScan(newPhotos[0], activeItemId), 500);
        }
      } else {
        if (!canAddAnotherItem(bulkItems.length)) {
          return;
        }
        const newItem = {
          id: `item-${Date.now()}`,
          photos: newPhotos.map((p, i) => ({ ...p, isCover: i === 0 })),
          title: undefined,
          isActive: true
        };
        setBulkItems(prev => [...prev.map(item => ({ ...item, isActive: false })), newItem]);
        setActiveItemId(newItem.id);
        setCapturedPhotos(prev => [...prev, ...newPhotos]);
        if (newPhotos[0]) {
          setTimeout(() => performQuickScan(newPhotos[0], newItem.id), 500);
        }
      }
    }
  }, [bulkItems, activeItemId, cameraMode, canAddAnotherItem]);

  // Copy barcode to clipboard
  const copyBarcodeToClipboard = useCallback(() => {
    if (scannedBarcode) {
      Clipboard.setString(scannedBarcode);
      Alert.alert('Copied', 'Barcode copied to clipboard');
    }
  }, [scannedBarcode]);

  // Legacy photo management functions - no longer needed with simplified bulkItems system
  // (All photo management now happens through bulkItems functions)

  // Drag handlers for photo reordering (still needed for UI feedback)
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);

  const handleDragStart = useCallback((photoId: string) => {
    setDraggedPhotoId(photoId);
    console.log('Drag started for photo:', photoId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedPhotoId(null);
    console.log('Drag ended');
  }, []);

  // Reorder photos within active item (simplified)
  const reorderPhotos = useCallback((fromIndex: number, toIndex: number) => {
    if (activeItemId) {
      setBulkItems(prev => prev.map(item => {
        if (item.id === activeItemId) {
          const newPhotos = [...item.photos];
          const [movedPhoto] = newPhotos.splice(fromIndex, 1);
          newPhotos.splice(toIndex, 0, movedPhoto);
          return { ...item, photos: newPhotos };
        }
        return item;
      }));
    }
  }, [activeItemId]);

  // Get auth headers
  async function getAuthHeaders() {
    try {
      const token = await ensureSupabaseJwt();
      return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
    } catch (error) {
      console.error('Error getting auth headers:', error);
      return {
        'Content-Type': 'application/json',
        // 'Authorization': `Bearer ${token}`, // Uncomment when you have auth
      };
    }
  }

  async function getToken() {
    return await ensureSupabaseJwt();
  }

  // Upload image to Supabase Storage and get public URL
  // Compresses/resizes before upload to reduce storage and egress (Supabase Free Plan)
  const uploadImageToSupabase = useCallback(async (localUri: string, photoId: string): Promise<string> => {
    try {
      console.log('[UPLOAD] Starting upload for:', photoId);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Light compression before upload (0.9 quality, max 1920px) - reduces size with minimal quality loss
      const compressed = await ImageManipulator.manipulateAsync(
        localUri,
        [{ resize: { width: 1920 } }], // Only downscale if wider than 1920px
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );

      // React Native fetch() does not support file:// URIs on Android - use expo-file-system
      let byteArray: Uint8Array;
      if (Platform.OS === 'android') {
        const base64 = await FileSystem.readAsStringAsync(compressed.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const arrayBuffer = base64Decode(base64);
        byteArray = new Uint8Array(arrayBuffer);
      } else {
        const response = await fetch(compressed.uri);
        const arrayBuffer = await response.arrayBuffer();
        byteArray = new Uint8Array(arrayBuffer);
      }

      // Create file name
      const fileName = `${user.id}/${photoId}-${Date.now()}.jpg`;

      const { data, error } = await supabase.storage
        .from('product-images')
        .upload(fileName, byteArray, {
          contentType: 'image/jpeg',
          cacheControl: '86400', // 24h - reduces egress via browser cache
        });

      if (error) {
        console.error('[UPLOAD] Supabase upload error:', error);
        throw error;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('product-images')
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;
      console.log('[UPLOAD] Successfully uploaded to:', publicUrl);

      return publicUrl;
    } catch (error) {
      console.error('[UPLOAD] Failed to upload image:', error);
      throw error;
    }
  }, []);

  // Auto-quick scan when photo is captured
  const performQuickScan = useCallback(async (photo: CapturedPhoto, itemId: string) => {
    if (isAutoScanning) {
      if (quickScanQueueRef.current.length >= QUICK_SCAN_QUEUE_LIMIT) {
        console.log('[QUICK SCAN] Queue limit reached, dropping oldest queued scan');
        quickScanQueueRef.current.shift();
      }
      const alreadyQueued = quickScanQueueRef.current.some(task => task.itemId === itemId && task.photo.id === photo.id);
      if (!alreadyQueued) {
        quickScanQueueRef.current.push({ photo, itemId });
      }
      console.log('[QUICK SCAN] Scan in progress, queued follow-up scan');
      return;
    }

    // New scan starts – clear any previous cancellation
    quickScanCancelledRef.current = false;

    setIsAutoScanning(true);
    setCurrentInstruction('processing');

    // Set loading state for this item
    setItemLoadingStates(prev => ({
      ...prev,
      [itemId]: { isLoading: true, stage: 'Quick Scanning...', error: undefined }
    }));

    let scanErrorMessage: string | null = null;

    try {
      // Ensure auth bridge is ready and we have a Supabase JWT before any network calls
      const tokenMaybe = await ensureSupabaseJwt();
      if (!tokenMaybe) {
        console.warn('[QUICK SCAN] No Supabase JWT available. Are you signed in and the Clerk bridge configured?');
        showNotificationMessage('Sign in required to scan. Please log in and try again.', 3000);
        scanErrorMessage = 'Sign in required';
        setIsAutoScanning(false);
        return;
      }
      console.log('[QUICK SCAN] Starting quick scan for photo:', photo.id);
      console.log('[QUICK SCAN] Photo URI:', photo.uri);
      console.log('[QUICK SCAN] Timestamp:', new Date().toISOString());

      // Upload image to Supabase Storage first
      console.log('[QUICK SCAN] Uploading image to Supabase...');
      const publicImageUrl = await uploadImageToSupabase(photo.uri, photo.id);
      console.log('[QUICK SCAN] Image uploaded to:', publicImageUrl);

      const token = tokenMaybe;

      // Call backend /orchestrate/quick-scan endpoint with env-safe fallback.
      // On physical devices, localhost/127.0.0.1 will fail, so fallback to public API.
      const rawApiBase = (process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app').replace(/\/+$/, '');
      const deviceSafeBase = /localhost|127\.0\.0\.1/i.test(rawApiBase) ? 'https://api.sssync.app' : rawApiBase;
      const quickScanPath = '/api/products/orchestrate/quick-scan';
      const quickScanUrlPrimary = `${deviceSafeBase}${quickScanPath}`;
      const quickScanUrlFallback = `https://api.sssync.app${quickScanPath}`;

      let response: Response;
      try {
        response = await fetch(quickScanUrlPrimary, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            images: [{
              url: publicImageUrl, // Use Supabase public URL instead of local file path
              metadata: {
                id: photo.id,
                timestamp: photo.timestamp,
                width: photo.width,
                height: photo.height
              }
            }],
            // Query general index + eBay explicitly to speed up price-relevant results.
            targetSites: ['general', 'ebay.com'],

            reranker: "llama4-groq", //"reranker": "llama4-groq"  // or "jina-modal" or "fast-text" or "none" 
            mode: "ocr-vlm-search"
          })
        });
      } catch (networkErr) {
        if (quickScanUrlPrimary !== quickScanUrlFallback) {
          console.warn(`[QUICK SCAN] Primary endpoint failed (${quickScanUrlPrimary}), retrying fallback`);
          response = await fetch(quickScanUrlFallback, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              images: [{
                url: publicImageUrl,
                metadata: {
                  id: photo.id,
                  timestamp: photo.timestamp,
                  width: photo.width,
                  height: photo.height
                }
              }],
              targetSites: ['general', 'ebay.com'],
              reranker: "llama4-groq",
              mode: "ocr-vlm-search"
            })
          });
        } else {
          throw networkErr;
        }
      }

      // 🎯 FREEMIUM: Handle 402 Payment Required (free tier exhausted)
      if (response.status === 402) {
        const errorData = await response.json();
        console.log('[QUICK SCAN] Free tier exhausted:', errorData);
        if (errorData.error === 'FREE_TIER_EXHAUSTED') {
          setShowTierSelector(true);
          showNotificationMessage(`Free scans used (${errorData.usageCount}/${errorData.freeLimit}). Upgrade to continue!`, 4000);
          return;
        }
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Increment local usage count on successful scan
      incrementLocalUsage();

      const result = await response.json();

      if (quickScanCancelledRef.current) return;

      console.log('[QUICK SCAN] Received result for item:', itemId);
      console.log('[QUICK SCAN] Full result:', JSON.stringify(result, null, 2));

      // Parse backend response - backend returns results array with matches
      const allMatches = result.results?.flatMap((r: any) => r.matches) || result.matches || result.quickScanMatches || [];
      const rerankerMeta = result.results?.[0]?.rerankerAnalysis;
      const quickScanResult = {
        recommendedAction: result.recommendedAction || 'show_multiple_matches',
        overallConfidence: result.overallConfidence || 'medium'
      };

      if (allMatches.length > 0) {
        const nextMatchData: MatchResponse = {
          systemAction: quickScanResult?.recommendedAction || 'show_multiple_matches',
          confidence: quickScanResult?.overallConfidence || 0,
          totalMatches: allMatches.length,
          rankedCandidates: allMatches.map((match: any) => ({
            id: match.ProductVariantId || match.productId || `match-${Date.now()}`,
            title: match.title || 'Unknown Product',
            description: match.description || '',
            price: typeof match.price === 'number'
              ? match.price
              : Number(match.price?.extracted_value || match.price?.value || 0),
            imageUrl: match.imageUrl || '',
            sourceUrl: (() => {
              const preferred = match.productUrl || match.link || '';
              if (typeof preferred === 'string' && /sssync\.app/i.test(preferred)) {
                return '';
              }
              return preferred;
            })(),
          }))
        };

        if (rerankerMeta) {
          nextMatchData.reranker = rerankerMeta;
        }

        // Update store
        const serpApiDataForItem = candidatesToSerpApiData(nextMatchData.rankedCandidates as any);
        setQuickScanStore(prev => {
          const updated = {
            ...prev,
            [itemId]: { matchData: nextMatchData, serpApiData: serpApiDataForItem }
          };
          return updated;
        });

        // AUTO-CONFIRM: Pre-select the top quick scan match so it's used when "Analyze & List" is pressed
        // This saves time by using the quick scan result instead of re-searching from scratch
        setConfirmedQuickMatchByItemId(prev => ({
          ...prev,
          [itemId]: { serpApiData: serpApiDataForItem, preSelectedIndices: [0] },
        }));

        // CRITICAL: Also update component-level matchData so getInstructionText displays correct count
        setMatchData(nextMatchData);
        // Update instruction to show match count in center box
        setCurrentInstruction('matches_found');
        // Only open sheet on the FIRST scan result in camera mode (Bug 2 fix)
        if (cameraMode === 'camera' && !hasOpenedSheetForScanRef.current) {
          hasOpenedSheetForScanRef.current = true;
          setShowDeepSearchSheet(true);
          sheetTranslateY.value = withSpring(0);
        }

        // Pricing enrichment: Use eBay pricing research (actual sold listings) in background
        // to populate price range and shipping data from real market data.
        const topTitle = nextMatchData.rankedCandidates?.[0]?.title;
        if (topTitle) {
          const rawApiBase = (process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app').replace(/\/+$/, '');
          const API_BASE = /localhost|127\.0\.0\.1/i.test(rawApiBase) ? 'https://api.sssync.app' : rawApiBase;
          (async () => {
            try {
              const cleanedTitle = topTitle.replace(/\s*[|—–-]\s*(eBay|Amazon|Walmart|Etsy|Target)\s*$/i, '').trim();

              const priceRes = await fetch(`${API_BASE}/api/ebay/pricing-research`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: cleanedTitle, condition: 'new', limit: 20 }),
              });

              const priceData = priceRes.ok ? await priceRes.json() : null;
              if (!priceData || priceData.error) {
                console.warn('[QUICK SCAN] pricing research returned no data or error');
                return;
              }
              const recommended = Number(priceData?.recommended ?? priceData?.median ?? priceData?.low ?? 0);

              setQuickScanStore(prev => {
                const current = prev[itemId];
                if (!current?.matchData?.rankedCandidates?.length) return prev;
                const firstCand = current.matchData.rankedCandidates[0];
                const updatedCandidates = [...current.matchData.rankedCandidates];
                // Use pricing research price range as shipping proxy:
                // low = fast sale price, high = max profit price
                const priceLow = Number(priceData?.low ?? 0);
                const priceHigh = Number(priceData?.high ?? 0);
                updatedCandidates[0] = {
                  ...firstCand,
                  price: (typeof firstCand?.price === 'number' && firstCand.price > 0)
                    ? firstCand.price
                    : (Number.isFinite(recommended) && recommended > 0 ? recommended : firstCand?.price),
                  // Store the full pricing research for display in the match sheet
                  pricingResearch: priceData,
                };
                return {
                  ...prev,
                  [itemId]: {
                    ...current,
                    matchData: { ...current.matchData, rankedCandidates: updatedCandidates },
                  },
                };
              });

              // Also update the auto-confirmed match with the enriched data
              setConfirmedQuickMatchByItemId(prev => {
                const existing = prev[itemId];
                if (!existing) return prev;
                return { ...prev, [itemId]: { ...existing } };
              });
            } catch (enrichErr) {
              console.warn('[QUICK SCAN] pricing enrichment skipped:', enrichErr);
            }
          })();
        }

      } else {
        console.log('[QUICK SCAN] No matches found');
        showNotificationMessage('No quick matches found. Added to review.', 3000);
        // Update instruction to show no matches in center box
        setCurrentInstruction('no_matches');
        if (cameraMode === 'camera') {
          setShowDeepSearchSheet(true);
          sheetTranslateY.value = withSpring(0);
        }
      }

    } catch (error) {
      console.error('[QUICK SCAN] scan failed:', error);
      showNotificationMessage('Quick scan failed. Retrying in background...', 3000);
      scanErrorMessage = error instanceof Error ? error.message : 'Quick scan failed';
    } finally {
      setIsAutoScanning(false);
      if (scanErrorMessage) {
        setItemLoadingStates(prev => ({
          ...prev,
          [itemId]: { isLoading: false, stage: 'Scan failed', error: scanErrorMessage || 'Quick scan failed' },
        }));
      } else {
        // Clear loading state
        setItemLoadingStates(prev => {
          const { [itemId]: removed, ...rest } = prev;
          return rest;
        });
      }

      const nextQueued = quickScanQueueRef.current.shift();
      if (nextQueued && !quickScanCancelledRef.current) {
        setTimeout(() => performQuickScan(nextQueued.photo, nextQueued.itemId), 120);
      } else if (!nextQueued) {
        setCurrentInstruction('ready');
      }
    }

  }, [uploadImageToSupabase, candidatesToSerpApiData, quickScanStore, showNotificationMessage, cameraMode, sheetTranslateY, isAutoScanning, incrementLocalUsage]);

  // Open Match Selection screen using quick scan results for a given item
  const openMatchSelectionForItem = useCallback((itemId?: string | null) => {
    const id = itemId || currentMatchItemId;
    if (!id) {
      showNotificationMessage('No item selected for quick matches.', 2000);
      return;
    }
    const store = quickScanStore[id];
    if (!store || !Array.isArray(store.serpApiData) || store.serpApiData.length === 0) {
      showNotificationMessage('No quick matches available for this item.', 2000);
      return;
    }
    (navigation as any).navigate('MatchSelectionScreen', {
      overrideResults: [
        { productIndex: 0, serpApiData: store.serpApiData }
      ],
      overrideFocusIndex: 0,
      isNewScan: true
    });
    setShowMatchSheet(false);
    setCurrentInstruction('ready');
  }, [quickScanStore, currentMatchItemId, navigation, showNotificationMessage]);

  // Reopen quick matches sheet for an item from the bulk items list
  const openQuickMatchesForItem = useCallback((itemId: string) => {
    const store = quickScanStore[itemId];
    if (!store) {
      showNotificationMessage('No quick matches for this item yet.', 2000);
      return;
    }
    // Don't allow closing while processing shelf scan
    if (isProcessingShelfScan) {
      showNotificationMessage('Please wait for shelf scan to complete', 2000);
      return;
    }
    setMatchData(store.matchData);
    setCurrentMatchItemId(itemId);
    // Close bulk sheet before opening match sheet
    setShowDeepSearchSheet(false);
    sheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 150 });
    setShowMatchSheet(true);
    matchSheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.2);
  }, [quickScanStore, matchSheetTranslateY, sheetTranslateY, showNotificationMessage, isProcessingShelfScan]);

  // Send payload of first photos for analysis/matching
  const performAnalyze = useCallback(async (firstPhotos: CapturedPhoto[]) => {
    startTrace();
    logFlowEvent(FlowEvents.SCAN_ANALYSIS_STARTED, {
      photoCount: firstPhotos.length,
    });
    try {
      console.log('[ANALYZE] Sending payload of ' + firstPhotos.length + ' first photos to backend for analysis, matching, and item creation');

      // Upload images to Supabase Storage first
      console.log('[ANALYZE] Uploading images to Supabase...');

      const publicImageUrls = await Promise.all(
        firstPhotos.map(photo => uploadImageToSupabase(photo.uri, photo.id))
      );

      const products = publicImageUrls.map((url, index) => ({
        productIndex: index,
        images: [{ url }]
      }));

      console.log('[ANALYZE] Images uploaded to:', publicImageUrls);

      const finalPayload = {
        products,
        options: {
          useReranking: true,
          vectorSearchLimit: 10,
          autoGenerateAllPlatforms: true,
          skipMatchSelection: true,
        }
      };

      const token = await getToken();
      if (!token) {
        logFlowEvent(FlowEvents.SCAN_ANALYSIS_FAILED, {
          error: 'no_auth_token',
        });
        throw new Error('No auth token available for analysis request');
      }
      const traceHeaders = await getTraceHeaders();
      console.log('[ANALYZE] Request details:', {
        platform: Platform.OS,
        productsCount: finalPayload.products.length,
      });
      const response = await fetch('https://api.sssync.app/api/products/orchestrate/match', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...traceHeaders,
        },
        body: JSON.stringify(finalPayload)
      });

      const responseText = await response.text();
      let analyzeResult: any = null;
      try {
        analyzeResult = responseText ? JSON.parse(responseText) : null;
      } catch {
        analyzeResult = null;
      }

      console.log('[ANALYZE] Response status/body:', {
        status: response.status,
        ok: response.ok,
        bodyPreview: responseText.slice(0, 300),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} :: ${responseText.slice(0, 200)}`);
      }

      const normalizedJobId = analyzeResult?.jobId || analyzeResult?.job?.jobId || analyzeResult?.data?.jobId || null;
      if (!normalizedJobId) {
        console.error('[ANALYZE] Missing jobId in response payload:', analyzeResult);
      }

      logFlowEvent(FlowEvents.SCAN_ANALYSIS_COMPLETED, {
        jobId: normalizedJobId,
        status: response.status,
      });

      return {
        ...(analyzeResult || {}),
        jobId: normalizedJobId,
      };

    } catch (error) {
      logFlowEvent(FlowEvents.SCAN_ANALYSIS_FAILED, {
        error: error instanceof Error ? error.message : String(error),
      });
      console.error('[ANALYZE] Analyze failed:', error);
      showNotificationMessage('Analysis failed. Please try again in a second or two.', 3000);
      throw error;
    }
  }, [uploadImageToSupabase, showNotificationMessage]);

  // Toggle bulk mode
  const toggleBulkMode = useCallback(() => {
    // If we are trying to TURN OFF bulk mode...
    if (isBulkMode) {
      // ...and there are multiple items, prevent it.
      if (bulkItems.length > 1) {
        showNotificationMessage("Can't disable bulk mode with multiple items. Delete items until only one remains.", 4000);
        return;
      }
      // Otherwise, it's safe to turn off.
      setIsBulkMode(false);
    } else {
      // If the user is trying to TURN ON bulk mode...
      setIsBulkMode(true);

      // If there are existing photos that haven't been put into an item yet,
      // create the first item with them. This handles the transition from non-bulk to bulk.
      if (capturedPhotos.length > 0 && bulkItems.length === 0) {
        const firstItem = {
          id: `item-${Date.now()}`,
          photos: capturedPhotos,
          title: undefined,
          isActive: true
        };
        setBulkItems([firstItem]);
        setActiveItemId(firstItem.id);
      }
    }
  }, [isBulkMode, bulkItems.length, capturedPhotos, showNotificationMessage]);

  // Add new bulk item
  const addNewBulkItem = useCallback(() => {
    if (!canAddAnotherItem(bulkItems.length)) {
      return;
    }
    const newItemId = generateItemId();
    console.log('[ADD NEW ITEM] Starting to add new item:', newItemId);
    console.log('[ADD NEW ITEM] Current bulk mode:', isBulkMode);
    console.log('[ADD NEW ITEM] Current items count:', bulkItems.length);

    // Auto-enable bulk mode when adding items
    if (!isBulkMode) {
      console.log('[ADD NEW ITEM] Enabling bulk mode');
      setIsBulkMode(true);
      if (capturedPhotos.length > 0) {
        // Create first item with existing photos
        const firstItemId = generateItemId();
        const newItems = [
          {
            id: firstItemId,
            photos: capturedPhotos,
            title: undefined,
            isActive: false
          },
          {
            id: newItemId,
            photos: [],
            title: undefined,
            isActive: true
          }
        ];
        console.log('[ADD NEW ITEM] Creating items with existing photos:', newItems);
        setBulkItems(newItems);
        setActiveItemId(newItemId);

        // Migrate quick scan store from single-item session to firstItemId if present
        setQuickScanStore(prev => {
          const keys = Object.keys(prev);
          if (keys.length === 1 && !prev[firstItemId]) {
            const oldKey = keys[0];
            const entry = prev[oldKey];
            const { [oldKey]: _removed, ...rest } = prev;
            return { ...rest, [firstItemId]: entry };
          }
          return prev;
        });
      } else {
        const newItems = [{
          id: newItemId,
          photos: [],
          title: undefined,
          isActive: true
        }];
        console.log('[ADD NEW ITEM] Creating first item:', newItems);
        setBulkItems(newItems);
        setActiveItemId(newItemId);
      }
    } else {
      // Deactivate all items and add new active one
      console.log('[ADD NEW ITEM] Adding to existing bulk items');
      setBulkItems(prev => {
        const newItems = [
          ...prev.map(item => ({ ...item, isActive: false })),
          {
            id: newItemId,
            photos: [],
            title: undefined,
            isActive: true
          }
        ];
        console.log('[ADD NEW ITEM] New items array:', newItems);
        return newItems;
      });
      setActiveItemId(newItemId);
    }

    if (isBulkMode && bulkItems.length > 0) {
      console.log("You can't disable bulk mode when there are items in the list");
      showNotificationMessage('You can\'t disable bulk mode when there are items in the list', 3000);
      setIsBulkMode(true);
    }
  }, [isBulkMode, capturedPhotos, bulkItems.length, canAddAnotherItem, generateItemId]);

  // NEW: Handle pressing the match indicator/banner
  const handleMatchIndicatorPress = useCallback(() => {
    if (activeItemId) {
      console.log('[MATCH CLICK] Indicator pressed for item:', activeItemId);

      // Check if we have matches
      const hasMatches = quickScanStore[activeItemId]?.matchData?.totalMatches > 0;

      if (hasMatches) {
        openQuickMatchesForItem(activeItemId);
      } else {
        // Retry: re-trigger quick scan for this item if no matches yet
        if (currentInstruction === 'processing') {
          showNotificationMessage('Scanning in progress...', 1500);
        } else {
          // Find the photo for this item and re-scan
          const item = bulkItems.find(b => b.id === activeItemId);
          if (item && item.photos.length > 0) {
            showNotificationMessage('Retrying scan...', 1500);
            performQuickScan(item.photos[0], activeItemId);
          } else {
            showNotificationMessage('No photo available to scan', 1500);
          }
        }
      }
    } else {
      showNotificationMessage('Select an item first', 1500);
    }
  }, [activeItemId, quickScanStore, currentInstruction, openQuickMatchesForItem, showNotificationMessage, bulkItems, performQuickScan]);

  // Select item as active
  const selectActiveItem = useCallback((itemId: string) => {
    console.log('[SELECT ITEM] Setting active item to:', itemId);
    console.log('[SELECT ITEM] quickScanStore keys:', Object.keys(quickScanStore));
    console.log('[SELECT ITEM] quickScanStore for itemId:', quickScanStore[itemId] ? 'EXISTS' : 'MISSING');
    setBulkItems(prev => {
      // Normalize isActive flags to exactly one active item
      const next = prev.map(item => ({ ...item, isActive: item.id === itemId }));
      return next;
    });
    setActiveItemId(itemId);

    // Show notification of which item is now active
    const itemIndex = bulkItems.findIndex(item => item.id === itemId) + 1;
    showNotificationMessage(`Switched to Item ${itemIndex}`, 1500);
  }, [bulkItems, showNotificationMessage, quickScanStore]);

  // Delete bulk item
  const deleteBulkItem = useCallback((itemId: string) => {
    setBulkItems(prev => {
      const next = prev.filter(item => item.id !== itemId);
      // If we deleted the active item, move focus to the nearest item (previous, else first, else null)
      if (activeItemId === itemId) {
        const deletedIndex = prev.findIndex(i => i.id === itemId);
        const fallback = next[Math.max(0, deletedIndex - 1)] || next[0] || null;
        setActiveItemId(fallback ? fallback.id : null);
        if (fallback) {
          // Ensure only fallback is active
          return next.map(i => ({ ...i, isActive: i.id === fallback.id }));
        }
      }
      return next;
    });
    // Clean up quickScanStore for deleted item
    setQuickScanStore(prev => {
      const { [itemId]: removed, ...rest } = prev;
      console.log('[DELETE ITEM] Cleaned up quickScanStore for item:', itemId);
      return rest;
    });
  }, [activeItemId]);

  // Move photo between items
  const movePhoto = useCallback((fromItemId: string, toItemId: string, photoId: string) => {
    setBulkItems(prev => {
      const next = prev.map(i => ({ ...i, photos: [...i.photos] }));
      const from = next.find(i => i.id === fromItemId);
      const to = next.find(i => i.id === toItemId);
      if (!from || !to) return prev;
      const idx = from.photos.findIndex(p => p.id === photoId);
      if (idx === -1) return prev;
      const [moved] = from.photos.splice(idx, 1);
      if (!moved) return prev;
      if (to.photos.length >= 12) return prev;
      to.photos.push(moved);
      // Ensure cover photo invariant: each item should have a cover if it has photos
      if (from.photos.length > 0 && !from.photos.some(p => p.isCover)) {
        from.photos[0].isCover = true;
      }
      if (to.photos.length === 1) {
        to.photos[0].isCover = true;
      }
      return next;
    });
  }, []);

  // Set cover photo in bulk item
  const setBulkItemCoverPhoto = useCallback((itemId: string, photoId: string) => {
    setBulkItems(prev => prev.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          photos: item.photos.map(photo => ({
            ...photo,
            isCover: photo.id === photoId
          }))
        };
      }
      return item;
    }));
  }, []);

  // Remove photo from bulk item
  const removeBulkItemPhoto = useCallback((itemId: string, photoId: string) => {
    setBulkItems(prev => prev.map(item => {
      if (item.id === itemId) {
        const remainingPhotos = item.photos.filter(p => p.id !== photoId).map(p => ({ ...p }));
        // Maintain a single cover photo per item if any photos remain
        if (remainingPhotos.length > 0) {
          if (!remainingPhotos.some(p => p.isCover)) {
            remainingPhotos[0].isCover = true;
          } else {
            let coverFound = false;
            for (const p of remainingPhotos) {
              if (!coverFound && p.isCover) {
                coverFound = true;
              } else {
                p.isCover = false;
              }
            }
            if (!coverFound) remainingPhotos[0].isCover = true;
          }
        }
        return {
          ...item,
          photos: remainingPhotos
        };
      }
      return item;
    }));
  }, []);

  // Complete close only if sheet was not reopened (guards against stale animation callback)
  const completeCloseIfNotReopened = useCallback((closeId: number) => {
    if (closeRequestIdRef.current === closeId) {
      // Don't allow closing while processing shelf scan
      if (isProcessingShelfScan) {
        return;
      }
      // Don't close if quick scan has produced results — the user needs to review them
      if (Object.keys(quickScanStore).length > 0) {
        return;
      }
      setShowDeepSearchSheet(false);
      setCurrentInstruction('ready');
    }
  }, [isProcessingShelfScan, quickScanStore]);

  // Close bulk items sheet
  const closeBulkItemsSheet = useCallback(() => {
    // Don't allow closing while processing shelf scan
    if (isProcessingShelfScan) {
      return;
    }
    closeRequestIdRef.current += 1;
    const myCloseId = closeRequestIdRef.current;
    sheetTranslateY.value = withTiming(SCREEN_HEIGHT, {
      duration: 200,
    }, () => {
      runOnJS(completeCloseIfNotReopened)(myCloseId);
    });
  }, [sheetTranslateY, completeCloseIfNotReopened, isProcessingShelfScan]);

  // Open bulk items sheet (cancels any in-flight close so its callback does not overwrite)
  const openBulkItemsSheet = useCallback(() => {
    cancelAnimation(sheetTranslateY);
    closeRequestIdRef.current += 1;
    setShowDeepSearchSheet(true);
    sheetTranslateY.value = withSpring(0);
  }, [sheetTranslateY]);

  // First-time walkthrough: briefly show bulk modal so users discover multi-item flow.
  useEffect(() => {
    AsyncStorage.getItem(BULK_MODAL_FTUX_KEY)
      .then((value) => setHasSeenBulkModalFtux(value === '1'))
      .catch(() => setHasSeenBulkModalFtux(true));
  }, []);

  useEffect(() => {
    if (hasSeenBulkModalFtux !== false || hasTriggeredBulkModalFtuxRef.current) return;
    if (showDeepSearchSheet || showMatchSheet || showBarcodeResultModal) return;
    if (cameraMode === 'shelf') return; // In shelf mode, don't auto-close the sheet

    const hasAnyPhoto = capturedPhotos.length > 0 || bulkItems.some((item) => item.photos.length > 0);
    if (!hasAnyPhoto) return;

    hasTriggeredBulkModalFtuxRef.current = true;
    openBulkItemsSheet();

    const timer = setTimeout(async () => {
      // Don't auto-close the sheet — let the user decide when to dismiss.
      // We only mark the FTUX as seen so the walkthrough doesn't replay.
      setHasSeenBulkModalFtux(true);
      try {
        await AsyncStorage.setItem(BULK_MODAL_FTUX_KEY, '1');
      } catch {
        // non-blocking
      }
    }, 2200);

    return () => clearTimeout(timer);
  }, [
    hasSeenBulkModalFtux,
    showDeepSearchSheet,
    showMatchSheet,
    showBarcodeResultModal,
    cameraMode,
    capturedPhotos.length,
    bulkItems,
    closeBulkItemsSheet,
    openBulkItemsSheet,
  ]);

  // Close match results sheet
  const closeMatchSheet = useCallback(() => {
    matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, {
      duration: 200,
    }, () => {
      runOnJS(setShowMatchSheet)(false);
      runOnJS(setCurrentInstruction)('ready');
    });
  }, [matchSheetTranslateY]);

  // Close barcode sheet
  const closeBarcodeSheet = useCallback(() => {
    matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, {
      duration: 200,
    }, () => {
      runOnJS(setShowBarcodeResultModal)(false);
      runOnJS(setScannedBarcode)(null); // Resume scanning
      runOnJS(setCurrentInstruction)('ready');
    });
  }, [matchSheetTranslateY]);

  // Animate barcode sheet open
  useEffect(() => {
    if (showBarcodeResultModal) {
      matchSheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.12, { damping: 70 });
    }
  }, [showBarcodeResultModal, matchSheetTranslateY]);

  // Close all sheets (for tap-to-focus)
  const closeAllSheets = useCallback(() => {
    if (showMatchSheet) {
      closeMatchSheet();
    }
    if (showDeepSearchSheet) {
      closeBulkItemsSheet();
    }
    if (showBarcodeResultModal) {
      closeBarcodeSheet();
    }
  }, [showMatchSheet, showDeepSearchSheet, showBarcodeResultModal, closeMatchSheet, closeBulkItemsSheet, closeBarcodeSheet]);

  // When starting a broad search or analysis, cancel any in-progress quick scan and reset camera state
  const handleStartBroadSearch = useCallback(() => {
    console.log('[BROAD SEARCH] Starting broad search: cancelling quick scan and resetting state');
    // Cancel any in-progress quick scan so it doesn't reopen sheets
    quickScanCancelledRef.current = true;
    quickScanQueueRef.current = [];
    setIsAutoScanning(false);
    stopProgressAnimation();
    setShowProgressBar(false);
    setCurrentInstruction('ready');
  }, [
    stopProgressAnimation,
    setCurrentInstruction,
    setIsAutoScanning,
    setShowProgressBar,
    quickScanCancelledRef,
    quickScanQueueRef,
  ]);

  // When screen loses focus (user navigates away), save draft and close sheets
  useFocusEffect(
    useCallback(() => {
      return () => {
        quickScanQueueRef.current = [];
        setShowMatchSheet(false);
        // Don't close deep search sheet if processing shelf scan
        if (!isProcessingShelfScan) {
          setShowDeepSearchSheet(false);
        }
        setShowBarcodeResultModal(false);
        // Persist scan draft when navigating away so it appears in Scan Drafts
        if (bulkItems.length > 0 && !isHydratingRef.current) {
          saveDraftToBackend({
            scannedItems: bulkItems,
            matchContext: quickScanStore,
            shelfPhotoUri: shelfPhotoUriForDraftRef.current || shelfPhotoUri,
            activeItemId,
          });
        }
      };
    }, [bulkItems, quickScanStore, activeItemId, shelfPhotoUri, saveDraftToBackend, isProcessingShelfScan])
  );

  // Animated styles
  const captureButtonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: captureButtonScale.value }],
  }));

  const flashAnimatedStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));

  const sheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetTranslateY.value }],
  }));

  const matchSheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: matchSheetTranslateY.value }],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  // Permission check
  if (hasPermission === null) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="black" />
        <View style={styles.permissionContainer}>
          <MaterialIcons name="camera-alt" size={80} color="#666" />
          <Text style={styles.permissionTitle}>Requesting Camera Permission...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (hasPermission === false) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="black" />

        <View style={styles.permissionContainer}>
          <MaterialIcons name="camera-alt" size={80} color="#666" />
          <Text style={styles.permissionTitle}>Camera Access Required</Text>
          <Text style={styles.permissionText}>
            We need camera access to help you scan and identify products
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={() => Camera.requestCameraPermissionsAsync()}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="black" />

      {/* Freemium usage counter */}
      {freemiumStatus && !freemiumStatus.hasSubscription && (
        <View style={{ position: 'absolute', top: Platform.OS === 'ios' ? 50 : 10, left: 0, right: 0, zIndex: 100 }}>
          <UsageCounter
            usageCount={freemiumStatus.usageCount}
            freeLimit={freemiumStatus.freeLimit}
            onUpgradePress={() => setShowTierSelector(true)}
            isSubscriber={freemiumStatus.hasSubscription}
          />
        </View>
      )}

      {/* Camera View - key forces remount when returning to screen so camera feed resumes */}
      <CameraView
        key={`camera-${isFocused}`}
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        flash={flash}
        active={isFocused && !showDeepSearchSheet && !showMatchSheet && !showBarcodeResultModal} // Disable camera when sheets are open
        onBarcodeScanned={handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
        }}
      >
        {/* Flash overlay */}
        <Animated.View style={[styles.flashOverlay, flashAnimatedStyle]} />

        {/* Camera paused overlay */}
        {(showDeepSearchSheet || showMatchSheet || showBarcodeResultModal) && (
          <View style={styles.cameraPausedOverlay}>
            <View style={styles.cameraPausedIndicator}>
              <MaterialIcons name="pause-circle-filled" size={48} color="rgba(255,255,255,0.8)" />
              <Text style={styles.cameraPausedText}>Camera Paused</Text>
              <Text style={styles.cameraPausedSubtext}>Saving battery while sheet is open</Text>
            </View>
          </View>
        )}

        {/* Tap to focus overlay */}
        <Pressable
          style={styles.tapToFocusOverlay}
          onPress={(event) => {
            // Close sheets if open - instant close
            if (showMatchSheet || showDeepSearchSheet || showBarcodeResultModal) {
              closeAllSheets();
              return;
            }
            // Otherwise handle focus
            handleFocusTap(event);
          }}
          onLongPress={() => {
            // Open sheet on long press if not already open
            if (!showDeepSearchSheet && !showMatchSheet && !showBarcodeResultModal) {
              openBulkItemsSheet();
            }
          }}
        />

        {/* Photo stack (top left) - vertical, stacks after 3, tap opens modal */}
        {(() => {
          const activeItem = activeItemId ? bulkItems.find(item => item.id === activeItemId) : null;
          const displayPhotos = activeItem?.photos || [];
          const itemIndex = activeItem ? bulkItems.findIndex(item => item.id === activeItemId) + 1 : 0;

          return (
            <View style={[styles.photoStackContainer, { zIndex: 25 }]} key={`photo-stack-${activeItemId || 'none'}`}>
              <View style={styles.photoStackRow}>
                {activeItemId && itemIndex > 0 && (
                  <View style={styles.activeItemIndicator}>
                    <Text style={styles.activeItemIndicatorText}>Item {itemIndex}</Text>
                  </View>
                )}
                {displayPhotos.length >= 1 && (
                  <PhotoStack
                    key={`photos-${activeItemId}`}
                    photos={displayPhotos}
                    onSetCover={activeItemId ? (photoId: string) => setBulkItemCoverPhoto(activeItemId, photoId) : () => { }}
                    onRemovePhoto={activeItemId ? (photoId: string) => removeBulkItemPhoto(activeItemId, photoId) : () => { }}
                    onDoubleTap={activeItemId ? (photoId: string) => setBulkItemCoverPhoto(activeItemId, photoId) : undefined}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onReorder={reorderPhotos}
                    draggedPhotoId={draggedPhotoId}
                    onPress={() => setShowViewPhotosModal(true)}
                    onLongPress={handleImageUpload}
                  />
                )}
              </View>
            </View>
          );
        })()}

        {/* Camera controls (top right) */}
        <CameraControls
          flash={flash}
          onToggleFlash={toggleFlash}
          onPastScans={() => navigation.navigate('PastScans' as never)}
        />

      </CameraView>

      {/* Overlays & Controls (Outside CameraView to avoid touch issues) */}
      <CenterOverlay
        instruction={getInstructionText(currentInstruction)}
        isProcessing={['processing', 'analyzing', 'extracting', 'optimizing', 'searching', 'recognizing'].includes(currentInstruction)}
        cameraMode={cameraMode}
        scannedBarcode={scannedBarcode}
        onCopyBarcode={copyBarcodeToClipboard}
        onPress={
          cameraMode === 'shelf' && !showDeepSearchSheet && (isProcessingShelfScan || bulkItems.length > 0 || shelfPhotoUri)
            ? openBulkItemsSheet
            : handleMatchIndicatorPress
        }
        totalPhotos={bulkItems.reduce((sum, sumItem) => sum + sumItem.photos.length, 0)}
      />

      {cameraMode === 'camera' && (
        <View style={styles.photoFrameOverlay} />
      )}

      {cameraMode === 'barcode' && (
        <View style={styles.photoFrameOverlay}>
          <View style={styles.scanLineContainer}>
            <View style={styles.scanLine} />
          </View>
        </View>
      )}

      {ENABLE_DOC_MODES && cameraMode === 'manifest' && (
        <View style={[styles.photoFrameOverlay, { top: "10%", bottom: "20%", }]} />
      )}

      {ENABLE_DOC_MODES && cameraMode === 'receipt' && (
        <View style={[styles.photoFrameOverlay, { top: "10%", bottom: "20%", }]} />
      )}

      {/* Progress Bar */}
      {showProgressBar && (
        <ProgressBarOverlay
          progressWidth={progressWidth}
          spinRotation={spinRotation}
        />
      )}

      {/* Notification Bar */}
      {showNotification && (
        <NotificationBar
          message={notificationMessage}
          opacity={notificationOpacity}
          translateY={notificationTranslateY}
          onPress={handleMatchIndicatorPress}
        />
      )}

      {/* Bottom controls */}
      <BottomControls
        onCapture={handleCapture}
        isCapturing={isCapturing}
        captureButtonScale={captureButtonScale}
        photosCount={bulkItems.reduce((sum, sumItem) => sum + sumItem.photos.length, 0)}
        cameraMode={cameraMode}
        onSetCameraMode={(mode) => {
          setCameraMode(mode);
          setScannedBarcode(null);
          setCurrentInstruction('ready');
        }}
        onImageUpload={handleImageUpload}
        onContinue={handleContinue}
        hasBarcodeResult={!!barcodeSearchResult}
        productName={barcodeSearchResult?.variant?.Title}
        items={bulkItems}
        activeItemId={activeItemId}
        onSelectItem={(id) => setActiveItemId(id)}
        maxItems={MAX_BATCH_ITEMS}
        onNewItem={addNewBulkItem}
        onOpenBarcodeEntry={
          cameraMode === 'barcode'
            ? () => {
              setShowBarcodeEntry(true);
              setManualBarcode(scannedBarcode || '');
              setBarcodeEntryError(null);
            }
            : undefined
        }
        showDeepSearchSheet={showDeepSearchSheet}
        onOpenSheet={
          cameraMode === 'shelf' && (isProcessingShelfScan || bulkItems.length > 0 || shelfPhotoUri)
            ? openBulkItemsSheet
            : undefined
        }
      />

      {/* Match results sheet (rendered above TabBar via Modal) */}
      <Modal
        visible={!!showMatchSheet && !!matchData}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeMatchSheet}
        presentationStyle="overFullScreen"
      >
        {showMatchSheet && matchData ? (
          <MatchResultsSheet
            matchData={matchData}
            onClose={closeMatchSheet}
            onUseForSelection={() => openMatchSelectionForItem(currentMatchItemId)}
            onConfirmMatch={currentMatchItemId ? (serpApiData, preSelectedIndices) => {
              setConfirmedQuickMatchByItemId(prev => ({
                ...prev,
                [currentMatchItemId]: { serpApiData, preSelectedIndices },
              }));
            } : undefined}
            currentMatchItemId={currentMatchItemId}
            fetchPricingResearch={async (title: string) => {
              try {
                const token = await getToken();
                const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
                const res = await fetch(`${API_BASE}/api/ebay/pricing-research`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ title: title.trim(), condition: 'new', limit: 20 }),
                });
                const data = await res.json();
                return data?.error ? null : data;
              } catch {
                return null;
              }
            }}
            sheetStyle={matchSheetAnimatedStyle}
            navigation={navigation}
            onStartBroadSearch={() => {
              setShowMatchSheet(false);
              matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 150 });
              openBulkItemsSheet();
            }}
          />
        ) : null}
      </Modal>

      {/* Bulk items sheet (rendered above TabBar via Modal) */}
      <Modal
        visible={!!showDeepSearchSheet}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeBulkItemsSheet}
        presentationStyle="overFullScreen"
      >
        {showDeepSearchSheet && (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {(() => {
              console.log('[SHEET CONDITIONAL] Sheet IS showing - showDeepSearchSheet is true');
              console.log('[SHEET PROPS] ==================');
              console.log('[SHEET PROPS] Passing to BulkItemsSheet:');
              console.log('[SHEET PROPS] - photos (capturedPhotos):', capturedPhotos.length, 'items');
              capturedPhotos.forEach((photo, index) => {
                console.log(`[SHEET PROPS]   Photo ${index + 1}:`, {
                  id: photo.id,
                  uri: photo.uri.substring(0, 30) + '...',
                  isCover: photo.isCover
                });
              });
              console.log('[SHEET PROPS] - isBulkMode:', isBulkMode);
              console.log('[SHEET PROPS] - bulkItems:', bulkItems.length, 'items');
              bulkItems.forEach((item, index) => {
                console.log(`[SHEET PROPS]   BulkItem ${index + 1}:`, {
                  id: item.id,
                  photosCount: item.photos.length,
                  isActive: item.isActive
                });
              });
              console.log('[SHEET PROPS] - activeItemId:', activeItemId);
              console.log('[SHEET PROPS] ==================');

              return (
                <BulkItemsSheet
                  onClose={closeBulkItemsSheet}
                  onStartBroadSearch={handleStartBroadSearch}
                  sheetStyle={sheetAnimatedStyle}
                  photos={capturedPhotos}
                  isBulkMode={isBulkMode}
                  bulkItems={bulkItems}
                  activeItemId={activeItemId}
                  onAddNewItem={addNewBulkItem}
                  onImageUpload={handleImageUpload}
                  onDeleteItem={deleteBulkItem}
                  onMovePhoto={movePhoto}
                  onSelectItem={selectActiveItem}
                  onSetCoverPhoto={setBulkItemCoverPhoto}
                  onRemovePhoto={removeBulkItemPhoto}
                  performAnalyze={performAnalyze}
                  sheetTranslateY={sheetTranslateY}
                  navigation={navigation}
                  jobResponse={jobResponse}
                  setJobResponse={setJobResponse}
                  quickScanStore={quickScanStore}
                  onOpenQuickMatches={openQuickMatchesForItem}
                  onRetryItemScan={(itemId) => {
                    const targetItem = bulkItems.find(item => item.id === itemId);
                    const firstPhoto = targetItem?.photos?.[0];
                    if (!firstPhoto) return;
                    performQuickScan(firstPhoto, itemId);
                  }}
                  onOpenPhotoModal={(itemId) => {
                    selectActiveItem(itemId);
                    setShowViewPhotosModal(true);
                  }}
                  itemLoadingStates={itemLoadingStates}
                  setItemLoadingStates={setItemLoadingStates}
                  confirmedQuickMatchByItemId={confirmedQuickMatchByItemId}
                  currentInstruction={currentInstruction}
                  onOpenLocalMatch={(itemId) => {
                    const match = quickScanStore?.[itemId]?.serpApiData?.[0];
                    if (match && match.isLocalMatch) {
                      setBarcodeSearchResult({
                        product: { id: match.productId },
                        variant: { id: match.variantId, Title: match.title, Price: match.price }
                      } as any);
                      // Don't close sheet if processing shelf scan
                      if (!isProcessingShelfScan) {
                        setShowDeepSearchSheet(false);
                      }
                    }
                  }}
                  shelfPhotoUri={shelfPhotoUri}
                  cameraMode={cameraMode}
                  onSaveDraft={() => {
                    if (bulkItems.length > 0 && !isHydratingRef.current) {
                      saveDraftToBackend({
                        scannedItems: bulkItems,
                        matchContext: quickScanStore,
                        shelfPhotoUri: shelfPhotoUriForDraftRef.current || shelfPhotoUri,
                        activeItemId,
                      });
                    }
                  }}
                  onUpdateItemTitle={(id, newTitle) => {
                    setBulkItems(prev => prev.map(item => item.id === id ? { ...item, title: newTitle } : item));
                  }}
                  onUpdateItemQuantity={(id, quantity) => {
                    setBulkItems(prev => prev.map(item => item.id === id ? { ...item, quantity } : item));
                  }}
                  onUpdateItemQuery={(id, newQuery) => {
                    setBulkItems(prev => prev.map(item => item.id === id ? { ...item, title: newQuery } : item));

                    // Trigger a text search locally via server events for just this item
                    (async () => {
                      try {
                        const token = await supabase.auth.getSession().then(({ data }: any) => data.session?.access_token);
                        if (!token) return;

                        setItemLoadingStates(prev => ({ ...prev, [id]: { isLoading: true, stage: 'Searching...', error: undefined } }));

                        const rawApiBase = (process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app').replace(/\/+$/, '');
                        const API_BASE = /localhost|127\.0\.0\.1/i.test(rawApiBase) ? 'https://api.sssync.app' : rawApiBase;
                        const sseUrl = `${API_BASE}/api/products/orchestrate/quick-scan-stream`;

                        const es = new EventSource(sseUrl, {
                          method: 'POST',
                          headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                          },
                          body: JSON.stringify({
                            textQuery: newQuery,
                            mode: 'ocr-vlm-search'
                          })
                        });

                        es.addEventListener("message", (event: any) => {
                          if (!event.data) return;
                          try {
                            const parsed = JSON.parse(event.data);
                            if (parsed.type === 'SEARCH_RESULT') {
                              const res = parsed.result;
                              if (res.matches && res.matches.length > 0) {
                                setQuickScanStore(prev => ({
                                  ...prev,
                                  [id]: {
                                    matchData: {
                                      systemAction: 'show_multiple_matches',
                                      confidence: res.confidence || 'medium',
                                      rankedCandidates: res.matches,
                                      totalMatches: res.matches.length
                                    },
                                    serpApiData: res.matches.map((m: any) => ({ ...m, queryKey: newQuery }))
                                  }
                                }));
                              }
                            } else if (parsed.type === 'COMPLETE') {
                              setItemLoadingStates(prev => {
                                const next = { ...prev };
                                delete next[id];
                                return next;
                              });
                              es.close();
                            } else if (parsed.type === 'ERROR') {
                              setItemLoadingStates(prev => ({
                                ...prev,
                                [id]: {
                                  isLoading: false,
                                  stage: 'Search failed',
                                  error: parsed?.message || 'Unable to search catalog right now.',
                                },
                              }));
                              es.close();
                            }
                          } catch (e) { }
                        });

                        es.addEventListener("error", () => {
                          setItemLoadingStates(prev => ({
                            ...prev,
                            [id]: {
                              isLoading: false,
                              stage: 'Search failed',
                              error: 'Unable to search catalog right now.',
                            },
                          }));
                          es.close();
                        });
                      } catch (err) {
                        console.log("[Re-Search Error]", err);
                        setItemLoadingStates(prev => ({
                          ...prev,
                          [id]: {
                            isLoading: false,
                            stage: 'Search failed',
                            error: 'Unable to search catalog right now.',
                          },
                        }));
                      }
                    })();
                  }}
                />
              );
            })()}
          </View>
        )}
      </Modal>

      {/* View Photos Modal - photo management with item switcher */}
      <ViewPhotosModal
        visible={showViewPhotosModal}
        onClose={() => setShowViewPhotosModal(false)}
        photos={(() => {
          const activeItem = activeItemId ? bulkItems.find(item => item.id === activeItemId) : null;
          return activeItem?.photos || [];
        })()}
        activeItemId={activeItemId}
        totalItems={bulkItems.length}
        activeIndex={bulkItems.findIndex(i => i.id === activeItemId)}
        onSetCover={(photoId) => activeItemId && setBulkItemCoverPhoto(activeItemId, photoId)}
        onRemovePhoto={(photoId) => activeItemId && removeBulkItemPhoto(activeItemId, photoId)}
        onReorder={reorderPhotos}
        onSelectItem={selectActiveItem}
        onImageUpload={handleImageUpload}
        items={bulkItems}
      />

      <BarcodeEntrySheet
        visible={showBarcodeEntry}
        barcode={manualBarcode}
        onChangeBarcode={(value) => {
          setManualBarcode(value.replace(/[^0-9]/g, ''));
          if (barcodeEntryError) setBarcodeEntryError(null);
        }}
        onSubmit={handleManualBarcodeSubmit}
        onCancel={() => {
          setShowBarcodeEntry(false);
          setBarcodeEntryError(null);
        }}
        loading={barcodeSearching}
        errorMessage={barcodeEntryError || undefined}
      />

      {/* Barcode Quick Inventory Editor Modal (Reused MatchSheet Style) */}
      <Modal
        visible={showBarcodeResultModal}
        transparent={true}
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeBarcodeSheet}
        presentationStyle="overFullScreen"
      >
        {showBarcodeResultModal && barcodeSearchResult ? (
          <Animated.View style={[styles.matchSheet, matchSheetAnimatedStyle]}>
            <QuickProductDetailSheet
              product={barcodeSearchResult}
              platformLocations={platformLocations}
              onClose={closeBarcodeSheet}
              onOpenDetail={() => {
                // ProductDetail expects a ProductVariant Id, not the parent Product Id
                const variantId = barcodeSearchResult?.variant?.Id;
                if (variantId) {
                  closeBarcodeSheet();
                  (navigation as any).navigate('ProductDetail', {
                    productId: variantId,  // This is the ProductVariant.Id that ProductDetail expects
                  });
                } else {
                  console.error('[QUICK DETAIL] No variant Id found for navigation');
                }
              }}
              onSave={async (updates) => {
                console.log('[BARCODE SAVE] Saving updates via API:', updates);
                try {
                  const token = await ensureSupabaseJwt();
                  if (!token) throw new Error('No auth token');

                  // Group updates by variantId
                  const updatesByVariant: Record<string, typeof updates> = {};
                  updates.forEach(u => {
                    if (!updatesByVariant[u.variantId]) updatesByVariant[u.variantId] = [];
                    updatesByVariant[u.variantId].push(u);
                  });

                  const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';

                  // Process per variant
                  for (const [variantId, variantUpdates] of Object.entries(updatesByVariant)) {
                    // Map to API payload structure
                    const payloadUpdates = variantUpdates.map(u => {
                      // Find connectionId for the location
                      const locInfo = platformLocations.find(l => l.id === u.location);
                      if (!locInfo?.connectionId) {
                        console.warn(`[BARCODE SAVE] No connectionId found for location ${u.location}`);
                        return null;
                      }
                      return {
                        platformConnectionId: locInfo.connectionId,
                        locationId: u.location,
                        quantity: u.quantity,
                        price: u.price // API now supports price
                      };
                    }).filter(Boolean); // Remove nulls

                    if (payloadUpdates.length === 0) continue;

                    const response = await fetch(`${API_BASE}/api/products/${variantId}/inventory`, {
                      method: 'PUT',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                      },
                      body: JSON.stringify({ updates: payloadUpdates }),
                    });

                    if (!response.ok) {
                      throw new Error(`API failed: ${response.status}`);
                    }
                  }

                  Alert.alert('Success', 'Inventory updated successfully');

                  // Close sheet after save? Or keep open?
                  // User might want to scan next.
                  // Let's keep open for verification or manual close.
                } catch (e) {
                  console.error('[BARCODE SAVE] Error:', e);
                  Alert.alert('Error', 'Failed to save updates');
                }
              }}
            />
          </Animated.View>
        ) : null}
      </Modal>

      {/* Manifest Review Sheet Modal */}
      <Modal
        visible={showManifestSheet && !!manifestJobId}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => {
          setShowManifestSheet(false);
          setManifestJobId(null);
        }}
        presentationStyle="overFullScreen"
      >
        {showManifestSheet && manifestJobId ? (
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ height: SCREEN_HEIGHT * 0.85 }}>
              <ManifestReviewSheet
                jobId={manifestJobId}
                onClose={() => {
                  setShowManifestSheet(false);
                  setManifestJobId(null);
                }}
                onAddToInventory={(items) => {
                  console.log('[MANIFEST] Adding items to inventory:', items.length);
                  Alert.alert(
                    'Coming Soon',
                    `${items.length} items will be added to inventory in a future update.`,
                    [{
                      text: 'OK', onPress: () => {
                        setShowManifestSheet(false);
                        setManifestJobId(null);
                      }
                    }]
                  );
                }}
              />
            </View>
          </View>
        ) : null}
      </Modal>

      {/* Receipt Review Sheet Modal */}
      <Modal
        visible={showReceiptSheet && !!receiptJobId}
        transparent
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => {
          setShowReceiptSheet(false);
          setReceiptJobId(null);
        }}
        presentationStyle="overFullScreen"
      >
        {showReceiptSheet && receiptJobId ? (
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
            <View style={{ height: SCREEN_HEIGHT * 0.85 }}>
              <ReceiptReviewSheet
                jobId={receiptJobId}
                onClose={() => {
                  setShowReceiptSheet(false);
                  setReceiptJobId(null);
                }}
                onApplyUpdates={(updates) => {
                  console.log('[RECEIPT] Applied updates:', updates.length);
                }}
                onCreateNew={(itemName) => {
                  // Switch to camera mode with the item name pre-filled
                  setShowReceiptSheet(false);
                  setReceiptJobId(null);
                  setCameraMode('camera');
                  Alert.alert('Add New Item', `Switch to camera mode to add: ${itemName}`);
                }}
              />
            </View>
          </View>
        ) : null}
      </Modal>


      {/* Tier Selector Modal (Paywall) */}
      <TierSelectorModal
        visible={showTierSelector}
        onClose={() => setShowTierSelector(false)}
        onSuccess={() => {
          refreshFreemiumStatus();
          setShowTierSelector(false);
        }}
        usageInfo={freemiumStatus ? {
          usageCount: freemiumStatus.usageCount,
          freeLimit: freemiumStatus.freeLimit,
          remaining: freemiumStatus.remaining,
        } : undefined}
        hasSubscription={freemiumStatus?.hasSubscription || false}
      />
    </GestureHandlerRootView>
  );
};



// Progress Bar Overlay Component
const ProgressBarOverlay: React.FC<{
  progressWidth: any;
  spinRotation: any;
}> = ({ progressWidth, spinRotation }) => {
  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  const spinnerStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spinRotation.value}deg` }],
  }));

  return (
    <View style={styles.progressBarContainer}>
      <View style={styles.progressBarBackground}>
        <Animated.View style={[styles.progressBarFill, progressBarStyle]} />
      </View>
      <Animated.View style={[styles.progressSpinner, spinnerStyle]}>
        <Icon name="loading" size={20} color="#4CAF50" />
      </Animated.View>
    </View>
  );
};

// Notification Bar Component  
const NotificationBar: React.FC<{
  message: string;
  opacity: any;
  translateY: any;
  onPress?: () => void;
}> = ({ message, opacity, translateY, onPress }) => {
  const notificationStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[styles.notificationBar, notificationStyle]}>
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={{ flexDirection: 'row', alignItems: 'center' }}
      >
        <Icon name="information-outline" size={20} color="white" />
        <Text style={styles.notificationText}>{message}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

// Center Overlay Component
const CenterOverlay: React.FC<{
  instruction: string;
  isProcessing: boolean;
  cameraMode: CameraMode;
  scannedBarcode: string | null;
  onCopyBarcode: () => void;
  onPress?: () => void;
  totalPhotos?: number;
}> = ({ instruction, isProcessing, cameraMode, scannedBarcode, onCopyBarcode, onPress, totalPhotos = 0 }) => {
  // Barcode overlay at top middle
  if (cameraMode === 'barcode' && scannedBarcode) {
    return (
      <View style={styles.barcodeOverlayContainer}>
        <Animated.View style={styles.barcodeOverlay} entering={FadeIn}>
          <Text style={styles.barcodeText}>{scannedBarcode}</Text>
          <TouchableOpacity style={styles.copyButton} onPress={onCopyBarcode}>
            <Icon name="content-copy" size={16} color="white" />
            <Text style={styles.copyButtonText}>Copy</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    );
  }

  // Hide "Take photos to get started" overlay when user already has photos (cleaner view)
  if (cameraMode === 'camera' && totalPhotos > 0 && instruction === 'Take photos to get started') {
    return null;
  }

  // Regular instruction overlay - moved to top-middle like barcode
  return (
    <View style={styles.barcodeOverlayContainer}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <Animated.View style={styles.centerOverlay}>
          <Text style={styles.centerOverlayText}>{instruction}</Text>
          {isProcessing && (
            <View style={styles.processingIndicator}>
              <MaterialIcons name="sync" size={16} color="white" />
            </View>
          )}
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
};


// Bottom Controls Component
const BottomControls: React.FC<{
  onCapture: () => void;
  isCapturing: boolean;
  captureButtonScale: any;
  photosCount: number;
  cameraMode: CameraMode;
  onSetCameraMode: (mode: CameraMode) => void;
  onImageUpload: () => void;
  onContinue: () => void;
  hasBarcodeResult?: boolean;
  productName?: string;
  // Item navigation props
  items: Array<{ id: string; photos: any[]; title?: string }>;
  activeItemId: string | null;
  onSelectItem: (id: string) => void;
  onNewItem: () => void;
  onOpenBarcodeEntry?: () => void;
  showDeepSearchSheet?: boolean;
  onOpenSheet?: () => void;
  maxItems?: number;
}> = ({
  onCapture,
  isCapturing,
  captureButtonScale,
  photosCount,
  cameraMode,
  onSetCameraMode,
  onImageUpload,
  onContinue,
  hasBarcodeResult,
  productName,
  items,
  activeItemId,
  onSelectItem,
  onNewItem,
  onOpenBarcodeEntry,
  showDeepSearchSheet = false,
  onOpenSheet,
  maxItems = MAX_BATCH_ITEMS,
}) => {
    const activeIndex = items.findIndex(i => i.id === activeItemId);
    const totalItems = items.length;
    // Drag-to-select logic using simple state
    const [hoveredMode, setHoveredMode] = useState<CameraMode | null>(null);
    const [showModePopup, setShowModePopup] = useState(false);
    const popupScale = useSharedValue(0);
    const popupOpacity = useSharedValue(0);

    const captureButtonAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: captureButtonScale.value }],
    }));

    const popupAnimatedStyle = useAnimatedStyle(() => ({
      transform: [{ scale: popupScale.value }],
      opacity: popupOpacity.value,
    }));

    const toggleModePopup = useCallback(() => {
      if (showModePopup) {
        // Close smoothly
        popupScale.value = withTiming(0, { duration: 150 });
        popupOpacity.value = withTiming(0, { duration: 150 }, () => {
          runOnJS(setShowModePopup)(false);
        });
      } else {
        setShowModePopup(true);
        popupScale.value = withTiming(1, { duration: 200 });
        popupOpacity.value = withTiming(1, { duration: 150 });
      }
    }, [showModePopup, popupScale, popupOpacity]);

    const selectMode = useCallback((mode: CameraMode) => {
      onSetCameraMode(mode);
      // Smooth close
      popupScale.value = withTiming(0, { duration: 150 });
      popupOpacity.value = withTiming(0, { duration: 150 }, () => {
        runOnJS(setShowModePopup)(false);
      });
      setHoveredMode(null);
    }, [onSetCameraMode, popupScale, popupOpacity]);

    const modes: CameraMode[] = ENABLE_DOC_MODES
      ? ['camera', 'barcode', 'shelf', 'manifest', 'receipt']
      : ['camera', 'barcode', 'shelf'];

    const POPUP_WIDTH = 90 * modes.length;
    const ITEM_WIDTH = POPUP_WIDTH / modes.length;

    // EXPERIMENTAL: Long press on mode button to toggle text search
    const onLongPressMode = () => {
      // Toggle text search from parent? We need a callback prop for this
      // For now, we'll just log it. In real usage, pass onTextSearchToggle prop.
      console.log('Long press mode button');
    };

    // Pan gesture handler callback (non-deprecated approach)
    const onPanGestureEvent = useCallback((event: PanGestureHandlerGestureEvent) => {
      const x = event.nativeEvent.x;
      const modeIndex = Math.floor(x / ITEM_WIDTH);
      const activeModes: CameraMode[] = ENABLE_DOC_MODES
        ? ['camera', 'barcode', 'shelf', 'manifest', 'receipt']
        : ['camera', 'barcode', 'shelf'];
      let newMode: CameraMode | null = null;
      if (modeIndex >= 0 && modeIndex < activeModes.length) {
        newMode = activeModes[modeIndex];
      }

      if (newMode && newMode !== hoveredMode) {
        setHoveredMode(newMode);
        Haptics.selectionAsync();
      }
    }, [hoveredMode, ITEM_WIDTH, POPUP_WIDTH]);

    const onPanHandlerStateChange = useCallback((event: PanGestureHandlerGestureEvent) => {
      if (event.nativeEvent.state === State.END) {
        if (hoveredMode) {
          selectMode(hoveredMode);
        }
      }
    }, [hoveredMode, selectMode]);

    const getModeIcon = (mode: CameraMode): string => {
      switch (mode) {
        case 'camera': return 'camera';
        case 'barcode': return 'barcode-scan';
        case 'manifest': return 'file-document-outline';
        case 'receipt': return 'receipt';
        case 'shelf': return 'layers';
      }
    };

    const getModeLabel = (mode: CameraMode): string => {
      switch (mode) {
        case 'camera': return 'Camera';
        case 'barcode': return 'Barcode';
        case 'manifest': return ENABLE_DOC_MODES ? 'Manifest' : '';
        case 'receipt': return ENABLE_DOC_MODES ? 'Receipt' : '';
        case 'shelf': return 'Shelf';
      }
    };

    const getContinueText = () => {
      if (cameraMode === 'barcode' && hasBarcodeResult) {
        return 'Open scanned item';
      }
      if (cameraMode === 'manifest' && ENABLE_DOC_MODES) {
        return photosCount > 0
          ? `Parse ${photosCount} page${photosCount > 1 ? 's' : ''}`
          : 'Capture manifest pages';
      }
      if (cameraMode === 'receipt' && ENABLE_DOC_MODES) {
        return photosCount > 0
          ? `Process ${photosCount} receipt${photosCount > 1 ? 's' : ''}`
          : 'Capture receipt';
      }
      if (photosCount === 0) return 'Take a photo to get started';
      if (totalItems > 1) return `Continue w/ ${totalItems} items`;
      return `Manage ${totalItems} item${totalItems > 1 ? 's' : ''}`;
    };

    const activeMode = hoveredMode || cameraMode;

    return (
      <View style={styles.bottomControls}>
        <Animated.View entering={FadeIn.delay(500)} style={styles.controlsRow}>
          <View style={{ gap: 4, justifyContent: "center" }}>
            <TouchableOpacity style={[styles.galleryButton, { gap: 4 }]} onPress={onImageUpload}>
              <Icon name="image-multiple-outline" size={24} color="white" />
            </TouchableOpacity>
            <Text style={{ color: "#FFF", fontSize: 12, fontWeight: 500, textAlign: "center" }}>Upload</Text>
          </View>



          <Animated.View style={captureButtonAnimatedStyle}>
            <TouchableOpacity
              style={styles.captureButton}
              onPress={onCapture}
              disabled={isCapturing}
            >
              <View style={styles.captureButtonInner} />
            </TouchableOpacity>
          </Animated.View>

          {/* Mode selector with popup */}
          <View style={styles.modeSelectorWrapper}>
            {/* Popup bubble */}
            {showModePopup && (
              <Animated.View style={[styles.modePopup, popupAnimatedStyle]}>
                <PanGestureHandler
                  onGestureEvent={onPanGestureEvent}
                  onHandlerStateChange={onPanHandlerStateChange}
                >
                  <Animated.View style={[styles.modePopupContent, { width: POPUP_WIDTH }]}>
                    {modes.map((mode, index) => (
                      <TouchableOpacity
                        key={mode}
                        style={[
                          styles.modePopupItem,
                          activeMode === mode && styles.modePopupItemActive,
                          //activeMode === mode && mode === 'shelf' && { backgroundColor: '#FF8A65' }
                        ]}
                        onPress={() => selectMode(mode)}
                        activeOpacity={1}
                      >
                        <Text style={[
                          styles.modePopupLabel,
                          activeMode === mode && styles.modePopupLabelActive,
                        ]}>
                          {getModeLabel(mode)}
                        </Text>
                        <View style={[
                          styles.modePopupIconContainer,
                          activeMode === mode && styles.modePopupIconContainerActive,
                        ]}>
                          <Icon
                            name={getModeIcon(mode)}
                            size={28}
                            color={activeMode === mode ? '#fff' : 'rgba(255,255,255,0.7)'}
                          />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </Animated.View>
                </PanGestureHandler>
                <View style={{ flex: 1, paddingRight: 25 }}>
                  {/* Speech bubble arrow - Positioned relative to button center */}
                  <View style={styles.modePopupArrow} />
                </View>

              </Animated.View>
            )}

            {/* Current mode button MODE (collapsed state) cameraMode === 'shelf' && { backgroundColor: '#FF8A65', borderColor: '#FF8A65' } */}
            <TouchableOpacity
              style={[styles.modeButton]}
              onPress={toggleModePopup}
            >
              <Icon
                name={getModeIcon(cameraMode)}
                size={24}
                color="white"
              />
            </TouchableOpacity>
            <Text style={{ color: "#FFF", fontSize: 12, fontWeight: 500, textAlign: "center" }}>Mode</Text>
          </View>
        </Animated.View>

        {((cameraMode === 'shelf' && !showDeepSearchSheet && (items.length > 0 || onOpenSheet)) || (cameraMode !== 'shelf' && (cameraMode === 'barcode' || photosCount >= 1 || items.some((i) => i.title)))) && (
          <Animated.View entering={SlideInDown.delay(700)} style={styles.continueButtonContainer}>
            {cameraMode === 'shelf' && !showDeepSearchSheet && onOpenSheet ? (
              <TouchableOpacity
                style={styles.continueButton}
                onPress={onOpenSheet}
              >
                <Text style={styles.continueButtonText} numberOfLines={1}>
                  Move to listing flow
                </Text>
              </TouchableOpacity>
            ) : cameraMode === 'barcode' ? (
              hasBarcodeResult ? (
                <View style={styles.barcodeActionsRow}>
                  {onOpenBarcodeEntry && (
                    <TouchableOpacity
                      style={styles.barcodeSecondaryButton}
                      onPress={onOpenBarcodeEntry}
                    >
                      <Text style={styles.barcodeSecondaryText}>Enter manually</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.continueButton}
                    onPress={onContinue}
                  >
                    <Text style={styles.continueButtonText} numberOfLines={1}>
                      {getContinueText()}
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.barcodeActionsRow}>
                  {onOpenBarcodeEntry && (
                    <TouchableOpacity
                      style={styles.continueButton}
                      onPress={onOpenBarcodeEntry}
                    >
                      <Text style={styles.continueButtonText} numberOfLines={1}>
                        Enter barcode manually
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )
            ) : (
              <View style={styles.itemNavRow}>
                {/* Left Arrow - Previous Item */}
                <TouchableOpacity
                  style={[styles.itemNavArrow, activeIndex <= 0 && styles.itemNavArrowDisabled]}
                  onPress={() => {
                    if (activeIndex > 0) onSelectItem(items[activeIndex - 1].id);
                  }}
                  disabled={activeIndex <= 0}
                >
                  <Icon name="chevron-left" size={24} color={activeIndex > 0 ? "#FFF" : "rgba(255,255,255,0.3)"} />
                </TouchableOpacity>

                {/* Center - Continue Button with item counter */}
                <TouchableOpacity
                  style={styles.continueButton}
                  onPress={onContinue}
                >
                  {totalItems > 0 && (
                    <View style={styles.itemCountBadge}>
                      <Text style={styles.itemCountBadgeText}>{totalItems}/{maxItems}</Text>
                    </View>
                  )}
                  <Text style={styles.continueButtonText} numberOfLines={1}>
                    {getContinueText()}
                  </Text>
                </TouchableOpacity>

                {/* Right Arrow/New Item */}
                {activeIndex < totalItems - 1 ? (
                  <TouchableOpacity
                    style={styles.itemNavArrow}
                    onPress={() => onSelectItem(items[activeIndex + 1].id)}
                  >
                    <Icon name="chevron-right" size={24} color="#FFF" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.itemNavArrow, styles.itemNavNewButton]}
                    onPress={onNewItem}
                    disabled={totalItems >= maxItems}
                  >
                    <Icon name="plus" size={24} color={totalItems >= maxItems ? 'rgba(255,255,255,0.4)' : '#FFF'} />
                    <Text style={[styles.continueButtonText, totalItems >= maxItems && { color: 'rgba(255,255,255,0.6)' }]}>
                      {totalItems >= maxItems ? 'Limit reached' : 'New Item'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </Animated.View>
        )}
      </View>
    );
  };

// Helper to clean up match text
const cleanMatchText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/^(scanned product|scanned item|product scan)[:\s-]*/i, '')
    .replace(/\s*\((quick_scan|.*dataset|custom_.*)\)/gi, '')
    .trim();
};

const MatchResultsSheet: React.FC<{
  matchData: MatchResponse;
  onClose: () => void;
  sheetStyle: any;
  onUseForSelection?: () => void;
  onStartBroadSearch?: () => void;
  onConfirmMatch?: (serpApiData: any[], preSelectedIndices: number[]) => void;
  currentMatchItemId?: string | null;
  fetchPricingResearch?: (title: string) => Promise<{ low?: number; median?: number; high?: number; recommended?: number; error?: string } | null>;
  navigation?: any;
}> = ({ matchData, onClose, sheetStyle, onUseForSelection, onStartBroadSearch, onConfirmMatch, currentMatchItemId, fetchPricingResearch, navigation }) => {
  const insets = useSafeAreaInsets();
  const bottomMargin = Math.max(insets.bottom, 20);
  // Use index-based selection to avoid duplicate id issues
  const [selectedMatchIndices, setSelectedMatchIndices] = React.useState<Set<number>>(new Set());
  const [pricingResearch, setPricingResearch] = React.useState<{ low?: number; median?: number; high?: number; recommended?: number } | null>(null);
  const [pricingResearchLoading, setPricingResearchLoading] = React.useState(false);
  const [pricingResearchModalVisible, setPricingResearchModalVisible] = React.useState(false);
  const [pricingSourcesSheetVisible, setPricingSourcesSheetVisible] = React.useState(false);
  const [pricingHistoryRange, setPricingHistoryRange] = React.useState<'1W' | '1M' | '3M'>('1M');

  const [shippingModalVisible, setShippingModalVisible] = React.useState(false);
  const [shippingModalData, setShippingModalData] = React.useState<{ min: number; max: number } | null>(null);

  const firstCandidate = matchData.rankedCandidates[0];
  const firstTitle = firstCandidate?.title;
  // Check if candidate already has pre-fetched pricing research from quick scan enrichment
  const preFetchedPricing = (firstCandidate as any)?.pricingResearch;

  React.useEffect(() => {
    // If pre-fetched pricing research data exists from quick scan, use it directly
    if (preFetchedPricing && typeof preFetchedPricing.low === 'number') {
      setPricingResearch(preFetchedPricing);
      setPricingResearchLoading(false);
      return;
    }
    if (!firstTitle || !fetchPricingResearch) return;
    setPricingResearchLoading(true);
    setPricingResearch(null);
    fetchPricingResearch(firstTitle)
      .then((res) => {
        if (res && typeof (res as any).low === 'number') setPricingResearch(res as any);
      })
      .catch(() => { })
      .finally(() => setPricingResearchLoading(false));
  }, [firstTitle, fetchPricingResearch, preFetchedPricing]);

  const toggleMatchSelection = (index: number) => {
    setSelectedMatchIndices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const handleGenerateWithSelected = () => {
    if (selectedMatchIndices.size > 0) {
      // Convert matchData.rankedCandidates to serpApiData format for MatchSelectionScreen
      const serpApiData = matchData.rankedCandidates.map((c, idx) => ({
        position: idx + 1,
        title: c.title || 'Unknown Product',
        link: c.sourceUrl || '',
        source: 'quickscan',
        source_icon: '',
        thumbnail: c.imageUrl || '',
        image: c.imageUrl || '',
        price: typeof c.price === 'number' ? { value: `$${c.price}`, extracted_value: c.price, currency: 'USD' } : undefined,
      }));
      const preSelected = Array.from(selectedMatchIndices);
      if (currentMatchItemId && onConfirmMatch) {
        onConfirmMatch(serpApiData, preSelected);
      }
      onClose();
    } else if (selectedMatchIndices.size > 0) {
      onUseForSelection?.();
    }
  };

  return (
    <Animated.View style={[styles.matchSheet, sheetStyle, { paddingBottom: 230 }]}>
      <ScrollView
        style={[
          styles.itemsScrollContainer,
        ]}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={[
          styles.scrollContent,
          {
            flexGrow: 1,
            paddingBottom: 0
          }
        ]}
      >
        <View style={styles.sheetHeader}>
          <View style={styles.sheetHeaderSpacer} />
          <Text style={[styles.sheetTitle, { flex: 1 }]}>
            {matchData.totalMatches} Match{matchData.totalMatches > 1 ? 'es' : ''} Found
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.exitButton} activeOpacity={0.8} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="close" size={18} color="#64748B" />
            <Text style={styles.exitButtonText}>Exit</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.selectionHint}>
          Tap to select matches for creating this listing
        </Text>

        <View style={styles.matchResults}>
          {matchData.rankedCandidates.map((candidate, index) => {
            const isSelected = selectedMatchIndices.has(index);
            const hasPrice = typeof candidate.price === 'number' && candidate.price > 0;
            // Use pricing research for price display: prefer candidate's pre-fetched data, then component-level data
            const candidatePricing = (candidate as any)?.pricingResearch;
            const effectivePricing = (index === 0) ? (pricingResearch || candidatePricing) : candidatePricing;
            const usePricingResearch = !hasPrice && effectivePricing && typeof effectivePricing.low === 'number';
            const priceText = hasPrice
              ? `$${candidate.price}`
              : usePricingResearch
                ? `$${effectivePricing.low} – $${effectivePricing.high ?? effectivePricing.median ?? effectivePricing.low}${effectivePricing.median != null ? ` (avg $${effectivePricing.median})` : ''}`
                : pricingResearchLoading && index === 0
                  ? '…'
                  : '—';

            return (
              <TouchableOpacity
                key={`match-${index}`}
                style={[
                  styles.matchCard,
                  isSelected && styles.matchCardSelected
                ]}
                onPress={() => toggleMatchSelection(index)}
                activeOpacity={0.7}
              >
                <Image source={{ uri: candidate.imageUrl }} style={styles.matchImage} />
                <View style={styles.matchInfo}>
                  <Text style={styles.matchTitle} numberOfLines={2}>{cleanMatchText(candidate.title) || 'Unknown Product'}</Text>

                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, marginBottom: 4 }}>
                    <TouchableOpacity
                      disabled={(index !== 0) || (!pricingResearch && !candidatePricing) || pricingResearchLoading}
                      onPress={(index === 0 && (pricingResearch || candidatePricing) && !pricingResearchLoading) ? () => setPricingResearchModalVisible(true) : undefined}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F3F4F6', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: '#E5E7EB' }}
                    >
                      <Icon name="tag-outline" size={12} color="#4B5563" style={{ marginRight: 4 }} />
                      <Text style={{ fontSize: 12, fontWeight: '600', color: '#374151' }}>
                        {priceText}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {candidate.sourceUrl && (() => {
                    try {
                      return (
                        <Text style={styles.matchSource} numberOfLines={1}>
                          {new URL(candidate.sourceUrl).hostname.replace('www.', '')}
                        </Text>
                      );
                    } catch {
                      return null;
                    }
                  })()}
                </View>

                {/* Selection indicator overlay */}
                {isSelected && (
                  <View style={styles.matchSelectionOverlay}>
                    <View style={styles.matchCheckmark}>
                      <Icon name="check" size={20} color="#FFFFFF" />
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.sheetActions}>
          <View style={[styles.matchActionsRow, { justifyContent: 'center' }]}>
            <TouchableOpacity
              style={[
                styles.listProductButton,
                { flex: 1, minHeight: 52 },
                selectedMatchIndices.size === 0 && styles.listProductButtonDisabled
              ]}
              onPress={handleGenerateWithSelected}
              disabled={selectedMatchIndices.size === 0}
            >
              <Icon name="package-variant" size={20} color={selectedMatchIndices.size > 0 ? "#FFF" : "#999"} />
              <Text style={[
                styles.listProductButtonText,
                selectedMatchIndices.size === 0 && { color: '#999' }
              ]}>Use Selected</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Pricing Research Modal */}
      <PricingResearchModal
        visible={pricingResearchModalVisible}
        onClose={() => setPricingResearchModalVisible(false)}
        pricingResearchResult={pricingResearch}
        pricingSourcesSheetVisible={pricingSourcesSheetVisible}
        setPricingSourcesSheetVisible={setPricingSourcesSheetVisible}
        pricingHistoryRange={pricingHistoryRange}
        setPricingHistoryRange={setPricingHistoryRange}
        selectedPricingPointIdx={null}
      />

      {/* Shipping Estimate Modal */}
      <Modal visible={shippingModalVisible} transparent animationType="fade">
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setShippingModalVisible(false)}>
          <Pressable style={{ backgroundColor: '#fff', borderRadius: 16, width: '85%', maxWidth: 320, padding: 24 }} onPress={e => e.stopPropagation()}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0FDF4', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="truck-outline" size={24} color="#16a34a" />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#1F2937' }}>Shipping Estimate</Text>
            </View>
            <Text style={{ fontSize: 15, color: '#4B5563', lineHeight: 22, marginBottom: 8 }}>
              Based on similar items, the estimated shipping cost is:
            </Text>
            <Text style={{ fontSize: 24, fontWeight: '700', color: '#166534', marginBottom: 20 }}>
              ${shippingModalData?.min?.toFixed(2)} – ${shippingModalData?.max?.toFixed(2)}
            </Text>
            <TouchableOpacity
              style={{ backgroundColor: '#1F2937', paddingVertical: 12, borderRadius: 8, alignItems: 'center' }}
              onPress={() => setShippingModalVisible(false)}
            >
              <Text style={{ color: '#fff', fontWeight: '600', fontSize: 16 }}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

    </Animated.View>
  );
};

// Bulk Items Sheet Component
const BulkItemsSheet: React.FC<{
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
  performAnalyze: (firstPhotos: CapturedPhoto[]) => Promise<any>;
  sheetTranslateY: any;
  jobResponse: JobResponse | null;
  navigation: any;
  quickScanStore?: Record<string, { matchData: MatchResponse; serpApiData: any[] }>;
  onOpenQuickMatches?: (itemId: string) => void;
  onRetryItemScan?: (itemId: string) => void;
  onOpenPhotoModal?: (itemId: string) => void;
  itemLoadingStates: Record<string, ItemLoadingState>;
  setItemLoadingStates: React.Dispatch<React.SetStateAction<Record<string, ItemLoadingState>>>;
  confirmedQuickMatchByItemId?: Record<string, { serpApiData: any[]; preSelectedIndices: number[] }>;
  currentInstruction?: string | null;
  onOpenLocalMatch?: (itemId: string) => void;
  shelfPhotoUri?: string | null;
  onUpdateItemQuery?: (id: string, newQuery: string) => void;
  onUpdateItemTitle?: (id: string, newTitle: string) => void;
  onUpdateItemQuantity?: (id: string, quantity: number) => void;
  onSaveDraft?: () => void;
  cameraMode?: 'camera' | 'barcode' | 'manifest' | 'receipt' | 'shelf';
}> = ({ onClose, onStartBroadSearch, sheetStyle, photos, isBulkMode, bulkItems, activeItemId, onAddNewItem, onImageUpload, performAnalyze, onDeleteItem, onMovePhoto, onSelectItem, onSetCoverPhoto, onRemovePhoto, sheetTranslateY, navigation, setJobResponse, jobResponse, quickScanStore, onOpenQuickMatches, onRetryItemScan, onOpenPhotoModal, itemLoadingStates, setItemLoadingStates, confirmedQuickMatchByItemId = {}, currentInstruction, onOpenLocalMatch, shelfPhotoUri, onUpdateItemQuery, onUpdateItemTitle, onUpdateItemQuantity, onSaveDraft, cameraMode = 'camera' }) => {

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
      const next: Record<string, string> = {};
      for (const item of bulkItems) {
        const existingDraft = prev[item.id];
        if (typeof existingDraft === 'string') {
          next[item.id] = existingDraft;
          continue;
        }
        const quantity = item.quantity ?? 1;
        next[item.id] = String(quantity);
      }
      return next;
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

  const hasLoadingItems = Object.values(itemLoadingStates || {}).some(state => state.isLoading);
  const hasAnyPhotos = displayItems.some(item => item.photos.length > 0);
  const hasAnyItems = totalItems > 0;
  const shouldShowBottomActions =
    cameraMode === 'shelf'
      ? true
      : hasAnyItems || hasAnyPhotos;

  // Shared handler: analyze and navigate to match/generate flow (accounts for quick scan selections)
  const handleAnalyzeAndNavigate = React.useCallback(async () => {
    onSaveDraft?.();
    const firstPhotos = bulkItems.map(item => item.photos[0]).filter(Boolean);
    if (firstPhotos.length === 0) {
      Alert.alert('No Photos', 'Please take some photos first before searching.');
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
      const jobResponseData: JobResponse = await performAnalyze(firstPhotos);
      console.log('[ANALYZE] Job Response:', jobResponseData);
      setJobResponse(jobResponseData);
      const jobId = jobResponseData?.jobId;

      if (jobId) {
        const mergedConfirmedQuickMatch = { ...confirmedQuickMatchByItemId };
        bulkItems.forEach(item => {
          if (item.preSelectedSource) {
            mergedConfirmedQuickMatch[item.id] = {
              serpApiData: [item.preSelectedSource],
              preSelectedIndices: [0]
            };
          }
        });

        navigation.navigate('LoadingScreen', {
          processType: 'match',
          payload: {
            jobId,
            bulkItems,
            firstPhotos,
            confirmedQuickMatchByItemId: mergedConfirmedQuickMatch,
            skipMatchSelection: true,
            autoGenerateAllPlatforms: true,
          },
          onCompleteRoute: {
            screen: 'MatchSelectionScreen',
            params: {
              jobResponse: jobResponseData,
              response: {
                jobId,
                bulkItems,
                firstPhotos,
                confirmedQuickMatchByItemId: mergedConfirmedQuickMatch,
              },
            },
          },
        });
      } else {
        Alert.alert('Error', 'Failed to start analysis. Please try again.');
      }
    } catch (error) {
      console.error('[ANALYZE] Error:', error);
      Alert.alert('Error', 'Failed to start analysis. Please try again.');
    }
  }, [
    bulkItems,
    confirmedQuickMatchByItemId,
    performAnalyze,
    onStartBroadSearch,
    setJobResponse,
    setItemLoadingStates,
    navigation,
    onSaveDraft,
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
                // Fast downward swipe - close completely
                onClose();
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
              paddingBottom: bottomMargin
            }
          ]}
        >
          {displayItems.length === 0 ? (
            (() => {
              if (currentInstruction && currentInstruction !== 'ready') {
                if (shelfPhotoUri) {
                  return (
                    <View style={{ height: 350, borderRadius: 16, overflow: 'hidden', margin: 20, backgroundColor: '#000' }}>
                      <Image source={{ uri: shelfPhotoUri }} style={{ width: '100%', height: '100%', opacity: 0.5 }} resizeMode="cover" />
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="large" color="#ffffff" style={{ marginBottom: 16, transform: [{ scale: 1.2 }] }} />
                        <Text style={{ fontSize: 18, color: '#ffffff', fontWeight: '600', textAlign: 'center', paddingHorizontal: 20 }}>
                          {'Recognizing...'}
                        </Text>
                      </View>
                    </View>
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
                  {/* Show shelf photo at top if we are still processing/searching */}
                  {shelfPhotoUri && ['extracting', 'optimizing', 'searching'].includes(currentInstruction || '') && (
                    <View style={{ height: 200, borderRadius: 12, overflow: 'hidden', marginBottom: 16, backgroundColor: '#000' }}>
                      <Image source={{ uri: shelfPhotoUri }} style={{ width: '100%', height: '100%', opacity: 0.6 }} resizeMode="cover" />
                      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="small" color="#ffffff" style={{ marginBottom: 8 }} />
                        <Text style={{ fontSize: 14, color: '#ffffff', fontWeight: '600' }}>
                          {'Recognizing...'}
                        </Text>
                      </View>
                    </View>
                  )}
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
                    const countDraft = countDraftByItemId[item.id] ?? String(item.quantity ?? 1);

                    if (currentInstruction === 'extracting' || currentInstruction === 'optimizing') {
                      return (
                        <View key={`apple-notes-${item.id}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#f0f0f0' }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                            <Text style={{ fontSize: 16, color: '#333' }}>Item {id + 1}</Text>
                            {item.quantity != null && item.quantity > 1 && (
                              <View style={{ marginLeft: 8, backgroundColor: '#10B981', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 }}>
                                <Text style={{ fontSize: 12, color: 'white', fontWeight: '600' }}>x{item.quantity}</Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ fontSize: 14, color: '#999' }}>Thinking...</Text>
                        </View>
                      );
                    }

                    if (currentInstruction === 'searching' && !hasQuickScanData && !loadingState?.isLoading) {
                      return (
                        <View key={`skeleton-${item.id}`} style={[styles.bulkItemContainer, { borderColor: '#E0E0E0', borderWidth: 1 }]}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                            <View style={{ width: 120, height: 20, backgroundColor: '#F0F0F0', borderRadius: 4 }} />
                            <View style={[styles.loadingBadge, { backgroundColor: '#F0F9FF' }]}>
                              <ActivityIndicator size="small" color="#0284C7" style={{ transform: [{ scale: 0.7 }] }} />
                              <Text style={[styles.loadingBadgeText, { color: '#0369A1' }]}>Searching catalog...</Text>
                            </View>
                          </View>
                          <View style={styles.photoSlotsContainer}>
                            <View style={[styles.photoSlot, { backgroundColor: '#F9F9F9', borderColor: '#EAEAEA' }]} />
                            <View style={[styles.addPhotoButton, { backgroundColor: '#F9F9F9', borderColor: '#EAEAEA' }]} />
                          </View>
                        </View>
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
                              <ActivityIndicator size="small" color="#93C822" style={{ transform: [{ scale: 0.75 }] }} />
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
                            style={styles.selectedMatchCard}
                            onPress={(e) => {
                              e.stopPropagation?.();
                              onOpenQuickMatches?.(item.id);
                            }}
                          >
                            {selectedMatchImage ? (
                              <Image source={{ uri: selectedMatchImage }} style={styles.selectedMatchImage} />
                            ) : (
                              <View style={[styles.selectedMatchImage, { backgroundColor: '#E2E8F0' }]} />
                            )}
                            <View style={{ flex: 1, marginRight: 8 }}>
                              <Text style={styles.selectedMatchLabel}>{confirmedMatch ? 'Selected Match' : `${matchCount} Match${matchCount > 1 ? 'es' : ''} Found`}</Text>
                              <Text style={styles.selectedMatchTitle} numberOfLines={1}>{selectedMatchTitle}</Text>
                            </View>
                            <View style={styles.matchActionPill}>
                              <Text style={styles.matchActionPillText}>Change</Text>
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
              onPress={cameraMode === 'shelf' && totalItems === 0 ? onImageUpload : handleAnalyzeAndNavigate}
            >
              {hasLoadingItems ? (
                <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 8 }} />
              ) : (
                <Icon
                  name={cameraMode === 'shelf' && totalItems === 0 ? 'camera-plus-outline' : 'rocket-launch-outline'}
                  size={20}
                  color="white"
                />
              )}
              <Text style={[styles.searchForProductButtonText, { marginLeft: 8 }]}>
                {cameraMode === 'shelf' && totalItems === 0
                  ? 'Take shelf photo'
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
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  flashOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'white',
    opacity: 0,
  },
  tapToFocusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  // Photo Stack Styles
  photoStackContainer: {
    position: 'absolute',
    top: 100,
    left: 20,
    zIndex: 10,
  },
  photoStackRow: {
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  activeItemIndicator: {
    width: 72,
    backgroundColor: '#93C822',
    borderWidth: 2,
    borderColor: '#93C822',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  activeItemIndicatorText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '700',
  },
  photoStackItem: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  photoStackImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  photoStackNumber: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  photoStackNumberText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  coverBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Camera Controls Styles
  cameraControlsContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 100,
  },
  cameraControlsContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },


  centerOverlay: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerOverlayText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
  },
  processingIndicator: {
    marginLeft: 8,
  },

  // Barcode Overlay Styles
  barcodeOverlayContainer: {
    position: 'absolute',
    top: 140, // Below nav bar
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  },

  textSearchOverlay: {
    position: 'absolute',
    top: 120,
    left: 20,
    right: 20,
    zIndex: 200,
  },
  textSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4 },
      android: { elevation: 5 },
    }),
  },
  textSearchInput: {
    flex: 1,
    height: 36,
    fontSize: 16,
    color: '#000',
  },
  textSearchClose: {
    padding: 4,
    marginLeft: 8,
  },
  barcodeOverlay: {
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  barcodeText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
    maxWidth: 200,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  copyButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '500',
  },

  // Photo Frame & Scan Line Styles
  photoFrameOverlay: {
    position: 'absolute',
    top: '25%',
    left: '10%',
    right: '10%',
    bottom: '35%',
    borderWidth: 2,
    borderColor: 'rgba(200, 200, 200, 0.5)',
    borderRadius: 12,
    backgroundColor: 'transparent',
  },
  scanLineContainer: {
    position: 'absolute',
    top: '25%',
    left: '10%',
    right: '10%',
    bottom: '35%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanLine: {
    width: '100%',
    height: 3,
    backgroundColor: '#4CAF50',
    opacity: 0.8,
  },

  // Bottom Controls Styles
  bottomControls: {
    position: 'absolute',
    bottom: 100,
    left: 0,
    right: 0,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    zIndex: 10,
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 40,
    marginBottom: 20,
  },
  galleryButton: {
    flexDirection: "column",
    justifyContent: 'center',
    alignItems: 'center',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
  },
  focusButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Mode Selector Styles
  modeSelectorWrapper: {
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
    zIndex: 100, // Ensure popup is above other elements
  },
  modeButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  modePopup: {
    position: 'absolute',
    right: -40,
    bottom: 65, // Position above the button
    alignItems: 'flex-end',
    width: 350, // Wide enough for 3 items
    // Center the popup (280px) over the button (50px).
    // Button is right aligned in wrapper. Wrapper is 50px.
    // To center 280 over 50: right = -(280-50)/2 = -115
    paddingRight: 30,
  },
  modePopupContent: {
    flexDirection: 'row',
    backgroundColor: '#000',
    borderRadius: 24,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'space-between',
    width: '100%',
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.30, shadowRadius: 4.65 },
      android: { elevation: 8 },
    }),
  },
  modePopupItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    gap: 8,
    flex: 1,
  },
  modePopupItemActive: {
    backgroundColor: 'rgba(147, 200, 34, 0.2)', // Anorha green tint for active
  },
  modePopupLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  modePopupLabelActive: {
    color: '#fff',
  },
  modePopupIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  modePopupIconContainerActive: {
    borderColor: '#fff',
    backgroundColor: '#93C822', // Anorha green for active icon
  },
  modePopupArrow: {
    width: 0,
    height: 0,
    backgroundColor: 'transparent',
    borderStyle: 'solid',
    borderLeftWidth: 10,
    borderRightWidth: 10,
    borderBottomWidth: 0,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    borderTopColor: '#000', // Match content background
    marginTop: -1,
    // Arrow should be centered on the button. 
    // Popup is centered on the button.
    // So arrow should be centered on the popup.
    // Since alignItems is center on modePopup, just remove margins.
  },
  continueButtonContainer: {
    paddingHorizontal: 20,
  },
  barcodeActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  barcodeSecondaryButton: {
    flex: 1,
    borderRadius: 22,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  barcodeSecondaryText: {
    color: '#E5E7EB',
    fontSize: 16,
    fontWeight: '600',
  },
  itemNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemNavArrow: {
    height: 48,
    flexDirection: "row",
    paddingHorizontal: 8,
    gap: 4,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemNavArrowDisabled: {
    opacity: 0.4,
  },
  itemNavNewButton: {
    backgroundColor: 'rgb(127, 127, 127)',
  },
  continueButton: {
    flex: 1,
    marginHorizontal: 12,
    backgroundColor: '#93C822',
    borderRadius: 22,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonDisabled: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  continueButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  itemCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginRight: 8,
  },
  itemCountBadgeText: {
    color: 'rgba(0,0,0,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },

  // Sheet Styles
  matchSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 4,
    paddingBottom: 0,
    marginBottom: 0,
    maxHeight: SCREEN_HEIGHT * 0.9,
  },
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
  reviewItemsHint: {
    fontSize: 12,
    color: '#888',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  matchActionsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  reviewDetailsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 25,
    backgroundColor: '#f5f5f5',
    gap: 8,
  },
  reviewDetailsButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },
  listProductButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 25,
    backgroundColor: '#93C822',
    gap: 8,
  },
  listProductButtonDisabled: {
    backgroundColor: '#e0e0e0',
  },
  listProductButtonText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  sheetContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },

  // Match Results Styles
  matchResults: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  matchCard: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    position: 'relative',
    minHeight: 120,
  },
  matchCardSelected: {
    borderColor: '#93C822',
    backgroundColor: 'rgba(147, 200, 34, 0.08)',
  },
  matchImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginRight: 12,
  },
  matchInfo: {
    flex: 1,
  },
  matchTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  matchDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  matchPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 4,
  },
  matchShipping: {
    fontSize: 12,
    color: '#2563eb',
    marginBottom: 4,
  },
  matchSource: {
    fontSize: 12,
    color: '#888',
    fontStyle: 'italic',
  },
  matchSelectionOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
  },
  matchCheckmark: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#93C822',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3 },
      android: { elevation: 4 },
    }),
  },
  selectionHint: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  manualSafetyWrap: {
    marginBottom: 10,
  },
  manualSafetyLabel: {
    color: '#666',
    fontSize: 12,
    marginBottom: 6,
  },
  manualSafetyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  manualSafetyInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#111',
    backgroundColor: '#FFF',
    fontSize: 13,
  },
  manualSafetyButton: {
    backgroundColor: '#111',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  manualSafetyButtonText: {
    color: '#FFF',
    fontWeight: '600',
    fontSize: 13,
  },
  primaryButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  sheetActions: {
    paddingHorizontal: 20,
  },
  primaryButton: {
    backgroundColor: '#93C822',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 12,
  },
  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#666',
    fontSize: 14,
    fontWeight: '500',
  },

  // Deep Search Styles
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchPlaceholder: {
    flex: 1,
    fontSize: 16,
    color: '#666',
  },
  searchSubmitButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 20,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  templateOptions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  templateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  templateButtonText: {
    fontSize: 14,
    color: '#666',
  },
  broadSearchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 12,
    gap: 8,
    marginBottom: 20,
  },
  broadSearchText: {
    fontSize: 16,
    color: '#666',
  },
  broadSearchButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2196F3',
  },
  // Green notification indicator styles for quick matches button
  quickMatchesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderWidth: 2,
    borderColor: '#e1e1e1ff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 10,
    gap: 6,
  },
  quickMatchesButtonText: {
    color: '#93C822',
    fontSize: 13,
    fontWeight: '600',
  },
  matchNotificationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#93C822',
  },
  photoAttachments: {
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 16,
    marginBottom: 100,
  },
  attachmentTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  attachmentPhotos: {
    flexDirection: 'row',
    gap: 8,
  },
  attachmentPhoto: {
    position: 'relative',
    width: 50,
    height: 50,
    borderRadius: 8,
    overflow: 'hidden',
  },
  attachmentPhotoImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  attachmentPhotoNumber: {
    position: 'absolute',
    top: 2,
    right: 2,
    backgroundColor: 'rgba(0,0,0,0.7)',
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 8,
  },

  // Bulk Items Sheet Styles
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
  emptyPhotoSlot: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
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
  editItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  editItemButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  deleteItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  deleteItemButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#DC2626',
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
  disabledButton: {
    backgroundColor: '#e0e0e0',
    opacity: 0.6,
  },
  searchForProductButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },

  // New Bulk Sheet Styles
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
  selectedMatchTitle: {
    fontSize: 13,
    color: '#1E293B',
    fontWeight: '600',
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

  // Progress Bar Styles
  progressBarContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 20,
  },
  progressBarBackground: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#93C822',
    borderRadius: 2,
  },
  progressSpinner: {
    marginLeft: 12,
    width: 20,
    height: 20,
  },

  // Notification Bar Styles
  notificationBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 25,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 30,
  },
  notificationText: {
    color: 'white',
    fontSize: 14,
    marginLeft: 10,
    flex: 1,
    fontWeight: '500',
  },

  // Permission Styles
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  permissionText: {
    fontSize: 16,
    color: '#ccc',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 30,
  },
  permissionButton: {
    backgroundColor: '#93C822',
    borderRadius: 25,
    paddingHorizontal: 30,
    paddingVertical: 15,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },

  // Debug styles
  debugOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 40 : 20,
    left: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 6,
    padding: 8,
    zIndex: 100,
  },
  debugText: {
    color: 'white',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    textAlign: 'center',
  },
  debugButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    gap: 10,
  },
  debugButton: {
    backgroundColor: 'rgba(76, 175, 80, 0.8)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  debugButtonText: {
    color: 'white',
    fontSize: 10,
    fontWeight: '600',
  },

  // Camera paused overlay styles
  cameraPausedOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },
  cameraPausedIndicator: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 12,
    padding: 20,
  },
  cameraPausedText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  cameraPausedSubtext: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 10,
  },
  closeButtonInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
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
  sheetHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#93C822',
    fontSize: 16,
    fontWeight: '600',
    marginTop: 10,
  },
  barcodeResultContainer: {
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    marginHorizontal: 20,
    marginBottom: 20,
  },
  barcodeProductImage: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    marginBottom: 20,
  },
  barcodeProductDetails: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  barcodeProductTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  barcodeProductDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 10,
  },
  barcodeProductMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  barcodeMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  barcodeMetaLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  barcodeMetaValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  barcodePlatformIndicators: {
    flexDirection: 'row',
    gap: 10,
  },
  barcodePlatformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  barcodePlatformChipText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  barcodeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
});

export default AddProductScreen;   

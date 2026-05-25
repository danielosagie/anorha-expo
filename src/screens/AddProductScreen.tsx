import React, { useState, useRef, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config/env';
import type { UnicodeSpinnerDefinition, CameraMode } from './AddProduct/types';
import { cleanMatchText } from './AddProduct/utils';
import { UnicodeSpinner } from './AddProduct/UnicodeSpinner';
import { CenterOverlay } from './AddProduct/CenterOverlay';
import { BottomControls } from './AddProduct/BottomControls';
import { ProgressBarOverlay } from './AddProduct/ProgressBarOverlay';
import { NotificationBar } from './AddProduct/NotificationBar';
import { MatchResultsSheet } from './AddProduct/MatchResultsSheet';
import { BulkItemsSheet } from './AddProduct/BulkItemsSheet';
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
import spinners from 'unicode-animations';
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
import { Camera as CameraIcon, RotateCcw } from 'lucide-react-native';

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
import BillingGateSheet from '../components/BillingGateSheet';
import useFreemiumUsage from '../hooks/useFreemiumUsage';
import useBillingGate from '../hooks/useBillingGate';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import BarcodeEntrySheet from '../components/camera/BarcodeEntrySheet';
import { ENABLE_DOC_MODES } from '../config/features';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { PricingResearchModal } from '../components/PricingResearchModal';
import {
  startTrace,
  getTraceHeaders,
  logFlowEvent,
  FlowEvents,
} from '../lib/mobileFlowLogger';
import { buildMatchAnalyzeProducts } from '../utils/buildMatchAnalyzeProducts';
import { openQuickScanStream, QuickScanPhase, QuickScanStreamEvent } from '../lib/quickScanStream';
import { ShelfScanPlaceholderRow, ShelfScanProgressCard } from '../components/camera/ShelfScanProgressCard';
import BottomActionBar from '../components/BottomActionBar';
import { BillingGateResponse, normalizeBillingGateResponse } from '../types/billingGate';
import {
  clearPendingBillingAction,
  loadPendingBillingAction,
  PendingBillingAction,
  savePendingBillingAction,
} from '../utils/billingGatePersistence';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BULK_MODAL_FTUX_KEY = '@anorha_hasSeenBulkItemsModal';
const MAX_BATCH_ITEMS = 100;
const QUICK_SCAN_QUEUE_LIMIT = 100;
const QUICK_MATCH_AUTO_SELECT_CONFIDENCE = 0.72;

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
  productId?: string;
  variantId?: string;
  productUrl?: string;
  isLocalMatch?: boolean;
  queryKey?: string;
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

type QuickMatchSelection = {
  serpApiData: any[];
  preSelectedIndices: number[];
  source?: 'quick_scan_auto' | 'quick_scan_confirmed';
  confidence?: number;
  reasoning?: string;
};

type ItemLoadingState = {
  isLoading: boolean;
  stage: string;
  error?: string;
};

type ItemStage = 'submitted_for_match' | 'awaiting_user_input' | 'generating' | 'generated' | 'existing_inventory';

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
type ShelfProgressStatus = 'idle' | 'streaming' | 'completed' | 'no_items' | 'timeout' | 'error';

type ShelfProgressState = {
  phase: QuickScanPhase;
  progress: number;
  elapsedMs: number;
  totalItems: number;
  completedItems: number;
  stalled: boolean;
  status: ShelfProgressStatus;
  reasonCode?: string;
  message?: string;
};

const initialShelfProgressState = (): ShelfProgressState => ({
  phase: 'inspecting_shelf',
  progress: 0,
  elapsedMs: 0,
  totalItems: 0,
  completedItems: 0,
  stalled: false,
  status: 'idle',
});

// --- Design-export seed data (used only when route.params.designState is set on web) ---
const DS_SHELF_URI = 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=800&q=70';
const dsPhoto = (seed: string, isCover = false): CapturedPhoto => ({
  id: seed, uri: `https://picsum.photos/seed/${seed}/600/800`, width: 600, height: 800, timestamp: Date.now(), isCover,
});
const dsBuildItems = () => ([
  { id: 'ds-1', title: 'Organic Coconut Oil', isActive: true, photos: [dsPhoto('dsa', true), dsPhoto('dsb'), dsPhoto('dsc')] },
  { id: 'ds-2', title: 'African Spice Set', photos: [dsPhoto('dsd', true), dsPhoto('dse')] },
  { id: 'ds-3', title: 'Jamaican Coffee Beans', photos: [dsPhoto('dsf', true)] },
]);
const DS_MATCH: MatchResponse = {
  systemAction: 'show_multiple_matches',
  confidence: 'high',
  totalMatches: 3,
  rankedCandidates: [
    { id: 'm1', title: 'Organic Coconut Oil — 32oz', description: 'Cold-pressed, unrefined', price: 24.99, imageUrl: 'https://picsum.photos/seed/m1/240', productUrl: '', sourceUrl: 'https://amazon.com', isLocalMatch: false } as any,
    { id: 'm2', title: 'Virgin Coconut Oil Jar', description: 'Organic, 32oz', price: 21.5, imageUrl: 'https://picsum.photos/seed/m2/240', productUrl: '', sourceUrl: 'https://walmart.com', isLocalMatch: false } as any,
    { id: 'm3', title: 'Cold Pressed Coconut Oil', description: 'Fair trade', price: 27.0, imageUrl: 'https://picsum.photos/seed/m3/240', productUrl: '', sourceUrl: 'https://ebay.com', isLocalMatch: true } as any,
  ],
};
const dsShelfProgress = (status: ShelfProgressStatus): ShelfProgressState => (
  status === 'completed'
    ? { phase: 'inspecting_shelf', progress: 1, elapsedMs: 14000, totalItems: 12, completedItems: 12, stalled: false, status: 'completed' }
    : { phase: 'inspecting_shelf', progress: 0.6, elapsedMs: 8000, totalItems: 12, completedItems: 7, stalled: false, status: 'streaming' }
);

const parseShelfScanErrorMessage = (rawMessage?: string) => {
  if (!rawMessage) {
    return {
      reasonCode: undefined as string | undefined,
      message: 'The shelf stream stopped before results came back.',
    };
  }

  try {
    const parsed = JSON.parse(rawMessage);
    if (parsed?.statusCode === 402 || parsed?.code === 'free_tier_exhausted') {
      return {
        reasonCode: 'free_tier_exhausted',
        message: 'Free scans are used up. Upgrade to scan another shelf.',
      };
    }

    return {
      reasonCode: parsed?.code || parsed?.reasonCode,
      message: parsed?.message || rawMessage,
    };
  } catch {
    return {
      reasonCode: rawMessage.includes('402') ? 'free_tier_exhausted' : undefined,
      message: rawMessage.includes('402')
        ? 'Free scans are used up. Upgrade to scan another shelf.'
        : rawMessage,
    };
  }
};

const getShelfProgressPresentation = (progress: ShelfProgressState) => {
  if (progress.status === 'no_items') {
    return {
      title: 'No items detected',
      subtitle: progress.message || 'Try a tighter photo with clearer package labels.',
      instruction: 'ready' as CameraInstruction,
    };
  }

  if (progress.status === 'timeout') {
    return {
      title: 'Scan took too long',
      subtitle: progress.message || 'Retry the same photo or take a clearer shelf shot.',
      instruction: 'ready' as CameraInstruction,
    };
  }

  if (progress.status === 'error') {
    if (progress.reasonCode === 'free_tier_exhausted') {
      return {
        title: 'Free scans used up',
        subtitle: 'Upgrade to scan another shelf.',
        instruction: 'ready' as CameraInstruction,
      };
    }

    return {
      title: 'Scan hit a snag',
      subtitle: progress.message || 'The shelf stream stopped before results came back.',
      instruction: 'ready' as CameraInstruction,
    };
  }

  switch (progress.phase) {
    case 'separating_items':
      return {
        title: 'Separating items',
        subtitle: 'Breaking the shelf into distinct packages before matching.',
        instruction: 'extracting' as CameraInstruction,
      };
    case 'reading_labels':
      return {
        title: 'Reading labels',
        subtitle: 'Pulling brand names, model numbers, and search terms.',
        instruction: 'optimizing' as CameraInstruction,
      };
    case 'searching_matches':
      return {
        title: progress.completedItems > 0 ? 'Streaming in matches' : 'Searching matches',
        subtitle: progress.completedItems > 0
          ? `Matched ${progress.completedItems} of ${Math.max(progress.totalItems, progress.completedItems)} detected items so far.`
          : 'Looking up each detected item and filling the queue as matches land.',
        instruction: 'searching' as CameraInstruction,
      };
    case 'finishing':
      return {
        title: 'Finishing analysis',
        subtitle: 'Wrapping up the last shelf results.',
        instruction: 'searching' as CameraInstruction,
      };
    case 'inspecting_shelf':
    default:
      return {
        title: 'Inspecting shelf',
        subtitle: 'Looking for item boundaries, label clusters, and readable packages.',
        instruction: 'analyzing' as CameraInstruction,
      };
  }
};

const shouldAutoSelectQuickMatch = ({
  totalMatches,
  recommendedAction,
  rerankerConfidence,
  topCandidateIsLocalMatch,
}: {
  totalMatches: number;
  recommendedAction?: MatchResponse['systemAction'] | string;
  rerankerConfidence?: number;
  topCandidateIsLocalMatch?: boolean;
}) => {
  if (totalMatches <= 0) return false;
  // F1: SmartPicker returns confidence: 0 when it explicitly rejects every
  // candidate ("none of these match"). Treat that as a hard veto so we don't
  // pre-select a wrong product and silently lead the user to confirm garbage.
  // Local matches are exempt — those are the user's own past products and the
  // reranker score is informational at best.
  if (
    typeof rerankerConfidence === 'number' &&
    rerankerConfidence === 0 &&
    !topCandidateIsLocalMatch
  ) {
    return false;
  }
  if (topCandidateIsLocalMatch) return true;
  if (totalMatches === 1) return true;
  if (recommendedAction === 'show_single_match') return true;
  return typeof rerankerConfidence === 'number' && rerankerConfidence >= QUICK_MATCH_AUTO_SELECT_CONFIDENCE;
};

const getSelectedQuickMatchCandidate = (
  matchInfo?: QuickMatchSelection | null,
  store?: { matchData: MatchResponse; serpApiData: any[] } | null,
) => {
  if (matchInfo && Array.isArray(matchInfo.serpApiData) && matchInfo.preSelectedIndices?.length) {
    const selectedIndex = matchInfo.preSelectedIndices[0];
    return {
      candidate: matchInfo.serpApiData[selectedIndex] ?? null,
      isConfirmed: true,
    };
  }

  return {
    candidate: store?.matchData?.rankedCandidates?.[0] ?? null,
    isConfirmed: false,
  };
};

const rankedCandidatesToQuickMatchHintCandidates = (candidates: MatchCandidate[] = []): any[] => (
  candidates.map((candidate, index) => ({
    position: index + 1,
    id: candidate.id,
    productId: candidate.productId,
    variantId: candidate.variantId,
    title: candidate.title || 'Unknown Product',
    description: candidate.description || '',
    snippet: candidate.description || '',
    link: candidate.productUrl || candidate.sourceUrl || '',
    sourceUrl: candidate.sourceUrl || candidate.productUrl || '',
    productUrl: candidate.productUrl || candidate.sourceUrl || '',
    source: 'quickscan',
    isLocalMatch: Boolean(candidate.isLocalMatch),
    thumbnail: candidate.imageUrl || '',
    image: candidate.imageUrl || '',
    imageUrl: candidate.imageUrl || '',
    price: typeof candidate.price === 'number'
      ? { value: `$${candidate.price}`, extracted_value: candidate.price, currency: 'USD' }
      : candidate.price,
  }))
);

const getLocalInventoryCandidateForItem = (
  itemId: string,
  confirmedQuickMatchByItemId: Record<string, QuickMatchSelection>,
  quickScanStore: Record<string, { matchData: MatchResponse; serpApiData: any[] }>,
) => {
  const confirmedCandidate = getSelectedQuickMatchCandidate(
    confirmedQuickMatchByItemId[itemId],
    quickScanStore[itemId],
  ).candidate as any;

  if (confirmedCandidate?.isLocalMatch) {
    return confirmedCandidate;
  }

  const rankedLocalMatch = quickScanStore[itemId]?.matchData?.rankedCandidates?.find((candidate) => candidate?.isLocalMatch);
  if (rankedLocalMatch) {
    return rankedLocalMatch as any;
  }

  return quickScanStore[itemId]?.serpApiData?.find((candidate: any) => candidate?.isLocalMatch) ?? null;
};

const getConnectedPlatformKeys = (platformLocations: Array<{ platformType?: string }>) => (
  Array.from(
    new Set(
      platformLocations
        .map((entry) => String(entry.platformType || '').trim().toLowerCase())
        .filter(Boolean)
    )
  )
);

const AddProductScreen: React.FC<AddProductScreenProps | {}> = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const theme = useTheme();
  const rawParams = (route.params ?? {}) as any;
  const __ds = rawParams?.designState as string | undefined; // design-export state seed (web only)
  const __dsHasItems = !!__ds && ['withItems', 'loading', 'shelfComplete', 'matchSheet'].includes(__ds);
  const params = ((rawParams?.params && typeof rawParams.params === 'object') ? rawParams.params : rawParams) as {
    sessionId?: string;
    firstPhotos?: any[];
    bulkItems?: any[];
    itemStageById?: Record<string, ItemStage>;
    processedItemIds?: string[];
  };
  const sessionIdParam = params?.sessionId;

  const sessionIdRef = useRef<string | null>(null);
  const shelfPhotoUriForDraftRef = useRef<string | null>(null);
  const saveDraftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSessionCreatePromiseRef = useRef<Promise<string | null> | null>(null);
  const hasAutoOpenedFtuxRef = useRef(false);

  console.log('[RENDER] AddProductScreen rendered');

  // Camera state
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraMode, setCameraMode] = useState<'camera' | 'barcode' | 'manifest' | 'receipt' | 'shelf'>(
    (rawParams?.initialCameraMode as any) || 'camera'
  );

  // Animation values - separate for each modal (declared early to avoid a TDZ crash on web)
  const sheetTranslateY = useSharedValue((__ds === 'shelfScanning' || __ds === 'shelfComplete') ? 0 : SCREEN_HEIGHT);
  const matchSheetTranslateY = useSharedValue(__ds === 'matchSheet' ? 0 : SCREEN_HEIGHT);

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
  const [shelfPhotoUri, setShelfPhotoUri] = useState<string | null>(
    () => (__ds === 'shelfScanning' || __ds === 'shelfComplete') ? DS_SHELF_URI : null
  );
  const [isProcessingShelfScan, setIsProcessingShelfScan] = useState(() => __ds === 'shelfScanning');
  const [shelfProgress, setShelfProgress] = useState<ShelfProgressState>(
    () => __ds === 'shelfScanning' ? dsShelfProgress('streaming')
      : __ds === 'shelfComplete' ? dsShelfProgress('completed')
        : initialShelfProgressState()
  );
  const shelfScanStreamRef = useRef<ReturnType<typeof openQuickScanStream> | null>(null);
  const lastShelfScanPhotoRef = useRef<CapturedPhoto | null>(null);

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
        const API_BASE = API_BASE_URL;
        const res = await fetch(`${API_BASE}/api/products/quick-scan-sessions/${sessionIdParam}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const session = await res.json();
        const items = session.ScannedItems ?? session.scannedItems ?? [];
        const matchCtx = session.MatchContext ?? session.matchContext ?? {};
        const shelfUri = session.ShelfPhotoUri ?? session.shelfPhotoUri ?? null;
        const activeId = session.ActiveItemId ?? session.activeItemId ?? null;
        const stageById = session.ItemStageById ?? session.itemStageById ?? {};
        const processedIds = session.ProcessedItemIds ?? session.processedItemIds ?? [];
        if (items.length > 0 && !cancelled) {
          setBulkItems(items);
          setQuickScanStore(matchCtx);
          setShelfPhotoUri(shelfUri);
          setActiveItemId(activeId || items[0]?.id || null);
          setItemStageById((stageById && typeof stageById === 'object') ? stageById : {});
          setProcessedItemIds(Array.isArray(processedIds) ? processedIds : []);
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
  const ensureDraftSessionId = useCallback(async (payload: { scannedItems: any[]; matchContext: Record<string, any>; shelfPhotoUri?: string | null; activeItemId?: string | null; itemStageById?: Record<string, ItemStage>; processedItemIds?: string[] }): Promise<string | null> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    if (draftSessionCreatePromiseRef.current) return draftSessionCreatePromiseRef.current;

    draftSessionCreatePromiseRef.current = (async () => {
      const token = await ensureSupabaseJwt();
      const API_BASE = API_BASE_URL;
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

  const saveDraftToBackend = useCallback(async (payload: { scannedItems: any[]; matchContext: Record<string, any>; shelfPhotoUri?: string | null; activeItemId?: string | null; itemStageById?: Record<string, ItemStage>; processedItemIds?: string[] }) => {
    if (isHydratingRef.current) return;
    try {
      const token = await ensureSupabaseJwt();
      const API_BASE = API_BASE_URL;
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
  const [currentInstruction, setCurrentInstruction] = useState<CameraInstruction>(
    () => __ds === 'loading' ? 'processing' : 'ready'
  );
  const [showMatchSheet, setShowMatchSheet] = useState(() => __ds === 'matchSheet');
  const [showViewPhotosModal, setShowViewPhotosModal] = useState(false);
  const [showDeepSearchSheet, setShowDeepSearchSheet] = useState(() => __ds === 'shelfScanning' || __ds === 'shelfComplete');
  const [hasSeenBulkModalFtux, setHasSeenBulkModalFtux] = useState<boolean | null>(null);
  const [matchData, setMatchData] = useState<MatchResponse | null>(() => __ds === 'matchSheet' ? DS_MATCH : null);
  // Quick scan storage per item and current sheet context
  const [quickScanStore, setQuickScanStore] = useState<Record<string, { matchData: MatchResponse; serpApiData: any[] }>>({});
  const [currentMatchItemId, setCurrentMatchItemId] = useState<string | null>(null);
  // Confirmed quick-match per item: when user taps "List Product" we store it so bulk Continue uses it instead of re-searching
  const [confirmedQuickMatchByItemId, setConfirmedQuickMatchByItemId] = useState<Record<string, QuickMatchSelection>>({});

  // Loading state tracking per item
  const [itemLoadingStates, setItemLoadingStates] = useState<Record<string, ItemLoadingState>>({});
  const [itemStageById, setItemStageById] = useState<Record<string, ItemStage>>(() => params?.itemStageById || {});
  const [processedItemIds, setProcessedItemIds] = useState<string[]>(() => params?.processedItemIds || []);

  // Bulk mode state
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [bulkItems, setBulkItems] = useState<Array<{
    id: string;
    photos: CapturedPhoto[];
    title?: string;
    isActive?: boolean;
    preSelectedSource?: any;
    quantity?: number;
  }>>(() => __dsHasItems ? (dsBuildItems() as any) : []);
  const [activeItemId, setActiveItemId] = useState<string | null>(() => __dsHasItems ? 'ds-1' : null);

  // Debounced auto-save when scan state changes (so drafts appear in Scan Drafts)
  useEffect(() => {
    if (
      isHydratingRef.current ||
      (bulkItems.length === 0 && Object.keys(itemStageById).length === 0 && processedItemIds.length === 0)
    ) return;
    if (saveDraftTimeoutRef.current) clearTimeout(saveDraftTimeoutRef.current);
    saveDraftTimeoutRef.current = setTimeout(() => {
      saveDraftTimeoutRef.current = null;
      saveDraftToBackend({
        scannedItems: bulkItems,
        matchContext: quickScanStore,
        shelfPhotoUri: shelfPhotoUriForDraftRef.current || shelfPhotoUri,
        activeItemId,
        itemStageById,
        processedItemIds,
      });
    }, 800);
    return () => { if (saveDraftTimeoutRef.current) clearTimeout(saveDraftTimeoutRef.current); };
  }, [activeItemId, bulkItems, itemStageById, processedItemIds, quickScanStore, shelfPhotoUri, saveDraftToBackend]);

  // Auto-scan state
  const [isAutoScanning, setIsAutoScanning] = useState(false);
  const [quickScanResults, setQuickScanResults] = useState<any[]>([]);

  // Job response state
  const [jobResponse, setJobResponse] = useState<JobResponse | null>(null);
  const quickScanCancelledRef = useRef(false);
  const quickScanQueueRef = useRef<Array<{ photo: CapturedPhoto; itemId: string }>>([]);
  const shelfQueryToItemIdRef = useRef<Record<string, string>>({});
  const hasTriggeredBulkModalFtuxRef = useRef(false);

  const closeShelfScanStream = useCallback(() => {
    shelfScanStreamRef.current?.close();
    shelfScanStreamRef.current = null;
  }, []);

  const resetShelfProgress = useCallback(() => {
    setShelfProgress(initialShelfProgressState());
  }, []);

  const resetShelfScanResults = useCallback(() => {
    shelfQueryToItemIdRef.current = {};
    setBulkItems([]);
    setQuickScanStore({});
    setConfirmedQuickMatchByItemId({});
    setItemLoadingStates({});
    setActiveItemId(null);
  }, []);

  const stopShelfScan = useCallback((nextStatus: ShelfProgressStatus, overrides?: Partial<ShelfProgressState>) => {
    closeShelfScanStream();
    setIsProcessingShelfScan(false);
    setShelfProgress((prev) => ({
      ...prev,
      status: nextStatus,
      stalled: false,
      phase: overrides?.phase ?? 'finishing',
      progress: overrides?.progress ?? (nextStatus === 'completed' ? 1 : prev.progress),
      elapsedMs: overrides?.elapsedMs ?? prev.elapsedMs,
      totalItems: overrides?.totalItems ?? prev.totalItems,
      completedItems: overrides?.completedItems ?? prev.completedItems,
      reasonCode: overrides?.reasonCode,
      message: overrides?.message,
    }));
    setCurrentInstruction(overrides?.message ? 'ready' : 'ready');
  }, [closeShelfScanStream]);

  const clearShelfScanForRetake = useCallback(() => {
    closeShelfScanStream();
    setIsProcessingShelfScan(false);
    setShowDeepSearchSheet(false);
    setShelfPhotoUri(null);
    shelfPhotoUriForDraftRef.current = null;
    resetShelfScanResults();
    resetShelfProgress();
    setCurrentInstruction('ready');
    sheetTranslateY.value = SCREEN_HEIGHT;
  }, [closeShelfScanStream, resetShelfProgress, resetShelfScanResults, sheetTranslateY]);

  useEffect(() => {
    return () => {
      closeShelfScanStream();
    };
  }, [closeShelfScanStream]);

  const markItemsProcessed = useCallback((processedItems: Array<{ id: string }>, nextStage: ItemStage = 'submitted_for_match') => {
    const processedIdsForStage = processedItems.map((item) => item.id).filter(Boolean);
    if (processedIdsForStage.length === 0) return;
    const submittedSet = new Set(processedIdsForStage);
    const nextBulkItems = bulkItems.filter((item) => !submittedSet.has(item.id));
    const nextQuickScanStore = Object.fromEntries(
      Object.entries(quickScanStore).filter(([id]) => !submittedSet.has(id))
    );
    const nextStageById: Record<string, ItemStage> = { ...itemStageById };
    processedIdsForStage.forEach((id) => {
      nextStageById[id] = nextStage;
    });
    const nextProcessed = Array.from(new Set([...processedItemIds, ...processedIdsForStage]));

    setItemStageById((prev) => {
      const next = { ...prev };
      processedIdsForStage.forEach((id) => {
        next[id] = nextStage;
      });
      return next;
    });
    setProcessedItemIds((prev) => Array.from(new Set([...prev, ...processedIdsForStage])));

    setBulkItems((prev) => prev.filter((item) => !processedIdsForStage.includes(item.id)));
    setQuickScanStore((prev) => {
      const next = { ...prev };
      processedIdsForStage.forEach((id) => {
        delete next[id];
      });
      return next;
    });
    setConfirmedQuickMatchByItemId((prev) => {
      const next = { ...prev };
      processedIdsForStage.forEach((id) => {
        delete next[id];
      });
      return next;
    });
    setItemLoadingStates((prev) => {
      const next = { ...prev };
      processedIdsForStage.forEach((id) => {
        delete next[id];
      });
      return next;
    });

    setActiveItemId((prev) => (prev && processedIdsForStage.includes(prev) ? null : prev));
    setCurrentInstruction('ready');
    setIsAutoScanning(false);
    setShowProgressBar(false);
    quickScanCancelledRef.current = true;
    quickScanQueueRef.current = [];
    void saveDraftToBackend({
      scannedItems: nextBulkItems,
      matchContext: nextQuickScanStore,
      shelfPhotoUri: shelfPhotoUriForDraftRef.current || shelfPhotoUri,
      activeItemId: processedIdsForStage.includes(activeItemId || '') ? null : activeItemId,
      itemStageById: nextStageById,
      processedItemIds: nextProcessed,
    });
  }, [activeItemId, bulkItems, itemStageById, processedItemIds, quickScanStore, saveDraftToBackend, shelfPhotoUri]);

  const markItemsSubmittedForMatch = useCallback((submittedItems: Array<{ id: string }>) => {
    markItemsProcessed(submittedItems, 'submitted_for_match');
  }, [markItemsProcessed]);

  useEffect(() => {
    const validIds = new Set(bulkItems.map((item) => item.id));
    setItemLoadingStates((prev) => {
      let changed = false;
      const next: Record<string, ItemLoadingState> = {};
      Object.entries(prev).forEach(([id, value]) => {
        if (validIds.has(id)) {
          next[id] = value;
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [bulkItems]);

  // Notification and progress state
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [showProgressBar, setShowProgressBar] = useState(() => __ds === 'loading');

  // Freemium / Paywall state
  const { status: freemiumStatus, refresh: refreshFreemiumStatus, incrementLocalUsage } = useFreemiumUsage();
  const { preflightAIGate } = useBillingGate();
  const [showTierSelector, setShowTierSelector] = useState(false);
  const [billingGate, setBillingGate] = useState<BillingGateResponse | null>(null);
  const [billingGateVisible, setBillingGateVisible] = useState(false);
  const billingGateResolverRef = useRef<((decision: 'continue' | 'billing' | 'dismiss') => void) | null>(null);
  const pendingBillingActionRef = useRef<PendingBillingAction | null>(null);
  const isResumingPendingBillingRef = useRef(false);

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


  // Guard against inconsistent modal state that can leave camera paused with no visible sheet.
  useEffect(() => {
    if (showMatchSheet && !matchData) {
      setShowMatchSheet(false);
      if (bulkItems.length > 0 || cameraMode === 'shelf') {
        setShowDeepSearchSheet(true);
        sheetTranslateY.value = withSpring(0);
      }
    }
  }, [showMatchSheet, matchData, bulkItems.length, cameraMode, sheetTranslateY]);

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

  useEffect(() => {
    loadPendingBillingAction().then((pending) => {
      pendingBillingActionRef.current = pending;
    }).catch((error) => {
      console.warn('[AddProduct] Failed to hydrate pending billing action:', error);
    });
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

  const closeBillingGateSheet = useCallback((decision: 'continue' | 'billing' | 'dismiss') => {
    setBillingGateVisible(false);
    setBillingGate(null);
    const resolver = billingGateResolverRef.current;
    billingGateResolverRef.current = null;
    resolver?.(decision);
  }, []);

  const presentBillingGateSheet = useCallback((nextGate: BillingGateResponse) => {
    setBillingGate(nextGate);
    setBillingGateVisible(true);
    return new Promise<'continue' | 'billing' | 'dismiss'>((resolve) => {
      billingGateResolverRef.current = resolve;
    });
  }, []);

  const persistPendingQuickScan = useCallback(async (photo: CapturedPhoto, itemId: string) => {
    const pendingAction: PendingBillingAction = {
      type: 'quick_scan',
      featureKey: 'ai_quick_scan',
      itemId,
      photo: {
        id: photo.id,
        uri: photo.uri,
        width: photo.width,
        height: photo.height,
        timestamp: photo.timestamp,
        isCover: photo.isCover,
      },
      createdAt: Date.now(),
    };

    pendingBillingActionRef.current = pendingAction;
    await savePendingBillingAction(pendingAction);
  }, []);

  const clearPendingQuickScan = useCallback(async () => {
    pendingBillingActionRef.current = null;
    await clearPendingBillingAction();
  }, []);

  const buildFreemiumBlockedGate = useCallback((): BillingGateResponse => normalizeBillingGateResponse({
    code: 'free_tier_exhausted',
    message: freemiumStatus
      ? `Free scans used (${freemiumStatus.usageCount}/${freemiumStatus.freeLimit}). Upgrade billing to keep scanning.`
      : 'Free scans are used up. Upgrade billing to keep scanning.',
    featureKey: 'ai_quick_scan',
    blockingState: 'free_tier_exhausted',
    canProceed: false,
    freeUsageCount: freemiumStatus?.usageCount,
    freeLimit: freemiumStatus?.freeLimit,
  }), [freemiumStatus]);

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
    productId?: string;
    variantId?: string;
    productUrl?: string;
    isLocalMatch?: boolean;
  }>): any[] => {
    const out: any[] = [];
    candidates.forEach((c, idx) => {
      out.push({
        position: idx + 1,
        id: c.id,
        productId: c.productId,
        variantId: c.variantId,
        title: c.title || 'Unknown Product',
        link: c.sourceUrl || '',
        productUrl: c.productUrl || c.sourceUrl || '',
        source: 'quickscan',
        isLocalMatch: Boolean(c.isLocalMatch),
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
      if (cameraMode === 'shelf' && shelfProgress.status !== 'idle') {
        return getShelfProgressPresentation(shelfProgress).title;
      }
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
        return cameraMode === 'shelf' ? 'Inspecting shelf' : 'Recognizing';
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
        `${API_BASE_URL}/api/products/search-by-barcode?barcode=${encodeURIComponent(barcode)}`,
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
      closeShelfScanStream();
      lastShelfScanPhotoRef.current = photo;
      shelfPhotoUriForDraftRef.current = photo.uri;
      setShelfPhotoUri(photo.uri);
      setCurrentInstruction('processing');
      setIsProcessingShelfScan(true);
      setShelfProgress({
        ...initialShelfProgressState(),
        status: 'streaming',
        phase: 'inspecting_shelf',
        progress: 0.08,
      });
      // Open sheet when user takes/uploads shelf photo so they see loading
      setShowDeepSearchSheet(true);
      sheetTranslateY.value = withSpring(0);
      resetShelfScanResults();

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
      const rawApiBase = API_BASE_URL;
      const API_BASE = rawApiBase;

      console.log(`[SHELF MODE] Starting SSE stream with ${base64.length} bytes`);
      const sseUrl = `${API_BASE}/api/products/orchestrate/quick-scan-stream`;
      shelfScanStreamRef.current = openQuickScanStream({
        url: sseUrl,
        token: token!,
        body: {
          images: [{ base64 }],
          mode: 'vlm-multi',
        },
        onStallChange: (stalled) => {
          setShelfProgress((prev) => ({ ...prev, stalled }));
        },
        onConnectionError: (message) => {
          const parsedError = parseShelfScanErrorMessage(message);
          console.error('[SHELF MODE] Stream error:', message);
          stopShelfScan('error', {
            phase: 'finishing',
            progress: 1,
            message: parsedError.message,
            reasonCode: parsedError.reasonCode || 'stream_disconnected',
          });
        },
        onEvent: (parsed: QuickScanStreamEvent) => {
          console.log('[SHELF MODE] Stream event:', parsed.type);
          const presentation = getShelfProgressPresentation({
            phase: parsed.phase || 'inspecting_shelf',
            progress: typeof parsed.progress === 'number' ? parsed.progress : 0,
            elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : 0,
            totalItems: typeof parsed.totalItems === 'number' ? parsed.totalItems : 0,
            completedItems: typeof parsed.completedItems === 'number' ? parsed.completedItems : 0,
            stalled: false,
            status: 'streaming',
          });

          if (parsed.type === 'START_ANALYSIS') {
            setCurrentInstruction(presentation.instruction);
            setShowDeepSearchSheet(true);
            sheetTranslateY.value = withSpring(0);
            setShelfProgress((prev) => ({
              ...prev,
              phase: parsed.phase || 'inspecting_shelf',
              progress: typeof parsed.progress === 'number' ? parsed.progress : prev.progress,
              elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : prev.elapsedMs,
              totalItems: typeof parsed.totalItems === 'number' ? parsed.totalItems : 0,
              completedItems: 0,
              stalled: false,
              status: 'streaming',
              reasonCode: undefined,
              message: undefined,
            }));
            return;
          }

          if (parsed.type === 'EXTRACTED_ITEMS') {
            const items = (parsed.items || []) as Array<string | { query: string; quantity?: number }>;
            const newBulkItems = items.map((item, idx) => {
              const query = typeof item === 'string' ? item : item.query;
              const quantity = typeof item === 'object' && item.quantity != null ? item.quantity : 1;
              return {
                id: `shelf-${Date.now()}-${idx}`,
                photos: [],
                title: query,
                quantity,
                isActive: idx === 0,
              };
            });

            shelfQueryToItemIdRef.current = {};
            items.forEach((item, idx) => {
              const query = typeof item === 'string' ? item : item.query;
              shelfQueryToItemIdRef.current[query] = newBulkItems[idx].id;
            });

            setBulkItems(newBulkItems);
            setIsBulkMode(true);
            setActiveItemId(newBulkItems[0]?.id || null);
            setCurrentInstruction('extracting');
            setShelfProgress((prev) => ({
              ...prev,
              phase: parsed.phase || 'separating_items',
              progress: typeof parsed.progress === 'number' ? parsed.progress : prev.progress,
              elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : prev.elapsedMs,
              totalItems: typeof parsed.totalItems === 'number' ? parsed.totalItems : newBulkItems.length,
              completedItems: 0,
              stalled: false,
              status: 'streaming',
            }));
            return;
          }

          if (parsed.type === 'OPTIMIZING_QUERIES' || parsed.type === 'SEARCHING_ITEMS') {
            setCurrentInstruction(presentation.instruction);
            setShelfProgress((prev) => ({
              ...prev,
              phase: parsed.phase || (parsed.type === 'OPTIMIZING_QUERIES' ? 'reading_labels' : 'searching_matches'),
              progress: typeof parsed.progress === 'number' ? parsed.progress : prev.progress,
              elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : prev.elapsedMs,
              totalItems: typeof parsed.totalItems === 'number' ? parsed.totalItems : prev.totalItems,
              completedItems: typeof parsed.completedItems === 'number' ? parsed.completedItems : prev.completedItems,
              stalled: false,
              status: 'streaming',
            }));
            return;
          }

          if (parsed.type === 'SEARCH_RESULT') {
            const res = parsed.result;
            const originalQuery = res?.extractedItem?.ocrText || res?.extractedItem?.paraphrases?.[0] || res?.extractedItem?.type || res?.usedQuery;
            const itemId = shelfQueryToItemIdRef.current[originalQuery] || shelfQueryToItemIdRef.current[res?.usedQuery];

            if (itemId) {
              const quantity = typeof res?.quantity === 'number' ? res.quantity : 1;
              setBulkItems((prev) => prev.map((item) => item.id === itemId ? { ...item, title: res.usedQuery, quantity } : item));

              setItemLoadingStates((prev) => {
                const next = { ...prev };
                delete next[itemId];
                return next;
              });

              if (res?.matches && res.matches.length > 0) {
                setQuickScanStore((prev) => ({
                  ...prev,
                  [itemId]: {
                    matchData: {
                      systemAction: 'show_multiple_matches',
                      confidence: res.confidence || 'medium',
                      rankedCandidates: res.matches,
                      totalMatches: res.matches.length,
                    },
                    serpApiData: res.matches,
                  },
                }));

                const shouldAutoConfirmTopMatch = shouldAutoSelectQuickMatch({
                  totalMatches: res.matches.length,
                  recommendedAction: 'show_multiple_matches',
                  rerankerConfidence: res.confidence === 'high' ? 0.9 : res.confidence === 'medium' ? 0.6 : 0.2,
                  topCandidateIsLocalMatch: Boolean(res.matches[0]?.isLocalMatch),
                });

                if (shouldAutoConfirmTopMatch) {
                  const quickMatchHintCandidates = rankedCandidatesToQuickMatchHintCandidates(res.matches);
                  setConfirmedQuickMatchByItemId((prev) => ({
                    ...prev,
                    [itemId]: {
                      serpApiData: quickMatchHintCandidates,
                      preSelectedIndices: [0],
                      source: 'quick_scan_auto',
                      confidence: res.confidence === 'high' ? 0.9 : 0.6,
                    },
                  }));
                }
              }
            }

            setCurrentInstruction('searching');
            setShelfProgress((prev) => ({
              ...prev,
              phase: parsed.phase || 'searching_matches',
              progress: typeof parsed.progress === 'number' ? parsed.progress : prev.progress,
              elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : prev.elapsedMs,
              totalItems: typeof parsed.totalItems === 'number' ? parsed.totalItems : prev.totalItems,
              completedItems: typeof parsed.completedItems === 'number' ? parsed.completedItems : Math.min(prev.totalItems || 1, prev.completedItems + 1),
              stalled: false,
              status: 'streaming',
            }));
            return;
          }

          if (parsed.type === 'COMPLETE') {
            stopShelfScan('completed', {
              phase: 'finishing',
              progress: 1,
              elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined,
              completedItems: parsed.data?.results?.length || shelfProgress.completedItems,
            });
            sheetTranslateY.value = withSpring(0);
            return;
          }

          if (parsed.type === 'NO_ITEMS') {
            resetShelfScanResults();
            stopShelfScan('no_items', {
              phase: 'finishing',
              progress: 1,
              elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined,
              reasonCode: parsed.reasonCode,
              message: parsed.message || 'Could not detect any items on this shelf.',
            });
            return;
          }

          if (parsed.type === 'TIMEOUT') {
            stopShelfScan('timeout', {
              phase: 'finishing',
              progress: 1,
              elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined,
              reasonCode: parsed.reasonCode,
              message: parsed.message || 'Shelf scan timed out before results came back.',
            });
            return;
          }

          if (parsed.type === 'ERROR') {
            console.error('[SHELF MODE] Agent error:', parsed.message);
            const parsedError = parseShelfScanErrorMessage(parsed.message);
            stopShelfScan('error', {
              phase: 'finishing',
              progress: 1,
              elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined,
              reasonCode: parsed.reasonCode || parsedError.reasonCode,
              message: parsedError.message || 'Error processing shelf scan.',
            });
          }
        },
      });

    } catch (error: any) {
      console.error(`[SHELF MODE] Error:`, error);
      stopShelfScan('error', {
        phase: 'finishing',
        progress: 1,
        message: error?.message || 'Failed to extract items from the image.',
        reasonCode: 'client_preflight_failed',
      });
    }
  }, [closeShelfScanStream, ensureSupabaseJwt, resetShelfScanResults, shelfProgress.completedItems, sheetTranslateY, stopShelfScan]);

  const runQuickScanTextSearch = useCallback(async (itemId: string, newQuery: string) => {
    try {
      const token = await supabase.auth.getSession().then(({ data }: any) => data.session?.access_token);
      if (!token) return;

      setItemLoadingStates((prev) => ({
        ...prev,
        [itemId]: { isLoading: true, stage: 'Searching catalog...', error: undefined },
      }));

      const rawApiBase = API_BASE_URL;
      const API_BASE = rawApiBase;
      const sseUrl = `${API_BASE}/api/products/orchestrate/quick-scan-stream`;

      const stream = openQuickScanStream({
        url: sseUrl,
        token: token!,
        body: {
          textQuery: newQuery,
          mode: 'ocr-vlm-search',
        },
        onConnectionError: (message) => {
          setItemLoadingStates((prev) => ({
            ...prev,
            [itemId]: {
              isLoading: false,
              stage: 'Search failed',
              error: message,
            },
          }));
        },
        onEvent: (parsed) => {
          if (parsed.type === 'SEARCH_RESULT') {
            const res = parsed.result;
            if (res?.matches && res.matches.length > 0) {
              setQuickScanStore((prev) => ({
                ...prev,
                [itemId]: {
                  matchData: {
                    systemAction: 'show_multiple_matches',
                    confidence: res.confidence || 'medium',
                    rankedCandidates: res.matches,
                    totalMatches: res.matches.length,
                  },
                  serpApiData: res.matches.map((match: any) => ({ ...match, queryKey: newQuery })),
                },
              }));
            }
          } else if (parsed.type === 'COMPLETE') {
            setItemLoadingStates((prev) => {
              const next = { ...prev };
              delete next[itemId];
              return next;
            });
          } else if (parsed.type === 'ERROR' || parsed.type === 'TIMEOUT' || parsed.type === 'NO_ITEMS') {
            setItemLoadingStates((prev) => ({
              ...prev,
              [itemId]: {
                isLoading: false,
                stage: 'Search failed',
                error: parsed.message || 'Unable to search catalog right now.',
              },
            }));
          }
        },
      });

      return () => stream.close();
    } catch (error: any) {
      setItemLoadingStates((prev) => ({
        ...prev,
        [itemId]: {
          isLoading: false,
          stage: 'Search failed',
          error: error?.message || 'Unable to search catalog right now.',
        },
      }));
    }
  }, []);

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
  const performQuickScan = useCallback(async (
    photo: CapturedPhoto,
    itemId: string,
    options?: { skipPreflight?: boolean },
  ) => {
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

      if (!options?.skipPreflight) {
        const gate = await preflightAIGate('ai_quick_scan', 1);

        if (gate.code === 'credits_exhausted_but_invoiceable') {
          await persistPendingQuickScan(photo, itemId);
          const decision = await presentBillingGateSheet(gate);

          if (decision === 'billing') {
            scanErrorMessage = gate.message;
            return;
          }

          if (decision !== 'continue') {
            scanErrorMessage = gate.message;
            return;
          }

          await clearPendingQuickScan();
        } else if (!gate.canProceed) {
          await persistPendingQuickScan(photo, itemId);
          const decision = await presentBillingGateSheet(gate);
          scanErrorMessage = gate.message;
          return;
        }
      }

      // Upload image to Supabase Storage first
      console.log('[QUICK SCAN] Uploading image to Supabase...');
      const publicImageUrl = await uploadImageToSupabase(photo.uri, photo.id);
      console.log('[QUICK SCAN] Image uploaded to:', publicImageUrl);

      const token = tokenMaybe;

      // Call backend /orchestrate/quick-scan endpoint.
      const quickScanPath = '/api/products/orchestrate/quick-scan';
      const quickScanUrlPrimary = `${API_BASE_URL}${quickScanPath}`;
      const quickScanUrlFallback = `${API_BASE_URL}${quickScanPath}`;

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
        const gate = normalizeBillingGateResponse(errorData, 'ai_quick_scan');
        await persistPendingQuickScan(photo, itemId);
        const decision = await presentBillingGateSheet(gate);
        scanErrorMessage = gate.message;
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Increment local usage count on successful scan
      incrementLocalUsage();
      await clearPendingQuickScan();

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
            id: String(match.ProductVariantId || match.variantId || match.productId || `match-${Date.now()}`),
            productId: match.productId ? String(match.productId) : undefined,
            variantId: match.ProductVariantId ? String(match.ProductVariantId) : (match.variantId ? String(match.variantId) : undefined),
            title: match.title || 'Unknown Product',
            description: match.description || '',
            price: typeof match.price === 'number'
              ? match.price
              : Number(match.price?.extracted_value || match.price?.value || 0),
            imageUrl: match.imageUrl || match.image || match.thumbnail || '',
            productUrl: match.productUrl || match.product_url || match.link || '',
            sourceUrl: (() => {
              const preferred = match.productUrl || match.product_url || match.link || '';
              if (typeof preferred === 'string' && /sssync\.app/i.test(preferred)) {
                return '';
              }
              return preferred;
            })(),
            isLocalMatch: Boolean(match.isLocalMatch),
            pricingResearch: match.pricingResearch,
          }))
        };

        if (rerankerMeta) {
          nextMatchData.reranker = rerankerMeta;
        }

        // Update store
        const serpApiDataForItem = candidatesToSerpApiData(nextMatchData.rankedCandidates as any);
        const quickMatchHintCandidates = rankedCandidatesToQuickMatchHintCandidates(nextMatchData.rankedCandidates);
        setQuickScanStore(prev => {
          const updated = {
            ...prev,
            [itemId]: { matchData: nextMatchData, serpApiData: serpApiDataForItem }
          };
          return updated;
        });

        const shouldAutoConfirmTopMatch = shouldAutoSelectQuickMatch({
          totalMatches: allMatches.length,
          recommendedAction: quickScanResult?.recommendedAction,
          rerankerConfidence: rerankerMeta?.confidence,
          topCandidateIsLocalMatch: Boolean(nextMatchData.rankedCandidates?.[0]?.isLocalMatch),
        });

        setConfirmedQuickMatchByItemId(prev => {
          if (!shouldAutoConfirmTopMatch) {
            if (!prev[itemId]) return prev;
            const next = { ...prev };
            delete next[itemId];
            return next;
          }

          return {
            ...prev,
            [itemId]: {
              serpApiData: quickMatchHintCandidates,
              preSelectedIndices: [0],
              source: 'quick_scan_auto',
              confidence: rerankerMeta?.confidence,
              reasoning: rerankerMeta?.reasoning,
            },
          };
        });

        // CRITICAL: Also update component-level matchData so getInstructionText displays correct count
        setMatchData(nextMatchData);
        setCurrentInstruction(shouldAutoConfirmTopMatch ? 'matched' : 'matches_found');

        // Pricing enrichment: Use eBay pricing research (actual sold listings) in background
        // to populate price range and shipping data from real market data.
        const topTitle = nextMatchData.rankedCandidates?.[0]?.title;
        if (topTitle) {
          const rawApiBase = API_BASE_URL;
          const API_BASE = rawApiBase;
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
        setConfirmedQuickMatchByItemId(prev => {
          if (!prev[itemId]) return prev;
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
        setCurrentInstruction('no_matches');
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

  }, [
    uploadImageToSupabase,
    candidatesToSerpApiData,
    quickScanStore,
    showNotificationMessage,
    isAutoScanning,
    incrementLocalUsage,
    preflightAIGate,
    persistPendingQuickScan,
    presentBillingGateSheet,
    clearPendingQuickScan,
  ]);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      const maybeResumePendingQuickScan = async () => {
        if (isResumingPendingBillingRef.current) {
          return;
        }

        const pending = pendingBillingActionRef.current || await loadPendingBillingAction();
        if (!active || !pending || pending.type !== 'quick_scan') {
          return;
        }

        pendingBillingActionRef.current = pending;
        const gate = await preflightAIGate(pending.featureKey, 1);

        if (!active) {
          return;
        }

        if (!gate.canProceed && gate.code !== 'credits_exhausted_but_invoiceable') {
          return;
        }

        isResumingPendingBillingRef.current = true;
        await clearPendingQuickScan();
        showNotificationMessage('Resuming pending scan...', 1800);

        try {
          await performQuickScan(pending.photo as CapturedPhoto, pending.itemId, { skipPreflight: true });
        } finally {
          if (active) {
            isResumingPendingBillingRef.current = false;
          }
        }
      };

      refreshFreemiumStatus().catch(() => null);
      maybeResumePendingQuickScan().catch((error) => {
        console.warn('[AddProduct] Failed to resume pending quick scan:', error);
        isResumingPendingBillingRef.current = false;
      });

      return () => {
        active = false;
      };
    }, [performQuickScan, preflightAIGate, clearPendingQuickScan, refreshFreemiumStatus, showNotificationMessage])
  );

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
    const hasRenderableMatchData = !!store.matchData
      && Array.isArray(store.matchData.rankedCandidates)
      && store.matchData.rankedCandidates.length > 0;
    if (!hasRenderableMatchData) {
      showNotificationMessage('Quick matches are still loading for this item.', 2000);
      setShowDeepSearchSheet(true);
      sheetTranslateY.value = withSpring(0);
      return;
    }
    setMatchData(store.matchData);
    setCurrentMatchItemId(itemId);
    // Deterministic modal handoff: close bulk first, then open quick matches.
    setShowDeepSearchSheet(false);
    sheetTranslateY.value = SCREEN_HEIGHT;
    requestAnimationFrame(() => {
      setShowMatchSheet(true);
      matchSheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.2);
    });
  }, [quickScanStore, matchSheetTranslateY, sheetTranslateY, showNotificationMessage, isProcessingShelfScan]);

  const openExistingInventoryMatch = useCallback((itemId: string) => {
    const localMatch = getLocalInventoryCandidateForItem(itemId, confirmedQuickMatchByItemId, quickScanStore) as any;
    if (!localMatch) {
      showNotificationMessage('No inventory match is ready for this item yet.', 2000);
      return;
    }

    const variantId = String(localMatch.variantId || localMatch.ProductVariantId || localMatch.id || '');
    const productId = String(localMatch.productId || localMatch.ProductId || '');
    if (!variantId && !productId) {
      showNotificationMessage('Inventory match is missing its item id.', 2000);
      return;
    }

    setBarcodeSearchResult({
      product: {
        Id: productId || variantId,
        id: productId || variantId,
      },
      variant: {
        Id: variantId || productId,
        id: variantId || productId,
        Title: localMatch.title,
        Price: typeof localMatch.price === 'number'
          ? localMatch.price
          : localMatch.price?.extracted_value,
      },
      images: localMatch.imageUrl
        ? [{ ImageUrl: localMatch.imageUrl }]
        : undefined,
    } as any);
    setShowBarcodeResultModal(true);
    setShowDeepSearchSheet(false);
    setCurrentInstruction('ready');
    markItemsProcessed([{ id: itemId }], 'existing_inventory');
  }, [confirmedQuickMatchByItemId, markItemsProcessed, quickScanStore, showNotificationMessage]);

  // Send payload of first photos for analysis/matching
  const performAnalyze = useCallback(async (
    firstPhotos: CapturedPhoto[],
    quickMatchHintsByItemId?: Record<string, QuickMatchSelection>,
    itemsForAnalyze?: Array<{ id: string }>,
  ) => {
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

      const products = buildMatchAnalyzeProducts(publicImageUrls, itemsForAnalyze, quickMatchHintsByItemId);

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
      const response = await fetch(`${API_BASE_URL}/api/products/orchestrate/match`, {
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

      const itemMatches = quickScanStore[activeItemId];
      const hasMatches = (itemMatches?.matchData?.totalMatches || 0) > 0;

      if (hasMatches) {
        const hasRenderableMatchData = !!itemMatches?.matchData
          && Array.isArray(itemMatches.matchData.rankedCandidates)
          && itemMatches.matchData.rankedCandidates.length > 0;
        if (!hasRenderableMatchData) {
          showNotificationMessage('Quick matches are still loading for this item.', 2000);
          return;
        }
        setMatchData(itemMatches.matchData);
        setCurrentMatchItemId(activeItemId);
        setShowDeepSearchSheet(false);
        sheetTranslateY.value = SCREEN_HEIGHT;
        requestAnimationFrame(() => {
          setShowMatchSheet(true);
          matchSheetTranslateY.value = withSpring(SCREEN_HEIGHT * 0.2);
        });
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
  }, [activeItemId, quickScanStore, currentInstruction, showNotificationMessage, bulkItems, performQuickScan, sheetTranslateY, matchSheetTranslateY]);

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

  // Close bulk items sheet
  const closeBulkItemsSheet = useCallback(() => {
    // Don't allow closing while processing shelf scan
    if (isProcessingShelfScan) {
      return;
    }
    cancelAnimation(sheetTranslateY);
    setShowDeepSearchSheet(false);
    sheetTranslateY.value = SCREEN_HEIGHT;
    setCurrentInstruction('ready');
  }, [sheetTranslateY, isProcessingShelfScan]);

  // Open bulk items sheet deterministically
  const openBulkItemsSheet = useCallback(() => {
    cancelAnimation(sheetTranslateY);
    setShowDeepSearchSheet(true);
    sheetTranslateY.value = SCREEN_HEIGHT;
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
    if (!isFocused) return;
    if (sessionIdParam) return;
    if (hasAutoOpenedFtuxRef.current) return;
    if (showDeepSearchSheet || showMatchSheet || showBarcodeResultModal) return;
    if (cameraMode === 'shelf') return; // In shelf mode, don't auto-close the sheet

    const hasAnyPhoto = capturedPhotos.length > 0 || bulkItems.some((item) => item.photos.length > 0);
    if (!hasAnyPhoto) return;

    hasAutoOpenedFtuxRef.current = true;
    hasTriggeredBulkModalFtuxRef.current = true;
    openBulkItemsSheet();
    setHasSeenBulkModalFtux(true);
    void AsyncStorage.setItem(BULK_MODAL_FTUX_KEY, '1').catch(() => {
      // non-blocking
    });

    const timer = setTimeout(async () => {
      // Don't auto-close the sheet — let the user decide when to dismiss.
    }, 2200);

    return () => clearTimeout(timer);
  }, [
    isFocused,
    sessionIdParam,
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
    cancelAnimation(matchSheetTranslateY);
    matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 250 }, () => {
      runOnJS(setShowMatchSheet)(false);
      runOnJS(setCurrentInstruction)('ready');
    });
  }, [matchSheetTranslateY]);

  // Close quick matches and return to bulk items sheet
  const closeMatchSheetToBulk = useCallback(() => {
    matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 250 }, () => {
      runOnJS(setShowMatchSheet)(false);
      runOnJS(openBulkItemsSheet)();
      runOnJS(setCurrentInstruction)('ready');
    });
  }, [matchSheetTranslateY, openBulkItemsSheet]);

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

  // When starting a broad search or analysis, cancel any in-progress quick scan and reset camera state
  const handleStartBroadSearch = useCallback(() => {
    console.log('[BROAD SEARCH] Starting broad search: cancelling quick scan and resetting state');
    
    // Check if we are transitioning from shelf mode to take photos
    if (cameraMode === 'shelf' && bulkItems.length > 0) {
      setCameraMode('camera');
      setActiveItemId(bulkItems[0].id);
      setCurrentInstruction('capturing');
      closeBulkItemsSheet();
      showNotificationMessage(`Take photos for ${bulkItems[0].title || 'Item 1'}`, 2500);
      return;
    }

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
    cameraMode,
    bulkItems,
    setCameraMode,
    setActiveItemId,
    closeBulkItemsSheet,
    showNotificationMessage,
  ]);

  // When screen loses focus (user navigates away), save draft and close sheets
  useFocusEffect(
    useCallback(() => {
      return () => {
        quickScanQueueRef.current = [];
        setShowMatchSheet(false);
        setShowBarcodeResultModal(false);
        // Persist scan draft when navigating away so it appears in Scan Drafts
        if (
          (bulkItems.length > 0 || Object.keys(itemStageById).length > 0 || processedItemIds.length > 0) &&
          !isHydratingRef.current
        ) {
          saveDraftToBackend({
            scannedItems: bulkItems,
            matchContext: quickScanStore,
            shelfPhotoUri: shelfPhotoUriForDraftRef.current || shelfPhotoUri,
            activeItemId,
            itemStageById,
            processedItemIds,
          });
        }
      };
    }, [activeItemId, bulkItems, itemStageById, processedItemIds, quickScanStore, shelfPhotoUri, saveDraftToBackend])
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

  const isMatchSheetVisible = !!showMatchSheet && !!matchData;
  const isAnySheetVisible = showDeepSearchSheet || isMatchSheetVisible || showBarcodeResultModal;
  const connectedPlatformKeys = getConnectedPlatformKeys(platformLocations);
  const matchedItemsCount = bulkItems.reduce((count, item) => {
    const matchCount = quickScanStore[item.id]?.matchData?.totalMatches || 0;
    return matchCount > 0 ? count + 1 : count;
  }, 0);
  const activeQuickMatchStore = activeItemId ? quickScanStore[activeItemId] : null;
  const activeQuickMatchInfo = activeItemId ? confirmedQuickMatchByItemId[activeItemId] : null;
  const { candidate: activeSelectedMatch, isConfirmed: activeMatchIsConfirmed } = getSelectedQuickMatchCandidate(
    activeQuickMatchInfo,
    activeQuickMatchStore,
  );
  const activeMatchCount = activeQuickMatchStore?.matchData?.totalMatches || 0;
  const centerOverlayMatchPreview = activeSelectedMatch ? {
    imageUrl: activeSelectedMatch?.imageUrl || activeSelectedMatch?.image || activeSelectedMatch?.thumbnail || null,
    title: cleanMatchText(activeSelectedMatch?.title || 'Selected match'),
    label: activeMatchIsConfirmed
      ? (activeQuickMatchInfo?.source === 'quick_scan_auto' ? 'Auto-selected match' : 'Selected match')
      : `${activeMatchCount} match${activeMatchCount === 1 ? '' : 'es'} found`,
    subtitle: activeMatchIsConfirmed ? 'Tap to review or change' : 'Tap to review and confirm',
    isConfirmed: activeMatchIsConfirmed,
  } : null;

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="black" />

      {/* Freemium usage counter */}
      {freemiumStatus && !freemiumStatus.hasSubscription && (
        <View style={{ position: 'absolute', top: Platform.OS === 'ios' ? 50 : 10, left: 0, right: 0, zIndex: 100 }}>
          <UsageCounter
            usageCount={freemiumStatus.usageCount}
            freeLimit={freemiumStatus.freeLimit}
            onUpgradePress={() => {
              if (freemiumStatus.isFreeTierExhausted) {
                setBillingGate(buildFreemiumBlockedGate());
                setBillingGateVisible(true);
                return;
              }
              setShowTierSelector(true);
            }}
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
        active={isFocused && !isAnySheetVisible} // Disable camera when sheets are open
        onBarcodeScanned={handleBarCodeScanned}
        barcodeScannerSettings={{
          barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
        }}
      >
        {/* Flash overlay */}
        <Animated.View style={[styles.flashOverlay, flashAnimatedStyle]} />

        {/* Camera paused overlay */}
        {isAnySheetVisible && (
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
            // Do not close sheets from background taps; this can race with control taps.
            if (isAnySheetVisible) {
              return;
            }
            // Otherwise handle focus
            handleFocusTap(event);
          }}
          onLongPress={() => {
            // Open sheet on long press if not already open
            if (!isAnySheetVisible) {
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
        matchPreview={centerOverlayMatchPreview}
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
        matchedItemsCount={matchedItemsCount}
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
        onRequestClose={closeMatchSheetToBulk}
        presentationStyle="overFullScreen"
      >
        {showMatchSheet && matchData ? (
          <MatchResultsSheet
            matchData={matchData}
            onClose={closeMatchSheetToBulk}
            onUseForSelection={() => openMatchSelectionForItem(currentMatchItemId)}
            onConfirmMatch={currentMatchItemId ? (_serpApiData, preSelectedIndices) => {
              const confirmedCandidates = matchData
                ? rankedCandidatesToQuickMatchHintCandidates(matchData.rankedCandidates)
                : [];
              setConfirmedQuickMatchByItemId(prev => ({
                ...prev,
                [currentMatchItemId]: {
                  serpApiData: confirmedCandidates,
                  preSelectedIndices,
                  source: 'quick_scan_confirmed',
                },
              }));
            } : undefined}
            currentMatchItemId={currentMatchItemId}
            initialSelectedIndices={currentMatchItemId ? confirmedQuickMatchByItemId[currentMatchItemId]?.preSelectedIndices : undefined}
            fetchPricingResearch={async (title: string) => {
              try {
                const token = await getToken();
                const API_BASE = API_BASE_URL;
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
              closeMatchSheetToBulk();
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
                  connectedPlatformKeys={connectedPlatformKeys}
                  currentInstruction={currentInstruction}
                  onOpenLocalMatch={openExistingInventoryMatch}
                  shelfPhotoUri={shelfPhotoUri}
                  shelfProgress={shelfProgress}
                  onRetryShelfScan={() => {
                    const lastPhoto = lastShelfScanPhotoRef.current;
                    if (!lastPhoto) return;
                    void handleShelfModeScan(lastPhoto);
                  }}
                  onRetakeShelfScan={clearShelfScanForRetake}
                  cameraMode={cameraMode}
                  onSubmitItemsForProcessing={markItemsSubmittedForMatch}
                  onSaveDraft={() => {
                    if (
                      (bulkItems.length > 0 || Object.keys(itemStageById).length > 0 || processedItemIds.length > 0) &&
                      !isHydratingRef.current
                    ) {
                      saveDraftToBackend({
                        scannedItems: bulkItems,
                        matchContext: quickScanStore,
                        shelfPhotoUri: shelfPhotoUriForDraftRef.current || shelfPhotoUri,
                        activeItemId,
                        itemStageById,
                        processedItemIds,
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
                    void runQuickScanTextSearch(id, newQuery);
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

                  const API_BASE = API_BASE_URL;

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

      <BillingGateSheet
        visible={billingGateVisible}
        gate={billingGate}
        onClose={() => closeBillingGateSheet('dismiss')}
        onOpenBilling={() => {
          closeBillingGateSheet('billing');
          (navigation as any).navigate('Billing');
        }}
        onContinue={() => closeBillingGateSheet('continue')}
      />
    </GestureHandlerRootView>
  );
};

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
});

export default AddProductScreen;   

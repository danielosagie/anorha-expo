import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { API_BASE_URL } from '../config/env';
import { BRAND_PRIMARY } from '../design/tokens';
import type {
  UnicodeSpinnerDefinition,
  CameraMode,
  MatchCandidate,
  MatchResponse,
  JobResponse,
  QuickMatchSelection,
  ItemLoadingState,
} from './AddProduct/types';
import type { MatchJobStatus } from '../contracts';
import { readQuickScanClientState, writeQuickScanClientState } from '../contracts';
import { cleanMatchText } from './AddProduct/utils';
import { UnicodeSpinner } from './AddProduct/UnicodeSpinner';
import { CenterOverlay } from './AddProduct/CenterOverlay';
import { BottomControls } from './AddProduct/BottomControls';
import { ProgressBarOverlay } from './AddProduct/ProgressBarOverlay';
import { NotificationBar } from './AddProduct/NotificationBar';
import { MatchResultsSheet } from './AddProduct/MatchResultsSheet';
import { BulkItemsSheet } from './AddProduct/BulkItemsSheet';
import { useBulkItems } from './AddProduct/hooks/useBulkItems';
import { MatchPreview, MatchPreviewData } from './AddProduct/MatchPreview';
import { AddDetailsSheet } from './AddProduct/AddDetailsSheet';
import { ShelfFolderSheet } from './AddProduct/ShelfFolderSheet';
import type { CartTreeNode } from './AddProduct/hooks/useBulkItems';
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { setItemGenerate, selectItem, selectAllItems, addItemWithId, transitionItem } from '../features/cart/cartStore';
import { buildGenerateDetailsLaunch } from '../features/cart/flowPayloads';

// DEV: set true to force-render the pricing-research preview page for visual QA.
// Normal flow restored when false; the page is still reachable via __ds === 'matchPreview'.
const DEV_FORCE_MATCH_PREVIEW = false;
// DEV: set true to seed a shelf folder + open its page for visual QA (remove after).
const DEV_FORCE_FOLDER_PAGE = false;

// One spring for the cart open/close + screen lift so every entry point feels identical
// (settles quickly, slight give — "made by Shopify" smooth, no bounce-on-bounce).
const CART_SPRING = { damping: 30, stiffness: 280, overshootClamping: true } as const;

// Active generation jobs, module-level so they SURVIVE AddProductScreen unmount (navigate-away):
// the in-place poller re-attaches and resumes on remount instead of orphaning in-flight jobs.
const genQueue$ = observable<Array<{ jobId: string; processType: 'generate' | 'match'; itemIds: string[] }>>([]);
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
  PanResponder,
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
import { useSuppressSwipeBackWhen, publishBackButtonRect } from '../components/SwipeBackContext';
import { CapturedPhoto } from '../components/camera/PhotoStack';
import ViewPhotosModal from '../components/camera/ViewPhotosModal';
import CameraControls from '../components/camera/CameraControls';
import BusinessTemplateModal, { BusinessTemplate } from '../components/camera/BusinessTemplateModal';
import ItemNavigationBar from '../components/camera/ItemNavigationBar';
import QuickProductDetailSheet from '../components/QuickProductDetailSheet';
import ManifestReviewSheet from '../components/ManifestReviewSheet';
import ReceiptReviewSheet from '../components/ReceiptReviewSheet';
import TierSelectorModal from '../components/TierSelectorModal';
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
import { safeJson } from '../utils/safeJson';
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
import { createLogger } from '../utils/logger';
const log = createLogger('AddProductScreen');


const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const BULK_MODAL_FTUX_KEY = '@anorha_hasSeenBulkItemsModal';
const MAX_BATCH_ITEMS = 100;
const QUICK_SCAN_QUEUE_LIMIT = 100;
const QUICK_MATCH_AUTO_SELECT_CONFIDENCE = 0.72;

// Shop-style capture chrome: the photo strip rides the top black bar and the camera
// is a cropped, rounded viewfinder between it and the bottom controls.
const TOP_PHOTO_BAR_HEIGHT = 92;
// Lower edge of the camera card at REST: clears the shutter controls. As the cart
// opens, the card slides DOWN by (GAP - 12) so its rounded bottom meets the rising
// sheet's top edge (Shop-style bleed) while the controls fade out beneath it.
const CAMERA_BOTTOM_GAP = 220;

// Types — the match/job seam is typed by the shared backend contract (src/contracts);
// client-side quick-scan shapes come from ./AddProduct/types.

/** Match job status as served by GET /products/match/jobs/:jobId/status. */
export type Analysis = MatchJobStatus;

type ItemStage = 'submitted_for_match' | 'awaiting_user_input' | 'generating' | 'generated' | 'existing_inventory';

/**
 * Serialize a draft-session payload to what the backend actually accepts (the four
 * UpsertQuickScanSession fields). Client flow state (itemStageById/processedItemIds)
 * rides inside matchContext.clientState — the backend has no columns for it and used
 * to silently drop it when sent top-level, which broke stage restore on draft resume.
 */
const toQuickScanSessionBody = (p: {
  scannedItems: any[];
  matchContext: Record<string, any>;
  shelfPhotoUri?: string | null;
  activeItemId?: string | null;
  itemStageById?: Record<string, ItemStage>;
  processedItemIds?: string[];
}) => ({
  scannedItems: p.scannedItems,
  matchContext: writeQuickScanClientState(p.matchContext, {
    itemStageById: p.itemStageById,
    processedItemIds: p.processedItemIds,
  }),
  shelfPhotoUri: p.shelfPhotoUri ?? undefined,
  activeItemId: p.activeItemId ?? undefined,
});

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

  // Left-edge swipe → go back to wherever we came from. AddProduct is a hidden TAB
  // screen, so it has no native back gesture; a thin left-edge strip gives one
  // without touching the camera or the sheets' own gestures. Created once.
  // (Left-edge back is now the global SwipeBackRing, applied via the navigator HOC.)
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
  // The swipe-back ring anchors to this button's real measured rect (device-independent).
  const backButtonRef = useRef<any>(null);
  useEffect(() => () => { publishBackButtonRect(null); }, []); // clear anchor on unmount
  const saveDraftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSessionCreatePromiseRef = useRef<Promise<string | null> | null>(null);
  const hasAutoOpenedFtuxRef = useRef(false);

  log.debug('[RENDER] AddProductScreen rendered');

  // Camera state
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<CapturedPhoto[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [cameraMode, setCameraMode] = useState<'camera' | 'barcode' | 'manifest' | 'receipt' | 'shelf'>(
    (rawParams?.initialCameraMode as any) || 'camera'
  );

  const screenInsets = useSafeAreaInsets();

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
        log.error('[AddProduct] Error fetching locations:', e);
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
        const rawMatchCtx = (session.MatchContext ?? session.matchContext ?? {}) as Record<string, any>;
        // Client flow state rides inside MatchContext.clientState (see toQuickScanSessionBody);
        // strip the envelope before the rest of matchContext becomes the quick-scan store.
        const clientState = readQuickScanClientState(rawMatchCtx);
        const { clientState: _cs, ...matchCtx } = rawMatchCtx;
        const shelfUri = session.ShelfPhotoUri ?? session.shelfPhotoUri ?? null;
        const activeId = session.ActiveItemId ?? session.activeItemId ?? null;
        const stageById = (clientState.itemStageById ?? session.ItemStageById ?? session.itemStageById ?? {}) as Record<string, ItemStage>;
        const processedIds = clientState.processedItemIds ?? session.ProcessedItemIds ?? session.processedItemIds ?? [];
        if (items.length > 0 && !cancelled) {
          setBulkItems(items);
          setQuickScanStore(matchCtx);
          setShelfPhotoUri(shelfUri);
          setActiveItemId(activeId || items[0]?.id || null);
          setItemStageById((stageById && typeof stageById === 'object') ? stageById : {});
          setProcessedItemIds(Array.isArray(processedIds) ? processedIds : []);
          setIsBulkMode(true);
          setCameraMode('shelf');
          if (cartCloseTimerRef.current) { clearTimeout(cartCloseTimerRef.current); cartCloseTimerRef.current = null; }
          setShowDeepSearchSheet(true);
          sheetTranslateY.value = withSpring(0, CART_SPRING);  // Fully visible, bottom aligned to screen
          sessionIdRef.current = session.Id ?? session.id ?? sessionIdParam;
          if (shelfUri) shelfPhotoUriForDraftRef.current = shelfUri;
        }
      } catch (e) {
        log.error('[AddProduct] Hydrate draft failed:', e);
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
        body: JSON.stringify(toQuickScanSessionBody(payload)),
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
        body: JSON.stringify(toQuickScanSessionBody(payload)),
      });
    } catch (e) {
      log.warn('[AddProduct] Save draft failed:', e);
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
  // Quick scan / match sheet context
  const [currentMatchItemId, setCurrentMatchItemId] = useState<string | null>(null);
  // Pricing-research preview: which cart item's preview is open (null = closed)
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  // "Add details" page: which item we're collecting more context for (null = closed)
  const [addDetailsItemId, setAddDetailsItemId] = useState<string | null>(null);
  // Shelf folder page: which folder is open (null = closed)
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  // In-place async generation queue: active jobs being polled (replaces LoadingScreen navigation)
  const genJobs = use$(genQueue$); // durable across unmount; poller resumes on remount

  // Loading state tracking per item (transient UI; not part of cart$)
  const [itemLoadingStates, setItemLoadingStates] = useState<Record<string, ItemLoadingState>>({});

  // Bulk mode state
  const [isBulkMode, setIsBulkMode] = useState(false);

  // Cart-backed bulk-items state — single source of truth is cart$ (src/features/cart).
  // Replaces the former useState for bulkItems / quickScanStore /
  // confirmedQuickMatchByItemId / itemStageById / processedItemIds / activeItemId.
  const {
    bulkItems, setBulkItems,
    activeItemId, setActiveItemId,
    quickScanStore, setQuickScanStore,
    confirmedQuickMatchByItemId, setConfirmedQuickMatchByItemId,
    itemStageById, setItemStageById,
    processedItemIds, setProcessedItemIds,
    cartTree, createShelfFolder, ungroupFolder,
    savedForLaterIds, setItemSavedForLater,
  } = useBulkItems(() => ({
    bulkItems: __dsHasItems ? (dsBuildItems() as any) : [],
    activeItemId: __dsHasItems ? 'ds-1' : null,
    itemStageById: params?.itemStageById || {},
    processedItemIds: params?.processedItemIds || [],
  }));

  // Map the previewed cart item (photo + confirmed/quick match + pricing) into the MatchPreview shape.
  const previewData = useMemo<MatchPreviewData | undefined>(() => {
    if (!previewItemId) return undefined;
    const item = bulkItems.find((b) => b.id === previewItemId);
    const photoUri = item?.photos?.find((p) => p.isCover)?.uri || item?.photos?.[0]?.uri;
    const qs = quickScanStore[previewItemId];
    const confirmed = confirmedQuickMatchByItemId[previewItemId];
    const candidates = qs?.matchData?.rankedCandidates || [];
    const chosenIdx = confirmed?.preSelectedIndices?.[0] ?? 0;
    const chosen: any =
      (confirmed?.serpApiData && confirmed.serpApiData[chosenIdx]) || candidates[chosenIdx] || candidates[0];
    const pr: any = chosen?.pricingResearch;
    return {
      photoUri,
      title: chosen?.title || item?.title || 'Item',
      description: chosen?.description,
      pricing: pr
        ? {
            low: pr.low,
            high: pr.high,
            median: pr.median,
            average: pr.average,
            recommended: pr.recommended,
            sampleCount: pr.sampleCount,
            cachedAt: pr.cachedAt,
            livePricing: pr.livePricing,
            timeToSell: pr.timeToSell,
            history: pr.history,
            samples: Array.isArray(pr.samples)
              ? pr.samples.map((s: any) => ({
                  title: s.title,
                  price: s.price,
                  marketplace: 'Ebay',
                  condition: s.condition,
                  imageUrl: s.imageUrl || s.thumbnail || s.image,
                  url: s.url,
                }))
              : undefined,
          }
        : undefined,
    };
  }, [previewItemId, bulkItems, quickScanStore, confirmedQuickMatchByItemId]);

  // The shelf folder currently open as a page (if any).
  const openFolder = useMemo(
    () =>
      openFolderId
        ? (cartTree.find((n) => n.kind === 'folder' && n.id === openFolderId) as Extract<CartTreeNode, { kind: 'folder' }> | undefined)
        : undefined,
    [openFolderId, cartTree],
  );

  // DEV: seed a shelf folder + open its page for visual QA.
  const devFolderSeededRef = useRef(false);
  useEffect(() => {
    if (!DEV_FORCE_FOLDER_PAGE || devFolderSeededRef.current) return;
    devFolderSeededRef.current = true;
    // Single items — show the cart cards (match + the new "add a detail / snap the tag" chip).
    addItemWithId('dev-single-1', [{ id: 'p1', uri: 'https://picsum.photos/seed/sony/400/400', isCover: true } as any], { title: 'Sony WH-1000XM5 Headphones' });
    addItemWithId('dev-single-2', [{ id: 'p2', uri: 'https://picsum.photos/seed/switch/400/400', isCover: true } as any], { title: 'Nintendo Switch OLED' });
    // A shelf folder too (folder card sits alongside the single cards).
    createShelfFolder({
      sourcePhotoUri: 'https://picsum.photos/seed/shelfscan/900/520',
      label: 'Shelf',
      items: [
        { id: 'dev-s1', title: 'Logitech Lift Vertical Ergonomic Mouse', quantity: 1 },
        { id: 'dev-s2', title: 'Samsung French Door Refrigerator', quantity: 1 },
      ],
    });
    setQuickScanStore((prev) => ({
      ...prev,
      'dev-single-1': { matchData: { systemAction: 'show_single_match', confidence: 'high', totalMatches: 1, rankedCandidates: [{ id: 'h1', title: 'Sony WH-1000XM5 Wireless Headphones', price: 248, imageUrl: 'https://picsum.photos/seed/sonym/120' } as any] }, serpApiData: [] },
      'dev-single-2': { matchData: { systemAction: 'show_single_match', confidence: 'high', totalMatches: 1, rankedCandidates: [{ id: 'sw1', title: 'Nintendo Switch OLED', price: 299, imageUrl: 'https://picsum.photos/seed/switchm/120' } as any] }, serpApiData: [] },
    }));
    setIsBulkMode(true);
    if (cartCloseTimerRef.current) { clearTimeout(cartCloseTimerRef.current); cartCloseTimerRef.current = null; }
    setShowDeepSearchSheet(true);
    sheetTranslateY.value = withSpring(0, CART_SPRING); // slide the sheet up (open position)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Queue items for in-place async generation (replaces navigating to LoadingScreen).
  const handleQueueGeneration = useCallback(
    (itemJobs: Array<{ itemId: string; jobId: string; processType: 'generate' | 'match' }>) => {
      if (!itemJobs.length) return;
      setItemLoadingStates((prev) => {
        const next = { ...prev };
        itemJobs.forEach(({ itemId }) => { next[itemId] = { isLoading: true, stage: 'Queued…' }; });
        return next;
      });
      const byJob = new Map<string, { jobId: string; processType: 'generate' | 'match'; itemIds: string[] }>();
      for (const { itemId, jobId, processType } of itemJobs) {
        const key = `${processType}:${jobId}`;
        if (!byJob.has(key)) byJob.set(key, { jobId, processType, itemIds: [] });
        byJob.get(key)!.itemIds.push(itemId);
        // Durable per-item job id for the click → GenerateDetailsScreen handoff (match items get the generate id on chain).
        setItemGenerate(itemId, processType === 'generate' ? { generateJobId: jobId } : { generateMatchJobId: jobId });
      }
      genQueue$.set([...genQueue$.get(), ...Array.from(byJob.values())]);
    },
    [setItemLoadingStates],
  );

  // Poll active generation jobs and reflect progress in place — no navigation. Mirrors the
  // LoadingScreen poll loop (GET .../jobs/:id/status @1.5s) but writes into AddProductScreen state.
  useEffect(() => {
    if (genJobs.length === 0) return;
    let cancelled = false;
    const poll = async () => {
      const token = await ensureSupabaseJwt();
      if (!token || cancelled) return;
      for (const job of genJobs) {
        try {
          const base = job.processType === 'generate'
            ? `${API_BASE_URL}/api/products/generate/jobs/`
            : `${API_BASE_URL}/api/products/match/jobs/`;
          const res = await fetch(`${base}${encodeURIComponent(job.jobId)}/status`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          if (!res.ok || cancelled) continue;
          const snap: any = await res.json();
          const status = snap?.status;
          if (status === 'completed') {
            const results = Array.isArray(snap?.results) ? snap.results : [];
            const autoGenId =
              job.processType === 'match'
                ? (results.find((r: any) => r?.autoGenerateJobId)?.autoGenerateJobId as string | undefined)
                : undefined;
            if (autoGenId) {
              // match → auto-generate: chain to the generate job and keep tracking in place.
              job.itemIds.forEach((id) => {
                setItemGenerate(id, { generateJobId: autoGenId, generateMatchJobId: job.jobId });
                // Drive the explicit state machine: auto-matched, now generating.
                transitionItem(id, 'matched');
                transitionItem(id, 'generating');
              });
              setItemLoadingStates((prev) => { const n = { ...prev }; job.itemIds.forEach((id) => { n[id] = { isLoading: true, stage: 'Generating…' }; }); return n; });
              genQueue$.set(genQueue$.get().map((j) =>
                j.jobId === job.jobId && j.processType === 'match'
                  ? { jobId: autoGenId, processType: 'generate' as const, itemIds: job.itemIds }
                  : j));
            } else {
              setItemLoadingStates((prev) => { const n = { ...prev }; job.itemIds.forEach((id) => delete n[id]); return n; });
              setItemStageById((prev) => { const n = { ...prev }; job.itemIds.forEach((id) => { n[id] = 'generated'; }); return n; });
              // State machine: draft generated → awaiting per-item finalize.
              job.itemIds.forEach((id) => transitionItem(id, 'ready_to_list'));
              genQueue$.set(genQueue$.get().filter((j) => !(j.jobId === job.jobId && j.processType === job.processType)));
            }
          } else if (status === 'failed') {
            setItemLoadingStates((prev) => { const n = { ...prev }; job.itemIds.forEach((id) => { n[id] = { isLoading: false, stage: 'Failed', error: snap?.error || 'Generation failed' }; }); return n; });
            job.itemIds.forEach((id) => transitionItem(id, 'error', { error: snap?.error || 'Generation failed' }));
            genQueue$.set(genQueue$.get().filter((j) => !(j.jobId === job.jobId && j.processType === job.processType)));
          } else {
            const stage = snap?.currentStage || 'Generating…';
            setItemLoadingStates((prev) => { const n = { ...prev }; job.itemIds.forEach((id) => { n[id] = { isLoading: true, stage }; }); return n; });
          }
        } catch {
          /* transient — keep polling */
        }
      }
    };
    void poll();
    const interval = setInterval(() => { void poll(); }, 1500);
    return () => { cancelled = true; clearInterval(interval); };
  }, [genJobs, setItemStageById]);

  // Click → GenerateDetailsScreen for a queued/generated item: per-item finalize + the built-in
  // item/jobs switcher. ID-BASED handoff: the typed builder passes itemIds and the
  // screen resolves items from cart$ — the legacy index fields it also emits are fallback only.
  const openItemDetails = useCallback((itemId: string) => {
    const launch = buildGenerateDetailsLaunch(itemId);
    if (!launch) return;
    (navigation as any).navigate('GenerateDetailsScreen', launch);
  }, [navigation]);

  // Route an item tap: ALWAYS the item overview/pricing page first. Generated items
  // continue to the listing editor from the preview's CTA — a card tap must never
  // jump straight into the job/match screens.
  const handleOpenItem = useCallback((itemId: string) => {
    setPreviewItemId(itemId);
  }, []);

  // --- Shared-cart surface renderers ---
  // Rendered as opaque overlays INSIDE the cart sheet Modal (iOS can't stack Modals), so the
  // cart list ↔ folder page ↔ item preview swap in place. Everything is AddProductScreen state.
  const renderMatchPreview = () => (
    <MatchPreview
      data={previewData}
      onBack={() => setPreviewItemId(null)}
      onWrongItem={() => setAddDetailsItemId(previewItemId)}
      onResearch={({ text }) => {
        const id = previewItemId;
        setPreviewItemId(null);
        if (id && text) void runQuickScanTextSearch(id, text);
      }}
      onAddPhoto={() => {
        const id = previewItemId;
        setPreviewItemId(null);
        if (id) setActiveItemId(id);
        handleImageUpload();
      }}
      sellLabel="Confirm item"
      onSell={() => {
        const id = previewItemId;
        setPreviewItemId(null);
        if (!id) return;
        if (itemStageById[id] === 'generated') {
          // Generated item: continue to the per-item listing editor. The cart Modal
          // must finish dismissing before the pushed screen can show (and before
          // navigation animates — overlapping the two hits the Fabric unmount assert).
          closeBulkItemsSheetRef.current();
          setTimeout(() => openItemDetails(id), 400);
          return;
        }
        const qs = quickScanStore[id];
        if (qs?.matchData?.rankedCandidates?.length && !confirmedQuickMatchByItemId[id]) {
          const candidates = rankedCandidatesToQuickMatchHintCandidates(qs.matchData.rankedCandidates);
          setConfirmedQuickMatchByItemId((prev) => ({
            ...prev,
            [id]: { serpApiData: candidates, preSelectedIndices: [0], source: 'quick_scan_confirmed' },
          }));
        }
        showNotificationMessage('Added to cart');
      }}
    />
  );

  // "Add details" page — collect text + a tag photo for an item we couldn't confidently
  // match (or the user flagged as the wrong item), then re-run the search.
  const renderAddDetails = () => {
    const id = addDetailsItemId;
    if (!id) return null;
    const item = bulkItems.find((b) => b.id === id);
    const baseTitle = item?.title && !/^Item \d+$/.test(item.title) ? item.title : '';
    return (
      <AddDetailsSheet
        itemTitle={item?.title}
        photoUri={item?.photos?.find((p) => p.isCover)?.uri || item?.photos?.[0]?.uri}
        photos={(item?.photos || []).map((p: any) => ({ id: String(p.id ?? p.uri), uri: p.uri }))}
        onRemovePhoto={(photoId) => removeBulkItemPhoto(id, photoId)}
        onBack={() => setAddDetailsItemId(null)}
        onCaptureTag={() => {
          // Target this item and drop back to the live camera for the tag shot.
          // The overlay unmount must commit BEFORE the cart Modal starts closing —
          // overlapping the two transactions hits the Fabric unmount assert.
          setAddDetailsItemId(null);
          setPreviewItemId(null);
          setActiveItemId(id);
          setTimeout(closeBulkItemsSheet, 80);
        }}
        onImportTag={() => {
          setActiveItemId(id);
          handleImageUpload();
        }}
        onContinue={(detail) => {
          setAddDetailsItemId(null);
          if (detail) {
            const newQuery = [baseTitle, detail].filter(Boolean).join(' ');
            setBulkItems((prev) => prev.map((b) => (b.id === id ? { ...b, title: newQuery } : b)));
            setPreviewItemId(null); // back to the cart row so they watch the re-search land
            void runQuickScanTextSearch(id, newQuery);
          }
        }}
      />
    );
  };

  const renderShelfFolderPage = () =>
    openFolder ? (
      <ShelfFolderSheet
        label={openFolder.label}
        sourcePhotoUri={openFolder.sourcePhotoUri}
        items={openFolder.children}
        quickScanStore={quickScanStore}
        confirmedQuickMatchByItemId={confirmedQuickMatchByItemId}
        itemLoadingStates={itemLoadingStates}
        onBack={() => setOpenFolderId(null)}
        onUngroup={() => {
          if (openFolderId) ungroupFolder(openFolderId);
          setOpenFolderId(null);
        }}
        onOpenItemPreview={handleOpenItem}
        onAddAllToCart={() => {
          const folder = openFolder;
          setOpenFolderId(null);
          setConfirmedQuickMatchByItemId((prev) => {
            const next = { ...prev };
            for (const child of folder.children) {
              if (next[child.id]) continue;
              const qs = quickScanStore[child.id];
              if (qs?.matchData?.rankedCandidates?.length) {
                next[child.id] = {
                  serpApiData: rankedCandidatesToQuickMatchHintCandidates(qs.matchData.rankedCandidates),
                  preSelectedIndices: [0],
                  source: 'quick_scan_confirmed',
                };
              }
            }
            return next;
          });
          if (openFolderId) ungroupFolder(openFolderId); // dissolve the folder → items become top-level cart singles
          showNotificationMessage('Added shelf items to cart');
        }}
      />
    ) : null;

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
  // Deferred cart-Modal unmount after the close spring settles (cleared on reopen).
  const cartCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-fresh handle for callbacks declared above closeBulkItemsSheet (avoids
  // stale closures over its isProcessingShelfScan guard).
  const closeBulkItemsSheetRef = useRef<() => void>(() => {});
  // Same late-binding pattern for OPENING: handleCapture (declared earlier) opens
  // the cart when the free tier is exhausted — the cart is the upgrade surface.
  const openBulkItemsSheetRef = useRef<() => void>(() => {});
  // Pending deferred cart-present (the dismiss-then-present staggers). MUST be cleared
  // on blur: the tab keeps this screen mounted, so a stray reopen after navigating away
  // presents the transparent cart Modal over the other tab and eats every touch.
  const cartReopenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFocusedRef = useRef(true);

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
    setCurrentInstruction('ready');
    // Standard cart-close handshake (can't call closeBulkItemsSheet here — its
    // isProcessingShelfScan guard still reads true this tick), then clear the
    // shelf/bulk state in a commit AFTER the Modal unmount: tearing the children
    // down in the same commit as the visible flip is the Fabric unmount race.
    cancelAnimation(sheetTranslateY);
    sheetTranslateY.value = withSpring(SCREEN_HEIGHT, CART_SPRING);
    if (cartCloseTimerRef.current) clearTimeout(cartCloseTimerRef.current);
    cartCloseTimerRef.current = setTimeout(() => {
      cartCloseTimerRef.current = null;
      cancelAnimation(sheetTranslateY);
      sheetTranslateY.value = SCREEN_HEIGHT;
      setShowDeepSearchSheet(false);
      setTimeout(() => {
        setShelfPhotoUri(null);
        shelfPhotoUriForDraftRef.current = null;
        resetShelfScanResults();
        resetShelfProgress();
      }, 80);
    }, 420);
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
  isFocusedRef.current = isFocused;

  // Stable item ID generator to prevent key collisions
  const itemIdCounterRef = useRef(0);
  const generateItemId = useCallback(() => {
    itemIdCounterRef.current += 1;
    return `item-${Date.now()}-${itemIdCounterRef.current}`;
  }, []);


  // Guard against inconsistent modal state that can leave camera paused with no visible sheet.
  useEffect(() => {
    if (showMatchSheet && !matchData) {
      setShowMatchSheet(false);
      if (bulkItems.length > 0 || cameraMode === 'shelf') {
        // Dismiss first, present second — never flip two sibling Modals in one commit.
        const timer = setTimeout(() => {
          if (cartCloseTimerRef.current) {
            clearTimeout(cartCloseTimerRef.current);
            cartCloseTimerRef.current = null;
          }
          setShowDeepSearchSheet(true);
          sheetTranslateY.value = withSpring(0, CART_SPRING);
        }, 280);
        return () => clearTimeout(timer);
      }
    }
  }, [showMatchSheet, matchData, bulkItems.length, cameraMode, sheetTranslateY]);

  // Force re-render counter for debugging
  const [forceRenderCount, setForceRenderCount] = useState(0);
  const forceRerender = useCallback(() => {
    log.debug('[FORCE RENDER] Forcing component re-render');
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
      log.warn('[AddProduct] Failed to hydrate pending billing action:', error);
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
    log.debug('Focus at:', locationX, locationY);

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

    // Out of free scans → no blocking modal; the cart sheet opens and presents
    // the usage limit with the upgrade stepper / add-credits options.
    if (freemiumStatus && !freemiumStatus.hasSubscription && freemiumStatus.isFreeTierExhausted) {
      openBulkItemsSheetRef.current?.();
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
            log.debug('[ITEM CREATION] Creating FIRST ITEM (no items exist yet)');
            const firstItem = {
              id: `item-${Date.now()}`,
              photos: [newPhoto],
              title: undefined,
              isActive: true
            };
            setBulkItems([firstItem]);
            setActiveItemId(firstItem.id);
            capture(AnalyticsEvents.PRODUCT_ADDED, { source: 'camera' });
            log.debug('[ITEM CREATION] Created first item:', firstItem.id);
            log.debug('[ITEM CREATION] Triggering quick scan (first photo of first item)');

            log.debug('[FIRST ITEM] Created first item with ID:', firstItem.id);
            setTimeout(() => {
              log.debug('[FIRST ITEM] About to call performQuickScan for first item:', firstItem.id);
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
      log.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
      setCurrentInstruction('ready');
      stopProgressAnimation();
    } finally {
      setIsCapturing(false);
    }
  }, [isCapturing, capturedPhotos.length, flash, captureButtonScale, flashOpacity, canAddAnotherItem, freemiumStatus]);

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

    log.debug('Barcode scanned:', scanningResult.data);

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
      log.debug(`[BARCODE] Searching backend for barcode: ${barcode}`);

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
        log.debug(`[BARCODE] Search returned status ${response.status}`);
        setBarcodeSearching(false);
        setCurrentInstruction('ready');
        return;
      }

      const data = await safeJson<any>(response);

      if (!data) {
        log.warn('[BARCODE] Non-JSON response from lookup');
        setCurrentInstruction('ready');
        return;
      }

      if (data.error) {
        log.debug(`[BARCODE] Product not found: ${data.error}`);
        Alert.alert('Product Not Found', data.error);
        setBarcodeSearching(false);
        setCurrentInstruction('ready');
        return;
      }

      log.debug(`[BARCODE] Found product:`, data.variant.Title);
      setBarcodeSearchResult(data);
      setShowBarcodeResultModal(true);
      setBarcodeSearching(false);
      setCurrentInstruction('ready');
    } catch (error) {
      log.error(`[BARCODE] Search error:`, error);
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
      if (cartCloseTimerRef.current) { clearTimeout(cartCloseTimerRef.current); cartCloseTimerRef.current = null; }
      setShowDeepSearchSheet(true);
      sheetTranslateY.value = withSpring(0, CART_SPRING);
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

      log.debug(`[SHELF MODE] Starting SSE stream with ${base64.length} bytes`);
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
          log.error('[SHELF MODE] Stream error:', message);
          stopShelfScan('error', {
            phase: 'finishing',
            progress: 1,
            message: parsedError.message,
            reasonCode: parsedError.reasonCode || 'stream_disconnected',
          });
        },
        onEvent: (parsed: QuickScanStreamEvent) => {
          log.debug('[SHELF MODE] Stream event:', parsed.type);
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
            if (cartCloseTimerRef.current) { clearTimeout(cartCloseTimerRef.current); cartCloseTimerRef.current = null; }
            setShowDeepSearchSheet(true);
            sheetTranslateY.value = withSpring(0, CART_SPRING);
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
            const ts = Date.now();
            const folderItems = items.map((item, idx) => {
              const query = typeof item === 'string' ? item : item.query;
              const quantity = typeof item === 'object' && item.quantity != null ? item.quantity : 1;
              return { id: `shelf-${ts}-${idx}`, title: query, quantity };
            });

            shelfQueryToItemIdRef.current = {};
            items.forEach((item, idx) => {
              const query = typeof item === 'string' ? item : item.query;
              shelfQueryToItemIdRef.current[query] = folderItems[idx].id;
            });

            // Shelf items become a folder in the SHARED cart (alongside singles), not a separate flow.
            createShelfFolder({
              sourcePhotoUri: shelfPhotoUriForDraftRef.current || shelfPhotoUri || undefined,
              label: 'Shelf',
              items: folderItems,
            });
            setIsBulkMode(true);
            setActiveItemId(folderItems[0]?.id || null);
            setCurrentInstruction('extracting');
            setShelfProgress((prev) => ({
              ...prev,
              phase: parsed.phase || 'separating_items',
              progress: typeof parsed.progress === 'number' ? parsed.progress : prev.progress,
              elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : prev.elapsedMs,
              totalItems: typeof parsed.totalItems === 'number' ? parsed.totalItems : folderItems.length,
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
            sheetTranslateY.value = withSpring(0, CART_SPRING);
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
            log.error('[SHELF MODE] Agent error:', parsed.message);
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
      log.error(`[SHELF MODE] Error:`, error);
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
    log.debug('[CONTINUE] Button pressed, opening search sheet');
    log.debug('[CONTINUE] Current state:', {
      capturedPhotosCount: capturedPhotos.length,
      isBulkMode,
      bulkItemsCount: bulkItems.length,
      activeItemId,
      cameraMode,
      hasBarcodeResult: !!barcodeSearchResult
    });

    // Present the cart. When the match-sheet Modal is mounted, dismiss it FIRST and
    // present the cart after its dismissal settles — flipping two sibling Modals in
    // one commit races UIKit present/dismiss and asserts in Fabric
    // (RCTViewComponentView unmountChildComponentView crash).
    const openCart = () => {
      if (cartCloseTimerRef.current) {
        clearTimeout(cartCloseTimerRef.current);
        cartCloseTimerRef.current = null;
      }
      cancelAnimation(sheetTranslateY);
      setShowDeepSearchSheet(true);
      sheetTranslateY.value = SCREEN_HEIGHT;
      sheetTranslateY.value = withSpring(0, CART_SPRING);
    };
    const dismissMatchSheetThenOpenCart = () => {
      if (showMatchSheet) {
        setShowMatchSheet(false);
        matchSheetTranslateY.value = withTiming(SCREEN_HEIGHT, { duration: 150 });
        if (cartReopenTimerRef.current) clearTimeout(cartReopenTimerRef.current);
        cartReopenTimerRef.current = setTimeout(() => {
          cartReopenTimerRef.current = null;
          if (isFocusedRef.current) openCart();
        }, 280);
      } else {
        openCart();
      }
    };

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
      dismissMatchSheetThenOpenCart();
      showNotificationMessage('Moved to listing flow', 1800);
      return;
    }

    // BARCODE MODE: Open barcode result modal if we have a result
    if (cameraMode === 'barcode' && barcodeSearchResult) {
      log.debug('[CONTINUE] Barcode mode - opening barcode result modal');
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

      log.debug('[CONTINUE] Manifest mode - parsing', allPhotos.length, 'pages');
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
              log.error('[MANIFEST] Failed to read photo:', e);
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

        const data = await safeJson<any>(response);
        if (!data?.jobId) {
          throw new Error('Invalid response from manifest endpoint');
        }
        log.debug('[MANIFEST] Job started:', data.jobId);

        // Show the ManifestReviewSheet with the job ID
        setManifestJobId(data.jobId);
        setShowManifestSheet(true);

        // Clear photos after successful submission
        setBulkItems([]);
        setActiveItemId(null);

      } catch (error: any) {
        log.error('[MANIFEST] Error:', error);
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

      log.debug('[CONTINUE] Receipt mode - processing', allPhotos.length, 'receipts');
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
              log.error('[RECEIPT] Failed to read photo:', e);
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

        const data = await safeJson<any>(response);
        if (!data?.jobId) {
          throw new Error('Invalid response from receipt endpoint');
        }
        log.debug('[RECEIPT] Job started:', data.jobId);

        // Show the ReceiptReviewSheet with the job ID
        setReceiptJobId(data.jobId);
        setShowReceiptSheet(true);

        // Clear photos after successful submission
        setBulkItems([]);
        setActiveItemId(null);

      } catch (error: any) {
        log.error('[RECEIPT] Error:', error);
        Alert.alert('Error', error.message || 'Failed to process receipt');
      }

      return;
    }

    // Always open sheet - it will show empty state if no photos
    dismissMatchSheetThenOpenCart();
  }, [sheetTranslateY, matchSheetTranslateY, capturedPhotos.length, isBulkMode, bulkItems, activeItemId, cameraMode, barcodeSearchResult, showNotificationMessage, showMatchSheet]);

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
      log.debug('[IMAGE UPLOAD] Adding', assets.length, 'uploaded image(s)');

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
        log.debug('[IMAGE UPLOAD] Shelf mode - routing to handleShelfModeScan');
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
    log.debug('Drag started for photo:', photoId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggedPhotoId(null);
    log.debug('Drag ended');
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
      log.error('Error getting auth headers:', error);
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
      log.debug('[UPLOAD] Starting upload for:', photoId);

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
        log.error('[UPLOAD] Supabase upload error:', error);
        throw error;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('product-images')
        .getPublicUrl(fileName);

      const publicUrl = urlData.publicUrl;
      log.debug('[UPLOAD] Successfully uploaded to:', publicUrl);

      return publicUrl;
    } catch (error) {
      log.error('[UPLOAD] Failed to upload image:', error);
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
        log.debug('[QUICK SCAN] Queue limit reached, dropping oldest queued scan');
        quickScanQueueRef.current.shift();
      }
      const alreadyQueued = quickScanQueueRef.current.some(task => task.itemId === itemId && task.photo.id === photo.id);
      if (!alreadyQueued) {
        quickScanQueueRef.current.push({ photo, itemId });
      }
      log.debug('[QUICK SCAN] Scan in progress, queued follow-up scan');
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
        log.warn('[QUICK SCAN] No Supabase JWT available. Are you signed in and the Clerk bridge configured?');
        showNotificationMessage('Sign in required to scan. Please log in and try again.', 3000);
        scanErrorMessage = 'Sign in required';
        setIsAutoScanning(false);
        return;
      }
      log.debug('[QUICK SCAN] Starting quick scan for photo:', photo.id);
      log.debug('[QUICK SCAN] Photo URI:', photo.uri);
      log.debug('[QUICK SCAN] Timestamp:', new Date().toISOString());

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
      log.debug('[QUICK SCAN] Uploading image to Supabase...');
      const publicImageUrl = await uploadImageToSupabase(photo.uri, photo.id);
      log.debug('[QUICK SCAN] Image uploaded to:', publicImageUrl);

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
          log.warn(`[QUICK SCAN] Primary endpoint failed (${quickScanUrlPrimary}), retrying fallback`);
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
        log.debug('[QUICK SCAN] Free tier exhausted:', errorData);
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

      log.debug('[QUICK SCAN] Received result for item:', itemId);
      log.debug('[QUICK SCAN] Full result:', JSON.stringify(result, null, 2));

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
                log.warn('[QUICK SCAN] pricing research returned no data or error');
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
              log.warn('[QUICK SCAN] pricing enrichment skipped:', enrichErr);
            }
          })();
        }

      } else {
        log.debug('[QUICK SCAN] No matches found');
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
      log.error('[QUICK SCAN] scan failed:', error);
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
        log.warn('[AddProduct] Failed to resume pending quick scan:', error);
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
      if (cartCloseTimerRef.current) { clearTimeout(cartCloseTimerRef.current); cartCloseTimerRef.current = null; }
      setShowDeepSearchSheet(true);
      sheetTranslateY.value = withSpring(0, CART_SPRING);
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
    // Sequence the modal handoff: dismiss the cart Modal first, then present the
    // barcode-result Modal and unmount the cart row in later commits — batching a
    // sibling present + dismiss + child teardown into one commit races UIKit/Fabric.
    setCurrentInstruction('ready');
    closeBulkItemsSheetRef.current?.();
    setTimeout(() => {
      setShowBarcodeResultModal(true);
      markItemsProcessed([{ id: itemId }], 'existing_inventory');
    }, 520);
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
      log.debug('[ANALYZE] Sending payload of ' + firstPhotos.length + ' first photos to backend for analysis, matching, and item creation');

      // Upload images to Supabase Storage first
      log.debug('[ANALYZE] Uploading images to Supabase...');

      const publicImageUrls = await Promise.all(
        firstPhotos.map(photo => uploadImageToSupabase(photo.uri, photo.id))
      );

      const products = buildMatchAnalyzeProducts(publicImageUrls, itemsForAnalyze, quickMatchHintsByItemId);

      log.debug('[ANALYZE] Images uploaded to:', publicImageUrls);

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
      log.debug('[ANALYZE] Request details:', {
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

      log.debug('[ANALYZE] Response status/body:', {
        status: response.status,
        ok: response.ok,
        bodyPreview: responseText.slice(0, 300),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} :: ${responseText.slice(0, 200)}`);
      }

      const normalizedJobId = analyzeResult?.jobId || analyzeResult?.job?.jobId || analyzeResult?.data?.jobId || null;
      if (!normalizedJobId) {
        log.error('[ANALYZE] Missing jobId in response payload:', analyzeResult);
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
      log.error('[ANALYZE] Analyze failed:', error);
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
    log.debug('[ADD NEW ITEM] Starting to add new item:', newItemId);
    log.debug('[ADD NEW ITEM] Current bulk mode:', isBulkMode);
    log.debug('[ADD NEW ITEM] Current items count:', bulkItems.length);

    // Auto-enable bulk mode when adding items
    if (!isBulkMode) {
      log.debug('[ADD NEW ITEM] Enabling bulk mode');
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
        log.debug('[ADD NEW ITEM] Creating items with existing photos:', newItems);
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
        log.debug('[ADD NEW ITEM] Creating first item:', newItems);
        setBulkItems(newItems);
        setActiveItemId(newItemId);
      }
    } else {
      // Deactivate all items and add new active one
      log.debug('[ADD NEW ITEM] Adding to existing bulk items');
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
        log.debug('[ADD NEW ITEM] New items array:', newItems);
        return newItems;
      });
      setActiveItemId(newItemId);
    }

    if (isBulkMode && bulkItems.length > 0) {
      log.debug("You can't disable bulk mode when there are items in the list");
      showNotificationMessage('You can\'t disable bulk mode when there are items in the list', 3000);
      setIsBulkMode(true);
    }
  }, [isBulkMode, capturedPhotos, bulkItems.length, canAddAnotherItem, generateItemId]);

  // NEW: Handle pressing the match indicator/banner
  const handleMatchIndicatorPress = useCallback(() => {
    if (activeItemId) {
      log.debug('[MATCH CLICK] Indicator pressed for item:', activeItemId);

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
    log.debug('[SELECT ITEM] Setting active item to:', itemId);
    log.debug('[SELECT ITEM] quickScanStore keys:', Object.keys(quickScanStore));
    log.debug('[SELECT ITEM] quickScanStore for itemId:', quickScanStore[itemId] ? 'EXISTS' : 'MISSING');
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
      log.debug('[DELETE ITEM] Cleaned up quickScanStore for item:', itemId);
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
    // Idempotent: a close is already in flight — let its timer finish. Re-arming the
    // spring + timer mid-close is what produced a Fabric unmount crash
    // (RCTViewComponentView unmountChildComponentView assert).
    if (cartCloseTimerRef.current) return;
    setCurrentInstruction('ready');
    // Spring the cart down; the capture-screen lift unwinds in lockstep
    // (cameraLiftStyle is derived from sheetTranslateY). The Modal unmount is deferred
    // until the spring has visually settled, and the value is pinned (no animation
    // running) before unmounting so Fabric tears the tree down from a quiescent state.
    sheetTranslateY.value = withSpring(SCREEN_HEIGHT, CART_SPRING);
    cartCloseTimerRef.current = setTimeout(() => {
      cartCloseTimerRef.current = null;
      cancelAnimation(sheetTranslateY);
      sheetTranslateY.value = SCREEN_HEIGHT;
      setShowDeepSearchSheet(false);
    }, 420);
  }, [sheetTranslateY, isProcessingShelfScan]);
  closeBulkItemsSheetRef.current = closeBulkItemsSheet;

  // Open bulk items sheet deterministically
  const openBulkItemsSheet = useCallback(() => {
    // Never present the (transparent, touch-eating) cart Modal while another tab is
    // focused — a deferred reopen can fire after the user navigates away.
    if (!isFocusedRef.current) return;
    if (cartCloseTimerRef.current) {
      clearTimeout(cartCloseTimerRef.current);
      cartCloseTimerRef.current = null;
    }
    cancelAnimation(sheetTranslateY);
    setShowDeepSearchSheet(true);
    sheetTranslateY.value = SCREEN_HEIGHT;
    sheetTranslateY.value = withSpring(0, CART_SPRING);
  }, [sheetTranslateY]);
  openBulkItemsSheetRef.current = openBulkItemsSheet;

  // Swipe DOWN anywhere on the capture screen → open the cart with the reachability
  // lift. The wrapping PanGestureHandler is configured (activeOffsetY) to ONLY claim
  // downward drags past threshold, so taps to capture and other gestures pass through
  // untouched; by the time this fires the gesture is already a deliberate down-swipe.
  const onCameraSwipeDown = useCallback((event: PanGestureHandlerGestureEvent) => {
    if ((event.nativeEvent as any).state !== State.ACTIVE) return;
    if (showDeepSearchSheet || isProcessingShelfScan) return;
    openBulkItemsSheet();
  }, [showDeepSearchSheet, isProcessingShelfScan, openBulkItemsSheet]);

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
      // Dismiss only — both runOnJS calls land in one JS task, so adding
      // openBulkItemsSheet here would batch a sibling-Modal present into the same
      // React commit as this dismissal (the Fabric unmountChildComponentView crash).
      runOnJS(setShowMatchSheet)(false);
      runOnJS(setCurrentInstruction)('ready');
    });
    // Present the cart after the match Modal's dismissal commit has gone through.
    if (cartReopenTimerRef.current) clearTimeout(cartReopenTimerRef.current);
    cartReopenTimerRef.current = setTimeout(() => {
      cartReopenTimerRef.current = null;
      openBulkItemsSheet();
    }, 400);
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
    log.debug('[BROAD SEARCH] Starting broad search: cancelling quick scan and resetting state');
    
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
        // NOTE: this cleanup also fires every time the deps below change while the
        // screen stays focused — Modal/timer teardown lives in the stable-callback
        // focus effect right after this one, which only fires on real blur.
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

  // Real-blur-only cleanup (stable callback → fires only on blur/unmount, never on
  // state churn): cancel deferred cart present/unmount timers and drop EVERY Modal.
  // This tab stays mounted on blur, and a transparent overFullScreen Modal left (or
  // later re-presented by a stray timer) over another tab silently eats all touches.
  useFocusEffect(
    useCallback(() => {
      return () => {
        quickScanQueueRef.current = [];
        if (cartReopenTimerRef.current) {
          clearTimeout(cartReopenTimerRef.current);
          cartReopenTimerRef.current = null;
        }
        if (cartCloseTimerRef.current) {
          clearTimeout(cartCloseTimerRef.current);
          cartCloseTimerRef.current = null;
        }
        setShowMatchSheet(false);
        setShowBarcodeResultModal(false);
        setShowDeepSearchSheet(false);
        cancelAnimation(sheetTranslateY);
        sheetTranslateY.value = SCREEN_HEIGHT;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
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

  // Reachability-style cart reveal: the whole capture screen lifts UP as the cart
  // opens (sheetTranslateY 0 → lift -SCREEN_HEIGHT) and sits at rest when the cart is
  // closed (sheetTranslateY SCREEN_HEIGHT → lift 0). Because both this lift and the
  // cart pane's own translate are driven by the SAME sheetTranslateY, the camera and
  // the rising full-screen cart move as one connected piece — the camera slides off
  // the top exactly as the cart rises from below (visible through the transparent cart
  // Modal). min(0, …) clamps so the screen never droops downward on overshoot.
  const cameraLiftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.min(0, sheetTranslateY.value - SCREEN_HEIGHT) }],
  }));

  // The lift keeps the card's bottom exactly CAMERA_BOTTOM_GAP above the sheet's
  // top edge at every position (both ride sheetTranslateY). These two styles close
  // that strip as the cart engages: the camera card slides down to meet the sheet
  // (rounded bottom bleeding into the cart) while the shutter controls fade away.
  // Progress saturates at half-travel so partial snap points still read as "open".
  const cameraCardSlideStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (SCREEN_HEIGHT - sheetTranslateY.value) / (SCREEN_HEIGHT * 0.5)));
    return { transform: [{ translateY: p * (CAMERA_BOTTOM_GAP + 12) }] };
  });
  const controlsFadeStyle = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (SCREEN_HEIGHT - sheetTranslateY.value) / (SCREEN_HEIGHT * 0.5)));
    return { opacity: 1 - p };
  });

  // Swipe the match card left/right to hop between cart items without opening the cart.
  const stepActiveItem = useCallback((dir: 1 | -1) => {
    if (bulkItems.length < 2) return;
    const idx = bulkItems.findIndex((b) => b.id === activeItemId);
    const next = bulkItems[(idx + dir + bulkItems.length) % bulkItems.length];
    if (next) setActiveItemId(next.id);
  }, [bulkItems, activeItemId]);

  const matchSheetAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: matchSheetTranslateY.value }],
  }));

  const overlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: overlayOpacity.value,
  }));

  // Stand the swipe-back ring down while any sheet is open (their gestures must win).
  // MUST be above the permission early-returns below, or the hook count changes between renders.
  useSuppressSwipeBackWhen(showDeepSearchSheet || (!!showMatchSheet && !!matchData) || showBarcodeResultModal);

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
    price: typeof activeSelectedMatch?.price === 'number'
      ? activeSelectedMatch.price
      : typeof activeSelectedMatch?.price?.extracted_value === 'number'
        ? activeSelectedMatch.price.extracted_value
        : null,
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

      {/* DEV/design-export preview Modal only. Real flows render the preview + folder page as
          opaque overlays INSIDE the cart sheet Modal (below) — iOS can't stack Modals. */}
      {(DEV_FORCE_MATCH_PREVIEW || __ds === 'matchPreview') && (
        <Modal visible animationType="slide" onRequestClose={() => setPreviewItemId(null)}>
          {renderMatchPreview()}
        </Modal>
      )}

      {/* Capture screen — lifts UP (reachability) as the cart opens, revealing the
          full-screen cart rising from below. Drag UP (or down) anywhere here to open
          the cart — up matches the "cart rises from below" metaphor users reach for. */}
      <PanGestureHandler
        activeOffsetY={[-28, 28]}
        failOffsetX={[-28, 28]}
        onHandlerStateChange={onCameraSwipeDown}
      >
        <Animated.View style={[StyleSheet.absoluteFill, cameraLiftStyle]}>

      {/* Freemium usage counter */}
      {/* No always-on upgrade banner: free users scan in peace. When they run
          out, the shutter routes into the cart sheet, which presents the usage
          limit + upgrade stepper / credits (see handleCapture + BulkItemsSheet). */}

      {/* Top photo bar — horizontal strip in the black bar above the cropped viewfinder.
          “+” imports from the library; tap a photo to manage it; “−” removes; long-press
          sets the cover. */}
      <View style={[styles.topPhotoBar, { height: screenInsets.top + TOP_PHOTO_BAR_HEIGHT }]}>
        {(() => {
          const activeItem = activeItemId ? bulkItems.find(item => item.id === activeItemId) : null;
          const displayPhotos = activeItem?.photos || [];
          return (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // Keep the photo stack clear of the iOS status bar: the ScrollView
              // stretches over the whole bar (implicit flexGrow) and centers its
              // tiles, so without this the "+" tile drifts up under the clock.
              style={{ marginTop: screenInsets.top + 8 }}
              contentContainerStyle={styles.topPhotoBarContent}
              keyboardShouldPersistTaps="handled"
            >
              <TouchableOpacity style={styles.addPhotoTile} onPress={handleImageUpload} activeOpacity={0.8}>
                <MaterialIcons name="add" size={26} color="rgba(255,255,255,0.85)" />
              </TouchableOpacity>
              {displayPhotos.map((photo) => (
                <View key={photo.id} style={styles.photoTileWrap}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => setShowViewPhotosModal(true)}
                    onLongPress={() => activeItemId && setBulkItemCoverPhoto(activeItemId, photo.id)}
                    delayLongPress={220}
                  >
                    <Image source={{ uri: photo.uri }} style={[styles.photoTile, photo.isCover && styles.photoTileCover]} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.photoTileRemove}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    onPress={() => activeItemId && removeBulkItemPhoto(activeItemId, photo.id)}
                  >
                    <MaterialIcons name="remove" size={13} color="#FFF" />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          );
        })()}
      </View>

      {/* Camera View - key forces remount when returning to screen so camera feed resumes.
          Cropped, rounded viewfinder (Shop-style) between the photo bar and the controls.
          CRASH FIX: CameraView must have NO React children. expo-camera attaches/detaches
          its native preview subview behind Fabric's back, shifting child indices; the next
          unmount of a conditional JSX child then trips the RCTViewComponentView
          unmountChildComponentView index assert (root cause of every Anorha-*.ips since
          06-08 — the assert names ExpoCamera.CameraView as parent and the rgba(0,0,0,0.7)
          paused overlay as the child). Overlays now live in a sibling wrapper View. */}
      <Animated.View style={[styles.cameraViewfinder, { top: screenInsets.top + TOP_PHOTO_BAR_HEIGHT, bottom: CAMERA_BOTTOM_GAP }, cameraCardSlideStyle]}>
        <CameraView
          key={`camera-${isFocused}`}
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing={facing}
          flash={flash}
          active={isFocused && !isAnySheetVisible} // Disable camera when sheets are open
          onBarcodeScanned={handleBarCodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'],
          }}
        />
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

        {/* Back button — sits where the old photo stack lived (top-left over the camera) */}
        <TouchableOpacity
          ref={backButtonRef}
          onLayout={() => {
            // Publish the button's real window rect so the swipe-back ring rims it exactly,
            // on any device/orientation (re-fires whenever it lays out / moves).
            backButtonRef.current?.measureInWindow((x: number, y: number, width: number, height: number) => {
              if (width && height) publishBackButtonRect({ x, y, width, height });
            });
          }}
          style={styles.cameraBackButton}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          onPress={() => {
            const nav = navigation as any;
            if (nav.canGoBack?.()) nav.goBack();
            else nav.navigate('Inventory');
          }}
        >
          <MaterialIcons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>

        {/* Camera controls (top right) */}
        <CameraControls
          flash={flash}
          onToggleFlash={toggleFlash}
          onPastScans={() => navigation.navigate('PastScans' as never)}
        />

        {/* Framing guides — sized relative to the viewfinder, so they live inside it.
            Camera + shelf modes show no frame: the preview gets the full area. */}
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

      </Animated.View>

      {/* Overlays & Controls (Outside CameraView to avoid touch issues).
          The wrapper rides the same slide as the camera card so the match card
          stays pinned to the card's bottom edge while the cart opens. */}
      <Animated.View style={[StyleSheet.absoluteFill, cameraCardSlideStyle]} pointerEvents="box-none">
        <CenterOverlay
          instruction={getInstructionText(currentInstruction)}
          isProcessing={['processing', 'analyzing', 'extracting', 'optimizing', 'searching', 'recognizing'].includes(currentInstruction)}
          cameraMode={cameraMode}
          scannedBarcode={scannedBarcode}
          onCopyBarcode={copyBarcodeToClipboard}
          matchPreview={centerOverlayMatchPreview}
          cardBottomOffset={CAMERA_BOTTOM_GAP + 44}
          onSwipeItem={stepActiveItem}
          onPress={
            cameraMode === 'shelf' && !showDeepSearchSheet && (isProcessingShelfScan || bulkItems.length > 0 || shelfPhotoUri)
              ? openBulkItemsSheet
              : handleMatchIndicatorPress
          }
          totalPhotos={bulkItems.reduce((sum, sumItem) => sum + sumItem.photos.length, 0)}
        />
      </Animated.View>

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

      {/* Bottom controls — fade out as the cart rises so the strip between the
          camera card and the sheet reads as clean black, not stranded buttons.
          (When the cart Modal is up it owns all touches, so opacity alone is safe.)
          absoluteFill is load-bearing: BottomControls positions itself absolutely,
          so a collapsed (auto-height) wrapper would strand it off-screen. */}
      <Animated.View style={[StyleSheet.absoluteFill, controlsFadeStyle]} pointerEvents="box-none">
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
      </Animated.View>
        </Animated.View>
      </PanGestureHandler>

      {/* Match results sheet (rendered above TabBar via Modal) */}
      <Modal
        visible={!!showMatchSheet && !!matchData}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeMatchSheetToBulk}
        presentationStyle="overFullScreen"
      >
        {/* Keep mounted while `visible` toggles — see the cart Modal note (Fabric unmount assert). */}
        {matchData ? (
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
        {/* Children stay mounted while `visible` toggles — unmounting Modal children in
            the same commit as the visible flip asserts in Fabric
            (RCTViewComponentView unmountChildComponentView; long-standing crash class
            in this app's reports). The Modal's own dismissal tears down the native tree. */}
        {(
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            {/* Transparent — no dim. The capture screen lifting away behind this
                transparent Modal IS the reveal. Tapping the exposed gap closes the cart. */}
            <Pressable style={StyleSheet.absoluteFill} onPress={closeBulkItemsSheet} />
            {(() => {
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
                  onOpenItemPreview={handleOpenItem}
                  cartTree={cartTree}
                  onOpenFolder={(id) => setOpenFolderId(id)}
                  onQueueGeneration={handleQueueGeneration}
                  savedForLaterIds={savedForLaterIds}
                  onToggleSavedForLater={setItemSavedForLater}
                  onOpenAddDetails={(id) => setAddDetailsItemId(id)}
                  freemium={freemiumStatus && !freemiumStatus.hasSubscription
                    ? { usageCount: freemiumStatus.usageCount, freeLimit: freemiumStatus.freeLimit, exhausted: freemiumStatus.isFreeTierExhausted }
                    : null}
                  onUpgrade={() => setShowTierSelector(true)}
                  onAddCredits={() => {
                    setBillingGate(buildFreemiumBlockedGate());
                    setBillingGateVisible(true);
                  }}
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
                  itemStageById={itemStageById}
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
            {/* Add-details / folder page / item preview as opaque overlays in THIS Modal (no nested Modals) */}
            {addDetailsItemId ? (
              <View style={StyleSheet.absoluteFill}>{renderAddDetails()}</View>
            ) : previewItemId ? (
              <View style={StyleSheet.absoluteFill}>{renderMatchPreview()}</View>
            ) : openFolder ? (
              <View style={StyleSheet.absoluteFill}>{renderShelfFolderPage()}</View>
            ) : null}
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
        {/* Keep mounted while `visible` toggles — see the cart Modal note (Fabric unmount assert). */}
        {barcodeSearchResult ? (
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
                  log.error('[QUICK DETAIL] No variant Id found for navigation');
                }
              }}
              onSave={async (updates) => {
                log.debug('[BARCODE SAVE] Saving updates via API:', updates);
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
                        log.warn(`[BARCODE SAVE] No connectionId found for location ${u.location}`);
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
                  log.error('[BARCODE SAVE] Error:', e);
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
                  log.debug('[MANIFEST] Adding items to inventory:', items.length);
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
                  log.debug('[RECEIPT] Applied updates:', updates.length);
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
  // Shop-style capture chrome
  topPhotoBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    backgroundColor: '#000',
    justifyContent: 'flex-end',
    paddingBottom: 10,
  },
  topPhotoBarContent: {
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 10,
    flexDirection: 'row',
  },
  addPhotoTile: {
    width: 64,
    height: 64,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoTileWrap: {
    width: 64,
    height: 64,
  },
  photoTile: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#1C1C1E',
  },
  photoTileCover: {
    borderWidth: 2,
    borderColor: '#93C822',
  },
  photoTileRemove: {
    position: 'absolute',
    top: -6,
    left: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF6B4A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#000',
  },
  cameraViewfinder: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#101012',
  },
  cameraBackButton: {
    position: 'absolute',
    top: 16,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 25,
  },
  activeItemIndicator: {
    width: 72,
    backgroundColor: BRAND_PRIMARY,
    borderWidth: 2,
    borderColor: BRAND_PRIMARY,
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
    backgroundColor: BRAND_PRIMARY, // Anorha green for active icon
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
  itemNavArrowMatchBadge: {
    position: 'absolute',
    top: -6,
    right: -4,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: BRAND_PRIMARY,
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
    backgroundColor: BRAND_PRIMARY,
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
    backgroundColor: BRAND_PRIMARY,
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
    borderColor: BRAND_PRIMARY,
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
    backgroundColor: BRAND_PRIMARY,
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
    backgroundColor: BRAND_PRIMARY,
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
    color: BRAND_PRIMARY,
    fontSize: 13,
    fontWeight: '600',
  },
  matchNotificationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: BRAND_PRIMARY,
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
    backgroundColor: BRAND_PRIMARY,
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
    borderColor: BRAND_PRIMARY,
    borderWidth: 2,
    backgroundColor: '#f8fff8',
  },
  activeItemLabel: {
    color: BRAND_PRIMARY,
    fontWeight: '700',
  },
  activeItemBadge: {
    backgroundColor: BRAND_PRIMARY,
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
    borderColor: BRAND_PRIMARY,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginLeft: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingBadgeText: {
    color: BRAND_PRIMARY,
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
    borderColor: BRAND_PRIMARY,
    borderWidth: 2,
  },
  coverPhotoLabel: {
    backgroundColor: BRAND_PRIMARY,
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
    backgroundColor: BRAND_PRIMARY,
    borderRadius: 2,
  },
  progressSpinner: {
    marginLeft: 12,
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unicodeSpinnerText: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    textAlign: 'center',
    includeFontPadding: false,
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
    backgroundColor: BRAND_PRIMARY,
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
    color: BRAND_PRIMARY,
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

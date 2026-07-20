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
import { BulkItemsSheet } from './AddProduct/BulkItemsSheet';
import ListingProcessingCard from './AddProduct/ListingProcessingCard';
import ListingsReadyCard from './AddProduct/ListingsReadyCard';
import { useBulkItems } from './AddProduct/hooks/useBulkItems';
import { MatchPreview, MatchPreviewData } from './AddProduct/MatchPreview';
import { AddDetailsSheet } from './AddProduct/AddDetailsSheet';
import { ShelfFolderSheet } from './AddProduct/ShelfFolderSheet';
import type { CartTreeNode } from './AddProduct/hooks/useBulkItems';
import { observable } from '@legendapp/state';
import { use$ } from '@legendapp/state/react';
import { setItemGenerate, selectItem, selectAllItems, addItemWithId, transitionItem, removeEntry, resetCart, startCartSnapshotAutosave, peekCartSnapshot, clearCartSnapshot, hydrateCartSnapshot, setItemPhotoUri, getActiveDraftSessionId, setActiveDraftSessionId, clearActiveDraftSessionId } from '../features/cart/cartStore';
import { buildGenerateDetailsLaunch } from '../features/cart/flowPayloads';
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
  AppState,
} from 'react-native';

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
// `startedAt` (ms) bounds how long we poll a job before giving up — a deploy-killed job would
// otherwise never reach a terminal status and pin the item on "Generating…" forever.
const genQueue$ = observable<Array<{ jobId: string; processType: 'generate' | 'match'; itemIds: string[]; startedAt?: number }>>([]);
// Give up polling a single generate/match job after this long without a terminal status.
const GEN_GIVE_UP_MS = 4 * 60 * 1000;

// Shelf scans can identify many items at once. Keep sold-comp enrichment bounded so
// a large shelf cannot fan out dozens of simultaneous SerpAPI requests on mobile.
const SHELF_PRICING_CONCURRENCY = 3;
const SHELF_PRICING_TIMEOUT_MS = 15_000;
type ShelfPricingJob = {
  itemId: string;
  title: string;
  token: string;
  generation: number;
};

type QuickScanRunOptions = {
  skipPreflight?: boolean;
  textHint?: string;
  mode?: 'adaptive' | 'legacy';
};

const normalizeShelfQuery = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// A job can report status 'completed' while some (or all) of its payload is empty
// (backend partial failure). Validate PER ITEM so a partial response can't mark the
// missing items as generated — those go to the retry lane, not a blank card.
const nonEmptyStr = (v: any) => typeof v === 'string' && v.trim().length > 0;
const generateResultHasContent = (r: any): boolean => {
  if (!r || r.error) return false;
  // Top-level title/description counts even when a platforms object exists but is empty.
  const topLevel =
    nonEmptyStr(r?.title) || nonEmptyStr(r?.Title) || nonEmptyStr(r?.description) || nonEmptyStr(r?.Description);
  const platforms = r?.platforms && typeof r.platforms === 'object' ? r.platforms : null;
  if (!platforms || Object.keys(platforms).length === 0) return topLevel;
  return (
    topLevel ||
    Object.values(platforms).some(
      (pv: any) =>
        pv &&
        typeof pv === 'object' &&
        (nonEmptyStr(pv.title) || nonEmptyStr(pv.Title) || nonEmptyStr(pv.name) ||
          nonEmptyStr(pv.description) || nonEmptyStr(pv.Description)),
    )
  );
};
// Results are emitted by the backend in product order (each carries productIndex), which
// matches the order itemIds were queued — so correlation is positional. If the counts
// don't line up (older backend, truncated payload), degrade to all-or-nothing on ANY
// content rather than guessing which item got which result.
function splitItemsByGeneratedContent(itemIds: string[], results: any[]): { ok: string[]; empty: string[] } {
  if (!Array.isArray(results) || results.length === 0) return { ok: [], empty: [...itemIds] };
  if (results.length === itemIds.length) {
    const ok: string[] = [];
    const empty: string[] = [];
    itemIds.forEach((id, i) => (generateResultHasContent(results[i]) ? ok : empty).push(id));
    return { ok, empty };
  }
  const any = results.some(generateResultHasContent);
  return any ? { ok: [...itemIds], empty: [] } : { ok: [], empty: [...itemIds] };
}
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

const MAX_DOCUMENT_PHOTOS = 12;
const DOCUMENT_IMAGE_MAX_DIMENSION = 1600;

const encodeDocumentPhotosSequentially = async (
  photos: CapturedPhoto[],
  filenamePrefix: 'page' | 'receipt',
): Promise<Array<{ base64: string; filename: string }>> => {
  const images: Array<{ base64: string; filename: string }> = [];

  for (let index = 0; index < photos.length; index += 1) {
    const photo = photos[index];
    try {
      const width = photo.width || 0;
      const height = photo.height || 0;
      const resizeAction = Math.max(width, height) > DOCUMENT_IMAGE_MAX_DIMENSION
        ? [{ resize: width >= height
          ? { width: DOCUMENT_IMAGE_MAX_DIMENSION }
          : { height: DOCUMENT_IMAGE_MAX_DIMENSION } }]
        : [];
      const resized = await ImageManipulator.manipulateAsync(
        photo.uri,
        resizeAction,
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG },
      );
      const base64 = await FileSystem.readAsStringAsync(resized.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      images.push({ base64, filename: `${filenamePrefix}_${index + 1}.jpg` });
    } catch (error) {
      log.error(`[${filenamePrefix.toUpperCase()}] Failed to encode photo:`, error);
    }
  }

  return images;
};
import { Camera as CameraIcon, RotateCcw } from 'lucide-react-native';

import { useNavigation, useRoute, useIsFocused, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { SvgXml } from 'react-native-svg';
import { useSuppressSwipeBackWhen, publishBackButtonRect } from '../components/SwipeBackContext';
import { backWithOrigin } from '../navigation/backWithOrigin';
import { CapturedPhoto } from '../components/camera/PhotoStack';
import ViewPhotosModal from '../components/camera/ViewPhotosModal';
import CameraControls from '../components/camera/CameraControls';
import BusinessTemplateModal, { BusinessTemplate } from '../components/camera/BusinessTemplateModal';
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
import { notifyListingReady } from '../utils/localNotify';
import { openQuickScanStream, QuickScanPhase, QuickScanStreamEvent } from '../lib/quickScanStream';
import { ShelfScanPlaceholderRow } from '../components/camera/ShelfScanProgressCard';
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
// Best human label we can infer for a scanned item from its match results, so saved scans
// aren't all "Unidentified item" in history — this is what lets the seller (and the agent)
// tell which scan is which. Only fills a missing/placeholder title; never overwrites a real one.
const inferScanItemTitle = (item: any, matchContext: Record<string, any> | undefined): string | undefined => {
  const existing = typeof item?.title === 'string' ? item.title.trim() : '';
  if (existing && existing.toLowerCase() !== 'unidentified item') return existing;
  const entry = matchContext?.[item?.id];
  const md = entry?.matchData ?? entry?.match?.response ?? entry?.response ?? entry;
  const confirmedTitle = entry?.confirmed?.title || entry?.match?.confirmed?.title || md?.confirmed?.title;
  const candidates = md?.rankedCandidates ?? md?.candidates ?? md?.results;
  const candidateTitle = Array.isArray(candidates) ? candidates[0]?.title : undefined;
  const best = String(confirmedTitle || candidateTitle || '').trim();
  return best || (existing || undefined);
};

const labelScannedItems = (scannedItems: any[], matchContext: Record<string, any> | undefined): any[] =>
  (scannedItems || []).map((it) => {
    const title = inferScanItemTitle(it, matchContext);
    return title && title !== it?.title ? { ...it, title } : it;
  });

// Only persist photos with a durable remote URL. A capture starts as a device-local
// file:// path and is swapped to the uploaded Supabase URL asynchronously; the 800ms
// draft autosave can fire BEFORE that swap lands. iOS purges Library/Caches and rotates
// the app-container UUID, so a persisted file:// path is dead on reopen — that's the
// "image is gone on the research page / in the scan draft" bug. Drop local-only photos
// from the persisted payload; the autosave that re-fires when the upload swaps the URI
// (bulkItems changes) then persists the real https URL. Live in-session state is untouched.
const isDurableUrl = (uri: unknown): boolean => /^https?:\/\//i.test((uri ?? '').toString());

const stripLocalOnlyPhotos = (scannedItems: any[]): any[] =>
  (scannedItems || []).map((it) =>
    it && Array.isArray(it.photos)
      ? { ...it, photos: it.photos.filter((ph: any) => isDurableUrl(ph?.uri)) }
      : it,
  );

const toQuickScanSessionBody = (p: {
  scannedItems: any[];
  matchContext: Record<string, any>;
  shelfPhotoUri?: string | null;
  activeItemId?: string | null;
  itemStageById?: Record<string, ItemStage>;
  processedItemIds?: string[];
}) => ({
  scannedItems: stripLocalOnlyPhotos(labelScannedItems(p.scannedItems, p.matchContext)),
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
  | 'needs_review'
  | 'inventory_dedup';
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
        title: progress.completedItems > 0 ? `${progress.completedItems} found` : 'Finding items…',
        subtitle: 'Items appear as found.',
        instruction: 'searching' as CameraInstruction,
      };
    case 'finishing':
      return {
        title: progress.completedItems > 0 ? `${progress.completedItems} found` : 'Finding items…',
        subtitle: 'Finishing scan.',
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
  store?: { matchData: MatchResponse; matchRows: any[] } | null,
) => {
  if (matchInfo && Array.isArray(matchInfo.matchRows) && matchInfo.preSelectedIndices?.length) {
    const selectedIndex = matchInfo.preSelectedIndices[0];
    return {
      candidate: matchInfo.matchRows[selectedIndex] ?? null,
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
  quickScanStore: Record<string, { matchData: MatchResponse; matchRows: any[] }>,
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

  return quickScanStore[itemId]?.matchRows?.find((candidate: any) => candidate?.isLocalMatch) ?? null;
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
  // Re-measure the back button whenever the screen regains focus. This tab stays MOUNTED,
  // so onLayout doesn't re-fire when arriving from the chat cart card — and a single
  // measure taken mid-transition (or before the deep-search sheet settles) is what left
  // the ring "randomly placed" when entering from chat. Re-measure across a few frames
  // once focused so the anchor always reflects the button's real resting position.
  useFocusEffect(
    useCallback(() => {
      const measure = () =>
        backButtonRef.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
          if (w && h) publishBackButtonRect({ x, y, width: w, height: h });
        });
      const raf = requestAnimationFrame(measure);
      const t1 = setTimeout(measure, 250);
      const t2 = setTimeout(measure, 650);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }, []),
  );
  const saveDraftTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftSessionCreatePromiseRef = useRef<Promise<string | null> | null>(null);
  const hasAutoOpenedFtuxRef = useRef(false);

  log.debug('[RENDER] AddProductScreen rendered');

  // Camera state
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);

  // Inline "add a photo" camera overlay (replaces the OS gallery as the primary add-photo
  // path): a self-contained full-screen capture that targets one item, takes one shot,
  // attaches it (re-running the full match), then returns to wherever the user was. Its own
  // CameraView so it never fights the paused persistent camera / Fabric unmount asserts.
  const [photoCaptureTargetId, setPhotoCaptureTargetId] = useState<string | null>(null);
  const captureOverlayRef = useRef<CameraView>(null);
  const [overlayFacing, setOverlayFacing] = useState<CameraType>('back');
  const [overlayFlash, setOverlayFlash] = useState<FlashMode>('off');
  const [isOverlayCapturing, setIsOverlayCapturing] = useState(false);
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
  // Items that strongly matched something the user already owns → the Update-vs-Add-new prompt.
  // Keyed by itemId so it works for single scans and per-item in shelf/multi. fallbackInstruction
  // is the verdict the banner would otherwise show, restored when the user picks "Add as new".
  const [inventoryDedupByItemId, setInventoryDedupByItemId] = useState<Record<string, { match: any; fallbackInstruction: CameraInstruction }>>({});
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
  const [isAdaptiveShelfScan, setIsAdaptiveShelfScan] = useState(false);
  const [shelfProgress, setShelfProgress] = useState<ShelfProgressState>(
    () => __ds === 'shelfScanning' ? dsShelfProgress('streaming')
      : __ds === 'shelfComplete' ? dsShelfProgress('completed')
        : initialShelfProgressState()
  );
  const shelfScanStreamRef = useRef<ReturnType<typeof openQuickScanStream> | null>(null);
  const quickScanStreamRef = useRef<ReturnType<typeof openQuickScanStream> | null>(null);
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
        if (cancelled) return;
        if (!res.ok) {
          // Never dead-end silently: the seller tapped a cart card and got
          // NOTHING, which reads as "the cart is broken". Say what happened.
          log.warn(`[AddProduct] Hydrate draft ${sessionIdParam} failed: ${res.status}`);
          Alert.alert(
            res.status === 404 ? 'Cart not found' : 'Could not open cart',
            res.status === 404
              ? 'This cart was deleted or already converted to inventory. Start a new scan to research more items.'
              : 'The cart could not load. Check your connection and try again.',
          );
          return;
        }
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
          if (sessionIdRef.current) void setActiveDraftSessionId(sessionIdRef.current);
          if (shelfUri) shelfPhotoUriForDraftRef.current = shelfUri;
        } else if (!cancelled) {
          // The session row exists but carries no items (items were dropped on
          // save, or the draft was emptied). Tell the seller instead of doing
          // nothing — the silent version of this was the "dead cart" bug.
          log.warn(`[AddProduct] Hydrated draft ${sessionIdParam} has no items`);
          Alert.alert(
            'Cart is empty',
            'This saved cart has no items in it anymore. Scan or snap the items again to rebuild it.',
          );
        }
      } catch (e) {
        log.error('[AddProduct] Hydrate draft failed:', e);
      } finally {
        if (!cancelled) isHydratingRef.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [sessionIdParam]);

  // Reuse the cart's existing backend draft across remounts. The cart snapshot survives
  // a remount but sessionIdRef doesn't, so without this each remount of a resumed cart
  // POSTs a brand-new draft row for the same items (the sprawl). Seed the ref from the
  // durable id before any save fires. An explicit resume (sessionIdParam) sets its own.
  useEffect(() => {
    if (sessionIdParam) return;
    let cancelled = false;
    (async () => {
      const stored = await getActiveDraftSessionId();
      if (!cancelled && stored && !sessionIdRef.current) sessionIdRef.current = stored;
    })();
    return () => { cancelled = true; };
  }, [sessionIdParam]);

  // Save a cart the moment it has ≥1 item — no matter what — so it's always resumable from
  // any point; photos (once uploaded) and research fill in on later autosaves. The only
  // thing we refuse to create is a row for a totally empty cart (0 items). Existing drafts
  // always update (even down to 0 items), so removals persist too.
  const draftHasItems = useCallback((payload: { scannedItems: any[] }): boolean =>
    Array.isArray(payload.scannedItems) && payload.scannedItems.length > 0, []);

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
        void setActiveDraftSessionId(newSessionId);
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
      const putOnce = (sid: string) => fetch(`${API_BASE}/api/products/quick-scan-sessions/${sid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(toQuickScanSessionBody(payload)),
      });

      let sid = sessionIdRef.current;
      if (!sid) {
        // Create the draft as soon as the cart has ≥1 item so nothing is ever lost; only a
        // totally empty cart (0 items) is skipped.
        if (!draftHasItems(payload)) return;
        sid = await ensureDraftSessionId(payload);
      }
      if (!sid) return;

      const res = await putOnce(sid);
      // The row is gone (stale durable id, e.g. deleted in a cleanup) → drop it and recreate
      // once, so a dead id never silently swallows saves. Only on 404 — a transient 5xx must
      // NOT spawn a duplicate.
      if (res.status === 404 && sessionIdRef.current === sid) {
        sessionIdRef.current = null;
        await clearActiveDraftSessionId();
        if (draftHasItems(payload)) {
          const fresh = await ensureDraftSessionId(payload);
          if (fresh) await putOnce(fresh);
        }
      }
    } catch (e) {
      log.warn('[AddProduct] Save draft failed:', e);
    }
  }, [ensureDraftSessionId, draftHasItems]);

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
    cartTree, createShelfFolder, addShelfItemsToFolder, ungroupFolder,
    savedForLaterIds, setItemSavedForLater,
  } = useBulkItems(() => ({
    bulkItems: __dsHasItems ? (dsBuildItems() as any) : [],
    activeItemId: __dsHasItems ? 'ds-1' : null,
    itemStageById: params?.itemStageById || {},
    processedItemIds: params?.processedItemIds || [],
  }));

  // Live mirror of bulkItems for callbacks (performQuickScan / stream handlers) that must read
  // the CURRENT items without taking bulkItems as a dependency. Used to skip writing scan
  // results for an item the user deleted mid-match (avoids resurrecting orphaned store entries).
  const bulkItemsRef = useRef(bulkItems);
  bulkItemsRef.current = bulkItems;

  // Map the previewed cart item (photo + confirmed/quick match + pricing) into the MatchPreview shape.
  const previewData = useMemo<MatchPreviewData | undefined>(() => {
    if (!previewItemId) return undefined;
    const item = bulkItems.find((b) => b.id === previewItemId);
    const photoUri = item?.photos?.find((p) => p.isCover)?.uri || item?.photos?.[0]?.uri;
    const qs = quickScanStore[previewItemId];
    const confirmed = confirmedQuickMatchByItemId[previewItemId];
    const candidates = qs?.matchData?.rankedCandidates || [];
    const chosenIdx = confirmed?.preSelectedIndices?.[0] ?? 0;
    const matchedCandidate: any = candidates[chosenIdx] || candidates[0];
    const chosen: any =
      (confirmed?.matchRows && confirmed.matchRows[chosenIdx]) || matchedCandidate;
    // pricingResearch (the instant livePricing seed AND the enriched sold comps) is stored on the
    // matchData ranked candidate — NOT on confirmed.matchRows. For an AUTO-CONFIRMED match `chosen`
    // is the confirmed entry, which has no pricingResearch → without this fallback pricingLoading
    // stays true forever ("Finding comps…" that never resolves, even though the price is right here).
    const pr: any = chosen?.pricingResearch ?? matchedCandidate?.pricingResearch ?? candidates[0]?.pricingResearch;
    return {
      photoUri,
      title: chosen?.title || item?.title || 'Item',
      description: chosen?.description,
      // Match chosen but pricing not yet stored → still researching ("Finding comps…").
      pricingLoading: !!chosen && pr === undefined,
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

  const currentShelfFolder = useMemo(() => {
    const folders = cartTree.filter((node): node is Extract<CartTreeNode, { kind: 'folder' }> => node.kind === 'folder');
    if (folders.length === 0) return undefined;
    return [...folders].reverse().find((folder) => folder.sourcePhotoUri === shelfPhotoUri) || folders[folders.length - 1];
  }, [cartTree, shelfPhotoUri]);
  const currentShelfItemCount = currentShelfFolder?.childCount || 0;

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
      'dev-single-1': { matchData: { systemAction: 'show_single_match', confidence: 'high', totalMatches: 1, rankedCandidates: [{ id: 'h1', title: 'Sony WH-1000XM5 Wireless Headphones', price: 248, imageUrl: 'https://picsum.photos/seed/sonym/120' } as any] }, matchRows: [] },
      'dev-single-2': { matchData: { systemAction: 'show_single_match', confidence: 'high', totalMatches: 1, rankedCandidates: [{ id: 'sw1', title: 'Nintendo Switch OLED', price: 299, imageUrl: 'https://picsum.photos/seed/switchm/120' } as any] }, matchRows: [] },
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
      const byJob = new Map<string, { jobId: string; processType: 'generate' | 'match'; itemIds: string[]; startedAt: number }>();
      for (const { itemId, jobId, processType } of itemJobs) {
        const key = `${processType}:${jobId}`;
        if (!byJob.has(key)) byJob.set(key, { jobId, processType, itemIds: [], startedAt: Date.now() });
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
    let inFlight = false; // dedup: don't stack overlapping polls if a tick runs >1.5s
    let interval: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
      const token = await ensureSupabaseJwt();
      if (!token || cancelled) return;
      for (const job of genJobs) {
        // Age-based give-up: a job (e.g. killed by a backend deploy) can poll forever
        // without a terminal status. Applied only AFTER a status check — polling pauses
        // while backgrounded, so an old startedAt alone doesn't mean the job didn't
        // complete while the app was suspended; a terminal status always wins.
        const expired = !!job.startedAt && Date.now() - job.startedAt > GEN_GIVE_UP_MS;
        const giveUp = () => {
          const msg = 'Generation is taking too long — retry';
          job.itemIds.forEach((id) => transitionItem(id, 'error', { error: msg }));
          setItemLoadingStates((prev) => { const n = { ...prev }; job.itemIds.forEach((id) => { n[id] = { isLoading: false, stage: 'Timed out', error: msg }; }); return n; });
          genQueue$.set(genQueue$.get().filter((j) => !(j.jobId === job.jobId && j.processType === job.processType)));
        };
        try {
          const base = job.processType === 'generate'
            ? `${API_BASE_URL}/api/products/generate/jobs/`
            : `${API_BASE_URL}/api/products/match/jobs/`;
          const res = await fetch(`${base}${encodeURIComponent(job.jobId)}/status`, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          });
          if (cancelled) continue;
          if (!res.ok) { if (expired) giveUp(); continue; }
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
                  ? { jobId: autoGenId, processType: 'generate' as const, itemIds: job.itemIds, startedAt: Date.now() }
                  : j));
            } else {
              // Per-item verdicts: a partially-empty payload sends only the missing
              // items to the retry lane instead of blank "generated" cards (or, worse,
              // failing the items that DID generate).
              const { ok, empty } = splitItemsByGeneratedContent(job.itemIds, results);
              if (empty.length > 0) {
                const msg = 'Couldn’t generate details';
                empty.forEach((id) => transitionItem(id, 'error', { error: msg }));
                setItemLoadingStates((prev) => { const n = { ...prev }; empty.forEach((id) => { n[id] = { isLoading: false, stage: 'Failed', error: msg }; }); return n; });
              }
              if (ok.length > 0) {
                setItemLoadingStates((prev) => { const n = { ...prev }; ok.forEach((id) => delete n[id]); return n; });
                setItemStageById((prev) => { const n = { ...prev }; ok.forEach((id) => { n[id] = 'generated'; }); return n; });
                // State machine: draft generated → awaiting per-item finalize.
                ok.forEach((id) => transitionItem(id, 'ready_to_list'));
                // Listing(s) ready — if the seller has left this screen (other tab) or the app
                // isn't active, fire a local "ready" notification. (Fully backgrounded/killed
                // delivery needs a backend push; the poll is paused while suspended.)
                if (!isFocusedRef.current || AppState.currentState !== 'active') {
                  void notifyListingReady(ok.length);
                }
              }
              genQueue$.set(genQueue$.get().filter((j) => !(j.jobId === job.jobId && j.processType === job.processType)));
            }
          } else if (status === 'failed') {
            setItemLoadingStates((prev) => { const n = { ...prev }; job.itemIds.forEach((id) => { n[id] = { isLoading: false, stage: 'Failed', error: snap?.error || 'Generation failed' }; }); return n; });
            job.itemIds.forEach((id) => transitionItem(id, 'error', { error: snap?.error || 'Generation failed' }));
            genQueue$.set(genQueue$.get().filter((j) => !(j.jobId === job.jobId && j.processType === job.processType)));
          } else if (expired) {
            // Still non-terminal past the deadline — NOW the give-up is justified.
            giveUp();
          } else {
            const stage = snap?.currentStage || 'Generating…';
            setItemLoadingStates((prev) => { const n = { ...prev }; job.itemIds.forEach((id) => { n[id] = { isLoading: true, stage }; }); return n; });
          }
        } catch {
          // Transient fetch error — keep polling, unless the job is already past the
          // deadline and its status is unknowable; then stop spinning.
          if (expired) giveUp();
        }
      }
      } finally {
        inFlight = false;
      }
    };
    const startInterval = () => {
      if (!interval && !cancelled) interval = setInterval(() => { void poll(); }, 1500);
    };
    const stopInterval = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    void poll();
    startInterval();
    // Pause polling while the app is backgrounded; resume + poll immediately on foreground.
    let prevAppState = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const wasBackground = /inactive|background/.test(prevAppState);
      prevAppState = next;
      if (next === 'active') { startInterval(); if (wasBackground) void poll(); }
      else if (/inactive|background/.test(next)) stopInterval();
    });
    return () => {
      cancelled = true;
      stopInterval();
      sub.remove();
    };
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
        if (id && text) researchItemWithText(id, text);
      }}
      onAddPhoto={() => {
        // Inline in-app camera (not the OS gallery) targeting this item — a plain gallery
        // add: it does NOT re-run the match (rescan defaults false) unless it's the item's
        // first/cover photo. Keep previewItemId so we land back.
        if (previewItemId) openPhotoCaptureForItem(previewItemId);
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
            [id]: { matchRows: candidates, preSelectedIndices: [0], source: 'quick_scan_confirmed' },
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
          // Inline camera overlay ON TOP of this sheet (no cart teardown, no Fabric unmount
          // race): captures one tag shot and re-runs the full match for this item (explicit
          // correction → rescan), then returns.
          openPhotoCaptureForItem(id, { rescan: true });
        }}
        onImportTag={() => {
          // Gallery import stays as the explicit "Import" action; targets this item + re-matches.
          handleImageUpload(id);
        }}
        onContinue={(detail) => {
          setAddDetailsItemId(null);
          if (detail) {
            const newQuery = [baseTitle, detail].filter(Boolean).join(' ');
            setBulkItems((prev) => prev.map((b) => (b.id === id ? { ...b, title: newQuery } : b)));
            setPreviewItemId(null); // back to the cart row so they watch the re-search land
            researchItemWithText(id, newQuery);
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
        inventoryMatchByItemId={inventoryDedupByItemId}
        shelfPricingPendingByItemId={shelfPricingPendingByItemId}
        onBack={() => setOpenFolderId(null)}
        onUngroup={() => {
          if (openFolderId) ungroupFolder(openFolderId);
          setOpenFolderId(null);
        }}
        onOpenItemPreview={handleOpenItem}
        onOpenLocalMatch={openExistingInventoryMatch}
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
                  matchRows: rankedCandidatesToQuickMatchHintCandidates(qs.matchData.rankedCandidates),
                  preSelectedIndices: [0],
                  source: 'quick_scan_confirmed',
                };
              }
            }
            return next;
          });
          if (openFolderId) ungroupFolder(openFolderId); // dissolve the folder → items become top-level cart singles
          showNotificationMessage(`${folder.children.length} item${folder.children.length === 1 ? '' : 's'} added to cart`);
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
  // Concurrency guard for performQuickScan. MUST be a ref, not the state above: handlers
  // capture performQuickScan by identity, and a stale closure reading isAutoScanning=true
  // after the scan finished queues follow-up scans that nothing ever drains (item stuck
  // on "Searching…", every later upload wedged behind it).
  const isAutoScanningRef = useRef(false);
  const [quickScanResults, setQuickScanResults] = useState<any[]>([]);

  // Job response state
  const [jobResponse, setJobResponse] = useState<JobResponse | null>(null);
  const quickScanCancelledRef = useRef(false);
  const quickScanQueueRef = useRef<Array<{ photo: CapturedPhoto; itemId: string; options?: QuickScanRunOptions }>>([]);
  const shelfQueryToItemIdRef = useRef<Record<string, string>>({});
  const activeShelfFolderIdRef = useRef<string | null>(null);
  const pendingShelfItemsByIdRef = useRef<Record<string, { id: string; title: string; quantity: number; added: boolean }>>({});
  const shelfPricingQueueRef = useRef<ShelfPricingJob[]>([]);
  const shelfPricingActiveRef = useRef(0);
  const shelfPricingGenerationRef = useRef(0);
  const [shelfPricingPendingByItemId, setShelfPricingPendingByItemId] = useState<Record<string, boolean>>({});
  const shelfPricingAbortControllersRef = useRef<Map<string, AbortController>>(new Map());
  const shelfPricingPumpRef = useRef<() => void>(() => {});
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

  const runShelfPricingJob = useCallback(async (job: ShelfPricingJob) => {
    if (job.generation !== shelfPricingGenerationRef.current) return;

    const abortController = new AbortController();
    shelfPricingAbortControllersRef.current.set(job.itemId, abortController);
    const timeout = setTimeout(() => abortController.abort(), SHELF_PRICING_TIMEOUT_MS);
    let priceData: any;

    try {
      const cleanedTitle = job.title.replace(/\s*[|—–-]\s*(eBay|Amazon|Walmart|Etsy|Target)\s*$/i, '').trim();
      const response = await fetch(`${API_BASE_URL}/api/ebay/pricing-research`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${job.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cleanedTitle, condition: 'new', limit: 20 }),
        signal: abortController.signal,
      });
      priceData = response.ok
        ? await response.json()
        : { low: null, median: null, high: null, recommended: null, samples: [], error: 'request_failed' };
    } catch (error: any) {
      priceData = {
        low: null,
        median: null,
        high: null,
        recommended: null,
        samples: [],
        error: error?.name === 'AbortError' ? 'pricing_timed_out' : 'request_failed',
      };
    } finally {
      clearTimeout(timeout);
      if (shelfPricingAbortControllersRef.current.get(job.itemId) === abortController) {
        shelfPricingAbortControllersRef.current.delete(job.itemId);
      }
    }

    // A retake/new shelf invalidates every queued response from the prior scan.
    if (job.generation !== shelfPricingGenerationRef.current) return;

    setQuickScanStore((prev) => {
      const current = prev[job.itemId];
      if (!current?.matchData?.rankedCandidates?.length) return prev;
      const candidates = [...current.matchData.rankedCandidates];
      const firstCandidate: any = candidates[0];
      const existingPricing = firstCandidate?.pricingResearch;
      const recommended = Number(priceData?.recommended ?? priceData?.median ?? priceData?.low ?? 0);
      const nextPricing = priceData?.error && existingPricing
        ? { ...existingPricing, soldCompsError: priceData.error }
        : priceData;

      candidates[0] = {
        ...firstCandidate,
        price: (typeof firstCandidate?.price === 'number' && firstCandidate.price > 0)
          ? firstCandidate.price
          : (Number.isFinite(recommended) && recommended > 0 ? recommended : firstCandidate?.price),
        // Even an empty/error response is stored. MatchPreview uses undefined to mean
        // "still loading", so this guarantees the spinner always terminates.
        pricingResearch: nextPricing,
      };

      return {
        ...prev,
        [job.itemId]: {
          ...current,
          matchData: { ...current.matchData, rankedCandidates: candidates },
        },
      };
    });
    setShelfPricingPendingByItemId((prev) => {
      if (!prev[job.itemId]) return prev;
      return { ...prev, [job.itemId]: false };
    });
  }, [setQuickScanStore]);

  const pumpShelfPricingQueue = useCallback(() => {
    while (
      shelfPricingActiveRef.current < SHELF_PRICING_CONCURRENCY
      && shelfPricingQueueRef.current.length > 0
    ) {
      const job = shelfPricingQueueRef.current.shift();
      if (!job) break;
      shelfPricingActiveRef.current += 1;
      void runShelfPricingJob(job).finally(() => {
        shelfPricingActiveRef.current = Math.max(0, shelfPricingActiveRef.current - 1);
        shelfPricingPumpRef.current();
      });
    }
  }, [runShelfPricingJob]);
  shelfPricingPumpRef.current = pumpShelfPricingQueue;

  const enqueueShelfPricingResearch = useCallback((job: ShelfPricingJob) => {
    // A repeated event for the same item replaces its still-queued job instead of
    // spending another sold-comps request.
    shelfPricingQueueRef.current = shelfPricingQueueRef.current.filter(
      (queued) => queued.itemId !== job.itemId,
    );
    setShelfPricingPendingByItemId((prev) => ({ ...prev, [job.itemId]: true }));
    shelfPricingQueueRef.current.push(job);
    shelfPricingPumpRef.current();
  }, []);

  const cancelShelfPricingResearch = useCallback(() => {
    shelfPricingGenerationRef.current += 1;
    shelfPricingQueueRef.current = [];
    for (const controller of shelfPricingAbortControllersRef.current.values()) controller.abort();
    shelfPricingAbortControllersRef.current.clear();
    setShelfPricingPendingByItemId({});
  }, []);

  const resetShelfProgress = useCallback(() => {
    setShelfProgress(initialShelfProgressState());
  }, []);

  const resetShelfScanResults = useCallback(() => {
    cancelShelfPricingResearch();
    if (activeShelfFolderIdRef.current) {
      removeEntry(activeShelfFolderIdRef.current);
      activeShelfFolderIdRef.current = null;
    }
    shelfQueryToItemIdRef.current = {};
    pendingShelfItemsByIdRef.current = {};
    setBulkItems([]);
    setQuickScanStore({});
    setConfirmedQuickMatchByItemId({});
    setItemLoadingStates({});
    setActiveItemId(null);
  }, [cancelShelfPricingResearch, setActiveItemId, setBulkItems, setConfirmedQuickMatchByItemId, setQuickScanStore]);

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
      cancelShelfPricingResearch();
    };
  }, [cancelShelfPricingResearch, closeShelfScanStream]);

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
    isAutoScanningRef.current = false;
    setIsAutoScanning(false);
    setShowProgressBar(false);
    quickScanCancelledRef.current = true;
    quickScanQueueRef.current = [];
    quickScanStreamRef.current?.close();
    quickScanStreamRef.current = null;
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
  // When the camera preview last became ready (onCameraReady). handleCapture waits
  // out the sensor's exposure/focus ramp from this point so the FIRST frame after a
  // cold start isn't the dark/unfocused capture that made first scans misfire.
  const cameraReadyAtRef = useRef(0);
  const isFocused = useIsFocused();

  // "Creating your listings" → "Ready to review" card flow (post-checkout).
  const [creatingListings, setCreatingListings] = useState<{ photoUri?: string | null; count: number } | null>(null);
  const [listingsReady, setListingsReady] = useState<{ count: number } | null>(null);
  // "Done" hides the processing CARD but creation keeps running (so the ready card +
  // notification still fire) — so we track dismissal separately from the creation state.
  const [processingCardDismissed, setProcessingCardDismissed] = useState(false);
  const listingsReadyShownRef = useRef(false);
  const sawCreationLoadingRef = useRef(false);

  // Once creation has actually started loading and then settled, swap the "Creating…" card
  // for the "Ready to review" card (only if the seller is still here — the notification
  // covers the away case). The sawLoading guard avoids firing before loading is observed.
  useEffect(() => {
    if (!creatingListings) { listingsReadyShownRef.current = false; sawCreationLoadingRef.current = false; return; }
    const anyLoading = Object.values(itemLoadingStates || {}).some((s) => s?.isLoading);
    if (anyLoading) { sawCreationLoadingRef.current = true; return; }
    if (sawCreationLoadingRef.current && !listingsReadyShownRef.current) {
      listingsReadyShownRef.current = true;
      const anyGenerated = Object.values(itemStageById || {}).some((s) => s === 'generated');
      const count = creatingListings.count;
      setCreatingListings(null);
      if (anyGenerated && isFocusedRef.current && AppState.currentState === 'active') {
        setListingsReady({ count });
      }
    }
  }, [itemLoadingStates, itemStageById, creatingListings]);
  isFocusedRef.current = isFocused;

  // ── Resume where you left off (ASK, don't silently restore) ─────────────────
  // The cart is persisted locally (autosave, armed only AFTER the resume decision so it
  // can't clobber the saved snapshot before we read it). On first entry, if there's an
  // unfinished session — in-memory items or a saved snapshot — we PROMPT Resume / Start
  // fresh instead of silently restoring (or silently losing) it.
  const resumeHandledRef = useRef(false);
  const [resumePrompt, setResumePrompt] = useState<{ count: number; source: 'memory' | 'snapshot' } | null>(null);
  const [snapshotArmed, setSnapshotArmed] = useState(false);

  useEffect(() => {
    if (!snapshotArmed) return;
    const dispose = startCartSnapshotAutosave();
    return dispose;
  }, [snapshotArmed]);

  useFocusEffect(
    useCallback(() => {
      if (resumeHandledRef.current) return;
      // Explicit resume from Past Scans — the tap WAS the choice, no prompt.
      if (sessionIdParam) { resumeHandledRef.current = true; setSnapshotArmed(true); return; }
      let cancelled = false;
      (async () => {
        const inMem = selectAllItems().length;
        if (inMem > 0) {
          if (cancelled) return;
          resumeHandledRef.current = true;
          setResumePrompt({ count: inMem, source: 'memory' });
          return;
        }
        const snap = await peekCartSnapshot();
        if (cancelled) return;
        resumeHandledRef.current = true;
        if (snap && snap.count > 0) {
          setResumePrompt({ count: snap.count, source: 'snapshot' });
        } else {
          setSnapshotArmed(true); // nothing to resume → start persisting from here
        }
      })();
      return () => { cancelled = true; };
    }, [sessionIdParam])
  );

  useEffect(() => {
    if (!resumePrompt) return;
    const n = resumePrompt.count;
    Alert.alert(
      'Resume where you left off?',
      `You have ${n} item${n === 1 ? '' : 's'} in progress.`,
      [
        // "Start fresh" clears the current in-memory cart and its durable session id so the
        // NEXT cart gets its own draft — the old draft is KEPT (resumable from Scan carts).
        { text: 'Start fresh', style: 'destructive', onPress: () => { sessionIdRef.current = null; resetCart(); void clearCartSnapshot(); setResumePrompt(null); setSnapshotArmed(true); } },
        { text: 'Resume', onPress: () => { if (resumePrompt.source === 'snapshot') { void hydrateCartSnapshot(); } setResumePrompt(null); setSnapshotArmed(true); } },
      ],
      { cancelable: false },
    );
  }, [resumePrompt]);

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

  const persistPendingQuickScan = useCallback(async (photo: CapturedPhoto, itemId: string, scanMode?: QuickScanRunOptions['mode']) => {
    const pendingAction: PendingBillingAction = {
      type: 'quick_scan',
      featureKey: 'ai_quick_scan',
      itemId,
      scanMode,
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

  // Transform quick-scan ranked candidates to matchRows for MatchSelection overrides
  const candidatesToMatchRows = useCallback((candidates: Array<{
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
      if ((cameraMode === 'shelf' || isAdaptiveShelfScan) && shelfProgress.status !== 'idle') {
        return getShelfProgressPresentation(shelfProgress).title;
      }
      if (instruction === 'matches_found' || instruction === 'matched') return 'Matched';
      if (instruction === 'needs_review') return 'Add a detail';
      if (instruction === 'inventory_dedup') return 'Already in inventory';
      if (instruction === 'no_matches') return 'Needs review';
      if (
        instruction === 'processing' ||
        instruction === 'analyzing' ||
        instruction === 'extracting' ||
        instruction === 'optimizing' ||
        instruction === 'searching' ||
        instruction === 'recognizing'
      ) {
        return cameraMode === 'shelf' || isAdaptiveShelfScan ? 'Finding items…' : 'Recognizing';
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

  // The center overlay reflects the item the user is LOOKING AT, not the global scan
  // machine: swapping to (or creating) an item that isn't scanning must not keep showing
  // another item's "Searching for your item…" state. No active item (pre-first-photo,
  // shelf/adaptive folder streaming) keeps the global instruction.
  const SCAN_INSTRUCTION_SET = ['processing', 'analyzing', 'extracting', 'optimizing', 'searching', 'recognizing'];
  const activeItemScanning = !activeItemId || !!itemLoadingStates[activeItemId]?.isLoading;
  const overlayInstruction = (!activeItemScanning && SCAN_INSTRUCTION_SET.includes(currentInstruction))
    ? 'ready'
    : currentInstruction;

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

    if ((cameraMode === 'manifest' || cameraMode === 'receipt')) {
      const documentPhotoCount = bulkItems.reduce((count, item) => count + item.photos.length, 0);
      if (documentPhotoCount >= MAX_DOCUMENT_PHOTOS) {
        Alert.alert('Photo limit', '12 photo max');
        return;
      }
    }

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

      // Let the sensor finish ramping exposure/focus before grabbing the frame.
      // A cold camera (new item / just returned to the screen) hands back a dark,
      // unfocused first frame — the root of "first photo is garbage, second works".
      const CAMERA_SETTLE_MS = 650;
      const readyAt = cameraReadyAtRef.current;
      const sinceReady = readyAt > 0 ? Date.now() - readyAt : 0; // not-yet-ready → wait full settle
      if (sinceReady < CAMERA_SETTLE_MS) {
        await new Promise((r) => setTimeout(r, CAMERA_SETTLE_MS - sinceReady));
      }

      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.7,
        base64: false,
      });

      if (photo) {
        const quickScanOptions: QuickScanRunOptions | undefined = cameraMode === 'camera'
          ? { mode: 'adaptive' }
          : undefined;
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
              performQuickScan(newPhoto, firstItem.id, quickScanOptions);
            }, 500);

          } else {
            // Use current state (prev) to avoid stale closures. Prefer active item by isActive flag.
            setBulkItems(prev => {
              if (prev.length === 0) {
                // First item
                const firstId = `item-${Date.now()}`;
                setActiveItemId(firstId);
                setTimeout(() => performQuickScan(newPhoto, firstId, quickScanOptions), 500);
                return [{ id: firstId, photos: [newPhoto], title: undefined, isActive: true }];
              }

              const activeIndex = prev.findIndex(it => it.isActive);
              if (activeIndex >= 0) {
                const activeItemIdLocal = prev[activeIndex].id;
                const wasEmpty = prev[activeIndex].photos.length === 0;
                const next = prev.map((it, idx) => {
                  if (idx !== activeIndex) return it;
                  // First photo of the item is its cover; later snaps are gallery shots.
                  const updated = { ...it, photos: [...it.photos, wasEmpty ? { ...newPhoto, isCover: true } : newPhoto] };
                  // Scan ONLY on the cover (first) photo. Adding more gallery photos to an
                  // already-scanned item must NOT each fire a full (billable ~15s) re-match —
                  // re-check happens when the COVER changes (setBulkItemCoverPhoto), not per add.
                  if (wasEmpty) setTimeout(() => performQuickScan(newPhoto, activeItemIdLocal, quickScanOptions), 500);
                  return updated;
                });
                return next;
              }

              // No active item flagged; create a new active item
              if (!canAddAnotherItem(prev.length)) {
                if (prev[0]) {
                  const fallbackId = prev[0].id;
                  const wasEmpty = prev[0].photos.length === 0;
                  setActiveItemId(fallbackId);
                  // Scan only when this is the item's cover (first) photo — not a gallery add.
                  if (wasEmpty) setTimeout(() => performQuickScan(newPhoto, fallbackId, quickScanOptions), 500);
                  return prev.map((it, idx) => {
                    if (idx === 0) {
                      return { ...it, isActive: true, photos: [...it.photos, wasEmpty ? { ...newPhoto, isCover: true } : newPhoto] };
                    }
                    return { ...it, isActive: false };
                  });
                }
                return prev;
              }
              const newId = `item-${Date.now()}`;
              setActiveItemId(newId);
              setTimeout(() => performQuickScan(newPhoto, newId, quickScanOptions), 500);
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
  }, [isCapturing, capturedPhotos.length, flash, captureButtonScale, flashOpacity, canAddAnotherItem, freemiumStatus, cameraMode, bulkItems]);

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


  const consumeShelfStreamEvent = useCallback((
    parsed: QuickScanStreamEvent,
    token: string,
    shelfPricingGeneration: number,
  ) => {
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
      pendingShelfItemsByIdRef.current = {};
      items.forEach((item, idx) => {
        const query = typeof item === 'string' ? item : item.query;
        shelfQueryToItemIdRef.current[query] = folderItems[idx].id;
        const normalizedQuery = normalizeShelfQuery(query);
        if (normalizedQuery) shelfQueryToItemIdRef.current[normalizedQuery] = folderItems[idx].id;
        pendingShelfItemsByIdRef.current[folderItems[idx].id] = {
          ...folderItems[idx],
          title: query,
          added: false,
        };
      });

      setIsBulkMode(true);
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
        completedItems: prev.completedItems,
        stalled: false,
        status: 'streaming',
      }));
      return;
    }

    if (parsed.type === 'SEARCH_RESULT') {
      const res = parsed.result;
      let didLandItem = false;
      const originalQuery = res?.extractedItem?.ocrText || res?.extractedItem?.paraphrases?.[0] || res?.extractedItem?.type || res?.usedQuery;
      const resultKeys = [
        parsed.itemKey,
        res?.itemKey,
        res?.extractedItem?.id,
        originalQuery,
        res?.usedQuery,
      ].filter(Boolean);
      let itemId = resultKeys
        .map((key) => shelfQueryToItemIdRef.current[String(key)] || shelfQueryToItemIdRef.current[normalizeShelfQuery(key)])
        .find(Boolean);

      if (!itemId) {
        const normalizedResults = resultKeys.map(normalizeShelfQuery).filter(Boolean);
        itemId = Object.values(pendingShelfItemsByIdRef.current).find((pending) => {
          if (pending.added) return false;
          const pendingQuery = normalizeShelfQuery(pending.title);
          return normalizedResults.some((resultQuery) => (
            pendingQuery === resultQuery
            || pendingQuery.includes(resultQuery)
            || resultQuery.includes(pendingQuery)
          ));
        })?.id;
      }

      // Optimized search wording is not guaranteed to preserve the extracted text.
      // Keep the stream progressive by assigning an otherwise-unmapped result to the
      // next pending shelf item instead of deferring every such row until COMPLETE.
      if (!itemId) {
        itemId = Object.values(pendingShelfItemsByIdRef.current).find((pending) => !pending.added)?.id;
      }

      if (itemId) {
        const quantity = typeof res?.quantity === 'number' ? res.quantity : 1;
        const pendingItem = pendingShelfItemsByIdRef.current[itemId];
        const folderId = activeShelfFolderIdRef.current;
        if (folderId && pendingItem && !pendingItem.added) {
          addShelfItemsToFolder(folderId, [{
            id: itemId,
            title: res?.usedQuery || pendingItem.title,
            quantity,
          }]);
          pendingShelfItemsByIdRef.current[itemId] = { ...pendingItem, added: true };
          didLandItem = true;
          setActiveItemId((current) => current || itemId);
        }
        setBulkItems((prev) => prev.map((item) => item.id === itemId ? { ...item, title: res?.usedQuery || item.title, quantity } : item));

        setItemLoadingStates((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });

        if (res?.matches && res.matches.length > 0) {
          const livePricing = res?.livePricing;
          const instantPricing = livePricing
            ? {
                low: livePricing.low,
                high: livePricing.high,
                median: livePricing.median,
                recommended: livePricing.median,
                sampleCount: livePricing.sampleCount,
                samples: livePricing.samples,
                livePricing,
              }
            : undefined;
          const rankedCandidates = res.matches.map((match: any, index: number) => (
            index === 0 && instantPricing && !match?.pricingResearch
              ? { ...match, pricingResearch: instantPricing }
              : match
          ));

          setQuickScanStore((prev) => ({
            ...prev,
            [itemId]: {
              matchData: {
                systemAction: 'show_multiple_matches',
                confidence: res.confidence || 'medium',
                rankedCandidates,
                totalMatches: rankedCandidates.length,
              },
              matchRows: rankedCandidates,
            },
          }));

          const shouldAutoConfirmTopMatch = shouldAutoSelectQuickMatch({
            totalMatches: rankedCandidates.length,
            recommendedAction: 'show_multiple_matches',
            rerankerConfidence: res.confidence === 'high' ? 0.9 : res.confidence === 'medium' ? 0.6 : 0.2,
            topCandidateIsLocalMatch: Boolean(rankedCandidates[0]?.isLocalMatch),
          });

          if (shouldAutoConfirmTopMatch) {
            const quickMatchHintCandidates = rankedCandidatesToQuickMatchHintCandidates(rankedCandidates);
            setConfirmedQuickMatchByItemId((prev) => ({
              ...prev,
              [itemId]: {
                matchRows: quickMatchHintCandidates,
                preSelectedIndices: [0],
                source: 'quick_scan_auto',
                confidence: res.confidence === 'high' ? 0.9 : 0.6,
              },
            }));
          }

          const topTitle = String(rankedCandidates[0]?.title || res?.usedQuery || '').trim();
          if (topTitle && token) {
            enqueueShelfPricingResearch({
              itemId,
              title: topTitle,
              token,
              generation: shelfPricingGeneration,
            });
          } else {
            // No searchable identity means enrichment cannot start. Store a terminal
            // marker so tapping the row shows an honest empty state, never a spinner.
            setQuickScanStore((prev) => {
              const current = prev[itemId];
              if (!current?.matchData?.rankedCandidates?.length) return prev;
              const candidates = [...current.matchData.rankedCandidates];
              candidates[0] = {
                ...candidates[0],
                pricingResearch: candidates[0]?.pricingResearch || {
                  low: null,
                  median: null,
                  high: null,
                  recommended: null,
                  samples: [],
                  error: 'no_searchable_title',
                },
              };
              return {
                ...prev,
                [itemId]: {
                  ...current,
                  matchData: { ...current.matchData, rankedCandidates: candidates },
                },
              };
            });
          }
        }

        // Per-item inventory dedup signal (shelf/multi) — the "Already in Inventory" badge
        // already renders off the prepended isLocalMatch candidate; this stores the explicit
        // match so the badge tap can offer the Update-vs-Add-new choice with a clean id.
        if (res?.alreadyInInventory && res?.inventoryMatch) {
          setInventoryDedupByItemId((prev) => ({ ...prev, [itemId]: { match: res.inventoryMatch, fallbackInstruction: 'matches_found' } }));
        }
      }

      setCurrentInstruction('searching');
      setShelfProgress((prev) => ({
        ...prev,
        phase: parsed.phase || 'searching_matches',
        progress: typeof parsed.progress === 'number' ? parsed.progress : prev.progress,
        elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : prev.elapsedMs,
        totalItems: typeof parsed.totalItems === 'number' ? parsed.totalItems : prev.totalItems,
        completedItems: didLandItem ? prev.completedItems + 1 : prev.completedItems,
        stalled: false,
        status: 'streaming',
      }));
      return;
    }

    if (parsed.type === 'COMPLETE') {
      const folderId = activeShelfFolderIdRef.current;
      const remainingItems = Object.values(pendingShelfItemsByIdRef.current).filter((item) => !item.added);
      if (folderId && remainingItems.length > 0) {
        addShelfItemsToFolder(folderId, remainingItems.map(({ id, title, quantity }) => ({ id, title, quantity })));
        remainingItems.forEach((item) => {
          pendingShelfItemsByIdRef.current[item.id] = { ...item, added: true };
        });
        setActiveItemId((current) => current || remainingItems[0]?.id || null);
      }
      stopShelfScan('completed', {
        phase: 'finishing',
        progress: 1,
        elapsedMs: typeof parsed.elapsedMs === 'number' ? parsed.elapsedMs : undefined,
        completedItems: Object.values(pendingShelfItemsByIdRef.current).filter((item) => item.added).length,
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
  }, [addShelfItemsToFolder, enqueueShelfPricingResearch, resetShelfScanResults, setActiveItemId, setBulkItems, setConfirmedQuickMatchByItemId, setQuickScanStore, sheetTranslateY, stopShelfScan]);

  const beginAdaptiveShelfScan = useCallback((
    photo: CapturedPhoto,
    placeholderItemId: string,
    resolvedEvent: QuickScanStreamEvent,
  ) => {
    // The normal-camera item exists only as a single-scan placeholder. Do not create or
    // mutate any folder state until the backend has explicitly resolved this photo to multi.
    lastShelfScanPhotoRef.current = photo;
    shelfPhotoUriForDraftRef.current = photo.uri;
    setShelfPhotoUri(photo.uri);
    setIsAdaptiveShelfScan(true);
    setIsProcessingShelfScan(true);
    setIsBulkMode(true);
    setCurrentInstruction('searching');
    setShelfProgress({
      ...initialShelfProgressState(),
      status: 'streaming',
      phase: resolvedEvent.phase || 'separating_items',
      progress: typeof resolvedEvent.progress === 'number' ? resolvedEvent.progress : 0.34,
      elapsedMs: resolvedEvent.elapsedMs || 0,
      totalItems: resolvedEvent.totalItems || 0,
      completedItems: 0,
    });

    shelfQueryToItemIdRef.current = {};
    pendingShelfItemsByIdRef.current = {};
    setBulkItems((prev) => prev.filter((item) => item.id !== placeholderItemId));
    setQuickScanStore((prev) => {
      if (!prev[placeholderItemId]) return prev;
      const next = { ...prev };
      delete next[placeholderItemId];
      return next;
    });
    setConfirmedQuickMatchByItemId((prev) => {
      if (!prev[placeholderItemId]) return prev;
      const next = { ...prev };
      delete next[placeholderItemId];
      return next;
    });
    setInventoryDedupByItemId((prev) => {
      if (!prev[placeholderItemId]) return prev;
      const next = { ...prev };
      delete next[placeholderItemId];
      return next;
    });
    setItemLoadingStates((prev) => {
      if (!prev[placeholderItemId]) return prev;
      const next = { ...prev };
      delete next[placeholderItemId];
      return next;
    });
    setActiveItemId((current) => current === placeholderItemId ? null : current);

    const { folderId } = createShelfFolder({
      sourcePhotoUri: photo.uri,
      label: 'Shelf',
      items: [],
    });
    activeShelfFolderIdRef.current = folderId;

    if (cartCloseTimerRef.current) {
      clearTimeout(cartCloseTimerRef.current);
      cartCloseTimerRef.current = null;
    }
    setShowDeepSearchSheet(true);
    sheetTranslateY.value = withSpring(0, CART_SPRING);
  }, [createShelfFolder, setActiveItemId, setBulkItems, setConfirmedQuickMatchByItemId, setQuickScanStore, sheetTranslateY]);

  const handleShelfModeScan = useCallback(async (
    photo: CapturedPhoto,
    options?: { preserveAdaptivePresentation?: boolean },
  ) => {
    try {
      setIsAdaptiveShelfScan(Boolean(options?.preserveAdaptivePresentation));
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
      const shelfPricingGeneration = shelfPricingGenerationRef.current;
      const { folderId } = createShelfFolder({
        sourcePhotoUri: photo.uri,
        label: 'Shelf',
        items: [],
      });
      activeShelfFolderIdRef.current = folderId;

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
          consumeShelfStreamEvent(parsed, token!, shelfPricingGeneration);
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
  }, [closeShelfScanStream, consumeShelfStreamEvent, createShelfFolder, resetShelfScanResults, sheetTranslateY]);

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
                  matchRows: res.matches.map((match: any) => ({ ...match, queryKey: newQuery })),
                },
              }));
              // Drop the previously confirmed/auto-selected match so the fresh results actually
              // surface — previewData prioritizes confirmedQuickMatchByItemId, which would
              // otherwise keep showing the OLD (wrong) match after a re-research.
              setConfirmedQuickMatchByItemId((prev) => {
                if (!prev[itemId]) return prev;
                const next = { ...prev };
                delete next[itemId];
                return next;
              });
            }
            // Per-item inventory dedup signal (re-research) — store the explicit match so the
            // "Already in Inventory" badge tap can offer Update-vs-Add-new.
            if (res?.alreadyInInventory && res?.inventoryMatch) {
              setInventoryDedupByItemId((prev) => ({ ...prev, [itemId]: { match: res.inventoryMatch, fallbackInstruction: 'matches_found' } }));
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
      if (allPhotos.length > MAX_DOCUMENT_PHOTOS) {
        Alert.alert('Photo limit', '12 photo max');
        return;
      }

      log.debug('[CONTINUE] Manifest mode - parsing', allPhotos.length, 'pages');
      showNotificationMessage('Parsing manifest...', 10000);

      try {
        const validImages = await encodeDocumentPhotosSequentially(allPhotos, 'page');
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
      if (allPhotos.length > MAX_DOCUMENT_PHOTOS) {
        Alert.alert('Photo limit', '12 photo max');
        return;
      }

      log.debug('[CONTINUE] Receipt mode - processing', allPhotos.length, 'receipts');
      showNotificationMessage('Processing receipt...', 10000);

      try {
        const validImages = await encodeDocumentPhotosSequentially(allPhotos, 'receipt');
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
  const handleImageUpload = useCallback(async (targetItemId?: string) => {
    // Some call sites wire this straight into onPress, which passes the press event as the
    // first arg. Anything that isn't a string means "no target item", never a target.
    if (typeof targetItemId !== 'string') targetItemId = undefined;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'We need camera roll permissions to upload images.');
      return;
    }

    const isDocumentImport = cameraMode === 'manifest' || cameraMode === 'receipt';
    const existingDocumentPhotos = isDocumentImport
      ? bulkItems.reduce((count, item) => count + item.photos.length, 0)
      : 0;
    const remainingDocumentSlots = MAX_DOCUMENT_PHOTOS - existingDocumentPhotos;
    if (isDocumentImport && remainingDocumentSlots <= 0) {
      Alert.alert('Photo limit', '12 photo max');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: isDocumentImport ? remainingDocumentSlots : 0,
      quality: 0.8,
    });

    if (!result.canceled && result.assets?.length) {
      const assets = result.assets;
      if (isDocumentImport && assets.length > remainingDocumentSlots) {
        Alert.alert('Photo limit', '12 photo max');
        return;
      }
      log.debug('[IMAGE UPLOAD] Adding', assets.length, 'uploaded image(s)');

      // Gallery uploads in normal camera mode go through the same hidden-adaptive route as
      // captures: one photo of several things becomes a shelf folder, one thing stays single.
      // Explicit corrections (targetItemId from wrong-item / add-details) stay single-scan.
      const uploadScanOptions: QuickScanRunOptions | undefined = cameraMode === 'camera'
        ? { mode: 'adaptive' }
        : undefined;
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
          setTimeout(() => performQuickScan(newPhotos[0], firstItem.id, uploadScanOptions), 500);
        }
      } else if ((targetItemId ?? activeItemId)) {
        // targetItemId (passed by the wrong-item / add-details flows) wins over activeItemId,
        // which can be stale right after setActiveItemId — so the photo lands on the right item.
        const effectiveItemId = (targetItemId ?? activeItemId) as string;
        const wasEmpty = (bulkItems.find(i => i.id === effectiveItemId)?.photos.length ?? 0) === 0;
        setBulkItems(prev => prev.map(item => {
          if (item.id !== effectiveItemId) return item;
          const added = newPhotos.map((p, i) => ({ ...p, isCover: wasEmpty && i === 0 }));
          return { ...item, photos: [...item.photos, ...added] };
        }));
        setCapturedPhotos(prev => [...prev, ...newPhotos]);
        // Re-research with the new photo when this is an EXPLICIT correction (targetItemId is
        // passed by the wrong-item / add-details / overlay flows) OR the item had no photo yet.
        // Plain multi-photo gallery imports to an already-matched item don't each fire a full
        // (~15s, billable) re-match — that was a cost regression from dropping the old gate.
        if (newPhotos[0] && (!!targetItemId || wasEmpty)) {
          setTimeout(() => performQuickScan(newPhotos[0], effectiveItemId, targetItemId ? undefined : uploadScanOptions), 500);
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
          setTimeout(() => performQuickScan(newPhotos[0], newItem.id, uploadScanOptions), 500);
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

      // Compress before upload — this image is BOTH the scan input and the listing cover. 1440px @
      // 0.8 (~halves the 1920@0.9 payload) uploads ~2x faster, stays a clean cover, and is plenty
      // of detail for the VLM + Lens. Upload is on the scan's critical path, so the smaller the faster.
      const compressed = await ImageManipulator.manipulateAsync(
        localUri,
        [{ resize: { width: 1440 } }], // only downscale if wider than 1440px
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
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
    options?: QuickScanRunOptions,
  ) => {
    // Guard against non-string ids: several call sites are (or were) wired straight into
    // onPress, which passes the GestureResponderEvent. An event-object id attaches photos
    // to nothing and gets every result discarded as "item removed mid-match".
    if (typeof itemId !== 'string') {
      log.warn('[QUICK SCAN] Ignoring scan with non-string itemId:', typeof itemId);
      return;
    }
    if (isAutoScanningRef.current) {
      if (quickScanQueueRef.current.length >= QUICK_SCAN_QUEUE_LIMIT) {
        log.debug('[QUICK SCAN] Queue limit reached, dropping oldest queued scan');
        quickScanQueueRef.current.shift();
      }
      const alreadyQueued = quickScanQueueRef.current.some(task => task.itemId === itemId && task.photo.id === photo.id);
      if (!alreadyQueued) {
        quickScanQueueRef.current.push({ photo, itemId, options });
      }
      log.debug('[QUICK SCAN] Scan in progress, queued follow-up scan');
      return;
    }

    // New scan starts – clear any previous cancellation
    quickScanCancelledRef.current = false;
    if (options?.mode === 'adaptive') setIsAdaptiveShelfScan(false);

    isAutoScanningRef.current = true;
    setIsAutoScanning(true);
    setCurrentInstruction('processing');

    // Set loading state for this item
    setItemLoadingStates(prev => ({
      ...prev,
      [itemId]: { isLoading: true, stage: 'Searching…', error: undefined }
    }));

    // Drop any previously confirmed/auto-selected match for this item NOW, at the start of
    // the (re-)match. previewData/the card prioritize confirmedQuickMatchByItemId, so leaving
    // it set would keep showing the OLD (wrong) match for the ~10-15s the full match runs —
    // exactly the "it didn't re-research" symptom on a Wrong-item correction. The end of this
    // function re-confirms the new top match if confidence is high enough.
    setConfirmedQuickMatchByItemId(prev => {
      if (!prev[itemId]) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });

    let scanErrorMessage: string | null = null;

    try {
      // Ensure auth bridge is ready and we have a Supabase JWT before any network calls
      const tokenMaybe = await ensureSupabaseJwt();
      if (!tokenMaybe) {
        log.warn('[QUICK SCAN] No Supabase JWT available. Are you signed in and the Clerk bridge configured?');
        showNotificationMessage('Sign in required to scan. Please log in and try again.', 3000);
        scanErrorMessage = 'Sign in required';
        isAutoScanningRef.current = false;
        setIsAutoScanning(false);
        return;
      }
      log.debug('[QUICK SCAN] Starting quick scan for photo:', photo.id);
      log.debug('[QUICK SCAN] Photo URI:', photo.uri);
      log.debug('[QUICK SCAN] Timestamp:', new Date().toISOString());

      if (!options?.skipPreflight) {
        const gate = await preflightAIGate('ai_quick_scan', 1);

        if (gate.code === 'credits_exhausted_but_invoiceable') {
          await persistPendingQuickScan(photo, itemId, options?.mode);
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
          await persistPendingQuickScan(photo, itemId, options?.mode);
          const decision = await presentBillingGateSheet(gate);
          scanErrorMessage = gate.message;
          return;
        }
      }

      // Upload image to Supabase Storage first
      log.debug('[QUICK SCAN] Uploading image to Supabase...');
      const publicImageUrl = await uploadImageToSupabase(photo.uri, photo.id);
      log.debug('[QUICK SCAN] Image uploaded to:', publicImageUrl);

      // Persist the uploaded URL onto the scanned item's photo so the saved scan session (and
      // the clearout agent that reads it) get a server-readable URL instead of the device's
      // local file:// path — otherwise add_scan_to_campaign can't open the image and the agent
      // falls back to "send me a pic" and can't price by the item's real condition.
      if (publicImageUrl) setItemPhotoUri(itemId, photo.id, publicImageUrl);

      const token = tokenMaybe;

      // FULL MATCH over a CLEAN STREAMING CONNECTION (SSE) — not HTTP polling. The agentic
      // matcher (local inventory + eBay web search + image-crop search; the precision gate
      // applies to its local lane) streams progress phases then a SEARCH_RESULT, and we resolve
      // when it COMPLETEs. Reuses the same react-native-sse client the shelf/text scans use.
      // options.textHint fuses a typed correction with the photo for a combined image+text match.
      // Billing is gated UPFRONT by preflightAIGate above; the SSE endpoint can't return a clean
      // 402, so a payment failure surfaces as a connection error (rare — preflight catches it).
      quickScanStreamRef.current?.close();
      quickScanStreamRef.current = null;
      type SingleStreamResult = {
        kind: 'single';
        matches: any[];
        confidence: any;
        livePricing?: any;
        canAutoConfirm?: boolean;
        confidenceState?: string;
        confidenceScore?: number;
        reasonCode?: string;
        rerankerAnalysis?: any;
        alreadyInInventory?: boolean;
        inventoryMatch?: any;
      };
      type StreamResult = SingleStreamResult | { kind: 'multi' };

      let adaptiveResolution: 'single' | 'multi' | null = null;
      let shelfPricingGeneration = shelfPricingGenerationRef.current;
      const runMatchStream = (streamMode: 'adaptive' | 'ocr-vlm-search') => new Promise<StreamResult | null>((resolve, reject) => {
        let latestMatches: any[] = [];
        let latestConfidence: any = 'medium';
        let latestLivePricing: any = null;
        let latestVerdict: Omit<SingleStreamResult, 'kind' | 'matches' | 'confidence' | 'livePricing'> = {};
        let settled = false;
        const finish = (run: () => void) => {
          if (settled) return;
          settled = true;
          clearInterval(cancelWatcher);
          quickScanStreamRef.current?.close();
          quickScanStreamRef.current = null;
          run();
        };
        const cancelWatcher = setInterval(() => {
          if (quickScanCancelledRef.current) finish(() => resolve(null));
        }, 400);

        quickScanStreamRef.current = openQuickScanStream({
          url: `${API_BASE_URL}/api/products/orchestrate/quick-scan-stream`,
          token,
          body: {
            images: [{ url: publicImageUrl, metadata: { id: photo.id, timestamp: photo.timestamp, width: photo.width, height: photo.height } }],
            ...(options?.textHint ? { textQuery: options.textHint } : {}),
            targetSites: ['general', 'ebay.com'],
            mode: streamMode,
          },
          onStallChange: (stalled) => {
            if (streamMode === 'adaptive' && adaptiveResolution === null && stalled) {
              finish(() => reject(new Error('Adaptive scan stalled before mode resolution.')));
              return;
            }
            if (adaptiveResolution === 'multi') {
              setShelfProgress((prev) => ({ ...prev, stalled }));
            }
          },
          onEvent: (evt) => {
            if (quickScanCancelledRef.current) {
              finish(() => resolve(null));
              return;
            }

            if (streamMode === 'adaptive' && evt.type === 'MODE_RESOLVED') {
              if (evt.detected === 'multi') {
                adaptiveResolution = 'multi';
                shelfPricingGeneration = shelfPricingGenerationRef.current;
                beginAdaptiveShelfScan(photo, itemId, evt);
              } else {
                adaptiveResolution = 'single';
                setIsAdaptiveShelfScan(false);
              }
              return;
            }

            if (adaptiveResolution === 'multi') {
              consumeShelfStreamEvent(evt, token, shelfPricingGeneration);
              if (evt.type === 'COMPLETE' || evt.type === 'NO_ITEMS' || evt.type === 'ERROR' || evt.type === 'TIMEOUT') {
                finish(() => resolve({ kind: 'multi' }));
              }
              return;
            }

            // The resolved-single branch intentionally stays on today's result path.
            if (evt.message && evt.type !== 'COMPLETE') {
              setItemLoadingStates(prev => ({ ...prev, [itemId]: { isLoading: true, stage: evt.message as string, error: undefined } }));
            }
            const fromResult = Array.isArray(evt.result?.matches) ? evt.result.matches : null;
            const fromData = Array.isArray(evt.data?.results) ? evt.data.results.flatMap((r: any) => r?.matches || []) : null;
            const seen = (fromResult && fromResult.length) ? fromResult : ((fromData && fromData.length) ? fromData : null);
            if (seen) {
              latestMatches = seen;
              latestConfidence = evt.result?.confidence ?? evt.data?.overallConfidence ?? latestConfidence;
            }
            if (evt.result?.livePricing) latestLivePricing = evt.result.livePricing;
            else if (evt.data?.results?.[0]?.livePricing) latestLivePricing = evt.data.results[0].livePricing;

            const verdictSrc = (evt.result && typeof evt.result.canAutoConfirm === 'boolean') ? evt.result
              : (evt.data?.results?.[0] && typeof evt.data.results[0].canAutoConfirm === 'boolean') ? evt.data.results[0]
              : (typeof evt.data?.canAutoConfirm === 'boolean' ? evt.data : null);
            if (verdictSrc) {
              latestVerdict = {
                canAutoConfirm: verdictSrc.canAutoConfirm,
                confidenceState: verdictSrc.confidenceState,
                confidenceScore: verdictSrc.confidenceScore,
                reasonCode: verdictSrc.reasonCode,
                rerankerAnalysis: verdictSrc.rerankerAnalysis ?? latestVerdict.rerankerAnalysis,
                alreadyInInventory: verdictSrc.alreadyInInventory ?? latestVerdict.alreadyInInventory,
                inventoryMatch: verdictSrc.inventoryMatch ?? latestVerdict.inventoryMatch,
              };
            }

            if (evt.type === 'COMPLETE' || evt.type === 'NO_ITEMS' || Array.isArray(evt.data?.results)) {
              finish(() => resolve({
                kind: 'single',
                matches: latestMatches,
                confidence: latestConfidence,
                livePricing: latestLivePricing,
                ...latestVerdict,
              }));
            } else if (evt.type === 'ERROR' || evt.type === 'TIMEOUT') {
              finish(() => reject(new Error(evt.message || 'Match failed.')));
            }
          },
          onConnectionError: (message) => {
            if (adaptiveResolution === 'multi') {
              const parsedError = parseShelfScanErrorMessage(message);
              stopShelfScan('error', {
                phase: 'finishing',
                progress: 1,
                message: parsedError.message,
                reasonCode: parsedError.reasonCode || 'stream_disconnected',
              });
              finish(() => resolve({ kind: 'multi' }));
              return;
            }
            finish(() => reject(new Error(message || 'Connection failed.')));
          },
        });
      });

      const requestedMode = options?.mode === 'adaptive' ? 'adaptive' : 'ocr-vlm-search';
      let streamResult: StreamResult | null;
      try {
        streamResult = await runMatchStream(requestedMode);
      } catch (streamError) {
        if (
          requestedMode === 'adaptive'
          && adaptiveResolution === null
          && !quickScanCancelledRef.current
        ) {
          log.warn('[QUICK SCAN] Adaptive stream failed before resolution; retrying legacy single scan.');
          streamResult = await runMatchStream('ocr-vlm-search');
        } else {
          throw streamError;
        }
      }

      // Cancelled (or the stream was closed out from under us): bail without mutating state.
      if (quickScanCancelledRef.current || !streamResult) return;

      // The match ran — count usage + clear any persisted billing-pending scan.
      incrementLocalUsage();
      await clearPendingQuickScan();

      // Multi results have already streamed through the shared shelf consumer and the
      // normal-camera placeholder item was replaced by a folder at MODE_RESOLVED.
      if (streamResult.kind === 'multi') return;

      // Skip writing results for an item the user deleted mid-match — avoids resurrecting an
      // orphaned quickScanStore/confirmed entry for an item that no longer exists.
      if (!bulkItemsRef.current.some((it) => it.id === itemId)) {
        log.debug('[QUICK SCAN] Item removed mid-match; discarding results for', itemId);
        return;
      }

      const streamMatches: any[] = streamResult.matches || [];
      // Confidence is a string enum ('high'|'medium'|'low'); shouldAutoSelectQuickMatch compares
      // it NUMERICALLY, so map it (high→0.9, medium→0.6, low→0.2) or auto-confirm never fires.
      const matchConfidenceLabel: string = typeof streamResult.confidence === 'string' ? streamResult.confidence : 'medium';
      const matchConfidenceNum = matchConfidenceLabel === 'high' ? 0.9 : matchConfidenceLabel === 'medium' ? 0.6 : 0.2;
      // Backend now owns match quality (computeScanConfidence) and sends a structured verdict.
      // Read it DIRECTLY instead of re-deriving a synthetic confidence bucket on the client (the
      // old label→0.9/0.6/0.2 hack that discarded the real reranker score/state/reasoning).
      const backendAutoConfirm: boolean | undefined = typeof streamResult.canAutoConfirm === 'boolean' ? streamResult.canAutoConfirm : undefined;
      const backendOwnsQuality = typeof backendAutoConfirm === 'boolean';
      const backendState: string | undefined = typeof streamResult.confidenceState === 'string' ? streamResult.confidenceState : undefined;
      const backendReranker = streamResult.rerankerAnalysis; // real {type,confidence,reasoning,...} when present
      // Typed `any` — the parser below reads it loosely (result.results[].matches, etc.).
      const result: any = {
        recommendedAction: backendOwnsQuality
          ? (backendAutoConfirm ? 'show_single_match' : 'show_multiple_matches')
          : (matchConfidenceLabel === 'high' ? 'show_single_match' : 'show_multiple_matches'),
        overallConfidence: matchConfidenceLabel,
        results: [{
          matches: streamMatches,
          rerankerAnalysis: backendReranker || { confidence: matchConfidenceNum, reasoning: undefined },
        }],
      };

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

        // Seed the pricing card with the FREE live range + COMPS the match already computed from its
        // eBay results — so price range AND "recent comps" show INSTANTLY with the match instead of
        // waiting on the slow post-match SerpAPI fetch. That fetch (below) still runs to enrich with
        // true sold-comp data, overwriting this seed when it lands.
        const lp: any = streamResult.livePricing;
        if (lp && nextMatchData.rankedCandidates?.[0] && !nextMatchData.rankedCandidates[0].pricingResearch) {
          (nextMatchData.rankedCandidates[0] as any).pricingResearch = {
            low: lp.low, high: lp.high, median: lp.median, sampleCount: lp.sampleCount,
            samples: lp.samples, livePricing: lp,
            // Exact product wasn't listed → these are SIMILAR-item comps; the card titles
            // the section "Couldn't find exact — similar item comps".
            isSimilar: !!lp.isSimilar,
          };
        }

        if (rerankerMeta) {
          nextMatchData.reranker = rerankerMeta;
        }

        // Update store
        const matchRowsForItem = candidatesToMatchRows(nextMatchData.rankedCandidates as any);
        const quickMatchHintCandidates = rankedCandidatesToQuickMatchHintCandidates(nextMatchData.rankedCandidates);
        setQuickScanStore(prev => {
          const updated = {
            ...prev,
            [itemId]: { matchData: nextMatchData, matchRows: matchRowsForItem }
          };
          return updated;
        });

        // Guard against confidently showing a junk match from a bad first frame.
        // A hallucinated query (dark/blurry capture) can FTS-match a keyword-stuffed
        // flywheel listing whose title repeats itself ("Patriot HD Glass Truck Body
        // Patriot HD Glass Truck Body patriot hd glass…"). Detect that low unique-word
        // ratio + a low-confidence verdict and refuse to auto-confirm — prompt a retake.
        // Backend is authoritative on match quality. Trust its canAutoConfirm/confidenceState when
        // present; fall back to the legacy client-side guard ONLY for an older backend (or shelf
        // mode) that doesn't send the structured verdict. (The keyword-soup heuristic and the
        // label→bucket are now belt-and-suspenders fallbacks, not the primary signal.)
        const topTitleForGuard = String(nextMatchData.rankedCandidates?.[0]?.title || '');
        const guardWords = topTitleForGuard.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
        const isKeywordSoup = guardWords.length >= 6 && (new Set(guardWords).size / guardWords.length) < 0.5;
        const looksUnidentified = backendOwnsQuality
          ? !backendAutoConfirm
          : (isKeywordSoup || matchConfidenceLabel === 'low');

        const shouldAutoConfirmTopMatch = backendOwnsQuality
          ? backendAutoConfirm!
          : (!looksUnidentified && shouldAutoSelectQuickMatch({
              totalMatches: allMatches.length,
              recommendedAction: quickScanResult?.recommendedAction,
              rerankerConfidence: rerankerMeta?.confidence,
              topCandidateIsLocalMatch: Boolean(nextMatchData.rankedCandidates?.[0]?.isLocalMatch),
            }));

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
              matchRows: quickMatchHintCandidates,
              preSelectedIndices: [0],
              source: 'quick_scan_auto',
              confidence: rerankerMeta?.confidence,
              reasoning: rerankerMeta?.reasoning,
            },
          };
        });

        // CRITICAL: Also update component-level matchData so getInstructionText displays correct count
        setMatchData(nextMatchData);
        // Backend not confident (needs-review / identified-but-not-exact, e.g. "Dell laptop charger"
        // with no exact listing) → 'needs_review', NOT 'matched'. The banner becomes an "add a detail"
        // CTA (tap → add-details for the tag) instead of dropping into a product as if it were found.
        const needsReview = backendOwnsQuality && !backendAutoConfirm;
        const realInstruction: CameraInstruction = shouldAutoConfirmTopMatch ? 'matched' : (needsReview ? 'needs_review' : 'matches_found');
        // INVENTORY DEDUP — this scan strongly matched an item the user ALREADY owns. Surface it so
        // they can Update the existing item (restock) instead of silently re-adding a duplicate.
        const dupMatch = (streamResult.alreadyInInventory && streamResult.inventoryMatch) ? streamResult.inventoryMatch : null;
        if (dupMatch) {
          setInventoryDedupByItemId(prev => ({ ...prev, [itemId]: { match: dupMatch, fallbackInstruction: realInstruction } }));
          setCurrentInstruction('inventory_dedup');
          showNotificationMessage(`You already have "${String(dupMatch.title || 'this item').slice(0, 40)}" — tap to update it or add as new.`, 4500);
        } else {
          setCurrentInstruction(realInstruction);
        }
        if (!dupMatch && (looksUnidentified || needsReview)) {
          const retakeState = backendState === 'NOT_RUN' || backendState === 'NO_PHOTO' || backendState === 'NO_CANDIDATES';
          const identity = String(nextMatchData.rankedCandidates?.[0]?.title || '').trim();
          showNotificationMessage(
            retakeState
              ? 'Couldn’t identify this clearly — tap to add a clearer photo of the label.'
              : identity
                ? `Likely a ${identity.slice(0, 40)} — tap to add a detail (model/tag) to confirm.`
                : 'Add a little more detail to confirm — tap to add a photo of the label or a note.',
            3800,
          );
        }

        // Pricing enrichment: Use eBay pricing research (actual sold listings) in background
        // to populate the price range from real market data. SKIP when the comps are
        // already SIMILAR-item comps (the exact product isn't listed) — researching the identity
        // title returns nothing and would clobber the ballpark similar comps the backend supplied.
        const topTitle = nextMatchData.rankedCandidates?.[0]?.title;
        // Skip the slow external pricing fetch when comps are similar-item comps (exact product not
        // listed) OR they came from the cache on a repeat scan AND actually carry priced samples.
        // fromCache with NO usable samples still fetches, so the user always gets a price.
        const cachedCompsUsable = !!lp?.fromCache && (((lp?.sampleCount || 0) > 0) || ((lp?.samples?.length || 0) > 0));
        if (topTitle && !lp?.isSimilar && !cachedCompsUsable) {
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

              // Store the response even when sold-comps "error": it can still carry
              // livePricing, and storing it ends the card's loading state with an
              // honest empty state instead of spinning forever. Only a failed request
              // is a hard miss (still stored as a marker so loading resolves).
              const priceData = priceRes.ok ? await priceRes.json() : { error: 'request_failed' };
              const recommended = Number(priceData?.recommended ?? priceData?.median ?? priceData?.low ?? 0);

              setQuickScanStore(prev => {
                const current = prev[itemId];
                if (!current?.matchData?.rankedCandidates?.length) return prev;
                const firstCand = current.matchData.rankedCandidates[0];
                const updatedCandidates = [...current.matchData.rankedCandidates];
                // Use the pricing-research price range (not a shipping figure):
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
        // Distinguish an AI/image-service OUTAGE from a genuine "couldn't identify it" so we don't
        // blame the user's photo when the provider hiccuped. Backend tags the abstain reasonCode
        // 'provider_error' (LLM/search tool threw) — tell them to retry the same photo, not chase a
        // sharper one.
        const providerHiccup = streamResult.reasonCode === 'provider_error';
        showNotificationMessage(
          providerHiccup
            ? 'Our image service hiccuped — try again in a moment.'
            : 'No quick matches found. Added to review.',
          3000,
        );
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
      // Reality: there is no background retry — the item drops to an error state below
      // (its card shows the failure) and the seller retries it by hand. Say so honestly.
      showNotificationMessage('Quick scan failed. Tap the item to try again.', 3000);
      scanErrorMessage = error instanceof Error ? error.message : 'Quick scan failed';
    } finally {
      // Make sure the SSE connection is torn down on every exit (success, error, or early
      // return) so we never leak a live EventSource.
      quickScanStreamRef.current?.close();
      quickScanStreamRef.current = null;
      isAutoScanningRef.current = false;
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
        setTimeout(() => performQuickScan(nextQueued.photo, nextQueued.itemId, nextQueued.options), 120);
      } else if (!nextQueued) {
        setCurrentInstruction('ready');
      }
    }

  }, [
    uploadImageToSupabase,
    candidatesToMatchRows,
    quickScanStore,
    showNotificationMessage,
    incrementLocalUsage,
    preflightAIGate,
    persistPendingQuickScan,
    presentBillingGateSheet,
    clearPendingQuickScan,
    beginAdaptiveShelfScan,
    consumeShelfStreamEvent,
    stopShelfScan,
  ]);

  // Re-research an item from a typed correction (the "Wrong item?" detail box or a cart
  // query edit). Runs the FULL match, not a text quick-scan: when the item still has its
  // photo we fuse the photo + the typed text for a combined image+text match; with no photo
  // we fall back to a text-only search. performQuickScan clears/re-confirms the match itself.
  const researchItemWithText = useCallback((itemId: string, query: string) => {
    const trimmed = (query || '').trim();
    if (!trimmed) return;
    const item = bulkItems.find((b) => b.id === itemId);
    const coverPhoto = item?.photos?.find((p) => p.isCover) || item?.photos?.[0];
    if (coverPhoto) {
      void performQuickScan(coverPhoto as CapturedPhoto, itemId, { textHint: trimmed });
    } else {
      void runQuickScanTextSearch(itemId, trimmed);
    }
  }, [bulkItems, performQuickScan, runQuickScanTextSearch]);

  // Attach a freshly captured photo to a specific item and re-run the full match. First
  // photo becomes the cover. Mirrors the live-camera capture branch, target-id explicit.
  const attachPhotoToItem = useCallback((itemId: string, photo: CapturedPhoto, opts?: { rescan?: boolean }) => {
    const wasEmpty = (bulkItemsRef.current.find((i) => i.id === itemId)?.photos.length ?? 0) === 0;
    setBulkItems((prev) => prev.map((item) => {
      if (item.id !== itemId) return item;
      const empty = item.photos.length === 0;
      return { ...item, photos: [...item.photos, { ...photo, isCover: empty ? true : photo.isCover }] };
    }));
    setCapturedPhotos((prev) => [...prev, photo]);
    // Scan when this is the cover (first) photo OR an explicit correction/re-match (wrong-item,
    // add-details tag). A plain "add another photo" to an already-matched item does NOT re-match.
    if (wasEmpty || opts?.rescan) setTimeout(() => performQuickScan(photo, itemId), 500);
  }, [performQuickScan]);

  // Open / close the inline capture overlay for a target item. `rescan` marks an explicit
  // correction (wrong-item / add-details tag) so the captured shot re-runs the full match;
  // a plain "add photo" leaves it false (gallery add → no re-match unless it's the cover).
  const photoCaptureRescanRef = useRef(false);
  const openPhotoCaptureForItem = useCallback((itemId: string, opts?: { rescan?: boolean }) => {
    if (photoCaptureTargetId) return; // overlay already open — ignore re-entrant taps
    photoCaptureRescanRef.current = !!opts?.rescan;
    setOverlayFacing('back');
    setOverlayFlash('off');
    setPhotoCaptureTargetId(itemId);
  }, [photoCaptureTargetId]);
  const closePhotoCaptureOverlay = useCallback(() => setPhotoCaptureTargetId(null), []);

  // Take one shot in the overlay, attach it, and return to the prior surface.
  const handleOverlayCapture = useCallback(async () => {
    const targetId = photoCaptureTargetId;
    if (!targetId || !captureOverlayRef.current || isOverlayCapturing) return;
    try {
      setIsOverlayCapturing(true);
      const shot = await captureOverlayRef.current.takePictureAsync({ quality: 0.7, base64: false });
      if (shot?.uri) {
        attachPhotoToItem(targetId, {
          id: `capture-${Date.now()}`,
          uri: shot.uri,
          width: shot.width || SCREEN_WIDTH,
          height: shot.height || SCREEN_HEIGHT,
          timestamp: Date.now(),
          isCover: false,
        }, { rescan: photoCaptureRescanRef.current });
        setPhotoCaptureTargetId(null); // success only → dismiss back to where the user was
      }
    } catch (err) {
      // Keep the overlay OPEN on failure so the user can read the alert and retry the shot,
      // instead of the camera vanishing out from under the error.
      log.error('[INLINE CAPTURE] Failed:', err);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    } finally {
      setIsOverlayCapturing(false);
    }
  }, [photoCaptureTargetId, isOverlayCapturing, attachPhotoToItem]);

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
          await performQuickScan(pending.photo as CapturedPhoto, pending.itemId, {
            skipPreflight: true,
            mode: pending.scanMode,
          });
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

  // (Removed dead openMatchSelectionForItem — MatchSelectionScreen was deprecated and deleted.)

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
    // Show the full-screen MatchPreview overlay inside the already-open cart Modal.
    // (Replaces the retired half-height MatchResultsSheet.)
    setPreviewItemId(itemId);
  }, [quickScanStore, showNotificationMessage, isProcessingShelfScan]);

  // Open the EXISTING inventory item in the quick editor (the Update path) — reuses the barcode-mode
  // QuickProductDetailSheet. Shared by the single-scan prompt and the shelf/cart "Already in Inventory"
  // tap. `match` is the normalized inventory shape ({ ProductVariantId, productId, title, price, imageUrl }).
  const openInventoryEditor = useCallback((itemId: string, match: any) => {
    const variantId = String(match?.ProductVariantId || match?.variantId || match?.id || '');
    const productId = String(match?.productId || match?.ProductId || '');
    if (!variantId && !productId) { showNotificationMessage('Inventory item is missing its id.', 2000); return; }
    setBarcodeSearchResult({
      product: { Id: productId || variantId, id: productId || variantId },
      variant: {
        Id: variantId || productId,
        id: variantId || productId,
        Title: match.title,
        Price: typeof match.price === 'number' ? match.price : match.price?.extracted_value,
      },
      images: match.imageUrl ? [{ ImageUrl: match.imageUrl }] : undefined,
    } as any);
    // Sequence the modal handoff: dismiss the cart Modal first, then present the barcode-result Modal
    // and unmount the cart row in later commits — batching present + dismiss + teardown races Fabric.
    setCurrentInstruction('ready');
    closeBulkItemsSheetRef.current?.();
    setTimeout(() => {
      setShowBarcodeResultModal(true);
      markItemsProcessed([{ id: itemId }], 'existing_inventory');
    }, 520);
  }, [markItemsProcessed, showNotificationMessage]);

  // INVENTORY DEDUP prompt — the scan matched an item the user already owns. Ask: Update the existing
  // item or add this as a new product. Outcome-only copy — never names how the match was found.
  // opts.onAddAsNew lets the shelf/cart path de-link the existing item; single mode just restores the
  // banner via opts.fallbackInstruction.
  const promptInventoryDedup = useCallback((itemId: string, match: any, opts?: { fallbackInstruction?: CameraInstruction; onAddAsNew?: () => void }) => {
    if (!match) return;
    const title = String(match.title || 'this item').slice(0, 60);
    Alert.alert(
      'Already in your inventory',
      `You already have "${title}". Update the existing item, or add this as a new product?`,
      [
        { text: 'Update inventory', onPress: () => openInventoryEditor(itemId, match) },
        {
          text: 'Add as new',
          onPress: () => {
            setInventoryDedupByItemId(prev => { const next = { ...prev }; delete next[itemId]; return next; });
            if (opts?.onAddAsNew) opts.onAddAsNew();
            else if (opts?.fallbackInstruction) setCurrentInstruction(opts.fallbackInstruction);
          },
        },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [openInventoryEditor]);

  // Shelf/cart "Already in Inventory" badge tap (onOpenLocalMatch). Resolve the match from the explicit
  // dedup signal if present, else the stored local candidate, then present the SAME Update-vs-Add-new
  // choice as single mode. "Add as new" de-links the inventory candidate so the item commits as NEW.
  const openExistingInventoryMatch = useCallback((itemId: string) => {
    const stored = inventoryDedupByItemId[itemId]?.match;
    const local = stored || (getLocalInventoryCandidateForItem(itemId, confirmedQuickMatchByItemId, quickScanStore) as any);
    if (!local) { showNotificationMessage('No inventory match is ready for this item yet.', 2000); return; }
    const match = stored ? stored : {
      ProductVariantId: local.variantId || local.ProductVariantId || local.id,
      productId: local.productId || local.ProductId,
      title: local.title,
      price: typeof local.price === 'number' ? local.price : local.price?.extracted_value,
      imageUrl: local.imageUrl,
    };
    promptInventoryDedup(itemId, match, {
      onAddAsNew: () => {
        // De-link: drop the inventory (isLocalMatch) candidate + any confirmed selection so the item
        // commits as a NEW product instead of the existing one.
        setConfirmedQuickMatchByItemId(prev => { if (!prev[itemId]) return prev; const next = { ...prev }; delete next[itemId]; return next; });
        setQuickScanStore(prev => {
          const cur = prev[itemId];
          if (!cur?.matchData?.rankedCandidates?.length) return prev;
          const keep = (c: any) => !c?.isLocalMatch && !c?.inInventory;
          const filtered = cur.matchData.rankedCandidates.filter(keep);
          return { ...prev, [itemId]: { ...cur, matchData: { ...cur.matchData, rankedCandidates: filtered, totalMatches: filtered.length }, matchRows: (cur.matchRows || []).filter(keep) } };
        });
        showNotificationMessage('Will add as a new product.', 1800);
      },
    });
  }, [inventoryDedupByItemId, confirmedQuickMatchByItemId, quickScanStore, promptInventoryDedup, showNotificationMessage]);

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
        // No jobId means there is nothing to poll — fail loudly instead of returning a
        // jobId:null that looks successful to callers (handled by the catch below).
        log.error('[ANALYZE] Missing jobId in response payload:', analyzeResult);
        throw new Error('Analysis response did not include a jobId to poll.');
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
        // REUSE the existing first item's id (the single-mode scan already created
        // a real item + stored its match under that id). Minting a NEW id here made
        // reconcileBulkItems removeEntry the old one — wiping its match BEFORE the
        // migration below could run (which then read empty data and no-op'd), so the
        // first item's match was lost the moment you added a second item. Keeping the
        // id stable preserves the match with no migration needed.
        const existingFirst = bulkItemsRef.current?.[0];
        const firstItemId = existingFirst?.id ?? generateItemId();
        const firstPhotos = existingFirst?.photos?.length ? existingFirst.photos : capturedPhotos;
        const newItems = [
          {
            id: firstItemId,
            photos: firstPhotos,
            title: existingFirst?.title,
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
  }, [isBulkMode, capturedPhotos, bulkItems.length, canAddAnotherItem, generateItemId]);

  // NEW: Handle pressing the match indicator/banner
  const handleMatchIndicatorPress = useCallback(() => {
    if (activeItemId) {
      log.debug('[MATCH CLICK] Indicator pressed for item:', activeItemId);

      // Already-in-inventory: tapping the banner asks Update vs Add-new.
      const dedup = inventoryDedupByItemId[activeItemId];
      if (currentInstruction === 'inventory_dedup' && dedup) {
        promptInventoryDedup(activeItemId, dedup.match, { fallbackInstruction: dedup.fallbackInstruction });
        return;
      }

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
        openBulkItemsSheetRef.current();
        // Needs-review (low-confidence / identified-but-not-exact, e.g. "Dell laptop charger" with no
        // exact listing) → open the ADD-DETAIL sheet to ask for the tag/model, instead of dropping
        // into the match preview as if it were a confident found product.
        if (currentInstruction === 'needs_review') {
          setAddDetailsItemId(activeItemId);
        } else {
          // Open the full-screen MatchPreview (hosted as an overlay inside the cart Modal).
          setPreviewItemId(activeItemId);
        }
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
  }, [activeItemId, quickScanStore, currentInstruction, showNotificationMessage, bulkItems, performQuickScan, inventoryDedupByItemId, promptInventoryDedup]);

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

  // Set cover photo in bulk item. Changing the cover RE-CHECKS the match against the new
  // cover image (the user's intent: reorder/retake the cover → re-scan), but only when the
  // cover actually changes — re-selecting the current cover is a no-op (no wasted re-match).
  const setBulkItemCoverPhoto = useCallback((itemId: string, photoId: string) => {
    const item = bulkItemsRef.current.find(i => i.id === itemId);
    const prevCoverId = item ? (item.photos.find(p => p.isCover) || item.photos[0])?.id : undefined;
    const coverChanged = !!item && prevCoverId !== photoId;
    const newCoverPhoto = item?.photos.find(p => p.id === photoId);
    setBulkItems(prev => prev.map(it => it.id === itemId
      ? { ...it, photos: it.photos.map(photo => ({ ...photo, isCover: photo.id === photoId })) }
      : it));
    if (coverChanged && newCoverPhoto) {
      setTimeout(() => performQuickScan(newCoverPhoto as CapturedPhoto, itemId), 300);
    }
  }, [performQuickScan]);

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
    quickScanStreamRef.current?.close();
    quickScanStreamRef.current = null;
    isAutoScanningRef.current = false;
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
  const isAnySheetVisible = showDeepSearchSheet || isMatchSheetVisible || showBarcodeResultModal || !!photoCaptureTargetId;
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
              <TouchableOpacity style={styles.addPhotoTile} onPress={() => handleImageUpload()} activeOpacity={0.8}>
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
          onCameraReady={() => { cameraReadyAtRef.current = Date.now(); }}
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
            // Mirror the swipe-back ring's onBack exactly so tap + swipe behave the same.
            // backWithOrigin honors an `origin` param (e.g. the chat that opened the cart)
            // before falling back to goBack → parent.goBack → Home.
            backWithOrigin(navigation);
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
          instruction={getInstructionText(overlayInstruction)}
          isProcessing={SCAN_INSTRUCTION_SET.includes(overlayInstruction)}
          cameraMode={cameraMode}
          scannedBarcode={scannedBarcode}
          onCopyBarcode={copyBarcodeToClipboard}
          matchPreview={centerOverlayMatchPreview}
          cardBottomOffset={CAMERA_BOTTOM_GAP + 44}
          onSwipeItem={stepActiveItem}
          onPress={
            (cameraMode === 'shelf' || isAdaptiveShelfScan) && !showDeepSearchSheet && (isProcessingShelfScan || bulkItems.length > 0 || shelfPhotoUri)
              ? openBulkItemsSheet
              : handleMatchIndicatorPress
          }
          totalPhotos={activeItemId
            ? (bulkItems.find((it) => it.id === activeItemId)?.photos.length ?? 0)
            : bulkItems.reduce((sum, sumItem) => sum + sumItem.photos.length, 0)}
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
          setIsAdaptiveShelfScan(false);
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
        shelfItemCount={currentShelfItemCount}
        isShelfStreaming={shelfProgress.status === 'streaming'}
        isShelfHandling={isAdaptiveShelfScan}
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
          (cameraMode === 'shelf' || isAdaptiveShelfScan) && (isProcessingShelfScan || bulkItems.length > 0 || shelfPhotoUri)
            ? openBulkItemsSheet
            : undefined
        }
      />
      </Animated.View>
        </Animated.View>
      </PanGestureHandler>

      {/* Retired: the half-height MatchResultsSheet. Tapping a match card / "Review"
          now opens the full-screen MatchPreview overlay inside the cart Modal below
          (see handleMatchIndicatorPress + openQuickMatchesForItem + renderMatchPreview). */}

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
                  onListingCreationStarted={(info) => { listingsReadyShownRef.current = false; sawCreationLoadingRef.current = false; setListingsReady(null); setProcessingCardDismissed(false); setCreatingListings(info); }}
                  confirmedQuickMatchByItemId={confirmedQuickMatchByItemId}
                  connectedPlatformKeys={connectedPlatformKeys}
                  currentInstruction={currentInstruction}
                  onOpenLocalMatch={openExistingInventoryMatch}
                  inventoryMatchByItemId={inventoryDedupByItemId}
                  shelfPricingPendingByItemId={shelfPricingPendingByItemId}
                  shelfPhotoUri={shelfPhotoUri}
                  shelfProgress={shelfProgress}
                  onRetryShelfScan={() => {
                    const lastPhoto = lastShelfScanPhotoRef.current;
                    if (!lastPhoto) return;
                    void handleShelfModeScan(lastPhoto, {
                      preserveAdaptivePresentation: isAdaptiveShelfScan,
                    });
                  }}
                  onRetakeShelfScan={clearShelfScanForRetake}
                  cameraMode={isAdaptiveShelfScan ? 'shelf' : cameraMode}
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
                    researchItemWithText(id, newQuery);
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
                    // Forward what we already have so the detail renders
                    // instantly instead of dead-ending on a fetch miss.
                    item: barcodeSearchResult?.variant,
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

                  // Process per variant, tracking which variants persisted so a
                  // partial failure can be reconciled instead of reported as a
                  // single blanket error (a naive retry would otherwise re-apply
                  // already-saved updates).
                  const savedVariantIds: string[] = [];
                  const failedVariantIds: string[] = [];

                  for (const [variantId, variantUpdates] of Object.entries(updatesByVariant)) {
                    // Map to API payload structure
                    const payloadUpdates = variantUpdates.map(u => {
                      // Find connectionId for the location
                      const locInfo = platformLocations.find(l => l.id === u.location);
                      if (!locInfo?.connectionId) {
                        log.warn(`[BARCODE SAVE] No connectionId found for location ${u.location}`);
                        return null;
                      }
                      // Only include fields the user actually changed; never send an
                      // absent quantity (would zero the location) or a non-finite price.
                      const payload: { platformConnectionId: string; locationId: string; quantity?: number; price?: number } = {
                        platformConnectionId: locInfo.connectionId,
                        locationId: u.location,
                      };
                      if (u.quantity !== undefined && Number.isFinite(u.quantity)) {
                        payload.quantity = u.quantity;
                      }
                      if (u.price !== undefined && Number.isFinite(u.price)) {
                        payload.price = u.price;
                      }
                      // Skip rows with nothing valid to apply
                      if (payload.quantity === undefined && payload.price === undefined) {
                        return null;
                      }
                      return payload;
                    }).filter(Boolean); // Remove nulls

                    if (payloadUpdates.length === 0) continue;

                    try {
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
                      savedVariantIds.push(variantId);
                    } catch (variantErr) {
                      log.error(`[BARCODE SAVE] Variant ${variantId} failed:`, variantErr);
                      failedVariantIds.push(variantId);
                    }
                  }

                  if (failedVariantIds.length === 0) {
                    Alert.alert('Success', 'Inventory updated successfully');
                  } else if (savedVariantIds.length === 0) {
                    Alert.alert('Error', 'Failed to save updates. Please try again.');
                  } else {
                    // Partial failure: be explicit so the user knows what still needs saving.
                    Alert.alert(
                      'Partially Saved',
                      `${savedVariantIds.length} item(s) saved, ${failedVariantIds.length} failed. Please retry the items that did not save.`
                    );
                  }

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

      {/* Inline "add a photo" camera overlay — its own full-screen Modal + CameraView (NO
          children on CameraView; controls are siblings) so it never fights the paused
          persistent camera or the Fabric unmount assert. Slides up, one shot, returns. */}
      <Modal
        visible={!!photoCaptureTargetId}
        animationType="slide"
        statusBarTranslucent
        presentationStyle="overFullScreen"
        onRequestClose={closePhotoCaptureOverlay}
      >
        <View style={styles.captureOverlayRoot}>
          {/* Unconditional (no `{cond && <CameraView/>}` guard): the Modal only mounts its
              children while visible, and its dismissal tears down the native tree — toggling a
              conditional child in the same commit as `visible` trips the Fabric unmount assert.
              `active` (not mount/unmount) gates the live preview. CameraView has NO children. */}
          <CameraView
            ref={captureOverlayRef}
            style={StyleSheet.absoluteFill}
            facing={overlayFacing}
            flash={overlayFlash}
            active={!!photoCaptureTargetId}
          />
          <TouchableOpacity
            style={[styles.captureOverlayClose, { top: screenInsets.top + 12 }]}
            onPress={closePhotoCaptureOverlay}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="close" size={26} color="#FFF" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.captureOverlayFlash, { top: screenInsets.top + 12 }]}
            onPress={() => setOverlayFlash((f) => (f === 'on' ? 'off' : 'on'))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name={overlayFlash === 'on' ? 'flash-on' : 'flash-off'} size={24} color="#FFF" />
          </TouchableOpacity>
          <View style={[styles.captureOverlayBar, { paddingBottom: screenInsets.bottom + 24 }]}>
            <TouchableOpacity
              style={styles.captureOverlaySideBtn}
              onPress={() => {
                // Switch to the OS gallery for this same item (import instead of shoot).
                const id = photoCaptureTargetId;
                setPhotoCaptureTargetId(null);
                // 500ms (not 350) so the overlay's dismiss animation fully settles before the
                // OS picker presents — launching over a dismissing Modal can silently no-op on iOS.
                if (id) setTimeout(() => handleImageUpload(id), 500);
              }}
            >
              <MaterialIcons name="photo-library" size={26} color="#FFF" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.captureOverlayShutter}
              onPress={handleOverlayCapture}
              disabled={isOverlayCapturing}
              activeOpacity={0.8}
            >
              <View style={styles.captureOverlayShutterInner} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.captureOverlaySideBtn}
              onPress={() => setOverlayFacing((f) => (f === 'back' ? 'front' : 'back'))}
            >
              <MaterialIcons name="flip-camera-ios" size={26} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Post-checkout: "Creating your listings" → "Ready to review" cards. */}
      <ListingProcessingCard
        visible={!!creatingListings && !processingCardDismissed}
        imageUri={creatingListings?.photoUri}
        count={creatingListings?.count ?? 1}
        onDone={() => setProcessingCardDismissed(true)}
      />
      <ListingsReadyCard
        visible={!!listingsReady}
        count={listingsReady?.count ?? 1}
        onReview={() => {
          setListingsReady(null);
          // ListingsReadyCard and the bulk items sheet are sibling Modals; presenting
          // in the same tick batches them (see openBulkItemsSheet note). Defer so the
          // ready card dismisses first, then open the review surface.
          setTimeout(() => openBulkItemsSheet(), 280);
        }}
        onDismiss={() => setListingsReady(null)}
      />
    </GestureHandlerRootView>
  );
};

// Styles
const styles = StyleSheet.create({
  // Inline add-photo camera overlay
  captureOverlayRoot: { flex: 1, backgroundColor: '#000' },
  captureOverlayClose: { position: 'absolute', left: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  captureOverlayFlash: { position: 'absolute', right: 16, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  captureOverlayBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 36 },
  captureOverlaySideBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  captureOverlayShutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  captureOverlayShutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFF' },
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

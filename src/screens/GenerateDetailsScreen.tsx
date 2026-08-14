import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { apiFetch } from '../lib/apiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Image, FlatList, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard, Animated, Easing, BackHandler } from 'react-native';
import { CameraView } from 'expo-camera';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import PyramidGrid from '../components/PyramidGrid';
import { getPlatformRequirements } from '../utils/platformRequirements';
import { Boxes, X, Pencil, ChevronLeft, ChevronRight, PencilIcon } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { ProgressiveBlurView } from '../components/ProgressiveBlurView';
import { CHAT_COLORS, CHAT_FONT, CHAT_SHADOWS, GLASS, GLASS_HEADER_STYLES } from '../design/chatGlass';
import KeyboardAwareBottomActionBar from '../components/KeyboardAwareBottomActionBar';
import { MessageComposer } from '../components/chat/MessageComposer';
import ListingEditorForm, { ListingEditorFormRef } from '../components/ListingEditorForm';
import PlatformLogo from '../components/PlatformLogo';
import FieldSheet from '../components/ListingEditor/FieldSheet';
import PublishFlowSheet from '../components/ListingEditor/PublishFlowSheet';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { hydratePlatformsFromBackend, normalizeForListingEditor, isEmpty } from '../utils/platformDataHydration';
import { isPlatformReady, getMissingPlatformFields, hasPlatformPrice } from '../utils/platformRequirements';
import { Paths, Directory, File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { captureOrPickImageAssets } from '../utils/imageCapture';
import * as ImageManipulator from 'expo-image-manipulator';
import { useJobsOptional } from '../context/JobsContext';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';
import { useJobProgress } from '../hooks/useJobProgress';
import { useCollaboration } from '../hooks/useCollaboration';
import ErrorModal from '../components/ErrorModal';
import { PLATFORM_META } from '../utils/platformConstants';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { isVisiblePlatformConnection } from '../lib/platformConnectStatus';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useToastAnchor } from '../context/ToastContext';
import { resolveItemsFromIds, resolveJobMapFromIds } from '../features/cart/flowPayloads';
import { selectItem } from '../features/cart/cartStore';
import { fetchGenerateJobStatus } from '../lib/generateJobs';
import { selectStoredPricingResearch } from '../lib/storedPricingResearch';
import {
  applyProgressiveEnrichment,
  enrichmentLabel,
  type ProgressiveEnrichment,
} from '../features/generation/progressiveEnrichment';


const ACTION_BAR_HEIGHT = 80;
const ACTION_BAR_BOTTOM_OFFSET = 24;
const SCANNER_GROW_HEIGHT = 240;
const SCANNER_CLOSE_DURATION = 220;

type SerializedSaveSender = (token: number, isLatest: () => boolean) => Promise<boolean>;

function useLatestSaveSerializer(send: SerializedSaveSender) {
  const sendRef = useRef(send);
  sendRef.current = send;
  const stateRef = useRef<{
    requestToken: number;
    trailing: boolean;
    drain: Promise<boolean> | null;
  }>({ requestToken: 0, trailing: false, drain: null });

  return useCallback((): Promise<boolean> => {
    const state = stateRef.current;
    state.requestToken += 1;
    state.trailing = true;
    if (!state.drain) {
      state.drain = (async () => {
        let latestResult = true;
        while (state.trailing) {
          state.trailing = false;
          const token = state.requestToken;
          try {
            latestResult = await sendRef.current(token, () => token === state.requestToken);
          } catch {
            latestResult = false;
          }
        }
        return latestResult;
      })().finally(() => {
        state.drain = null;
      });
    }
    return state.drain;
  }, []);
}

// Feature flag to hide AI refill functionality



type Props = StackScreenProps<AppStackParamList, 'GenerateDetailsScreen'>;

type GeneratedPlatformDetails = Record<string, any>;
type GeneratedResult = {
  productIndex: number;
  productId?: string;
  variantId?: string;
  platforms: GeneratedPlatformDetails;
  sourceImageUrl?: string;
  processingTimeMs?: number;
  source?: string;
  draftReady?: boolean;
  draftReadyAt?: string;
  enrichment?: ProgressiveEnrichment;
};

// Platform field schema for hierarchical structure
// Platform field schema extracted to separate file for maintainability
import { PLATFORM_FIELD_SCHEMA } from '../utils/platformSchemas';
import { createLogger } from '../utils/logger';
const log = createLogger('GenerateDetailsScreen');

// NOTE: Schema currently not used in this file - UI uses ListingEditorForm which has its own logic

// Helper function to group versions by match job ID, showing latest as primary

// REMOVED - Now using unified hydration utilities from platformDataHydration.ts

function GenerateDetailsScreen({ route, navigation }: Props) {
  const isFocused = useIsFocused();
  const mainScrollRef = useRef<ScrollView>(null);
  const listingEditorRef = useRef<ListingEditorFormRef>(null);
  const [listingEditorY, setListingEditorY] = useState(0);
  const insets = useSafeAreaInsets();
  const bottomSafePadding = ACTION_BAR_HEIGHT + ACTION_BAR_BOTTOM_OFFSET + insets.bottom + 16;
  const [mode, setMode] = useState<'overview' | 'edit'>('overview');

  // Bottom tray hides on scroll-down, returns on scroll-up.
  const trayY = useRef(new Animated.Value(0)).current;
  const trayHidden = useRef(false);
  const lastScrollY = useRef(0);
  const setTrayHidden = (hidden: boolean) => {
    if (trayHidden.current === hidden) return;
    trayHidden.current = hidden;
    Animated.timing(trayY, {
      toValue: hidden ? 260 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };
  const handleTrayScroll = (e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    if (Math.abs(dy) < 6) return; // ignore jitter
    if (y <= 0) setTrayHidden(false);
    else if (dy > 0) setTrayHidden(true); // scrolling down → hide
    else setTrayHidden(false); // scrolling up → show
    lastScrollY.current = y;
  };
  // Support both direct props and nested { response: {...} }
  const params: any = (route.params || {}) as any;
  const jobId = params.jobId ?? params.response?.jobId;
  const matchJobId = params.matchJobId ?? params.response?.matchJobId;
  const statusParam = params.status ?? params.response?.status;
  const resultsParam = params.results ?? params.response?.results;
  const summaryParam = params.summary ?? params.response?.summary;
  const completedAtParam = params.completedAt ?? params.response?.completedAt;

  const [fetched, setFetched] = useState(false);
  const [jobData, setJobData] = useState<{ status?: string; currentStage?: string; results?: GeneratedResult[]; summary?: any; completedAt?: string } | null>(null);
  const [dbImages, setDbImages] = useState<Record<string, string[]>>({});
  const [isInputExpanded, setIsInputExpanded] = useState(false);
  const [composerHeight, setComposerHeight] = useState(120);
  const [composerKeyboardHeight, setComposerKeyboardHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, event => {
      setComposerKeyboardHeight(Math.max(event.endCoordinates?.height ?? 0, 0));
    });
    const hide = Keyboard.addListener(hideEvent, () => setComposerKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useToastAnchor(
    'generate-details-composer',
    isFocused && mode === 'edit' && isInputExpanded,
    composerHeight + Math.max(composerKeyboardHeight - insets.bottom, 0),
  );
  // Chat-style "wanna change something" composer text (replaces SmartCommandInput).
  const [quickFixText, setQuickFixText] = useState('');
  useEffect(() => {
    if (mode === 'overview') {
      setIsInputExpanded(false);
      setQuickFixText('');
    }
  }, [mode]);

  // Wire up the platform picker overlay so "+ Add Platform" works in ListingEditorForm
  const platformPickerOverlay = usePlatformPickerOverlay();
  useEffect(() => {
    if (!isFocused) return;
    platformPickerOverlay.enableForScreen((platform: string) => {
      // When a platform is selected from the picker overlay, add it to platforms & generate
      const key = platform.toLowerCase();
      updatePlatforms(prev => {
        if (prev[key]) return prev; // Already exists
        // Copy core fields from canonical (first available platform)
        const canonicalKey = Object.keys(prev)[0];
        const canonical = canonicalKey ? prev[canonicalKey] : {};
        return {
          ...prev,
          [key]: {
            title: (canonical as any)?.title || '',
            description: (canonical as any)?.description || '',
            price: (canonical as any)?.price || '',
            tags: (canonical as any)?.tags || [],
          },
        };
      });
      platformPickerOverlay.hide();
    });
    return () => platformPickerOverlay.disableForScreen();
  }, [isFocused, platformPickerOverlay.enableForScreen, platformPickerOverlay.disableForScreen, platformPickerOverlay.hide]);


  // If we only get a jobId, fetch the job payload from Supabase once
  useEffect(() => {
    if (!jobId) return;
    if ((Array.isArray(resultsParam) && resultsParam.length > 0) || fetched) return;
    let canceled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('generate_jobs')
          .select('status, results, summary, completed_at')
          .eq('job_id', jobId)
          .maybeSingle();
        if (error) return;
        if (!canceled && data) {
          setJobData({
            status: data.status,
            results: Array.isArray(data.results) ? data.results : [],
            summary: data.summary,
            completedAt: data.completed_at,
          });
        }
      } catch { }
      finally {
        if (!canceled) setFetched(true);
      }
    })();
    return () => { canceled = true };
  }, [jobId, resultsParam, fetched]);

  // Listen for real-time updates
  const { jobState: socketJobState } = useJobProgress(jobId);

  useEffect(() => {
    if (socketJobState && socketJobState.jobId === jobId) {
      log.debug('[GEN-DETAILS] Socket update:', socketJobState.status);

      setJobData(prev => {
        // Only update if we have new meaningful data or status change
        if (prev?.status === 'completed' && socketJobState.status !== 'completed') return prev;

        return {
          status: socketJobState.status,
          // If socket provides results, use them. Otherwise keep existing (unless empty)
          results: Array.isArray(socketJobState.results) && socketJobState.results.length > 0
            ? socketJobState.results
            : (prev?.results || (Array.isArray(resultsParam) ? resultsParam : [])),
          summary: prev?.summary, // Socket might not send summary, keep existing
          currentStage: socketJobState.currentStage ?? prev?.currentStage,
          completedAt: socketJobState.status === 'completed' ? new Date().toISOString() : prev?.completedAt,
        };
      });
    }
  }, [socketJobState, jobId]);

  const status = jobData?.status ?? statusParam;
  const results = jobData?.results ?? resultsParam;
  const first: GeneratedResult | null = useMemo(() => (Array.isArray(results) && results.length > 0 ? results[0] : null), [results]);
  const summary = jobData?.summary ?? summaryParam;

  const completedAt = jobData?.completedAt ?? completedAtParam;

  // A generate job now exposes a usable draft while it remains `processing`; taxonomy
  // and shipping settle afterward. Poll while this editor is focused so draft readiness
  // and late defaults do not depend on a socket connection. Navigation pauses this local
  // poll; AddProduct's durable queue remains the background owner.
  useEffect(() => {
    if (!jobId || !isFocused) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      const snapshot = await fetchGenerateJobStatus(jobId).catch(() => null);
      if (cancelled) return;
      if (snapshot) {
        const incoming = Array.isArray(snapshot.results) ? snapshot.results as GeneratedResult[] : [];
        setJobData((prev) => ({
          status: snapshot.status,
          currentStage: snapshot.currentStage ?? prev?.currentStage,
          results: incoming.length > 0
            ? incoming
            : (prev?.results || (Array.isArray(resultsParam) ? resultsParam : [])),
          summary: snapshot.summary ?? prev?.summary ?? summaryParam,
          completedAt: snapshot.completedAt ?? prev?.completedAt,
        }));
        if (['completed', 'failed', 'cancelled'].includes(String(snapshot.status))) return;
      }
      timer = setTimeout(() => { void poll(); }, 1500);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, isFocused, resultsParam, summaryParam]);

  // Fetch user-uploaded images from ProductImages table (like PastScansScreen does)
  useEffect(() => {
    if (!results || results.length === 0) return;
    let canceled = false;
    (async () => {
      try {
        const variantIds = results.map((r: any) => r.variantId).filter(Boolean);
        if (variantIds.length === 0) return;

        const { data: variants, error } = await supabase
          .from('ProductVariants')
          .select(`
            Id,
            ProductImages!ProductImages_ProductVariantId_fkey ( ImageUrl, Position )
          `)
          .in('Id', variantIds);

        if (error || !variants || canceled) return;

        const imageMap: Record<string, string[]> = {};
        variants.forEach((variant: any) => {
          const sortedImages = variant.ProductImages
            ?.sort((a: any, b: any) => (a.Position || 0) - (b.Position || 0))
            ?.map((img: any) => img.ImageUrl) || [];
          if (sortedImages.length > 0) {
            imageMap[variant.Id] = sortedImages;
          }
        });

        if (!canceled) {
          log.debug('[GEN-DETAILS] Loaded ProductImages from DB:', imageMap);
          setDbImages(imageMap);
        }
      } catch (err) {
        log.error('[GEN-DETAILS] Failed to load ProductImages:', err);
      }
    })();
    return () => { canceled = true };
  }, [(route.params as any)?.variantId, results === null ? null : results]);

  // Debug logs moved to useEffect to prevent spam on every render
  useEffect(() => {
    log.debug('[GEN-DETAILS] route.params keys:', Object.keys((route.params || {}) as any));
    log.debug('[GEN-DETAILS] jobId:', jobId, 'status:', status);
    log.debug('[GEN-DETAILS] results raw:', Array.isArray(results) ? `len=${results.length}` : typeof results);
  }, [jobId, status, results, route.params]);

  // In-app error/notice modal (replaces native alert() so publish/save messages match the app).
  const [errorModal, setErrorModal] = useState<{ visible: boolean; type: 'error' | 'warning' | 'info' | 'success'; title: string; message: string }>({ visible: false, type: 'error', title: '', message: '' });
  const showErrorModal = useCallback(
    (title: string, message: string, type: 'error' | 'warning' | 'info' | 'success' = 'error') =>
      setErrorModal({ visible: true, type, title, message }),
    [],
  );
  const hideErrorModal = useCallback(() => setErrorModal((s) => ({ ...s, visible: false })), []);

  // ========== CRITICAL FIX: useRef for data persistence + auto-save ==========
  const [updateCounter, setUpdateCounter] = useState(0);
  const platformsRef = useRef<GeneratedPlatformDetails>({});
  const [, forceUpdate] = useState({});
  const debounceTimerRef = useRef<any>(null);
  const buildPlatformPayloadRef = useRef<() => any>(() => ({ media: { imageUris: [], coverImageIndex: 0 } }));
  const lastHydratedJobRef = useRef<string | null>(null);
  const draftBaselineByProductRef = useRef<Record<number, Record<string, any>>>({});
  const lastSavedRef = useRef<string>('');
  const lastScheduledRef = useRef<string | null>(null);
  const draftEditVersionRef = useRef(0);
  // Surfaced in the header so the user can SEE autosave working (it runs silently otherwise).
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  // The save status rides in the header subtitle transiently, then fades so only the item
  // title remains. Saving…/Save failed persist; Saved auto-hides after a beat.
  const [saveStatusVisible, setSaveStatusVisible] = useState(false);
  useEffect(() => {
    if (saveState === 'saving' || saveState === 'error') { setSaveStatusVisible(true); return; }
    if (saveState === 'saved') {
      setSaveStatusVisible(true);
      const t = setTimeout(() => setSaveStatusVisible(false), 2500);
      return () => clearTimeout(t);
    }
    setSaveStatusVisible(false);
  }, [saveState]);

  // Track active regeneration jobs: jobId -> platformKey
  const activeRegenJobsRef = useRef<Record<string, string>>({});
  const [generatingPlatformKeys, setGeneratingPlatformKeys] = useState<Set<string>>(new Set());

  const [currentProductIndex, setCurrentProductIndex] = useState(0);
  const editorSessionKey = `${jobId || 'job'}:${currentProductIndex}:${(route.params as any)?.variantId || ''}:${(route.params as any)?.productId || ''}`;
  const editorGenerationRef = useRef(0);
  const lastEditorSessionKeyRef = useRef(editorSessionKey);
  useEffect(() => {
    if (lastEditorSessionKeyRef.current === editorSessionKey) return;
    lastEditorSessionKeyRef.current = editorSessionKey;
    editorGenerationRef.current += 1;
    platformsRef.current = {};
    activeRegenJobsRef.current = {};
    setGeneratingPlatformKeys(new Set());
    lastHydratedJobRef.current = null;
    draftBaselineByProductRef.current = {};
    lastSavedRef.current = '';
    lastScheduledRef.current = null;
    draftEditVersionRef.current += 1;
    setSaveState('idle');
    setMode('overview');
    forceUpdate({});
  }, [editorSessionKey]);

  useEffect(() => {
    if (!isFocused || mode !== 'edit') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setMode('overview');
      return true;
    });
    return () => subscription.remove();
  }, [isFocused, mode]);

  // Listen for socket updates for ANY regeneration job we started
  const { onJobProgress } = useCollaboration();

  useEffect(() => {
    if (!onJobProgress) return;

    const unsubscribe = onJobProgress(async (data: any) => {
      const platformKey = activeRegenJobsRef.current[data.jobId];
      if (!platformKey) return; // Not a job we care about

      log.debug(`[GEN-DETAILS] Socket update for platform ${platformKey} (job ${data.jobId}): ${data.status}`);

      if (data.status === 'completed') {
        try {
          // If socket has results, use them. Otherwise fetch.
          let resultArray = Array.isArray(data.results) ? data.results : [];

          if (resultArray.length === 0) {
            // Fallback: fetch results if socket didn't include them
            const baseUrl = API_BASE_URL;
            const token = await ensureSupabaseJwt();
            if (baseUrl && token) {
              const rr = await fetch(`${baseUrl}/api/products/regenerate/results/${data.jobId}`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (rr.ok) {
                const json = await rr.json();
                resultArray = Array.isArray(json?.results) ? json.results : [];
              }
            }
          }

          const matched = resultArray.find((r: any) => (typeof r.productIndex === 'number' ? r.productIndex : 0) === ((first?.productIndex as number) ?? 0)) || resultArray[0];
          const generatedPlatforms = (matched?.platforms || {}) as Record<string, any>;

          if (generatedPlatforms && generatedPlatforms[platformKey]) {
            // Update displayed platforms with the new generated data
            const normalized = normalizeForListingEditor(generatedPlatforms[platformKey]);
            log.debug(`[GEN-DETAILS] Hydrating generated data for ${platformKey}`);
            updatePlatforms(prev =>
              hydratePlatformsFromBackend({ [platformKey]: normalized }, prev)
            );
          }
        } catch (err) {
          log.error(`[GEN-DETAILS] Error processing completion for ${platformKey}:`, err);
        } finally {
          // Cleanup
          delete activeRegenJobsRef.current[data.jobId];
          setGeneratingPlatformKeys(prev => {
            const next = new Set(prev);
            next.delete(platformKey);
            return next;
          });
        }
      } else if (data.status === 'failed' || data.status === 'cancelled') {
        log.warn(`[GEN-DETAILS] Generation failed for ${platformKey}`);
        delete activeRegenJobsRef.current[data.jobId];
        setGeneratingPlatformKeys(prev => {
          const next = new Set(prev);
          next.delete(platformKey);
          return next;
        });
        showErrorModal('Generation failed', `We couldn’t generate ${platformKey} details. Please try again.`, 'error');
      }
    });

    return () => unsubscribe();
  }, [onJobProgress, first?.productIndex]);

  const updatePlatforms = (updater: (prev: GeneratedPlatformDetails) => GeneratedPlatformDetails) => {
    platformsRef.current = updater(platformsRef.current);
    draftEditVersionRef.current += 1;
    setSaveState(current => current === 'saved' ? 'idle' : current);
    forceUpdate({}); // Trigger re-render
    setUpdateCounter(c => c + 1); // Signal content change
    log.debug('[GEN-DETAILS] Updated platforms, triggering auto-save...');
  };

  // Get displayedPlatforms from ref (for render)
  // Just use the ref directly - it's stable and mutations won't cause renders



  const displayedPlatforms = platformsRef.current;

  // Prefer user-captured images: 0) from route params, 1) from ProductImages DB, 2) from draft
  const userImagesByIndex: Record<number, string[]> = useMemo(() => {
    const map: Record<number, string[]> = {};

    // Helper to filter valid image URLs
    const filterValidImages = (imgs: any[]): string[] => {
      if (!Array.isArray(imgs)) return [];
      return imgs.filter((url: any) => typeof url === 'string' && url.trim().length > 0);
    };

    // Priority 0: Images passed via navigation params (from MatchSelectionScreen bulk scan)
    const paramsImages = (route.params as any)?.userImagesByIndex;
    if (paramsImages && typeof paramsImages === 'object') {
      Object.entries(paramsImages).forEach(([idxStr, imgs]) => {
        const idx = parseInt(idxStr, 10);
        const validImgs = filterValidImages(imgs as any[]);
        if (!isNaN(idx) && validImgs.length > 0) {
          map[idx] = validImgs;
          log.debug(`[userImagesByIndex] P0: Using params images for index ${idx}:`, validImgs.length);
        }
      });
    }

    // Priority 1: ProductImages from database (actual user photos)
    // DB images are the canonical uploaded versions of local camera photos.
    // REPLACE (don't merge) to avoid duplicates: local file:/// + https://supabase of same photo.
    if (Object.keys(dbImages).length > 0 && Array.isArray(results)) {
      results.forEach((r, idx) => {
        if (r.variantId && dbImages[r.variantId]) {
          const dbImgs = filterValidImages(dbImages[r.variantId]);
          if (dbImgs.length > 0) {
            // DB images replace local params images since they are the same photos uploaded
            map[idx] = dbImgs;
            log.debug(`[userImagesByIndex] P1: Replaced with DB images for index ${idx}:`, dbImgs.length);
          }
        }
      });
    }

    // Priority 2: Images from current form state (Restored Draft)
    // This ensures that if we loaded a draft JSON that has images, they show up!
    if (displayedPlatforms) {
      const keys = Object.keys(displayedPlatforms);
      const canonicalKey = keys.includes('shopify') ? 'shopify' : keys[0];
      if (canonicalKey) {
        const p = displayedPlatforms[canonicalKey];
        const draftImages = filterValidImages(p.images || p.imageUris || []);
        if (draftImages.length > 0) {
          const idx = (effectiveResult?.productIndex as number) ?? 0;
          // Merge with existing images if any, avoiding duplicates
          const existing = map[idx] || [];
          const merged = Array.from(new Set([...existing, ...draftImages]));
          map[idx] = merged;
          log.debug(`[userImagesByIndex] P2: Merged draft images for index ${idx}:`, draftImages.length, 'Total:', merged.length);
        }
      }
    }

    return map;
  }, [results, dbImages, route.params, updateCounter]);
  useEffect(() => {
    const res = (Array.isArray(results) && results.length > 0)
      ? ((results as GeneratedResult[]).find((r: any) => r.productIndex === currentProductIndex) || results[0])
      : null;
    if (!res || !res.platforms) return;

    // Only hydrate if this is new data (different jobId or product index)
    const currentJobId = `${jobId || 'job'}-${currentProductIndex}-${JSON.stringify({
      platforms: res.platforms,
      draftReadyAt: res.draftReadyAt,
      enrichment: res.enrichment,
    })}`;
    if (lastHydratedJobRef.current === currentJobId) {
      log.debug('[GEN-DETAILS] Skipping re-hydration - same job/item');
      return;
    }

    const rawPlatforms = res.platforms;
    log.debug('[GEN-DETAILS] Hydrating new data. JobId:', currentJobId);
    log.debug('[GEN-DETAILS] Raw platforms from backend:', rawPlatforms);

    // Normalize each platform for ListingEditorForm compatibility
    const normalized: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawPlatforms)) {
      normalized[key] = normalizeForListingEditor(value);
    }

    log.debug('[GEN-DETAILS] Normalized platforms:', Object.keys(normalized));

    // CRITICAL: If backend didn't send shopify, create it from first available platform
    // This ensures canonicalKey (which prefers shopify) has data to display
    if (!normalized.shopify && Object.keys(normalized).length > 0) {
      const firstPlatformKey = Object.keys(normalized)[0];
      const firstPlatformData = normalized[firstPlatformKey];
      log.debug('[GEN-DETAILS] Backend missing shopify - creating canonical from:', firstPlatformKey);

      // Create shopify with core fields from first platform
      // Handle various image field names across platforms
      const rawImageUrls = firstPlatformData.images ||
        firstPlatformData.imageUrls ||
        firstPlatformData.imageUrl ||
        firstPlatformData.image_link ||
        firstPlatformData.picURL ||
        (res.sourceImageUrl ? [res.sourceImageUrl] : []);

      // Filter out empty strings, null, undefined values to prevent gray placeholder images
      const imageUrls = (Array.isArray(rawImageUrls) ? rawImageUrls : (rawImageUrls ? [rawImageUrls] : []))
        .filter((url: any) => typeof url === 'string' && url.trim().length > 0);

      normalized.shopify = {
        title: firstPlatformData.title || firstPlatformData.name || '',
        description: firstPlatformData.description || '',
        // price intentionally omitted — we don't autofill a price from generation.
        sku: firstPlatformData.sku || '',
        barcode: firstPlatformData.barcode || '',
        weight: firstPlatformData.weight || 0,
        weightUnit: firstPlatformData.weightUnit || 'kg',
        tags: firstPlatformData.tags || [],
        images: imageUrls,
        // Carry the backend's pre-computed enrichment onto the synthesized canonical so it
        // isn't lost when generation didn't send a shopify platform — otherwise the product
        // reopens with no category / pricing band / shipping estimate (the "it's not there" bug).
        categorySuggestion: firstPlatformData.categorySuggestion,
        categoryPath: firstPlatformData.categoryPath,
        category: firstPlatformData.category,
        productCategory: firstPlatformData.productCategory,
        taxonomyConfidence: firstPlatformData.taxonomyConfidence,
        taxonomySource: firstPlatformData.taxonomySource,
        aiPriceRecommendation: firstPlatformData.aiPriceRecommendation,
        aiRecommendedPrice: firstPlatformData.aiRecommendedPrice,
        estimatedDimensions: firstPlatformData.estimatedDimensions,
        estimatedWeight: firstPlatformData.estimatedWeight,
        shippingTier: firstPlatformData.shippingTier,
        shippingTierReason: firstPlatformData.shippingTierReason,
      };
    }

    // Do NOT autofill price from generation. Strip the backend price (and per-variant /
    // per-location price) from the incoming data BEFORE the merge, so any price the seller
    // already set is preserved while no generated price is introduced. The AI/research
    // suggestion metadata (aiPriceRecommendation / aiRecommendedPrice) is kept so the Price
    // sheet can still OFFER a suggestion on demand — the seller pulls it when ready.
    for (const key of Object.keys(normalized)) {
      const pd = normalized[key];
      if (!pd || typeof pd !== 'object') continue;
      delete pd.price;
      if (Array.isArray(pd.variants)) {
        pd.variants = pd.variants.map((v: any) => {
          if (!v || typeof v !== 'object') return v;
          const { price: _vp, ...restV } = v;
          if (restV.inventoryByLocation && typeof restV.inventoryByLocation === 'object') {
            restV.inventoryByLocation = Object.fromEntries(
              Object.entries(restV.inventoryByLocation).map(([locId, loc]: [string, any]) => {
                if (!loc || typeof loc !== 'object') return [locId, loc];
                const { price: _lp, ...restLoc } = loc;
                return [locId, restLoc];
              }),
            );
          }
          return restV;
        });
      }
    }

    const baselineKey = typeof res.productIndex === 'number' ? res.productIndex : currentProductIndex;
    if (!draftBaselineByProductRef.current[baselineKey]) {
      draftBaselineByProductRef.current[baselineKey] = JSON.parse(JSON.stringify(normalized));
    }

    // Re-hydration must MERGE UNDER the seller's saved draft. On a fresh mount platformsRef
    // is EMPTY, so passing it as the "preserve edits" base let the generated data clobber
    // every edit (price, category, …) each time they navigated back — the autosave was
    // writing fine, but re-hydration overwrote it on the way back in. Load the local draft
    // first and use it as the existing edits (which win in the smart-merge).
    const hydrationGeneration = editorGenerationRef.current;
    const hydrationSessionKey = editorSessionKey;
    const wasEmptyAtRequest = Object.keys(platformsRef.current || {}).length === 0;
    (async () => {
      let existing: any = platformsRef.current;
      if (!existing || Object.keys(existing).length === 0) {
        const vId = (route.params as any)?.variantId || (res as any)?.variantId;
        const k = vId ? `gen-draft:v:${vId}` : (jobId ? `gen-draft:j:${jobId}:${currentProductIndex}` : null);
        if (k) {
          try {
            const raw = await AsyncStorage.getItem(k);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.draftData && Object.keys(parsed.draftData).length > 0) existing = parsed.draftData;
            }
          } catch { /* ignore */ }
        }
      }
      if (hydrationGeneration !== editorGenerationRef.current || hydrationSessionKey !== lastEditorSessionKeyRef.current) return;
      // If the request began against an empty editor but the seller typed while
      // AsyncStorage was in flight, merge under the CURRENT values instead of
      // replacing them with the request-time empty snapshot.
      const draftMerged = hydratePlatformsFromBackend(normalized, existing);
      const hydrated = wasEmptyAtRequest && Object.keys(platformsRef.current || {}).length > 0
        ? hydratePlatformsFromBackend(draftMerged, platformsRef.current)
        : draftMerged;
      const enriched = applyProgressiveEnrichment(
        draftBaselineByProductRef.current[baselineKey] || normalized,
        hydrated,
        res.enrichment,
      );
      log.debug('[GEN-DETAILS] Hydrated platforms (draft-merged):', Object.keys(enriched));
      updatePlatforms(() => enriched);
      lastHydratedJobRef.current = currentJobId;
    })();
  }, [results, jobId, currentProductIndex, editorSessionKey]);


  // ========== AUTO-SAVE: local-first, backend when possible ==========
  // Persists every edit to AsyncStorage immediately (so a freshly-generated item that has NO
  // variantId yet still saves + survives reload), then syncs to /api/products/drafts once a
  // variantId exists. This is why edits previously "didn't save" — the old effect bailed out
  // when there was no variantId.
  const variantIdForDraft = (route.params as any)?.variantId || (Array.isArray(results) && results.length > 0 ? ((results as any[]).find((r: any) => r.productIndex === currentProductIndex) || results[0])?.variantId : undefined);
  const draftKey = variantIdForDraft
    ? `gen-draft:v:${variantIdForDraft}`
    : (jobId ? `gen-draft:j:${jobId}:${currentProductIndex}` : null);
  const sendSerializedDraft = useCallback<SerializedSaveSender>(async (_sendToken, isLatest) => {
    if (!draftKey || !platformsRef.current || Object.keys(platformsRef.current).length === 0) return true;
    const currentJson = JSON.stringify(platformsRef.current);
    if (currentJson === lastSavedRef.current) return true;

    // Freeze exactly what this send represents. Both storage targets and the
    // Saved indicator use this same immutable snapshot.
    const snapshot = JSON.parse(currentJson);
    const mediaSnapshot = buildPlatformPayloadRef.current().media;
    const sendEditVersion = draftEditVersionRef.current;
    const sendGeneration = editorGenerationRef.current;
    const sendSessionKey = editorSessionKey;
    const responseIsCurrent = () => isLatest()
      && sendGeneration === editorGenerationRef.current
      && sendSessionKey === lastEditorSessionKeyRef.current;

    try {
      if (responseIsCurrent()) setSaveState('saving');
      await AsyncStorage.setItem(draftKey, JSON.stringify({ draftData: snapshot, savedAt: Date.now() }));

      const variantId = variantIdForDraft;
      if (variantId) {
        const baseUrl = API_BASE_URL;
        const authToken = await ensureSupabaseJwt();
        if (!baseUrl) throw new Error('Backend draft save is unavailable');
        if (!authToken) throw new Error('Not signed in. Draft not saved');
        const response = await apiFetch(`/api/products/drafts/${variantId}`, {
          method: 'POST',
          body: { draftData: snapshot, media: mediaSnapshot },
        });
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend draft failed (${response.status}): ${errorText}`);
        }
      }

      if (responseIsCurrent()) {
        lastSavedRef.current = currentJson;
        lastScheduledRef.current = null;
        setSaveState(draftEditVersionRef.current === sendEditVersion ? 'saved' : 'idle');
      }
      log.debug('[GEN-DETAILS AutoSave] ✅ Saved', variantId ? '(local + backend)' : '(local)');
      return true;
    } catch (error) {
      log.error('[GEN-DETAILS AutoSave] ❌ Error:', error);
      if (responseIsCurrent()) {
        lastScheduledRef.current = null;
        setSaveState('error');
      }
      return false;
    }
  }, [draftKey, variantIdForDraft, editorSessionKey]);

  const requestDraftSave = useLatestSaveSerializer(sendSerializedDraft);
  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    return requestDraftSave();
  }, [requestDraftSave]);

  useEffect(() => {
    if (!draftKey || !platformsRef.current || Object.keys(platformsRef.current).length === 0) return;
    const currentJson = JSON.stringify(platformsRef.current);
    if (currentJson === lastSavedRef.current) return;
    if (lastScheduledRef.current !== null && lastScheduledRef.current === currentJson) return;
    lastScheduledRef.current = currentJson;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => { void flushDraft(); }, 1200);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [draftKey, variantIdForDraft, updateCounter, flushDraft]);

  useEffect(() => {
    const flush = () => { void flushDraft(); };
    const removeBeforeRemove = navigation.addListener('beforeRemove', flush);
    const removeBlur = navigation.addListener('blur', flush);
    return () => {
      removeBeforeRemove();
      removeBlur();
      flush();
    };
  }, [navigation, flushDraft]);

  // Restore a local draft on mount when nothing has hydrated yet (covers unsaved, no-variantId
  // items that the backend draft-load can't reach).
  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;
    const restoreGeneration = editorGenerationRef.current;
    const restoreSessionKey = editorSessionKey;
    (async () => {
      try {
        if (platformsRef.current && Object.keys(platformsRef.current).length > 0) return;
        const raw = await AsyncStorage.getItem(draftKey);
        if (cancelled || !raw) return;
        if (restoreGeneration !== editorGenerationRef.current || restoreSessionKey !== lastEditorSessionKeyRef.current) return;
        const parsed = JSON.parse(raw);
        if (parsed?.draftData && Object.keys(parsed.draftData).length > 0) {
          platformsRef.current = Object.keys(platformsRef.current || {}).length > 0
            ? hydratePlatformsFromBackend(parsed.draftData, platformsRef.current)
            : parsed.draftData;
          lastSavedRef.current = JSON.stringify(parsed.draftData);
          forceUpdate({});
          log.debug('[GEN-DETAILS AutoSave] ↩︎ Restored local draft');
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [draftKey, editorSessionKey]);
  const platformKeys: string[] = useMemo(() => Object.keys(displayedPlatforms as Record<string, any>), [displayedPlatforms]);
  // Chat-style item switcher dropdown (replaces the old bulk ItemJobsModal here)
  const [itemMenuOpen, setItemMenuOpen] = useState(false);
  const [userGenerateJobs, setUserGenerateJobs] = useState<Array<{ jobId: string; status: string; createdAt: string; completedAt?: string }>>([]);
  const [checklist, setChecklist] = useState<Record<string, { missing: string[]; ready: boolean }>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMounted, setScannerMounted] = useState(false);
  const scannerHeight = useRef(new Animated.Value(0)).current;
  const [missingFieldsModalOpen, setMissingFieldsModalOpen] = useState<boolean>(false);
  const [selectedMissingPlatform, setSelectedMissingPlatform] = useState<string>('');
  const [fieldSearchQuery, setFieldSearchQuery] = useState<string>('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'Core Fields': false,
    'SEO': false,
    'Google Shopping': false,
    'Listing Details': false,
    'Shipping Details': false,
    'Return Policy': false
  });
  const [quickFixLoading, setQuickFixLoading] = useState(false);
  // Quick-fix shows the change as a diff to accept (Keep original / Use this) — never a silent overwrite.
  const [quickFixDiff, setQuickFixDiff] = useState<{
    fixes: Record<string, any>;
    userQuery: string;
    changes: Array<{ platform: string; field: string; before: any; after: any }>;
  } | null>(null);

  const applyQuickFix = () => {
    const diff = quickFixDiff;
    if (!diff) return;
    updatePlatforms(prev => {
      const updated = { ...prev };
      for (const [platform, fieldChanges] of Object.entries(diff.fixes as Record<string, any>)) {
        const accepted: Record<string, any> = {};
        for (const [field, value] of Object.entries(fieldChanges as Record<string, any>)) {
          const basedOn = diff.changes.find((change) => change.platform === platform && change.field === field)?.before;
          const current = (prev[platform] as any)?.[field];
          if (JSON.stringify(current) === JSON.stringify(basedOn)) accepted[field] = value;
        }
        if (Object.keys(accepted).length === 0) continue;
        updated[platform] = {
          ...(updated[platform] || {}),
          ...accepted,
          __refilled: Array.from(new Set([
            ...((updated[platform] as any)?.__refilled || []),
            ...Object.keys(accepted),
          ])),
        };
      }
      return updated;
    });
    setQuickFixDiff(null);
    setQuickFixText('');
  };

  const formatDiffValue = (v: any): string => {
    if (v == null || v === '') return 'Not set';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [allConnections, setAllConnections] = useState<any[]>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Record<string, string>>({});
  const [platformLocations, setPlatformLocations] = useState<Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string; platformType: string }>>>({});
  const [mediaModalVisible, setMediaModalVisible] = useState(false);
  const [selectedVariantForMedia, setSelectedVariantForMedia] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const pendingPublishNavigationRef = useRef<null | (() => void)>(null);
  const finishPendingPublishNavigation = useCallback(() => {
    const navigate = pendingPublishNavigationRef.current;
    if (!navigate) return;
    pendingPublishNavigationRef.current = null;
    setIsPublishing(false);
    navigate();
  }, []);

  // React Native's Modal onDismiss is iOS-only. On Android, visible=false is
  // committed before this effect runs, so it is safe to perform the handoff.
  useEffect(() => {
    if (Platform.OS !== 'ios' && !publishModalOpen) {
      finishPendingPublishNavigation();
    }
  }, [finishPendingPublishNavigation, publishModalOpen]);
  const openScanner = (onResult: (code: string) => void) => {
    scannerHeight.stopAnimation();
    scannerHeight.setValue(0);
    setScannerMounted(true);
    setScannerOpen(true);
    (GenerateDetailsScreen as any)._scannerResultHandler = onResult;
    Animated.spring(scannerHeight, {
      toValue: SCANNER_GROW_HEIGHT,
      speed: 18,
      bounciness: 6,
      useNativeDriver: false,
    }).start();
  };

  const closeScanner = () => {
    setScannerOpen(false);
    (GenerateDetailsScreen as any)._scannerResultHandler = null;
    scannerHeight.stopAnimation();
    Animated.timing(scannerHeight, {
      toValue: 0,
      duration: SCANNER_CLOSE_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) {
        setScannerMounted(false);
      }
    });
  };

  // Fetch connections and locations on mount
  useEffect(() => {
    (async () => {
      try {
        const baseUrl = API_BASE_URL;
        const token = await ensureSupabaseJwt();
        if (!baseUrl || !token) return;

        const connRes = await apiFetch('/api/platform-connections');
        let connections = connRes.ok ? await connRes.json() : [];
        setAllConnections(connections);

        // ⚡ OPTIMIZED: Query PlatformLocations directly from DB instead of calling sync endpoint
        log.debug('[GenerateDetails] ⚡ Loading locations directly from PlatformLocations table...');

        const connectionIds = connections.map((c: any) => c.Id);
        if (connectionIds.length === 0) {
          log.debug('[GenerateDetails] No connections found');
          setPlatformLocations({});
          return;
        }

        // Query PlatformLocations directly from Supabase
        const { data: platformLocs, error } = await supabase
          .from('PlatformLocations')
          .select('PlatformConnectionId, PlatformLocationId, Name')
          .in('PlatformConnectionId', connectionIds);

        if (error) {
          log.error('[GenerateDetails] Failed to query PlatformLocations:', error);
          setPlatformLocations({});
          return;
        }

        log.debug('[GenerateDetails] ✅ Retrieved', platformLocs?.length || 0, 'locations from DB in <1s');

        // Build map: connectionId -> location objects
        const locsByConnection = new Map<string, Array<{ id: string; name: string }>>();
        for (const loc of platformLocs || []) {
          if (!locsByConnection.has(loc.PlatformConnectionId)) {
            locsByConnection.set(loc.PlatformConnectionId, []);
          }
          locsByConnection.get(loc.PlatformConnectionId)!.push({
            id: loc.PlatformLocationId,
            name: loc.Name || 'Unnamed Location'
          });
        }

        // Extract locations by platform type
        const locsByPlatform: Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string; platformType: string }>> = {};
        for (const conn of connections) {
          const platform = conn.PlatformType?.toLowerCase();
          if (!platform || !conn.IsEnabled) continue;

          const locs = locsByConnection.get(conn.Id) || [];
          if (!locsByPlatform[platform]) locsByPlatform[platform] = [];

          for (const loc of locs) {
            locsByPlatform[platform].push({
              ...loc,
              connectionId: conn.Id,
              connectionName: conn.DisplayName || conn.PlatformType,
              platformType: platform
            });
          }
        }

        log.debug('[GenerateDetails] Built platform locations:', Object.keys(locsByPlatform).map(p => `${p}: ${locsByPlatform[p].length} locs`));
        setPlatformLocations(locsByPlatform);

        // ⚡ FIX: Ensure ALL enabled platforms appear in displayedPlatforms for publishing
        // Even if AI generation didn't produce data for a platform, user should be able to publish to it
        const enabledPlatformTypes = [...new Set(
          connections
            .filter((c: any) => c.IsEnabled && c.Status === 'active')
            .map((c: any) => c.PlatformType?.toLowerCase())
        )];

        log.debug('[GenerateDetails] Enabled platforms from connections:', enabledPlatformTypes);

        // ONLY add platform entries for platforms that don't already exist in displayedPlatforms
        // (via hydration from generate job results). This prevents empty columns for unselected platforms.
        // We DON'T want to auto-add ALL enabled platforms - only those actually generated for.
        const currentPlatforms = platformsRef.current;
        const updatedPlatforms = { ...currentPlatforms };
        let added = false;

        // Only add platforms that ALREADY exist in displayedPlatforms (from generate results)
        // but need locations hydrated
        for (const pt of Object.keys(currentPlatforms)) {
          if (pt && typeof pt === 'string' && locsByPlatform[pt]) {
            const platformLocs = locsByPlatform[pt] || [];
            if (platformLocs.length > 0 && (!updatedPlatforms[pt].locations || updatedPlatforms[pt].locations.length === 0)) {
              updatedPlatforms[pt] = {
                ...updatedPlatforms[pt],
                locations: platformLocs,
              };
              log.debug(`[GenerateDetails] Hydrated locations for existing platform: ${pt}`);
              added = true;
            }
          }
        }

        if (added) {
          updatePlatforms(() => updatedPlatforms);
        }
      } catch (e) {
        log.error('Failed to fetch connections/locations:', e);
      }
    })();
  }, []);


  // Get shared JobsContext for cross-screen state sync (defined early to avoid a TDZ crash on web)
  const jobsContext = useJobsOptional();

  // Items for the switcher. Canonical path: ID-BASED handoff (itemIds param) resolved
  // from cart$ — no array-index coupling. Legacy index-shaped params are the fallback.
  const items = useMemo(() => {
    const contextMatchJobId = jobsContext?.matchJobId;
    const effectiveMatchJobId = matchJobId || contextMatchJobId;
    const itemIdsParam = (route.params as any)?.itemIds as string[] | undefined;
    if (Array.isArray(itemIdsParam) && itemIdsParam.length > 0) {
      return resolveItemsFromIds(itemIdsParam, effectiveMatchJobId);
    }
    const raw = ((route.params as any)?.items || []) as Array<{ index: number; title?: string; thumb?: string; matchesCount?: number; matchJobId?: string }>;
    const normalized = (Array.isArray(raw) ? raw : []).map((it, i) => ({
      index: it.index ?? i,
      title: it.title ?? `Item ${i + 1}`,
      thumb: it.thumb ?? '',
      matchesCount: it.matchesCount ?? 0,
      matchJobId: it.matchJobId ?? effectiveMatchJobId, // Fallback to effective matchJobId
    }));
    if (normalized.length) return normalized;
    // Build from results if items not passed
    const fallback = Array.isArray(results) ? results.map((r, i) => ({
      index: r.productIndex ?? i,
      title: `Item ${i + 1}`,
      thumb: r.sourceImageUrl || '',
      matchesCount: 0,
      matchJobId: effectiveMatchJobId // Use effective matchJobId for fallback items
    })) : [];
    if (fallback.length) return fallback;
    return [{
      index: first?.productIndex ?? 0,
      title: 'Item 1',
      thumb: first?.sourceImageUrl || '',
      matchesCount: 0,
      matchJobId: matchJobId // Use global matchJobId for single item
    }];
  }, [route.params, first, results, matchJobId]);

  useEffect(() => {
    // Canonical: focus by item ID (index derived from the itemIds order).
    const focusItemIdParam = (route.params as any)?.focusItemId as string | undefined;
    const itemIdsParam = (route.params as any)?.itemIds as string[] | undefined;
    if (focusItemIdParam && Array.isArray(itemIdsParam)) {
      const idIdx = itemIdsParam.indexOf(focusItemIdParam);
      if (idIdx >= 0) {
        setCurrentProductIndex(idIdx);
        return;
      }
    }
    const focusIndexParam = (route.params as any)?.focusIndex;
    if (typeof focusIndexParam === 'number' && Number.isFinite(focusIndexParam)) {
      setCurrentProductIndex(focusIndexParam);
      return;
    }
    const idx = (first?.productIndex as number) ?? items[0]?.index ?? 0;
    setCurrentProductIndex(idx);
  }, [first?.productIndex, items[0]?.index, (route.params as any)?.focusIndex, (route.params as any)?.focusItemId]);

  // Per-index generate jobs: derived live from cart$ when the handoff is id-based
  // (jobs attach to items after navigation), with the param jobMap as fallback.
  const jobMap = useMemo(() => {
    const fromParams = ((route.params as any)?.jobMap || {}) as Record<number, { jobId: string; status?: string }>;
    const ids = (route.params as any)?.itemIds as string[] | undefined;
    return Array.isArray(ids) && ids.length > 0 ? resolveJobMapFromIds(ids, fromParams) : fromParams;
  }, [route.params]);
  const hasGenerateForIndex = useMemo(() => (idx: number) => Boolean(jobMap[idx]?.jobId), [jobMap]);

  const hasMultipleResults = Array.isArray(results) && results.length > 1;
  const currentResult: GeneratedResult | null = useMemo(
    () => (Array.isArray(results) && results.length > 0
      ? (results as GeneratedResult[]).find((r: any) => r.productIndex === currentProductIndex) || results[0]
      : null),
    [results, currentProductIndex]
  );
  const effectiveResult = hasMultipleResults ? currentResult : first;
  const currentItemId = useMemo(() => {
    const currentRow = items.find((item) => item.index === currentProductIndex) as { itemId?: string } | undefined;
    if (currentRow?.itemId) return currentRow.itemId;
    const ids = (route.params as any)?.itemIds as string[] | undefined;
    return ids?.[currentProductIndex];
  }, [currentProductIndex, items, route.params]);
  const currentCartItem = useMemo(
    () => (currentItemId ? selectItem(currentItemId) : undefined),
    [currentItemId],
  );
  const carriedPricingResearch = useMemo(() => {
    const selectedCandidateIndex = currentCartItem?.match?.jobResult?.selectedCandidateIndex
      ?? currentCartItem?.match?.confirmed?.preSelectedIndices?.[0]
      ?? 0;
    return selectStoredPricingResearch([
      (effectiveResult as any)?.pricingSnapshot,
      (effectiveResult as any)?.pricingResearch,
      currentCartItem?.pricing,
      currentCartItem?.match?.jobResult?.pricingSnapshot,
      currentCartItem?.match?.response?.rankedCandidates?.[selectedCandidateIndex],
      currentCartItem?.match?.matchRows?.[selectedCandidateIndex],
    ]);
  }, [currentCartItem, effectiveResult]);
  const [fetchedPricingResearch, setFetchedPricingResearch] = useState<unknown | null>(null);
  const storedMatchJobId = currentCartItem?.generateMatchJobId
    || items.find((item) => item.index === currentProductIndex)?.matchJobId
    || matchJobId;

  useEffect(() => {
    let active = true;
    setFetchedPricingResearch(null);
    if (carriedPricingResearch || !storedMatchJobId) return () => { active = false; };

    const productIndex = (effectiveResult?.productIndex as number | undefined) ?? currentProductIndex;
    void (async () => {
      try {
        const response = await apiFetch(`/api/products/match/jobs/${storedMatchJobId}/results`);
        if (!response.ok) return;
        const payload = await response.json();
        const result = Array.isArray(payload?.results)
          ? payload.results.find((row: any) => row?.productIndex === productIndex)
          : null;
        const selectedCandidateIndex = result?.selectedCandidateIndex ?? 0;
        const research = selectStoredPricingResearch([
          result?.pricingSnapshot,
          result?.rerankedResults?.[selectedCandidateIndex],
          result?.matchRows?.[selectedCandidateIndex],
        ]);
        if (active && research) setFetchedPricingResearch(research);
      } catch (error) {
        log.debug('[GenerateDetails] Stored pricing research was unavailable:', error);
      }
    })();

    return () => { active = false; };
  }, [carriedPricingResearch, currentProductIndex, effectiveResult?.productIndex, storedMatchJobId]);

  const storedPricingResearch = carriedPricingResearch || fetchedPricingResearch;
  const enrichmentStatus = effectiveResult?.enrichment?.status
    ?? (effectiveResult?.draftReady && status !== 'completed' ? 'pending' : undefined);
  const enrichmentStateLabel = enrichmentLabel(enrichmentStatus);

  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [ignoredPlatforms, setIgnoredPlatforms] = useState<string[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [bottomNavState, setBottomNavState] = useState<'empty' | 'selection' | 'template' | 'platform'>('empty');
  const [itemGenerateJobs, setItemGenerateJobs] = useState<Record<number, { jobId: string; status?: string }>>(jobMap || {});

  // ── Item switcher (chat-style) ──────────────────────────────────────────
  // One simple mental model: the header pill shows where you are; tapping it
  // lists the cart's items with live generation status. No multi-select, no
  // batch ops, no match re-entry — matching was confirmed before checkout.
  const hasResultForIndex = useMemo(
    () => (idx: number) => Array.isArray(results) && (results as GeneratedResult[]).some((r: any) => r.productIndex === idx),
    [results]
  );
  const itemStatusForIndex = (idx: number): { label: string; color: string } => {
    const s = itemGenerateJobs[idx]?.status;
    if (s === 'failed' || s === 'cancelled') return { label: 'Generation failed', color: CHAT_COLORS.error };
    if (s === 'completed' || hasResultForIndex(idx)) return { label: 'Ready to review', color: CHAT_COLORS.success };
    if (s === 'processing' || s === 'queued') return { label: 'Generating…', color: CHAT_COLORS.warning };
    if (s) return { label: 'Generating…', color: CHAT_COLORS.warning };
    return { label: 'Queued', color: CHAT_COLORS.idle };
  };
  const switchToItem = (idx: number) => {
    setItemMenuOpen(false);
    if (idx === currentProductIndex) return;
    void flushDraft();
    const targetJobId = itemGenerateJobs[idx]?.jobId;
    if (targetJobId && jobId && targetJobId !== jobId && !hasResultForIndex(idx)) {
      // Item lives on a different generate job — reload this screen against it.
      // Interstitial deprecated: re-open GenerateDetails in its processing state
      // (it polls the job and shows "Generating…" inline) instead of routing
      // through the full-screen LoadingScreen.
      navigation.replace('GenerateDetailsScreen' as any, {
        jobId: targetJobId,
        status: 'processing',
        items,
        jobMap: itemGenerateJobs,
        focusIndex: idx,
      });
      return;
    }
    // Same job (batched results) — just refocus and re-hydrate in place.
    lastHydratedJobRef.current = null;
    setCurrentProductIndex(idx);
    setSelectedIndices([]);
    setSelectedPlatforms([]);
    setSelectedTemplate(null);
    setBottomNavState('empty');
  };
  const currentItemPosition = useMemo(() => {
    const pos = items.findIndex((it: any) => it.index === currentProductIndex);
    return pos >= 0 ? pos + 1 : 1;
  }, [items, currentProductIndex]);
  const currentItemTitle = useMemo(() => {
    const total = items.length || 1;
    // Multi-item batch → show position/total ("Item 1/4"); single item → its title.
    if (total > 1) return `Item ${currentItemPosition}/${total}`;
    const it: any = items.find((i: any) => i.index === currentProductIndex);
    const raw = (it?.title || '').trim();
    return raw && !/^item \d+$/i.test(raw) ? raw : `Item ${currentItemPosition}`;
  }, [items, currentProductIndex, currentItemPosition]);

  // Initialize from generate job only when we didn't navigate with items/jobMap (e.g. deep link)
  // When we have items from params (came from Match), don't call - avoids loading "most recent" match job and mixing jobs
  useEffect(() => {
    if (!jobsContext || !jobId) return;
    if (jobsContext.items.length > 0) return;
    const fromParams = (route.params as any) || {};
    const hasItemsFromParams = Array.isArray(fromParams.items) && fromParams.items.length > 0;
    if (hasItemsFromParams) return;
    jobsContext.initializeFromGenerateJob(jobId);
  }, [jobsContext, jobId, route.params]);

  // Ref to track which direction we're syncing to prevent infinite loops
  const syncDirectionRef = useRef<'none' | 'context-to-local' | 'local-to-context'>('none');

  // Sync with JobsContext - merge context state into local only when context is for THIS match job
  useEffect(() => {
    if (!jobsContext || !matchJobId) return;
    if (jobsContext.matchJobId !== matchJobId) return;
    // Prevent infinite loop: don't sync back if we just synced to context
    if (syncDirectionRef.current === 'local-to-context') {
      syncDirectionRef.current = 'none';
      return;
    }

    // If context has generate jobs for this match job, merge into local state
    if (Object.keys(jobsContext.generateJobs).length > 0) {
      syncDirectionRef.current = 'context-to-local';
      setItemGenerateJobs(prev => {
        const merged = { ...prev };
        let hasChanges = false;
        Object.entries(jobsContext.generateJobs).forEach(([indexStr, genJob]: [string, any]) => {
          const idx = parseInt(indexStr, 10);
          if (!merged[idx] || (genJob.status === 'completed' && merged[idx].status !== 'completed')) {
            merged[idx] = { jobId: genJob.jobId, status: genJob.status };
            hasChanges = true;
          }
        });
        // Only update if there are actual changes
        return hasChanges ? merged : prev;
      });
    }
  }, [jobsContext?.generateJobs, jobsContext?.matchJobId, matchJobId]); // Use specific property, not entire context

  // Sync local itemGenerateJobs changes to context
  useEffect(() => {
    if (!jobsContext) return;
    // Prevent infinite loop: don't sync back if we just synced from context
    if (syncDirectionRef.current === 'context-to-local') {
      syncDirectionRef.current = 'none';
      return;
    }

    let didUpdate = false;
    Object.entries(itemGenerateJobs).forEach(([indexStr, job]) => {
      const idx = parseInt(indexStr, 10);
      const contextJob = jobsContext.generateJobs[idx];
      // Update context if local has newer/different state
      if (!contextJob || contextJob.jobId !== job.jobId || contextJob.status !== job.status) {
        if (!contextJob) {
          jobsContext.startGenerateJob(idx, job.jobId);
          didUpdate = true;
        }
        if (job.status) {
          jobsContext.updateGenerateJob(idx, { status: job.status as any });
          didUpdate = true;
        }
      }
    });
    if (didUpdate) {
      syncDirectionRef.current = 'local-to-context';
    }
  }, [itemGenerateJobs]); // Remove jobsContext from deps - it's stable

  // Decide which platforms to publish and compute inventory per platform for confirmation
  const platformsToPublish = useMemo<string[]>(() => {
    if (selectedPlatforms.length) return selectedPlatforms;
    const ready = Object.entries(checklist || {}).filter(([, v]) => v?.ready).map(([k]) => k);
    if (ready.length) return ready;
    return Object.keys(displayedPlatforms || {});
  }, [selectedPlatforms, checklist, displayedPlatforms]);

  const effectivePlatformsToPublish = useMemo<string[]>(() => {
    return platformsToPublish.filter(p => !ignoredPlatforms.includes(p));
  }, [platformsToPublish, ignoredPlatforms]);

  const quantityByPlatformComputed = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const key of platformsToPublish) {
      const p: any = (displayedPlatforms as any)?.[key] || {};
      let total = 0;
      let hasQuantity = false;
      if (Array.isArray(p.variants) && p.variants.length) {
        for (const v of p.variants) {
          const inv = v?.inventoryByLocation;
          if (inv && typeof inv === 'object') {
            Object.values(inv).forEach((loc: any) => {
              if (loc?.quantity === undefined || loc?.quantity === null || loc?.quantity === '') return;
              const q = Number(loc.quantity);
              if (Number.isFinite(q)) {
                hasQuantity = true;
                total += q;
              }
            });
          }
        }
      }
      if (!hasQuantity) {
        const candidates = [p.quantity, p.inventoryQuantity, p?.listingDetails?.quantity, p?.locationQuantities?.default];
        for (const c of candidates) {
          if (c === undefined || c === null || c === '') continue;
          const parsed = Number(c);
          if (Number.isFinite(parsed)) {
            total = parsed;
            hasQuantity = true;
            break;
          }
        }
      }
      if (hasQuantity) out[key] = total;
    }
    return out;
  }, [platformsToPublish, displayedPlatforms]);
  // Update checklist when displayed platforms change (using flexible pricing)
  useEffect(() => {
    const next: Record<string, { missing: string[]; ready: boolean }> = {};

    for (const key of Object.keys(displayedPlatforms)) {
      const data = displayedPlatforms[key] || {};
      const missing: string[] = [];

      // Title is required
      if (isEmpty(data.title)) {
        missing.push('title');
      }

      // SKU is required
      if (isEmpty(data.sku)) {
        missing.push('sku');
      }

      // Price: flexible (flat OR all variants)
      if (!hasPlatformPrice(data)) {
        missing.push('price');
      }

      // Images (optional but good practice)
      // Not blocking, just informational

      next[key] = { missing, ready: missing.length === 0 };
    }

    setChecklist(next);
  }, [displayedPlatforms]);


  // Fetch user's generate jobs for modal display (counts and last generated timestamps)
  useEffect(() => {
    let canceled = false;
    (async () => {
      try {
        const baseUrl = API_BASE_URL;
        if (!baseUrl) return;
        const token = await ensureSupabaseJwt();
        const res = await fetch(`${baseUrl}/api/products/generate/jobs?limit=50`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!canceled && Array.isArray(data?.jobs)) {
          const jobs = data.jobs.map((j: any) => ({ jobId: j.jobId, status: j.status, createdAt: j.createdAt, completedAt: j.completedAt }));
          setUserGenerateJobs(jobs);

          // Update itemGenerateJobs with the latest job data for each product index
          const jobsByIndex: Record<number, { jobId: string; status?: string }> = {};

          // First, include any jobs passed in via jobMap
          Object.entries(jobMap || {}).forEach(([indexStr, jobInfo]) => {
            const idx = parseInt(indexStr, 10);
            if (!isNaN(idx)) {
              jobsByIndex[idx] = jobInfo;
            }
          });

          // Then add jobs from the API response
          jobs.forEach((job: any) => {
            // For generate jobs, we need to fetch results to map to indices
            // For now, if current jobId matches, map to current product index
            if (job.jobId === jobId) {
              const currentIdx = (effectiveResult?.productIndex as number) ?? 0;
              jobsByIndex[currentIdx] = { jobId: job.jobId, status: job.status };
            }
          });

          log.debug('[GenerateDetails] Updated jobsByIndex:', jobsByIndex);
          setItemGenerateJobs(jobsByIndex);
        }
      } catch { }
    })();
    return () => { canceled = true };
  }, []);

  // Helper: compute overall readiness with flexible pricing
  // Compute which platforms are ready to publish
  // Photos live in userImagesByIndex (the photo-strip source the publish payload uses), not
  // always mirrored into each platform's `.images`. Treat those shared photos as the
  // platform's images for readiness, else a listing WITH a cover photo is judged "not ready"
  // and Publish is disabled even though it's complete.
  const currentItemImages = useMemo(
    () => userImagesByIndex[(effectiveResult?.productIndex as number) ?? 0] || [],
    [userImagesByIndex, effectiveResult],
  );
  const withSharedImages = useCallback(
    (pd: any) => (Array.isArray(pd?.images) && pd.images.length > 0 ? pd : { ...(pd || {}), images: currentItemImages }),
    [currentItemImages],
  );

  const readyPlatforms = useMemo(() => {
    return platformKeys.filter(platformKey => {
      const platformData = withSharedImages((displayedPlatforms as any)?.[platformKey] || {});
      return isPlatformReady(platformData, platformKey, ignoredPlatforms);
    });
  }, [displayedPlatforms, platformKeys, ignoredPlatforms, withSharedImages]);

  const canPublish = useMemo(() => readyPlatforms.length > 0, [readyPlatforms]);

  // Missing required fields across all non-ignored platforms (drives the "All" pill badge
  // + highlights the first gap). The old < > field-stepper was removed with the XTX-0 bar.
  const allMissingRequiredFields = useMemo(() => {
    const missing: Array<{ platform: string; field: string; label: string }> = [];
    const seenLabels = new Set<string>();
    for (const pk of platformKeys) {
      if (ignoredPlatforms.includes(pk)) continue;
      const platformData = withSharedImages((displayedPlatforms as any)?.[pk] || {});
      const fields = getMissingPlatformFields(platformData, pk);
      for (const f of fields) {
        // Clean up field names for display
        const label = f.replace(/ \(either flat or all variants\)/, '');
        const displayLabel = label.charAt(0).toUpperCase() + label.slice(1);
        if (!seenLabels.has(displayLabel)) {
          seenLabels.add(displayLabel);
          missing.push({ platform: pk, field: f, label: displayLabel });
        }
      }
    }
    return missing;
  }, [displayedPlatforms, platformKeys, ignoredPlatforms, withSharedImages]);

  // Distinct missing required fields mapped to the wizard's step keys — the SINGLE source
  // for the header's "N fields need you" count AND the wizard it opens, so the number, the
  // walked steps, and publish-readiness all agree ('images' → the wizard's 'photos' step).
  const gapFields = useMemo(() => {
    const allowed = ['title', 'description', 'price', 'sku', 'barcode', 'category', 'condition', 'tags', 'weight', 'photos'];
    const mapped = allMissingRequiredFields.map((m) =>
      m.field === 'price (either flat or all variants)' ? 'price' : m.field === 'images' ? 'photos' : m.field,
    );
    return Array.from(new Set(mapped.filter((f) => allowed.includes(f))));
  }, [allMissingRequiredFields]);

  const publishNeedsRows = useMemo(
    () => allMissingRequiredFields.map((missing) => ({
      key: `${missing.platform}:${missing.field}`,
      field: missing.field,
      platform: missing.platform,
      label: missing.label,
      ok: false,
      hint: `${(PLATFORM_META as any)[missing.platform]?.label || missing.platform} needs this`,
    })),
    [allMissingRequiredFields],
  );

  // Per-platform optional listing details for the publish sheet. Required fields still gate
  // publishing; this only supplies plain-language guidance for details that can improve reach.
  const channelOptimization = useMemo(() => {
    const has = {
      seo: (d: any) => !!(d.seoTitle || d.seo?.title || d.seoDescription || d.metaDescription),
      category: (d: any) => !!(d.category || d.categoryName || d.productCategory || d.categorySuggestion || d.categoryId || d.googleProductCategory),
      specifics: (d: any) => {
        const s = d.itemSpecifics || d.aspects || d.attributes;
        return !!s && typeof s === 'object' && Object.keys(s).length >= 2;
      },
      condition: (d: any) => !!(d.condition || d.conditionId || d.conditionDisplayName),
      tags: (d: any) => Array.isArray(d.tags) && d.tags.length > 0,
      brand: (d: any) => !!(d.brand || d.vendor || d.manufacturer),
    };
    const GUIDANCE_FIELDS: Record<string, Array<{ label: string; ok: (d: any) => boolean }>> = {
      shopify: [{ label: 'SEO', ok: has.seo }, { label: 'Collection', ok: has.category }, { label: 'Tags', ok: has.tags }],
      ebay: [{ label: 'Item specifics', ok: has.specifics }, { label: 'Condition', ok: has.condition }, { label: 'Category', ok: has.category }],
      facebook: [{ label: 'Category', ok: has.category }, { label: 'Condition', ok: has.condition }, { label: 'Brand', ok: has.brand }],
      amazon: [{ label: 'Item specifics', ok: has.specifics }, { label: 'Brand', ok: has.brand }, { label: 'Category', ok: has.category }],
      square: [{ label: 'Category', ok: has.category }, { label: 'Tags', ok: has.tags }],
      clover: [{ label: 'Category', ok: has.category }, { label: 'Tags', ok: has.tags }],
    };
    const out: Record<string, { tone: 'good' | 'warn'; label: string; detail: string }> = {};
    for (const pk of platformKeys) {
      const data = (displayedPlatforms as any)?.[pk] || {};
      const list = GUIDANCE_FIELDS[pk] || [{ label: 'Category', ok: has.category }, { label: 'Condition', ok: has.condition }];
      const missing = list.filter((b) => !b.ok(data));
      if (missing.length === 0) {
        out[pk] = { tone: 'good', label: 'Ready', detail: list.slice(0, 2).map((b) => b.label).join(' · ') };
      } else {
        out[pk] = {
          tone: 'warn',
          label: 'Needs details',
          detail: missing.slice(0, 2).map((b) => b.label).join(' · '),
        };
      }
    }
    return out;
  }, [displayedPlatforms, platformKeys]);

  // Helper: get missing fields for a platform
  const getMissingFields = (platformKey: string) => {
    const schema = PLATFORM_FIELD_SCHEMA[platformKey] || {};
    const currentData = displayedPlatforms[platformKey] || {};
    const missing: Array<{ path: string; label: string; type: string; required?: boolean }> = [];

    const checkFields = (obj: any, data: any, prefix = '') => {
      Object.entries(obj).forEach(([key, fieldDef]: [string, any]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        const value = data?.[key];
        const isEmpty = value === undefined || value === null ||
          (typeof value === 'string' && value.trim() === '') ||
          (Array.isArray(value) && value.length === 0);

        if (fieldDef.type === 'object' && fieldDef.schema) {
          // Nested object - check recursively
          checkFields(fieldDef.schema, value || {}, path);
        } else if (fieldDef.type === 'array' && fieldDef.schema) {
          // Array with schema - check if empty or missing
          if (isEmpty) {
            missing.push({
              path,
              label: fieldDef.label || key,
              type: fieldDef.type,
              required: fieldDef.required
            });
          }
        } else if (isEmpty) {
          // Simple field
          missing.push({
            path,
            label: fieldDef.label || key,
            type: fieldDef.type,
            required: fieldDef.required
          });
        }
      });
    };

    checkFields(schema, currentData);
    return missing;
  };

  // Helper: search and filter fields
  const getFilteredFields = (platformKey: string) => {
    const schema = PLATFORM_FIELD_SCHEMA[platformKey] || {};
    const query = fieldSearchQuery.toLowerCase();
    const filtered: Array<{ path: string; label: string; type: string; required?: boolean; group?: string }> = [];

    const searchFields = (obj: any, prefix = '', group = '') => {
      Object.entries(obj).forEach(([key, fieldDef]: [string, any]) => {
        const path = prefix ? `${prefix}.${key}` : key;
        const label = fieldDef.label || key;

        if (fieldDef.type === 'object' && fieldDef.schema) {
          // Group header
          if (!query || label.toLowerCase().includes(query) || key.toLowerCase().includes(query)) {
            const groupName = group ? `${group} > ${label}` : label;
            searchFields(fieldDef.schema, path, groupName);
          }
        } else {
          // Individual field
          if (!query || label.toLowerCase().includes(query) || key.toLowerCase().includes(query)) {
            filtered.push({
              path,
              label,
              type: fieldDef.type,
              required: fieldDef.required,
              group: group || 'Core Fields'
            });
          }
        }
      });
    };

    searchFields(schema);
    return filtered;
  };

  // Helper: add field to platform
  const addFieldToPlatform = (platformKey: string, fieldPath: string) => {
    const pathParts = fieldPath.split('.');
    const schema = PLATFORM_FIELD_SCHEMA[platformKey] || {};

    // Navigate to the field definition
    let fieldDef = schema;
    for (const part of pathParts.slice(0, -1)) {
      fieldDef = fieldDef[part]?.schema || fieldDef[part] || {};
    }
    const finalField = fieldDef[pathParts[pathParts.length - 1]];

    // Determine default value based on field type
    let defaultValue: any;
    if (finalField?.type) {
      switch (finalField.type) {
        case 'string':
          defaultValue = '';
          break;
        case 'number':
          defaultValue = 0;
          break;
        case 'boolean':
          defaultValue = false;
          break;
        case 'array':
          defaultValue = [];
          break;
        case 'object':
          defaultValue = {};
          break;
        case 'select':
          defaultValue = finalField.options?.[0] || '';
          break;
        default:
          defaultValue = '';
      }
    } else {
      // If no field definition found, default to empty string (this allows adding any field)
      defaultValue = '';
    }

    // Set the field value in the platform data
    updatePlatforms(prev => {
      const next = { ...prev };
      const platformData = { ...(next[platformKey] || {}) };

      // For simple fields (no dots), add directly to platform
      if (pathParts.length === 1) {
        platformData[fieldPath] = defaultValue;
      } else {
        // Navigate to the correct nested location and set the value
        let current = platformData;
        for (const part of pathParts.slice(0, -1)) {
          if (!current[part] || typeof current[part] !== 'object') {
            current[part] = {};
          }
          current = current[part];
        }
        current[pathParts[pathParts.length - 1]] = defaultValue;
      }

      next[platformKey] = platformData;
      return next;
    });

    setMissingFieldsModalOpen(false);
  };


  // Build publish/save payloads from displayed data
  const buildPlatformPayload = () => {
    // canonical: prefer "shopify" as base, else first platform
    const keys = Object.keys(displayedPlatforms || {});
    const canonicalKey = keys.includes('shopify') ? 'shopify' : keys[0];
    const canonical = (displayedPlatforms?.[canonicalKey] || {}) as any;

    // Helper to parse numeric fields
    const parseNumeric = (raw: any): number | undefined => {
      if (raw === undefined || raw === null || raw === '') return undefined;
      if (typeof raw === 'number') return raw >= 0 ? raw : undefined;
      const cleaned = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
      return Number.isFinite(cleaned) && cleaned >= 0 ? cleaned : undefined;
    };

    const payload = {
      platformDetails: {
        canonical: {
          title: canonical.title || '',
          sku: String(canonical.sku || `DRAFT-${(effectiveResult?.productId || '').slice(0, 8)}`),
          price: (() => {
            const parsed = parseNumeric(canonical.price);
            return parsed !== undefined && parsed > 0 ? parsed : undefined;
          })(),
          description: canonical.description || '',
          compareAtPrice: parseNumeric(canonical.compareAtPrice),
          barcode: canonical.barcode || undefined,
          weight: parseNumeric(canonical.weight),
          weightUnit: canonical.weightUnit || undefined,
          tags: Array.isArray(canonical.tags) ? canonical.tags : undefined,
          vendor: canonical.vendor || undefined,
          productType: canonical.productType || undefined,
          status: canonical.status || undefined,
          brand: canonical.brand || undefined,
          condition: canonical.condition || undefined,
          categorySuggestion: canonical.categorySuggestion || undefined,
          // SEO fields
          seoTitle: canonical.seo?.seoTitle || canonical.seoTitle || undefined,
          seoDescription: canonical.seo?.seoDescription || canonical.seoDescription || undefined,
          // Shipping fields
          requiresShipping: canonical.requiresShipping !== undefined ? canonical.requiresShipping : undefined,
          // Inventory tracking fields
          inventoryQuantity: parseNumeric(canonical.inventoryQuantity),
          tracked: canonical.tracked !== undefined ? canonical.tracked : undefined,
          inventoryTracker: canonical.inventoryTracker || undefined,
          // CRITICAL FIX: Add inventoryByLocation at root level for single-variant products
          // Backend expects this at root when variants array is empty
          inventoryByLocation: canonical.inventoryByLocation || undefined,
          // Variant options (if single variant with options)
          selectedOptions: Array.isArray(canonical.selectedOptions) ? canonical.selectedOptions : undefined,
          // Variant structure (if variants array exists)
          variants: Array.isArray(canonical.variants) && canonical.variants.length > 0
            ? canonical.variants.map((v: any) => {
              // Handle both modern format (optionValues: {Size: '2TB'}) and legacy format (option1_name, option1_value)
              let optionFields: any = {};

              if (v.optionValues && typeof v.optionValues === 'object') {
                // Modern format: { Size: '2TB', Color: 'Black' }
                // Convert to legacy format for backend
                log.debug('[buildPlatformPayload] Converting modern optionValues to legacy format:', v.optionValues);
                const entries = Object.entries(v.optionValues);
                entries.forEach(([name, value], idx) => {
                  if (idx === 0) {
                    optionFields.option1_name = name;
                    optionFields.option1_value = value;
                  } else if (idx === 1) {
                    optionFields.option2_name = name;
                    optionFields.option2_value = value;
                  } else if (idx === 2) {
                    optionFields.option3_name = name;
                    optionFields.option3_value = value;
                  }
                });
              } else {
                // Legacy format already present
                optionFields.option1_name = v.option1_name || undefined;
                optionFields.option1_value = v.option1_value || undefined;
                optionFields.option2_name = v.option2_name || undefined;
                optionFields.option2_value = v.option2_value || undefined;
                optionFields.option3_name = v.option3_name || undefined;
                optionFields.option3_value = v.option3_value || undefined;
              }

              return {
                ...optionFields,
                sku: v.sku || undefined,
                barcode: v.barcode || undefined,
                price: parseNumeric(v.price),
                compareAtPrice: parseNumeric(v.compareAtPrice),
                costPerItem: parseNumeric(v.costPerItem),
                inventoryQuantity: parseNumeric(v.inventoryQuantity),
                inventoryTracker: v.inventoryTracker || undefined,
                tracked: v.tracked !== undefined ? v.tracked : undefined,
                requiresShipping: v.requiresShipping !== undefined ? v.requiresShipping : undefined,
                weightValueGrams: parseNumeric(v.weightValueGrams),
                inventoryByLocation: v.inventoryByLocation || undefined,
              };
            })
            : undefined,
        },
        // ALSO send platform-specific data to preserve original generated fields
        // Backend will prefer platform-specific over canonical
        ...Object.keys(displayedPlatforms || {}).reduce((acc, platformKey) => {
          const platformData = (displayedPlatforms as any)[platformKey];
          if (platformData && typeof platformData === 'object') {
            acc[platformKey] = platformData;
          }
          return acc;
        }, {} as Record<string, any>),
      },
      media: (() => {
        // CRITICAL: Use userImagesByIndex which prioritizes: 1) DB images, 2) params, 3) scraped fallback
        const imgs = new Set<string>();

        // First, collect from displayed platforms (preserves user edits in the form)
        for (const k of Object.keys(displayedPlatforms || {})) {
          const p = (displayedPlatforms as any)[k] || {};
          const arr = p.images || p.imageUris || [];
          if (Array.isArray(arr)) {
            arr.forEach((u: string) => {
              // Filter out empty strings, null, undefined (scraper-hosted URLs arrive
              // pre-emptied from the server, so this length guard drops them too).
              if (typeof u === 'string' && u.trim().length > 0) {
                imgs.add(u);
              }
            });
          }
        }

        // Add user images from computed userImagesByIndex (includes DB images!)
        const idx = (effectiveResult?.productIndex as number) ?? 0;
        const userImages = userImagesByIndex[idx] || [];
        userImages.forEach((u: string) => {
          // Filter out empty strings
          if (typeof u === 'string' && u.trim().length > 0) {
            imgs.add(u);
          }
        });

        const imageUris = Array.from(imgs);
        log.debug('[buildPlatformPayload] Using user images (DB + params):', imageUris);
        return { imageUris, coverImageIndex: 0 };
      })(),
      selectedPlatformsToPublish: Object.keys(displayedPlatforms || {}),
    };

    return payload;
  };

  buildPlatformPayloadRef.current = buildPlatformPayload;



  const doSaveToInventory = async () => {
    log.debug('[doSaveToInventory] Starting inventory save...');
    try {
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      if (!baseUrl || !productId || !variantId || !token) {
        log.debug('[doSaveToInventory] Missing required data', { productId, variantId, token: !!token });
        showErrorModal('Couldn’t save', !token ? 'Your session expired. Sign in again.' : "This item isn't ready to save yet. Give it a moment and try again.", 'warning');
        return;
      }

      const rawPayload = buildPlatformPayload();
      const durableImageUris = await uploadLocalImagesToSupabase(rawPayload.media.imageUris || []);
      const payload = {
        ...rawPayload,
        media: {
          ...rawPayload.media,
          imageUris: durableImageUris,
        },
      };

      // SKU Enhancement: If SKU is DRAFT- or missing, generate a permanent INV- SKU
      let finalSku = payload.platformDetails.canonical.sku;
      if (!finalSku || finalSku.startsWith('DRAFT-')) {
        const randomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
        finalSku = `INV-${randomSuffix}`;
        log.debug('[doSaveToInventory] Generated permanent SKU:', finalSku);

        // Update payload with new SKU
        payload.platformDetails.canonical.sku = finalSku;

        // Also update local state immediately so UI reflects it if save fails/succeeds
        const canonicalKey = platformKeys.includes('shopify') ? 'shopify' : platformKeys[0];
        if (canonicalKey) {
          updatePlatforms(prev => ({
            ...prev,
            [canonicalKey]: {
              ...prev[canonicalKey],
              sku: finalSku
            }
          }));
        }
      }

      log.debug('[doSaveToInventory] Saving payload:', JSON.stringify(payload, null, 2));

      const res = await apiFetch('/api/products/publish', {
        method: 'POST',
        body: {
          productId,
          variantId,
          publishIntent: 'SAVE_TO_INVENTORY', // Changed intent
          platformDetails: payload.platformDetails,
          media: payload.media,
          selectedPlatformsToPublish: [],
        }
      });

      if (res.ok) {
        log.debug('[doSaveToInventory] Saved to inventory successfully');

        // Saved to inventory with no external platforms selected. The backend's
        // publish_completed only fires per platform connection, so this
        // inventory-only path would otherwise be invisible.
        capture(AnalyticsEvents.LISTING_CREATED, {
          product_id: productId,
          destination: 'inventory',
          image_count: Array.isArray(payload.media?.imageUris) ? payload.media.imageUris.length : 0,
        });

        // Navigate to confirmation screen
        // We construct the params similar to doPublish
        const canonicalKey = platformKeys.includes('shopify') ? 'shopify' : platformKeys[0];
        const canonical = displayedPlatforms[canonicalKey] || {};
        const coverIndex = typeof payload.media?.coverImageIndex === 'number' ? payload.media.coverImageIndex : 0;
        const savedImages = Array.isArray(payload.media?.imageUris) ? payload.media.imageUris : [];

        navigation.navigate('PublishConfirmation', {
          productId,
          variantId,
          title: canonical.title,
          description: canonical.description,
          price: canonical.price,
          imageUrl: savedImages[coverIndex] || effectiveResult?.sourceImageUrl || '',
          platforms: [], // No external platforms
          quantityByPlatform: quantityByPlatformComputed,
          savedToInventory: true, // Flag for UI
          origin: 'generate'
        } as any);

      } else {
        const errorText = await res.text();
        log.error('[doSaveToInventory] Save failed:', errorText);
        showErrorModal('Couldn’t save', `We couldn’t save this to inventory.\n\n${errorText}`, 'error');
      }
    } catch (err) {
      log.error('[doSaveToInventory] Error saving:', err);
      showErrorModal('Couldn’t save', 'Something went wrong while saving. Please try again.', 'error');
    }
  };

  const doPublish = async () => {
    log.debug('doPublish - Starting publish flow');
    log.debug('displayedPlatforms:', JSON.stringify(displayedPlatforms, null, 2));
    log.debug('readyPlatforms:', readyPlatforms);
    log.debug('platformKeys:', platformKeys);

    try {
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      if (!baseUrl || !token) {
        log.debug('doPublish - Missing baseUrl or token');
        return;
      }

      // Check if connections are loaded, if not fetch them now
      let connectionsToUse = allConnections;
      if (!connectionsToUse || connectionsToUse.length === 0) {
        log.debug('[doPublish] Connections not loaded yet, fetching now...');
        const connRes = await apiFetch('/api/platform-connections');
        connectionsToUse = connRes.ok ? await connRes.json() : [];
        setAllConnections(connectionsToUse);
      }

      log.debug('[doPublish] Using connections:', connectionsToUse);
      log.debug('[doPublish] Connections count:', connectionsToUse?.length);

      const payload = buildPlatformPayload();
      const canonical = payload.platformDetails?.canonical || {};
      log.debug('doPublish - Canonical payload:', canonical);

      log.debug('[doPublish] Using already-fetched connections:', allConnections);
      log.debug('[doPublish] Connections count:', allConnections?.length);

      // Extract locations from connections (no longer needed for modal, but keep for compatibility)
      const locsByPlatform: Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string; platformType: string }>> = {};
      for (const conn of connectionsToUse) {
        const platform = conn.PlatformType?.toLowerCase();
        if (!platform || !conn.IsEnabled) continue;

        const platformData = conn.PlatformSpecificData || {};
        const locations = platformData.locations || [];

        if (!locsByPlatform[platform]) locsByPlatform[platform] = [];

        for (const loc of locations) {
          locsByPlatform[platform].push({
            id: loc.id || loc.gid || '',
            name: loc.name || 'Unnamed Location',
            connectionId: conn.Id,
            connectionName: conn.DisplayName || conn.PlatformType,
            platformType: platform
          });
        }
      }
      setPlatformLocations(locsByPlatform);

      // Set empty selections initially; the confirmation step defaults each channel to all accounts.
      setSelectedConnectionIds({});

      // Show modal - connections are already in allConnections state from mount
      log.debug('[doPublish] About to show modal with', connectionsToUse.length, 'connections');
      setPublishModalOpen(true);

    } catch (err) {
      log.error('Error in doPublish:', err);
      showErrorModal('Couldn’t publish', 'Something went wrong getting ready to publish. Please try again.', 'error');
    }
  };

  // Publish always opens one continuous host. Required gaps become its first,
  // advisory step; acknowledging them swaps to confirmation without closing it.
  const handlePublishPress = () => {
    void doPublish();
  };

  // Upload local image URIs to Supabase and return public URLs
  const uploadLocalImagesToSupabase = async (localUris: string[]): Promise<string[]> => {
    const publicUrls: string[] = [];
    let lastError: string | null = null;
    let attempted = 0;
    let failed = 0;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('You appear to be signed out. Please sign in again to add photos.');

    for (const localUri of localUris) {
      // Skip if already a public URL
      if (localUri.startsWith('http://') || localUri.startsWith('https://')) {
        publicUrls.push(localUri);
        continue;
      }

      attempted += 1;
      try {
        log.debug('[UPLOAD] Uploading image:', localUri);
        // Light compression before upload (0.9 quality, max 1920px) - reduces size with minimal quality loss
        const compressed = await ImageManipulator.manipulateAsync(
          localUri,
          [{ resize: { width: 1920 } }], // Only downscale if wider than 1920px
          { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
        );
        const response = await fetch(compressed.uri);
        const arrayBuffer = await response.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

        const { data, error } = await supabase.storage
          .from('product-images')
          .upload(fileName, bytes, {
            contentType: 'image/jpeg',
            cacheControl: '86400', // 24h - reduces egress via browser cache
          });

        if (error) {
          log.error('[UPLOAD] Supabase upload error:', error);
          lastError = error.message || 'Storage upload failed';
          failed += 1;
          continue;
        }

        const { data: urlData } = supabase.storage
          .from('product-images')
          .getPublicUrl(fileName);

        const publicUrl = urlData.publicUrl;
        log.debug('[UPLOAD] Successfully uploaded to:', publicUrl);
        publicUrls.push(publicUrl);
      } catch (err: any) {
        log.error('[UPLOAD] Failed to upload image:', localUri, err);
        lastError = err?.message || 'Upload failed';
        failed += 1;
      }
    }

    // Publishing and inventory saves must preserve the complete selected gallery.
    // A partial upload is a failure so the original local gallery remains available to retry.
    if (attempted > 0 && failed > 0) {
      throw new Error(lastError || 'Image upload failed. Please try again.');
    }

    return publicUrls;
  };

  const confirmAndPublish = async (opts: { selectedPlatforms: string[]; targetWorkerId?: string }) => {
    let facebookRequested = false;
    try {
      log.debug('[confirmAndPublish] Starting publish...');
      // Keep the publish sheet up (with its spinner) through prep — closing it here, then
      // awaiting the image upload, briefly flashed the editor underneath before navigation.
      // We close it AFTER navigating, so the sheet reveals the receipt, not the editor.
      setIsPublishing(true);

      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      log.debug('[confirmAndPublish] Got IDs:', { productId, variantId, baseUrl: !!baseUrl, token: !!token });
      if (!baseUrl || !productId || !variantId || !token) {
        log.debug('[confirmAndPublish] Missing required data, aborting', { baseUrl: !!baseUrl, productId, variantId, token: !!token });
        setIsPublishing(false);
        setPublishModalOpen(false);
        // Surface WHY instead of silently doing nothing (the seller tapped Publish and "nothing happened").
        const reason = !token
          ? 'your session expired. Sign in again'
          : (!productId || !variantId)
            ? "this item isn't fully saved yet. Tap Save Draft, wait for “Saved”, then publish"
            : 'a connection setting is missing';
        showErrorModal('Couldn’t publish', `We couldn’t publish because ${reason}.`, 'warning');
        return;
      }

      const rawPayload = buildPlatformPayload();

      // Upload local images to Supabase before publishing
      log.debug('[confirmAndPublish] Uploading local images...');
      const uploadedImageUris = await uploadLocalImagesToSupabase(rawPayload.media.imageUris || []);
      log.debug('[confirmAndPublish] Uploaded images:', uploadedImageUris);

      // Replace local URIs with uploaded public URLs
      const payload = {
        ...rawPayload,
        media: {
          ...rawPayload.media,
          imageUris: uploadedImageUris,
        },
      };

      const canonical = payload.platformDetails?.canonical || {};

      // Expand "ALL" selections to actual connection IDs
      const actualConnectionIds: Record<string, string[]> = {};
      const accountNamesList: string[] = [];
      for (const platform of opts.selectedPlatforms) {
        const selection = selectedConnectionIds[platform];
        if (selection === undefined) continue;
        const platformConns = allConnections.filter((c: any) =>
          c.PlatformType?.toLowerCase() === platform.toLowerCase() && isVisiblePlatformConnection(c)
        );

        if (selection === 'ALL') {
          actualConnectionIds[platform] = platformConns.map((c: any) => c.Id);
          accountNamesList.push(...platformConns.map((c: any) => c.DisplayName));
        } else {
          actualConnectionIds[platform] = [selection];
          const conn = platformConns.find((c: any) => c.Id === selection);
          if (conn) accountNamesList.push(conn.DisplayName);
        }
      }

      const platformsToPublish = opts.selectedPlatforms.filter((platform) => (
        Array.isArray(actualConnectionIds[platform]) && actualConnectionIds[platform].length > 0
      ));
      if (platformsToPublish.length !== opts.selectedPlatforms.length) {
        throw new Error('A selected channel no longer has an active connection.');
      }
      facebookRequested = platformsToPublish.map(p => p.toLowerCase()).includes('facebook');

      const publishPayload = {
        productId,
        variantId,
        publishIntent: 'PUBLISH_PLATFORM_LIVE',
        platformDetails: payload.platformDetails,
        media: payload.media,
        selectedPlatformsToPublish: platformsToPublish,
        connectionIds: actualConnectionIds,
        // Optional pin from the publish sheet — routes the Facebook job to one
        // chosen computer. Omitted = any available device (the default).
        ...(opts?.targetWorkerId ? { targetWorkerId: opts.targetWorkerId } : {}),
      };

      log.debug('[confirmAndPublish] Publishing to:', platformsToPublish);
      log.debug('[confirmAndPublish] Connection IDs:', actualConnectionIds);
      log.debug('[confirmAndPublish] Canonical data being sent:', JSON.stringify(payload.platformDetails.canonical, null, 2));
      log.debug('[confirmAndPublish] Full payload:', JSON.stringify(publishPayload, null, 2));

      // Prepare navigation params ahead of time for optimistic navigation
      const imageUrl = (() => {
        const idx = typeof payload.media?.coverImageIndex === 'number' ? payload.media.coverImageIndex : 0;
        const arr = Array.isArray(payload.media?.imageUris) ? payload.media.imageUris : [];
        return arr[idx] || effectiveResult?.sourceImageUrl || '';
      })();

      // The receipt reads from the exact data being published. Prefer a checked
      // platform's values, then canonical, and never synthesize a zero price.
      const platformDetailsByKey: Record<string, typeof canonical> = payload.platformDetails;
      const summarySources = [
        ...platformsToPublish.map((platform) => platformDetailsByKey[platform]),
        canonical,
      ].filter((source) => source && typeof source === 'object');
      const summaryTitle = summarySources
        .map((source: any) => String(source.title || '').trim())
        .find(Boolean);
      const summaryPrice = (() => {
        for (const source of summarySources as any[]) {
          const flat = Number(source.price);
          if (source.price !== undefined && source.price !== null && source.price !== '' && Number.isFinite(flat) && flat > 0) {
            return flat;
          }
          if (Array.isArray(source.variants)) {
            const variantPrice = source.variants
              .map((variant: any) => Number(variant?.price))
              .find((candidate: number) => Number.isFinite(candidate) && candidate > 0);
            if (variantPrice !== undefined) return variantPrice;
          }
        }
        return undefined;
      })();
      const selectedQuantityByPlatform = Object.fromEntries(
        platformsToPublish.flatMap((platform) => (
          quantityByPlatformComputed[platform] === undefined
            ? []
            : [[platform, quantityByPlatformComputed[platform]]]
        )),
      );

      const navigationParams = {
        productId,
        variantId,
        title: summaryTitle,
        description: canonical.description,
        price: summaryPrice,
        sku: canonical.sku,
        imageUrl,
        platforms: platformsToPublish,
        accountNames: accountNamesList,
        quantityByPlatform: selectedQuantityByPlatform,
        origin: 'generate',
        sourcePlatform: platformsToPublish[0] || 'shopify',
        isPublishing: true, // Tell the confirmation screen we're still publishing
      };

      // The confirmation screen OWNS the publish POST now: it prints the receipt WHILE the
      // request runs, and only morphs to "Published!" on a real 2xx — on failure it shows an
      // inline error + Retry (no false success, no abrupt pop-back). Hand it the ready-to-send
      // payload + the display params + the publish endpoint.
      pendingPublishNavigationRef.current = () => {
        navigation.navigate('PublishConfirmation', {
          ...navigationParams,
          mode: 'publishing',
          publishPayload,
          facebookRequested,
        } as any);
      };
      // Dismiss the native modal first. iOS calls onDismiss after its host view is
      // gone; only then do we push the receipt, leaving no transparent touch layer.
      setPublishModalOpen(false);

    } catch (err) {
      log.error('[confirmAndPublish] Error preparing publish:', err);
      setIsPublishing(false);
      setPublishModalOpen(false);
      showErrorModal('Couldn’t publish', 'Something went wrong while preparing the publish. Please try again.', 'error');
    }
  };


  const generatePlatform = async (platformKey: string) => {
    try {
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      if (!baseUrl || !productId || !variantId || !token) return;
      const regenGeneration = editorGenerationRef.current;
      const regenSessionKey = editorSessionKey;
      const regenProductIndex = currentProductIndex;

      // Optimistic UI update - start loading
      setGeneratingPlatformKeys(prev => new Set(prev).add(platformKey));

      const payload = buildPlatformPayload();
      const submit = await fetch(`${baseUrl}/api/products/regenerate/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generateJobId: jobId,
          products: [{
            productIndex: (effectiveResult?.productIndex as number) ?? 0,
            productId,
            variantId,
            regenerateType: 'entire_platform',
            targetPlatform: platformKey,
            imageUrls: payload.media.imageUris,
          }],
          options: { useExistingScrapedData: true }
        })
      });

      if (!submit.ok) {
        setGeneratingPlatformKeys(prev => {
          const next = new Set(prev);
          next.delete(platformKey);
          return next;
        });
        throw new Error(`Platform generation failed: ${submit.status}`);
      }

      const submitJson = await submit.json();
      const regenJobId = submitJson?.jobId;

      if (regenJobId) {
        log.debug(`[GEN-DETAILS] Started regeneration for ${platformKey}, jobId: ${regenJobId}`);
        activeRegenJobsRef.current[regenJobId] = platformKey;
        // Socket delivery is best-effort. Poll the existing throttled status
        // endpoint at a conservative cadence so a missed event cannot leave the
        // platform spinner stuck forever.
        void (async () => {
          const deadline = Date.now() + 100_000;
          while (Date.now() < deadline && activeRegenJobsRef.current[regenJobId] === platformKey) {
            await new Promise(resolve => setTimeout(resolve, 20_000));
            if (activeRegenJobsRef.current[regenJobId] !== platformKey) return;
            if (regenGeneration !== editorGenerationRef.current || regenSessionKey !== lastEditorSessionKeyRef.current) {
              delete activeRegenJobsRef.current[regenJobId];
              setGeneratingPlatformKeys(prev => {
                const next = new Set(prev);
                next.delete(platformKey);
                return next;
              });
              return;
            }
            try {
              const pollToken = await ensureSupabaseJwt();
              if (!pollToken) continue;
              const statusResponse = await fetch(`${baseUrl}/api/products/regenerate/status/${regenJobId}`, {
                headers: { Authorization: `Bearer ${pollToken}` },
              });
              if (!statusResponse.ok) continue;
              const statusJson = await statusResponse.json().catch(() => null);
              if (!statusJson) continue;
              if (statusJson.status === 'completed') {
                let resultArray = Array.isArray(statusJson.results) ? statusJson.results : [];
                if (resultArray.length === 0) {
                  const resultResponse = await fetch(`${baseUrl}/api/products/regenerate/results/${regenJobId}`, {
                    headers: { Authorization: `Bearer ${pollToken}` },
                  });
                  if (resultResponse.ok) {
                    const resultJson = await resultResponse.json().catch(() => null);
                    resultArray = Array.isArray(resultJson?.results) ? resultJson.results : [];
                  }
                }
                const matched = resultArray.find((r: any) => (r?.productIndex ?? 0) === regenProductIndex) || resultArray[0];
                const generated = matched?.platforms?.[platformKey];
                if (generated) {
                  const normalized = normalizeForListingEditor(generated);
                  updatePlatforms(prev => hydratePlatformsFromBackend({ [platformKey]: normalized }, prev));
                }
                delete activeRegenJobsRef.current[regenJobId];
                setGeneratingPlatformKeys(prev => {
                  const next = new Set(prev);
                  next.delete(platformKey);
                  return next;
                });
                return;
              }
              if (statusJson.status === 'failed' || statusJson.status === 'cancelled') {
                delete activeRegenJobsRef.current[regenJobId];
                setGeneratingPlatformKeys(prev => {
                  const next = new Set(prev);
                  next.delete(platformKey);
                  return next;
                });
                showErrorModal('Generation failed', `We couldn’t generate ${platformKey} details. Please try again.`, 'error');
                return;
              }
            } catch (pollError) {
              log.warn('[GEN-DETAILS] Regeneration fallback poll failed:', pollError);
            }
          }
          if (activeRegenJobsRef.current[regenJobId] === platformKey) {
            delete activeRegenJobsRef.current[regenJobId];
            setGeneratingPlatformKeys(prev => {
              const next = new Set(prev);
              next.delete(platformKey);
              return next;
            });
            showErrorModal('Generation is taking longer', `We couldn’t confirm ${platformKey} finished. Please try again.`, 'warning');
          }
        })();
      } else {
        setGeneratingPlatformKeys(prev => {
          const next = new Set(prev);
          next.delete(platformKey);
          return next;
        });
      }

    } catch (error) {
      log.error('Platform generation failed:', error);
      setGeneratingPlatformKeys(prev => {
        const next = new Set(prev);
        next.delete(platformKey);
        return next;
      });
      throw error;
    }
  };



  // ========== PHASE 2.6: Media Gallery Handlers ==========
  const handlePickImage = async () => {
    try {
      // Request permissions first (like AddProductScreen)
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showErrorModal('Photo access needed', 'Allow photo library access to add images.', 'warning');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images, // Reverting to MediaTypeOptions to fix crash
        allowsEditing: false,
        aspect: [4, 3],
        quality: 0.8, // Match AddProductScreen quality
      });

      if (!result.canceled && result.assets.length > 0) {
        const asset = result.assets[0];

        // Upload to Supabase (like AddProductScreen does)
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) {
            showErrorModal('Sign in needed', 'Please sign in again to add photos.', 'warning');
            return;
          }

          // Read bytes using File API (Expo SDK 54+)
          const parsedPath = Paths.parse(asset.uri);
          const srcFile = new File(new Directory(parsedPath.dir), parsedPath.base);
          const bytes = await srcFile.bytes();

          // Create file name in user's folder
          const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

          const { data, error } = await supabase.storage
            .from('product-images')
            .upload(fileName, bytes, {
              contentType: 'image/jpeg',
              cacheControl: '3600',
            });

          if (error) {
            log.error('[Phase2 Media] Upload error:', error);
            showErrorModal('Upload failed', 'We couldn’t upload that photo. Please try again.', 'error');
            return;
          }

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(fileName);

          const publicUrl = urlData.publicUrl;
          log.debug('[Phase2 Media] Image uploaded:', publicUrl);

          // Add to the item's real images (photo strip + payload + DB cache) so the gallery,
          // the strip, and every other surface stay in sync — not a disconnected local list.
          handleImagesChange([...currentItemImages, publicUrl]);

        } catch (uploadError) {
          log.error('[Phase2 Media] Failed to upload image:', uploadError);
          showErrorModal('Upload failed', 'We couldn’t upload that photo. Please try again.', 'error');
        }
      }
    } catch (error) {
      log.error('[Phase2 Media] Error picking image:', error);
      showErrorModal('Couldn’t add photo', 'We couldn’t open your photos. Please try again.', 'error');
    }
  };

  const handleRemoveMedia = (index: number) => {
    const removedUrl = currentItemImages[index];
    handleImagesChange(currentItemImages.filter((_, i) => i !== index));
    log.debug('[Phase2 Media] Image removed at index:', index, 'URL:', removedUrl);
  };

  const handleSetVariantPhoto = (imageUrl: string) => {
    if (!selectedVariantForMedia) {
      showErrorModal('Pick a variant', 'Choose which variant this photo is for.', 'info');
      return;
    }

    log.debug('[Phase2 Media] Set variant', selectedVariantForMedia, 'photo to:', imageUrl);
    setSelectedVariantForMedia(null);
  };

  // ========== LOAD DRAFT ON MOUNT (when reopening saved item) ==========
  useEffect(() => {
    const variantId = (route.params as any)?.variantId;
    const hasResults = Array.isArray(results) && results.length > 0;
    const hasPlatformData = Object.keys(platformsRef.current).length > 0;

    // Only load draft if:
    // 1. We have a variantId
    // 2. platformsRef is still empty (not already hydrated from results or previous load)
    // NOTE: We now load draft even if results exist, because user might have edited after generation
    if (!variantId || hasPlatformData) {
      log.debug('[GEN-DETAILS DraftLoad] Skipping - variantId:', !!variantId, 'hasPlatformData:', hasPlatformData);
      return;
    }

    let canceled = false;
    const requestGeneration = editorGenerationRef.current;
    const requestSessionKey = editorSessionKey;
    const wasEmptyAtRequest = Object.keys(platformsRef.current || {}).length === 0;
    (async () => {
      try {
        const baseUrl = API_BASE_URL;
        const token = await ensureSupabaseJwt();

        if (!baseUrl || !token) {
          log.debug('[GEN-DETAILS DraftLoad] Missing baseUrl or token, skipping');
          return;
        }

        log.debug('[GEN-DETAILS DraftLoad] ⏳ Loading draft for variant:', variantId);
        const response = await apiFetch(`/api/products/drafts/${variantId}`, {
          method: 'GET',
        });

        if (!response.ok) {
          const errorText = await response.text();
          log.warn('[GEN-DETAILS DraftLoad] ❌ Failed to load draft:', response.status, errorText);
          return;
        }

        const draftResponse = await response.json();
        const currentDraft = draftResponse?.currentDraft;

        if (!currentDraft || !currentDraft.DraftData) {
          log.debug('[GEN-DETAILS DraftLoad] No draft data found');
          return;
        }

        if (!canceled
          && requestGeneration === editorGenerationRef.current
          && requestSessionKey === lastEditorSessionKeyRef.current) {
          log.debug('[GEN-DETAILS DraftLoad] ✅ Loaded draft:', currentDraft.DraftData);
          const localChangedWhileLoading = wasEmptyAtRequest && Object.keys(platformsRef.current || {}).length > 0;
          platformsRef.current = localChangedWhileLoading
            ? hydratePlatformsFromBackend(currentDraft.DraftData, platformsRef.current)
            : currentDraft.DraftData;
          lastSavedRef.current = JSON.stringify(currentDraft.DraftData);
          lastScheduledRef.current = null;
          forceUpdate({}); // Trigger re-render with restored data
        }
      } catch (error) {
        log.error('[GEN-DETAILS DraftLoad] ❌ Error loading draft:', error);
      }
    })();

    return () => { canceled = true };
  }, [(route.params as any)?.variantId, results, editorSessionKey]);


  const handleImagesChange = (newImages: string[]) => {
    log.debug('[GEN-DETAILS] handleImagesChange:', newImages.length, newImages);

    // Saved items have a variantId → key into the DB-image cache so Priority 1 picks it up.
    // Freshly generated items have NO variantId yet — DON'T early-return (that silently
    // dropped added photos). We still persist them onto the canonical platform draft below,
    // which userImagesByIndex reads as Priority 2.
    if (effectiveResult?.variantId) {
      setDbImages(prev => ({
        ...prev,
        [effectiveResult.variantId!]: newImages
      }));
    }

    // Also update the 'images' field in the canonical platform data so it saves correctly
    updatePlatforms(prev => {
      const canonicalKey = platformKeys.includes('shopify') ? 'shopify' : platformKeys[0];
      log.debug('[GEN-DETAILS] handleImagesChange updating canonical:', canonicalKey);
      if (!canonicalKey) return prev;

      const updated = {
        ...prev,
        [canonicalKey]: {
          ...(prev[canonicalKey] || {}),
          images: newImages
        }
      };
      return updated;
    });
  };

  const mergeEditorPlatformChanges = (next: GeneratedPlatformDetails) => {
    log.debug('[GEN-DETAILS] onChangePlatforms received - deep merge to preserve all data');
    updatePlatforms(prev => {
      const merged = { ...prev };
      for (const [platformKey, platformData] of Object.entries(next)) {
        const prevPlatform = prev[platformKey] || {};
        merged[platformKey] = { ...prevPlatform, ...platformData };
        if (Array.isArray(platformData?.variants) && Array.isArray(prevPlatform.variants)) {
          merged[platformKey].variants = platformData.variants.map((newVariant: any) => {
            const prevVariant = prevPlatform.variants?.find((variant: any) => variant.id === newVariant.id);
            return prevVariant?.inventoryByLocation
              ? {
                  ...newVariant,
                  inventoryByLocation: {
                    ...prevVariant.inventoryByLocation,
                    ...(newVariant.inventoryByLocation || {}),
                  },
                }
              : newVariant;
          });
        }
      }
      log.debug('[GEN-DETAILS] Deep merged platforms, keys:', Object.keys(merged));
      return merged;
    });
  };

  const openEditorImageCapture = async (onResult: (uris: string[]) => void) => {
    try {
      const assets = await captureOrPickImageAssets({ multiple: true });
      if (!assets.length) return;
      const localUris = assets.map(asset => asset.uri);
      let urisToShow = localUris;
      try {
        const uploadedUrls = await uploadLocalImagesToSupabase(localUris);
        if (uploadedUrls.length > 0) urisToShow = uploadedUrls;
      } catch (uploadErr) {
        log.error('[GEN-DETAILS] Photo upload failed; showing local copy, will upload at publish:', uploadErr);
      }
      onResult(urisToShow);
    } catch (error: any) {
      log.error('Error picking images:', error);
      showErrorModal('Couldn’t add photo', error?.message || 'We couldn’t add those images. Please try again.', 'error');
    }
  };

  const removeTargetPlatform = (platformKey: string) => {
    updatePlatforms(prev => {
      const keys = Object.keys(prev);
      if (keys.length <= 1 || !prev[platformKey]) return prev;
      const removed = prev[platformKey] || {};
      const next = { ...prev };
      delete next[platformKey];

      // Shared product identity must survive even when the removed channel happened to
      // be the canonical source used by this draft.
      const nextCanonicalKey = Object.keys(next)[0];
      if (nextCanonicalKey) {
        const nextCanonical = { ...(next[nextCanonicalKey] || {}) };
        for (const field of ['title', 'description', 'price', 'sku', 'images', 'tags', 'options', 'variants']) {
          const current = nextCanonical[field];
          const empty = current == null || current === '' || (Array.isArray(current) && current.length === 0);
          if (empty && removed[field] != null) nextCanonical[field] = removed[field];
        }
        next[nextCanonicalKey] = nextCanonical;
      }
      return next;
    });
    setIgnoredPlatforms(prev => prev.filter(key => key !== platformKey));
    setSelectedPlatforms(prev => prev.filter(key => key !== platformKey));
    setSelectedConnectionIds(prev => {
      const next = { ...prev };
      delete next[platformKey];
      return next;
    });
  };

  const renderOverviewSummary = () => {
    const keys = Object.keys(displayedPlatforms || {});
    const canonicalKey = keys.includes('shopify') ? 'shopify' : keys[0];
    const canonical: any = canonicalKey ? displayedPlatforms[canonicalKey] || {} : {};
    const images = (currentItemImages || []).filter(
      (url: any): url is string => typeof url === 'string' && url.trim().length > 0,
    );
    const cover = images[0];
    const thumbs = images.slice(1, 4);
    const priceNumber = Number(canonical.price);
    const priceText = Number.isFinite(priceNumber) && priceNumber > 0
      ? `$${priceNumber.toFixed(2)}`
      : 'Not set';
    const realVariants = (Array.isArray(canonical.variants) ? canonical.variants : []).filter(
      (variant: any) => String(variant?.variantType || variant?.VariantType || '').toLowerCase() !== 'base',
    );

    const inventoryTotal = (inventory: any): number => {
      if (!inventory || typeof inventory !== 'object') return 0;
      return Object.values(inventory).reduce((sum: number, location: any) => {
        const quantity = typeof location === 'number' ? location : Number(location?.quantity ?? location?.Quantity ?? 0);
        return sum + (Number.isFinite(quantity) ? quantity : 0);
      }, 0);
    };
    const stockForVariant = (variant: any): number => {
      const byLocation = inventoryTotal(variant?.inventoryByLocation);
      if (byLocation > 0) return byLocation;
      const quantity = Number(variant?.inventoryQuantity ?? variant?.quantity ?? variant?.Quantity ?? 0);
      return Number.isFinite(quantity) ? quantity : 0;
    };
    const variantStock = realVariants.reduce((sum: number, variant: any) => sum + stockForVariant(variant), 0);
    const rootStock = inventoryTotal(canonical.inventoryByLocation)
      || Number(canonical.inventoryQuantity ?? canonical.quantity ?? canonical.Quantity ?? 0)
      || 0;
    const totalStock = variantStock || rootStock;
    const sizeCount = realVariants.length;

    const displayText = (value: any): string | null => {
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (Array.isArray(value) && value.length > 0) return value.map(String).join(' / ');
      if (value && typeof value === 'object') {
        const nested = value.label || value.name || value.title || value.path;
        if (typeof nested === 'string' && nested.trim()) return nested.trim();
      }
      return null;
    };
    const categoryText = displayText(
      canonical.categoryPath || canonical.category || canonical.productCategory || canonical.categorySuggestion,
    );
    const tags = Array.isArray(canonical.tags) ? canonical.tags.filter(Boolean).map(String) : [];
    const conditionLabels: Record<string, string> = {
      new: 'New',
      like_new: 'Like New',
      good: 'Good',
      fair: 'Fair',
      used: 'Used',
      refurbished: 'Refurbished',
      for_parts: 'For Parts',
    };
    const rawCondition = displayText(canonical.condition);
    const conditionText = rawCondition
      ? conditionLabels[rawCondition.toLowerCase()] || rawCondition
      : null;
    const descriptionText = displayText(canonical.description);
    const skuText = displayText(canonical.sku);
    const barcodeText = displayText(canonical.barcode);
    const brandText = displayText(canonical.brand || canonical.vendor);
    const seoTitleText = displayText(canonical.seoTitle || canonical.metaTitle);
    const optionName = displayText(canonical.options?.[0]?.name);
    const variantCountLabel = optionName?.toLowerCase() === 'size'
      ? `${sizeCount} size${sizeCount === 1 ? '' : 's'}`
      : `${sizeCount} variant${sizeCount === 1 ? '' : 's'}`;
    const metaGray: string[] = [];
    metaGray.push(`${totalStock} in stock`);
    if (sizeCount > 0) metaGray.push(variantCountLabel);
    const priceStockSummary = `${priceText} · Qty ${totalStock}`;

    const openInEdit = (field: string) => {
      setMode('edit');
      setTimeout(() => listingEditorRef.current?.openFieldSheet(field), 140);
    };
    const openSectionInEdit = (section: 'variants' | 'inventory') => {
      setMode('edit');
      setTimeout(() => listingEditorRef.current?.scrollToSection(section), 180);
    };
    const overviewRow = (label: string, value: string | null, placeholder: string, field: string) => (
      <TouchableOpacity
        style={[styles.ovDetailRow, styles.ovDetailDivider]}
        activeOpacity={0.6}
        onPress={() => openInEdit(field)}
      >
        <Text style={styles.ovDetailLabel} numberOfLines={1}>{label}</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.ovDetailValue, !value && styles.ovDetailValueEmpty]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <ChevronRight size={17} color="#C4C8CE" style={{ marginLeft: 6 }} />
      </TouchableOpacity>
    );

    return (
      <View>
        <View style={styles.ovProductCard}>
          <TouchableOpacity activeOpacity={0.85} onPress={() => openInEdit('photos')}>
            {cover ? (
              <Image source={{ uri: cover }} style={styles.ovHero} />
            ) : (
              <View style={[styles.ovHero, styles.ovHeroEmpty]}>
                <Icon name="image-outline" size={32} color="#C4C8CE" />
              </View>
            )}
            {thumbs.length > 0 ? (
              <View style={styles.ovThumbRow}>
                {thumbs.map((url: string, index: number) => (
                  <Image key={`${url}-${index}`} source={{ uri: url }} style={styles.ovThumb} />
                ))}
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={() => openInEdit('title')}>
            <Text style={styles.ovTitle}>{canonical.title || 'Untitled product'}</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} onPress={() => openInEdit('price')} style={styles.ovPriceRow}>
            <Text style={styles.ovPrice}>{priceText}</Text>
            {metaGray.length > 0 ? <Text style={styles.ovPriceMeta}>{`· ${metaGray.join(' · ')}`}</Text> : null}
          </TouchableOpacity>
          {descriptionText ? (
            <TouchableOpacity activeOpacity={0.7} onPress={() => openInEdit('description')}>
              <Text style={styles.ovDesc} numberOfLines={3}>{descriptionText}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.ovCard}>
          <Text style={[styles.ovCardLabel, styles.ovCardLabelSolo]}>DETAILS</Text>
          {overviewRow('Price & stock', priceStockSummary, 'Set a price', 'price')}
          {sizeCount > 0 ? (
            <TouchableOpacity
              style={[styles.ovDetailRow, styles.ovDetailDivider]}
              activeOpacity={0.6}
              onPress={() => openSectionInEdit('variants')}
            >
              <Text style={styles.ovDetailLabel}>Variants</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.ovDetailValue}>{variantCountLabel}</Text>
              <ChevronRight size={17} color="#C4C8CE" style={{ marginLeft: 6 }} />
            </TouchableOpacity>
          ) : null}
          {overviewRow('Category', categoryText, 'Add a category', 'category')}
          {overviewRow('Description', descriptionText, 'Add a description', 'description')}
          <TouchableOpacity
            style={[styles.ovDetailRow, styles.ovDetailDivider]}
            activeOpacity={0.6}
            onPress={() => openInEdit('photos')}
          >
            <Text style={styles.ovDetailLabel}>Photos</Text>
            <View style={{ flex: 1 }} />
            <Text style={[styles.ovDetailValue, images.length === 0 && styles.ovDetailValueEmpty]}>
              {images.length || 'Add photos'}
            </Text>
            <ChevronRight size={17} color="#C4C8CE" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.ovTagsRow} activeOpacity={0.6} onPress={() => openInEdit('tags')}>
            <Text style={styles.ovDetailLabel}>Tags</Text>
            <View style={styles.ovTagsWrap}>
              {tags.length > 0 ? tags.slice(0, 6).map((tag: string, index: number) => (
                <View key={`${tag}-${index}`} style={styles.ovTagChip}>
                  <Text style={styles.ovTagChipText}>{tag}</Text>
                </View>
              )) : (
                <Text style={[styles.ovDetailValue, styles.ovDetailValueEmpty]}>Add tags</Text>
              )}
              {tags.length > 6 ? (
                <View style={styles.ovTagChip}><Text style={styles.ovTagChipText}>{tags.length - 6}+ more</Text></View>
              ) : null}
              <ChevronRight size={17} color="#C4C8CE" style={{ alignSelf: 'center' }} />
            </View>
          </TouchableOpacity>
        </View>

        {sizeCount > 0 ? (
          <View style={styles.ovCard}>
            <View style={styles.ovInvHeader}>
              <Text style={styles.ovCardLabel}>INVENTORY</Text>
              <View style={styles.ovInvColHead}>
                <Text style={styles.ovInvColLabel}>Price</Text>
                <Text style={[styles.ovInvColLabel, styles.ovInvQtyCol]}>Inv</Text>
              </View>
            </View>
            {realVariants.map((variant: any, index: number) => {
              const variantPriceNumber = Number(variant?.price ?? variant?.Price ?? canonical.price);
              const variantPrice = Number.isFinite(variantPriceNumber) && variantPriceNumber > 0
                ? `$${variantPriceNumber.toFixed(2)}`
                : 'Not set';
              const optionValues = variant?.optionValues && typeof variant.optionValues === 'object'
                ? Object.values(variant.optionValues).filter(Boolean).map(String).join(' / ')
                : [variant?.option1_value, variant?.option2_value, variant?.option3_value].filter(Boolean).map(String).join(' / ');
              const variantName = optionValues || variant?.title || variant?.Title || variant?.name || variant?.sku || variant?.Sku || `Variant ${index + 1}`;
              const variantSku = variant?.sku || variant?.Sku || null;
              const variantImage = variant?.imageUrl || variant?.ImageUrl || variant?.image || variant?.Image || cover || null;
              return (
                <TouchableOpacity
                  key={variant?.id || variant?.Id || index}
                  style={[styles.ovInvRow, index < realVariants.length - 1 && styles.ovInvDivider]}
                  activeOpacity={0.65}
                  onPress={() => openSectionInEdit('inventory')}
                >
                  {variantImage ? (
                    <Image source={{ uri: variantImage }} style={styles.ovInvThumb} />
                  ) : (
                    <View style={[styles.ovInvThumb, styles.ovHeroEmpty]}>
                      <Icon name="image-outline" size={16} color="#C4C8CE" />
                    </View>
                  )}
                  <View style={styles.ovInvNameCol}>
                    <Text style={styles.ovInvName} numberOfLines={1}>{String(variantName)}</Text>
                    {variantSku ? <Text style={styles.ovInvSku} numberOfLines={1}>{String(variantSku)}</Text> : null}
                  </View>
                  <Text style={styles.ovInvPrice}>{variantPrice}</Text>
                  <Text style={[styles.ovInvStock, styles.ovInvQtyCol]}>{stockForVariant(variant)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        <View style={styles.draftChannelsCard}>
          <View style={styles.draftChannelsHeader}>
            <Text style={styles.draftChannelsTitle}>Target channels</Text>
            <View style={styles.draftChannelsActions}>
              <TouchableOpacity style={styles.draftChannelsManage} onPress={() => setMode('edit')} activeOpacity={0.75}>
                <Text style={styles.draftChannelsManageText}>Manage</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.draftChannelsPublish} onPress={handlePublishPress} activeOpacity={0.82}>
                <Text style={styles.draftChannelsPublishText}>Publish</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.draftChannelsInner}>
            {keys.map((platformKey, index) => {
              const missing = getMissingPlatformFields(
                withSharedImages((displayedPlatforms as any)?.[platformKey] || {}),
                platformKey,
              );
              const needsDetails = missing.length > 0;
              const label = (PLATFORM_META as any)[platformKey]?.label
                || platformKey.charAt(0).toUpperCase() + platformKey.slice(1);
              return (
                <View
                  key={platformKey}
                  style={[styles.draftChannelRow, index < keys.length - 1 && styles.draftChannelDivider]}
                >
                  <View style={styles.draftChannelLogo}>
                    <PlatformLogo type={platformKey} size={20} fallbackIcon="store" />
                  </View>
                  <View style={styles.draftChannelInfo}>
                    <Text style={styles.draftChannelName}>{label}</Text>
                    <View style={styles.draftChannelStatusLine}>
                      <View style={[styles.draftChannelDot, needsDetails && styles.draftChannelDotNeeds]} />
                      <Text style={[styles.draftChannelStatus, needsDetails && styles.draftChannelStatusNeeds]}>
                        {needsDetails ? `${missing.length} detail${missing.length === 1 ? '' : 's'} needed` : 'Ready to publish'}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.ovCard}>
          <Text style={[styles.ovCardLabel, styles.ovCardLabelSolo]}>MORE DETAILS</Text>
          {overviewRow('Brand', brandText, 'Add a brand', 'brand')}
          {overviewRow('Condition', conditionText, 'Select condition', 'condition')}
          {overviewRow('SKU', skuText, 'Add a SKU', 'sku')}
          {overviewRow('Barcode', barcodeText, 'Add or scan', 'barcode')}
          {overviewRow('SEO title', seoTitleText, 'Add an SEO title', 'seoTitle')}
        </View>
      </View>
    );
  };


  return (
    <View style={{ flex: 1 }}>
      {/* Publishing Overlay */}
      {isPublishing && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.7)',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 9999,
        }}>
          <View style={{
            backgroundColor: '#fff',
            marginHorizontal: 16,
            borderRadius: 16,
            padding: 32,
            alignItems: 'center',
            minWidth: 200,
          }}>
            <ActivityIndicator size="large" color={BRAND_PRIMARY} />
            <Text style={{ marginTop: 16, fontSize: 18, fontWeight: '600', color: '#111' }}>
              Publishing...
            </Text>
            <Text style={{ marginTop: 8, fontSize: 14, color: '#666', textAlign: 'center' }}>
              Your product is being published to your connected platforms
            </Text>
          </View>
        </View>
      )}
      <ScrollView
        ref={mainScrollRef}
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 64, paddingBottom: bottomSafePadding }]}
        onScroll={handleTrayScroll}
        scrollEventThrottle={16}
      >
          {effectiveResult ? (

            <>
              {enrichmentStateLabel ? (
                <View style={styles.enrichmentNotice}>
                  <ActivityIndicator size="small" color={CHAT_COLORS.dim} />
                  <Text style={styles.enrichmentNoticeText}>{enrichmentStateLabel}</Text>
                </View>
              ) : null}
              {/* Image Change Handler */}
              {(() => {
    
                return null;
              })()}



              {mode === 'overview' ? renderOverviewSummary() : (
              <View onLayout={(e) => setListingEditorY(e.nativeEvent.layout.y)}>
                <ListingEditorForm
                  ref={listingEditorRef}
                  highlightedField={allMissingRequiredFields[0]?.field}
                  highlightedPlatform={allMissingRequiredFields[0]?.platform}
                  onScrollToOffset={(y) => {
                    mainScrollRef.current?.scrollTo({ y: Math.max(0, listingEditorY + y - 80), animated: true });
                  }}
                  platforms={displayedPlatforms}
                  updateCounter={updateCounter}
                  images={(userImagesByIndex[(effectiveResult?.productIndex as number) ?? 0] || []).filter((url: string) => typeof url === 'string' && url.trim().length > 0)}
                  onChangeImages={handleImagesChange}
                  platformLocations={platformLocations}
                  onChangePlatforms={mergeEditorPlatformChanges}
                  onOpenBarcodeScanner={(onResult) => {
                    openScanner(onResult);
                  }}
                  onOpenImageCapture={openEditorImageCapture}
                  onAddMissingField={(platformKey: string) => {
                    setSelectedMissingPlatform(platformKey);
                    setFieldSearchQuery('');
                    setMissingFieldsModalOpen(true);
                  }}
                  getMissingFieldsCount={(platformKey: string) => getMissingPlatformFields(displayedPlatforms[platformKey] || {}, platformKey).filter(f => f === 'category').length}
                  allMissingCount={allMissingRequiredFields.filter(m => m.field !== 'category').length}
                  onGeneratePlatform={generatePlatform}
                  onRemovePlatform={removeTargetPlatform}
                  generatingPlatformKeys={generatingPlatformKeys}
                  isGenerationMode={true}
                />
              </View>
              )}
            </>
          ) : (
            <Text style={styles.meta}>No results</Text>
          )}
      </ScrollView>

      {/* Floating glass header: overview entry, edit save state, and item switcher. */}
      <View style={[styles.glassHeader, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <ProgressiveBlurView intensity={Platform.OS === 'ios' ? 50 : 28} tint="light" direction="down" />
          <LinearGradient
            colors={['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={styles.glassHeaderRow}>
          <TouchableOpacity
            style={styles.navCircle}
            onPress={() => {
              if (mode === 'edit') setMode('overview');
              else navigation.goBack();
            }}
            activeOpacity={0.85}
          >
            <ChevronLeft size={22} color="#18181B" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 34 }}>
            {mode === 'overview' ? (
              <TouchableOpacity style={styles.modeToggle} onPress={() => setMode('edit')} activeOpacity={0.85}>
                <Text style={styles.modeToggleText}>Edit details</Text>
              </TouchableOpacity>
            ) : saveState === 'saving' ? (
              <View style={styles.savePill}>
                <ActivityIndicator size="small" color={BRAND_PRIMARY} />
                <Text style={[styles.savePillText, { color: BRAND_PRIMARY }]}>Saving…</Text>
              </View>
            ) : saveState === 'error' ? (
              <TouchableOpacity onPress={() => { void flushDraft(); }} activeOpacity={0.7} style={styles.savePill}>
                <Icon name="alert-circle-outline" size={14} color="#DC2626" />
                <Text style={[styles.savePillText, { color: '#DC2626' }]}>Save failed · Retry</Text>
              </TouchableOpacity>
            ) : (
              <Animated.View
                style={[styles.savePill, { opacity: saveState === 'saved' && saveStatusVisible ? 1 : 0 }]}
                pointerEvents="none"
              >
                <Icon name="check" size={14} color="#93C822" />
                <Text style={[styles.savePillText, { color: '#93C822' }]}>Saved</Text>
              </Animated.View>
            )}
          </View>
          <TouchableOpacity
            style={[styles.navCircle, items.length <= 1 && { opacity: 0 }]}
            onPress={() => setItemMenuOpen(open => !open)}
            disabled={items.length <= 1}
            activeOpacity={0.85}
          >
            <Boxes size={19} color="#18181B" />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Item switcher dropdown (chat-style; replaces the bulk ItemJobsModal) ── */}
      {itemMenuOpen ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 5500 }]} pointerEvents="box-none">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setItemMenuOpen(false)} />
          {/* Centered under the title pill (middle of the page), not right-aligned. */}
          <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 58, left: 0, right: 0, alignItems: 'center' }}>
          <View style={[styles.itemDropdown, { position: 'relative', right: undefined, top: undefined }]}>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {items.map((it: any, i: number) => {
                const status = itemStatusForIndex(it.index);
                const active = it.index === currentProductIndex;
                return (
                  <TouchableOpacity
                    key={`${it.index}-${i}`}
                    style={[styles.itemRow, active && styles.itemRowActive]}
                    onPress={() => switchToItem(it.index)}
                    activeOpacity={0.7}
                  >
                    {it.thumb ? (
                      <Image source={{ uri: it.thumb }} style={styles.itemThumb} />
                    ) : (
                      <View style={[styles.itemThumb, { alignItems: 'center', justifyContent: 'center' }]}>
                        <Boxes size={14} color={CHAT_COLORS.faint} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemRowTitle} numberOfLines={1}>{(it.title || '').trim() || `Item ${i + 1}`}</Text>
                      <Text
                        style={[styles.itemRowMeta, { color: status.color === CHAT_COLORS.idle ? CHAT_COLORS.faint : status.color }]}
                        numberOfLines={1}
                      >
                        {status.label}
                      </Text>
                    </View>
                    <View style={[styles.itemDot, { backgroundColor: status.color }]} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          </View>
        </View>
      ) : null}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
        }}
      >
        <Animated.View style={{
          backgroundColor: 'transparent',
          width: '100%',
          zIndex: 100,
          transform: [{ translateY: trayY }],
        }}
          pointerEvents="box-none"
        >
          <LinearGradient
            colors={["rgba(255, 255, 255, 0)", "rgb(255, 255, 255)", "rgb(255, 255, 255)"]}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
            }}
            pointerEvents="none"
          />

          <View
            onLayout={event => setComposerHeight(event.nativeEvent.layout.height)}
            style={{ paddingTop: 20, paddingBottom: 24, paddingHorizontal: 4 }}
          >
            {mode === 'edit' ? (isInputExpanded ? (
            <View style={{ flexDirection: 'column', justifyContent: "center", alignItems: 'flex-start', gap: 8, marginBottom: 4, minWidth: "100%" }}>
              <TouchableOpacity
                onPress={() => { setIsInputExpanded(false); setQuickFixText(''); }}
                activeOpacity={0.85}
                style={{ flexDirection: "row", height: 40, borderRadius: 20, alignSelf: 'center', alignItems: "center", paddingHorizontal: 12, gap: 6, justifyContent: 'center', backgroundColor: '#F1F2EE' }}
              >
                <X size={18} color={CHAT_COLORS.inkSoft} />
                <Text style={{ fontSize: 14, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.ink }}>Cancel</Text>
              </TouchableOpacity>
              <View style={{ flex: 1, minWidth: "100%" }}>
                <MessageComposer
                  autoFocus
                  value={quickFixText}
                  onChangeText={setQuickFixText}
                  placeholder="Wanna change something?"
                  queuedCount={0}
                  isStreaming={quickFixLoading}
                  getAuthToken={ensureSupabaseJwt}
                  onSend={async () => {
                    const text = quickFixText.trim();
                    if (!text) return;
                    setQuickFixText('');
                    try {
                      setQuickFixLoading(true);
                      const baseUrl = API_BASE_URL;
                      const token = await ensureSupabaseJwt();
                      const productId = (route.params as any)?.productId || effectiveResult?.productId;
                      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
                      if (!baseUrl || !productId || !token) return;

                      const targetPlatform = platformKeys[0];
                      const quickFixBase = JSON.parse(JSON.stringify(platformsRef.current));
                      const quickFixGeneration = editorGenerationRef.current;
                      const quickFixSessionKey = editorSessionKey;

                      const res = await fetch(`${baseUrl}/api/products/regenerate/submit`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          mode: 'quick_fix',
                          products: [{
                            productIndex: currentProductIndex,
                            productId,
                            variantId,
                            regenerateType: 'specific_fields',
                            targetPlatform,
                            userQuery: text,
                            currentProductData: quickFixBase,
                          }],
                        }),
                      });

                      if (!res.ok) throw new Error('Quick fix failed');
                      const data = await res.json();
                      if (quickFixGeneration !== editorGenerationRef.current || quickFixSessionKey !== lastEditorSessionKeyRef.current) return;

                      // Show the change as a diff to accept — never a silent overwrite.
                      if (data?.results?.[0]?.fixes) {
                        const fixes = data.results[0].fixes as Record<string, any>;
                        const changes: Array<{ platform: string; field: string; before: any; after: any }> = [];
                        for (const [platform, fieldChanges] of Object.entries(fixes)) {
                          for (const [field, after] of Object.entries(fieldChanges as Record<string, any>)) {
                            const before = quickFixBase?.[platform]?.[field];
                            changes.push({ platform, field, before, after });
                          }
                        }
                        if (changes.length > 0) {
                          setQuickFixDiff({ fixes, userQuery: text, changes });
                          setIsInputExpanded(false);
                        } else {
                          showErrorModal('No changes', 'We didn’t find anything to change for that.', 'info');
                        }
                      }
                    } catch (e) {
                      log.error('[QuickFix] Error:', e);
                      showErrorModal('Fix failed', 'We couldn’t apply that change. Please try again.', 'error');
                    } finally {
                      setQuickFixLoading(false);
                    }
                  }}
                />
              </View>
            </View>
            ) : (
            <TouchableOpacity
              onPress={() => setIsInputExpanded(true)}
              activeOpacity={0.85}
              style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 22, backgroundColor: '#F4F4F2', borderWidth: 1, borderColor: CHAT_COLORS.border, marginBottom: 0 }}
            >
              <PencilIcon size={15} color={CHAT_COLORS.inkSoft} />
              <Text style={{ fontSize: 14, fontFamily: CHAT_FONT.medium, color: CHAT_COLORS.inkSoft }}>Wanna change something?</Text>
            </TouchableOpacity>
            )) : null}

            <KeyboardAwareBottomActionBar
              visible={mode === 'overview' || !isInputExpanded}
              style={{
                position: 'relative',
                bottom: 0,
                left: 0,
                right: 0,
                paddingHorizontal: 18,
                marginBottom: 12,
              }}
              primaryLabel={
                canPublish
                  ? (hasMultipleResults ? `Publish item ${currentProductIndex + 1} to ${readyPlatforms.length} platform${readyPlatforms.length === 1 ? '' : 's'}` : `Publish to ${readyPlatforms.length} platform${readyPlatforms.length === 1 ? '' : 's'}`)
                  : 'Publish listing'
              }
              primaryDisabled={false}
              onPrimary={handlePublishPress}
              secondaryLabel={'Save Draft'}
              onSecondary={doSaveToInventory}
              tertiaryContent={hasMultipleResults ? (
                <Text style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', marginTop: 4 }}>Tap the item pill up top to switch items, then Publish each</Text>
              ) : <View style={{ height: 10 }} />}
            />
          </View>
        </Animated.View>
      </KeyboardAvoidingView>


      {scannerMounted && (
        <View style={styles.scannerDockFull} pointerEvents="box-none">
          <Animated.View pointerEvents={scannerOpen ? 'auto' : 'none'} style={[styles.scannerFullBleed, { height: scannerHeight }]}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing={'back'}
              onBarcodeScanned={scannerOpen ? (result: any) => {
                const code = result?.data || result?.rawValue;
                if (code && (GenerateDetailsScreen as any)._scannerResultHandler) {
                  (GenerateDetailsScreen as any)._scannerResultHandler(code);
                  closeScanner();
                }
              } : undefined}
              barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'upc_a', 'upc_e', 'code128'] }}
            />
            <TouchableOpacity onPress={closeScanner} style={styles.scannerCloseFull}>
              <Text style={{ color: '#fff', fontSize: 28 }}>×</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      )}
      {missingFieldsModalOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setMissingFieldsModalOpen(false)}
            style={styles.modalBackdrop}
          />
          <View style={styles.missingFieldsModal}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#000' }}>Add Missing Field</Text>
              <TouchableOpacity onPress={() => setMissingFieldsModalOpen(false)}>
                <X size={24} color={'#000'} />
              </TouchableOpacity>
            </View>

            {/* Search field */}
            <View style={{ marginBottom: 16 }}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search fields..."
                value={fieldSearchQuery}
                onChangeText={setFieldSearchQuery}
              />
            </View>

            {/* Platform info */}
            <Text style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>
              Platform: {(PLATFORM_META as any)[selectedMissingPlatform]?.label || selectedMissingPlatform}
            </Text>

            <ScrollView style={{ maxHeight: 400 }}>
              {(() => {
                const filteredFields = getFilteredFields(selectedMissingPlatform);
                const missingFields = getMissingFields(selectedMissingPlatform);
                const missingPaths = new Set(missingFields.map(f => f.path));

                // Group fields by their group
                const groupedFields: Record<string, Array<{ path: string; label: string; type: string; required?: boolean }>> = {};
                filteredFields.forEach(field => {
                  const group = field.group || 'Core Fields';
                  if (!groupedFields[group]) groupedFields[group] = [];
                  groupedFields[group].push(field);
                });

                return Object.entries(groupedFields).map(([groupName, fields]) => (
                  <View key={groupName} style={{ marginBottom: 16 }}>
                    <TouchableOpacity
                      onPress={() => setExpandedGroups(prev => ({ ...prev, [groupName]: !prev[groupName] }))}
                      style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}
                    >
                      <Icon name={expandedGroups[groupName] ? 'chevron-down' : 'chevron-right'} size={18} color="#666" />
                      <Text style={{ fontSize: 16, fontWeight: '600', color: '#000', marginLeft: 4 }}>{groupName}</Text>
                    </TouchableOpacity>

                    {expandedGroups[groupName] && fields.map(field => {
                      const isMissing = missingPaths.has(field.path);
                      const isCurrentlyEmpty = !displayedPlatforms[selectedMissingPlatform]?.[field.path];

                      return (
                        <TouchableOpacity
                          key={field.path}
                          onPress={() => addFieldToPlatform(selectedMissingPlatform, field.path)}
                          style={[
                            styles.fieldOption,
                            isMissing && styles.missingFieldOption
                          ]}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 14, fontWeight: '600', color: '#000' }}>
                              {field.label}
                              {field.required && <Text style={{ color: '#ef4444' }}> *</Text>}
                            </Text>
                            <Text style={{ fontSize: 12, color: '#666' }}>
                              {field.type} • {field.path}
                            </Text>
                          </View>
                          {isMissing && (
                            <View style={styles.missingBadge}>
                              <Text style={{ fontSize: 10, color: '#ef4444' }}>Missing</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ));
              })()}
            </ScrollView>

            <TouchableOpacity
              onPress={() => setMissingFieldsModalOpen(false)}
              style={styles.modalCancelButton}
            >
              <Text style={{ color: '#000', fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <PublishFlowSheet
        visible={publishModalOpen}
        needsRows={publishNeedsRows}
        editorProps={{
          platforms: displayedPlatforms,
          updateCounter,
          images: currentItemImages,
          onChangeImages: handleImagesChange,
          platformLocations,
          onChangePlatforms: mergeEditorPlatformChanges,
          onOpenBarcodeScanner: openScanner,
          onOpenImageCapture: openEditorImageCapture,
          onGeneratePlatform: generatePlatform,
          onRemovePlatform: removeTargetPlatform,
          generatingPlatformKeys,
          isGenerationMode: true,
          storedPricingResearch,
        }}
        onClose={() => {
          if (!isPublishing) setPublishModalOpen(false);
        }}
        onDismiss={finishPendingPublishNavigation}
        onConfirm={confirmAndPublish}
        readyPlatforms={readyPlatforms}
        targetPlatforms={platformKeys}
        allConnections={allConnections}
        selectedConnectionIds={selectedConnectionIds}
        setSelectedConnectionIds={setSelectedConnectionIds}
        productSummary={{
          title: buildPlatformPayload().platformDetails?.canonical?.title,
          sku: buildPlatformPayload().platformDetails?.canonical?.sku,
          price: buildPlatformPayload().platformDetails?.canonical?.price
        }}
        isPublishing={isPublishing}
        onSaveToInventory={() => { setPublishModalOpen(false); doSaveToInventory(); }}
        onAddChannel={() => { setPublishModalOpen(false); navigation.navigate('Connections'); }}
        channelOptimization={channelOptimization}
        onOptimize={() => {
          setPublishModalOpen(false);
          setMode('edit');
        }}
      />

      {/* In-app error/notice modal — replaces native alert() so publish/save messages match the app */}
      <ErrorModal
        visible={errorModal.visible}
        type={errorModal.type}
        title={errorModal.title}
        message={errorModal.message}
        onClose={hideErrorModal}
      />

      {/* Quick-fix diff — accept the change or keep the original (never a silent overwrite) */}
      <FieldSheet
        visible={!!quickFixDiff}
        title="Quick fix"
        onClose={() => setQuickFixDiff(null)}
        onSave={applyQuickFix}
        saveLabel="Use this"
        footerExtra={
          <TouchableOpacity
            onPress={() => setQuickFixDiff(null)}
            style={{ height: 50, borderRadius: 999, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.85}
          >
            <Text style={{ fontSize: 15, fontWeight: '600', color: '#3F3F46' }}>Keep original</Text>
          </TouchableOpacity>
        }
      >
        {!!quickFixDiff?.userQuery && (
          <View style={{ alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: 'rgba(147,200,34,0.12)', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16 }}>
            <Text style={{ fontSize: 14, color: '#93C822', fontWeight: '600' }}>{quickFixDiff.userQuery}</Text>
          </View>
        )}
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#71717A', letterSpacing: 0.6, marginBottom: 10 }}>HERE'S THE CHANGE</Text>
        {(quickFixDiff?.changes || []).map((c, i) => {
          const platformSuffix = platformKeys.length > 1 ? ` · ${c.platform.charAt(0).toUpperCase()}${c.platform.slice(1)}` : '';
          return (
            <View key={`${c.platform}-${c.field}-${i}`} style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 14, padding: 14, marginBottom: 10 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#18181B', marginBottom: 8, textTransform: 'capitalize' }}>
                {c.field.replace(/ \(either flat or all variants\)/, '')}{platformSuffix}
              </Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.5, marginBottom: 2 }}>BEFORE</Text>
              <Text style={{ fontSize: 14, color: '#9CA3AF', textDecorationLine: 'line-through', marginBottom: 10 }}>{formatDiffValue(c.before)}</Text>
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#93C822', letterSpacing: 0.5, marginBottom: 2 }}>AFTER</Text>
              <Text style={{ fontSize: 15, fontWeight: '600', color: '#18181B' }}>{formatDiffValue(c.after)}</Text>
            </View>
          );
        })}
      </FieldSheet>
      {/* Media Gallery Modal */}
      {mediaModalVisible && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setMediaModalVisible(false)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.missingFieldsModal, { left: 0, right: 0, borderRadius: 16, backgroundColor: "#FFF", maxHeight: '80%' }]}>
            {/* Modal Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#E5E5E5' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#000' }}>Media Gallery</Text>
              <TouchableOpacity style={[styles.btnSecondary, { backgroundColor: "#FFF" }]} onPress={() => setMediaModalVisible(false)}>
                <Icon name="close" size={20} color={'#000'} />
              </TouchableOpacity>
            </View>

            {/* Media Gallery Display — reflects the item's real images (same source as the strip) */}
            <ScrollView style={{ marginBottom: 16, maxHeight: 300 }}>
              {currentItemImages.filter((url): url is string => typeof url === 'string' && url.trim().length > 0).length === 0 ? (
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 32 }}>
                  <Icon name="image-off" size={48} color="#CCC" />
                  <Text style={{ color: '#666', marginTop: 12, fontSize: 14 }}>No images yet. Tap "Add Photos" to get started.</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {currentItemImages.filter((url): url is string => typeof url === 'string' && url.trim().length > 0).map((imageUrl, index) => (
                    <View key={index} style={{ position: 'relative', width: '30%', aspectRatio: 1 }}>
                      <Image source={{ uri: imageUrl }} style={{ width: '100%', height: '100%', borderRadius: 8 }} />
                      <TouchableOpacity
                        onPress={() => handleRemoveMedia(index)}
                        style={{ position: 'absolute', top: -8, right: -8, width: 28, height: 28, borderRadius: 14, backgroundColor: '#FF4444', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Icon name="close" size={16} color="#FFF" />
                      </TouchableOpacity>
                      <View style={{ position: 'absolute', bottom: 4, left: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ color: '#FFF', fontSize: 12 }}>{index + 1}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            {/* Actions */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={handlePickImage}
                style={{ flex: 1, paddingVertical: 12, backgroundColor: BRAND_PRIMARY, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
              >
                <Icon name="image-plus" size={18} color="#FFF" />
                <Text style={{ color: '#FFF', fontWeight: '600' }}>Add Photos</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMediaModalVisible(false)}
                style={{ flex: 1, paddingVertical: 12, backgroundColor: '#F5F5F5', borderRadius: 8, alignItems: 'center' }}
              >
                <Text style={{ color: '#000', fontWeight: '600' }}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

export default GenerateDetailsScreen;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F8' },
  content: { padding: 16 },

  // Chat-style floating glass header + item switcher
  glassHeader: { ...GLASS_HEADER_STYLES.header },
  glassHeaderRow: { ...GLASS_HEADER_STYLES.headerRow },
  navCircle: { ...GLASS_HEADER_STYLES.navCircle },
  modeToggle: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  modeToggleText: { fontSize: 14, fontWeight: '700', color: '#18181B' },
  savePill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7 },
  savePillText: { fontSize: 13, fontWeight: '600' },
  itemDropdown: { ...GLASS_HEADER_STYLES.dropdown, minWidth: 260, maxWidth: 330, paddingVertical: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, marginHorizontal: 6 },
  itemRowActive: { backgroundColor: CHAT_COLORS.brandSoft },
  itemRowTitle: { fontSize: 15, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold },
  itemRowMeta: { fontSize: 12, fontFamily: CHAT_FONT.medium, marginTop: 2 },
  itemThumb: { width: 34, height: 34, borderRadius: 10, backgroundColor: CHAT_COLORS.bubble },
  itemDot: { width: 8, height: 8, borderRadius: 4 },
  // Read-only overview, duplicated from ProductDetail so the generated draft lands
  // in the same visual and interaction model without touching that reference screen.
  ovProductCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EDEEF1', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  ovHero: { width: '100%', height: 280, borderRadius: 14, backgroundColor: '#ECECEF' },
  ovHeroEmpty: { alignItems: 'center', justifyContent: 'center' },
  ovThumbRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  ovThumb: { width: 58, height: 58, borderRadius: 11, backgroundColor: '#ECECEF' },
  ovTitle: { fontSize: 18, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#111827', marginTop: 13, lineHeight: 23, letterSpacing: -0.2 },
  ovPriceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 7, flexWrap: 'wrap' },
  ovPrice: { fontSize: 22, fontFamily: CHAT_FONT.bold, fontWeight: '800', color: '#111827', letterSpacing: -0.2 },
  ovPriceMeta: { fontSize: 14, fontFamily: CHAT_FONT.medium, fontWeight: '500', color: '#9CA3AF' },
  ovDesc: { fontSize: 13.5, fontFamily: CHAT_FONT.regular, fontWeight: '400', color: '#3F3F46', marginTop: 6, lineHeight: 20 },
  ovCard: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6, marginBottom: 12, borderWidth: 1, borderColor: '#EDEEF1', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  ovCardLabel: { fontSize: 11, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#9CA3AF', letterSpacing: 0.7 },
  ovCardLabelSolo: { paddingTop: 14, paddingBottom: 2 },
  ovInvHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 4 },
  ovInvColHead: { flexDirection: 'row', alignItems: 'center' },
  ovInvColLabel: { width: 64, textAlign: 'right', fontSize: 11.5, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: '#6B7280' },
  ovInvQtyCol: { width: 44 },
  ovInvRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, gap: 11 },
  ovInvDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F1F2F4' },
  ovInvThumb: { width: 36, height: 36, borderRadius: 9, backgroundColor: '#ECECEF' },
  ovInvNameCol: { flex: 1, minWidth: 0 },
  ovInvName: { fontSize: 14, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#111827' },
  ovInvSku: { fontSize: 12, fontFamily: CHAT_FONT.medium, fontWeight: '500', color: '#9CA3AF', marginTop: 1 },
  ovInvPrice: { width: 64, textAlign: 'right', fontSize: 13, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: '#6B7280' },
  ovInvStock: { textAlign: 'right', fontSize: 14, fontFamily: CHAT_FONT.bold, fontWeight: '700', color: '#111827' },
  ovDetailRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, gap: 10 },
  ovDetailDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F1F2F4' },
  ovDetailLabel: { flexShrink: 0, fontSize: 15, fontFamily: CHAT_FONT.semibold, fontWeight: '600', color: '#111827' },
  ovDetailValue: { fontSize: 13.5, fontFamily: CHAT_FONT.medium, fontWeight: '500', color: '#6B7280', textAlign: 'right' },
  ovDetailValueEmpty: { color: '#C4C8CE' },
  ovTagsRow: { paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#F1F2F4' },
  ovTagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8, alignItems: 'center' },
  ovTagChip: { backgroundColor: '#F3F4F6', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  ovTagChipText: { fontSize: 12.5, fontFamily: CHAT_FONT.medium, fontWeight: '500', color: '#3F3F46' },
  draftChannelsCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#EDEEF1' },
  draftChannelsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  draftChannelsTitle: { color: '#71717A', fontSize: 14, fontFamily: CHAT_FONT.medium, fontWeight: '500' },
  draftChannelsActions: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  draftChannelsManage: { minHeight: 32, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#FFFFFF', paddingHorizontal: 12 },
  draftChannelsManageText: { color: '#6B7280', fontSize: 12, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
  draftChannelsPublish: { minHeight: 32, justifyContent: 'center', borderRadius: 999, backgroundColor: BRAND_PRIMARY, paddingHorizontal: 14 },
  draftChannelsPublishText: { color: '#FFFFFF', fontSize: 12, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
  draftChannelsInner: { borderRadius: 14, overflow: 'hidden' },
  draftChannelRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
  draftChannelDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#F1F2F4' },
  draftChannelLogo: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  draftChannelInfo: { flex: 1, minWidth: 0 },
  draftChannelName: { color: '#111827', fontSize: 15, fontFamily: CHAT_FONT.bold, fontWeight: '700' },
  draftChannelStatusLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  draftChannelDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#9CA3AF' },
  draftChannelDotNeeds: { backgroundColor: '#BA7517' },
  draftChannelStatus: { color: '#71717A', fontSize: 12.5, fontFamily: CHAT_FONT.semibold, fontWeight: '600' },
  draftChannelStatusNeeds: { color: '#BA7517' },
  meta: { color: '#000', marginBottom: 4 },
  enrichmentNotice: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F4F4F2',
  },
  enrichmentNoticeText: { color: CHAT_COLORS.dim, fontSize: 12, fontFamily: CHAT_FONT.medium },
  // Full-bleed variant that hugs the top bezel
  scannerDockFull: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5000 },
  scannerFullBleed: { backgroundColor: '#000', borderBottomLeftRadius: 16, borderBottomRightRadius: 16, overflow: 'hidden' },
  scannerCloseFull: { position: 'absolute', top: 100, right: 12, backgroundColor: 'rgba(0,0,0,0.5)', width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  // Missing fields modal
  modalBackdrop: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 6000 },
  missingFieldsModal: {
    position: 'absolute',
    top: '18%',
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 32,
    padding: 20,
    maxHeight: '80%',
    zIndex: 6001
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#E5E5E5',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16
  },
  fieldOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, marginBottom: 8, backgroundColor: '#fff' },
  missingFieldOption: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  missingBadge: { backgroundColor: '#fecaca', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 },
  modalCancelButton: { marginTop: 16, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnSecondary: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
});

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL } from '../config/env';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Image, FlatList, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard, Animated, Easing } from 'react-native';
import { CameraView } from 'expo-camera';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import PyramidGrid from '../components/PyramidGrid';
import { getPlatformRequirements } from '../utils/platformRequirements';
import { Boxes, X, Sparkles, Pencil, ArrowLeft, ChevronLeft, History } from 'lucide-react-native';
import { BlurView } from 'expo-blur';
import { ProgressiveBlurView } from '../components/ProgressiveBlurView';
import { SwipeBackWheel } from '../components/SwipeBackWheel';
import { CHAT_COLORS, CHAT_FONT, GLASS, GLASS_HEADER_STYLES } from '../design/chatGlass';
import KeyboardAwareBottomActionBar from '../components/KeyboardAwareBottomActionBar';
import { SmartCommandInput, FieldOption } from '../components/SmartCommandInput';
import ListingEditorForm from '../components/ListingEditorForm';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { hydratePlatformsFromBackend, normalizeForListingEditor, isEmpty } from '../utils/platformDataHydration';
import { isPlatformReady, getMissingPlatformFields, hasPlatformPrice } from '../utils/platformRequirements';
import { Paths, Directory, File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useJobsOptional } from '../context/JobsContext';
import { usePlatformPickerOverlay } from '../context/PlatformPickerOverlayContext';
import { useJobProgress } from '../hooks/useJobProgress';
import { useCollaboration } from '../hooks/useCollaboration';
import PublishConfirmationModal from '../components/PublishConfirmationModal';
import { PLATFORM_META } from '../utils/platformConstants';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { resolveItemsFromIds, resolveJobMapFromIds } from '../features/cart/flowPayloads';

const ACTION_BAR_HEIGHT = 80;
const ACTION_BAR_BOTTOM_OFFSET = 24;
const SCANNER_GROW_HEIGHT = 240;
const SCANNER_CLOSE_DURATION = 220;

// Feature flag to hide AI refill functionality
const ENABLE_AI_REFILL_FEATURES = false;



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
};

// Platform field schema for hierarchical structure
// Platform field schema extracted to separate file for maintainability
import { PLATFORM_FIELD_SCHEMA } from '../utils/platformSchemas';
// NOTE: Schema currently not used in this file - UI uses ListingEditorForm which has its own logic

// Helper function to group versions by match job ID, showing latest as primary
const groupVersionsByMatchId = (versions: Array<{ id: string; jobId: string; createdAt: string; platforms: any; sources?: Array<{ url: string; usedForFields?: string[] }>; matchJobId?: string; source?: string }>): Array<{ id: string; jobId: string; createdAt: string; platforms: any; sources?: Array<{ url: string; usedForFields?: string[] }>; matchJobId?: string; source?: string; versionCount?: number; allVersions?: Array<any> }> => {
  if (!Array.isArray(versions)) return [];

  // Group by match job ID
  const grouped = versions.reduce((acc, version) => {
    const key = version.matchJobId || 'no-match-id';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(version);
    return acc;
  }, {} as Record<string, typeof versions>);

  // For each group, return the latest version as primary with version count
  const result = Object.entries(grouped).map(([matchJobId, versionGroup]) => {
    // Sort by creation date (newest first)
    const sortedVersions = versionGroup.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latestVersion = sortedVersions[0];

    return {
      ...latestVersion,
      versionCount: sortedVersions.length,
      allVersions: sortedVersions // Store all versions for access
    };
  });

  // Sort results by creation date (newest first)
  return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

// REMOVED - Now using unified hydration utilities from platformDataHydration.ts

function GenerateDetailsScreen({ route, navigation }: Props) {
  const isFocused = useIsFocused();
  const mainScrollRef = useRef<ScrollView>(null);
  const [listingEditorY, setListingEditorY] = useState(0);
  const insets = useSafeAreaInsets();
  const bottomSafePadding = ACTION_BAR_HEIGHT + ACTION_BAR_BOTTOM_OFFSET + insets.bottom + 16;
  // Support both direct props and nested { response: {...} }
  const params: any = (route.params || {}) as any;
  const jobId = params.jobId ?? params.response?.jobId;
  const matchJobId = params.matchJobId ?? params.response?.matchJobId;
  const statusParam = params.status ?? params.response?.status;
  const resultsParam = params.results ?? params.response?.results;
  const summaryParam = params.summary ?? params.response?.summary;
  const completedAtParam = params.completedAt ?? params.response?.completedAt;

  const [fetched, setFetched] = useState(false);
  const [jobData, setJobData] = useState<{ status?: string; results?: GeneratedResult[]; summary?: any; completedAt?: string } | null>(null);
  const [dbImages, setDbImages] = useState<Record<string, string[]>>({});
  const [isInputExpanded, setIsInputExpanded] = useState(false);

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
      console.log('[GEN-DETAILS] Socket update:', socketJobState.status);

      setJobData(prev => {
        // Only update if we have new meaningful data or status change
        if (prev?.status === 'completed' && socketJobState.status !== 'completed') return prev;

        return {
          status: socketJobState.status,
          // If socket provides results, use them. Otherwise keep existing (unless empty)
          results: Array.isArray(socketJobState.results) && socketJobState.results.length > 0
            ? socketJobState.results
            : (prev?.results || []),
          summary: prev?.summary, // Socket might not send summary, keep existing
          completedAt: socketJobState.status === 'completed' ? new Date().toISOString() : prev?.completedAt
        };
      });
    }
  }, [socketJobState, jobId]);

  const status = jobData?.status ?? statusParam;
  const results = jobData?.results ?? resultsParam;
  const first: GeneratedResult | null = useMemo(() => (Array.isArray(results) && results.length > 0 ? results[0] : null), [results]);
  const summary = jobData?.summary ?? summaryParam;

  const completedAt = jobData?.completedAt ?? completedAtParam;

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
          console.log('[GEN-DETAILS] Loaded ProductImages from DB:', imageMap);
          setDbImages(imageMap);
        }
      } catch (err) {
        console.error('[GEN-DETAILS] Failed to load ProductImages:', err);
      }
    })();
    return () => { canceled = true };
  }, [(route.params as any)?.variantId, results === null ? null : results]);

  // Debug logs moved to useEffect to prevent spam on every render
  useEffect(() => {
    console.log('[GEN-DETAILS] route.params keys:', Object.keys((route.params || {}) as any));
    console.log('[GEN-DETAILS] jobId:', jobId, 'status:', status);
    console.log('[GEN-DETAILS] results raw:', Array.isArray(results) ? `len=${results.length}` : typeof results);
  }, [jobId, status, results, route.params]);

  // ========== CRITICAL FIX: useRef for data persistence + auto-save ==========
  const [updateCounter, setUpdateCounter] = useState(0);
  const platformsRef = useRef<GeneratedPlatformDetails>({});
  const [, forceUpdate] = useState({});
  const debounceTimerRef = useRef<any>(null);
  const lastHydratedJobRef = useRef<string | null>(null);
  const lastSavedRef = useRef<string>('');
  const lastScheduledRef = useRef<string | null>(null);

  // Track active regeneration jobs: jobId -> platformKey
  const activeRegenJobsRef = useRef<Record<string, string>>({});
  const [generatingPlatformKeys, setGeneratingPlatformKeys] = useState<Set<string>>(new Set());

  const [currentProductIndex, setCurrentProductIndex] = useState(0);

  // Listen for socket updates for ANY regeneration job we started
  const { onJobProgress } = useCollaboration();

  useEffect(() => {
    if (!onJobProgress) return;

    const unsubscribe = onJobProgress(async (data: any) => {
      const platformKey = activeRegenJobsRef.current[data.jobId];
      if (!platformKey) return; // Not a job we care about

      console.log(`[GEN-DETAILS] Socket update for platform ${platformKey} (job ${data.jobId}): ${data.status}`);

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
            console.log(`[GEN-DETAILS] Hydrating generated data for ${platformKey}`);
            updatePlatforms(prev =>
              hydratePlatformsFromBackend({ [platformKey]: normalized }, prev)
            );
          }
        } catch (err) {
          console.error(`[GEN-DETAILS] Error processing completion for ${platformKey}:`, err);
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
        console.warn(`[GEN-DETAILS] Generation failed for ${platformKey}`);
        delete activeRegenJobsRef.current[data.jobId];
        setGeneratingPlatformKeys(prev => {
          const next = new Set(prev);
          next.delete(platformKey);
          return next;
        });
        Alert.alert('Generation Failed', `Failed to generate details for ${platformKey}. Please try again.`);
      }
    });

    return () => unsubscribe();
  }, [onJobProgress, first?.productIndex]);

  const updatePlatforms = (updater: (prev: GeneratedPlatformDetails) => GeneratedPlatformDetails) => {
    platformsRef.current = updater(platformsRef.current);
    forceUpdate({}); // Trigger re-render
    setUpdateCounter(c => c + 1); // Signal content change
    console.log('[GEN-DETAILS] Updated platforms, triggering auto-save...');
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
          console.log(`[userImagesByIndex] P0: Using params images for index ${idx}:`, validImgs.length);
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
            console.log(`[userImagesByIndex] P1: Replaced with DB images for index ${idx}:`, dbImgs.length);
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
          console.log(`[userImagesByIndex] P2: Merged draft images for index ${idx}:`, draftImages.length, 'Total:', merged.length);
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
    const currentJobId = `${jobId || 'job'}-${currentProductIndex}` + (res.platforms ? JSON.stringify(res.platforms).slice(0, 50) : '');
    if (lastHydratedJobRef.current === currentJobId) {
      console.log('[GEN-DETAILS] Skipping re-hydration - same job/item');
      return;
    }

    const rawPlatforms = res.platforms;
    console.log('[GEN-DETAILS] Hydrating new data. JobId:', currentJobId);
    console.log('[GEN-DETAILS] Raw platforms from backend:', rawPlatforms);

    // Normalize each platform for ListingEditorForm compatibility
    const normalized: Record<string, any> = {};
    for (const [key, value] of Object.entries(rawPlatforms)) {
      normalized[key] = normalizeForListingEditor(value);
    }

    console.log('[GEN-DETAILS] Normalized platforms:', Object.keys(normalized));

    // CRITICAL: If backend didn't send shopify, create it from first available platform
    // This ensures canonicalKey (which prefers shopify) has data to display
    if (!normalized.shopify && Object.keys(normalized).length > 0) {
      const firstPlatformKey = Object.keys(normalized)[0];
      const firstPlatformData = normalized[firstPlatformKey];
      console.log('[GEN-DETAILS] Backend missing shopify - creating canonical from:', firstPlatformKey);

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
        price: typeof firstPlatformData.price === 'string'
          ? parseFloat(firstPlatformData.price.replace(/[^0-9.]/g, '')) || 0
          : (firstPlatformData.price || 0),
        sku: firstPlatformData.sku || '',
        barcode: firstPlatformData.barcode || '',
        weight: firstPlatformData.weight || 0,
        weightUnit: firstPlatformData.weightUnit || 'kg',
        tags: firstPlatformData.tags || [],
        images: imageUrls,
      };
    }

    // Hydrate into platformsRef (preserves user edits)
    const hydrated = hydratePlatformsFromBackend(normalized, platformsRef.current);
    console.log('[GEN-DETAILS] Hydrated platforms:', Object.keys(hydrated));
    updatePlatforms(() => hydrated);

    lastHydratedJobRef.current = currentJobId;
  }, [results, jobId, currentProductIndex]);


  // ========== AUTO-SAVE DEBOUNCE: Save to /api/products/drafts every 2s idle ==========
  // Only run when variantId changes; only schedule save when draft content actually changed (stops spam when nothing changed)
  const variantIdForDraft = (route.params as any)?.variantId || (Array.isArray(results) && results.length > 0 ? ((results as any[]).find((r: any) => r.productIndex === currentProductIndex) || results[0])?.variantId : undefined);
  useEffect(() => {
    const variantId = variantIdForDraft;
    if (!variantId || !platformsRef.current || Object.keys(platformsRef.current).length === 0) {
      return;
    }

    const currentJson = JSON.stringify(platformsRef.current);
    if (currentJson === lastSavedRef.current) {
      return;
    }
    if (lastScheduledRef.current !== null && lastScheduledRef.current === currentJson) {
      return;
    }
    lastScheduledRef.current = currentJson;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      try {
        const baseUrl = API_BASE_URL;
        const token = await ensureSupabaseJwt();

        if (!baseUrl || !token) {
          console.log('[GEN-DETAILS AutoSave] Missing baseUrl or token, skipping');
          lastScheduledRef.current = null;
          return;
        }

        const currentData = JSON.stringify(platformsRef.current);
        if (currentData === lastSavedRef.current) {
          console.log('[GEN-DETAILS AutoSave] No changes, skipping save');
          lastScheduledRef.current = null;
          return;
        }

        const response = await fetch(`${baseUrl}/api/products/drafts/${variantId}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            draftData: platformsRef.current,
            // Include media so backend validation passes
            media: buildPlatformPayload().media
          })
        });

        if (response.ok) {
          lastSavedRef.current = currentData;
          lastScheduledRef.current = null;
          console.log('[GEN-DETAILS AutoSave] ✅ Draft auto-saved successfully');
        } else {
          const errorText = await response.text();
          console.error('[GEN-DETAILS AutoSave] ❌ Failed to auto-save draft:', response.status, errorText);
          lastScheduledRef.current = null;
        }
      } catch (error) {
        console.error('[GEN-DETAILS AutoSave] ❌ Error auto-saving draft:', error);
        lastScheduledRef.current = null;
      }
    }, 2000);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [variantIdForDraft, updateCounter]);
  const platformKeys: string[] = useMemo(() => Object.keys(displayedPlatforms as Record<string, any>), [displayedPlatforms]);
  // Chat-style item switcher dropdown (replaces the old bulk ItemJobsModal here)
  const [itemMenuOpen, setItemMenuOpen] = useState(false);
  const [userGenerateJobs, setUserGenerateJobs] = useState<Array<{ jobId: string; status: string; createdAt: string; completedAt?: string }>>([]);
  const [checklist, setChecklist] = useState<Record<string, { missing: string[]; ready: boolean }>>({});
  const [versionsSheetOpen, setVersionsSheetOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ id: string; jobId: string; createdAt: string; platforms: any; sources?: Array<{ url: string; usedForFields?: string[] }>; matchJobId?: string; source?: string; versionCount?: number; allVersions?: Array<any> }>>([]);
  const [selectedFieldKey, setSelectedFieldKey] = useState<string | null>(null);
  const [versionsTab, setVersionsTab] = useState<'versions' | 'sources'>('versions');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerMounted, setScannerMounted] = useState(false);
  const scannerHeight = useRef(new Animated.Value(0)).current;
  const [isFilling, setIsFilling] = useState(false);
  const [recentlyFilledByPlatform, setRecentlyFilledByPlatform] = useState<Record<string, string[]>>({});
  const [fillSelectedFields, setFillSelectedFields] = useState<string[]>([
    'title', 'description', 'price', 'barcode'
  ]);
  const [lastFillCount, setLastFillCount] = useState<number>(0);
  const [refilledFieldsByPlatform, setRefilledFieldsByPlatform] = useState<Record<string, string[]>>({});
  const [fillOverlayOpen, setFillOverlayOpen] = useState<boolean>(false);
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
  // Regenerate modal state
  const [regenModalOpen, setRegenModalOpen] = useState(false);
  const [regenPlatformKey, setRegenPlatformKey] = useState<string | null>(null);
  const [regenFieldKey, setRegenFieldKey] = useState<string | null>(null);
  const [regenText, setRegenText] = useState<string>('');
  const [regenVersions, setRegenVersions] = useState<Array<{ label: string; text: string }>>([]);
  const [regenActiveVersion, setRegenActiveVersion] = useState(0);
  const [regenSubmitting, setRegenSubmitting] = useState(false);
  const [regenAutoRun, setRegenAutoRun] = useState(false);
  const [quickFixLoading, setQuickFixLoading] = useState(false);
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [allConnections, setAllConnections] = useState<any[]>([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState<Record<string, string>>({});
  const [platformLocations, setPlatformLocations] = useState<Record<string, Array<{ id: string; name: string; connectionId: string; connectionName: string; platformType: string }>>>({});
  const [mediaGallery, setMediaGallery] = useState<string[]>([]);
  const [mediaModalVisible, setMediaModalVisible] = useState(false);
  const [selectedVariantForMedia, setSelectedVariantForMedia] = useState<string | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [facebookSyncMeta, setFacebookSyncMeta] = useState<{
    status: 'idle' | 'pending' | 'syncing' | 'success' | 'error';
    lastSyncAt: string | null;
    lastError: string | null;
  }>({ status: 'idle', lastSyncAt: null, lastError: null });

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

        const connRes = await fetch(`${baseUrl}/api/platform-connections`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        let connections = connRes.ok ? await connRes.json() : [];
        setAllConnections(connections);

        // ⚡ OPTIMIZED: Query PlatformLocations directly from DB instead of calling sync endpoint
        console.log('[GenerateDetails] ⚡ Loading locations directly from PlatformLocations table...');

        const connectionIds = connections.map((c: any) => c.Id);
        if (connectionIds.length === 0) {
          console.log('[GenerateDetails] No connections found');
          setPlatformLocations({});
          return;
        }

        // Query PlatformLocations directly from Supabase
        const { data: platformLocs, error } = await supabase
          .from('PlatformLocations')
          .select('PlatformConnectionId, PlatformLocationId, Name')
          .in('PlatformConnectionId', connectionIds);

        if (error) {
          console.error('[GenerateDetails] Failed to query PlatformLocations:', error);
          setPlatformLocations({});
          return;
        }

        console.log('[GenerateDetails] ✅ Retrieved', platformLocs?.length || 0, 'locations from DB in <1s');

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

        console.log('[GenerateDetails] Built platform locations:', Object.keys(locsByPlatform).map(p => `${p}: ${locsByPlatform[p].length} locs`));
        setPlatformLocations(locsByPlatform);

        // ⚡ FIX: Ensure ALL enabled platforms appear in displayedPlatforms for publishing
        // Even if AI generation didn't produce data for a platform, user should be able to publish to it
        const enabledPlatformTypes = [...new Set(
          connections
            .filter((c: any) => c.IsEnabled && c.Status === 'active')
            .map((c: any) => c.PlatformType?.toLowerCase())
        )];

        console.log('[GenerateDetails] Enabled platforms from connections:', enabledPlatformTypes);

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
              console.log(`[GenerateDetails] Hydrated locations for existing platform: ${pt}`);
              added = true;
            }
          }
        }

        if (added) {
          updatePlatforms(() => updatedPlatforms);
        }
      } catch (e) {
        console.error('Failed to fetch connections/locations:', e);
      }
    })();
  }, []);

  useEffect(() => {
    if (regenModalOpen && regenAutoRun && !regenSubmitting) {
      // small delay to allow modal layout before firing
      const t = setTimeout(() => {
        submitRegenerateField();
        setRegenAutoRun(false);
      }, 150);
      return () => clearTimeout(t);
    }
  }, [regenModalOpen, regenAutoRun, regenSubmitting]);

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
    const targetJobId = itemGenerateJobs[idx]?.jobId;
    if (targetJobId && jobId && targetJobId !== jobId && !hasResultForIndex(idx)) {
      // Item lives on a different generate job — reload the screen against it.
      navigation.navigate('LoadingScreen' as any, {
        processType: 'generate',
        payload: { jobId: targetJobId, firstPhotos: [] },
        onCompleteRoute: {
          screen: 'GenerateDetailsScreen',
          params: { jobId: targetJobId, items, jobMap: itemGenerateJobs, focusIndex: idx },
        },
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
      if (Array.isArray(p.variants) && p.variants.length) {
        for (const v of p.variants) {
          const inv = v?.inventoryByLocation;
          if (inv && typeof inv === 'object') {
            Object.values(inv).forEach((loc: any) => {
              const q = Number(loc?.quantity ?? 0);
              if (!Number.isNaN(q)) total += q;
            });
          }
        }
      }
      if (total === 0) {
        const candidates = [p.quantity, p.inventoryQuantity, p?.listingDetails?.quantity, p?.locationQuantities?.default];
        for (const c of candidates) {
          if (typeof c === 'number' && !Number.isNaN(c)) { total = c; break; }
        }
      }
      out[key] = total || 0;
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

  // Fetch versions when sheet opens
  useEffect(() => {
    if (!versionsSheetOpen) return;

    // Try to get versions from generate jobs related to this match
    const productId = (route.params as any)?.productId || effectiveResult?.productId || null;
    const variantId = (route.params as any)?.variantId || effectiveResult?.variantId || null;
    const currentMatchJobId = matchJobId;

    (async () => {
      try {
        // First try to get versions from the backend API
        const baseUrl = API_BASE_URL;
        if (baseUrl && productId) {
          const token = await ensureSupabaseJwt();
          const res = await fetch(`${baseUrl}/api/products/generate/versions?productId=${encodeURIComponent(productId)}${variantId ? `&variantId=${encodeURIComponent(variantId)}` : ''}&limit=20&offset=0`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) {
              // Group versions by match job ID and show latest version as primary
              const groupedVersions = groupVersionsByMatchId(data);
              setVersions(groupedVersions);
              return;
            }
          }
        }

        // Fallback: get all generate jobs and filter by current match context
        const token = await ensureSupabaseJwt();
        const { data: generateJobs, error } = await supabase
          .from('generate_jobs')
          .select('job_id, status, created_at, results, match_job_id')
          .eq('status', 'completed')
          .order('created_at', { ascending: false })
          .limit(50); // Increased limit to get more versions for grouping

        if (!error && generateJobs) {
          const relatedVersions = generateJobs
            .filter(job => {
              // Include jobs that either have the same match_job_id or contain results for the same product
              return job.match_job_id === currentMatchJobId ||
                (Array.isArray(job.results) && job.results.some((r: any) =>
                  r.productId === productId || r.productIndex === effectiveResult?.productIndex
                ));
            })
            .map(job => ({
              id: job.job_id,
              jobId: job.job_id,
              createdAt: job.created_at,
              platforms: job.results?.[0]?.platforms || {},
              matchJobId: job.match_job_id,
              source: job.results?.[0]?.source || 'generated'
            }));

          // Group versions by match job ID  
          const groupedVersions = groupVersionsByMatchId(relatedVersions);
          setVersions(groupedVersions);
        }
      } catch (e) {
        console.error('Error fetching versions:', e);
      }
    })();
  }, [versionsSheetOpen, first, route.params, matchJobId]);

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

          console.log('[GenerateDetails] Updated jobsByIndex:', jobsByIndex);
          setItemGenerateJobs(jobsByIndex);
        }
      } catch { }
    })();
    return () => { canceled = true };
  }, []);

  // Helper: compute overall readiness with flexible pricing
  // Compute which platforms are ready to publish
  const readyPlatforms = useMemo(() => {
    return platformKeys.filter(platformKey => {
      const platformData = (displayedPlatforms as any)?.[platformKey] || {};
      return isPlatformReady(platformData, platformKey, ignoredPlatforms);
    });
  }, [displayedPlatforms, platformKeys, ignoredPlatforms]);

  const canPublish = useMemo(() => readyPlatforms.length > 0, [readyPlatforms]);

  // Readiness step-through: compute all missing required fields across all non-ignored platforms
  const [missingFieldNavIndex, setMissingFieldNavIndex] = useState(0);
  const allMissingRequiredFields = useMemo(() => {
    const missing: Array<{ platform: string; field: string; label: string }> = [];
    const seenLabels = new Set<string>();
    for (const pk of platformKeys) {
      if (ignoredPlatforms.includes(pk)) continue;
      const platformData = (displayedPlatforms as any)?.[pk] || {};
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
  }, [displayedPlatforms, platformKeys, ignoredPlatforms]);

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

  // Field panel open handler
  const handleOpenFieldPanel = (fieldKey: string) => {
    setSelectedFieldKey(fieldKey);
    setVersionsTab('versions');
    setVersionsSheetOpen(true);
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
            const raw = (canonical as any).price;
            if (typeof raw === 'number') return raw;
            const cleaned = parseFloat(String(raw ?? '').replace(/[^0-9.]/g, ''));
            return Number.isFinite(cleaned) ? cleaned : 0;
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
                console.log('[buildPlatformPayload] Converting modern optionValues to legacy format:', v.optionValues);
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
              // Filter out empty strings, null, undefined, and scraped URLs
              if (typeof u === 'string' && u.trim().length > 0 && !u.includes('firecrawl') && !u.includes('serpapi')) {
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
        console.log('[buildPlatformPayload] Using user images (DB + params):', imageUris);
        return { imageUris, coverImageIndex: 0 };
      })(),
      selectedPlatformsToPublish: Object.keys(displayedPlatforms || {}),
    };

    return payload;
  };

  const fillTheRest = async () => {
    if (isFilling || !ENABLE_AI_REFILL_FEATURES) return;
    try {
      setIsFilling(true);
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      if (!baseUrl || !productId || !variantId || !token) return;

      const payload = buildPlatformPayload();
      const selectedPlatforms = Object.keys(displayedPlatforms || {});

      const res = await fetch(`${baseUrl}/api/products/generate-details`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          imageUris: payload.media.imageUris,
          coverImageIndex: payload.media.coverImageIndex,
          selectedPlatforms,
          selectedMatch: null,
          enhancedWebData: null,
        })
      });
      if (!res.ok) return;
      const data = await res.json();
      const gen = (data?.generatedDetails || data || {}) as any;
      const genPlatforms = (gen || {}) as Record<string, any>;
      console.log('[GEN-DETAILS] fillTheRest generated platform keys:', Object.keys(genPlatforms));

      const mergeFields = ['title', 'description', 'tags', 'price', 'weight', 'weightUnit', 'sku', 'barcode', 'images', 'options', 'seoTitle', 'seoDescription'];
      const next = { ...displayedPlatforms } as any;
      const changedMap: Record<string, string[]> = {};
      for (const k of Object.keys(genPlatforms)) {
        const incoming = genPlatforms[k] || {};
        const curr = next[k] || {};
        const merged: any = { ...curr };
        for (const f of mergeFields) {
          if (!fillSelectedFields.includes(f)) continue;
          const currVal = curr?.[f];
          const incomingVal = incoming?.[f];
          const isEmpty = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
          if (isEmpty(currVal) && incomingVal !== undefined) {
            merged[f] = Array.isArray(incomingVal) ? [...incomingVal] : incomingVal;
            if (!changedMap[k]) changedMap[k] = [];
            changedMap[k].push(f);
          }
        }
        next[k] = merged;
      }
      updatePlatforms(next);
      setRecentlyFilledByPlatform(changedMap);
      // Track refilled fields per platform for pill badges
      setRefilledFieldsByPlatform(prev => {
        const merged: Record<string, string[]> = { ...prev };
        for (const k of Object.keys(changedMap)) {
          const prevArr = merged[k] || [];
          merged[k] = Array.from(new Set([...prevArr, ...changedMap[k]]));
        }
        return merged;
      });
      // write into platform state so ListingEditorForm can render badge without screen prop threading
      updatePlatforms(prev => {
        const out: any = { ...prev };
        for (const k of Object.keys(changedMap)) {
          out[k] = { ...(out[k] || {}), __refilled: Array.from(new Set([...((out[k]?.__refilled) || []), ...changedMap[k]])) };
        }
        return out;
      });
    } catch { }
    finally {
      setIsFilling(false);
    }
  };

  const regenerateField = async (platformKey: string, fieldKey: string) => {
    if (!ENABLE_AI_REFILL_FEATURES) return;
    setRegenPlatformKey(platformKey);
    setRegenFieldKey(fieldKey);
    // Seed versions with current text as Version 1
    const currentVal = ((displayedPlatforms as any)?.[platformKey] || {})[fieldKey];
    const baseText = Array.isArray(currentVal) ? currentVal.join(', ') : (currentVal ?? '');
    setRegenVersions([{ label: 'Version 1', text: String(baseText) }]);
    setRegenActiveVersion(0);
    setRegenText('');
    setRegenModalOpen(true);
    // If field is empty, auto-run regenerate when modal opens
    const isEmpty = baseText === '' || baseText == null;
    setRegenAutoRun(isEmpty);
  };

  const submitRegenerateField = async () => {
    try {
      setRegenSubmitting(true);
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      if (!baseUrl || !productId || !variantId || !regenPlatformKey || !regenFieldKey || !token) return;
      const payload = buildPlatformPayload();

      const submit = await fetch(`${baseUrl}/api/products/regenerate/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generateJobId: jobId,
          products: [{
            productIndex: currentProductIndex,
            productId,
            variantId,
            regenerateType: 'specific_fields',
            targetPlatform: regenPlatformKey,
            targetFields: [regenFieldKey],
            userQuery: regenText,
            customPrompt: regenText,
            imageUrls: payload.media.imageUris,
          }],
          options: { useExistingScrapedData: true }
        })
      });
      if (!submit.ok) throw new Error('regenerate submit failed');
      const submitJson = await submit.json();
      const regenJobId = submitJson?.jobId;

      const resultPayload = await pollRegenerateUntilDone(regenJobId, token || undefined);
      const resultArray = Array.isArray(resultPayload?.results) ? resultPayload.results : [];
      const matched = resultArray.find((r: any) => r.productIndex === currentProductIndex) || resultArray[0];
      const incomingPlatform = (matched?.platforms || {})[regenPlatformKey] || {};
      if (incomingPlatform && Object.prototype.hasOwnProperty.call(incomingPlatform, regenFieldKey)) {
        const newText = Array.isArray(incomingPlatform[regenFieldKey!]) ? (incomingPlatform[regenFieldKey!] as any[]).join(', ') : String(incomingPlatform[regenFieldKey!]);
        setRegenVersions(prev => [...prev, { label: `Version ${prev.length + 1}`, text: newText }]);
        setRegenActiveVersion(prev => prev + 1);
        updatePlatforms(prev => ({
          ...prev,
          [regenPlatformKey]: (() => {
            const curr = prev?.[regenPlatformKey] || {} as any;
            const __refilled = Array.from(new Set([...(curr.__refilled || []), regenFieldKey!]));
            return {
              ...curr,
              [regenFieldKey!]: Array.isArray(incomingPlatform[regenFieldKey!]) ? [...incomingPlatform[regenFieldKey!]] : incomingPlatform[regenFieldKey!],
              __refilled,
            };
          })()
        }));
        setRefilledFieldsByPlatform(prev => ({
          ...prev,
          [regenPlatformKey]: Array.from(new Set([...(prev[regenPlatformKey] || []), regenFieldKey!]))
        }));
      }
    } catch (e) {
      console.error('Regenerate field failed:', e);
    } finally {
      setRegenSubmitting(false);
    }
  };

  const doSaveToInventory = async () => {
    console.log('[doSaveToInventory] Starting inventory save...');
    try {
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      if (!baseUrl || !productId || !variantId || !token) {
        console.log('[doSaveToInventory] Missing required data');
        return;
      }

      const payload = buildPlatformPayload();

      // SKU Enhancement: If SKU is DRAFT- or missing, generate a permanent INV- SKU
      let finalSku = payload.platformDetails.canonical.sku;
      if (!finalSku || finalSku.startsWith('DRAFT-')) {
        const randomSuffix = Math.random().toString(36).substring(2, 10).toUpperCase();
        finalSku = `INV-${randomSuffix}`;
        console.log('[doSaveToInventory] Generated permanent SKU:', finalSku);

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

      console.log('[doSaveToInventory] Saving payload:', JSON.stringify(payload, null, 2));

      const res = await fetch(`${baseUrl}/api/products/publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          variantId,
          publishIntent: 'SAVE_TO_INVENTORY', // Changed intent
          platformDetails: payload.platformDetails,
          media: payload.media,
          selectedPlatformsToPublish: [],
        })
      });

      if (res.ok) {
        console.log('[doSaveToInventory] Saved to inventory successfully');

        // Navigate to confirmation screen
        // We construct the params similar to doPublish
        const canonicalKey = platformKeys.includes('shopify') ? 'shopify' : platformKeys[0];
        const canonical = displayedPlatforms[canonicalKey] || {};

        navigation.navigate('PublishConfirmation', {
          productId,
          variantId,
          title: canonical.title,
          description: canonical.description,
          price: canonical.price,
          imageUrl: (effectiveResult as any)?.imageUrl, // Use original image URL or from payload if available
          platforms: [], // No external platforms
          savedToInventory: true, // Flag for UI
          origin: 'generate'
        } as any);

      } else {
        const errorText = await res.text();
        console.error('[doSaveToInventory] Save failed:', errorText);
        Alert.alert('Error', `Failed to save to inventory: ${errorText}`);
      }
    } catch (err) {
      console.error('[doSaveToInventory] Error saving:', err);
      Alert.alert('Error', 'An unexpected error occurred while saving.');
    }
  };

  const doPublish = async () => {
    console.log('doPublish - Starting publish flow');
    console.log('displayedPlatforms:', JSON.stringify(displayedPlatforms, null, 2));
    console.log('readyPlatforms:', readyPlatforms);
    console.log('platformKeys:', platformKeys);

    try {
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      if (!baseUrl || !token) {
        console.log('doPublish - Missing baseUrl or token');
        return;
      }

      // Check if connections are loaded, if not fetch them now
      let connectionsToUse = allConnections;
      if (!connectionsToUse || connectionsToUse.length === 0) {
        console.log('[doPublish] Connections not loaded yet, fetching now...');
        const connRes = await fetch(`${baseUrl}/api/platform-connections`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        connectionsToUse = connRes.ok ? await connRes.json() : [];
        setAllConnections(connectionsToUse);
      }

      console.log('[doPublish] Using connections:', connectionsToUse);
      console.log('[doPublish] Connections count:', connectionsToUse?.length);

      const payload = buildPlatformPayload();
      const canonical = payload.platformDetails?.canonical || {};
      console.log('doPublish - Canonical payload:', canonical);

      // Validate readiness with flexible pricing
      const missingByPlatform: Record<string, string[]> = {};

      for (const platform of readyPlatforms) {
        const platformKey = String(platform).toLowerCase();
        const platformData = (payload.platformDetails as any)?.[platformKey] || {};
        const missing = getMissingPlatformFields(platformData, platformKey);

        if (missing.length > 0) {
          console.log(`doPublish - ${platformKey} missing fields:`, missing);
          missingByPlatform[platformKey] = missing;
        } else {
          console.log(`doPublish - ${platformKey} is ready to publish`);
        }
      }
      console.log('doPublish - Missing by platform:', missingByPlatform);

      console.log('[doPublish] Using already-fetched connections:', allConnections);
      console.log('[doPublish] Connections count:', allConnections?.length);

      if (Object.keys(missingByPlatform).length) {
        const lines = Object.entries(missingByPlatform).map(([plat, fields]) =>
          `${PLATFORM_META[plat]?.label || plat}: Missing ${fields.join(', ')}`
        );
        alert(`Cannot publish yet!\n\n${lines.join('\n')}\n\nPlease fill in all required fields.`);
        return;
      }

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

      // Set empty selections initially - PublishConfirmationModal will handle default 'ALL' selection
      setSelectedConnectionIds({});

      // Show modal - connections are already in allConnections state from mount
      console.log('[doPublish] About to show modal with', connectionsToUse.length, 'connections');
      setPublishModalOpen(true);

    } catch (err) {
      console.error('Error in doPublish:', err);
      alert('Failed to prepare publish. Please try again.');
    }
  };

  // Upload local image URIs to Supabase and return public URLs
  const uploadLocalImagesToSupabase = async (localUris: string[]): Promise<string[]> => {
    const publicUrls: string[] = [];
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      for (const localUri of localUris) {
        // Skip if already a public URL
        if (localUri.startsWith('http://') || localUri.startsWith('https://')) {
          publicUrls.push(localUri);
          continue;
        }

        try {
          console.log('[UPLOAD] Uploading image:', localUri);
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
            console.error('[UPLOAD] Supabase upload error:', error);
            continue; // Skip this image but continue with others
          }

          const { data: urlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(fileName);

          const publicUrl = urlData.publicUrl;
          console.log('[UPLOAD] Successfully uploaded to:', publicUrl);
          publicUrls.push(publicUrl);
        } catch (err) {
          console.error('[UPLOAD] Failed to upload image:', localUri, err);
        }
      }
    } catch (err) {
      console.error('[UPLOAD] Upload batch failed:', err);
    }
    return publicUrls;
  };

  const confirmAndPublish = async () => {
    let facebookRequested = false;
    try {
      console.log('[confirmAndPublish] Starting publish...');
      setPublishModalOpen(false);
      setIsPublishing(true); // Show publishing indicator immediately

      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      console.log('[confirmAndPublish] Got IDs:', { productId, variantId, baseUrl: !!baseUrl, token: !!token });
      if (!baseUrl || !productId || !variantId || !token) {
        console.log('[confirmAndPublish] Missing required data, aborting');
        setIsPublishing(false);
        return;
      }

      const rawPayload = buildPlatformPayload();

      // Upload local images to Supabase before publishing
      console.log('[confirmAndPublish] Uploading local images...');
      const uploadedImageUris = await uploadLocalImagesToSupabase(rawPayload.media.imageUris || []);
      console.log('[confirmAndPublish] Uploaded images:', uploadedImageUris);

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
      for (const [platform, selection] of Object.entries(selectedConnectionIds)) {
        const platformConns = allConnections.filter((c: any) =>
          c.PlatformType?.toLowerCase() === platform.toLowerCase() && c.IsEnabled
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

      const platformsToPublish = Object.keys(actualConnectionIds);
      facebookRequested = platformsToPublish.map(p => p.toLowerCase()).includes('facebook');

      const publishPayload = {
        productId,
        variantId,
        publishIntent: 'PUBLISH_PLATFORM_LIVE',
        platformDetails: payload.platformDetails,
        media: payload.media,
        selectedPlatformsToPublish: platformsToPublish,
        connectionIds: actualConnectionIds,
      };

      console.log('[confirmAndPublish] Publishing to:', platformsToPublish);
      console.log('[confirmAndPublish] Connection IDs:', actualConnectionIds);
      console.log('[confirmAndPublish] Canonical data being sent:', JSON.stringify(payload.platformDetails.canonical, null, 2));
      console.log('[confirmAndPublish] Full payload:', JSON.stringify(publishPayload, null, 2));

      // Prepare navigation params ahead of time for optimistic navigation
      const imageUrl = (() => {
        const idx = typeof payload.media?.coverImageIndex === 'number' ? payload.media.coverImageIndex : 0;
        const arr = Array.isArray(payload.media?.imageUris) ? payload.media.imageUris : [];
        return arr[idx] || effectiveResult?.sourceImageUrl || '';
      })();

      const navigationParams = {
        productId,
        variantId,
        title: canonical.title,
        description: canonical.description,
        price: Number(canonical.price || 0),
        imageUrl,
        platforms: platformsToPublish,
        accountNames: accountNamesList,
        quantityByPlatform: quantityByPlatformComputed,
        origin: 'generate',
        sourcePlatform: platformsToPublish[0] || 'shopify',
        isPublishing: true, // Tell the confirmation screen we're still publishing
      };

      // Send the publish request
      const publishRes = await fetch(`${baseUrl}/api/products/publish`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(publishPayload),
      });

      console.log('[confirmAndPublish] Response status:', publishRes.status);

      if (!publishRes.ok) {
        const errorText = await publishRes.text();
        console.error('Publish failed:', errorText);
        setIsPublishing(false);

        // Parse error for better user messaging
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.statusCode === 409 && errorJson.details?.sku) {
            alert(`SKU "${errorJson.details.sku}" is already in use by another product. Please change the SKU and try again.`);
          } else {
            alert(`Failed to publish: ${errorJson.message || errorText}`);
          }
        } catch {
          alert(`Failed to publish: ${errorText}`);
        }

        // Don't clear data on error - user can fix and retry
        if (facebookRequested) {
          setFacebookSyncMeta({ status: 'error', lastSyncAt: facebookSyncMeta.lastSyncAt, lastError: errorText });
        }
        return;
      }

      if (facebookRequested) {
        setFacebookSyncMeta({ status: 'syncing', lastSyncAt: null, lastError: null });
        const deadline = Date.now() + 10_000;
        let lastPending = 0;

        while (Date.now() < deadline) {
          const reconcileRes = await fetch(`${baseUrl}/api/products/facebook-personal/reconcile`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ variantId }),
          });

          if (reconcileRes.ok) {
            const reconcileData = await reconcileRes.json().catch(() => ({}));
            const updated = Number(reconcileData?.updated || 0);
            const failed = Number(reconcileData?.failed || 0);
            lastPending = Number(reconcileData?.pending || 0);

            if (failed > 0) {
              setFacebookSyncMeta({ status: 'error', lastSyncAt: null, lastError: 'Facebook Marketplace publish failed.' });
              throw new Error('Facebook Marketplace publish failed. Please retry.');
            }
            if (updated > 0 || lastPending === 0) {
              setFacebookSyncMeta({ status: 'success', lastSyncAt: new Date().toISOString(), lastError: null });
              break;
            }
          }

          await new Promise(res => setTimeout(res, 1200));
        }

        if (lastPending > 0) {
          setFacebookSyncMeta({ status: 'pending', lastSyncAt: null, lastError: null });
          console.log('[confirmAndPublish] Facebook publish still pending after 10s; background sync will continue.');
        }
      }

      // Success! Navigate to confirmation screen
      // The product is now being created/synced in the background on the backend
      setIsPublishing(false);
      capture(AnalyticsEvents.PUBLISH_COMPLETED, {
        origin: 'generate',
        product_id: navigationParams?.productId,
        variant_id: navigationParams?.variantId,
        platforms: navigationParams?.platforms || [],
      });
      navigation.navigate('PublishConfirmation', {
        ...navigationParams,
        isPublishing: false, // Publish completed successfully
      } as any);

    } catch (err) {
      console.error('Error in confirmAndPublish:', err);
      setIsPublishing(false);
      if (facebookRequested) {
        setFacebookSyncMeta({
          status: 'error',
          lastSyncAt: facebookSyncMeta.lastSyncAt,
          lastError: (err as any)?.message || 'Facebook publish failed',
        });
      }
      alert('Failed to publish. Please try again.');
    }
  };

  const pollRegenerateUntilDone = async (regenJobId: string, token?: string) => {
    const baseUrl = API_BASE_URL;
    if (!baseUrl) return null;
    for (let i = 0; i < 40; i++) {
      try {
        const auth = token || await ensureSupabaseJwt();
        const r = await fetch(`${baseUrl}/api/products/regenerate/status/${regenJobId}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : undefined });
        const s = await r.json();
        if (s?.status === 'completed') {
          const rr = await fetch(`${baseUrl}/api/products/regenerate/results/${regenJobId}`, { headers: auth ? { Authorization: `Bearer ${auth}` } : undefined });
          if (rr.ok) return await rr.json();
          return null;
        }
        if (s?.status === 'failed' || s?.status === 'cancelled') return null;
      } catch (e) { console.log('Poll check failed, retrying...', e); }
      // Backoff: start at 3s, increase slightly
      const delay = 3000 + (i * 500);
      await new Promise(res => setTimeout(res, delay));
    }
    return null;
  };

  const generatePlatform = async (platformKey: string) => {
    try {
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      if (!baseUrl || !productId || !variantId || !token) return;

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
        console.log(`[GEN-DETAILS] Started regeneration for ${platformKey}, jobId: ${regenJobId}`);
        activeRegenJobsRef.current[regenJobId] = platformKey;
        // We return here and let the socket listener handle the rest!
      } else {
        setGeneratingPlatformKeys(prev => {
          const next = new Set(prev);
          next.delete(platformKey);
          return next;
        });
      }

    } catch (error) {
      console.error('Platform generation failed:', error);
      setGeneratingPlatformKeys(prev => {
        const next = new Set(prev);
        next.delete(platformKey);
        return next;
      });
      throw error;
    }
  };

  const suggestVariants = async (platformKey: string) => {
    try {
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      if (!baseUrl || !productId || !variantId || !token) return;
      const payload = buildPlatformPayload();
      const submit = await fetch(`${baseUrl}/api/products/regenerate/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generateJobId: jobId,
          products: [{
            productIndex: currentProductIndex,
            productId,
            variantId,
            regenerateType: 'specific_fields',
            targetPlatform: platformKey,
            targetFields: ['variants'],
            userQuery: 'Suggest variants from images and description. Return optionsSuggestions as {name, values} and variantExamples.',
            customPrompt: 'Suggest variants from images and description. Return optionsSuggestions as {name, values} and variantExamples.',
            imageUrls: payload.media.imageUris,
          }],
          options: { useExistingScrapedData: true }
        })
      });
      if (!submit.ok) throw new Error('variant suggest submit failed');
      const submitJson = await submit.json();
      const regenJobId = submitJson?.jobId;
      const resultPayload = await pollRegenerateUntilDone(regenJobId, token || undefined);
      const resultArray = Array.isArray(resultPayload?.results) ? resultPayload.results : [];
      const matched = resultArray.find((r: any) => r.productIndex === currentProductIndex) || resultArray[0];
      const canonical = (matched?.platforms || {}).canonical;
      if (canonical?.optionsSuggestions) {
        updatePlatforms(prev => ({
          ...prev,
          [platformKey]: {
            ...(prev as any)[platformKey],
            __variantSuggestions: canonical.optionsSuggestions
          }
        }));
      }
    } catch (e) {
      console.error('Suggest variants failed:', e);
    }
  };

  const boostListing = async (platformKey: string, kind: 'boost' | 'advanced') => {
    try {
      const baseUrl = API_BASE_URL;
      const token = await ensureSupabaseJwt();
      const productId = (route.params as any)?.productId || effectiveResult?.productId;
      const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
      if (!baseUrl || !productId || !variantId || !token) return;
      const payload = buildPlatformPayload();
      const fieldGroups: Record<string, string[]> = {
        boost: ['tags', 'categorySuggestion', 'brand', 'seoTitle', 'seoDescription'],
        advanced: ['googleShopping', 'itemSpecifics', 'returnPolicy', 'shippingDetails']
      };
      const targetFields = fieldGroups[kind] || [];
      const userQuery = kind === 'boost'
        ? 'Boost listing for conversion and SEO. Add persuasive tags, category suggestions, brand if known, and SEO title/description.'
        : 'Fill advanced/other listing fields accurately from context. Keep optional fields helpful and consistent.';
      const submit = await fetch(`${baseUrl}/api/products/regenerate/submit`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generateJobId: jobId,
          products: [{
            productIndex: currentProductIndex,
            productId,
            variantId,
            regenerateType: 'specific_fields',
            targetPlatform: platformKey,
            targetFields,
            userQuery,
            customPrompt: userQuery,
            imageUrls: payload.media.imageUris,
          }],
          options: { useExistingScrapedData: true }
        })
      });
      if (!submit.ok) throw new Error('boost submit failed');
      const submitJson = await submit.json();
      const regenJobId = submitJson?.jobId;
      const resultPayload = await pollRegenerateUntilDone(regenJobId, token || undefined);
      const resultArray = Array.isArray(resultPayload?.results) ? resultPayload.results : [];
      const matched = resultArray.find((r: any) => r.productIndex === currentProductIndex) || resultArray[0];
      const incomingPlatform = (matched?.platforms || {})[platformKey] || {};
      const normalized = normalizeForListingEditor(incomingPlatform);
      updatePlatforms(prev =>
        hydratePlatformsFromBackend({ [platformKey]: normalized }, prev)
      );
    } catch (e) {
      console.error('Boost listing failed:', e);
    }
  };

  // ========== PHASE 2.6: Media Gallery Handlers ==========
  const handlePickImage = async () => {
    try {
      // Request permissions first (like AddProductScreen)
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'We need access to your photo library to upload images.');
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
            Alert.alert('User not authenticated');
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
            console.error('[Phase2 Media] Upload error:', error);
            Alert.alert('Failed to upload image to storage');
            return;
          }

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(fileName);

          const publicUrl = urlData.publicUrl;
          console.log('[Phase2 Media] Image uploaded:', publicUrl);

          // Add to media gallery
          setMediaGallery(prev => [...prev, publicUrl]);

        } catch (uploadError) {
          console.error('[Phase2 Media] Failed to upload image:', uploadError);
          Alert.alert('Failed to upload image');
        }
      }
    } catch (error) {
      console.error('[Phase2 Media] Error picking image:', error);
      Alert.alert('Failed to pick image');
    }
  };

  const handleRemoveMedia = (index: number) => {
    const removedUrl = mediaGallery[index];
    setMediaGallery(prev => prev.filter((_, i) => i !== index));
    console.log('[Phase2 Media] Image removed at index:', index, 'URL:', removedUrl);
  };

  const handleSetVariantPhoto = (imageUrl: string) => {
    if (!selectedVariantForMedia) {
      Alert.alert('No variant selected');
      return;
    }

    console.log('[Phase2 Media] Set variant', selectedVariantForMedia, 'photo to:', imageUrl);
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
      console.log('[GEN-DETAILS DraftLoad] Skipping - variantId:', !!variantId, 'hasPlatformData:', hasPlatformData);
      return;
    }

    let canceled = false;
    (async () => {
      try {
        const baseUrl = API_BASE_URL;
        const token = await ensureSupabaseJwt();

        if (!baseUrl || !token) {
          console.log('[GEN-DETAILS DraftLoad] Missing baseUrl or token, skipping');
          return;
        }

        console.log('[GEN-DETAILS DraftLoad] ⏳ Loading draft for variant:', variantId);
        const response = await fetch(`${baseUrl}/api/products/drafts/${variantId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.warn('[GEN-DETAILS DraftLoad] ❌ Failed to load draft:', response.status, errorText);
          return;
        }

        const draftResponse = await response.json();
        const currentDraft = draftResponse?.currentDraft;

        if (!currentDraft || !currentDraft.DraftData) {
          console.log('[GEN-DETAILS DraftLoad] No draft data found');
          return;
        }

        if (!canceled) {
          console.log('[GEN-DETAILS DraftLoad] ✅ Loaded draft:', currentDraft.DraftData);
          // Restore the draft data into platformsRef
          platformsRef.current = currentDraft.DraftData;
          lastSavedRef.current = JSON.stringify(currentDraft.DraftData);
          lastScheduledRef.current = null;
          forceUpdate({}); // Trigger re-render with restored data
        }
      } catch (error) {
        console.error('[GEN-DETAILS DraftLoad] ❌ Error loading draft:', error);
      }
    })();

    return () => { canceled = true };
  }, [(route.params as any)?.variantId, results]);


  const handleImagesChange = (newImages: string[]) => {
    console.log('[GEN-DETAILS] handleImagesChange:', newImages.length, newImages);
    if (!effectiveResult?.variantId) return;

    setDbImages(prev => ({
      ...prev,
      [effectiveResult.variantId!]: newImages
    }));

    // Also update the 'images' field in the canonical platform data so it saves correctly
    updatePlatforms(prev => {
      const canonicalKey = platformKeys.includes('shopify') ? 'shopify' : platformKeys[0];
      console.log('[GEN-DETAILS] handleImagesChange updating canonical:', canonicalKey);
      if (!canonicalKey) return prev;

      const updated = {
        ...prev,
        [canonicalKey]: {
          ...(prev[canonicalKey] || {}),
          images: newImages
        }
      };
      // console.log('[GEN-DETAILS] handleImagesChange RESULT:', JSON.stringify(updated[canonicalKey]?.images));
      return updated;
    });
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
            <ActivityIndicator size="large" color="#93C822" />
            <Text style={{ marginTop: 16, fontSize: 18, fontWeight: '600', color: '#111' }}>
              Publishing...
            </Text>
            <Text style={{ marginTop: 8, fontSize: 14, color: '#666', textAlign: 'center' }}>
              Your product is being published to your connected platforms
            </Text>
          </View>
        </View>
      )}
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: bottomSafePadding }]}>
        <ScrollView ref={mainScrollRef}>
          {effectiveResult ? (

            <>
              {/* Image Change Handler */}
              {(() => {
    
                return null;
              })()}



              {/* Editor form that matches the product page design */}
              <View onLayout={(e) => setListingEditorY(e.nativeEvent.layout.y)}>
                <ListingEditorForm
                  highlightedField={allMissingRequiredFields[missingFieldNavIndex]?.field}
                  highlightedPlatform={allMissingRequiredFields[missingFieldNavIndex]?.platform}
                  onScrollToOffset={(y) => {
                    mainScrollRef.current?.scrollTo({ y: Math.max(0, listingEditorY + y - 80), animated: true });
                  }}
                  platforms={displayedPlatforms}
                  updateCounter={updateCounter}
                  images={(userImagesByIndex[(effectiveResult?.productIndex as number) ?? 0] || []).filter((url: string) => typeof url === 'string' && url.trim().length > 0)}
                  onChangeImages={handleImagesChange}
                  platformLocations={platformLocations}
                  onChangePlatforms={(next) => {
                    console.log('[GEN-DETAILS] onChangePlatforms received - deep merge to preserve all data');
                    // DEEP merge: preserve all existing fields while updating changed ones
                    // This preserves user edits AND keeps all loaded backend data
                    updatePlatforms(prev => {
                      const merged = { ...prev };
                      for (const [platformKey, platformData] of Object.entries(next)) {
                        const prevPlatform = prev[platformKey] || {};

                        // Deep merge platform data
                        merged[platformKey] = {
                          ...prevPlatform,
                          ...platformData
                        };

                        // CRITICAL: Preserve variant inventoryByLocation when merging variants array
                        if (Array.isArray(platformData?.variants) && Array.isArray(prevPlatform.variants)) {
                          merged[platformKey].variants = platformData.variants.map((newVariant: any) => {
                            const prevVariant = prevPlatform.variants?.find((v: any) => v.id === newVariant.id);
                            if (prevVariant?.inventoryByLocation) {
                              return {
                                ...newVariant,
                                inventoryByLocation: {
                                  ...prevVariant.inventoryByLocation,
                                  ...(newVariant.inventoryByLocation || {})
                                }
                              };
                            }
                            return newVariant;
                          });
                        }
                      }
                      console.log('[GEN-DETAILS] Deep merged platforms, keys:', Object.keys(merged));
                      return merged;
                    });
                  }}
                  onOpenFieldPanel={handleOpenFieldPanel}
                  onRegenerateField={ENABLE_AI_REFILL_FEATURES ? regenerateField : undefined}
                  onOpenBarcodeScanner={(onResult) => {
                    openScanner(onResult);
                  }}
                  onOpenImageCapture={async (onResult) => {
                    try {
                      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                      if (status !== 'granted') {
                        Alert.alert('Permission Required', 'Please grant photo library access to add images.');
                        return;
                      }
                      const result = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ImagePicker.MediaTypeOptions.Images,
                        allowsMultipleSelection: true,
                        quality: 0.8,
                      });
                      if (!result.canceled && result.assets) {
                        // Upload the selected images to Supabase
                        const uploadedUrls = await uploadLocalImagesToSupabase(
                          result.assets.map(asset => asset.uri)
                        );
                        if (uploadedUrls.length > 0) {
                          onResult(uploadedUrls);
                        }
                      }
                    } catch (error) {
                      console.error('Error picking images:', error);
                      Alert.alert('Error', 'Failed to pick images. Please try again.');
                    }
                  }}
                  onAddMissingField={(platformKey: string) => {
                    setSelectedMissingPlatform(platformKey);
                    setFieldSearchQuery('');
                    setMissingFieldsModalOpen(true);
                  }}
                  getMissingFieldsCount={(platformKey: string) => getMissingFields(platformKey).length}
                  onGeneratePlatform={generatePlatform}
                  generatingPlatformKeys={generatingPlatformKeys}
                  enableAIRefill={ENABLE_AI_REFILL_FEATURES}
                  onSuggestVariants={suggestVariants}
                  onBoostListing={boostListing}
                  isGenerationMode={true}
                />
              </View>
            </>
          ) : (
            <Text style={styles.meta}>No results</Text>
          )}
        </ScrollView>



      </ScrollView>

      {/* ── Floating glass header (chat-style): back · item pill · switcher ── */}
      <View style={[styles.glassHeader, { paddingTop: insets.top + 6 }]}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <ProgressiveBlurView intensity={Platform.OS === 'ios' ? 50 : 28} tint="light" direction="down" />
          <LinearGradient
            colors={['#FFFFFF', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0)']}
            locations={[0, 0.55, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={styles.glassHeaderRow}>
          {/* Layout slot — the real back control is the SwipeBackWheel overlay below. */}
          <View style={styles.navCircle} />

          <TouchableOpacity
            style={styles.titlePill}
            activeOpacity={items.length > 1 ? 0.85 : 1}
            onPress={() => { if (items.length > 1) setItemMenuOpen(open => !open); }}
          >
            <Text style={styles.pillTitle} numberOfLines={1}>{currentItemTitle}</Text>
            <Text style={styles.pillSub} numberOfLines={1}>
              {items.length > 1 ? `Item ${currentItemPosition} of ${items.length} · ` : ''}
              {itemStatusForIndex(currentProductIndex).label}
            </Text>
          </TouchableOpacity>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {items.length > 1 ? (
              <TouchableOpacity style={styles.itemsPill} onPress={() => setItemMenuOpen(open => !open)} activeOpacity={0.85}>
                <Boxes size={16} color={CHAT_COLORS.ink} />
                <Text style={styles.itemsPillText}>{currentItemPosition}/{items.length}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.navCircle} onPress={() => setVersionsSheetOpen(true)} activeOpacity={0.85}>
              <History size={18} color={CHAT_COLORS.ink} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Pull-to-go-back wheel (overlays the header back slot + left-edge gesture). */}
      <SwipeBackWheel onBack={() => navigation.goBack()} top={insets.top + 6} left={14} tint="light" />

      {/* ── Item switcher dropdown (chat-style; replaces the bulk ItemJobsModal) ── */}
      {itemMenuOpen ? (
        <View style={[StyleSheet.absoluteFill, { zIndex: 5500 }]} pointerEvents="box-none">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setItemMenuOpen(false)} />
          <View style={[styles.itemDropdown, { top: insets.top + 58 }]}>
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
        <View style={{
          backgroundColor: 'transparent',
          width: '100%',
          zIndex: 100,
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

          <View style={{ paddingTop: 20, paddingBottom: 24, paddingHorizontal: isInputExpanded ? 0 : 16 }}>
            <SmartCommandInput
              mode="quick_fix"
              disableKeyboardHandling={true}
              fullWidth={false}
              onExpand={() => setIsInputExpanded(true)}
              onCollapse={() => setIsInputExpanded(false)}
              isLoading={quickFixLoading}
              apiBaseUrl={API_BASE_URL}
              getAuthToken={ensureSupabaseJwt}
              availableFields={(() => {
                const fields: FieldOption[] = [];
                platformKeys.forEach(pk => {
                  ['title', 'description', 'tags', 'price', 'categorySuggestion', 'brand', 'condition'].forEach(f => {
                    const label = platformKeys.length > 1 ? `${f.charAt(0).toUpperCase() + f.slice(1)} (${pk})` : f.charAt(0).toUpperCase() + f.slice(1);
                    fields.push({ key: `${pk}.${f}`, label, platform: pk });
                  });
                });
                return fields;
              })()}
              onSubmit={async (text, mentionedFields) => {
                try {
                  setQuickFixLoading(true);
                  const baseUrl = API_BASE_URL;
                  const token = await ensureSupabaseJwt();
                  const productId = (route.params as any)?.productId || effectiveResult?.productId;
                  const variantId = (route.params as any)?.variantId || effectiveResult?.variantId;
                  if (!baseUrl || !productId || !token) return;

                  // Determine target platform from mentions or default to first
                  const targetPlatform = mentionedFields.length > 0
                    ? mentionedFields[0].split('.')[0]
                    : platformKeys[0];

                  const targetFields = mentionedFields.map(f => f.split('.').slice(1).join('.'));

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
                        targetFields: targetFields.length > 0 ? targetFields : undefined,
                        userQuery: text,
                        currentProductData: displayedPlatforms,
                      }],
                    }),
                  });

                  if (!res.ok) throw new Error('Quick fix failed');
                  const data = await res.json();

                  // Apply fixes to displayed platforms
                  if (data?.results?.[0]?.fixes) {
                    const fixes = data.results[0].fixes;
                    const changedFields = data.results[0].changedFields || [];

                    updatePlatforms(prev => {
                      const updated = { ...prev };
                      for (const [platform, fieldChanges] of Object.entries(fixes as Record<string, any>)) {
                        updated[platform] = {
                          ...(updated[platform] || {}),
                          ...fieldChanges,
                          __refilled: Array.from(new Set([
                            ...((updated[platform] as any)?.__refilled || []),
                            ...Object.keys(fieldChanges as Record<string, any>),
                          ])),
                        };
                      }
                      return updated;
                    });

                    console.log('[QuickFix] Applied fixes to fields:', changedFields);
                  }
                } catch (e) {
                  console.error('[QuickFix] Error:', e);
                  Alert.alert('Fix failed', 'Could not apply the AI fix. Please try again.');
                } finally {
                  setQuickFixLoading(false);
                }
              }}
            />

            <KeyboardAwareBottomActionBar
              visible={!isInputExpanded}
              style={{
                position: 'relative',
                bottom: 0,
                left: 0,
                right: 0,
                paddingHorizontal: 0,
                marginBottom: 0,
              }}
              primaryLabel={
                canPublish
                  ? (hasMultipleResults ? `Publish item ${currentProductIndex + 1} to ${readyPlatforms.length} platform${readyPlatforms.length === 1 ? '' : 's'}` : `Publish to ${readyPlatforms.length} platform${readyPlatforms.length === 1 ? '' : 's'}`)
                  : 'Publish listing'
              }
              primaryDisabled={!canPublish}
              onPrimary={doPublish}
              stepNav={!canPublish && allMissingRequiredFields.length > 0 ? {
                currentLabel: allMissingRequiredFields[missingFieldNavIndex % allMissingRequiredFields.length]?.label || 'Field',
                currentIndex: (missingFieldNavIndex % allMissingRequiredFields.length) + 1,
                totalCount: allMissingRequiredFields.length,
                onPrev: () => {
                  setMissingFieldNavIndex(i => {
                    const next = i <= 0 ? allMissingRequiredFields.length - 1 : i - 1;
                    // Auto-scroll after index changes by scheduling after re-render
                    setTimeout(() => {
                      mainScrollRef.current?.scrollTo({
                        y: Math.max(0, listingEditorY - 40),
                        animated: true,
                      });
                    }, 350);
                    return next;
                  });
                },
                onNext: () => {
                  setMissingFieldNavIndex(i => {
                    const next = (i + 1) % allMissingRequiredFields.length;
                    setTimeout(() => {
                      mainScrollRef.current?.scrollTo({
                        y: Math.max(0, listingEditorY - 40),
                        animated: true,
                      });
                    }, 350);
                    return next;
                  });
                },
                onTapField: () => {
                  // Scroll to the listing editor area — the highlightedField prop handles field-level scroll
                  mainScrollRef.current?.scrollTo({
                    y: Math.max(0, listingEditorY - 40),
                    animated: true,
                  });
                },
              } : undefined}
              secondaryLabel={'Save to Inventory'}
              onSecondary={doSaveToInventory}
              tertiaryContent={hasMultipleResults ? (
                <Text style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', marginTop: 4 }}>Tap the item pill up top to switch items, then Publish each</Text>
              ) : <View style={{ height: 10 }} />}
            />
          </View>
        </View>
      </KeyboardAvoidingView>


      {!!lastFillCount && ENABLE_AI_REFILL_FEATURES && (
        <View style={{ position: 'absolute', bottom: 96, left: 16, right: 16, backgroundColor: 'rgba(17,17,17,0.92)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>Filled {lastFillCount} field{lastFillCount === 1 ? '' : 's'}</Text>
        </View>
      )}
      {fillOverlayOpen && ENABLE_AI_REFILL_FEATURES && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 6000 }} pointerEvents="box-none">
          <TouchableOpacity activeOpacity={1} onPress={() => setFillOverlayOpen(false)} style={{ height: 8 }} />
          <View style={{ backgroundColor: '#fff', borderBottomLeftRadius: 14, borderBottomRightRadius: 14, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#E5E5E5' }}>
            <Text style={{ color: '#000', fontWeight: '700', marginBottom: 8 }}>Choose fields to fill</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {['title', 'description', 'tags', 'price', 'sku', 'barcode', 'seoTitle', 'seoDescription', 'options'].map((f) => {
                const selected = fillSelectedFields.includes(f);
                return (
                  <TouchableOpacity key={f} onPress={() => setFillSelectedFields(prev => selected ? prev.filter(x => x !== f) : [...prev, f])} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: selected ? '#93C822' : '#E5E5E5', backgroundColor: selected ? 'rgba(147,200,34,0.08)' : '#fff', marginRight: 8, marginBottom: 8 }}>
                    <Text style={{ color: '#000' }}>{f}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, marginBottom: 4, alignItems: "center" }}>
              <TouchableOpacity onPress={() => setFillOverlayOpen(false)} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 }}>
                <Text style={{ color: '#000' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setFillOverlayOpen(false); fillTheRest(); }} style={{ backgroundColor: '#93C822', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Sparkles size={16} color={'#111'} />
                <Text style={{ color: '#000', fontWeight: '700' }}>Fill selected</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
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
      {versionsSheetOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setVersionsSheetOpen(false)}
            style={styles.versionsBackdrop}
          />
          <View style={styles.versionsSheet}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => setVersionsTab('versions')} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: versionsTab === 'versions' ? '#93C822' : '#E5E5E5', backgroundColor: versionsTab === 'versions' ? 'rgba(147,200,34,0.08)' : '#fff' }}>
                  <Text style={{ color: '#000', fontWeight: '600' }}>Versions</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setVersionsTab('sources')} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: versionsTab === 'sources' ? '#93C822' : '#E5E5E5', backgroundColor: versionsTab === 'sources' ? 'rgba(147,200,34,0.08)' : '#fff' }}>
                  <Text style={{ color: '#000', fontWeight: '600' }}>Sources</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity onPress={() => setVersionsSheetOpen(false)} accessibilityLabel="Close versions panel" style={{ padding: 6 }}>
                  <X size={20} color={'#000'} />
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView style={{ marginTop: 12 }}>
              {versionsTab === 'versions' ? (
                versions.length === 0 ? (
                  <Text style={{ color: '#666' }}>No versions recorded yet.</Text>
                ) : versions.map((v, index) => {
                  const isCurrentVersion = v.jobId === jobId;
                  const platformCount = Object.keys(v.platforms || {}).length;
                  const hasMultipleVersions = (v.versionCount || 1) > 1;

                  return (
                    <View key={v.id} style={{ marginBottom: 8 }}>
                      {/* Main version card */}
                      <TouchableOpacity
                        onPress={() => {
                          // Normalize and hydrate the version data
                          const normalized: Record<string, any> = {};
                          for (const [key, value] of Object.entries(v.platforms || {})) {
                            normalized[key] = normalizeForListingEditor(value);
                          }
                          updatePlatforms(prev => hydratePlatformsFromBackend(normalized, prev));
                          setVersionsSheetOpen(false);
                        }}
                        style={[
                          {
                            borderWidth: 1,
                            borderColor: isCurrentVersion ? '#93C822' : '#E5E5E5',
                            backgroundColor: isCurrentVersion ? 'rgba(147,200,34,0.05)' : '#fff',
                            borderRadius: 10,
                            padding: 12,
                          }
                        ]}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                          <Text style={{ color: '#000', fontWeight: '600', flex: 1 }}>
                            Match from {new Date(v.createdAt).toLocaleDateString()}
                            {isCurrentVersion && <Text style={{ color: '#93C822' }}> (Current)</Text>}
                            {hasMultipleVersions && (
                              <Text style={{ color: '#666', fontWeight: '400' }}> • {v.versionCount} versions</Text>
                            )}
                          </Text>
                          <Text style={{ color: '#666', fontSize: 12 }}>
                            {new Date(v.createdAt).toLocaleDateString()}
                          </Text>
                        </View>

                        <Text style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>
                          Latest: {new Date(v.createdAt).toLocaleTimeString()}
                        </Text>

                        {platformCount > 0 ? (
                          <Text style={{ color: '#000', fontSize: 13 }}>
                            {platformCount} platform{platformCount !== 1 ? 's' : ''}: {Object.keys(v.platforms || {}).map(k => PLATFORM_META[k]?.label || k).join(', ')}
                          </Text>
                        ) : (
                          <Text style={{ color: '#999', fontSize: 13, fontStyle: 'italic' }}>No platform data</Text>
                        )}

                        {v.matchJobId && (
                          <Text style={{ color: '#666', fontSize: 11, marginTop: 4 }}>
                            Match ID: {v.matchJobId.slice(0, 8)}...
                          </Text>
                        )}
                      </TouchableOpacity>

                      {/* Show all versions if multiple exist */}
                      {hasMultipleVersions && Array.isArray(v.allVersions) && (
                        <View style={{ marginTop: 8, marginLeft: 16 }}>
                          <Text style={{ color: '#666', fontSize: 12, marginBottom: 6 }}>All versions for this match:</Text>
                          {v.allVersions.map((version: any, versionIndex: number) => {
                            const isCurrentSubVersion = version.jobId === jobId;
                            const versionPlatformCount = Object.keys(version.platforms || {}).length;

                            return (
                              <TouchableOpacity
                                key={version.id}
                                onPress={() => {
                                  // Normalize and hydrate the version data
                                  const normalized: Record<string, any> = {};
                                  for (const [key, value] of Object.entries(version.platforms || {})) {
                                    normalized[key] = normalizeForListingEditor(value);
                                  }
                                  updatePlatforms(prev => hydratePlatformsFromBackend(normalized, prev));
                                  setVersionsSheetOpen(false);
                                }}
                                style={{
                                  borderWidth: 1,
                                  borderColor: isCurrentSubVersion ? '#93C822' : '#E5E5E5',
                                  backgroundColor: isCurrentSubVersion ? 'rgba(147,200,34,0.05)' : '#F8F9FA',
                                  borderRadius: 8,
                                  padding: 8,
                                  marginBottom: 4
                                }}
                              >
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Text style={{ color: '#000', fontSize: 13, fontWeight: '600' }}>
                                    Version {(v.allVersions?.length || 0) - versionIndex}
                                    {isCurrentSubVersion && <Text style={{ color: '#93C822' }}> (Current)</Text>}
                                  </Text>
                                  <Text style={{ color: '#666', fontSize: 11 }}>
                                    {new Date(version.createdAt).toLocaleTimeString()}
                                  </Text>
                                </View>

                                {versionPlatformCount > 0 && (
                                  <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
                                    {versionPlatformCount} platforms: {Object.keys(version.platforms || {}).map(k => PLATFORM_META[k]?.label || k).join(', ')}
                                  </Text>
                                )}

                                {version.source && (
                                  <Text style={{ color: '#666', fontSize: 10, marginTop: 2 }}>
                                    Source: {version.source}
                                  </Text>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                })
              ) : (
                <View>
                  {!selectedFieldKey ? (
                    <Text style={{ color: '#666' }}>Tap the info icon next to a field to view sources for that field.</Text>
                  ) : (
                    <>
                      <Text style={{ color: '#000', fontWeight: '700', marginBottom: 6 }}>Sources for "{selectedFieldKey}"</Text>
                      {(() => {
                        const rows: Array<{ url: string }> = [];
                        for (const v of versions) {
                          const src = (v.sources || []).filter(s => !s.usedForFields || s.usedForFields.includes(selectedFieldKey));
                          src.forEach(s => rows.push({ url: s.url }));
                        }
                        const unique = Array.from(new Set(rows.map(r => r.url)));
                        return unique.length === 0 ? (
                          <Text style={{ color: '#666' }}>No recorded field-level sources.</Text>
                        ) : unique.map(u => (
                          <View key={u} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                            <Text style={{ color: '#000' }}>{u}</Text>
                          </View>
                        ));
                      })()}
                    </>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </>
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
              Platform: {PLATFORM_META[selectedMissingPlatform]?.label || selectedMissingPlatform}
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
      {/* Regenerate modal */}
      {regenModalOpen && (
        <>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setRegenModalOpen(false)}
            style={styles.modalBackdrop}
          />
          <View style={[styles.missingFieldsModal, { left: 0, right: 0, borderRadius: 16, backgroundColor: "#FFF" }]}>

            {/* Modal Header */}
            <View style={{ flex: 1, flexDirection: 'row', alignContent: "center", alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <Pencil size={16} color={'#000'} />
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#000', alignItems: 'center', gap: 3 }}>
                  Editing This Field
                </Text>

              </View>


              <TouchableOpacity style={[styles.btnSecondary, { flexDirection: "row", backgroundColor: "#FFF", }]} onPress={() => setRegenModalOpen(false)}>
                <Icon name="arrow-left" size={18} color={'#000'} />
                <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Back</Text>
              </TouchableOpacity>



            </View>


            {/* Current Field Card */}
            <View style={{ flexDirection: "column", borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: "#FFF", borderRadius: 10, marginBottom: 20, gap: 8, boxShadow: "offsetX: 3, color: black, " }}>

              <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-around", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5 }}>

                <Text style={{ flex: 1, justifyContent: "flex-start", color: '#71717A' }}>
                  <Text style={{ color: '#000', fontWeight: '600', textTransform: "capitalize" }}>{regenFieldKey} • {regenPlatformKey}</Text>
                </Text>


                {/* Version switcher with arrows */}
                <View style={{ flex: 1, justifyContent: "flex-end", flexDirection: 'row', alignItems: 'center', gap: 8, }}>
                  <TouchableOpacity onPress={() => setRegenActiveVersion(v => Math.max(0, v - 1))} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, padding: 6 }}>
                    <Icon name="chevron-left" size={18} color="#000" />
                  </TouchableOpacity>
                  <Text style={{ color: '#000', fontWeight: '600' }}>{regenVersions[regenActiveVersion]?.label || 'Version'}</Text>
                  <TouchableOpacity onPress={() => setRegenActiveVersion(v => Math.min(regenVersions.length - 1, v + 1))} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, backgroundColor: "#71717A", padding: 6 }}>
                    <Icon name="chevron-right" size={18} color="#FFF" />
                  </TouchableOpacity>
                </View>

              </View>


              {/* Original/current text area (read-only) */}
              <View style={{ flex: 1, marginHorizontal: 8, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, padding: 10, marginBottom: 10, backgroundColor: '#FAFAFA' }}>
                <Text style={{ color: '#000' }}>
                  {regenVersions[regenActiveVersion]?.text || ''}
                </Text>
              </View>


            </View>

            {/* Prompt presets - horizontal scroll at same width as input below */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }} contentContainerStyle={{ paddingRight: 6 }}>
              {['Fill missing', 'More casual', 'More corporate', 'More direct', 'Translate'].map(p => (
                <TouchableOpacity key={p} onPress={() => setRegenText(t => (t ? `${t} ${p}` : p))} style={{ marginRight: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', backgroundColor: "#FFF", }}>
                  <Text style={{ color: '#000' }}>{p}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, backgroundColor: "#FFF", }}>
              {/* Instruction input */}
              <TextInput
                style={[styles.input, { borderColor: "transparent", minHeight: 120, textAlignVertical: 'top' }]}
                value={regenText}
                onChangeText={setRegenText}
                placeholder="How do you want to edit this?"
                multiline
              />

              {/* Actions */}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 }}>
                <TouchableOpacity style={[styles.blackBtnPrimary, regenSubmitting && { opacity: 0.7, backgroundColor: "#000" }]} disabled={regenSubmitting} onPress={submitRegenerateField}>
                  <Text style={{ color: '#fff' }}>{regenSubmitting ? 'Generating…' : <Icon name="arrow-right" size={18} color={'#FFF'} />}</Text>
                </TouchableOpacity>
              </View>



            </View>

          </View>
        </>
      )}

      {/* Publish Confirmation Modal */}
      <PublishConfirmationModal
        visible={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        onConfirm={confirmAndPublish}
        readyPlatforms={readyPlatforms}
        allConnections={allConnections}
        selectedConnectionIds={selectedConnectionIds}
        setSelectedConnectionIds={setSelectedConnectionIds}
        productSummary={{
          title: buildPlatformPayload().platformDetails?.canonical?.title,
          sku: buildPlatformPayload().platformDetails?.canonical?.sku,
          price: buildPlatformPayload().platformDetails?.canonical?.price
        }}
        isPublishing={isPublishing}
      />
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

            {/* Media Gallery Display */}
            <ScrollView style={{ marginBottom: 16, maxHeight: 300 }}>
              {mediaGallery.filter((url): url is string => typeof url === 'string' && url.trim().length > 0).length === 0 ? (
                <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 32 }}>
                  <Icon name="image-off" size={48} color="#CCC" />
                  <Text style={{ color: '#666', marginTop: 12, fontSize: 14 }}>No images yet. Tap "Add Photos" to get started.</Text>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {mediaGallery.filter((url): url is string => typeof url === 'string' && url.trim().length > 0).map((imageUrl, index) => (
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
                style={{ flex: 1, paddingVertical: 12, backgroundColor: '#93C822', borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
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
  container: { flex: 1, backgroundColor: '#fff', paddingTop: "20%" },
  content: { padding: 16 },

  // Chat-style floating glass header + item switcher
  glassHeader: { ...GLASS_HEADER_STYLES.header },
  glassHeaderRow: { ...GLASS_HEADER_STYLES.headerRow },
  navCircle: { ...GLASS_HEADER_STYLES.navCircle },
  titlePill: { ...GLASS_HEADER_STYLES.titlePill },
  pillTitle: { ...GLASS_HEADER_STYLES.pillTitle },
  pillSub: { ...GLASS_HEADER_STYLES.pillSub },
  itemsPill: { ...GLASS_HEADER_STYLES.actionPill },
  itemsPillText: { ...GLASS_HEADER_STYLES.actionPillText },
  itemDropdown: { ...GLASS_HEADER_STYLES.dropdown, minWidth: 260, maxWidth: 330, paddingVertical: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 14, marginHorizontal: 6 },
  itemRowActive: { backgroundColor: CHAT_COLORS.brandSoft },
  itemRowTitle: { fontSize: 15, color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold },
  itemRowMeta: { fontSize: 12, fontFamily: CHAT_FONT.medium, marginTop: 2 },
  itemThumb: { width: 34, height: 34, borderRadius: 10, backgroundColor: CHAT_COLORS.bubble },
  itemDot: { width: 8, height: 8, borderRadius: 4 },
  heading: { color: '#000', fontSize: 24, fontWeight: '700', marginBottom: 6 },
  subheading: { color: '#000', fontSize: 18, fontWeight: '600', marginBottom: 4 },
  meta: { color: '#000', marginBottom: 4 },
  card: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, marginTop: 12 },
  section: { marginTop: 8 },
  platform: { color: '#000', fontWeight: '700', marginBottom: 4 },
  field: { color: '#000', marginBottom: 2 },
  versionsBackdrop: { position: 'absolute', top: 0, left: 0, bottom: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.2)' },
  versionsSheet: { position: 'absolute', top: 0, right: 0, bottom: 0, width: '70%', backgroundColor: '#fff', borderLeftColor: '#E5E5E5', borderLeftWidth: 1, paddingVertical: 70, paddingHorizontal: 20 },
  // Docked scanner close to the notch / bezel
  scannerDock: { position: 'absolute', top: 6, left: 56, right: 56, zIndex: 5000 },
  scannerCard: { backgroundColor: '#000', borderRadius: 18, borderWidth: 2, borderColor: '#111', overflow: 'hidden' },
  scannerClose: { position: 'absolute', top: 14, right: 6, backgroundColor: 'rgba(0,0,0,0.6)', width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
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
  btnPrimary: { backgroundColor: '#93C822', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  blackBtnPrimary: { backgroundColor: '#000', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },

  // Platform picker modal styles
  platformPickerModal: { position: 'absolute', top: '15%', left: 16, right: 16, backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '70%', zIndex: 6001 },
  platformPill: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, backgroundColor: '#fff' },
  generatePlatformPill: { borderColor: '#93C822', backgroundColor: 'rgba(147,200,34,0.05)' },
  addMissingFieldButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#71717A',
    marginTop: 16,
    gap: 8
  },
  addMissingFieldText: {
    color: '#71717A',
    fontSize: 14,
    fontWeight: '600'
  },
  addTagBtn: { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  tagChip: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  fieldLabel: { color: '#71717A', fontWeight: '600', marginBottom: 6, fontSize: 12, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 10, color: '#000' },
  sectionTitle: { color: '#000', fontWeight: '700' },
  subtle: { color: '#71717A', marginTop: 4 },
});

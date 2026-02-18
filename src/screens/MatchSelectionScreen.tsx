import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { RouteProp, useNavigation } from '@react-navigation/native';
import {
    View, Text, StyleSheet, Image, Dimensions, ActivityIndicator,
    Pressable, Modal, TouchableOpacity, SafeAreaView, ScrollView, TextInput, Alert
} from 'react-native';
import { AppStackParamList } from '../navigation/AppNavigator';
import { ENABLED_PLATFORM_OPTIONS } from '../config/platforms';
import { FlashList } from '@shopify/flash-list';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Boxes } from 'lucide-react-native';
import ItemJobsModal from '../components/ItemJobsModal';
import BottomNav from '../components/BottomNav';
import BackButton from '../components/BackButton';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { PackageCheck } from 'lucide-react';
import { LinearGradient } from 'expo-linear-gradient';
import { useJobsOptional } from '../context/JobsContext';

// --- 1. Define Comprehensive Types (from previous step) ---
interface Price {
    value: string;
    extracted_value: number;
    currency: string;
}

interface SerpApiData {
    position: number;
    title: string;
    link: string;
    source: string;
    source_icon: string;
    thumbnail?: string;
    image?: string;
    rating?: number;
    reviews?: number;
    price?: Price;
    condition?: string;
    in_stock?: boolean;
}

interface Result {
    productIndex: number;
    productId: string;
    variantId: string;
    serpApiData: SerpApiData[]; // Array of SerpAPI results
    rerankedResults: Array<{
        rank: number;
        score: number;
        serpApiIndex: number; // Index in original SerpAPI results
        title: string;
        link: string;
        imageUrl?: string;
        snippet?: string;
        embeddingId?: string; // Reference to stored embedding
    }>;
    confidence: 'high' | 'medium' | 'low';
    vectorSearchFoundResults: boolean;
    originalTargetImage: string;
    processingTimeMs: number;
    timing: {
        quickScanMs: number;
        serpApiMs: number;
        embeddingMs: number;
        vectorSearchMs: number;
        rerankingMs: number;
        totalMs: number;
    };
    error?: string;
}

export interface Analysis {
    jobId: string;
    results: Result[];
}

export interface JobResponse {
    jobId: string;
    status?: string;
    estimatedTimeMinutes?: number,
    totalProducts?: number,
    message?: string,
}

// Payload type for generate job submission
interface GenerateJobSubmitPayload {
    products: Array<{
        productIndex: number;
        productId?: string;
        variantId?: string;
        imageUrls: string[];
        coverImageIndex: number;
        selectedMatches?: SerpApiData[];
    }>;
    selectedPlatforms: string[];
    template?: string | null;
    options?: { useScraping?: boolean };
    platformRequests?: Array<{ platform: string; fieldSources?: Record<string, string[]>; customPrompt?: string }>;
    templateSources?: string[];
}

// Template builder types
type PlatformFieldRow = {
    id: string;
    platform: string; // 'shopify' | 'amazon' | 'ebay' | ...
    field: string; // e.g., title, description, price
    sources: string[]; // preferred domains in order
};

type TemplateDraft = {
    sources: string[]; // user-added sources/domains
    fieldRows: PlatformFieldRow[];
};

// --- Helper Functions & Constants ---
const SSSYNC_API_BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
const AI_SERVER_URL = process.env.EXPO_PUBLIC_AI_SERVER_URL;
const SSSYNC_API_BASE_URL_FE = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL;
const BASE_URL = SSSYNC_API_BASE_URL || 'https://api.sssync.app';
const CLIENT_RERANK_ENABLED = String(process.env.EXPO_PUBLIC_CLIENT_RERANK || 'false') === 'true';
const { width: screenWidth } = Dimensions.get('window');
const GRID_PADDING = 16;
const ITEM_SPACING = 12;
const COLUMNS = 3;
const ITEM_WIDTH = (screenWidth - GRID_PADDING * 2 - ITEM_SPACING * (COLUMNS - 1)) / COLUMNS;

async function getToken() {
    const jwt = await ensureSupabaseJwt();
    return jwt;
}

function sanitizeSourceLabel(item: { source?: string; link?: string }) {
    const raw = (item?.source || '').trim();
    if (raw && !/sssync/i.test(raw)) return raw;
    try {
        const host = item?.link ? new URL(item.link).hostname.replace('www.', '') : '';
        if (!host || /sssync\.app/i.test(host)) return 'web';
        return host;
    } catch {
        return raw && !/sssync/i.test(raw) ? raw : 'web';
    }
}

// --- Reusable Components ---

// Optimized ProductGridItem with instant feedback
const ProductGridItem = React.memo(({ item, index, isSelected, onSelect, isBest, isAutoMatched }: {
    item: SerpApiData,
    index: number,
    isSelected: boolean,
    onSelect: (index: number) => void,
    isBest?: boolean,
    isAutoMatched?: boolean,
}) => {
    const handlePress = useCallback(() => {
        onSelect(index);
    }, [index, onSelect]);

    const badgeLabel = isAutoMatched ? 'Auto matched' : (isBest ? 'BEST' : null);

    return (
        <Pressable
            onPress={handlePress}
            style={({ pressed }) => [
                styles.itemContainer,
                isSelected && styles.itemSelected,
                pressed && styles.itemPressed
            ]}
        >
            <Image
                source={{ uri: item.thumbnail || item.image }}
                style={styles.itemImage}
                resizeMode="contain"
            />
            {badgeLabel ? (
                <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: 'rgba(147,200,34,0.95)', borderRadius: 10, paddingVertical: 2, paddingHorizontal: 6 }}>
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{badgeLabel}</Text>
                </View>
            ) : null}
            {isSelected && (
                <View style={styles.selectionOverlay}>
                    <Icon name="check-circle" size={54} color="#FFFFFF" />
                </View>
            )}
            <View style={styles.itemDetails}>
                <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                <Text style={styles.itemPrice}>{item.price?.value}</Text>
                <Text style={styles.itemCondition}>{item.condition}</Text>
                <Text style={styles.itemSource}>{sanitizeSourceLabel(item)}</Text>
            </View>
        </Pressable>
    );
});


// --- Main Screen Component ---

function MatchSelectionScreen({ route }: { route: RouteProp<AppStackParamList, 'MatchSelectionScreen'> }) {
    const navigation = useNavigation<any>();
    // Accept jobId from response or directly, and optional focusIndex/items/jobMap
    const jobId: string | undefined = (route.params as any)?.response?.jobId || (route.params as any)?.jobId;
    const initialFocusIndex: number | undefined = (route.params as any)?.focusIndex;
    const initialItems: Array<{ index: number; title?: string; thumb?: string; matchesCount?: number }> = (route.params as any)?.items || [];
    const initialJobMap: Record<number, { jobId: string; status?: string }> = (route.params as any)?.jobMap || {};
    const { isConnected } = usePlatformConnections();
    const isNewScan = Boolean((route.params as any)?.isNewScan === true);

    const overrideResults: Array<{ productIndex: number; serpApiData: any[] }> | undefined = (route.params as any)?.overrideResults;
    const preSelectedIndices: number[] = (route.params as any)?.preSelectedIndices || [];
    const preSelectedByProductIndex: Record<number, number[]> = (route.params as any)?.preSelectedByProductIndex ?? {};

    // Get shared JobsContext for cross-screen state sync
    const jobsContext = useJobsOptional();

    // --- State Management ---
    const [analysisData, setAnalysisData] = useState<Analysis | null>(null);
    const [jobStatus, setJobStatus] = useState<'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'unknown'>('unknown');
    const [currentProductIndex, setCurrentProductIndex] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // State for the new UI flow - per-item match selection (fixes batch generate)
    const [selectedMatchesByIndex, setSelectedMatchesByIndex] = useState<Record<number, number[]>>({});
    const selectedIndices = selectedMatchesByIndex[currentProductIndex] ?? [];
    const [
        selectedProducts,
        setSelectedProducts
    ] = useState<SerpApiData[]>([]);
    const [bottomNavState, setBottomNavState] = useState<'empty' | 'selection' | 'template' | 'platform'>('empty');
    const [isTemplateModalVisible, setTemplateModalVisible] = useState(false);
    const [templateModalView, setTemplateModalView] = useState<'picker' | 'create'>('picker');
    const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
    const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

    // Template builder state
    const [templateDraft, setTemplateDraft] = useState<TemplateDraft>({ sources: [], fieldRows: [] });
    const [userTemplates, setUserTemplates] = useState<any[]>([]);
    const [templateOffset, setTemplateOffset] = useState(0);
    const pageSize = 20;
    const [hasMoreTemplates, setHasMoreTemplates] = useState(true);
    const [isLoadingMoreTemplates, setIsLoadingMoreTemplates] = useState(false);
    const [sourceInput, setSourceInput] = useState('');
    const [templateName, setTemplateName] = useState('');
    const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [openDropdown, setOpenDropdown] = useState<{ rowId: string | null; type: 'platform' | 'field' | null }>({ rowId: null, type: null });
    const [dropdownSearchQuery, setDropdownSearchQuery] = useState('');
    const [manageMode, setManageMode] = useState(false);
    const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
    const [hiddenDefaults, setHiddenDefaults] = useState<Set<string>>(new Set());
    const [unfavoritedDefaults, setUnfavoritedDefaults] = useState<Set<string>>(new Set());
    const [genResponse, setGenResponse] = useState<JobResponse | null>(null);
    // Global jobs modal
    const [jobsModalVisible, setJobsModalVisible] = useState(false);
    // Start empty; we only fill from params.jobMap when it's for THIS match job (see effect below)
    const [itemGenerateJobs, setItemGenerateJobs] = useState<Record<number, { jobId: string; status?: string }>>({});
    const [externalItems, setExternalItems] = useState<Array<{ index: number; title?: string; thumb?: string; matchesCount?: number }>>(initialItems || []);
    const [userImagesByIndex, setUserImagesByIndex] = useState<Record<number, string[]>>(() => {
        const fromParams = (route.params as any)?.userImagesByIndex;
        return (fromParams && typeof fromParams === 'object') ? fromParams : {};
    });

    // Track failed items from server for retry/rescan buttons
    const [failedItems, setFailedItems] = useState<Array<{ index: number; error: string }>>([]);
    const [manualSafetyInput, setManualSafetyInput] = useState('');

    // Memoized items for ItemJobsModal - avoids recalculating on every render
    // IMPORTANT: Must be declared BEFORE useEffects that reference it
    const modalItems = useMemo(() => {
        const built = (analysisData?.results || []).map((res, idx) => {
            const first = res?.serpApiData?.[0];
            return {
                index: idx,
                title: first?.title || `Item ${idx + 1}`,
                thumb: first?.image || first?.thumbnail || '',
                matchesCount: res?.serpApiData?.length || 0,
            };
        });
        if (built.length > 0) return built;
        // Fallback to external items passed from other screens
        return (externalItems || []).map((it, i) => ({
            index: it.index ?? i,
            title: it.title || `Item ${i + 1}`,
            thumb: it.thumb || '',
            matchesCount: it.matchesCount || 0,
        }));
    }, [analysisData?.results, externalItems]);

    // Track if we're currently syncing to prevent circular updates
    const isSyncingRef = React.useRef(false);
    const hasInitializedFromContextRef = React.useRef(false);
    // Track last jobId we initialized so we don't re-call when context reference changes (avoids infinite loop)
    const lastInitializedJobIdRef = React.useRef<string | null>(null);
    // Ref to read latest jobsContext without putting it in effect deps (context value is new ref every render)
    const jobsContextRef = React.useRef(jobsContext);
    jobsContextRef.current = jobsContext;
    // Track last feedback sent to prevent duplicate requests
    const lastFeedbackKeyRef = React.useRef<string>('');
    // Track per-item whether we've already auto-selected (so each item can get auto-match when switching)
    const hasAutoSelectedByIndexRef = React.useRef<Set<number>>(new Set());
    // Track if we've run auto-match-all for this job (one-time per jobId)
    const hasAutoMatchedAllRef = React.useRef<string | null>(null);
    // Track when current selection was auto-matched (for "Auto matched" badge)
    const [wasAutoMatched, setWasAutoMatched] = useState(false);
    // Polling timer ref so we can clear it on completed/failed and in cleanup (stop hitting backend)
    const pollingTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Sync with JobsContext - initialize from context if available (ONE TIME per jobId)
    // Deps: only jobId and modalItems so we don't re-run on every context update (which would cause infinite loop)
    useEffect(() => {
        const ctx = jobsContextRef.current;
        if (!ctx || !jobId) return;
        if (isSyncingRef.current) return;

        // When switching to a different match job, allow merging from context again for that job
        if (lastInitializedJobIdRef.current !== null && lastInitializedJobIdRef.current !== jobId) {
            hasInitializedFromContextRef.current = false;
        }

        // Initialize context with this match job's items when modalItems are ready (once per jobId)
        if (modalItems.length > 0 && ctx.matchJobId !== jobId && lastInitializedJobIdRef.current !== jobId) {
            lastInitializedJobIdRef.current = jobId;
            isSyncingRef.current = true;
            ctx.initializeFromMatchJob(jobId, modalItems.map((item) => ({
                index: item.index,
                title: item.title,
                thumb: item.thumb,
                matchesCount: item.matchesCount,
                matchJobId: jobId,
            })));
            setTimeout(() => { isSyncingRef.current = false; }, 0);
        }

        // Only merge context → local when context belongs to THIS match job (avoid wrong-job on match stage)
        if (!hasInitializedFromContextRef.current && ctx.matchJobId === jobId && Object.keys(ctx.generateJobs).length > 0) {
            hasInitializedFromContextRef.current = true;
            setItemGenerateJobs(prev => {
                const merged = { ...prev };
                let hasChanges = false;
                Object.entries(ctx.generateJobs).forEach(([indexStr, genJob]) => {
                    const idx = parseInt(indexStr, 10);
                    if (!merged[idx] || (genJob.status === 'completed' && merged[idx].status !== 'completed')) {
                        merged[idx] = { jobId: genJob.jobId, status: genJob.status };
                        hasChanges = true;
                    }
                });
                return hasChanges ? merged : prev;
            });
        }
    }, [jobId, modalItems]);

    // Apply params.jobMap only when it's for THIS match job (e.g. coming back from GenerateDetailsScreen)
    // Avoids showing "Generated" / wrong job when params carried stale jobMap from another flow
    const appliedJobMapForJobIdRef = React.useRef<string | null>(null);
    useEffect(() => {
        const currentMatchJobId = analysisData?.jobId;
        const paramsJobId = (route.params as any)?.response?.jobId ?? (route.params as any)?.jobId;
        const paramsJobMap = (route.params as any)?.jobMap as Record<number, { jobId: string; status?: string }> | undefined;
        if (!currentMatchJobId || currentMatchJobId !== paramsJobId || !paramsJobMap || Object.keys(paramsJobMap).length === 0) return;
        if (appliedJobMapForJobIdRef.current === currentMatchJobId) return;
        appliedJobMapForJobIdRef.current = currentMatchJobId;
        setItemGenerateJobs(prev => ({ ...paramsJobMap, ...prev }));
    }, [analysisData?.jobId, route.params]);

    // Sync local itemGenerateJobs changes to context - only for NEW jobs we create locally
    // Deps: only itemGenerateJobs so we don't re-run on every context update (avoids infinite loop)
    useEffect(() => {
        const ctx = jobsContextRef.current;
        if (!ctx) return;
        if (isSyncingRef.current) return;

        Object.entries(itemGenerateJobs).forEach(([indexStr, job]) => {
            const idx = parseInt(indexStr, 10);
            const contextJob = ctx.generateJobs[idx];
            if (!contextJob && job.jobId) {
                isSyncingRef.current = true;
                ctx.startGenerateJob(idx, job.jobId);
                setTimeout(() => { isSyncingRef.current = false; }, 0);
            }
        });
    }, [itemGenerateJobs]);

    const FIELD_OPTIONS = [
        { key: 'title', label: 'Title' },
        { key: 'description', label: 'Description' },
        { key: 'price', label: 'Price' },
        { key: 'tags', label: 'Tags' },
        { key: 'brand', label: 'Brand' },
        { key: 'condition', label: 'Condition' },
    ];

    // Generated naming helpers for templates
    const humanizeDomain = (domain: string): string => {
        const d = (domain || '').toLowerCase();
        const first = d.split('.')[0] || '';
        if (first === 'www') return (d.split('.')[1] || 'Site').replace(/\b\w/g, c => c.toUpperCase());
        return first.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };

    const generateNameFromSources = (sources: string[]): string => {
        if (!Array.isArray(sources) || sources.length === 0) return 'Custom Template';
        const names = sources.slice(0, 2).map(humanizeDomain);
        const remaining = Math.max(0, sources.length - names.length);
        if (remaining > 0) return `${names.join(' + ')} + ${remaining} more...`;
        return names.join(' + ');
    };

    const effectiveName = useCallback((tpl: any) => {
        const name = tpl?.Name || tpl?.name;
        if (name && String(name).trim().length > 0) return String(name).trim();
        return generateNameFromSources(tpl?.SuggestedSites || tpl?.suggestedSites || []);
    }, []);

    const favorites = useMemo(() => {
        return userTemplates
            .filter(t => t.isFavorite === true)
            .sort((a, b) => effectiveName(a).localeCompare(effectiveName(b)));
    }, [userTemplates, effectiveName]);

    const recents = useMemo(() => {
        return userTemplates
            .filter(t => !t.isFavorite)
            .sort((a, b) => getUpdatedAt(b) - getUpdatedAt(a));
    }, [userTemplates]);

    const getTplId = (tpl: any): string => tpl?.Id || tpl?.id;
    function getUpdatedAt(tpl: any): number {
        return new Date(tpl?.UpdatedAt || tpl?.updated_at || 0).getTime();
    }

    const toggleManageMode = useCallback(() => {
        setManageMode(prev => !prev);
        setSelectedTemplateIds(new Set());
    }, []);

    const toggleSelectTemplate = useCallback((tplId: string) => {
        setSelectedTemplateIds(prev => {
            const next = new Set(prev);
            if (next.has(tplId)) next.delete(tplId); else next.add(tplId);
            return next;
        });
    }, []);

    const bulkDeleteSelected = useCallback(async () => {
        if (selectedTemplateIds.size === 0) return;
        try {
            Alert.alert('Delete Templates', `Delete ${selectedTemplateIds.size} selected template(s)?`, [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete', style: 'destructive', onPress: async () => {
                        // Split defaults vs real ids
                        const defaultIds = Array.from(selectedTemplateIds).filter(id => id.startsWith('default-'));
                        const realIds = Array.from(selectedTemplateIds).filter(id => !id.startsWith('default-'));
                        if (realIds.length > 0) {
                            await supabase.from('SearchTemplates').delete().in('Id', realIds);
                        }
                        if (defaultIds.length > 0) {
                            setHiddenDefaults(prev => new Set([...Array.from(prev), ...defaultIds]));
                        }
                        setUserTemplates(prev => prev.filter(t => !selectedTemplateIds.has(getTplId(t))));
                        setSelectedTemplateIds(new Set());
                    }
                },
            ]);
        } catch { }
    }, [selectedTemplateIds]);

    // --- Data Fetching ---
    // Ref to prevent infinite loop: route.params (overrideResults, preSelectedByProductIndex) can get
    // new object refs each render, causing useEffect to re-run. We only need to process override once.
    const hasProcessedOverrideRef = React.useRef(false);

    useEffect(() => {
        navigation.setOptions({ headerShown: false });

        let cancelled = false;

        if (overrideResults && Array.isArray(overrideResults) && overrideResults.length > 0) {
            if (hasProcessedOverrideRef.current) return;
            hasProcessedOverrideRef.current = true;

            console.log('[MatchSelectionScreen] Using override results:', overrideResults.length, 'products');
            setAnalysisData({ jobId: 'quick-scan-override', results: overrideResults as any });
            setJobStatus('completed');
            setIsLoading(false);

            const hasPreSelectedByProduct = preSelectedByProductIndex && Object.keys(preSelectedByProductIndex).length > 0;
            if (hasPreSelectedByProduct) {
                setSelectedMatchesByIndex(prev => {
                    const next = { ...prev };
                    Object.entries(preSelectedByProductIndex).forEach(([idxStr, indices]) => {
                        const idx = parseInt(idxStr, 10);
                        if (Number.isFinite(idx) && Array.isArray(indices)) next[idx] = indices;
                    });
                    return next;
                });
                setBottomNavState('selection');
            } else if (preSelectedIndices.length > 0) {
                console.log('[MatchSelectionScreen] Pre-selecting indices:', preSelectedIndices);
                setSelectedMatchesByIndex(prev => ({ ...prev, [0]: preSelectedIndices }));
                setBottomNavState('selection');
            }
            return;
        }

        const pollStatus = async (retryCount: number = 0) => {
            const maxRetries = 5;
            const baseDelayMs = 1000; // 1s, 2s, 4s, 8s, 16s

            try {
                const token = await getToken();
                if (!jobId) {
                    // If no jobId provided (e.g., navigated from details via modal), stay in a safe empty/loading state
                    setIsLoading(false);
                    setJobStatus('unknown');
                    return;
                }
                if (!token) {
                    setError('Sign-in required to view match jobs.');
                    setIsLoading(false);
                    return;
                }
                const res = await fetch(`${BASE_URL}/api/products/match/jobs/${jobId}/status`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                // Handle 5xx server errors with retry
                if (res.status >= 500 && res.status < 600) {
                    if (retryCount < maxRetries) {
                        const delay = baseDelayMs * Math.pow(2, retryCount);
                        console.log(`[MatchSelectionScreen] Server error ${res.status}, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
                        setError(`Reconnecting... (attempt ${retryCount + 1}/${maxRetries})`);
                        pollingTimerRef.current = setTimeout(() => pollStatus(retryCount + 1), delay);
                        return;
                    } else {
                        throw new Error(`Server unavailable after ${maxRetries} retries. Please try again later.`);
                    }
                }

                // Clear any reconnecting message on success
                if (retryCount > 0) {
                    setError(null);
                    console.log(`[MatchSelectionScreen] Reconnected successfully after ${retryCount} retries`);
                }

                if (!res.ok) throw new Error(`Status ${res.status}`);
                const status = await res.json();
                if (cancelled) return;

                // Normalize to Analysis shape; merge rerankedResults so we don't lose them when backend sends partial updates
                const results = Array.isArray(status?.results) ? status.results : [];
                setAnalysisData(prev => {
                    const merged = results.map((r: any, i: number) => {
                        const hasNewReranked = Array.isArray(r?.rerankedResults) && r.rerankedResults.length > 0;
                        const prevResult = prev?.results?.[i] as any;
                        const hasPrevReranked = prevResult && Array.isArray(prevResult?.rerankedResults) && prevResult.rerankedResults.length > 0;
                        if (hasNewReranked) return r;
                        if (hasPrevReranked) return { ...r, rerankedResults: prevResult.rerankedResults };
                        return r;
                    });
                    return { jobId: status?.jobId, results: merged };
                });
                setJobStatus((status?.status as any) || 'unknown');
                // Render as soon as we have serpApiData (initial scan). Don't block on rerank/embeddings.
                const shouldKeepLoading = results.length === 0 && (status?.status === 'queued' || status?.status === 'processing');
                setIsLoading(shouldKeepLoading);

                if (status?.status === 'completed') {
                    // Optionally hydrate with final results (summary/timing)
                    try {
                        const res2 = await fetch(`${BASE_URL}/api/products/match/jobs/${jobId}/results`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (res2.ok) {
                            const finalData = await res2.json();
                            setAnalysisData({ jobId: finalData?.jobId, results: finalData?.results || [] });

                            // Extract failed items for retry/rescan UI
                            if (Array.isArray(finalData?.failedItems) && finalData.failedItems.length > 0) {
                                console.log(`[MatchSelectionScreen] ${finalData.failedItems.length} items failed, enabling retry`);
                                setFailedItems(finalData.failedItems);
                            }
                        }
                    } catch { }
                    return; // stop polling
                }

                pollingTimerRef.current = setTimeout(() => pollStatus(0), 700); // Reset retry count on success
            } catch (err: any) {
                if (!cancelled) {
                    // Network errors - retry with exponential backoff
                    const isNetworkError = err.message?.includes('Network') || err.message?.includes('fetch');
                    if (isNetworkError && retryCount < maxRetries) {
                        const delay = baseDelayMs * Math.pow(2, retryCount);
                        console.log(`[MatchSelectionScreen] Network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`);
                        setError(`Reconnecting... (attempt ${retryCount + 1}/${maxRetries})`);
                        pollingTimerRef.current = setTimeout(() => pollStatus(retryCount + 1), delay);
                        return;
                    }
                    setError(err.message);
                    setIsLoading(false);
                }
            }
        };

        pollStatus();

        (async () => {
            try {
                const { data } = await supabase.auth.getUser();
                setCurrentUserId(data.user?.id || null);
            } catch { }
        })();

        // Initialize focus index and any shared state coming from other screens
        if (typeof initialFocusIndex === 'number') {
            setCurrentProductIndex(initialFocusIndex as number);
        }
        if (Array.isArray(initialItems) && initialItems.length > 0) {
            setExternalItems(initialItems);
        }
        return () => {
            cancelled = true;
            if (pollingTimerRef.current) {
                clearTimeout(pollingTimerRef.current);
                pollingTimerRef.current = null;
            }
        };
    }, [jobId, overrideResults, preSelectedIndices, preSelectedByProductIndex]);

    const fetchTemplatesPage = useCallback(async (offset: number, replace: boolean = false) => {
        try {
            const { data, error } = await supabase
                .from('SearchTemplates')
                .select('*')
                .order('UpdatedAt', { ascending: false })
                .range(offset, offset + pageSize - 1);
            if (error) return;
            if (replace) {
                setUserTemplates(data || []);
            } else if (data && data.length) {
                setUserTemplates(prev => [...prev, ...data]);
            }
            if (!data || data.length < pageSize) {
                setHasMoreTemplates(false);
            }
        } catch { }
    }, [pageSize]);

    // Fetch user's templates when modal opens and when switching to picker
    useEffect(() => {
        if (!isTemplateModalVisible || templateModalView !== 'picker') return;
        setTemplateOffset(0);
        setHasMoreTemplates(true);
        fetchTemplatesPage(0, true);
    }, [isTemplateModalVisible, templateModalView, fetchTemplatesPage]);

    const loadMoreTemplates = useCallback(async () => {
        if (!hasMoreTemplates || isLoadingMoreTemplates) return;
        setIsLoadingMoreTemplates(true);
        const nextOffset = templateOffset + pageSize;
        await fetchTemplatesPage(nextOffset, false);
        setTemplateOffset(nextOffset);
        setIsLoadingMoreTemplates(false);
    }, [hasMoreTemplates, isLoadingMoreTemplates, templateOffset, pageSize, fetchTemplatesPage]);

    // No tabs/jobs list; ItemJobsModal shows items by default.

    // Helpers for template
    const parseDomain = (input: string): string | null => {
        try {
            let raw = input.trim().toLowerCase();
            // strip protocol
            raw = raw.replace(/^https?:\/\//, '');
            raw = raw.replace(/\/$/, '');
            // if no dot and no spaces, assume .com
            if (!raw.includes('.') && !raw.includes(' ')) raw = `${raw}.com`;
            // if contains spaces, take the token that looks like a domain
            if (raw.includes(' ')) {
                const token = raw.split(/\s+/).find(t => t.includes('.')) || raw.split(/\s+/)[0];
                raw = token;
                if (!raw.includes('.')) raw = `${raw}.com`;
            }
            const u = new URL(`https://${raw}`);
            return u.hostname.replace(/^www\./, '');
        } catch {
            return null;
        }
    };

    const faviconFor = (domain: string) => `https://icons.duckduckgo.com/ip3/${domain}.ico`;

    const addSource = useCallback(() => {
        const domain = parseDomain(sourceInput.trim());
        if (!domain) return;
        setTemplateDraft(prev => ({ ...prev, sources: Array.from(new Set([...prev.sources, domain])) }));
        setSourceInput('');
    }, [sourceInput]);

    const removeSource = useCallback((domain: string) => {
        setTemplateDraft(prev => ({ ...prev, sources: prev.sources.filter(d => d !== domain) }));
    }, []);

    const addFieldRow = useCallback(() => {
        setTemplateDraft(prev => ({
            ...prev,
            fieldRows: [
                ...prev.fieldRows,
                { id: `${Date.now()}`, platform: 'shopify', field: 'title', sources: prev.sources.slice(0, 1) },
            ],
        }));
    }, []);

    const updateFieldRow = useCallback((id: string, patch: Partial<PlatformFieldRow>) => {
        setTemplateDraft(prev => ({
            ...prev,
            fieldRows: prev.fieldRows.map(r => (r.id === id ? { ...r, ...patch } : r)),
        }));
    }, []);

    const toggleRowSource = useCallback((id: string, domain: string) => {
        setTemplateDraft(prev => ({
            ...prev,
            fieldRows: prev.fieldRows.map(r => {
                if (r.id !== id) return r;
                const exists = r.sources.includes(domain);
                return { ...r, sources: exists ? r.sources.filter(d => d !== domain) : [...r.sources, domain] };
            }),
        }));
    }, []);

    const deleteFieldRow = useCallback((id: string) => {
        setTemplateDraft(prev => ({ ...prev, fieldRows: prev.fieldRows.filter(r => r.id !== id) }));
    }, []);

    const buildPlatformRequests = (): Array<{ platform: string; fieldSources?: Record<string, string[]> }> => {
        const grouped: Record<string, Record<string, string[]>> = {};
        for (const row of templateDraft.fieldRows) {
            if (!grouped[row.platform]) grouped[row.platform] = {};
            grouped[row.platform][row.field] = row.sources;
        }
        return Object.entries(grouped).map(([platform, fieldSources]) => ({ platform, fieldSources }));
    };

    // --- Optimized Event Handlers ---
    const MAX_MATCH_SELECTIONS = 4; // Limit to 4 matches for optimal scraping performance

    const handleSelectProduct = useCallback((index: number) => {
        setWasAutoMatched(false); // User is selecting manually
        setSelectedMatchesByIndex(prev => {
            const current = prev[currentProductIndex] ?? [];
            // If already selected, allow deselection
            if (current.includes(index)) {
                const newSelection = current.filter(i => i !== index);
                // Reset flow when all items are deselected
                if (newSelection.length === 0) {
                    setBottomNavState('empty');
                    setSelectedPlatforms([]);
                    setSelectedTemplate(null);
                }
                return { ...prev, [currentProductIndex]: newSelection };
            }

            // If trying to add but already at limit, don't add (show feedback via UI)
            if (current.length >= MAX_MATCH_SELECTIONS) {
                Alert.alert(
                    'Match Limit Reached',
                    `You can select up to ${MAX_MATCH_SELECTIONS} matches for optimal performance.`,
                    [{ text: 'OK' }]
                );
                return prev;
            }

            // Add the new selection
            const newSelection = [...current, index];

            // Auto-advance to template stage when first item is selected
            if (newSelection.length > 0 && bottomNavState === 'empty') {
                setBottomNavState('selection');
            }
            return { ...prev, [currentProductIndex]: newSelection };
        });
    }, [bottomNavState, currentProductIndex]);

    const handleBackToEmpty = useCallback(() => {
        setSelectedMatchesByIndex(prev => ({ ...prev, [currentProductIndex]: [] }));
        setWasAutoMatched(false);
        setBottomNavState('empty');
        setSelectedPlatforms([]);
        setSelectedTemplate(null);
    }, [currentProductIndex]);

    const handleBackToTemplate = useCallback(() => {
        setBottomNavState('template');
        setSelectedPlatforms([]);
    }, []);

    const handleShowTemplates = useCallback(() => {
        setBottomNavState('template');
    }, []);

    const handleShowPlatforms = useCallback(() => {
        setBottomNavState('platform');
    }, []);

    const handleShowSelection = useCallback(() => {
        setBottomNavState('selection');
    }, []);

    const handleBackToSelection = useCallback(() => {
        setBottomNavState('selection');
    }, [bottomNavState]);

    const handleTemplateSelect = useCallback((template: string | null) => {
        setSelectedTemplate(template);
        setTemplateModalVisible(false);
        setBottomNavState('platform'); // Move to platform selection
    }, []);


    const handlePlatformSelect = useCallback((platform: string) => {
        setSelectedPlatforms(prev =>
            prev.includes(platform)
                ? prev.filter(p => p !== platform)
                : [...prev, platform]
        );
    }, []);

    // Resolve serp order for a given item (uses rerankedResults if available)
    const getResolvedSerpForItem = useCallback((idx: number): SerpApiData[] => {
        const result = analysisData?.results[idx];
        const rawSerp = result?.serpApiData || [];
        const reranked = result?.rerankedResults;
        if (Array.isArray(reranked) && reranked.length > 0) {
            const reordered: SerpApiData[] = [];
            const usedIndices = new Set<number>();
            reranked.forEach((r: any) => {
                if (typeof r.serpApiIndex === 'number' && rawSerp[r.serpApiIndex]) {
                    reordered.push(rawSerp[r.serpApiIndex]);
                    usedIndices.add(r.serpApiIndex);
                }
            });
            rawSerp.forEach((item, i) => {
                if (!usedIndices.has(i)) reordered.push(item);
            });
            return reordered;
        }
        return rawSerp;
    }, [analysisData]);

    const handleGenerateForItem = useCallback(async (
        idx: number,
        matchIndices: number[],
        serpOverride?: SerpApiData[]
    ): Promise<JobResponse> => {
        const serp = serpOverride ?? getResolvedSerpForItem(idx);
        const indicesToUse = matchIndices.length > 0 ? matchIndices : [0];
        const selectedMatches = indicesToUse.map(i => serp[i]).filter(Boolean);
        const actualUserPhotos = userImagesByIndex[idx] || [];
        const token = await getToken();

        const payload: GenerateJobSubmitPayload = {
            products: [
                {
                    productId: analysisData?.results[idx]?.productId,
                    variantId: analysisData?.results[idx]?.variantId,
                    productIndex: idx,
                    imageUrls: actualUserPhotos.length > 0 ? actualUserPhotos : [],
                    coverImageIndex: 0,
                    selectedMatches,
                },
            ],
            selectedPlatforms,
            template: selectedTemplate,
            options: { useScraping: true },
            templateSources: templateDraft.sources,
            platformRequests: buildPlatformRequests(),
        };

        if (!SSSYNC_API_BASE_URL && !process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL) {
            throw new Error('API base URL not configured');
        }
        const response = await fetch(`${BASE_URL}/api/products/generate/jobs`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Submit failed (${response.status}): ${text}`);
        }

        const data = await response.json();
        console.log('[GENERATE] Submitted job', data?.jobId, 'for productIndex', idx, 'selectedCount', matchIndices.length);
        return data;
    }, [analysisData, selectedTemplate, selectedPlatforms, userImagesByIndex, getResolvedSerpForItem]);


    // Memoize expensive computations
    const baseSerpApiData = useMemo(() => {
        if (!analysisData || !analysisData.results || analysisData.results.length === 0) return [];
        const safeIndex = Math.min(Math.max(currentProductIndex, 0), analysisData.results.length - 1);
        const result = analysisData.results[safeIndex];
        const rawSerp = result?.serpApiData || [];
        const reranked = result?.rerankedResults;

        // If backend provided reranked results, use them to reorder the list
        if (Array.isArray(reranked) && reranked.length > 0) {
            const reordered: SerpApiData[] = [];
            const usedIndices = new Set<number>();

            // 1. Add reranked items in order
            reranked.forEach(r => {
                // Ensure serpApiIndex is valid
                if (typeof r.serpApiIndex === 'number' && rawSerp[r.serpApiIndex]) {
                    reordered.push(rawSerp[r.serpApiIndex]);
                    usedIndices.add(r.serpApiIndex);
                }
            });

            // 2. Append remaining items that weren't in the top reranked list
            rawSerp.forEach((item, idx) => {
                if (!usedIndices.has(idx)) {
                    reordered.push(item);
                }
            });

            return reordered;
        }

        return rawSerp;
    }, [analysisData, currentProductIndex]);

    const [clientRerankedSerp, setClientRerankedSerp] = useState<SerpApiData[] | null>(null);

    // Kick off client-side rerank in background (optional)
    useEffect(() => {
        if (!CLIENT_RERANK_ENABLED) { setClientRerankedSerp(null); return; }
        if (!AI_SERVER_URL) { setClientRerankedSerp(null); return; }
        const list = baseSerpApiData;
        if (!list || list.length === 0) { setClientRerankedSerp(null); return; }
        // Do NOT run if user has already made a selection
        if (selectedIndices.length > 0) { setClientRerankedSerp(null); return; }
        // Do NOT run if this is not a new scan (e.g., returning to prior job)
        if (!isNewScan) { setClientRerankedSerp(null); return; }

        const query = list[0]?.title || 'product listing';
        const candidates = list.map((c, i) => ({ id: String(i), title: c.title || '', description: '' }));
        let aborted = false;
        (async () => {
            try {
                const res = await fetch(`${AI_SERVER_URL}/rerank`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query, candidates, top_k: Math.min(10, candidates.length) })
                });
                if (!res.ok) throw new Error(`Client rerank failed ${res.status}`);
                const data = await res.json();
                if (aborted) return;
                const ranked = (data?.ranked_candidates || []) as Array<{ title?: string }>;
                if (!ranked.length) { setClientRerankedSerp(null); return; }
                const reordered: SerpApiData[] = [];
                const remaining = [...list];
                ranked.forEach(rc => {
                    const idx = remaining.findIndex(x => x.title === rc.title);
                    if (idx >= 0) { reordered.push(remaining[idx]); remaining.splice(idx, 1); }
                });
                setClientRerankedSerp([...reordered, ...remaining]);
            } catch { setClientRerankedSerp(null); }
        })();
        return () => { aborted = true; };
    }, [baseSerpApiData, currentProductIndex, selectedIndices.length, isNewScan]);

    const serpApiData = clientRerankedSerp || baseSerpApiData;

    const handleGenerate = useCallback(async () => {
        return handleGenerateForItem(currentProductIndex, selectedIndices, serpApiData);
    }, [handleGenerateForItem, currentProductIndex, selectedIndices, serpApiData]);

    const selectedCount = selectedIndices.length;

    // Indices where confidence is not high (user may want to correct match)
    const needsReviewIndices = useMemo(() => {
        if (!analysisData?.results?.length) return [];
        return analysisData.results
            .map((r: any, i: number) => (r?.confidence === 'high' ? null : i))
            .filter((x: number | null): x is number => x !== null);
    }, [analysisData?.results]);

    // Find best reranked index for current item in the RENDERED LIST
    const bestIndex = useMemo(() => {
        if (!analysisData || !analysisData.results || analysisData.results.length === 0) return null;
        const safeIndex = Math.min(Math.max(currentProductIndex, 0), analysisData.results.length - 1);
        const resAny: any = analysisData.results[safeIndex] as any;
        const rr = Array.isArray(resAny?.rerankedResults) ? resAny.rerankedResults : [];
        if (!rr.length) return null;
        const best = rr[0];

        // Search in serpApiData (the rendered list)
        let idx = serpApiData.findIndex(x => (best?.link && x.link === best.link));
        if (idx >= 0) return idx;
        idx = serpApiData.findIndex(x => (best?.title && x.title === best.title));
        return idx >= 0 ? idx : null;
    }, [analysisData, currentProductIndex, serpApiData]);

    const autoMatchReasonText = useMemo(() => {
        const resAny: any = analysisData?.results?.[currentProductIndex] as any;
        if (!resAny) return '';
        const best = Array.isArray(resAny?.rerankedResults) ? resAny.rerankedResults[0] : null;
        if (!best) return '';
        const bits: string[] = [];
        if (typeof best?.score === 'number') {
            bits.push(`score ${(best.score * 100).toFixed(0)}%`);
        }
        if (resAny?.enrichedFrom === 'ebay') {
            bits.push('eBay title confirmed');
        }
        if (resAny?.matchSource) {
            bits.push(`${resAny.matchSource} identity`);
        }
        if (!bits.length) return '';
        return `Auto-match reason: ${bits.join(' • ')}`;
    }, [analysisData, currentProductIndex]);

    // Auto-match all: when we have results for this job, set best guess for every item once (confidence internal; user can correct)
    useEffect(() => {
        if (!jobId || !analysisData?.results?.length) return;
        if (hasAutoMatchedAllRef.current === jobId) return;
        hasAutoMatchedAllRef.current = jobId;
        const results = analysisData.results;
        setSelectedMatchesByIndex(prev => {
            const next = { ...prev };
            results.forEach((res: any, idx: number) => {
                const rr = Array.isArray(res?.rerankedResults) ? res.rerankedResults : [];
                const bestSerpIndex = rr.length > 0 && typeof rr[0]?.serpApiIndex === 'number' ? rr[0].serpApiIndex : 0;
                const serp = res?.serpApiData || [];
                const safeBest = bestSerpIndex >= 0 && bestSerpIndex < serp.length ? bestSerpIndex : 0;
                next[idx] = [safeBest];
                hasAutoSelectedByIndexRef.current.add(idx);
            });
            return next;
        });
        setBottomNavState('selection');
        setWasAutoMatched(true);
    }, [jobId, analysisData?.results]);

    // Auto-select best only if rerankedResults exist and nothing selected (ONE TIME per item)
    useEffect(() => {
        if (hasAutoSelectedByIndexRef.current.has(currentProductIndex)) return;
        if (selectedIndices.length > 0) {
            hasAutoSelectedByIndexRef.current.add(currentProductIndex);
            return;
        }
        if (bestIndex !== null) {
            hasAutoSelectedByIndexRef.current.add(currentProductIndex);
            setSelectedMatchesByIndex(prev => ({ ...prev, [currentProductIndex]: [bestIndex] }));
            setBottomNavState('selection');
            setWasAutoMatched(true);
        }
    }, [bestIndex, selectedIndices.length, currentProductIndex]);

    // Track selection count per item to detect "just selected" for auto-advance
    const lastSelectionCountRef = React.useRef<number>(0);
    // Reset when switching items so the new item can trigger advance when selected
    useEffect(() => {
        lastSelectionCountRef.current = selectedIndices.length;
    }, [currentProductIndex]); // eslint-disable-line react-hooks/exhaustive-deps -- only reset on item switch, not on selection change

    // Auto-advance to next unmatched item after selecting a match (reduces taps for 50 items)
    useEffect(() => {
        if (selectedIndices.length === 0) return;
        if (lastSelectionCountRef.current > 0) return; // Already had selection (e.g. returning from Reselect)
        lastSelectionCountRef.current = selectedIndices.length;

        const total = modalItems.length || (analysisData?.results?.length ?? 0);
        if (total <= 1) return;

        // Find next item with no selection
        for (let i = 1; i < total; i++) {
            const nextIdx = (currentProductIndex + i) % total;
            const nextSelection = selectedMatchesByIndex[nextIdx];
            if (!nextSelection || nextSelection.length === 0) {
                setCurrentProductIndex(nextIdx);
                setBottomNavState('empty');
                return;
            }
        }
    }, [selectedIndices.length, currentProductIndex, modalItems.length, analysisData?.results?.length, selectedMatchesByIndex]);

    // Client-side rerank feedback: if background rerank reorders and user had already selected a different item
    // OPTIMIZED: Only send feedback ONCE per unique selection (prevents spam requests)
    useEffect(() => {
        if (!CLIENT_RERANK_ENABLED) return;
        if (!clientRerankedSerp) return;
        if (selectedIndices.length === 0) return; // no selection yet
        if (!SSSYNC_API_BASE_URL_FE) return;

        // Create a unique key for this feedback to prevent duplicates
        const feedbackKey = `${currentProductIndex}-${selectedIndices.join(',')}`;
        if (lastFeedbackKeyRef.current === feedbackKey) return;

        // Determine top pick in client rerank and current user pick
        const rerankerTop = clientRerankedSerp[0];
        const userPick = serpApiData[selectedIndices[0]];
        if (!rerankerTop || !userPick) return;

        // If they differ, log feedback (non-blocking, fire once per unique selection)
        if (rerankerTop.link !== userPick.link || rerankerTop.title !== userPick.title) {
            lastFeedbackKeyRef.current = feedbackKey; // Mark as sent BEFORE async call
            (async () => {
                try {
                    const token = await getToken();
                    const payload = {
                        productIndex: currentProductIndex,
                        userPick: { title: userPick.title, link: userPick.link, sourceUrl: userPick.link, price: userPick.price?.extracted_value },
                        rerankerPick: { title: rerankerTop.title, link: rerankerTop.link, sourceUrl: rerankerTop.link, price: rerankerTop.price?.extracted_value },
                        candidatesSnapshot: serpApiData.map(c => ({ title: c.title, link: c.link })),
                        modelVersion: 'client-qwen3',
                    };
                    await fetch(`${SSSYNC_API_BASE_URL_FE}/api/products/recognize/feedback`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({
                            matchId: `${jobId}:${currentProductIndex}`,
                            userSelection: selectedIndices[0],
                            userFeedback: JSON.stringify(payload),
                        }),
                    });
                } catch {
                    // swallow
                }
            })();
        }
    }, [clientRerankedSerp, selectedIndices, currentProductIndex, serpApiData, jobId]);

    const applyManualSafetyOverride = useCallback(() => {
        const raw = manualSafetyInput.trim();
        if (!raw || !analysisData?.results?.[currentProductIndex]) return;
        const isUrl = /^https?:\/\//i.test(raw);
        let title = raw;
        if (isUrl) {
            try {
                title = new URL(raw).hostname.replace('www.', '');
            } catch {
                title = raw;
            }
        }
        const fallbackImage =
            userImagesByIndex?.[currentProductIndex]?.[0] ||
            serpApiData?.[0]?.thumbnail ||
            serpApiData?.[0]?.image ||
            '';
        const manualCandidate: SerpApiData = {
            position: (serpApiData?.length || 0) + 1,
            title,
            link: isUrl ? raw : '',
            source: 'manual',
            source_icon: '',
            thumbnail: fallbackImage,
            image: fallbackImage,
        };
        const insertIndex = serpApiData.length;
        setAnalysisData(prev => {
            if (!prev?.results?.[currentProductIndex]) return prev;
            const nextResults = [...prev.results];
            const current = nextResults[currentProductIndex];
            nextResults[currentProductIndex] = {
                ...current,
                serpApiData: [...(current.serpApiData || []), manualCandidate],
            };
            return { ...prev, results: nextResults };
        });
        setSelectedMatchesByIndex(prev => ({ ...prev, [currentProductIndex]: [insertIndex] }));
        setBottomNavState('selection');
        setManualSafetyInput('');
    }, [manualSafetyInput, analysisData, currentProductIndex, serpApiData, userImagesByIndex]);

    // --- Render Logic ---
    if (isLoading) return <View style={styles.centerContainer}><ActivityIndicator size="large" color="#93C822" /><Text style={styles.infoText}>Finding matches…</Text></View>;
    if (error) return <View style={styles.centerContainer}><Text style={styles.errorText}>Error: {error}</Text></View>;
    if (!analysisData || serpApiData.length === 0) {
        if (jobStatus === 'queued' || jobStatus === 'processing') {
            return <View style={styles.centerContainer}><ActivityIndicator size="large" color="#93C822" /><Text style={styles.infoText}>Finding matches…</Text></View>;
        }
        // No results and not processing -> offer rescan
        return (
            <View style={styles.centerContainer}>
                <Text style={styles.infoText}>We couldn't find matches for this item.</Text>
                <TouchableOpacity
                    style={[styles.mainEmptyButton, { marginTop: 16 }]}
                    onPress={() => {
                        navigation.navigate('AddProduct' as never, { focusItemIndex: currentProductIndex, message: 'Retake core photo to improve results', resumeJobId: jobId } as never);
                    }}
                >
                    <Icon name="camera" size={20} color="#000" style={{ marginRight: 8 }} />
                    <Text style={styles.secondaryButtonText}>Rescan This Item</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <View style={styles.container}>

            <View style={{ flex: 1, position: 'absolute', top: 70, left: 16, zIndex: 1, flexDirection: 'row', gap: 8, minWidth: 100, minHeight: 34, alignContent: "flex-end" }}>
                <BackButton onPress={() => navigation.goBack()} />

                {/* Tiny bulk button top-left */}
                <TouchableOpacity onPress={() => setJobsModalVisible(true)} style={{ paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center' as any }}>
                    <Boxes size={18} color="#000" />
                    <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Current Jobs</Text>
                </TouchableOpacity>
            </View>

            <FlashList
                data={serpApiData}
                extraData={[selectedIndices, wasAutoMatched]}
                numColumns={COLUMNS}
                contentContainerStyle={{ padding: GRID_PADDING, marginTop: 90, paddingBottom: 140 }}
                ListHeaderComponent={
                    <View style={{ paddingHorizontal: GRID_PADDING, paddingBottom: 12 }}>
                        <Text style={{ fontSize: 16, fontWeight: 500, color: 'rgb(57, 57, 57)', lineHeight: 22, textAlign: "center"}}>
                            Select the best match(es) for the item
                        </Text>
                        {autoMatchReasonText ? (
                            <Text style={{ fontSize: 12, color: '#4B5563', marginTop: 6, textAlign: 'center' }}>
                                {autoMatchReasonText}
                            </Text>
                        ) : null}
                        {modalItems.length > 1 && needsReviewIndices.length > 0 && (
                            <TouchableOpacity
                                onPress={() => {
                                    const first = needsReviewIndices[0];
                                    if (typeof first === 'number') {
                                        setCurrentProductIndex(first);
                                        setBottomNavState('selection');
                                    }
                                }}
                                style={{ marginTop: 10, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: 'rgba(255,193,7,0.15)', borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                            >
                                <Icon name="alert-circle-outline" size={18} color="#b45309" />
                                <Text style={{ fontSize: 13, color: '#b45309', fontWeight: '500' }}>
                                    {needsReviewIndices.length} item{needsReviewIndices.length !== 1 ? 's' : ''} may need review
                                </Text>
                                <Text style={{ fontSize: 13, color: '#b45309' }}>• Tap to go to first</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                }
                // Use a more stable key if possible to prevent recreation
                keyExtractor={(item, index) => item.link || item.position?.toString() || index.toString()}
                renderItem={({ item, index }) => (
                    <ProductGridItem
                        item={item}
                        index={index}
                        isSelected={selectedIndices.includes(index)}
                        onSelect={handleSelectProduct}
                        isBest={index === (bestIndex ?? 0)}
                        isAutoMatched={wasAutoMatched && selectedIndices.length === 1 && selectedIndices[0] === index}
                    />
                )}
                removeClippedSubviews={true} // Re-enable for performance
            />

            <View style={styles.manualSafetyBar}>
                <Text style={styles.manualSafetyTitle}>Safety override: paste product URL or type product name</Text>
                <View style={styles.manualSafetyRow}>
                    <TextInput
                        value={manualSafetyInput}
                        onChangeText={setManualSafetyInput}
                        placeholder="https://example.com/item or Logitech G502 HERO"
                        placeholderTextColor="#9CA3AF"
                        style={styles.manualSafetyInput}
                        autoCapitalize="none"
                    />
                    <TouchableOpacity
                        style={[styles.manualSafetyApply, manualSafetyInput.trim().length === 0 && styles.manualSafetyApplyDisabled]}
                        disabled={manualSafetyInput.trim().length === 0}
                        onPress={applyManualSafetyOverride}
                    >
                        <Text style={styles.manualSafetyApplyText}>Use</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Dark Overlay for platform/platformPicker states */}
            {(bottomNavState === 'platform' || bottomNavState === 'template') && (
                <TouchableOpacity
                    activeOpacity={1}
                    onPress={handleBackToSelection}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                        zIndex: 999,
                    }}
                />
            )}

            {/* --- Enhanced Bottom Navigation Bar (reusable) --- */}
            <LinearGradient colors={["rgba(255, 255, 255, 0)", "rgb(255, 255, 255)", "rgb(255, 255, 255)",]} style={{ position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1000, paddingBottom: 35 }} pointerEvents="box-none">
                <BottomNav
                    state={bottomNavState}
                    selectedCount={selectedCount}
                    selectedTemplate={selectedTemplate}
                    selectedPlatforms={selectedPlatforms}
                    totalItemsCount={modalItems.length}
                    confirmedProduct={selectedCount > 0 && serpApiData[selectedIndices[0]] ? {
                        thumb: serpApiData[selectedIndices[0]].thumbnail || serpApiData[selectedIndices[0]].image,
                        title: serpApiData[selectedIndices[0]].title,
                        price: serpApiData[selectedIndices[0]].price?.value,
                        condition: serpApiData[selectedIndices[0]].condition,
                        source: sanitizeSourceLabel(serpApiData[selectedIndices[0]]),
                    } : null}
                    onChangeMatch={handleBackToEmpty}
                    isConnected={isConnected}
                    onShowSelection={handleShowSelection}
                    onShowTemplates={handleShowTemplates}
                    onShowPlatforms={handleShowPlatforms}
                    onBackToEmpty={handleBackToEmpty}
                    onBackToSelection={handleBackToSelection}
                    onOpenTemplateModal={() => setTemplateModalVisible(true)}
                    onTemplateSelect={handleTemplateSelect}
                    onPlatformToggle={handlePlatformSelect}
                    onBack={() => navigation.goBack()}
                    onGeneratePress={async () => {
                        try {
                            const submitResult: JobResponse = await handleGenerate();
                            const jobId = submitResult?.jobId;
                            if (jobId) {
                                setItemGenerateJobs(prev => ({ ...prev, [currentProductIndex]: { jobId } }));
                                const jobMap = { ...itemGenerateJobs, [currentProductIndex]: { jobId } };
                                const selectedMatches = selectedIndices.map(i => serpApiData[i]).filter(Boolean);
                                const firstPhotos = selectedMatches.map(item => item.image || item.thumbnail || '').filter(Boolean);
                                navigation.navigate('LoadingScreen' as never, {
                                    processType: 'generate',
                                    payload: {
                                        jobId,
                                        firstPhotos,
                                    },
                                    onCompleteRoute: {
                                        screen: 'GenerateDetailsScreen',
                                        params: {
                                            jobResponse: submitResult,
                                            jobId: jobId,
                                            matchJobId: analysisData?.jobId,
                                            items: modalItems,
                                            jobMap,
                                            userImagesByIndex,
                                        },
                                    },
                                });
                            } else {
                                Alert.alert('Error', 'Failed to get valid jobId, try again later');
                            }
                        } catch (error) {
                            console.log('Error starting generation');
                            Alert.alert('Error starting generation');
                        }
                    }}
                />
            </LinearGradient>

            {/* --- Enhanced Template Selection Modal --- */}
            <Modal
                animationType="fade"
                transparent={true}
                visible={isTemplateModalVisible}
                onRequestClose={() => setTemplateModalVisible(false)}
            >
                <View style={styles.modalContainer}>
                    <View style={[styles.modalContent, { maxHeight: '80%', height: '80%' }]}>
                        <View style={styles.modalHeader}>
                            {templateModalView === 'create' ? (
                                <TouchableOpacity
                                    style={styles.modalCloseButton}
                                    onPress={() => setTemplateModalView('picker')}
                                >
                                    <Icon name="arrow-left" size={24} color="#000" />
                                </TouchableOpacity>
                            ) : (
                                <View style={{ width: 24 }} />
                            )}
                            <Text style={styles.modalTitle}>{templateModalView === 'picker' ? 'Templates' : 'Create New Template'}</Text>
                            <TouchableOpacity
                                style={styles.modalCloseButton}
                                onPress={() => setTemplateModalVisible(false)}
                            >
                                <Icon name="close" size={24} color="#000" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView style={styles.templateScrollView} contentContainerStyle={{ paddingBottom: 120 }}>
                            {templateModalView === 'picker' && (
                                <>
                                    {/* Favorites */}
                                    <View style={styles.templateSection}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <Text style={styles.sectionTitle}>Favorites</Text>
                                            <View style={{ flexDirection: 'row', gap: 8 }}>
                                                <TouchableOpacity onPress={toggleManageMode} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 }}>
                                                    <Text style={{ color: '#000' }}>{manageMode ? 'Done' : 'Manage'}</Text>
                                                </TouchableOpacity>
                                                {manageMode && (
                                                    <TouchableOpacity onPress={bulkDeleteSelected} style={{ borderWidth: 1, borderColor: '#e11d48', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10 }}>
                                                        <Text style={{ color: '#e11d48' }}>Delete</Text>
                                                    </TouchableOpacity>
                                                )}
                                            </View>
                                        </View>
                                        {[{ Id: 'default-amazon', Name: 'Amazon Default', SuggestedSites: ['amazon.com'] }, { Id: 'default-ebay', Name: 'eBay Default', SuggestedSites: ['ebay.com'] }]
                                            .filter(def => !hiddenDefaults.has(def.Id))
                                            .map(def => (
                                                <TouchableOpacity key={def.Name} style={styles.templateOption} onPress={() => {
                                                    const autoName = generateNameFromSources(def.SuggestedSites);
                                                    setSelectedTemplate(autoName);
                                                    setTemplateDraft({ sources: def.SuggestedSites, fieldRows: [] });
                                                    setTemplateName(autoName);
                                                    setEditingTemplateId(null);
                                                    setTemplateModalView('create');
                                                }}>
                                                    <View style={[styles.templateRow, { alignItems: 'center', paddingRight: 20, justifyContent: 'space-between' }]}>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                            {def.SuggestedSites.slice(0, 2).map(s => (
                                                                <Image key={s} source={{ uri: faviconFor(s) }} style={{ width: 18, height: 18 }} />
                                                            ))}
                                                        </View>
                                                        <Text style={styles.templateOptionText}>{generateNameFromSources(def.SuggestedSites)}</Text>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                                                            {!manageMode && (
                                                                <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                                    onPress={async () => {
                                                                        try {
                                                                            const name = generateNameFromSources(def.SuggestedSites);
                                                                            const insert = await supabase.from('SearchTemplates').insert({
                                                                                Name: name,
                                                                                Category: 'General',
                                                                                Description: 'Default starter template',
                                                                                SearchPrompt: 'User-defined',
                                                                                SuggestedSites: def.SuggestedSites,
                                                                                ExtractionSchema: { fieldSourceMappings: {} },
                                                                                IsDefault: false,
                                                                                IsPublic: false,
                                                                                isFavorite: false
                                                                            }).select('*').single();
                                                                            if (!insert.error && insert.data) {
                                                                                setUserTemplates(prev => [insert.data, ...prev]);
                                                                                setHiddenDefaults(prev => new Set([...Array.from(prev), def.Id]));
                                                                            }
                                                                        } catch { }
                                                                    }}>
                                                                    <Icon name="star-outline" size={22} color="#71717A" />
                                                                </TouchableOpacity>
                                                            )}
                                                            {manageMode && (
                                                                <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => {
                                                                    setHiddenDefaults(prev => new Set([...Array.from(prev), def.Id]));
                                                                }}>
                                                                    <Icon name="delete-outline" size={22} color="#e11d48" />
                                                                </TouchableOpacity>
                                                            )}
                                                        </View>
                                                    </View>
                                                </TouchableOpacity>
                                            ))}
                                        {favorites.map((tpl) => (
                                            <TouchableOpacity key={tpl.Id || tpl.id || tpl.Name} style={[styles.templateOption, manageMode && { backgroundColor: selectedTemplateIds.has(getTplId(tpl)) ? 'rgba(147,200,34,0.1)' : '#fff' }]} onPress={() => {
                                                if (manageMode) { toggleSelectTemplate(getTplId(tpl)); return; }
                                                // Use template
                                                setSelectedTemplate(tpl.Name || tpl.name || 'Template');
                                                const sources = tpl.SuggestedSites || tpl.suggestedSites || [];
                                                const mappings = tpl.FieldSourceMappings || (tpl.ExtractionSchema && tpl.ExtractionSchema.fieldSourceMappings) || {};
                                                const rows: PlatformFieldRow[] = [];
                                                Object.entries(mappings).forEach(([platform, fsObj]: any) => {
                                                    Object.entries(fsObj as Record<string, string[]>).forEach(([field, srcs]) => {
                                                        rows.push({ id: `${platform}-${field}`, platform, field, sources: srcs as string[] });
                                                    });
                                                });
                                                setTemplateDraft({ sources, fieldRows: rows });
                                                setTemplateModalVisible(false);
                                                setBottomNavState('platform');
                                            }}>
                                                <View style={[styles.templateItems]}>
                                                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 8 }}>
                                                            {Array.isArray(tpl.SuggestedSites) && tpl.SuggestedSites.slice(0, 2).map((s: string) => (
                                                                <Image key={s} source={{ uri: faviconFor(s) }} style={{ width: 18, height: 18 }} />
                                                            ))}
                                                        </View>
                                                        <Text style={styles.templateOptionText} numberOfLines={1}>
                                                            {(tpl.Name && tpl.Name.trim().length > 0) ? tpl.Name : generateNameFromSources(tpl.SuggestedSites || [])}
                                                        </Text>
                                                    </View>
                                                    {/* Buttons */}
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                                                        {!manageMode && (
                                                            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={async () => { try { await supabase.from('SearchTemplates').update({ isFavorite: false }).eq('Id', tpl.Id); setUserTemplates(prev => prev.map(p => p.Id === tpl.Id ? { ...p, isFavorite: false } : p)); } catch { } }}>
                                                                <Icon name="star" size={24} color="#FFD700" />
                                                            </TouchableOpacity>)}
                                                        {!manageMode && (
                                                            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => {
                                                                // Edit template (update if owned else copy)
                                                                const sources = tpl.SuggestedSites || [];
                                                                const mappings = tpl.FieldSourceMappings || (tpl.ExtractionSchema && tpl.ExtractionSchema.fieldSourceMappings) || {};
                                                                const rows: PlatformFieldRow[] = [];
                                                                Object.entries(mappings).forEach(([platform, fsObj]: any) => {
                                                                    Object.entries(fsObj as Record<string, string[]>).forEach(([field, srcs]) => {
                                                                        rows.push({ id: `${platform}-${field}`, platform, field, sources: srcs as string[] });
                                                                    });
                                                                });
                                                                setTemplateDraft({ sources, fieldRows: rows });
                                                                setSelectedTemplate(tpl.Name || '');
                                                                setTemplateName(tpl.Name || '');
                                                                setEditingTemplateId(tpl.Id || tpl.id || null);
                                                                setTemplateModalView('create');
                                                            }}>
                                                                <Icon name="pencil" size={22} color="#71717A" />
                                                            </TouchableOpacity>)}
                                                        {/* Reordering disabled per latest request (manage = delete only) */}
                                                        {manageMode && (
                                                            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={async () => {
                                                                try {
                                                                    Alert.alert('Delete Template', 'Are you sure you want to delete this template?', [
                                                                        { text: 'Cancel', style: 'cancel' },
                                                                        {
                                                                            text: 'Delete', style: 'destructive', onPress: async () => {
                                                                                await supabase.from('SearchTemplates').delete().eq('Id', tpl.Id);
                                                                                setUserTemplates(prev => prev.filter(p => p.Id !== tpl.Id));
                                                                            }
                                                                        }
                                                                    ]);
                                                                } catch { }
                                                            }}>
                                                                <Icon name="delete-outline" size={22} color="#e11d48" />
                                                            </TouchableOpacity>)}
                                                    </View>
                                                </View>
                                            </TouchableOpacity>
                                        ))}

                                    </View>

                                    {/* Recents + Load More */}
                                    <View style={styles.templateSection}>
                                        <Text style={styles.sectionTitle}>Recents</Text>
                                        {recents.map((tpl) => (
                                            <TouchableOpacity key={tpl.Id || tpl.id || tpl.Name} style={[styles.templateOption, manageMode && { backgroundColor: selectedTemplateIds.has(getTplId(tpl)) ? 'rgba(147,200,34,0.1)' : '#fff' }]} onPress={() => {
                                                if (manageMode) { toggleSelectTemplate(getTplId(tpl)); return; }
                                                setSelectedTemplate(tpl.Name || tpl.name || 'Template');
                                                const sources = tpl.SuggestedSites || tpl.suggestedSites || [];
                                                const mappings = tpl.FieldSourceMappings || (tpl.ExtractionSchema && tpl.ExtractionSchema.fieldSourceMappings) || {};
                                                const rows: PlatformFieldRow[] = [];
                                                Object.entries(mappings).forEach(([platform, fsObj]: any) => {
                                                    Object.entries(fsObj as Record<string, string[]>).forEach(([field, srcs]) => {
                                                        rows.push({ id: `${platform}-${field}`, platform, field, sources: srcs as string[] });
                                                    });
                                                });
                                                setTemplateDraft({ sources, fieldRows: rows });
                                                setTemplateModalVisible(false);
                                                setBottomNavState('platform');
                                            }}>
                                                <View style={[styles.templateItems]}>
                                                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
                                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 8 }}>
                                                            {Array.isArray(tpl.SuggestedSites) && tpl.SuggestedSites.slice(0, 2).map((s: string) => (
                                                                <Image key={s} source={{ uri: faviconFor(s) }} style={{ width: 18, height: 18 }} />
                                                            ))}
                                                        </View>
                                                        <Text style={styles.templateOptionText} numberOfLines={1}>
                                                            {(tpl.Name && tpl.Name.trim().length > 0) ? tpl.Name : generateNameFromSources(tpl.SuggestedSites || [])}
                                                        </Text>
                                                    </View>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                                                        {!manageMode && (
                                                            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={() => {
                                                                const sources = tpl.SuggestedSites || [];
                                                                const mappings = tpl.FieldSourceMappings || (tpl.ExtractionSchema && tpl.ExtractionSchema.fieldSourceMappings) || {};
                                                                const rows: PlatformFieldRow[] = [];
                                                                Object.entries(mappings).forEach(([platform, fsObj]: any) => {
                                                                    Object.entries(fsObj as Record<string, string[]>).forEach(([field, srcs]) => {
                                                                        rows.push({ id: `${platform}-${field}`, platform, field, sources: srcs as string[] });
                                                                    });
                                                                });
                                                                setTemplateDraft({ sources, fieldRows: rows });
                                                                setSelectedTemplate(tpl.Name || '');
                                                                setTemplateName(tpl.Name || '');
                                                                setEditingTemplateId(tpl.Id || tpl.id || null);
                                                                setTemplateModalView('create');
                                                            }}>
                                                                <Icon name="pencil" size={22} color="#71717A" />
                                                            </TouchableOpacity>)}
                                                        {!manageMode && (
                                                            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={async () => { try { await supabase.from('SearchTemplates').update({ isFavorite: true }).eq('Id', tpl.Id); setUserTemplates(prev => prev.map(p => p.Id === tpl.Id ? { ...p, isFavorite: true } : p)); } catch { } }}>
                                                                <Icon name="star-outline" size={24} color="#71717A" />
                                                            </TouchableOpacity>)}
                                                        {manageMode && (
                                                            <TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} onPress={async () => {
                                                                try {
                                                                    Alert.alert('Delete Template', 'Delete this template?', [
                                                                        { text: 'Cancel', style: 'cancel' },
                                                                        {
                                                                            text: 'Delete', style: 'destructive', onPress: async () => {
                                                                                await supabase.from('SearchTemplates').delete().eq('Id', tpl.Id);
                                                                                setUserTemplates(prev => prev.filter(p => p.Id !== tpl.Id));
                                                                            }
                                                                        }
                                                                    ]);
                                                                } catch { }
                                                            }}>
                                                                <Icon name="delete-outline" size={22} color="#e11d48" />
                                                            </TouchableOpacity>)}
                                                    </View>
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                        {hasMoreTemplates && (
                                            <TouchableOpacity onPress={loadMoreTemplates} style={{ marginTop: 10, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 10, paddingVertical: 10, alignItems: 'center' }}>
                                                <Text style={{ color: '#000' }}>{isLoadingMoreTemplates ? 'Loading...' : 'Load More'}</Text>
                                            </TouchableOpacity>
                                        )}
                                    </View>
                                </>
                            )}

                            {templateModalView === 'create' && (
                                <View style={{ flex: 1, minHeight: 700 }}>

                                    {/* Template name */}
                                    <View style={styles.templateSection}>
                                        <Text style={styles.sectionTitle}>Template Name</Text>
                                        <View style={{}}>
                                            <TextInput
                                                style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, color: '#000' }}
                                                placeholder="Template name"
                                                placeholderTextColor="#888"
                                                value={templateName}
                                                onChangeText={setTemplateName}
                                            />
                                        </View>
                                    </View>
                                    {/* Sources input */}
                                    <View style={styles.templateSection}>
                                        <Text style={styles.sectionTitle}>Sources</Text>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                            <TextInput
                                                style={{ flex: 1, borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 }}
                                                placeholder="Enter a site name or link"
                                                placeholderTextColor="#888"
                                                value={sourceInput}
                                                onChangeText={setSourceInput}
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                            />
                                            <TouchableOpacity onPress={addSource} style={{ backgroundColor: '#93C822', borderRadius: 10, padding: 10 }}>
                                                <Icon name="arrow-right" size={20} color="#fff" />
                                            </TouchableOpacity>
                                        </View>
                                        <View style={{ marginTop: 10, gap: 8 }}>
                                            {templateDraft.sources.map((domain) => (
                                                <View key={domain} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12 }}>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                                                        <Image source={{ uri: faviconFor(domain) }} style={{ width: 20, height: 20 }} />
                                                        <Text style={{ color: '#000' }}>{domain}</Text>
                                                    </View>
                                                    <TouchableOpacity onPress={() => removeSource(domain)}>
                                                        <Icon name="trash-can-outline" size={20} color="#e11d48" />
                                                    </TouchableOpacity>
                                                </View>
                                            ))}
                                        </View>
                                    </View>

                                    {/* Field mappings */}
                                    <View style={[styles.templateSection]}>
                                        <Text style={styles.sectionTitle}>Fields</Text>
                                        {templateDraft.fieldRows.map(row => (
                                            <View key={row.id} style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 12, padding: 12, gap: 8 }}>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <Text style={{ fontWeight: '600', color: '#000' }}>Sourcing Request</Text>
                                                    <TouchableOpacity onPress={() => deleteFieldRow(row.id)}>
                                                        <Icon name="trash-can-outline" size={18} color="#e11d48" />
                                                    </TouchableOpacity>
                                                </View>
                                                <View style={{ flexDirection: 'row', gap: 8 }}>
                                                    <View style={{ flex: 1 }}>
                                                        <TouchableOpacity
                                                            style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                                                            onPress={() => setOpenDropdown(prev => ({ rowId: prev.rowId === row.id && prev.type === 'platform' ? null : row.id, type: 'platform' }))}
                                                        >
                                                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                                                <Icon name={ENABLED_PLATFORM_OPTIONS.find(p => p.key === row.platform)?.icon || 'store'} size={18} color="#555" />
                                                                <Text style={{ color: '#000' }}>{ENABLED_PLATFORM_OPTIONS.find(p => p.key === row.platform)?.label || 'Platform'}</Text>
                                                            </View>
                                                            <Icon name="chevron-down" size={18} color="#000" />
                                                        </TouchableOpacity>
                                                        {openDropdown.rowId === row.id && openDropdown.type === 'platform' && (
                                                            <View style={{ position: 'absolute', top: 48, left: 0, right: 0, zIndex: 1000 }}>
                                                                <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, maxHeight: 260 }}>
                                                                    <View style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: '#E5E5E5' }}>
                                                                        <TextInput
                                                                            style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 6, paddingHorizontal: 8, color: '#000' }}
                                                                            placeholder="Search platform..."
                                                                            placeholderTextColor="#888"
                                                                            value={dropdownSearchQuery}
                                                                            onChangeText={setDropdownSearchQuery}
                                                                        />
                                                                    </View>
                                                                    <ScrollView style={{ maxHeight: 210 }}>
                                                                        {ENABLED_PLATFORM_OPTIONS.filter(opt => opt.label.toLowerCase().includes(dropdownSearchQuery.toLowerCase())).map(opt => (
                                                                            <TouchableOpacity key={opt.key} style={{ padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }} onPress={() => { updateFieldRow(row.id, { platform: opt.key }); setOpenDropdown({ rowId: null, type: null }); setDropdownSearchQuery(''); }}>
                                                                                <Icon name={opt.icon} size={18} color="#555" />
                                                                                <Text style={{ color: '#000' }}>{opt.label}</Text>
                                                                            </TouchableOpacity>
                                                                        ))}
                                                                    </ScrollView>
                                                                </View>
                                                            </View>
                                                        )}
                                                    </View>
                                                    <View style={{ flex: 1 }}>
                                                        <TouchableOpacity
                                                            style={{ borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                                                            onPress={() => setOpenDropdown(prev => ({ rowId: prev.rowId === row.id && prev.type === 'field' ? null : row.id, type: 'field' }))}
                                                        >
                                                            <Text style={{ color: '#000', fontWeight: '500' }}>{FIELD_OPTIONS.find(f => f.key === row.field)?.label || 'Field'}</Text>
                                                            <Icon name="chevron-down" size={18} color="#000" />
                                                        </TouchableOpacity>
                                                        {openDropdown.rowId === row.id && openDropdown.type === 'field' && (
                                                            <View style={{ position: 'absolute', top: 48, left: 0, right: 0, zIndex: 1000 }}>
                                                                <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E5E5E5', borderRadius: 8, maxHeight: 260 }}>
                                                                    <View style={{ padding: 8, borderBottomWidth: 1, borderBottomColor: '#E5E5E5' }}>
                                                                        <TextInput
                                                                            style={{ paddingHorizontal: 8, color: '#000' }}
                                                                            placeholder="Search field..."
                                                                            placeholderTextColor="#888"
                                                                            value={dropdownSearchQuery}
                                                                            onChangeText={setDropdownSearchQuery}
                                                                        />
                                                                    </View>
                                                                    <ScrollView style={{ maxHeight: 210 }}>
                                                                        {FIELD_OPTIONS.filter(opt => opt.label.toLowerCase().includes(dropdownSearchQuery.toLowerCase())).map(opt => (
                                                                            <TouchableOpacity key={opt.key} style={{ padding: 10 }} onPress={() => { updateFieldRow(row.id, { field: opt.key }); setOpenDropdown({ rowId: null, type: null }); setDropdownSearchQuery(''); }}>
                                                                                <Text style={{ color: '#000' }}>{opt.label}</Text>
                                                                            </TouchableOpacity>
                                                                        ))}
                                                                    </ScrollView>
                                                                </View>
                                                            </View>
                                                        )}
                                                    </View>
                                                </View>
                                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <Text style={{ color: '#71717A' }}>Tap to enable a source</Text>
                                                </View>
                                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                                                    {templateDraft.sources.map((domain) => {
                                                        const active = row.sources.includes(domain);
                                                        return (
                                                            <TouchableOpacity key={`${row.id}-${domain}`} onPress={() => toggleRowSource(row.id, domain)} style={{ borderWidth: 1, borderColor: active ? '#93C822' : '#E5E5E5', backgroundColor: active ? 'rgba(147,200,34,0.1)' : '#fff', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                                <Image source={{ uri: faviconFor(domain) }} style={{ width: 16, height: 16 }} />
                                                                <Text style={{ color: '#000' }}>{domain}</Text>
                                                            </TouchableOpacity>
                                                        );
                                                    })}
                                                </View>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            )}
                        </ScrollView>

                        {templateModalView === 'create' && (
                            <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 10 }}>
                                <TouchableOpacity onPress={addFieldRow} style={{ borderWidth: 1, borderColor: '#93C822', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 10, width: '90%', alignItems: 'center' }}>
                                    <Text style={{ color: '#93C822', fontWeight: '600' }}>+ Add Field</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {templateModalView === 'create' ? (

                            <TouchableOpacity
                                style={styles.createNewTemplateButton}
                                onPress={async () => {
                                    const mappings: Record<string, Record<string, string[]>> = {};
                                    templateDraft.fieldRows.forEach(r => {
                                        if (!mappings[r.platform]) mappings[r.platform] = {};
                                        mappings[r.platform][r.field] = r.sources;
                                    });
                                    try {
                                        if (editingTemplateId && currentUserId) {
                                            // Update if owned by user; if not owned, fall back to insert copy
                                            const { data: tpl } = await supabase
                                                .from('SearchTemplates')
                                                .select('UserId')
                                                .eq('Id', editingTemplateId)
                                                .single();
                                            if (tpl && tpl.UserId === currentUserId) {
                                                await supabase.from('SearchTemplates').update({
                                                    Name: (templateName || selectedTemplate || 'Custom Template').trim(),
                                                    SuggestedSites: templateDraft.sources,
                                                    ExtractionSchema: { fieldSourceMappings: mappings },
                                                }).eq('Id', editingTemplateId);
                                            } else {
                                                await supabase.from('SearchTemplates').insert({
                                                    Name: (templateName || selectedTemplate || 'Custom Template').trim(),
                                                    Category: 'General',
                                                    Description: 'User-defined template',
                                                    SearchPrompt: 'User-defined',
                                                    SuggestedSites: templateDraft.sources,
                                                    ExtractionSchema: { fieldSourceMappings: mappings },
                                                    IsDefault: false,
                                                    IsPublic: false,
                                                    UserId: currentUserId,
                                                });
                                            }
                                        } else {
                                            await supabase.from('SearchTemplates').insert({
                                                Name: (templateName || selectedTemplate || 'Custom Template').trim(),
                                                Category: 'General',
                                                Description: 'User-defined template',
                                                SearchPrompt: 'User-defined',
                                                SuggestedSites: templateDraft.sources,
                                                ExtractionSchema: { fieldSourceMappings: mappings },
                                                IsDefault: false,
                                                IsPublic: false,
                                                UserId: currentUserId,
                                            });
                                        }
                                    } catch { }
                                    setTemplateModalView('picker');
                                    setTemplateModalVisible(false);
                                    setBottomNavState('platform');
                                }}
                            >
                                <Icon name="content-save" size={20} color="#FFFFFF" />
                                <Text style={styles.createNewTemplateButtonText}>Save Template</Text>
                            </TouchableOpacity>

                        ) : (
                            <TouchableOpacity
                                style={styles.createNewTemplateButton}
                                onPress={() => setTemplateModalView('create')}
                            >
                                <Icon name="plus" size={20} color="#FFFFFF" />
                                <Text style={styles.createNewTemplateButtonText}>Create New Template</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </Modal>

            {/* Global Item Jobs Modal (no tabs UI) */}
            <ItemJobsModal
                visible={jobsModalVisible}
                onClose={() => setJobsModalVisible(false)}
                items={modalItems}
                currentIndex={currentProductIndex}
                scanColor={(idx) => {
                    // Show failed items in red for retry indication
                    const isFailed = failedItems.some(f => f.index === idx);
                    if (isFailed) return '#e11d48'; // Red for failed
                    return analysisData ? '#93C822' : (isLoading ? '#FFD700' : '#4B5563');
                }}
                matchColor={(idx) => ((selectedMatchesByIndex[idx]?.length ?? 0) > 0 ? '#93C822' : '#FFD700')}
                detailsColor={(idx) => {
                    const s = itemGenerateJobs[idx]?.status;
                    if (s === 'completed') return '#93C822';
                    if (s === 'failed') return '#e11d48';
                    if (s) return '#FFD700';
                    return '#4B5563';
                }}
                detailsEnabled={(idx) => !!itemGenerateJobs[idx]?.jobId}
                countLabel={'Matches'}
                getSecondaryText={(idx) => {
                    const s = itemGenerateJobs[idx]?.status;
                    if (!s) return null;
                    return s === 'completed' ? 'Generated' : s === 'failed' ? 'Generation failed' : 'Generating…';
                }}
                enableMultiSelect
                onBatchGenerateSelected={async (indices) => {
                    if (indices.length > 1 && selectedPlatforms.length === 0) {
                        Alert.alert('Select platforms first', 'Platforms apply to all items. Please select at least one platform before generating.');
                        return;
                    }
                    try {
                        // Generate for each selected index using per-item match selection
                        for (const idx of indices) {
                            const matchIndices = selectedMatchesByIndex[idx] ?? [];
                            const submit: JobResponse = await handleGenerateForItem(idx, matchIndices);
                            const jid = submit?.jobId;
                            if (jid) setItemGenerateJobs(prev => ({ ...prev, [idx]: { jobId: jid } }));
                        }
                        setJobsModalVisible(false);
                    } catch {
                        Alert.alert('Batch generate failed', 'Please try again');
                    }
                }}
                onBatchRescanSelected={async (indices) => {
                    try {
                        const token = await getToken();
                        // Build minimal match payload using current best/cover images
                        const productsPayload = indices.map((idx) => {
                            const serp = analysisData?.results[idx]?.serpApiData || [];
                            const firstImage = serp[0]?.image || serp[0]?.thumbnail || '';
                            return {
                                productIndex: idx,
                                images: [{ url: firstImage }],
                            };
                        });
                        const res = await fetch(`${BASE_URL}/api/products/match/jobs`, {
                            method: 'POST',
                            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ products: productsPayload, options: { useReranking: true } }),
                        });
                        if (!res.ok) throw new Error(`Rescan failed (${res.status})`);
                        setJobsModalVisible(false);
                        Alert.alert('Rescan started', `${indices.length} item(s) queued`);
                    } catch (e) {
                        Alert.alert('Rescan failed', 'Please try again');
                    }
                }}
                onRescan={(idx) => {
                    // Navigate user to AddProduct to retake the core photo for this item
                    setJobsModalVisible(false);
                    navigation.navigate('AddProduct' as never, { focusItemIndex: idx, message: 'Retake core photo to improve results' } as never);
                }}
                onQuickGenerate={async (idx) => {
                    try {
                        setCurrentProductIndex(idx);
                        setJobsModalVisible(false);
                        const submitResult: JobResponse = await handleGenerateForItem(idx, selectedMatchesByIndex[idx] ?? []);
                        const jid = submitResult?.jobId;
                        if (jid) {
                            setItemGenerateJobs(prev => ({ ...prev, [idx]: { jobId: jid } }));
                            const jobMap = { ...itemGenerateJobs, [idx]: { jobId: jid } };
                            navigation.navigate('LoadingScreen' as never, {
                                processType: 'generate',
                                payload: { jobId: jid, firstPhotos: [] },
                                onCompleteRoute: { screen: 'GenerateDetailsScreen', params: { jobId: jid, matchJobId: analysisData?.jobId, items: modalItems, jobMap, userImagesByIndex } }
                            } as never);
                        }
                    } catch (e) {
                        Alert.alert('Generate failed', 'Please try again');
                    }
                }}
                onPickScan={(idx) => {
                    setCurrentProductIndex(idx);
                    setSelectedMatchesByIndex(prev => ({ ...prev, [idx]: [] }));
                    setSelectedPlatforms([]);
                    setSelectedTemplate(null);
                    setJobsModalVisible(false);
                    setBottomNavState('empty');
                }}
                onPickMatch={(idx) => {
                    setCurrentProductIndex(idx);
                    setJobsModalVisible(false);
                    setBottomNavState('selection');
                }}
                onPickDetails={(idx) => {
                    const jobId = itemGenerateJobs[idx]?.jobId;
                    if (jobId) {
                        const jobMap = { ...itemGenerateJobs };
                        navigation.navigate('LoadingScreen' as never, {
                            processType: 'generate',
                            payload: { jobId, firstPhotos: [] },
                            onCompleteRoute: { screen: 'GenerateDetailsScreen', params: { jobId, items: modalItems, jobMap, matchJobId: analysisData?.jobId, userImagesByIndex } }
                        } as never);
                        setJobsModalVisible(false);
                    }
                }}
            />
        </View>
    );
}

export default MatchSelectionScreen;

// --- Enhanced Stylesheet ---
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'rgb(255, 255, 255)',
        paddingVertical: 20,
    },
    centerContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgb(255, 255, 255)'
    },
    errorText: {
        color: '#ff4d4d',
        fontSize: 16,
        textAlign: 'center',
        padding: 20
    },
    infoText: {
        color: '#000000',
        fontSize: 16,
        textAlign: 'center',
        marginTop: 50
    },
    header: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(228, 228, 231, 0.1)'
    },
    headerTitle: { fontSize: 24, fontWeight: 'bold', color: '#000000' },
    headerSubtitle: { fontSize: 14, color: '#000000', marginTop: 4 },
    itemContainer: {
        width: ITEM_WIDTH,
        marginBottom: ITEM_SPACING,
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#FFFFFF',
        borderWidth: 2,
        borderColor: 'rgba(228, 228, 231, 0.5)'
    },
    itemSelected: {
        borderColor: '#93C822',
        borderWidth: 2,
        borderRadius: 8
    },
    itemPressed: {
        opacity: 0.8,
        transform: [{ scale: 0.98 }]
    },
    selectionOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(147, 200, 34, 0.3)',
        justifyContent: 'center',
        alignItems: 'center'
    },
    itemImage: { width: '100%', height: ITEM_WIDTH, backgroundColor: '#333' },
    itemDetails: { padding: 8 },
    itemTitle: { fontSize: 14, fontWeight: '600', color: '#000000', height: 34 },
    itemPrice: { fontSize: 13, color: '#000000', marginTop: 2 },
    itemCondition: { fontSize: 12, color: '#666666', marginTop: 2 },
    itemSource: { fontSize: 12, color: '#000000', marginTop: 4 },
    manualSafetyBar: {
        position: 'absolute',
        left: 14,
        right: 14,
        bottom: 118,
        zIndex: 1001,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderWidth: 1,
        borderColor: '#E5E7EB',
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 8,
    },
    manualSafetyTitle: {
        fontSize: 12,
        color: '#4B5563',
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
        borderColor: '#D1D5DB',
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 13,
        color: '#111827',
        backgroundColor: '#FFFFFF',
    },
    manualSafetyApply: {
        backgroundColor: '#111827',
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    manualSafetyApplyDisabled: {
        opacity: 0.45,
    },
    manualSafetyApplyText: {
        color: '#FFFFFF',
        fontWeight: '600',
        fontSize: 13,
    },
    bottomNavContainer: {
        padding: 20,
        backgroundColor: 'transparent',
        borderTopWidth: 1,
        borderTopColor: '#E5E5E5',
        //backgroundColor: 'red',
        //backgroundColor: 'rgba(255, 255, 255, 0.9)',
        minHeight: 100,
    },
    expandedBottomNav: {
        alignItems: 'center',
        gap: 12,
        paddingLeft: 30,
        paddingRight: 30,
        justifyContent: 'space-between',
        marginTop: 10,
        minHeight: 550,
        maxHeight: 600,
        backgroundColor: 'rgb(255, 255, 255)'
    },
    bottomNavStepContainer: {
        alignItems: 'center',
        gap: 12,
        paddingLeft: 30,
        paddingRight: 30,
        marginTop: 10,
        backgroundColor: 'transparent',
        minHeight: 100,
        paddingBottom: 12,
    },
    emptyBottomNavStepContainer: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
        gap: 12,
        maxHeight: 100,


    },
    dropdownSelect: {
        flexDirection: 'row',
        backgroundColor: '#FFFFFF',
        paddingVertical: 14,
        paddingHorizontal: 15,
        marginLeft: 10,
        marginRight: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E5E5',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%'
    }, dropdownSelectText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#000000'
    },
    mainButton: {
        flexDirection: 'row',
        backgroundColor: '#93C822',
        paddingVertical: 14,
        paddingHorizontal: 30,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%'
    },
    emptyButtonSolo: {
        backgroundColor: 'transparent',
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 12,
        minHeight: 100,
        maxHeight: 100,
    },
    mainEmptyButton: {
        flexDirection: 'row',
        backgroundColor: 'rgba(255, 210, 97, 0.5)',
        borderWidth: 2,
        borderColor: 'rgba(0,0,0,0.5)',
        paddingVertical: 14,
        paddingHorizontal: 30,
        borderRadius: 12,
    },
    mainButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    secondaryButton: {
        marginTop: 12,
        flexDirection: 'row',
        backgroundColor: '#D9D9D9',
        paddingVertical: 14,
        paddingHorizontal: 30,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%'
    },
    secondaryButtonText: { color: '#888', fontSize: 16, fontWeight: '500' },


    clearBackButton: {
        flexDirection: 'row',
        backgroundColor: 'transparent',
        paddingVertical: 7,
        borderRadius: 12,
    },
    backButton: {
        flexDirection: 'row',
        backgroundColor: '#D9D9D9',
        paddingVertical: 14,
        paddingHorizontal: 30,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%'
    },
    backButtonText: { color: '#888', fontSize: 16, fontWeight: '600' },
    disabledButton: { backgroundColor: '#555' },
    selectPromptContainer: {
        position: 'absolute',
        left: 16,
        right: 16,
        bottom: 50,
        alignItems: 'center',
        zIndex: 999,
        elevation: 5,
        backgroundColor: 'transparent',
    },
    selectPromptButton: {
        flexDirection: 'row',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255, 210, 97, 0.5)',
        borderWidth: 2,
        borderColor: 'rgba(0,0,0,0.5)',
        borderRadius: 10,
        paddingVertical: 10,
        borderStyle: 'dashed',
    },
    selectPromptText: {
        color: '#000',
        fontSize: 14,
        fontWeight: '600',
    },
    platformHeader: {
        flexDirection: 'row',
        width: '100%',
        marginBottom: 12
    },
    platformHeaderText: {
        fontSize: 24,
        fontWeight: '500',
        color: '#000'
    },
    backIconButton: {
        padding: 4
    },
    platformGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        marginBottom: 16,
        gap: 8
    },
    modalContainer: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0, 0, 0, 0.6)'
    },
    modalContent: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        paddingBottom: 20,
        minHeight: '50%',
        maxHeight: '70%',
        height: '70%',
        position: 'absolute',
        bottom: 90,
        left: 10,
        right: 10,
        borderWidth: 1,
        borderColor: '#E5E5E5'
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 20
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#000000'
    },
    modalCloseButton: {
        padding: 4,
        color: '#000000'
    },
    templateScrollView: {
        flex: 1,
    },
    templateSection: {
        paddingHorizontal: 20,
        paddingVertical: 16,
        gap: 12,
    },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#888',
        marginBottom: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5
    },
    templateOption: {
        paddingVertical: 15,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#E5E5E5'
    },
    templateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    templateItems: {
        flexDirection: 'row',
        width: '100%',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    templateOptionText: {
        color: '#000000',
        fontSize: 16,
        fontWeight: '500',
        flex: 1
    },
    createNewOption: {
        borderWidth: 0
    },
    noThanksButton: {
        margin: 20,
        paddingVertical: 15,
        borderWidth: 1,
        borderColor: '#E5E5E5',
        borderRadius: 8,
        alignItems: 'center',
        flexDirection: 'row',
    },
    createTemplateContainer: {
        flexDirection: 'row',
        minHeight: 800,
        backgroundColor: 'red',

        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        color: '#93C822'
    },
    createNewTemplateButton: {
        borderWidth: 1,
        borderColor: '#93C822',
        borderRadius: 12,
        paddingVertical: 15,
        paddingHorizontal: 30,
        marginHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#93C822',
        justifyContent: 'center',
        gap: 12,
        color: '#93C822'

    }, createNewTemplateButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '500'
    },
    noThanksButtonText: {
        color: '#888',
        fontSize: 16,
        fontWeight: '500'
    }
});
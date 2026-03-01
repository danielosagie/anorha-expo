import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RouteProp, useNavigation } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppStackParamList } from '../navigation/AppNavigator';
import { ensureSupabaseJwt } from '../lib/supabase';

const BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'https://api.sssync.app';
const GRID_COLUMNS = 3;

interface Price {
  value?: string;
  extracted_value?: number;
  currency?: string;
}

interface SerpApiData {
  position?: number;
  title?: string;
  link?: string;
  source?: string;
  source_icon?: string;
  thumbnail?: string;
  image?: string;
  rating?: number;
  reviews?: number;
  price?: Price;
  condition?: string;
  in_stock?: boolean;
}

interface MatchResult {
  productIndex: number;
  productId?: string;
  variantId?: string;
  serpApiData: SerpApiData[];
  rerankedResults?: Array<{
    serpApiIndex?: number;
    score?: number;
    title?: string;
    link?: string;
  }>;
  confidence?: 'high' | 'medium' | 'low';
  matchDecision?: 'matched' | 'classified' | 'needs_user_input';
  matchDecisionReason?: string;
  userAssist?: {
    required: boolean;
    prompt: string;
    requestedFields?: string[];
    allowedActions?: Array<'confirm' | 'deny' | 'refine' | 'best_guess' | 'retake'>;
    requestId?: string;
  };
  processingState?: 'ready_for_generate' | 'awaiting_user_input' | 'user_resolved' | 'blocked';
}

interface MatchStatusPayload {
  jobId: string;
  status: string;
  currentStage?: string;
  results: MatchResult[];
}

export interface JobResponse {
  jobId: string;
  status?: string;
  estimatedTimeMinutes?: number;
  totalProducts?: number;
  message?: string;
}

type ScreenRoute = RouteProp<AppStackParamList, 'MatchSelectionScreen'>;

function reorderCandidates(result?: MatchResult | null): SerpApiData[] {
  if (!result) return [];
  const base = Array.isArray(result.serpApiData) ? result.serpApiData : [];
  const reranked = Array.isArray(result.rerankedResults) ? result.rerankedResults : [];
  if (!base.length || !reranked.length) return base;

  const ordered: SerpApiData[] = [];
  const used = new Set<number>();

  reranked.forEach((item) => {
    if (typeof item?.serpApiIndex === 'number' && base[item.serpApiIndex]) {
      ordered.push(base[item.serpApiIndex]);
      used.add(item.serpApiIndex);
    }
  });

  base.forEach((candidate, index) => {
    if (!used.has(index)) ordered.push(candidate);
  });

  return ordered;
}

function sourceLabel(candidate?: SerpApiData): string {
  const rawSource = String(candidate?.source || '').trim();
  if (rawSource.length > 0) return rawSource;
  try {
    const host = candidate?.link ? new URL(candidate.link).hostname.replace('www.', '') : '';
    return host || 'web';
  } catch {
    return 'web';
  }
}

async function getToken() {
  return ensureSupabaseJwt();
}

export default function MatchSelectionScreen({ route }: { route: ScreenRoute }) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const params = (route.params || {}) as any;

  const jobId: string | undefined = params.jobId || params?.response?.jobId || params?.jobResponse?.jobId;
  const initialFocusRef = useRef<number>(typeof params.focusIndex === 'number' ? params.focusIndex : 0);
  const returnToLoadingRef = useRef<any>(params.returnToLoading);
  const initialPreResolvedRef = useRef<Record<number, number[]>>(params.preResolvedSelections || {});
  const initialPreDeniedRef = useRef<Record<number, number[]>>(params.preDeniedSelections || {});
  const initialPreRefineRef = useRef<Record<number, string>>(params.preRefineTextByIndex || {});

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>('queued');
  const [analysisData, setAnalysisData] = useState<MatchStatusPayload | null>(() => {
    const results = params?.response?.analysis?.results || params?.response?.jobResults || params?.overrideResults;
    if (Array.isArray(results) && results.length > 0) {
      return {
        jobId: jobId || params?.response?.analysis?.jobId || 'local',
        status: params?.response?.analysis?.status || 'processing',
        currentStage: params?.response?.analysis?.currentStage,
        results,
      };
    }
    return null;
  });

  const [currentProductIndex, setCurrentProductIndex] = useState<number>(initialFocusRef.current);
  const [selectedMatchesByIndex, setSelectedMatchesByIndex] = useState<Record<number, number[]>>({});
  const [deniedSelectionsByIndex, setDeniedSelectionsByIndex] = useState<Record<number, number[]>>({});
  const [refineTextByIndex, setRefineTextByIndex] = useState<Record<number, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const hydrationKeyRef = useRef<string | null>(null);
  const autoSelectedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const hydrationKey = `${route.key}:${jobId || 'none'}`;
    if (hydrationKeyRef.current === hydrationKey) return;
    hydrationKeyRef.current = hydrationKey;

    if (Object.keys(initialPreResolvedRef.current).length > 0) {
      setSelectedMatchesByIndex((prev) => ({ ...initialPreResolvedRef.current, ...prev }));
    }
    if (Object.keys(initialPreDeniedRef.current).length > 0) {
      setDeniedSelectionsByIndex((prev) => ({ ...initialPreDeniedRef.current, ...prev }));
    }
    if (Object.keys(initialPreRefineRef.current).length > 0) {
      setRefineTextByIndex((prev) => ({ ...initialPreRefineRef.current, ...prev }));
    }

    if (typeof initialFocusRef.current === 'number' && Number.isFinite(initialFocusRef.current)) {
      setCurrentProductIndex(Math.max(0, initialFocusRef.current));
    }
  }, [route.key, jobId]);

  useEffect(() => {
    if (analysisData?.results?.length) {
      setIsLoading(false);
      setJobStatus(analysisData.status || 'processing');
      return;
    }

    if (!jobId) {
      setError('Missing match job id.');
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const pollStatus = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Sign-in required to continue.');

        const res = await fetch(`${BASE_URL}/api/products/match/jobs/${jobId}/status`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`Failed to fetch match status (${res.status})${body ? `: ${body.slice(0, 180)}` : ''}`);
        }

        const status = await res.json();
        if (cancelled) return;

        setJobStatus(status?.status || 'processing');
        setAnalysisData({
          jobId: status?.jobId || jobId,
          status: status?.status || 'processing',
          currentStage: status?.currentStage,
          results: Array.isArray(status?.results) ? status.results : [],
        });

        setError(null);
        setIsLoading(false);

        if (!cancelled && (status?.status === 'queued' || status?.status === 'processing')) {
          pollTimer = setTimeout(pollStatus, 1200);
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'Failed to load match status');
        setIsLoading(false);
      }
    };

    setIsLoading(true);
    pollStatus();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [jobId, analysisData?.results?.length, analysisData?.status]);

  const results = analysisData?.results || [];
  const safeIndex = useMemo(() => {
    if (!results.length) return 0;
    return Math.min(Math.max(currentProductIndex, 0), results.length - 1);
  }, [currentProductIndex, results.length]);

  useEffect(() => {
    if (!results.length) return;
    if (currentProductIndex !== safeIndex) setCurrentProductIndex(safeIndex);
  }, [currentProductIndex, safeIndex, results.length]);

  const currentResult = results[safeIndex] || null;
  const candidates = useMemo(() => reorderCandidates(currentResult), [currentResult]);
  const denied = deniedSelectionsByIndex[safeIndex] || [];

  const visibleCandidates = useMemo(() => {
    return candidates
      .map((candidate, originalIndex) => ({ candidate, originalIndex }))
      .filter((entry) => !denied.includes(entry.originalIndex));
  }, [candidates, denied]);

  const selectedIndex = selectedMatchesByIndex[safeIndex]?.[0];
  const selectedCandidate = typeof selectedIndex === 'number' ? candidates[selectedIndex] : undefined;
  const refineText = refineTextByIndex[safeIndex] || '';

  useEffect(() => {
    if (!currentResult || candidates.length === 0) return;
    if (autoSelectedRef.current.has(safeIndex)) return;
    if ((selectedMatchesByIndex[safeIndex] || []).length > 0) {
      autoSelectedRef.current.add(safeIndex);
      return;
    }

    const ranked = Array.isArray(currentResult.rerankedResults) ? currentResult.rerankedResults : [];
    const bestFromRerank = typeof ranked?.[0]?.serpApiIndex === 'number' ? ranked[0].serpApiIndex : 0;
    const safeBest = bestFromRerank >= 0 && bestFromRerank < candidates.length ? bestFromRerank : 0;

    autoSelectedRef.current.add(safeIndex);
    setSelectedMatchesByIndex((prev) => ({ ...prev, [safeIndex]: [safeBest] }));
  }, [currentResult, candidates.length, safeIndex, selectedMatchesByIndex]);

  const submitAssistResponse = useCallback(async (input: {
    action: 'confirm' | 'deny' | 'refine' | 'best_guess';
    candidateIndex?: number;
    deniedCandidateIndices?: number[];
    refineText?: string;
    generateBestGuess?: boolean;
  }) => {
    if (!jobId) throw new Error('Missing job id');

    const token = await getToken();
    if (!token) throw new Error('Sign-in required to continue.');

    const body: Record<string, any> = {
      action: input.action,
    };

    if (typeof currentResult?.userAssist?.requestId === 'string' && currentResult.userAssist.requestId.length > 0) {
      body.requestId = currentResult.userAssist.requestId;
    }
    if (typeof input.candidateIndex === 'number') body.candidateIndex = input.candidateIndex;
    if (Array.isArray(input.deniedCandidateIndices)) body.deniedCandidateIndices = input.deniedCandidateIndices;
    if (typeof input.refineText === 'string' && input.refineText.trim().length > 0) body.refineText = input.refineText.trim();
    if (input.generateBestGuess === true) body.generateBestGuess = true;

    const res = await fetch(`${BASE_URL}/api/products/match/jobs/${jobId}/product/${safeIndex}/assist-response`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`Failed to submit assist response (${res.status})${bodyText ? `: ${bodyText.slice(0, 180)}` : ''}`);
    }

    const data = await res.json();
    const updatedResult = data?.updatedResult || data?.result;

    if (updatedResult) {
      setAnalysisData((prev) => {
        if (!prev || !Array.isArray(prev.results)) return prev;
        const nextResults = [...prev.results];
        nextResults[safeIndex] = { ...(nextResults[safeIndex] || {}), ...updatedResult };
        return { ...prev, results: nextResults, status: data?.status || prev.status, currentStage: data?.currentStage || prev.currentStage };
      });
    }
  }, [jobId, safeIndex, currentResult]);

  const navigateBackToLoading = useCallback((decisionPatch: Record<string, any>) => {
    const returnToLoading = returnToLoadingRef.current;
    if (!returnToLoading) {
      navigation.goBack();
      return;
    }

    const existingPayload = returnToLoading.payload || {};
    const existingDecisions = existingPayload.userAssistDecisions || {};
    const mergedDecision = {
      ...(existingDecisions[safeIndex] || {}),
      ...decisionPatch,
      state: 'submitted' as const,
    };

    navigation.replace('LoadingScreen', {
      ...returnToLoading,
      payload: {
        ...existingPayload,
        userAssistDecisions: {
          ...existingDecisions,
          [safeIndex]: mergedDecision,
        },
        resumeFromAssist: true,
        assistTransitionToken: `${Date.now()}`,
        assistSourceItemIndex: safeIndex,
      },
    } as any);
  }, [navigation, safeIndex]);

  const handleConfirm = useCallback(async () => {
    if (typeof selectedIndex !== 'number') {
      Alert.alert('Select a match', 'Choose a listing before confirming.');
      return;
    }

    try {
      setIsSubmitting(true);
      await submitAssistResponse({ action: 'confirm', candidateIndex: selectedIndex });
      navigateBackToLoading({ confirmedCandidateIndex: selectedIndex });
    } catch (err: any) {
      Alert.alert('Could not confirm match', err?.message || 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [selectedIndex, submitAssistResponse, navigateBackToLoading]);

  const handleDenySelected = useCallback(async () => {
    if (typeof selectedIndex !== 'number') return;
    const nextDenied = Array.from(new Set([...(deniedSelectionsByIndex[safeIndex] || []), selectedIndex]));
    setDeniedSelectionsByIndex((prev) => ({ ...prev, [safeIndex]: nextDenied }));
    setSelectedMatchesByIndex((prev) => ({ ...prev, [safeIndex]: [] }));

    try {
      await submitAssistResponse({
        action: 'deny',
        candidateIndex: selectedIndex,
        deniedCandidateIndices: [selectedIndex],
      });
    } catch {
      // non-blocking for UX; local state still reflects denied option
    }
  }, [selectedIndex, deniedSelectionsByIndex, safeIndex, submitAssistResponse]);

  const handleSubmitRefine = useCallback(async () => {
    const value = (refineTextByIndex[safeIndex] || '').trim();
    if (!value) {
      Alert.alert('Add details', 'Enter a detail like barcode, model, or visible text.');
      return;
    }

    try {
      setIsSubmitting(true);
      await submitAssistResponse({ action: 'refine', refineText: value });
      navigateBackToLoading({ refineText: value });
    } catch (err: any) {
      Alert.alert('Could not submit details', err?.message || 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [refineTextByIndex, safeIndex, submitAssistResponse, navigateBackToLoading]);

  const handleBestGuess = useCallback(async () => {
    try {
      setIsSubmitting(true);
      await submitAssistResponse({ action: 'best_guess', generateBestGuess: true });
      navigateBackToLoading({ generateBestGuess: true });
    } catch (err: any) {
      Alert.alert('Could not continue', err?.message || 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [submitAssistResponse, navigateBackToLoading]);

  const totalItems = Math.max(results.length, 1);

  if (isLoading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color="#93C822" />
        <Text style={styles.loadingText}>Loading match candidates…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centeredContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.retryText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
    >
      <View style={styles.headerRow}>
        <TouchableOpacity style={styles.chip} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={14} color="#111827" />
          <Text style={styles.chipText}>Back</Text>
        </TouchableOpacity>
        <View style={[styles.chip, styles.progressChip]}>
          <Icon name="progress-clock" size={14} color="#111827" />
          <Text style={styles.chipText}>Progress</Text>
        </View>
      </View>

      <View style={styles.titleWrap}>
        <Text style={styles.title}>Select Best Matching Listing</Text>
        <Text style={styles.subtitle}>Item {safeIndex + 1} of {totalItems} • {jobStatus}</Text>
      </View>

      {currentResult?.matchDecisionReason ? (
        <View style={styles.infoPill}>
          <Text style={styles.infoPillText}>{currentResult.matchDecisionReason}</Text>
        </View>
      ) : null}

      <FlashList
        data={visibleCandidates}
        numColumns={GRID_COLUMNS}
        keyExtractor={(entry, index) => entry.candidate.link || `${entry.originalIndex}-${index}`}
        estimatedItemSize={170}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 280 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>No candidate matches left</Text>
            <Text style={styles.emptyStateBody}>Refine with text details or continue with best guess.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isSelected = typeof selectedIndex === 'number' && selectedIndex === item.originalIndex;
          const imageUri = item.candidate.thumbnail || item.candidate.image;
          return (
            <TouchableOpacity
              style={[styles.card, isSelected && styles.cardSelected]}
              onPress={() => {
                setSelectedMatchesByIndex((prev) => ({ ...prev, [safeIndex]: [item.originalIndex] }));
              }}
            >
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.cardImage} resizeMode="cover" />
              ) : (
                <View style={styles.cardImagePlaceholder} />
              )}
              <Text numberOfLines={2} style={styles.cardTitle}>{item.candidate.title || 'Untitled listing'}</Text>
              <Text numberOfLines={1} style={styles.cardMeta}>{sourceLabel(item.candidate)}</Text>
              {isSelected ? (
                <View style={styles.selectedBadge}>
                  <Icon name="check-circle" size={14} color="#FFFFFF" />
                  <Text style={styles.selectedBadgeText}>Selected</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />

      <View style={[styles.bottomSheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        {selectedCandidate ? (
          <>
            <Text style={styles.bottomTitle}>Selected Match</Text>
            <View style={styles.selectedRow}>
              {(selectedCandidate.thumbnail || selectedCandidate.image) ? (
                <Image source={{ uri: selectedCandidate.thumbnail || selectedCandidate.image }} style={styles.selectedThumb} />
              ) : (
                <View style={[styles.selectedThumb, styles.cardImagePlaceholder]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.selectedTitle} numberOfLines={2}>{selectedCandidate.title || 'Untitled listing'}</Text>
                <Text style={styles.selectedMeta} numberOfLines={1}>{sourceLabel(selectedCandidate)}</Text>
              </View>
            </View>
            <View style={styles.bottomActionsRow}>
              <TouchableOpacity
                style={[styles.secondaryButton, isSubmitting && styles.disabledButton]}
                onPress={() => { void handleDenySelected(); }}
                disabled={isSubmitting}
              >
                <Text style={styles.secondaryButtonText}>Not this</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryButton, isSubmitting && styles.disabledButton]}
                onPress={() => { void handleConfirm(); }}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={styles.primaryButtonText}>Confirm Product Selection</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.bottomTitle}>Need help identifying this item?</Text>
            <Text style={styles.bottomDescription}>
              {currentResult?.userAssist?.prompt || 'Add a detail like barcode/model/title, or continue with best guess.'}
            </Text>
            <TextInput
              style={styles.refineInput}
              placeholder="Refine with text details (barcode, model, title)"
              placeholderTextColor="#94A3B8"
              value={refineText}
              onChangeText={(text) => {
                setRefineTextByIndex((prev) => ({ ...prev, [safeIndex]: text }));
              }}
              multiline
            />
            <TouchableOpacity
              style={[styles.primaryButton, isSubmitting && styles.disabledButton]}
              onPress={() => { void handleSubmitRefine(); }}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Submit Details</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.linkButton, isSubmitting && styles.disabledButton]}
              onPress={() => { void handleBestGuess(); }}
              disabled={isSubmitting}
            >
              <Text style={styles.linkButtonText}>Just give your best guess</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  centeredContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
  },
  loadingText: {
    marginTop: 10,
    color: '#4B5563',
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: {
    color: '#111827',
    fontWeight: '600',
  },
  headerRow: {
    paddingTop: 16,
    paddingHorizontal: 14,
    flexDirection: 'row',
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
  },
  progressChip: {
    marginLeft: 4,
  },
  chipText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '600',
  },
  titleWrap: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
  },
  title: {
    color: '#111827',
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    color: '#6B7280',
    fontSize: 13,
    marginTop: 4,
  },
  infoPill: {
    marginHorizontal: 14,
    marginBottom: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  infoPillText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '500',
  },
  card: {
    flex: 1,
    margin: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    padding: 8,
    minHeight: 188,
  },
  cardSelected: {
    borderColor: '#93C822',
    borderWidth: 2,
    backgroundColor: '#F7FEE7',
  },
  cardImage: {
    width: '100%',
    height: 104,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  cardImagePlaceholder: {
    backgroundColor: '#E2E8F0',
  },
  cardTitle: {
    marginTop: 7,
    color: '#111827',
    fontSize: 12,
    fontWeight: '600',
    minHeight: 34,
  },
  cardMeta: {
    marginTop: 5,
    color: '#6B7280',
    fontSize: 11,
  },
  selectedBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderRadius: 12,
    backgroundColor: '#93C822',
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  selectedBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  emptyState: {
    marginTop: 30,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  emptyStateTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyStateBody: {
    marginTop: 6,
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
  },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  bottomTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
  },
  bottomDescription: {
    marginTop: 4,
    color: '#6B7280',
    fontSize: 13,
    lineHeight: 18,
  },
  selectedRow: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectedThumb: {
    width: 52,
    height: 52,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  selectedTitle: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  selectedMeta: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 3,
  },
  bottomActionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  primaryButton: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: '#93C822',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  secondaryButtonText: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '600',
  },
  refineInput: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    color: '#111827',
    fontSize: 13,
    minHeight: 82,
    textAlignVertical: 'top',
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  linkButton: {
    marginTop: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  linkButtonText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.55,
  },
});

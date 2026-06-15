import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config/env';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { RouteProp, useNavigation } from '@react-navigation/native';
import { FlashList } from '@shopify/flash-list';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { AppStackParamList } from '../navigation/AppNavigator';
import { ensureSupabaseJwt } from '../lib/supabase';
import { Boxes } from 'lucide-react-native';
import BackButton from '../components/BackButton';
import BottomNav from '../components/BottomNav';
import ItemJobsModal from '../components/ItemJobsModal';

const BASE_URL = API_BASE_URL;
const GRID_COLUMNS = 3;

type ScreenRoute = RouteProp<AppStackParamList, 'MatchSelectionScreen'>;

export interface JobResponse {
  jobId: string;
  status?: string;
  estimatedTimeMinutes?: number;
  totalProducts?: number;
  message?: string;
}

type Candidate = {
  title?: string;
  link?: string;
  source?: string;
  thumbnail?: string;
  image?: string;
};

type MatchResult = {
  productIndex: number;
  serpApiData?: Candidate[];
  rerankedResults?: Array<{
    serpApiIndex?: number;
    score?: number;
    title?: string;
    link?: string;
  }>;
  matchDecision?: 'matched' | 'classified' | 'needs_user_input' | string;
  matchDecisionReason?: string;
  userAssist?: {
    required?: boolean;
    prompt?: string;
    requestId?: string;
  };
  originalTargetImage?: string;
};

type MatchStatusPayload = {
  jobId: string;
  status: string;
  currentStage?: string;
  results: MatchResult[];
};

const getToken = async () => ensureSupabaseJwt();

function reorderCandidates(result?: MatchResult | null): Candidate[] {
  if (!result) return [];
  const base = Array.isArray(result.serpApiData) ? result.serpApiData : [];
  const reranked = Array.isArray(result.rerankedResults) ? result.rerankedResults : [];
  if (!base.length || !reranked.length) return base;

  const ordered: Candidate[] = [];
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

function sourceLabel(candidate?: Candidate): string {
  const rawSource = String(candidate?.source || '').trim();
  if (rawSource.length > 0) return rawSource;
  try {
    const host = candidate?.link ? new URL(candidate.link).hostname.replace('www.', '') : '';
    return host || 'web';
  } catch {
    return 'web';
  }
}

function buildInitialAnalysis(params: any): MatchStatusPayload | null {
  const results = params?.response?.analysis?.results || params?.response?.jobResults || params?.overrideResults;
  if (!Array.isArray(results) || results.length === 0) return null;

  return {
    jobId: params?.jobId || params?.response?.analysis?.jobId || params?.response?.jobId || 'local',
    status: params?.response?.analysis?.status || 'processing',
    currentStage: params?.response?.analysis?.currentStage,
    results,
  };
}

export default function MatchSelectionScreen({ route }: { route: ScreenRoute }) {
  const navigation = useNavigation<any>();
  const params = (route.params || {}) as any;

  const jobId: string | undefined = params.jobId || params?.response?.jobId || params?.jobResponse?.jobId;
  const returnToLoadingRef = useRef<any>(params.returnToLoading);

  const initialAnalysisRef = useRef<MatchStatusPayload | null>(buildInitialAnalysis(params));
  const initialFocusRef = useRef<number>(
    typeof params.focusIndex === 'number'
      ? params.focusIndex
      : (typeof params.overrideFocusIndex === 'number' ? params.overrideFocusIndex : 0)
  );

  const initialPreResolvedRef = useRef<Record<number, number[]>>(params.preResolvedSelections || {});
  const initialPreDeniedRef = useRef<Record<number, number[]>>(params.preDeniedSelections || {});
  const initialPreRefineRef = useRef<Record<number, string>>(params.preRefineTextByIndex || {});

  const [isLoading, setIsLoading] = useState<boolean>(() => !initialAnalysisRef.current);
  const [error, setError] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>(initialAnalysisRef.current?.status || 'queued');
  const [analysisData, setAnalysisData] = useState<MatchStatusPayload | null>(initialAnalysisRef.current);

  const [currentProductIndex, setCurrentProductIndex] = useState<number>(Math.max(0, initialFocusRef.current));
  const [selectedMatchesByIndex, setSelectedMatchesByIndex] = useState<Record<number, number[]>>({});
  const [deniedSelectionsByIndex, setDeniedSelectionsByIndex] = useState<Record<number, number[]>>({});
  const [refineTextByIndex, setRefineTextByIndex] = useState<Record<number, string>>({});
  const [, setBestGuessByIndex] = useState<Record<number, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobsModalVisible, setJobsModalVisible] = useState(false);

  const hydrationKeyRef = useRef<string | null>(null);
  const autoSelectedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const hydrationKey = `${route.key}:${jobId || 'none'}`;
    if (hydrationKeyRef.current === hydrationKey) return;
    hydrationKeyRef.current = hydrationKey;

    if (Object.keys(initialPreResolvedRef.current).length > 0) {
      setSelectedMatchesByIndex(initialPreResolvedRef.current);
    }
    if (Object.keys(initialPreDeniedRef.current).length > 0) {
      setDeniedSelectionsByIndex(initialPreDeniedRef.current);
    }
    if (Object.keys(initialPreRefineRef.current).length > 0) {
      setRefineTextByIndex(initialPreRefineRef.current);
    }

    const focusIndex = Math.max(0, initialFocusRef.current);
    setCurrentProductIndex(focusIndex);
  }, [route.key, jobId]);

  useEffect(() => {
    if (initialAnalysisRef.current?.results?.length) {
      setIsLoading(false);
      return;
    }

    if (!jobId) {
      setIsLoading(false);
      setError('Missing match job id.');
      return;
    }

    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const pollStatus = async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error('Sign-in required to continue.');

        const encodedJobId = encodeURIComponent(jobId);
        const res = await fetch(`${BASE_URL}/api/products/match/jobs/${encodedJobId}/status`, {
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

        const nextPayload: MatchStatusPayload = {
          jobId: status?.jobId || jobId,
          status: status?.status || 'processing',
          currentStage: status?.currentStage,
          results: Array.isArray(status?.results) ? status.results : [],
        };

        setJobStatus(nextPayload.status);
        setAnalysisData(nextPayload);
        setError(null);
        setIsLoading(false);

        if (!cancelled && (nextPayload.status === 'queued' || nextPayload.status === 'processing')) {
          pollTimer = setTimeout(pollStatus, 1200);
        }
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'Failed to load match status');
        setIsLoading(false);
      }
    };

    setIsLoading(true);
    void pollStatus();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [jobId]);

  const results = analysisData?.results || [];
  const safeIndex = useMemo(() => {
    if (!results.length) return 0;
    return Math.min(Math.max(currentProductIndex, 0), results.length - 1);
  }, [currentProductIndex, results.length]);

  useEffect(() => {
    if (!results.length) return;
    setCurrentProductIndex((prev) => {
      const next = Math.min(Math.max(prev, 0), results.length - 1);
      return next === prev ? prev : next;
    });
  }, [results.length]);

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

  useEffect(() => {
    if (!currentResult || candidates.length === 0) return;
    if (autoSelectedRef.current.has(safeIndex)) return;

    if ((selectedMatchesByIndex[safeIndex] || []).length > 0) {
      autoSelectedRef.current.add(safeIndex);
      return;
    }

    autoSelectedRef.current.add(safeIndex);
    setSelectedMatchesByIndex((prev) => ({ ...prev, [safeIndex]: [0] }));
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
      continueToGenerate: input.action !== 'deny',
    };

    if (typeof currentResult?.userAssist?.requestId === 'string' && currentResult.userAssist.requestId.length > 0) {
      body.requestId = currentResult.userAssist.requestId;
    }
    if (typeof input.candidateIndex === 'number') body.candidateIndex = input.candidateIndex;
    if (Array.isArray(input.deniedCandidateIndices)) body.deniedCandidateIndices = input.deniedCandidateIndices;
    if (typeof input.refineText === 'string' && input.refineText.trim().length > 0) body.refineText = input.refineText.trim();
    if (input.generateBestGuess === true) body.generateBestGuess = true;

    const encodedJobId = encodeURIComponent(jobId);
    const res = await fetch(`${BASE_URL}/api/products/match/jobs/${encodedJobId}/product/${safeIndex}/assist-response`, {
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
        return {
          ...prev,
          results: nextResults,
          status: data?.status || prev.status,
          currentStage: data?.currentStage || prev.currentStage,
        };
      });
    }
  }, [currentResult, jobId, safeIndex]);

  const navigateBackToLoading = useCallback((decisionPatch: Record<string, any>) => {
    const returnToLoading = returnToLoadingRef.current;
    if (!returnToLoading) {
      if (!jobId) {
        navigation.goBack();
        return;
      }

      navigation.replace('LoadingScreen', {
        processType: 'match',
        payload: {
          jobId,
          firstPhotos: [],
          userAssistDecisions: {
            [safeIndex]: {
              ...decisionPatch,
              state: 'submitted',
            },
          },
          resumeFromAssist: true,
          assistTransitionToken: `${Date.now()}`,
          assistSourceItemIndex: safeIndex,
          skipMatchSelection: true,
        },
        onCompleteRoute: {
          screen: 'GenerateDetailsScreen',
          params: {
            matchJobId: jobId,
            focusIndex: safeIndex,
          },
        },
      } as any);
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
  }, [jobId, navigation, safeIndex]);

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
  }, [navigateBackToLoading, selectedIndex, submitAssistResponse]);

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
      // Non-blocking: local denial still applies.
    }
  }, [deniedSelectionsByIndex, safeIndex, selectedIndex, submitAssistResponse]);

  const handleSubmitRefine = useCallback(async (value: string) => {
    const normalizedValue = value.trim();
    setRefineTextByIndex((prev) => ({ ...prev, [safeIndex]: normalizedValue }));

    if (!normalizedValue) {
      Alert.alert('Add details', 'Enter a detail like barcode, model, or visible text.');
      return;
    }

    try {
      setIsSubmitting(true);
      await submitAssistResponse({ action: 'refine', refineText: normalizedValue });
      navigateBackToLoading({ refineText: normalizedValue });
    } catch (err: any) {
      Alert.alert('Could not submit details', err?.message || 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [navigateBackToLoading, safeIndex, submitAssistResponse]);

  const handleInlineRefineChange = useCallback((value: string) => {
    setRefineTextByIndex((prev) => ({ ...prev, [safeIndex]: value }));
  }, [safeIndex]);

  const handleReselectMatches = useCallback(() => {
    if (visibleCandidates.length === 0 && candidates.length === 0) {
      Alert.alert('No matches available', 'There are no match candidates available to reselect.');
      return;
    }

    if (visibleCandidates.length === 0 && candidates.length > 0) {
      setDeniedSelectionsByIndex((prev) => ({ ...prev, [safeIndex]: [] }));
      setSelectedMatchesByIndex((prev) => ({ ...prev, [safeIndex]: [0] }));
      return;
    }

    const firstVisible = visibleCandidates[0];
    if (firstVisible && typeof firstVisible.originalIndex === 'number') {
      setSelectedMatchesByIndex((prev) => ({ ...prev, [safeIndex]: [firstVisible.originalIndex] }));
    }
  }, [candidates.length, safeIndex, visibleCandidates]);

  const handleBestGuess = useCallback(async () => {
    try {
      setIsSubmitting(true);
      setBestGuessByIndex((prev) => ({ ...prev, [safeIndex]: true }));
      await submitAssistResponse({ action: 'best_guess', generateBestGuess: true });
      navigateBackToLoading({ bestGuess: true });
    } catch (err: any) {
      Alert.alert('Could not continue', err?.message || 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [navigateBackToLoading, safeIndex, submitAssistResponse]);

  const footerState: 'match_confirm' | 'match_assist_input' = selectedCandidate ? 'match_confirm' : 'match_assist_input';
  const selectedPreview = selectedCandidate ? {
    thumb: selectedCandidate.thumbnail || selectedCandidate.image,
    title: selectedCandidate.title || 'Untitled listing',
    source: sourceLabel(selectedCandidate),
  } : null;
  const jobsModalItems = useMemo(() => {
    return results.map((result, index) => {
      const top = result?.rerankedResults?.[0] || result?.serpApiData?.[0];
      const topImage = (top as any)?.thumbnail || (top as any)?.image;
      return {
        index,
        title: top?.title || `Item ${index + 1}`,
        thumb: result?.originalTargetImage || topImage || '',
        matchesCount: Array.isArray(result?.serpApiData) ? result.serpApiData.length : 0,
      };
    });
  }, [results]);

  if (isLoading) {
    return (
      <View style={styles.centeredContainer}>
        <ActivityIndicator size="large" color={BRAND_PRIMARY} />
        <Text style={styles.loadingText}>Loading match candidates...</Text>
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

  const totalItems = Math.max(results.length, 1);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <BackButton onPress={() => navigation.goBack()} />
        <TouchableOpacity style={styles.jobsButton} onPress={() => setJobsModalVisible(true)}>
          <Boxes size={17} color="#111827" />
          <Text style={styles.jobsButtonText}>Current Jobs</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.titleWrap}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, justifyContent: 'flex-start' }}>
          {currentResult?.originalTargetImage ? (
            <Image source={{ uri: currentResult.originalTargetImage }} style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: '#E2E8F0' }} />
          ) : (
            <View style={{ width: 44, height: 44, borderRadius: 8, backgroundColor: '#E2E8F0' }} />
          )}
          <View>
            <Text style={styles.title}>Select Best Matching Listing</Text>
            <Text style={styles.subtitle}>Item {safeIndex + 1} of {totalItems} • {jobStatus}</Text>
          </View>
        </View>
      </View>

      <FlashList
        data={visibleCandidates}
        numColumns={GRID_COLUMNS}
        keyExtractor={(entry, index) => entry.candidate.link || `${entry.originalIndex}-${index}`}
        contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 280 }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>No candidate matches left</Text>
            <Text style={styles.emptyStateBody}>Add details below or continue with best guess.</Text>
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

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={styles.footerKeyboardWrap}
      >
        <BottomNav
          state={footerState}
          selectedCount={typeof selectedIndex === 'number' ? 1 : 0}
          selectedTemplate={null}
          selectedPlatforms={[]}
          isConnected={() => true}
          onShowSelection={() => { }}
          onShowTemplates={() => { }}
          onShowPlatforms={() => { }}
          onBackToEmpty={() => { }}
          onBackToSelection={() => { }}
          onOpenTemplateModal={() => { }}
          onTemplateSelect={() => { }}
          onPlatformToggle={() => { }}
          onGeneratePress={() => { }}
          matchSelectedItem={selectedPreview}
          matchPrompt={currentResult?.userAssist?.prompt}
          matchInputValue={refineTextByIndex[safeIndex] || ''}
          onMatchInputChange={handleInlineRefineChange}
          onMatchConfirm={() => { void handleConfirm(); }}
          onMatchDeny={() => { void handleDenySelected(); }}
          onMatchSubmitDetails={(text) => { void handleSubmitRefine(text); }}
          onMatchBestGuess={() => { void handleBestGuess(); }}
          onMatchReselect={handleReselectMatches}
          matchSubmitting={isSubmitting}
        />
      </KeyboardAvoidingView>

      <ItemJobsModal
        visible={jobsModalVisible}
        onClose={() => setJobsModalVisible(false)}
        items={jobsModalItems}
        currentIndex={safeIndex}
        scanColor={() => '#10B981'}
        matchColor={() => '#10B981'}
        detailsColor={(idx) => (idx === safeIndex ? BRAND_PRIMARY : '#94A3B8')}
        detailsEnabled={() => true}
        onPickScan={(idx) => {
          setCurrentProductIndex(idx);
          setJobsModalVisible(false);
        }}
        onPickMatch={(idx) => {
          setCurrentProductIndex(idx);
          setJobsModalVisible(false);
        }}
        onPickDetails={(idx) => {
          setCurrentProductIndex(idx);
          setJobsModalVisible(false);
        }}
        getSecondaryText={(idx) => {
          const item = results[idx];
          if (!item) return 'Queued';
          if (item?.matchDecision === 'needs_user_input') return 'Needs your input';
          if (item?.matchDecision === 'matched' || item?.matchDecision === 'classified') return 'Ready';
          return 'Analyzing';
        }}
      />
    </View>
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
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },
  headerRow: {
    marginTop: 64,
    marginHorizontal: 14,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  jobsButton: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: 'rgba(255,255,255,0.9)',
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    gap: 6,
  },
  jobsButtonText: {
    color: '#000',
    fontSize: 15,
    fontWeight: '600',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  progressChip: {
    backgroundColor: '#F8FAFC',
  },
  chipText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '700',
  },
  titleWrap: {
    paddingHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
  },
  title: {
    color: '#111827',
    fontSize: 19,
    fontWeight: '700',
  },
  subtitle: {
    color: '#6B7280',
    fontSize: 12,
    marginTop: 2,
  },
  infoPill: {
    marginHorizontal: 16,
    marginBottom: 6,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  infoPillText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '500',
  },
  card: {
    flex: 1,
    marginHorizontal: 4,
    marginVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    padding: 8,
    minHeight: 172,
  },
  cardSelected: {
    borderColor: BRAND_PRIMARY,
    backgroundColor: '#F7FEE7',
  },
  cardImage: {
    width: '100%',
    height: 92,
    borderRadius: 8,
    marginBottom: 6,
  },
  cardImagePlaceholder: {
    width: '100%',
    height: 92,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
    marginBottom: 6,
  },
  cardTitle: {
    color: '#111827',
    fontSize: 11,
    fontWeight: '600',
  },
  cardMeta: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 3,
  },
  selectedBadge: {
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#65A30D',
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  selectedBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  emptyState: {
    paddingHorizontal: 18,
    paddingVertical: 20,
  },
  emptyStateTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyStateBody: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 6,
  },
  footerKeyboardWrap: {
    width: '100%',
  },
});

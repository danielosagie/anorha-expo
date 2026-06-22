import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { API_BASE_URL } from '../config/env';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Animated,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { Boxes } from 'lucide-react-native';
import { AppStackParamList } from '../navigation/AppNavigator';
import PyramidGrid from '../components/PyramidGrid';
import StepLoader from '../components/StepLoader';
import ItemJobsModal from '../components/ItemJobsModal';
import { ensureSupabaseJwt } from '../lib/supabase';
import { SessionContext } from '../context/SessionContext';
import { BulkJobActivityProps } from '../live-activities/BulkJobActivity';
import { useLiveActivity } from '../context/LiveActivityContext';
import {
  ActiveFlowStatus,
  clearActiveFlowCheckpoint,
  saveActiveFlowCheckpoint,
} from '../utils/activeFlowPersistence';

type LoadingScreenProps = StackScreenProps<AppStackParamList, 'LoadingScreen'>;

type LoadingInteractionState =
  | 'passive_loading'
  | 'assist_transition_up'
  | 'assist_ready'
  | 'assist_route_out'
  | 'resume_transition_down';

type MatchResult = {
  productIndex?: number;
  title?: string;
  error?: string;
  matchDecision?: 'matched' | 'classified' | 'needs_user_input' | string;
  matchDecisionReason?: string;
  processingState?: 'ready_for_generate' | 'awaiting_user_input' | 'user_resolved' | 'blocked' | string;
  userAssist?: {
    required?: boolean;
    prompt?: string;
    requestId?: string;
  };
  matchRows?: any[];
  rerankedResults?: any[];
  skipToGenerate?: boolean;
  autoGenerateJobId?: string;
  originalTargetImage?: string;
};

type JobSnapshot = {
  jobId?: string;
  status?: string;
  currentStage?: string;
  completedAt?: string;
  summary?: any[];
  results?: MatchResult[];
  progress?: {
    currentProductIndex?: number;
    completedProducts?: number;
    totalProducts?: number;
    stagePercentage?: number;
  };
  error?: string;
};

const BASE_URL = API_BASE_URL;

const STAGES_BY_PROCESS: Record<'match' | 'generate' | 'match-and-generate', string[]> = {
  match: [
    'Indexing web pages',
    'Found products...',
    'Cleaning product list',
    'Pulling images',
    'Creating grid',
    'Ready to review',
  ],
  generate: [
    'Indexing web pages',
    'Finding product data',
    'Cleaning data',
    'Generating listing',
    'Creating view',
    'Ready to review',
  ],
  'match-and-generate': [
    'Analyzing item',
    'Searching for product',
    'Ranking results',
    'Building details',
    'Assembling listing',
    'Ready to review',
  ],
};

const MATCH_STAGE_MAP: Record<string, string> = {
  Preparing: 'Indexing web pages',
  'Analyzing...': 'Analyzing item',
  'Searching...': 'Searching for product',
  'Ranking results...': 'Ranking results',
  'Found products...': 'Found products...',
  'Cleaning product list': 'Cleaning product list',
  'Pulling images': 'Pulling images',
  'Creating grid': 'Creating grid',
  Ready: 'Ready to review',
  'Ready to review': 'Ready to review',
  'Waiting for user context': 'Ranking results',
};

const GENERATE_STAGE_MAP: Record<string, string> = {
  Preparing: 'Indexing web pages',
  'Fetching sources': 'Finding product data',
  'Scraping sources': 'Cleaning data',
  'Generating details': 'Generating listing',
  'Saving drafts': 'Creating view',
  Ready: 'Ready to review',
  'Ready to review': 'Ready to review',
};

const toPhotoUri = (photo: any): string => {
  if (typeof photo === 'string') return photo;
  return photo?.uri || photo?.url || '';
};

const isAssistRequired = (result: MatchResult | null | undefined, allowEmptyFallback = false): boolean => {
  if (!result) return false;
  if (result.userAssist?.required) return true;
  if (String(result.matchDecision || '').toLowerCase() === 'needs_user_input') return true;
  if (String(result.processingState || '').toLowerCase() === 'awaiting_user_input') return true;
  if (!allowEmptyFallback) return false;
  const candidates = Array.isArray(result.matchRows) ? result.matchRows : [];
  const reranked = Array.isArray(result.rerankedResults) ? result.rerankedResults : [];
  return candidates.length === 0 && reranked.length === 0;
};

const findAutoGenerateResult = (results: MatchResult[]): MatchResult | null => {
  if (!Array.isArray(results) || results.length === 0) return null;
  return results.find((result) => result?.skipToGenerate && result?.autoGenerateJobId) || null;
};

const clampIndex = (index: number, length: number): number => {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
};

const deriveActiveFlowStatus = (
  snapshot: JobSnapshot | null,
  fallbackStatus: string,
): ActiveFlowStatus => {
  const status = String(snapshot?.status || fallbackStatus || 'processing').toLowerCase();
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'queued') return 'queued';

  const results = Array.isArray(snapshot?.results) ? snapshot?.results : [];
  const awaitingAssist = results.some((result) => isAssistRequired(result, true));
  if (awaitingAssist) return 'awaiting_user_input';
  return 'processing';
};

const buildPreDecisionMaps = (decisions: AppStackParamList['LoadingScreen']['payload']['userAssistDecisions']) => {
  const preResolvedSelections: Record<number, number[]> = {};
  const preDeniedSelections: Record<number, number[]> = {};
  const preRefineTextByIndex: Record<number, string> = {};
  const bestGuessByIndex: Record<number, boolean> = {};

  Object.entries(decisions || {}).forEach(([key, value]) => {
    const index = Number(key);
    if (!Number.isFinite(index) || !value) return;
    if (typeof value.confirmedCandidateIndex === 'number') {
      preResolvedSelections[index] = [value.confirmedCandidateIndex];
    }
    if (Array.isArray(value.deniedCandidateIndices) && value.deniedCandidateIndices.length > 0) {
      preDeniedSelections[index] = value.deniedCandidateIndices;
    }
    if (typeof value.refineText === 'string' && value.refineText.trim().length > 0) {
      preRefineTextByIndex[index] = value.refineText.trim();
    }
    if (value.generateBestGuess === true) {
      bestGuessByIndex[index] = true;
    }
  });

  return {
    preResolvedSelections: Object.keys(preResolvedSelections).length ? preResolvedSelections : undefined,
    preDeniedSelections: Object.keys(preDeniedSelections).length ? preDeniedSelections : undefined,
    preRefineTextByIndex: Object.keys(preRefineTextByIndex).length ? preRefineTextByIndex : undefined,
    bestGuessByIndex: Object.keys(bestGuessByIndex).length ? bestGuessByIndex : undefined,
  };
};

const remapResultIndices = (
  snapshot: JobSnapshot,
  resultIndexMap?: Record<number, number>,
): JobSnapshot => {
  if (!resultIndexMap || !Array.isArray(snapshot?.results) || snapshot.results.length === 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    results: snapshot.results.map((result, index) => {
      const currentIndex = typeof result?.productIndex === 'number' ? result.productIndex : index;
      const mappedIndex = resultIndexMap[currentIndex];
      if (typeof mappedIndex !== 'number') {
        return result;
      }

      return {
        ...result,
        productIndex: mappedIndex,
      };
    }),
  };
};

const LoadingScreen: React.FC<LoadingScreenProps> = ({ route, navigation }) => {
  const { processType, payload, onCompleteRoute } = route.params;
  const session = useContext(SessionContext);
  const { updateBulkJobActivity, endBulkJobActivity } = useLiveActivity();

  const jobId = payload?.jobId;
  const firstPhotos = Array.isArray(payload?.firstPhotos) ? payload.firstPhotos : [];
  const bulkItems = Array.isArray(payload?.bulkItems) ? payload.bulkItems : [];

  const activeStages = STAGES_BY_PROCESS[processType] || STAGES_BY_PROCESS.match;

  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [jobStatus, setJobStatus] = useState('queued');
  const [latestJobSnapshot, setLatestJobSnapshot] = useState<JobSnapshot | null>(null);
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [jobsModalVisible, setJobsModalVisible] = useState(false);
  const [interactionState, setInteractionState] = useState<LoadingInteractionState>('passive_loading');
  const [pollWarning, setPollWarning] = useState<string | null>(null);

  const assistProgress = useRef(new Animated.Value(payload?.resumeFromAssist ? 1 : 0)).current;
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const assistRouteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPollingRef = useRef(false);
  const hasNavigatedRef = useRef(false);
  const lastAssistRouteKeyRef = useRef<string | null>(null);
  const handledResumeTokenRef = useRef<string | null>(null);
  const resumeGraceUntilRef = useRef<number>(0);

  const payloadRef = useRef(payload);
  const onCompleteRouteRef = useRef(onCompleteRoute);
  const snapshotRef = useRef<JobSnapshot | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const pollNowRef = useRef<null | (() => Promise<void>)>(null);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    onCompleteRouteRef.current = onCompleteRoute;
  }, [onCompleteRoute]);

  useEffect(() => {
    snapshotRef.current = latestJobSnapshot;
  }, [latestJobSnapshot]);

  const clearPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  const clearAssistTimer = useCallback(() => {
    if (assistRouteTimerRef.current) {
      clearTimeout(assistRouteTimerRef.current);
      assistRouteTimerRef.current = null;
    }
  }, []);

  const clearActiveCheckpoint = useCallback(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    void clearActiveFlowCheckpoint(userId);
  }, [session?.user?.id]);

  const replaceOnce = useCallback((screen: keyof AppStackParamList, params: Record<string, any>) => {
    if (hasNavigatedRef.current) return;
    hasNavigatedRef.current = true;
    clearPolling();
    clearAssistTimer();
    navigation.replace(screen as never, params as never);
  }, [clearAssistTimer, clearPolling, navigation]);

  const mapStageToIndex = useCallback((stage: string | undefined): number => {
    if (!stage) return -1;
    const mapped = processType === 'generate'
      ? (GENERATE_STAGE_MAP[stage] || stage)
      : (MATCH_STAGE_MAP[stage] || stage);
    const index = activeStages.indexOf(mapped);
    return index >= 0 ? index : -1;
  }, [activeStages, processType]);

  const formatLiveActivityStage = useCallback((stage: string | undefined) => {
    if (!stage) return 'Processing';
    return processType === 'generate'
      ? (GENERATE_STAGE_MAP[stage] || stage)
      : (MATCH_STAGE_MAP[stage] || stage);
  }, [processType]);

  const buildLiveActivityProps = useCallback((snapshot: JobSnapshot | null): BulkJobActivityProps | null => {
    if (!snapshot) return null;

    const total = Number(snapshot.progress?.totalProducts ?? 0);
    if (!Number.isFinite(total) || total <= 0) return null;

    const completed = Number(snapshot.progress?.completedProducts ?? 0);
    const currentIndex = Number.isFinite(snapshot.progress?.currentProductIndex)
      ? Number(snapshot.progress?.currentProductIndex)
      : Math.min(completed, total - 1);
    const current = Math.min(Math.max(currentIndex + 1, 1), total);

    const stagePercentage = Number(snapshot.progress?.stagePercentage);
    const progress = Number.isFinite(stagePercentage)
      ? Math.min(Math.max(stagePercentage / 100, 0), 1)
      : Math.min(Math.max(completed / total, 0), 1);

    const title = processType === 'generate' ? 'Generating items' : 'Matching items';
    const titleShort = processType === 'generate' ? 'Gen' : 'Match';

    return {
      title,
      titleShort,
      stage: formatLiveActivityStage(snapshot.currentStage),
      current,
      total,
      progress,
    };
  }, [formatLiveActivityStage, processType]);

  // Moved below buildLiveActivityProps to avoid a temporal-dead-zone crash on web.
  useEffect(() => {
    if (!jobId) return;
    const nextProps = buildLiveActivityProps(latestJobSnapshot);
    const statusValue = String(latestJobSnapshot?.status || jobStatus || '').toLowerCase();
    const jobType = processType === 'generate' ? 'generate' : 'match';

    if (nextProps) {
      updateBulkJobActivity(jobId, jobType, nextProps);
    }

    if (statusValue === 'completed' || statusValue === 'failed' || statusValue === 'cancelled') {
      endBulkJobActivity(jobId);
    }
  }, [buildLiveActivityProps, endBulkJobActivity, jobId, jobStatus, latestJobSnapshot, processType, updateBulkJobActivity]);

  const buildGenerateItems = useCallback((results: MatchResult[]) => {
    const sourceBulk = Array.isArray(payloadRef.current?.bulkItems) ? payloadRef.current?.bulkItems : [];
    if (sourceBulk.length > 0) {
      return sourceBulk.map((item: any, index: number) => {
        const result = results[index];
        const top = result?.rerankedResults?.[0] || result?.matchRows?.[0];
        const firstPhoto = Array.isArray(item?.photos) ? item.photos[0] : null;
        return {
          index,
          title: top?.title || item?.title || `Item ${index + 1}`,
          thumb: toPhotoUri(firstPhoto),
          matchesCount: Array.isArray(result?.matchRows) ? result.matchRows.length : 0,
        };
      });
    }

    const sourcePhotos = Array.isArray(payloadRef.current?.firstPhotos) ? payloadRef.current?.firstPhotos : [];
    return sourcePhotos.map((photo: any, index: number) => {
      const result = results[index];
      const top = result?.rerankedResults?.[0] || result?.matchRows?.[0];
      return {
        index,
        title: top?.title || `Item ${index + 1}`,
        thumb: toPhotoUri(photo),
        matchesCount: Array.isArray(result?.matchRows) ? result.matchRows.length : 0,
      };
    });
  }, []);

  const buildUserImagesByIndex = useCallback(() => {
    const existing = (onCompleteRouteRef.current?.params as any)?.userImagesByIndex;
    if (existing && typeof existing === 'object' && Object.keys(existing).length > 0) {
      return existing;
    }

    const imagesByIndex: Record<number, string[]> = {};
    const sourceBulk = Array.isArray(payloadRef.current?.bulkItems) ? payloadRef.current?.bulkItems : [];
    sourceBulk.forEach((item: any, index: number) => {
      const photos = Array.isArray(item?.photos) ? item.photos : [];
      const uris = photos.map((photo: any) => toPhotoUri(photo)).filter((uri: string) => uri.length > 0);
      if (uris.length > 0) imagesByIndex[index] = Array.from(new Set(uris));
    });

    return imagesByIndex;
  }, []);

  const buildGenerateFirstPhotos = useCallback((result: MatchResult | null): any[] => {
    const existing = Array.isArray(payloadRef.current?.firstPhotos) ? payloadRef.current?.firstPhotos : [];
    if (existing.length > 0) return existing;

    const fallback = [
      result?.originalTargetImage,
      result?.matchRows?.[0]?.image,
      result?.matchRows?.[0]?.thumbnail,
      result?.rerankedResults?.[0]?.image,
      result?.rerankedResults?.[0]?.thumbnail,
    ].filter((uri) => typeof uri === 'string' && uri.length > 0);

    return Array.from(new Set(fallback));
  }, []);

  const normalizeSnapshot = useCallback((snapshot: JobSnapshot) => {
    return remapResultIndices(snapshot, payloadRef.current?.resultIndexMap);
  }, []);

  const openAssistFlow = useCallback((assistIndex: number, snapshot: JobSnapshot, reasonKey: string) => {
    if (hasNavigatedRef.current) return;

    const result = Array.isArray(snapshot?.results) ? snapshot.results[assistIndex] : null;
    const requestId = String(result?.userAssist?.requestId || 'none');
    const routeKey = `${snapshot?.jobId || payloadRef.current?.jobId || 'job'}:${assistIndex}:${requestId}:${reasonKey}`;

    if (lastAssistRouteKeyRef.current === routeKey) return;

    const inResumeWindow = Date.now() < resumeGraceUntilRef.current;
    const resumeIndex = payloadRef.current?.assistSourceItemIndex;
    if (inResumeWindow && typeof resumeIndex === 'number' && resumeIndex === assistIndex) {
      return;
    }

    lastAssistRouteKeyRef.current = routeKey;
    setSelectedItemIndex(assistIndex);
    setInteractionState('assist_transition_up');

    Animated.spring(assistProgress, {
      toValue: 1,
      tension: 120,
      friction: 14,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished || hasNavigatedRef.current) return;
      setInteractionState('assist_ready');

      clearAssistTimer();
      assistRouteTimerRef.current = setTimeout(() => {
        if (hasNavigatedRef.current) return;
        setInteractionState('assist_route_out');

        const currentPayload = payloadRef.current || ({} as AppStackParamList['LoadingScreen']['payload']);
        const prefillMaps = buildPreDecisionMaps(currentPayload.userAssistDecisions);
        const returnToLoading: AppStackParamList['LoadingScreen'] = {
          processType,
          payload: {
            ...currentPayload,
            jobId: snapshot?.jobId || currentPayload.jobId,
            assistTransitionToken: `${Date.now()}`,
            assistSourceItemIndex: assistIndex,
          },
          onCompleteRoute: onCompleteRouteRef.current,
        };

        navigation.replace('MatchSelectionScreen', {
          jobId: snapshot?.jobId || currentPayload.jobId,
          focusIndex: assistIndex,
          overrideResults: Array.isArray(snapshot?.results) ? snapshot.results : undefined,
          response: {
            jobId: snapshot?.jobId || currentPayload.jobId,
            jobResults: Array.isArray(snapshot?.results) ? snapshot.results : [],
          },
          returnToLoading,
          ...prefillMaps,
        } as any);
      }, 240);
    });
  }, [assistProgress, clearAssistTimer, navigation, processType]);

  const handleMatchCompletion = useCallback((snapshot: JobSnapshot) => {
    const normalizedSnapshot = normalizeSnapshot(snapshot);
    const results = Array.isArray(normalizedSnapshot?.results) ? normalizedSnapshot.results : [];
    const autoGenerateResult = findAutoGenerateResult(results);
    const seededParams = ((onCompleteRouteRef.current?.params as any) || {}) as Record<string, any>;
    const seededItems = Array.isArray(seededParams.items) && seededParams.items.length > 0
      ? seededParams.items
      : buildGenerateItems(results);
    const seededJobMap = seededParams.jobMap && typeof seededParams.jobMap === 'object'
      ? seededParams.jobMap
      : {};
    const seededUserImagesByIndex = seededParams.userImagesByIndex && typeof seededParams.userImagesByIndex === 'object'
      ? seededParams.userImagesByIndex
      : buildUserImagesByIndex();
    const seededMatchJobId = seededParams.matchJobId || normalizedSnapshot?.jobId || payloadRef.current?.jobId;

    if (autoGenerateResult?.autoGenerateJobId) {
      const generateJobId = autoGenerateResult.autoGenerateJobId;
      replaceOnce('LoadingScreen', {
        processType: 'generate',
        payload: {
          jobId: generateJobId,
          firstPhotos: buildGenerateFirstPhotos(autoGenerateResult),
          bulkItems: payloadRef.current?.bulkItems,
          userAssistDecisions: payloadRef.current?.userAssistDecisions,
        },
        onCompleteRoute: {
          screen: 'GenerateDetailsScreen',
          params: {
            jobId: generateJobId,
            matchJobId: seededMatchJobId,
            items: seededItems,
            jobMap: seededJobMap,
            userImagesByIndex: seededUserImagesByIndex,
          },
        },
      });
      return;
    }

    const fallbackRoute = onCompleteRouteRef.current;
    if (fallbackRoute?.screen && fallbackRoute.screen !== 'MatchSelectionScreen') {
      clearActiveCheckpoint();
      replaceOnce(fallbackRoute.screen, {
        ...fallbackRoute.params,
        jobId: normalizedSnapshot?.jobId || payloadRef.current?.jobId,
        status: normalizedSnapshot?.status || 'completed',
        results,
        summary: normalizedSnapshot?.summary || [],
        completedAt: normalizedSnapshot?.completedAt || new Date().toISOString(),
      });
      return;
    }

    clearActiveCheckpoint();
    replaceOnce('GenerateDetailsScreen', {
      jobId: normalizedSnapshot?.jobId || payloadRef.current?.jobId || '',
      status: 'completed',
      results: [],
      summary: [],
      completedAt: normalizedSnapshot?.completedAt || new Date().toISOString(),
      matchJobId: seededMatchJobId,
      items: seededItems,
      jobMap: seededJobMap,
      userImagesByIndex: seededUserImagesByIndex,
      focusIndex: 0,
    });
  }, [buildGenerateFirstPhotos, buildGenerateItems, buildUserImagesByIndex, clearActiveCheckpoint, normalizeSnapshot, replaceOnce]);

  const handleGenerateCompletion = useCallback((snapshot: JobSnapshot) => {
    const fallbackRoute = onCompleteRouteRef.current;

    if (fallbackRoute?.screen) {
      clearActiveCheckpoint();
      replaceOnce(fallbackRoute.screen, {
        ...fallbackRoute.params,
        jobId: snapshot?.jobId || payloadRef.current?.jobId,
        status: snapshot?.status || 'completed',
        results: Array.isArray(snapshot?.results) ? snapshot.results : [],
        summary: snapshot?.summary || [],
        completedAt: snapshot?.completedAt || new Date().toISOString(),
      });
      return;
    }

    clearActiveCheckpoint();
    replaceOnce('GenerateDetailsScreen', {
      jobId: snapshot?.jobId || payloadRef.current?.jobId || '',
      status: snapshot?.status || 'completed',
      results: Array.isArray(snapshot?.results) ? snapshot.results : [],
      summary: snapshot?.summary || [],
      completedAt: snapshot?.completedAt || new Date().toISOString(),
    });
  }, [clearActiveCheckpoint, replaceOnce]);

  useEffect(() => {
    if (!payload?.resumeFromAssist) return;

    const token = String(payload.assistTransitionToken || `${route.key}:resume`);
    if (handledResumeTokenRef.current === token) return;
    handledResumeTokenRef.current = token;

    resumeGraceUntilRef.current = Date.now() + 5000;
    if (typeof payload.assistSourceItemIndex === 'number') {
      setSelectedItemIndex(Math.max(0, payload.assistSourceItemIndex));
    }

    setInteractionState('resume_transition_down');
    assistProgress.setValue(1);
    Animated.spring(assistProgress, {
      toValue: 0,
      tension: 120,
      friction: 14,
      useNativeDriver: true,
    }).start(() => {
      setInteractionState('passive_loading');
    });
  }, [assistProgress, payload.assistSourceItemIndex, payload.assistTransitionToken, payload.resumeFromAssist, route.key]);

  useEffect(() => {
    hasNavigatedRef.current = false;
    isPollingRef.current = false;
    lastAssistRouteKeyRef.current = null;

    if (!jobId) {
      setJobStatus('failed');
      return;
    }

    let cancelled = false;

    const pollStatus = async () => {
      if (cancelled || hasNavigatedRef.current || isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        const token = await ensureSupabaseJwt();
        if (!token) throw new Error('Missing auth token');

        const encodedJobId = encodeURIComponent(jobId);
        const endpoint = processType === 'generate'
          ? `${BASE_URL}/api/products/generate/jobs/${encodedJobId}/status`
          : `${BASE_URL}/api/products/match/jobs/${encodedJobId}/status`;

        const response = await fetch(endpoint, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Status poll failed (${response.status})${body ? `: ${body.slice(0, 180)}` : ''}`);
        }

        const rawSnapshot = await response.json();
        if (cancelled || hasNavigatedRef.current) return;
        const snapshot = normalizeSnapshot(rawSnapshot);

        setLatestJobSnapshot(snapshot);
        setJobStatus(String(snapshot?.status || 'processing'));
        setCurrentStageIndex((prev) => {
          const next = mapStageToIndex(snapshot?.currentStage);
          if (next < 0 || next < prev) return prev;
          return next === prev ? prev : next;
        });
        setPollWarning(null);

        const results = Array.isArray(snapshot?.results) ? snapshot.results : [];
        if (results.length > 0 && Number.isFinite(Number(snapshot?.progress?.currentProductIndex))) {
          const currentFromProgress = Number(snapshot?.progress?.currentProductIndex);
          setSelectedItemIndex((prev) => {
            const next = clampIndex(currentFromProgress, Math.max(results.length, 1));
            return next === prev ? prev : next;
          });
        }

        const statusValue = String(snapshot?.status || '').toLowerCase();

        if (processType !== 'generate') {
          const assistIndex = results.findIndex((result: MatchResult) => isAssistRequired(result, true));
          if ((statusValue === 'processing' || statusValue === 'queued') && assistIndex >= 0) {
            openAssistFlow(assistIndex, snapshot, 'backend');
          }

          if (statusValue === 'completed') {
            handleMatchCompletion(snapshot);
            return;
          }
        } else if (statusValue === 'completed') {
          handleGenerateCompletion(snapshot);
          return;
        }

        if (statusValue === 'failed') {
          clearPolling();
          setJobStatus('failed');
          Alert.alert('Process failed', snapshot?.error || 'Please retry this scan.');
        }
      } catch (error: any) {
        if (cancelled) return;
        const message = error?.message || 'Could not check progress';
        const is404 = String(message).includes('(404)');
        if (is404) {
          clearPolling();
          setJobStatus('failed');
          Alert.alert('Scan not found', 'This scan job is no longer available. Please run the scan again.', [
            {
              text: 'OK',
              onPress: () => {
                clearActiveCheckpoint();
                const currentPayload = payloadRef.current || ({} as AppStackParamList['LoadingScreen']['payload']);
                navigation.replace('AddProduct' as never, {
                  firstPhotos: Array.isArray(currentPayload.firstPhotos) ? currentPayload.firstPhotos : [],
                  bulkItems: Array.isArray(currentPayload.bulkItems) ? currentPayload.bulkItems : [],
                } as never);
              },
            },
          ]);
          return;
        }
        setPollWarning('Connection interrupted. We will resume automatically.');
      } finally {
        isPollingRef.current = false;
      }
    };

    pollNowRef.current = pollStatus;
    void pollStatus();
    pollingIntervalRef.current = setInterval(() => {
      void pollStatus();
    }, 1200);

    return () => {
      cancelled = true;
      pollNowRef.current = null;
      clearPolling();
      clearAssistTimer();
    };
  }, [
    clearAssistTimer,
    clearPolling,
    handleGenerateCompletion,
    handleMatchCompletion,
    jobId,
    mapStageToIndex,
    navigation,
    normalizeSnapshot,
    openAssistFlow,
    clearActiveCheckpoint,
    processType,
  ]);

  const loadingModalItems = useMemo(() => {
    const results = Array.isArray(latestJobSnapshot?.results) ? latestJobSnapshot.results : [];

    if (bulkItems.length > 0) {
      return bulkItems.map((item: any, index: number) => {
        const firstPhoto = Array.isArray(item?.photos) ? item.photos[0] : null;
        const top = results[index]?.rerankedResults?.[0] || results[index]?.matchRows?.[0];
        return {
          index,
          title: top?.title || item?.title || `Item ${index + 1}`,
          thumb: toPhotoUri(firstPhoto),
          matchesCount: Array.isArray(results[index]?.matchRows) ? results[index].matchRows.length : 0,
        };
      });
    }

    if (firstPhotos.length > 0) {
      return firstPhotos.map((photo: any, index: number) => {
        const top = results[index]?.rerankedResults?.[0] || results[index]?.matchRows?.[0];
        return {
          index,
          title: top?.title || `Item ${index + 1}`,
          thumb: toPhotoUri(photo),
          matchesCount: Array.isArray(results[index]?.matchRows) ? results[index].matchRows.length : 0,
        };
      });
    }

    return [{
      index: 0,
      title: 'Item 1',
      thumb: '',
      matchesCount: 0,
    }];
  }, [bulkItems, firstPhotos, latestJobSnapshot]);

  useEffect(() => {
    setSelectedItemIndex((prev) => clampIndex(prev, loadingModalItems.length));
  }, [loadingModalItems.length]);

  const selectedItem = loadingModalItems[clampIndex(selectedItemIndex, loadingModalItems.length)] || loadingModalItems[0];
  const selectedResult = useMemo(() => {
    const results = Array.isArray(latestJobSnapshot?.results) ? latestJobSnapshot.results : [];
    const safeIndex = clampIndex(selectedItemIndex, results.length);
    return results[safeIndex] || null;
  }, [latestJobSnapshot, selectedItemIndex]);

  useEffect(() => {
    if (!jobId) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackgrounded = appStateRef.current.match(/inactive|background/);
      appStateRef.current = nextState;
      if (nextState === 'active' && wasBackgrounded) {
        void pollNowRef.current?.();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [jobId]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || !jobId) return;

    const checkpointPayload: AppStackParamList['LoadingScreen']['payload'] = {
      ...(payloadRef.current || payload),
      jobId,
      firstPhotos: Array.isArray((payloadRef.current || payload)?.firstPhotos)
        ? (payloadRef.current || payload).firstPhotos
        : [],
      bulkItems: Array.isArray((payloadRef.current || payload)?.bulkItems)
        ? (payloadRef.current || payload).bulkItems
        : [],
    };

    const flowStatus = deriveActiveFlowStatus(latestJobSnapshot, jobStatus);
    void saveActiveFlowCheckpoint(userId, {
      jobId,
      processType,
      status: flowStatus,
      currentStage: latestJobSnapshot?.currentStage,
      currentProductIndex: Number.isFinite(latestJobSnapshot?.progress?.currentProductIndex)
        ? Number(latestJobSnapshot?.progress?.currentProductIndex)
        : undefined,
      payload: checkpointPayload,
      onCompleteRoute: onCompleteRouteRef.current || onCompleteRoute,
    });
  }, [jobId, jobStatus, latestJobSnapshot, onCompleteRoute, payload, processType, session?.user?.id]);

  const getItemState = useCallback((index: number) => {
    const snapshot = snapshotRef.current;
    const statusValue = String(snapshot?.status || '').toLowerCase();
    const result = Array.isArray(snapshot?.results) ? snapshot!.results![index] : null;

    if (result?.error) {
      return { match: '#EF4444', details: '#EF4444', secondary: result.error };
    }

    if (isAssistRequired(result, true)) {
      return {
        match: '#F59E0B',
        details: '#F59E0B',
        secondary: 'Awaiting decision from you',
      };
    }

    if (statusValue === 'completed' && result) {
      return { match: '#10B981', details: '#10B981', secondary: 'Ready to review' };
    }

    const currentFromProgress = Number(snapshot?.progress?.currentProductIndex ?? -1);
    if (statusValue === 'processing' && currentFromProgress === index) {
      return {
        match: '#F59E0B',
        details: '#F59E0B',
        secondary: snapshot?.currentStage || 'Processing',
      };
    }

    if (result) {
      return { match: '#10B981', details: '#64748B', secondary: 'Analyzed' };
    }

    return { match: '#94A3B8', details: '#94A3B8', secondary: 'Queued' };
  }, []);

  const openAssistFromModal = useCallback((index: number) => {
    const snapshot = snapshotRef.current;
    if (!snapshot || !Array.isArray(snapshot.results)) {
      setSelectedItemIndex(index);
      return;
    }

    const safeIndex = clampIndex(index, snapshot.results.length);
    const result = snapshot.results[safeIndex];
    if (!isAssistRequired(result, true)) {
      setSelectedItemIndex(safeIndex);
      return;
    }

    openAssistFlow(safeIndex, snapshot, 'modal');
  }, [openAssistFlow]);

  const assistPrompt = selectedResult?.userAssist?.prompt || 'Backend requested a quick decision for this item.';

  const loadingBodyTranslateY = assistProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -36],
  });
  const loadingBodyScale = assistProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.96],
  });
  const assistCardOpacity = assistProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });
  const assistCardTranslateY = assistProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [28, 0],
  });

  return (
    <View style={styles.screen}>
      <TouchableOpacity onPress={() => setJobsModalVisible(true)} style={styles.jobsButton}>
        <Boxes size={17} color="#111827" />
        <Text style={styles.jobsButtonText}>Current Jobs</Text>
      </TouchableOpacity>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.assistCard,
          {
            opacity: assistCardOpacity,
            transform: [{ translateY: assistCardTranslateY }],
          },
        ]}
      >
        <View style={styles.assistCardRow}>
          {selectedItem?.thumb ? (
            <Image source={{ uri: selectedItem.thumb }} style={styles.assistThumb} />
          ) : (
            <View style={[styles.assistThumb, styles.thumbPlaceholder]} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.assistEyebrow}>Request for help</Text>
            <Text style={styles.assistPrompt} numberOfLines={2}>{assistPrompt}</Text>
            <Text style={styles.assistMeta}>
              {interactionState === 'assist_route_out' ? 'Opening match selection...' : 'Preparing match selection...'}
            </Text>
          </View>
        </View>
        <View style={styles.assistSkeletonList}>
          <View style={styles.assistSkeletonRow} />
          <View style={styles.assistSkeletonRow} />
          <View style={[styles.assistSkeletonRow, { width: '72%' }]} />
        </View>
      </Animated.View>

      <Animated.View
        style={[
          styles.loadingBody,
          {
            transform: [
              { translateY: loadingBodyTranslateY },
              { scale: loadingBodyScale },
            ],
          },
        ]}
      >
        <PyramidGrid
          items={(firstPhotos || []).map((photo, i) => {
            const uri = typeof photo === 'string' ? photo : photo?.uri || photo?.url || String(photo);
            return { id: `img-${i}-${uri?.slice(-20) || 'empty'}`, uri };
          })}
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '35%',
            maxHeight: '45%',
            width: '90%',
            marginBottom: 18,
          }}
        />

        <Text style={styles.titleText}>
          {processType === 'generate' ? 'Searching for product' : 'Searching for product'}
        </Text>

        <StepLoader
          stages={activeStages}
          currentStageIndex={clampIndex(currentStageIndex, activeStages.length)}
          style={styles.stepLoader}
        />

        {pollWarning ? (
          <Text style={styles.pollWarningText}>{pollWarning}</Text>
        ) : null}

        {jobStatus === 'failed' && (
          <View style={styles.errorRow}>
            <ActivityIndicator size="small" color="#DC2626" />
            <Text style={styles.errorText}>Process failed. Please retry this item.</Text>
          </View>
        )}
      </Animated.View>

      <ItemJobsModal
        visible={jobsModalVisible}
        onClose={() => setJobsModalVisible(false)}
        items={loadingModalItems}
        currentIndex={clampIndex(selectedItemIndex, loadingModalItems.length)}
        scanColor={() => (jobStatus === 'failed' ? '#EF4444' : '#10B981')}
        matchColor={(index) => getItemState(index).match}
        detailsColor={(index) => getItemState(index).details}
        detailsEnabled={() => true}
        onPickScan={(index) => setSelectedItemIndex(index)}
        onPickMatch={(index) => {
          setJobsModalVisible(false);
          openAssistFromModal(index);
        }}
        onPickDetails={(index) => setSelectedItemIndex(index)}
        getSecondaryText={(index) => getItemState(index).secondary}
      />
    </View>
  );
};

export default LoadingScreen;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  jobsButton: {
    position: 'absolute',
    top: 48,
    left: 20,
    zIndex: 20,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  jobsButtonText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '700',
  },
  assistCard: {
    position: 'absolute',
    bottom: 120,
    left: 16,
    right: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    padding: 12,
    zIndex: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  assistCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assistThumb: {
    width: 40,
    height: 40,
    borderRadius: 10,
    marginRight: 10,
  },
  assistEyebrow: {
    color: '#6B7280',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 1,
  },
  assistPrompt: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '400',
  },
  assistMeta: {
    marginTop: 4,
    color: '#65A30D',
    fontSize: 11,
    fontWeight: '400',
  },
  assistSkeletonList: {
    marginTop: 10,
    gap: 8,
  },
  assistSkeletonRow: {
    height: 10,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
    width: '100%',
  },
  loadingBody: {
    alignItems: 'center',
    width: '100%',
    maxWidth: 440,
  },
  heroFrame: {
    width: 152,
    height: 152,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
    marginBottom: 18,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: '#E5E7EB',
  },
  titleText: {
    fontSize: 22,
    lineHeight: 24,
    color: '#111827',
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 4,
    paddingHorizontal: 16,
  },
  stepLoader: {
    width: '100%',
    minHeight: 200,
    maxHeight: 220,
    marginTop: 4,
    paddingTop: 10,
  },
  pollWarningText: {
    marginTop: 10,
    color: '#B45309',
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
  },
  errorRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    color: '#B91C1C',
    fontSize: 13,
    fontWeight: '400',
  },
});

import { useNavigation, useTheme } from '@react-navigation/native';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ScrollView,
  ActivityIndicator,
  TextInput,
  Animated,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import PyramidGrid from '../components/PyramidGrid';
import { Blurred } from '../components/Blurred';
import StepLoader from '../components/StepLoader';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import ItemJobsModal from '../components/ItemJobsModal';
import { Boxes } from 'lucide-react-native';


type LoadingScreenProps = StackScreenProps<AppStackParamList, 'LoadingScreen'>;
type AssistAction = 'confirm' | 'deny' | 'refine' | 'best_guess' | 'retake';
type AssistDecisionPayload = {
  action: AssistAction;
  candidateIndex?: number;
  deniedCandidateIndices?: number[];
  refineText?: string;
  generateBestGuess?: boolean;
};
type AssistSubmissionState = {
  status: 'idle' | 'submitting' | 'failed';
  message?: string;
};

const LoadingScreen: React.FC<LoadingScreenProps> = ({ route, navigation }) => {
  const theme = useTheme();

  const { processType, payload, onCompleteRoute } = route.params;
  const { jobId, firstPhotos, bulkItems } = payload;
  // @ts-ignore - confirmedQuickMatchByItemId is optional and may be passed dynamically
  const confirmedQuickMatchByItemId = payload?.confirmedQuickMatchByItemId || {};
  const preferWaitForCompletion =
    payload?.skipMatchSelection === true || payload?.autoGenerateAllPlatforms === true;

  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [jobStatus, setJobStatus] = useState('queued');
  const [jobsModalVisible, setJobsModalVisible] = useState(false);
  const [lastStage, setLastStage] = useState<string | null>(null); // Track last stage to prevent animation replay
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [latestJobSnapshot, setLatestJobSnapshot] = useState<any>(null);
  const [interactionState, setInteractionState] = useState<'passive_loading' | 'needs_user_help' | 'user_answering' | 'resume_processing'>('passive_loading');
  const [assistantRefineText, setAssistantRefineText] = useState('');
  const [selectedCandidateByIndex, setSelectedCandidateByIndex] = useState<Record<number, number>>({});
  const [deniedCandidateByIndex, setDeniedCandidateByIndex] = useState<Record<number, number[]>>({});
  const [refineTextByIndex, setRefineTextByIndex] = useState<Record<number, string>>({});
  const [bestGuessByIndex, setBestGuessByIndex] = useState<Record<number, boolean>>({});
  const [assistSubmissionByIndex, setAssistSubmissionByIndex] = useState<Record<number, AssistSubmissionState>>({});
  const [queuedAssistPayloadByIndex, setQueuedAssistPayloadByIndex] = useState<Record<number, AssistDecisionPayload>>({});
  const assistantTranslateY = useRef(new Animated.Value(-40)).current;
  const assistantOpacity = useRef(new Animated.Value(0)).current;
  const bodyTranslateY = useRef(new Animated.Value(0)).current;

  // Define the stages for different processes
  const stages = {
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

  // Select the correct list of stages based on the processType
  // Track the original processType to maintain unified stages during match→generate transitions
  const originalProcessTypeRef = React.useRef(processType);
  const activeStages = stages[originalProcessTypeRef.current] || stages[processType];

  // Map backend stage names to UI stage labels (keeps progress bar accurate)
  const stageNameMap: Record<string, string> = {
    // Generate backend stages → UI
    'Preparing': 'Gathering data...',
    'Fetching sources': 'Analyzing sources...',
    'Scraping sources': 'Building details...',
    'Generating details': 'Assembling listing...',
    'Saving drafts': 'Finalizing...',
    'Ready': 'Ready to review',
    // Match-and-generate mapped stages (from match phase)
    'Analyzing...': 'Analyzing...',
    'Searching...': 'Searching...',
    'Ranking results...': 'Ranking results...',
    'Building details...': 'Building details...',
    'Assembling listing...': 'Assembling listing...',
  };

  // Mapping for generate backend stages when inside a match-and-generate flow
  const matchAndGenerateStageMap: Record<string, string> = {
    'Preparing': 'Building details...',
    'Fetching sources': 'Building details...',
    'Scraping sources': 'Building details...',
    'Generating details': 'Assembling listing...',
    'Saving drafts': 'Ready',
    'Ready': 'Ready',
  };




  // Poll job status using the jobId
  const [navigatedEarly, setNavigatedEarly] = useState(false);
  const BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'https://api.sssync.app';
  const pollingIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = React.useRef(false);
  const consecutivePollFailuresRef = React.useRef(0);
  const notFoundCountRef = React.useRef(0);
  const firstNotFoundAtRef = React.useRef<number | null>(null);
  const hasNavigatedRef = React.useRef(false);
  const hasSwitchedToGenerateRef = React.useRef(false);

  const NOT_FOUND_CONSECUTIVE_THRESHOLD = 7;
  const NOT_FOUND_WINDOW_MS = 18000;

  const replaceOnce = useCallback((screen: keyof AppStackParamList, params: Record<string, any>, reason: string) => {
    if (hasNavigatedRef.current) {
      console.log(`[NAVIGATION] Skipping duplicate replace (${reason})`);
      return;
    }
    hasNavigatedRef.current = true;
    navigation.replace(screen as never, params as never);
  }, [navigation]);

  useEffect(() => {
    hasNavigatedRef.current = false;
    hasSwitchedToGenerateRef.current = false;
  }, [jobId, processType]);

  useEffect(() => {
    const decisions = payload?.userAssistDecisions;
    if (!decisions || typeof decisions !== 'object') return;

    const nextSelected: Record<number, number> = {};
    const nextDenied: Record<number, number[]> = {};
    const nextRefine: Record<number, string> = {};
    const nextBestGuess: Record<number, boolean> = {};
    Object.entries(decisions).forEach(([idxStr, decision]) => {
      const idx = Number(idxStr);
      if (!Number.isFinite(idx) || !decision) return;
      if (typeof decision.confirmedCandidateIndex === 'number') nextSelected[idx] = decision.confirmedCandidateIndex;
      if (Array.isArray(decision.deniedCandidateIndices)) nextDenied[idx] = decision.deniedCandidateIndices;
      if (typeof decision.refineText === 'string' && decision.refineText.trim().length > 0) nextRefine[idx] = decision.refineText.trim();
      if (decision.generateBestGuess === true) nextBestGuess[idx] = true;
    });

    if (Object.keys(nextSelected).length) setSelectedCandidateByIndex(prev => ({ ...nextSelected, ...prev }));
    if (Object.keys(nextDenied).length) setDeniedCandidateByIndex(prev => ({ ...nextDenied, ...prev }));
    if (Object.keys(nextRefine).length) setRefineTextByIndex(prev => ({ ...nextRefine, ...prev }));
    if (Object.keys(nextBestGuess).length) setBestGuessByIndex(prev => ({ ...nextBestGuess, ...prev }));
  }, [payload?.userAssistDecisions]);

  const toPhotoUri = useCallback((photo: any): string => {
    if (typeof photo === 'string') return photo;
    return photo?.uri || photo?.url || '';
  }, []);

  const buildGenerateItems = useCallback((results: any[]): Array<{ index: number; title: string; thumb: string; matchesCount: number }> => {
    const existingItems = ((onCompleteRoute?.params as any)?.items || []);
    if (Array.isArray(existingItems) && existingItems.length > 0) return existingItems;
    if (!Array.isArray(results) || results.length === 0) return [];
    return results.map((res: any, idx: number) => {
      const first = res?.serpApiData?.[0] || res?.rerankedResults?.[0] || null;
      return {
        index: idx,
        title: first?.title || `Item ${idx + 1}`,
        thumb: first?.image || first?.thumbnail || res?.originalTargetImage || '',
        matchesCount: Array.isArray(res?.serpApiData) ? res.serpApiData.length : 0,
      };
    });
  }, [onCompleteRoute]);

  const buildUserImagesByIndexForGenerate = useCallback((): Record<number, string[]> => {
    const existing = (onCompleteRoute?.params as any)?.userImagesByIndex;
    if (existing && typeof existing === 'object' && Object.keys(existing).length > 0) {
      return existing;
    }

    const imagesByIndex: Record<number, string[]> = {};
    const sourceBulk = Array.isArray(bulkItems) ? bulkItems : [];
    sourceBulk.forEach((item: any, i: number) => {
      const photos = Array.isArray(item?.photos) ? item.photos : [];
      const uris = photos
        .map((p: any) => toPhotoUri(p))
        .filter((u: string) => typeof u === 'string' && u.length > 0);
      if (uris.length > 0) {
        imagesByIndex[i] = Array.from(new Set(uris));
      }
    });

    return imagesByIndex;
  }, [bulkItems, onCompleteRoute, toPhotoUri]);

  const buildGenerateFirstPhotos = useCallback((firstResult: any): any[] => {
    const existingFirstPhotos = Array.isArray(firstPhotos) ? firstPhotos : [];
    if (existingFirstPhotos.length > 0) return existingFirstPhotos;

    const fallbackUris = [
      firstResult?.originalTargetImage,
      firstResult?.serpApiData?.[0]?.image,
      firstResult?.serpApiData?.[0]?.thumbnail,
      firstResult?.rerankedResults?.[0]?.image,
      firstResult?.rerankedResults?.[0]?.thumbnail,
    ].filter((u: any) => typeof u === 'string' && u.length > 0);

    return Array.from(new Set(fallbackUris));
  }, [firstPhotos]);

  const findAutoGenerateResult = useCallback((results: any[]): any | null => {
    if (!Array.isArray(results) || results.length === 0) return null;
    const withAutoGenerate = results.find((res: any) => res?.skipToGenerate === true && !!res?.autoGenerateJobId);
    return withAutoGenerate || results[0] || null;
  }, []);

  useEffect(() => {
    if (!jobId) return;

    const pollJobStatus = async () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      try {



        // Get current user
        async function getToken() { return await ensureSupabaseJwt(); }


        const token = await getToken();
        if (!token) {
          throw new Error('Missing auth token for job status polling');
        }

        const fetchStatus = async (endpoint: string) => {
          const response = await fetch(endpoint, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            let body = '';
            try {
              body = await response.text();
            } catch {
              body = '';
            }
            throw new Error(`Status poll failed (${response.status}) ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`);
          }

          const status = await response.json();
          if (!status || typeof status.status !== 'string') {
            throw new Error('Status poll returned invalid payload');
          }
          return status;
        };

        if (processType === 'generate' || processType === 'match-and-generate') {
          // For match-and-generate, we start by polling the match job
          // After match completes with skipToGenerate, we'll switch to polling generate job
          const isMatchAndGenerate = processType === 'match-and-generate';
          const endpoint = isMatchAndGenerate
            ? `${BASE_URL}/api/products/match/jobs/${jobId}/status`
            : `${BASE_URL}/api/products/generate/jobs/${jobId}/status`;

          const status = await fetchStatus(endpoint);
          setLatestJobSnapshot(status);
          consecutivePollFailuresRef.current = 0;
          notFoundCountRef.current = 0;
          firstNotFoundAtRef.current = null;

          console.log('[POLLING] Job status:', status.status, 'Stage:', status.currentStage);

          // Update job status and stage
          setJobStatus(status.status);

          // Map backend stages to frontend stage index
          // Use match-and-generate mapping if we're in the generate phase of a unified flow
          const isUnifiedGenPhase = originalProcessTypeRef.current === 'match-and-generate' && processType === 'generate';
          const effectiveMap = isUnifiedGenPhase ? matchAndGenerateStageMap : stageNameMap;
          const mappedStage = effectiveMap[status.currentStage] || stageNameMap[status.currentStage] || status.currentStage;
          const stageIndex = activeStages.indexOf(mappedStage);
          if (stageIndex >= 0 && mappedStage !== lastStage) {
            console.log('[ANIMATION] Stage changed from', lastStage, 'to', mappedStage, '- triggering animation');
            setLastStage(mappedStage);
            setCurrentStageIndex(stageIndex);
          } else if (mappedStage === lastStage) {
            console.log('[ANIMATION] Stage unchanged:', mappedStage, '- skipping animation');
          }

          // For match-and-generate: check if match completed and should skip to generate
          if (isMatchAndGenerate && status.status === 'completed') {
            const firstResult = findAutoGenerateResult(status.results || []);
            const shouldSkipToGenerate = firstResult?.skipToGenerate === true && firstResult?.autoGenerateJobId;

            if (shouldSkipToGenerate) {
              if (hasSwitchedToGenerateRef.current) {
                return;
              }
              hasSwitchedToGenerateRef.current = true;
              const generateFirstPhotos = buildGenerateFirstPhotos(firstResult);
              const generateItems = buildGenerateItems(status.results || []);
              const userImagesByIndex = buildUserImagesByIndexForGenerate();
              console.log('[LOADING] Match-and-generate transition payload', {
                generateFirstPhotosCount: generateFirstPhotos.length,
                itemsCount: generateItems.length,
                userImageGroups: Object.keys(userImagesByIndex).length,
              });
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
              console.log(`[LOADING] Match-and-generate: Match completed, switching to generate job ${firstResult.autoGenerateJobId}`);
              // Switch to polling generate job
              // Update params in-place to avoid remounting and replaying entrance animations
              // Advance to the generate portion of unified stages (index 3 = 'Building details...')
              setCurrentStageIndex(3);
              setLastStage('Ranking results...');
              setNavigatedEarly(false);
              setJobStatus('queued');
              setTimeout(() => {
                navigation.setParams({
                  processType: 'generate',
                  payload: { jobId: firstResult.autoGenerateJobId, firstPhotos: generateFirstPhotos },
                  onCompleteRoute: {
                    screen: 'GenerateDetailsScreen',
                    params: {
                      jobId: firstResult.autoGenerateJobId,
                      matchJobId: jobId,
                      items: generateItems,
                      jobMap: {},
                      userImagesByIndex,
                    },
                  },
                } as never);
              }, 500);
              return;
            }
          }

          // If completed, stop polling and navigate to next screen
          if (status.status === 'completed') {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            console.log(`Process "${processType}" complete! Navigating...`);
            setTimeout(() => {
              // Build items list for GenerateDetails modal
              const itemsForModal = ((onCompleteRoute?.params as any)?.items || []);
              replaceOnce(onCompleteRoute.screen, {
                ...onCompleteRoute.params,
                ...buildAssistForwardParams(),
                jobId: status.jobId,
                status: status.status,
                results: status.results,
                summary: status.summary,
                completedAt: status.completedAt,
                items: itemsForModal,
              }, 'process-complete-generate');
            }, 500);
          } else if (status.status === 'failed') {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            console.error('Job failed:', status.error);
            // Handle error - maybe go back or show error screen
          }

        } else {

          const status = await fetchStatus(`${BASE_URL}/api/products/match/jobs/${jobId}/status`);
          setLatestJobSnapshot(status);
          consecutivePollFailuresRef.current = 0;
          notFoundCountRef.current = 0;
          firstNotFoundAtRef.current = null;

          console.log('[POLLING] Job status:', status.status, 'Stage:', status.currentStage);

          // Update job status and stage
          setJobStatus(status.status);

          // Map backend stages to frontend stage index
          const stageIndex = activeStages.indexOf(status.currentStage);
          if (stageIndex >= 0 && status.currentStage !== lastStage) {
            console.log('[ANIMATION] Stage changed from', lastStage, 'to', status.currentStage, '- triggering animation');
            setLastStage(status.currentStage);
            setCurrentStageIndex(stageIndex);
          } else if (status.currentStage === lastStage) {
            console.log('[ANIMATION] Stage unchanged:', status.currentStage, '- skipping animation');
          }

          // Check if fast track completed with auto-generate
          const firstResult = findAutoGenerateResult(status.results || []);
          const shouldSkipToGenerate = firstResult?.skipToGenerate === true && firstResult?.autoGenerateJobId;

          // If fast track with auto-generate, wait for match job to complete then navigate to generate job
          if (shouldSkipToGenerate && status.status === 'completed') {
            if (hasSwitchedToGenerateRef.current) {
              return;
            }
            hasSwitchedToGenerateRef.current = true;
            const generateFirstPhotos = buildGenerateFirstPhotos(firstResult);
            const generateItems = buildGenerateItems(status.results || []);
            const userImagesByIndex = buildUserImagesByIndexForGenerate();
            console.log('[LOADING] Fast-track transition payload', {
              generateFirstPhotosCount: generateFirstPhotos.length,
              itemsCount: generateItems.length,
              userImageGroups: Object.keys(userImagesByIndex).length,
            });
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            console.log(`[LOADING] Fast track completed, navigating to generate job ${firstResult.autoGenerateJobId}`);
            // Update params in-place to avoid remounting and replaying entrance animations
            // Advance to the generate portion of unified stages (index 3 = 'Building details...')
            setCurrentStageIndex(3);
            setLastStage('Ranking results...');
            setNavigatedEarly(false);
            setJobStatus('queued');
            setTimeout(() => {
              navigation.setParams({
                processType: 'generate',
                payload: { jobId: firstResult.autoGenerateJobId, firstPhotos: generateFirstPhotos },
                onCompleteRoute: {
                  screen: 'GenerateDetailsScreen',
                  params: {
                    jobId: firstResult.autoGenerateJobId,
                    matchJobId: jobId,
                    items: generateItems,
                    jobMap: {},
                    userImagesByIndex,
                  },
                },
              } as never);
            }, 500);
            return;
          }

          // Early navigate: as soon as we have initial results, go to selection screen (non-blocking rerank/embeddings continue server-side)
          // BUT if user requested skipMatchSelection/autoGenerateAllPlatforms, we must wait for completion to respect skipToGenerate.
          if (
            !preferWaitForCompletion &&
            !navigatedEarly &&
            Array.isArray(status.results) &&
            status.results.length > 0 &&
            !shouldSkipToGenerate
          ) {
            const expectedCount = Array.isArray(payload?.bulkItems) ? payload.bulkItems.length : (Array.isArray(payload?.firstPhotos) ? payload.firstPhotos.length : 0);
            if (expectedCount > 0 && status.results.length !== expectedCount) {
              console.warn(`[LOADING] Match job returned ${status.results.length} results but payload had ${expectedCount} product(s). Backend may only be processing first item.`);
            }
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            setNavigatedEarly(true);
            const sourceBulk = Array.isArray(payload?.bulkItems) ? payload.bulkItems : [];
            const confirmed = confirmedQuickMatchByItemId && typeof confirmedQuickMatchByItemId === 'object' ? confirmedQuickMatchByItemId : {};
            const n = sourceBulk.length > 0 ? sourceBulk.length : (status.results?.length ?? 0);
            const mergedResults: Array<{ productIndex: number; serpApiData: any[] }> = [];
            const preSelectedByProductIndex: Record<number, number[]> = {};
            for (let i = 0; i < n; i++) {
              const itemId = sourceBulk[i]?.id;
              const confirmedMatch = itemId ? confirmed[itemId] : undefined;
              if (confirmedMatch && Array.isArray(confirmedMatch.serpApiData)) {
                mergedResults.push({ productIndex: i, serpApiData: confirmedMatch.serpApiData });
                if (Array.isArray(confirmedMatch.preSelectedIndices)) {
                  preSelectedByProductIndex[i] = confirmedMatch.preSelectedIndices;
                }
              } else {
                const jobResult = status.results?.[i];
                const serpApiData = jobResult?.serpApiData ?? [];
                mergedResults.push({ productIndex: i, serpApiData });
              }
            }
            const itemsForModal = mergedResults.map((res: any, idx: number) => {
              const first = res?.serpApiData?.[0];
              return {
                index: idx,
                title: first?.title || `Item ${idx + 1}`,
                thumb: first?.image || first?.thumbnail || '',
                matchesCount: Array.isArray(res?.serpApiData) ? res.serpApiData.length : 0,
              };
            });
            const prevResponse = ((onCompleteRoute?.params as any)?.response) || {};
            const userImagesByIndex: Record<number, string[]> = {};
            if (Array.isArray(sourceBulk)) {
              sourceBulk.forEach((item: any, i: number) => {
                const photos = Array.isArray(item?.photos) ? item.photos : [];
                const uris = photos
                  .map((p: any) => (typeof p === 'string' ? p : (p?.uri || p?.url || '')))
                  .filter((u: string) => typeof u === 'string' && u.length > 0);
                if (uris.length) userImagesByIndex[i] = uris;
              });
            }
            replaceOnce(onCompleteRoute.screen, {
              ...onCompleteRoute.params,
              ...buildAssistForwardParams(),
              jobId: status.jobId,
              response: { ...(onCompleteRoute?.params as any)?.response, jobId: status.jobId },
              overrideResults: mergedResults.length > 0 ? mergedResults : undefined,
              preSelectedByProductIndex: Object.keys(preSelectedByProductIndex).length > 0 ? preSelectedByProductIndex : undefined,
              items: itemsForModal,
              userImagesByIndex: (onCompleteRoute?.params as any)?.userImagesByIndex || (Object.keys(userImagesByIndex).length ? userImagesByIndex : undefined),
            }, 'process-early-match');
            return;
          }

          // If completed, stop polling and navigate (redundant if we already navigated early)
          // Check if we should skip to generate (backend set skipToGenerate with autoGenerateJobId)
          const firstResultMatch = findAutoGenerateResult(status.results || []);
          const shouldSkipToGenerateMatch = firstResultMatch?.skipToGenerate === true && firstResultMatch?.autoGenerateJobId;

          if (shouldSkipToGenerateMatch && status.status === 'completed') {
            if (hasSwitchedToGenerateRef.current) {
              return;
            }
            hasSwitchedToGenerateRef.current = true;
            const generateFirstPhotos = buildGenerateFirstPhotos(firstResultMatch);
            const generateItems = buildGenerateItems(status.results || []);
            const userImagesByIndex = buildUserImagesByIndexForGenerate();
            console.log('[LOADING] Match-complete transition payload', {
              generateFirstPhotosCount: generateFirstPhotos.length,
              itemsCount: generateItems.length,
              userImageGroups: Object.keys(userImagesByIndex).length,
            });
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            console.log(`[LOADING] Match completed with skipToGenerate, navigating to generate job ${firstResultMatch.autoGenerateJobId}`);
            // Update params in-place to avoid remounting and replaying entrance animations
            // Advance to the generate portion of unified stages (index 3 = 'Building details...')
            setCurrentStageIndex(3);
            setLastStage('Ranking results...');
            setNavigatedEarly(false);
            setJobStatus('queued');
            setTimeout(() => {
              navigation.setParams({
                processType: 'generate',
                payload: { jobId: firstResultMatch.autoGenerateJobId, firstPhotos: generateFirstPhotos },
                onCompleteRoute: {
                  screen: 'GenerateDetailsScreen',
                  params: {
                    jobId: firstResultMatch.autoGenerateJobId,
                    matchJobId: jobId,
                    items: generateItems,
                    jobMap: {},
                    userImagesByIndex,
                  },
                },
              } as never);
            }, 500);
            return;
          }

          if (status.status === 'completed' && !navigatedEarly && !shouldSkipToGenerateMatch) {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            console.log(`Process "${processType}" complete! Navigating...`);
            setTimeout(() => {
              replaceOnce(onCompleteRoute.screen, {
                ...onCompleteRoute.params,
                ...buildAssistForwardParams(),
                jobResults: status.results
              }, 'process-complete-match');
            }, 500);
          } else if (status.status === 'failed') {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            console.error('Job failed:', status.error);
            // Handle error - maybe go back or show error screen
          }


        }


      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const is404 = message.includes('(404)') && message.toLowerCase().includes('not found');

        if (is404) {
          notFoundCountRef.current += 1;
          if (firstNotFoundAtRef.current === null) {
            firstNotFoundAtRef.current = Date.now();
          }
          const elapsed = firstNotFoundAtRef.current ? Date.now() - firstNotFoundAtRef.current : 0;
          console.warn(
            `[POLLING] 404 not found (jobId=${jobId}, processType=${processType}) notFoundCount=${notFoundCountRef.current} elapsed=${elapsed}ms`
          );
          const overThreshold = notFoundCountRef.current >= NOT_FOUND_CONSECUTIVE_THRESHOLD;
          const overWindow = elapsed >= NOT_FOUND_WINDOW_MS;
          if (overThreshold || overWindow) {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            setJobStatus('failed');
            Alert.alert(
              'Scan not found',
              'This scan job is no longer available. Please run the scan again.',
              [
                {
                  text: 'OK',
                  onPress: () =>
                    navigation.replace('AddProduct' as never, {
                      firstPhotos: firstPhotos || [],
                      bulkItems: bulkItems || [],
                    } as never),
                },
              ]
            );
            return;
          }
          // Transient 404: keep polling, do not increment generic failure count
        } else {
          consecutivePollFailuresRef.current += 1;
          console.warn('[POLLING] Error polling status:', message);
          if (consecutivePollFailuresRef.current === 4) {
            Alert.alert(
              'Connection issue',
              'Having trouble checking scan progress. We will keep retrying in the background.'
            );
          }
        }
      } finally {
        isPollingRef.current = false;
      }
    };

    // Poll immediately, then every 1s so we catch job status as soon as backend persists (avoids false 404)
    pollJobStatus();
    pollingIntervalRef.current = setInterval(pollJobStatus, 1000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [jobId, processType, navigation, onCompleteRoute, activeStages, bulkItems, firstPhotos, buildGenerateFirstPhotos, buildGenerateItems, buildUserImagesByIndexForGenerate, findAutoGenerateResult, preferWaitForCompletion, replaceOnce]);

  // Fallback timer for advancing stages if polling fails
  useEffect(() => {
    if (jobStatus !== 'queued' && jobStatus !== 'processing') return;
    if (currentStageIndex >= activeStages.length - 1) return;

    const stageTimer = setTimeout(() => {
      setCurrentStageIndex(prevIndex => prevIndex + 1);
    }, 3000); // Slower fallback

    return () => clearTimeout(stageTimer);
  }, [currentStageIndex, activeStages.length, jobStatus]);

  // Build ItemJobsModal items from bulkItems or firstPhotos so N items show during loading (fix: was hardcoded to 1)
  const loadingModalItems = React.useMemo(() => {
    const jobResults = Array.isArray(latestJobSnapshot?.results) ? latestJobSnapshot.results : [];
    const bulk = Array.isArray(bulkItems) ? bulkItems : [];
    const photos = Array.isArray(firstPhotos) ? firstPhotos : [];
    if (bulk.length > 0) {
      return bulk.map((item: any, i: number) => {
        const firstPhoto = item?.photos?.[0];
        const thumb = typeof firstPhoto === 'string' ? firstPhoto : firstPhoto?.uri || firstPhoto?.url || '';
        const matchResult = jobResults[i];
        const top = matchResult?.rerankedResults?.[0] || matchResult?.serpApiData?.[0];
        const title = top?.title || item?.title || `Item ${i + 1}`;
        const matchesCount = Array.isArray(matchResult?.serpApiData) ? matchResult.serpApiData.length : 0;
        return { index: i, title, thumb, matchesCount };
      });
    }
    if (photos.length > 0) {
      return photos.map((p: any, i: number) => {
        const thumb = typeof p === 'string' ? p : p?.uri || p?.url || '';
        const matchResult = jobResults[i];
        const top = matchResult?.rerankedResults?.[0] || matchResult?.serpApiData?.[0];
        const title = top?.title || `Item ${i + 1}`;
        const matchesCount = Array.isArray(matchResult?.serpApiData) ? matchResult.serpApiData.length : 0;
        return { index: i, title, thumb, matchesCount };
      });
    }
    return [{
      index: 0,
      title: jobResults?.[0]?.rerankedResults?.[0]?.title || 'Item 1',
      thumb: firstPhotos?.[0],
      matchesCount: Array.isArray(jobResults?.[0]?.serpApiData) ? jobResults[0].serpApiData.length : 0
    }];
  }, [bulkItems, firstPhotos, latestJobSnapshot]);

  useEffect(() => {
    if (loadingModalItems.length === 0) return;
    if (selectedItemIndex > loadingModalItems.length - 1) {
      setSelectedItemIndex(Math.max(0, loadingModalItems.length - 1));
    }
  }, [loadingModalItems, selectedItemIndex]);

  const currentItemResult = React.useMemo(() => {
    if (!latestJobSnapshot || !Array.isArray(latestJobSnapshot.results)) return null;
    return latestJobSnapshot.results[selectedItemIndex] || null;
  }, [latestJobSnapshot, selectedItemIndex]);

  const currentCandidates = React.useMemo(() => {
    const serp = Array.isArray(currentItemResult?.serpApiData) ? currentItemResult.serpApiData : [];
    const reranked = Array.isArray(currentItemResult?.rerankedResults) ? currentItemResult.rerankedResults : [];
    if (serp.length > 0) return serp;
    return reranked;
  }, [currentItemResult]);

  const currentAllowedAssistActions = React.useMemo<Set<AssistAction>>(() => {
    const backendActions = currentItemResult?.userAssist?.allowedActions;
    if (Array.isArray(backendActions) && backendActions.length > 0) {
      return new Set(
        backendActions.filter((action: string): action is AssistAction =>
          action === 'confirm' || action === 'deny' || action === 'refine' || action === 'best_guess' || action === 'retake'
        )
      );
    }
    if (currentCandidates.length === 0) {
      return new Set<AssistAction>(['refine', 'retake', 'best_guess']);
    }
    return new Set<AssistAction>(['confirm', 'deny', 'refine', 'retake', 'best_guess']);
  }, [currentItemResult?.userAssist?.allowedActions, currentCandidates.length]);

  const refinePlaceholder = React.useMemo(() => {
    const requested = Array.isArray(currentItemResult?.userAssist?.requestedFields)
      ? currentItemResult.userAssist.requestedFields.filter((field: string) => typeof field === 'string' && field.length > 0)
      : [];
    if (requested.length > 0) {
      return `Refine with ${requested.slice(0, 2).join('/')}`;
    }
    return 'Refine with text (barcode/model/title)';
  }, [currentItemResult]);

  const shouldPromptForHelp = React.useMemo(() => {
    if (jobStatus !== 'processing') return false;
    if (!currentItemResult) return false;
    if (currentItemResult?.userAssist?.required) return true;
    if (String(currentItemResult?.matchDecision || '').toLowerCase() === 'needs_user_input') return true;
    if (currentCandidates.length === 0) return true;
    return false;
  }, [jobStatus, currentItemResult, currentCandidates.length]);

  useEffect(() => {
    const nextState = shouldPromptForHelp ? 'needs_user_help' : 'passive_loading';
    setInteractionState(prev => {
      if (prev === 'resume_processing') return prev;
      if (prev === 'user_answering' && shouldPromptForHelp) return prev;
      return nextState;
    });
  }, [shouldPromptForHelp]);

  useEffect(() => {
    if (interactionState !== 'resume_processing') return;
    const timer = setTimeout(() => {
      setInteractionState(shouldPromptForHelp ? 'needs_user_help' : 'passive_loading');
    }, 260);
    return () => clearTimeout(timer);
  }, [interactionState, shouldPromptForHelp]);

  useEffect(() => {
    const expanded = interactionState === 'needs_user_help' || interactionState === 'user_answering';
    Animated.parallel([
      Animated.timing(assistantOpacity, {
        toValue: expanded ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(assistantTranslateY, {
        toValue: expanded ? 0 : -40,
        damping: 22,
        stiffness: 180,
        useNativeDriver: true,
      }),
      Animated.timing(bodyTranslateY, {
        toValue: expanded ? 32 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [interactionState, assistantOpacity, assistantTranslateY, bodyTranslateY]);

  const submitAssistResponse = useCallback(async (productIndex: number, payloadForSubmit: AssistDecisionPayload) => {
    setAssistSubmissionByIndex(prev => ({ ...prev, [productIndex]: { status: 'submitting' } }));

    try {
      const token = await ensureSupabaseJwt();
      if (!token) throw new Error('Missing auth token');
      if (!jobId) throw new Error('Missing job id');

      const snapshotResult = Array.isArray(latestJobSnapshot?.results) ? latestJobSnapshot.results[productIndex] : null;
      const body: Record<string, any> = { action: payloadForSubmit.action };
      if (snapshotResult?.userAssist?.requestId) body.requestId = snapshotResult.userAssist.requestId;
      if (typeof payloadForSubmit.candidateIndex === 'number') body.candidateIndex = payloadForSubmit.candidateIndex;
      if (Array.isArray(payloadForSubmit.deniedCandidateIndices)) body.deniedCandidateIndices = payloadForSubmit.deniedCandidateIndices;
      if (typeof payloadForSubmit.refineText === 'string' && payloadForSubmit.refineText.trim().length > 0) body.refineText = payloadForSubmit.refineText.trim();
      if (payloadForSubmit.generateBestGuess === true) body.generateBestGuess = true;

      const response = await fetch(`${BASE_URL}/api/products/match/jobs/${jobId}/product/${productIndex}/assist-response`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Assist response failed (${response.status})`);
      }

      const data = await response.json();
      const updatedResult = data?.updatedResult || data?.result;
      if (updatedResult) {
        setLatestJobSnapshot((prev: any) => {
          if (!prev || !Array.isArray(prev.results)) return prev;
          const nextResults = [...prev.results];
          nextResults[productIndex] = { ...(nextResults[productIndex] || {}), ...updatedResult };
          return { ...prev, results: nextResults };
        });
      }

      setAssistSubmissionByIndex(prev => ({ ...prev, [productIndex]: { status: 'idle' } }));
      setQueuedAssistPayloadByIndex(prev => {
        const next = { ...prev };
        delete next[productIndex];
        return next;
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit assist response';
      console.warn('[LOADING] Assist response submission failed:', message);
      setAssistSubmissionByIndex(prev => ({
        ...prev,
        [productIndex]: {
          status: 'failed',
          message: 'Could not send yet. We saved your choice and will keep it for match review.',
        },
      }));
      setQueuedAssistPayloadByIndex(prev => ({ ...prev, [productIndex]: payloadForSubmit }));
      return false;
    }
  }, [BASE_URL, jobId, latestJobSnapshot]);

  const retryQueuedAssist = useCallback(async (productIndex: number) => {
    const queued = queuedAssistPayloadByIndex[productIndex];
    if (!queued) return;
    await submitAssistResponse(productIndex, queued);
  }, [queuedAssistPayloadByIndex, submitAssistResponse]);

  const onConfirmCandidate = useCallback(async (candidateIndex: number, productIndex: number = selectedItemIndex) => {
    setSelectedCandidateByIndex(prev => ({ ...prev, [productIndex]: candidateIndex }));
    setInteractionState('resume_processing');
    await submitAssistResponse(productIndex, { action: 'confirm', candidateIndex });
  }, [selectedItemIndex, submitAssistResponse]);

  const onDenyCandidate = useCallback(async (candidateIndex: number, productIndex: number = selectedItemIndex) => {
    setDeniedCandidateByIndex(prev => {
      const existing = prev[productIndex] || [];
      return { ...prev, [productIndex]: Array.from(new Set([...existing, candidateIndex])) };
    });
    setSelectedCandidateByIndex(prev => {
      const next = { ...prev };
      delete next[productIndex];
      return next;
    });
    setInteractionState('resume_processing');
    await submitAssistResponse(productIndex, { action: 'deny', candidateIndex, deniedCandidateIndices: [candidateIndex] });
  }, [selectedItemIndex, submitAssistResponse]);

  const onSubmitRefine = useCallback(async (productIndex: number = selectedItemIndex, rawText?: string) => {
    const value = (rawText ?? assistantRefineText).trim();
    if (!value) return;
    setRefineTextByIndex(prev => ({ ...prev, [productIndex]: value }));
    if (productIndex === selectedItemIndex) setAssistantRefineText('');
    setInteractionState('resume_processing');
    await submitAssistResponse(productIndex, { action: 'refine', refineText: value });
  }, [assistantRefineText, selectedItemIndex, submitAssistResponse]);

  const onGenerateBestGuess = useCallback(async (productIndex: number = selectedItemIndex) => {
    setBestGuessByIndex(prev => ({ ...prev, [productIndex]: true }));
    setInteractionState('resume_processing');
    await submitAssistResponse(productIndex, { action: 'best_guess', generateBestGuess: true });
  }, [selectedItemIndex, submitAssistResponse]);

  const onRetakePhotoAssist = useCallback(async (productIndex: number = selectedItemIndex) => {
    setInteractionState('resume_processing');
    await submitAssistResponse(productIndex, { action: 'retake' });
    navigation.navigate('TabNavigator' as any, {
      screen: 'AddProduct',
      params: { focusItemIndex: productIndex, message: 'Retake cover photo for better match' },
    } as any);
  }, [navigation, selectedItemIndex, submitAssistResponse]);

  const buildAssistForwardParams = useCallback(() => {
    const preResolvedSelections: Record<number, number[]> = {};
    Object.entries(selectedCandidateByIndex).forEach(([indexStr, candidateIndex]) => {
      const index = Number(indexStr);
      if (Number.isFinite(index)) preResolvedSelections[index] = [candidateIndex];
    });
    return {
      preResolvedSelections: Object.keys(preResolvedSelections).length ? preResolvedSelections : undefined,
      preDeniedSelections: Object.keys(deniedCandidateByIndex).length ? deniedCandidateByIndex : undefined,
      preRefineTextByIndex: Object.keys(refineTextByIndex).length ? refineTextByIndex : undefined,
      bestGuessByIndex: Object.keys(bestGuessByIndex).length ? bestGuessByIndex : undefined,
    };
  }, [selectedCandidateByIndex, deniedCandidateByIndex, refineTextByIndex, bestGuessByIndex]);

  const getItemState = useCallback((index: number) => {
    const snapshot = latestJobSnapshot;
    const results = Array.isArray(snapshot?.results) ? snapshot.results : [];
    const result = results[index];
    const statusValue = String(snapshot?.status || '').toLowerCase();
    const currentIdx = Number(snapshot?.progress?.currentProductIndex ?? -1);
    const completedCount = Number(snapshot?.progress?.completedProducts ?? 0);

    if (result?.error) {
      return { match: '#EF4444', details: '#EF4444', secondary: result.error as string };
    }
    if (result?.userAssist?.required) {
      return { match: '#F59E0B', details: '#F59E0B', secondary: result?.userAssist?.prompt || 'needs one user detail' };
    }
    if (statusValue === 'completed') {
      const timed = typeof result?.timing?.totalMs === 'number' ? `• ${(result.timing.totalMs / 1000).toFixed(1)}s` : '';
      return {
        match: '#10B981',
        details: '#10B981',
        secondary: result ? `Ready ${timed}` : 'Ready'
      };
    }
    if (statusValue === 'processing' && currentIdx === index) {
      const isGeneratePhase = processType === 'generate' || snapshot?.currentStage === 'Generating details';
      return {
        match: '#F59E0B',
        details: '#F59E0B',
        secondary: isGeneratePhase ? 'Generating listing' : (snapshot?.currentStage || 'Finding match')
      };
    }
    if (index < completedCount || result) {
      return { match: '#10B981', details: '#4B5563', secondary: 'Match found' };
    }
    return { match: '#4B5563', details: '#4B5563', secondary: 'queued' };
  }, [latestJobSnapshot, processType]);

  console.log(`[LOADING] Starting process: "${processType}"`);
  console.log('[LOADING] Payload photos:', firstPhotos);
  const assistSubmission = assistSubmissionByIndex[selectedItemIndex];
  const queuedAssist = queuedAssistPayloadByIndex[selectedItemIndex];
  const isSubmittingAssist = assistSubmission?.status === 'submitting';

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'white', width: '100%', height: '100%' }}>
      <TouchableOpacity onPress={() => setJobsModalVisible(true)} style={{ position: 'absolute', top: 48, left: 24, zIndex: 4000, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center' }}>
        <Boxes size={18} color={'#000'} />
        <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Current Jobs</Text>
      </TouchableOpacity>

      <Animated.View
        pointerEvents={interactionState === 'passive_loading' ? 'none' : 'auto'}
        style={{
          position: 'absolute',
          top: 90,
          left: 14,
          right: 14,
          zIndex: 3000,
          backgroundColor: '#FFFFFF',
          borderRadius: 14,
          borderWidth: 1,
          borderColor: '#E5E7EB',
          padding: 12,
          opacity: assistantOpacity,
          transform: [{ translateY: assistantTranslateY }],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          {loadingModalItems[selectedItemIndex]?.thumb ? (
            <Image source={{ uri: loadingModalItems[selectedItemIndex]?.thumb }} style={{ width: 36, height: 36, borderRadius: 8, marginRight: 8 }} />
          ) : (
            <View style={{ width: 36, height: 36, borderRadius: 8, marginRight: 8, backgroundColor: '#E2E8F0' }} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, color: '#64748B', fontWeight: '700' }}>Need help on Item {selectedItemIndex + 1}</Text>
            <Text style={{ fontSize: 12, color: '#334155' }} numberOfLines={2}>
              {currentItemResult?.userAssist?.prompt || 'Confirm or refine this item while we keep processing.'}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {currentAllowedAssistActions.has('confirm') && (
            <TouchableOpacity
              style={{ backgroundColor: '#0F172A', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, opacity: isSubmittingAssist ? 0.55 : 1 }}
              disabled={isSubmittingAssist}
              onPress={() => { void onConfirmCandidate(selectedCandidateByIndex[selectedItemIndex] ?? 0); }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>This is it</Text>
            </TouchableOpacity>
          )}
          {currentAllowedAssistActions.has('deny') && (
            <TouchableOpacity
              style={{ backgroundColor: '#F1F5F9', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', opacity: isSubmittingAssist ? 0.55 : 1 }}
              disabled={isSubmittingAssist}
              onPress={() => { void onDenyCandidate(selectedCandidateByIndex[selectedItemIndex] ?? 0); }}
            >
              <Text style={{ color: '#334155', fontSize: 11, fontWeight: '700' }}>Not this</Text>
            </TouchableOpacity>
          )}
          {currentAllowedAssistActions.has('best_guess') && (
            <TouchableOpacity
              style={{ backgroundColor: '#ECFCCB', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#BEF264', opacity: isSubmittingAssist ? 0.55 : 1 }}
              disabled={isSubmittingAssist}
              onPress={() => { void onGenerateBestGuess(); }}
            >
              <Text style={{ color: '#365314', fontSize: 11, fontWeight: '700' }}>Generate best guess</Text>
            </TouchableOpacity>
          )}
          {currentAllowedAssistActions.has('retake') && (
            <TouchableOpacity
              style={{ backgroundColor: '#F8FAFC', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: '#CBD5E1', opacity: isSubmittingAssist ? 0.55 : 1 }}
              disabled={isSubmittingAssist}
              onPress={() => { void onRetakePhotoAssist(); }}
            >
              <Text style={{ color: '#334155', fontSize: 11, fontWeight: '700' }}>Add better photo</Text>
            </TouchableOpacity>
          )}
        </View>

        {currentAllowedAssistActions.has('refine') && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 }}>
            <TextInput
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: '#CBD5E1',
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 8,
                fontSize: 12,
                color: '#0F172A',
                backgroundColor: '#F8FAFC',
              }}
              placeholder={refinePlaceholder}
              placeholderTextColor="#94A3B8"
              value={assistantRefineText}
              onChangeText={(text) => {
                setInteractionState('user_answering');
                setAssistantRefineText(text);
              }}
            />
            <TouchableOpacity
              style={{ backgroundColor: '#111827', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, opacity: assistantRefineText.trim().length > 0 && !isSubmittingAssist ? 1 : 0.45 }}
              disabled={assistantRefineText.trim().length === 0 || isSubmittingAssist}
              onPress={() => { void onSubmitRefine(); }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '700' }}>Use</Text>
            </TouchableOpacity>
          </View>
        )}
        {assistSubmission?.status === 'submitting' && (
          <Text style={{ marginTop: 6, color: '#64748B', fontSize: 11 }}>Sending your response to backend...</Text>
        )}
        {assistSubmission?.status === 'failed' && (
          <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <Text style={{ flex: 1, color: '#B45309', fontSize: 11 }}>{assistSubmission.message || 'Failed to submit. We saved your response locally.'}</Text>
            {queuedAssist ? (
              <TouchableOpacity
                style={{ borderRadius: 7, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 1, borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }}
                onPress={() => { void retryQueuedAssist(selectedItemIndex); }}
              >
                <Text style={{ color: '#92400E', fontSize: 11, fontWeight: '700' }}>Retry</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </Animated.View>

      <Animated.View style={[styles.container, { transform: [{ translateY: bodyTranslateY }] }]}>
        <PyramidGrid
          items={(firstPhotos || []).map((photo, i) => {
            // Handle different photo formats - could be URI string or photo object
            const uri = typeof photo === 'string' ? photo : photo?.uri || photo?.url || String(photo);
            console.log(`[PYRAMID] Photo ${i}:`, typeof photo, uri?.substring(0, 50));
            return { id: `img-${i}-${uri?.slice(-20) || 'empty'}`, uri };
          })}
          style={{
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '40%',
            maxHeight: '55%',
            width: '90%' // Give it more width
          }}
        />
        <StepLoader
          stages={activeStages}
          currentStageIndex={currentStageIndex}
          style={{ paddingTop: 40, marginBottom: 10, maxHeight: '25%', minHeight: '15%' }}
        />
        <View style={{ width: '100%', marginTop: 8, paddingHorizontal: 16 }}>
          <Text style={{ fontSize: 13, color: '#111827', textAlign: 'center', fontWeight: '600' }}>
            Viewing item {selectedItemIndex + 1} of {Math.max(loadingModalItems.length, 1)}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 6 }}>
            <TouchableOpacity
              onPress={() => setSelectedItemIndex((prev) => Math.max(0, prev - 1))}
              style={{ borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 }}
            >
              <Text style={{ color: '#374151', fontSize: 12, fontWeight: '600' }}>Prev</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSelectedItemIndex((prev) => Math.min(Math.max(loadingModalItems.length - 1, 0), prev + 1))}
              style={{ borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingVertical: 4, paddingHorizontal: 10 }}
            >
              <Text style={{ color: '#374151', fontSize: 12, fontWeight: '600' }}>Next</Text>
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 12, color: '#4B5563', textAlign: 'center', marginTop: 4 }} numberOfLines={1}>
            {loadingModalItems[selectedItemIndex]?.title || `Item ${selectedItemIndex + 1}`}
          </Text>
          {currentItemResult?.matchDecisionReason ? (
            <Text style={{ fontSize: 11, color: '#6B7280', textAlign: 'center', marginTop: 4 }} numberOfLines={2}>
              {currentItemResult.matchDecisionReason}
            </Text>
          ) : null}
          {Array.isArray(currentItemResult?.searchAttempts) && currentItemResult.searchAttempts.length > 0 ? (
            <Text style={{ fontSize: 11, color: '#6B7280', textAlign: 'center', marginTop: 4 }} numberOfLines={2}>
              Trail: {currentItemResult.searchAttempts.slice(0, 2).map((a: any) => `${a.source}(${a.resultCount})`).join(' • ')}
            </Text>
          ) : null}
          {currentItemResult?.timing && (
            <Text style={{ fontSize: 11, color: '#6B7280', textAlign: 'center', marginTop: 4 }}>
              quick {Math.round((currentItemResult.timing.quickScanMs || 0) / 1000)}s • search {Math.round((currentItemResult.timing.serpApiMs || 0) / 1000)}s • rank {Math.round((currentItemResult.timing.rerankingMs || 0) / 1000)}s
            </Text>
          )}

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}
          >
            {currentCandidates.slice(0, 8).map((candidate: any, candidateIndex: number) => {
              const isSelected = (selectedCandidateByIndex[selectedItemIndex] ?? 0) === candidateIndex;
              return (
                <TouchableOpacity
                  key={`candidate-${selectedItemIndex}-${candidateIndex}`}
                  onPress={() => setSelectedCandidateByIndex(prev => ({ ...prev, [selectedItemIndex]: candidateIndex }))}
                  style={{
                    width: 120,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: isSelected ? '#93C822' : '#E2E8F0',
                    backgroundColor: isSelected ? '#F7FEE7' : '#FFFFFF',
                    padding: 8,
                  }}
                >
                  {(candidate?.image || candidate?.thumbnail) ? (
                    <Image source={{ uri: candidate?.image || candidate?.thumbnail }} style={{ width: '100%', height: 72, borderRadius: 8, marginBottom: 6 }} resizeMode="cover" />
                  ) : (
                    <View style={{ width: '100%', height: 72, borderRadius: 8, marginBottom: 6, backgroundColor: '#E2E8F0' }} />
                  )}
                  <Text style={{ fontSize: 11, color: '#111827', fontWeight: '600' }} numberOfLines={2}>
                    {candidate?.title || `Candidate ${candidateIndex + 1}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </Animated.View>

      <ItemJobsModal
        visible={jobsModalVisible}
        onClose={() => setJobsModalVisible(false)}
        items={loadingModalItems}
        currentIndex={selectedItemIndex}
        scanColor={() => (jobStatus === 'failed' ? '#EF4444' : '#10B981')}
        matchColor={(index) => getItemState(index).match}
        detailsColor={(index) => getItemState(index).details}
        detailsEnabled={() => true}
        onPickScan={(index) => {
          setSelectedItemIndex(index);
          if (jobStatus === 'failed') {
            navigation.replace('AddProduct' as any, {
              firstPhotos: firstPhotos || [],
              bulkItems: bulkItems || [],
              errorMessage: 'Scan failed. Please retake clearer photos and try again.'
            });
          } else {
            setJobsModalVisible(false);
          }
        }}
        onPickMatch={(index) => {
          setSelectedItemIndex(index);
          setJobsModalVisible(false);
        }}
        onPickDetails={(index) => {
          setSelectedItemIndex(index);
          setJobsModalVisible(false);
        }}
        getSecondaryText={(index) => getItemState(index).secondary}
        onConfirmCandidate={(index) => {
          setSelectedItemIndex(index);
          void onConfirmCandidate(selectedCandidateByIndex[index] ?? 0, index);
        }}
        onDenyCandidate={(index) => {
          setSelectedItemIndex(index);
          void onDenyCandidate(selectedCandidateByIndex[index] ?? 0, index);
        }}
        onSubmitRefineText={(index, text) => {
          setSelectedItemIndex(index);
          void onSubmitRefine(index, text);
        }}
        onGenerateBestGuess={(index) => {
          setSelectedItemIndex(index);
          void onGenerateBestGuess(index);
        }}
        onRetakePhoto={(index) => {
          setJobsModalVisible(false);
          void onRetakePhotoAssist(index);
        }}
      />
    </View>
  );
};

export default LoadingScreen;

const styles = StyleSheet.create({
  font: {
    color: 'black',
    fontSize: 20,
    fontWeight: '400',
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: '100%',
    maxWidth: '100%',
    maxHeight: '80%', // Give more space for images
    paddingHorizontal: 20, // Add some padding
  },
  SoftBlur: {
    color: 'black',
    fontSize: 20,
    fontWeight: '600',
    filter: 'blur(4px)',
    opacity: 0.6,
    textShadowColor: 'rgba(232, 232, 232, 0.7)', // 2. Set shadow color
    textShadowOffset: { width: 0, height: 0 }, // 3. Center the shadow
    textShadowRadius: 10, // 4. Set the blur radius
  },
  MediumBlur: {
    color: 'black',
    fontSize: 20,
    fontWeight: '600',
    filter: 'blur(4px)',
    opacity: 0.2,
    textShadowColor: 'rgba(255, 255, 255, 0.7)', // 2. Set shadow color
    textShadowOffset: { width: 0, height: 0 }, // 3. Center the shadow
    textShadowRadius: 10, // 4. Set the blur radius
  },
});

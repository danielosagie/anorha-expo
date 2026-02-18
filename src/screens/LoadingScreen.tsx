import { useNavigation, useTheme } from '@react-navigation/native';
import React, { useState, useRef, useEffect, useCallback } from 'react';
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
      'Describing product...',
      'Searching eBay...',
      'Selecting best match...',
      'Generating listings...',
      'Creating view',
      'Ready',
    ],
  };

  // Select the correct list of stages based on the processType
  const activeStages = stages[processType];

  // Map backend stage names to UI stage labels (keeps progress bar accurate)
  const stageNameMap: Record<string, string> = {
    // Backend => UI
    'Preparing': 'Indexing web pages',
    'Fetching sources': 'Finding product data',
    'Scraping sources': 'Cleaning data',
    'Generating details': 'Generating listing',
    'Saving drafts': 'Creating view',
    'Ready': 'Ready to review',
    // Fast track stages
    'Describing product...': 'Describing product...',
    'Searching eBay...': 'Searching eBay...',
    'Selecting best match...': 'Selecting best match...',
    'Generating listings...': 'Generating listings...',
  };

  


  // Poll job status using the jobId
  const [navigatedEarly, setNavigatedEarly] = useState(false);
  const BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'https://api.sssync.app';
  const pollingIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = React.useRef(false);
  const consecutivePollFailuresRef = React.useRef(0);
  const notFoundCountRef = React.useRef(0);
  const firstNotFoundAtRef = React.useRef<number | null>(null);

  const NOT_FOUND_CONSECUTIVE_THRESHOLD = 7;
  const NOT_FOUND_WINDOW_MS = 18000;

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
          consecutivePollFailuresRef.current = 0;
          notFoundCountRef.current = 0;
          firstNotFoundAtRef.current = null;
          
          console.log('[POLLING] Job status:', status.status, 'Stage:', status.currentStage);
          
          // Update job status and stage
          setJobStatus(status.status);
          
          // Map backend stages to frontend stage index
          const mappedStage = stageNameMap[status.currentStage] || status.currentStage;
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
            const firstResult = Array.isArray(status.results) && status.results.length > 0 ? status.results[0] : null;
            const shouldSkipToGenerate = firstResult?.skipToGenerate === true && firstResult?.autoGenerateJobId;
            
            if (shouldSkipToGenerate) {
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
              console.log(`[LOADING] Match-and-generate: Match completed, switching to generate job ${firstResult.autoGenerateJobId}`);
              // Switch to polling generate job
              setTimeout(() => {
                navigation.replace('LoadingScreen' as never, {
                  processType: 'generate',
                  payload: { jobId: firstResult.autoGenerateJobId, firstPhotos: [] },
                  onCompleteRoute: {
                    screen: 'GenerateDetailsScreen',
                    params: {
                      jobId: firstResult.autoGenerateJobId,
                      matchJobId: jobId,
                      items: [],
                      jobMap: {},
                      userImagesByIndex: {},
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
              navigation.replace(onCompleteRoute.screen, {
                ...onCompleteRoute.params,
                jobId: status.jobId,
                status: status.status,
                results: status.results,
                summary: status.summary,
                completedAt: status.completedAt,
                items: itemsForModal,
              });
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
          const firstResult = Array.isArray(status.results) && status.results.length > 0 ? status.results[0] : null;
          const shouldSkipToGenerate = firstResult?.skipToGenerate === true && firstResult?.autoGenerateJobId;

          // If fast track with auto-generate, wait for match job to complete then navigate to generate job
          if (shouldSkipToGenerate && status.status === 'completed') {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            console.log(`[LOADING] Fast track completed, navigating to generate job ${firstResult.autoGenerateJobId}`);
            setTimeout(() => {
              navigation.replace('LoadingScreen' as never, {
                processType: 'generate',
                payload: { jobId: firstResult.autoGenerateJobId, firstPhotos: [] },
                onCompleteRoute: {
                  screen: 'GenerateDetailsScreen',
                  params: {
                    jobId: firstResult.autoGenerateJobId,
                    matchJobId: jobId,
                    items: [],
                    jobMap: {},
                    userImagesByIndex: {},
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
            navigation.replace(onCompleteRoute.screen, {
              ...onCompleteRoute.params,
              jobId: status.jobId,
              response: { ...(onCompleteRoute?.params as any)?.response, jobId: status.jobId },
              overrideResults: mergedResults.length > 0 ? mergedResults : undefined,
              preSelectedByProductIndex: Object.keys(preSelectedByProductIndex).length > 0 ? preSelectedByProductIndex : undefined,
              items: itemsForModal,
              userImagesByIndex: (onCompleteRoute?.params as any)?.userImagesByIndex || (Object.keys(userImagesByIndex).length ? userImagesByIndex : undefined),
            });
            return;
          }

          // If completed, stop polling and navigate (redundant if we already navigated early)
          // Check if we should skip to generate (backend set skipToGenerate with autoGenerateJobId)
          const firstResultMatch = Array.isArray(status.results) && status.results.length > 0 ? status.results[0] : null;
          const shouldSkipToGenerateMatch = firstResultMatch?.skipToGenerate === true && firstResultMatch?.autoGenerateJobId;

          if (shouldSkipToGenerateMatch && status.status === 'completed') {
            if (pollingIntervalRef.current) {
              clearInterval(pollingIntervalRef.current);
              pollingIntervalRef.current = null;
            }
            console.log(`[LOADING] Match completed with skipToGenerate, navigating to generate job ${firstResultMatch.autoGenerateJobId}`);
            setTimeout(() => {
              navigation.replace('LoadingScreen' as never, {
                processType: 'generate',
                payload: { jobId: firstResultMatch.autoGenerateJobId, firstPhotos: [] },
                onCompleteRoute: {
                  screen: 'GenerateDetailsScreen',
                  params: {
                    jobId: firstResultMatch.autoGenerateJobId,
                    matchJobId: jobId,
                    items: [],
                    jobMap: {},
                    userImagesByIndex: {},
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
              navigation.replace(onCompleteRoute.screen, {
                ...onCompleteRoute.params,
                jobResults: status.results
              });
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
  }, [jobId, processType, navigation, onCompleteRoute, activeStages]);

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
    const bulk = Array.isArray(bulkItems) ? bulkItems : [];
    const photos = Array.isArray(firstPhotos) ? firstPhotos : [];
    if (bulk.length > 0) {
      return bulk.map((item: any, i: number) => {
        const firstPhoto = item?.photos?.[0];
        const thumb = typeof firstPhoto === 'string' ? firstPhoto : firstPhoto?.uri || firstPhoto?.url || '';
        return { index: i, title: `Item ${i + 1}`, thumb, matchesCount: 0 };
      });
    }
    if (photos.length > 0) {
      return photos.map((p: any, i: number) => {
        const thumb = typeof p === 'string' ? p : p?.uri || p?.url || '';
        return { index: i, title: `Item ${i + 1}`, thumb, matchesCount: 0 };
      });
    }
    return [{ index: 0, title: 'Item 1', thumb: firstPhotos?.[0], matchesCount: 0 }];
  }, [bulkItems, firstPhotos]);

  console.log(`[LOADING] Starting process: "${processType}"`);
  console.log('[LOADING] Payload photos:', firstPhotos);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'white', width: '100%', height: '100%'  }}>
      <TouchableOpacity onPress={() => setJobsModalVisible(true)} style={{ position: 'absolute', top: 48, left: 24, zIndex: 4000, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center' }}>
        <Boxes size={18} color={'#000'} />
        <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Current Jobs</Text>
      </TouchableOpacity>
      <View style={styles.container}>
        <PyramidGrid 
          items={(firstPhotos || []).map((photo, i) => {
            // Handle different photo formats - could be URI string or photo object
            const uri = typeof photo === 'string' ? photo : photo?.uri || photo?.url || String(photo);
            console.log(`[PYRAMID] Photo ${i}:`, typeof photo, uri?.substring(0, 50));
            return { id: `img-${i}-${Date.now()}`, uri };
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
      </View>

      <ItemJobsModal
        visible={jobsModalVisible}
        onClose={() => setJobsModalVisible(false)}
        items={loadingModalItems}
        currentIndex={0}
        scanColor={() => (jobStatus === 'failed' ? '#EF4444' : '#10B981')}
        matchColor={() => '#4B5563'}
        detailsColor={() => (jobStatus === 'completed' ? '#10B981' : jobStatus === 'failed' ? '#EF4444' : '#4B5563')}
        detailsEnabled={() => true}
        onPickScan={() => {
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
        onPickMatch={() => setJobsModalVisible(false)}
        onPickDetails={() => setJobsModalVisible(false)}
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
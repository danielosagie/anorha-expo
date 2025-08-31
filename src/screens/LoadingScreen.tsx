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

  // Destructure the new, more flexible params
  const { processType, payload, onCompleteRoute } = route.params;
  const { jobId, firstPhotos, bulkItems } = payload;

  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [jobStatus, setJobStatus] = useState('queued');
  const [jobsModalVisible, setJobsModalVisible] = useState(false);

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
  };

  


  // Poll job status using the jobId
  const [navigatedEarly, setNavigatedEarly] = useState(false);
  const BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'https://api.sssync.app';

  useEffect(() => {
    if (!jobId) return;

    const pollJobStatus = async () => {
      try {

        

        // Get current user
        async function getToken() { return await ensureSupabaseJwt(); }

        
        // Get auth token
        const { data: { session } } = await supabase.auth.getSession();
        const token = await getToken();

        if (processType === 'generate') {

          const response = await fetch(`https://api.sssync.app/api/products/generate/jobs/${jobId}/status`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          const status = await response.json();
          
          console.log('[POLLING] Job status:', status.status, 'Stage:', status.currentStage);
          
          // Update job status and stage
          setJobStatus(status.status);
          
          // Map backend stages to frontend stage index
          const mappedStage = stageNameMap[status.currentStage] || status.currentStage;
          const stageIndex = activeStages.indexOf(mappedStage);
          if (stageIndex >= 0) {
            setCurrentStageIndex(stageIndex);
          }
          
          // If completed, navigate to next screen
          if (status.status === 'completed') {
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
            console.error('Job failed:', status.error);
            // Handle error - maybe go back or show error screen
          }
          
        } else {

          const response = await fetch(`${BASE_URL}/api/products/match/jobs/${jobId}/status`, {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });
          const status = await response.json();
          
          console.log('[POLLING] Job status:', status.status, 'Stage:', status.currentStage);
          
          // Update job status and stage
          setJobStatus(status.status);
          
          // Map backend stages to frontend stage index
          const stageIndex = activeStages.indexOf(status.currentStage);
          if (stageIndex >= 0) {
            setCurrentStageIndex(stageIndex);
          }
          
          // Early navigate: as soon as we have initial results, go to selection screen (non-blocking rerank/embeddings continue server-side)
          if (!navigatedEarly && Array.isArray(status.results) && status.results.length > 0) {
            setNavigatedEarly(true);
            const itemsForModal = (status.results || []).map((res: any, idx: number) => {
              const first = res?.serpApiData?.[0];
              return {
                index: idx,
                title: first?.title || `Item ${idx + 1}`,
                thumb: first?.image || first?.thumbnail || '',
                matchesCount: Array.isArray(res?.serpApiData) ? res.serpApiData.length : 0,
              };
            });
            navigation.replace(onCompleteRoute.screen, {
              ...onCompleteRoute.params,
              // Prefer passing just jobId so destination polls and hydrates continuously
              response: { jobId: status.jobId },
              items: itemsForModal,
            });
            return; // stop further handling in this tick
          }

          // If completed, navigate (redundant if we already navigated early)
          if (status.status === 'completed' && !navigatedEarly) {
            console.log(`Process "${processType}" complete! Navigating...`);
            setTimeout(() => {
              navigation.replace(onCompleteRoute.screen, {
                ...onCompleteRoute.params,
                jobResults: status.results
              });
            }, 500);
          } else if (status.status === 'failed') {
            console.error('Job failed:', status.error);
            // Handle error - maybe go back or show error screen
          }


        }
        
        
      } catch (error) {
        console.error('[POLLING] Error polling status:', error);
      }
    };

    // Start polling immediately, then every 2 seconds
    pollJobStatus();
    const interval = setInterval(pollJobStatus, 2000);
    
    return () => clearInterval(interval);
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

  console.log(`[LOADING] Starting process: "${processType}"`);
  console.log('[LOADING] Payload photos:', firstPhotos);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'white', width: '100%', height: '100%'  }}>
      <TouchableOpacity onPress={() => setJobsModalVisible(true)} style={{ position: 'absolute', top: 48, left: 24, zIndex: 4000, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.9)', minHeight: 34, borderRadius: 8, borderWidth: 1, borderColor: '#E5E5E5', flexDirection: 'row', alignItems: 'center' }}>
        <Boxes size={18} color={'#000'} />
        <Text style={{ color: '#000', fontWeight: '600', marginLeft: 6 }}>Current Jobs</Text>
      </TouchableOpacity>
      <View style={styles.container}>
        <PyramidGrid items={(firstPhotos || []).map((u, i) => ({ id: `img-${i}-${u}`, uri: String(u) }))} style={{ justifyContent: 'center', alignItems: 'center', maxHeight: '50%'}} />
        <StepLoader 
          stages={activeStages} 
          currentStageIndex={currentStageIndex}
          style={{ paddingTop: 60, marginBottom: 10, maxHeight: '25%', minHeight: '10%' }}
        />
      </View>

      <ItemJobsModal
        visible={jobsModalVisible}
        onClose={() => setJobsModalVisible(false)}
        items={[{ index: 0, title: 'Item 1', thumb: firstPhotos?.[0], matchesCount: 0 }]}
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
    maxHeight: '60%',
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
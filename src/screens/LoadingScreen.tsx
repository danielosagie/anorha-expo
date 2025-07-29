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
import { supabase } from '../lib/supabase';


type LoadingScreenProps = StackScreenProps<AppStackParamList, 'LoadingScreen'>;

const LoadingScreen: React.FC<LoadingScreenProps> = ({ route, navigation }) => {
  const theme = useTheme();

  // Destructure the new, more flexible params
  const { processType, payload, onCompleteRoute } = route.params;
  const { jobId, firstPhotos, bulkItems } = payload;

  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [jobStatus, setJobStatus] = useState('queued');

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

  // Poll job status using the jobId
  useEffect(() => {
    if (!jobId) return;

    const pollJobStatus = async () => {
      try {

        // Get current user
        async function getToken() {
          const { data: { user }, error: userError } = await supabase.auth.getUser();
          const session = await supabase.auth.getSession();
          const token = session?.data.session?.access_token;
          return token;
        }

        
        // Get auth token
        const { data: { session } } = await supabase.auth.getSession();
        const token = await getToken();
        
        const response = await fetch(`https://api.sssync.app/api/products/match/jobs/${jobId}/status`, {
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
        
        // If completed, navigate to next screen
        if (status.status === 'completed') {
          console.log(`Process "${processType}" complete! Navigating...`);
          setTimeout(() => {
            navigation.replace(onCompleteRoute.screen, {
              ...onCompleteRoute.params,
              jobResults: status.results
            });
          }, 1000);
        } else if (status.status === 'failed') {
          console.error('Job failed:', status.error);
          // Handle error - maybe go back or show error screen
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
      <View style={styles.container}>
        <PyramidGrid items={firstPhotos} style={{ justifyContent: 'center', alignItems: 'center', maxHeight: '50%'}} />
        <StepLoader 
          stages={activeStages} 
          currentStageIndex={currentStageIndex}
          style={{ paddingTop: 60, marginBottom: 10, maxHeight: '25%', minHeight: '10%' }}
        />
      </View>
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
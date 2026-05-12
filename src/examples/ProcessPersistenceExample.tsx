/**
 * EXAMPLE: How to integrate process persistence into your screens
 * 
 * This shows the key patterns for:
 * 1. Creating processes when starting workflows
 * 2. Updating progress during long operations  
 * 3. Resuming processes from previous sessions
 * 4. Handling errors and cleanup
 */

import React, { useEffect, useState, useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import { SessionContext } from '../context/SessionContext';
import { useProcessState } from '../hooks/useProcessState';
import { useProcessPersistence } from '../utils/ProcessHelpers';
import { ProcessStatus } from '../utils/ProcessPersistence';

type Props = StackScreenProps<AppStackParamList, 'AddListingScreen'>;

// Example listing stages - replace with your actual stages
enum ListingStage {
  PLATFORM_SELECTION = 'PLATFORM_SELECTION',
  IMAGE_INPUT = 'IMAGE_INPUT',
  ANALYZING = 'ANALYZING',
  GENERATING = 'GENERATING',
  FORM_REVIEW = 'FORM_REVIEW',
  PUBLISHING = 'PUBLISHING',
}

const ProcessPersistenceExample: React.FC<Props> = ({ route, navigation }) => {
  // Get resumeProcessId from navigation params if resuming
  const resumeProcessId = route.params?.resumeProcessId;
  
  const [currentProcessId, setCurrentProcessId] = useState<string | null>(resumeProcessId || null);
  const [currentStage, setCurrentStage] = useState<ListingStage>(ListingStage.PLATFORM_SELECTION);
  const [isLoading, setIsLoading] = useState(false);
  
  const sessionContext = useContext(SessionContext);
  const { process, updateStatus, updateProgress, updateData } = useProcessState(currentProcessId);
  const {
    createListingProcess,
    updateListingStage,
    completeProcess,
    failProcess,
    getProcessData,
  } = useProcessPersistence();

  // Resume from existing process if provided
  useEffect(() => {
    if (resumeProcessId && !process) {
      console.log('[Example] Resuming process:', resumeProcessId);
      
      // Get the process data to restore state
      const processData = getProcessData(resumeProcessId);
      if (processData) {
        setCurrentStage(processData.listingStage || ListingStage.PLATFORM_SELECTION);
        // Restore other state as needed...
        console.log('[Example] Restored state from process:', processData);
      }
    }
  }, [resumeProcessId, process]);

  // Create a new process when starting fresh
  const startNewListing = async () => {
    if (!sessionContext?.user?.id) return;

    try {
      setIsLoading(true);
      
      // Create the process
      const processId = await createListingProcess(sessionContext.user.id, {
        images: [], // Start with empty images
        selectedPlatforms: [],
        listingStage: ListingStage.PLATFORM_SELECTION,
      });
      
      setCurrentProcessId(processId);
      setCurrentStage(ListingStage.PLATFORM_SELECTION);
      
      console.log('[Example] Created new listing process:', processId);
    } catch (error) {
      console.error('[Example] Failed to create process:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Simulate moving to next stage with progress updates
  const moveToNextStage = async () => {
    if (!currentProcessId) return;

    const stages = Object.values(ListingStage);
    const currentIndex = stages.indexOf(currentStage);
    const nextIndex = Math.min(currentIndex + 1, stages.length - 1);
    const nextStage = stages[nextIndex];
    
    if (nextIndex === currentIndex) {
      // We're at the last stage - complete the process
      await completeProcess(currentProcessId);
      navigation.goBack();
      return;
    }

    try {
      setIsLoading(true);
      
      // Calculate progress based on stage
      const progress = ((nextIndex + 1) / stages.length) * 100;
      
      // Update the process with new stage and progress
      await updateListingStage(currentProcessId, nextStage, progress, {
        // Add any stage-specific data here
        timestamp: Date.now(),
      });
      
      setCurrentStage(nextStage);
      
      // Simulate some work for this stage
      if (nextStage === ListingStage.ANALYZING || nextStage === ListingStage.GENERATING) {
        await simulateLongRunningTask(currentProcessId, nextStage);
      }
      
    } catch (error) {
      console.error('[Example] Failed to move to next stage:', error);
      await failProcess(currentProcessId, error.message);
    } finally {
      setIsLoading(false);
    }
  };

  // Simulate a long-running task that can be interrupted
  const simulateLongRunningTask = async (processId: string, stage: ListingStage) => {
    console.log(`[Example] Starting long task for stage: ${stage}`);
    
    // Simulate progress updates during the task
    for (let i = 0; i <= 100; i += 10) {
      await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay
      
      // Update progress within this stage
      const stageProgress = (Object.values(ListingStage).indexOf(stage) / Object.values(ListingStage).length) * 100;
      const taskProgress = (i / 100) * 20; // This task represents 20% of total progress
      
      await updateProgress?.(stageProgress + taskProgress);
      console.log(`[Example] Task progress: ${i}%`);
    }
    
    console.log(`[Example] Completed long task for stage: ${stage}`);
  };

  // Handle app backgrounding - pause the process
  useEffect(() => {
    const handleAppStateChange = (nextAppState: string) => {
      if (currentProcessId && isLoading) {
        if (nextAppState === 'background') {
          console.log('[Example] App backgrounded during process, marking as paused');
          updateStatus?.(ProcessStatus.PAUSED);
        } else if (nextAppState === 'active') {
          console.log('[Example] App resumed, continuing process');
          updateStatus?.(ProcessStatus.IN_PROGRESS);
        }
      }
    };

    // In a real app, you'd use AppState.addEventListener
    // This is just for demonstration
    
    return () => {
      // Cleanup listener
    };
  }, [currentProcessId, isLoading]);

  const getStageTitle = (stage: ListingStage): string => {
    switch (stage) {
      case ListingStage.PLATFORM_SELECTION: return 'Select Platforms';
      case ListingStage.IMAGE_INPUT: return 'Add Images';
      case ListingStage.ANALYZING: return 'Analyzing Images';
      case ListingStage.GENERATING: return 'Generating Details';
      case ListingStage.FORM_REVIEW: return 'Review Details';
      case ListingStage.PUBLISHING: return 'Publishing';
      default: return 'Unknown Stage';
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Process Persistence Example</Text>
      
      {resumeProcessId && (
        <Text style={styles.resumeText}>
          Resuming process: {resumeProcessId.substring(0, 8)}...
        </Text>
      )}
      
      {currentProcessId ? (
        <View style={styles.processContainer}>
          <Text style={styles.stageTitle}>{getStageTitle(currentStage)}</Text>
          
          {process && (
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>
                Progress: {Math.round(process.progress)}%
              </Text>
              <View style={styles.progressBar}>
                <View 
                  style={[styles.progressFill, { width: `${process.progress}%` }]} 
                />
              </View>
              <Text style={styles.statusText}>
                Status: {process.status}
              </Text>
            </View>
          )}
          
          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={moveToNextStage}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>Next Stage</Text>
            )}
          </TouchableOpacity>
          
          <TouchableOpacity
            style={styles.cancelButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.startContainer}>
          <Text style={styles.description}>
            This example shows how to implement process persistence.
            Start a new listing and try backgrounding the app or force-closing it
            during the process, then reopen to see resumption in action.
          </Text>
          
          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={startNewListing}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.buttonText}>Start New Listing</Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#F2F2F7',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  resumeText: {
    fontSize: 14,
    color: '#007AFF',
    textAlign: 'center',
    marginBottom: 20,
    fontStyle: 'italic',
  },
  processContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  description: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 30,
    lineHeight: 22,
  },
  stageTitle: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 30,
    textAlign: 'center',
  },
  progressContainer: {
    width: '100%',
    marginBottom: 40,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 10,
  },
  progressBar: {
    width: '100%',
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  statusText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 40,
    paddingVertical: 15,
    borderRadius: 8,
    marginBottom: 15,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#CCCCCC',
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    paddingHorizontal: 40,
    paddingVertical: 15,
  },
  cancelButtonText: {
    color: '#FF3B30',
    fontSize: 16,
    fontWeight: '500',
  },
});

export default ProcessPersistenceExample;

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


type LoadingScreenProps = StackScreenProps<AppStackParamList, 'LoadingScreen'>;

const LoadingScreen: React.FC<LoadingScreenProps> = ({ route, navigation }) => {
  const theme = useTheme();

  // Destructure the new, more flexible params
  const { processType, payload, onCompleteRoute } = route.params;
  const { firstPhotos, bulkItems } = payload;

  const [currentStageIndex, setCurrentStageIndex] = useState(0);

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

  // This effect handles advancing the loader through the stages.
  useEffect(() => {
    // Stop the timer when we've reached the final stage.
    if (currentStageIndex >= activeStages.length - 1) {
      return;
    }

    const stageTimer = setTimeout(() => {
      setCurrentStageIndex(prevIndex => prevIndex + 1);
    }, 1500);

    return () => clearTimeout(stageTimer);
  }, [currentStageIndex, activeStages.length]);

  // This separate effect handles the final navigation after a delay.
  useEffect(() => {
    // Only run this when the current stage is the last one.
    if (currentStageIndex === activeStages.length - 1) {
      console.log(`Process "${processType}" complete! Navigating in 2 seconds...`);
      const navigationTimer = setTimeout(() => {
        navigation.replace(onCompleteRoute.screen, onCompleteRoute.params);
      }, 2000); // Wait for 2 seconds before navigating.

      return () => clearTimeout(navigationTimer);
    }
  }, [currentStageIndex, activeStages.length, processType, onCompleteRoute, navigation]);

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
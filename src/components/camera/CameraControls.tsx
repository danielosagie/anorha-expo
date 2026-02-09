import React from 'react';
import { 
  View, 
  StyleSheet, 
  TouchableOpacity, 
  SafeAreaView,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { FlashMode } from 'expo-camera';

interface CameraControlsProps {
  flash: FlashMode;
  onToggleFlash: () => void;
  onPastScans: () => void;
}

const CameraControls: React.FC<CameraControlsProps> = ({ 
  flash, 
  onToggleFlash, 
  onPastScans,
}) => {
  const getFlashIcon = () => {
    switch (flash) {
      case 'on': return 'flash';
      case 'auto': return 'flash-auto';
      case 'off': return 'flash-off';
      default: return 'flash-off';
    }
  };

  return (
    <SafeAreaView style={styles.cameraControlsContainer}>
      <Animated.View entering={FadeIn.delay(300)} style={styles.cameraControlsContent}>
        <TouchableOpacity style={styles.controlButton} onPress={onToggleFlash}>
          <Icon name={getFlashIcon()} size={22} color="white" />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.controlButton} onPress={onPastScans}>
          <Icon name="history" size={22} color="white" />
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  cameraControlsContainer: {
    position: 'absolute',
    top: 100,
    right: 0,
    zIndex: 10,
  },
  cameraControlsContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 12,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
    borderColor: "rgba(255,255,255,0.3)",
    borderWidth: 2
  },
});

export default CameraControls;
export type { CameraControlsProps }; 
import React from 'react';
import { 
  View, 
  StyleSheet, 
  TouchableOpacity, 
  SafeAreaView,
  Text,
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
        <View style={styles.controlGroup}>
          <TouchableOpacity style={styles.controlButton} onPress={onToggleFlash}>
            <Icon name={getFlashIcon()} size={22} color="white" />
          </TouchableOpacity>
          <Text style={styles.controlLabel}>Flash</Text>
        </View>
        
        <View style={styles.controlGroup}>
          <TouchableOpacity style={styles.controlButton} onPress={onPastScans}>
            <Icon name="history" size={22} color="white" />
          </TouchableOpacity>
          <Text style={styles.controlLabel}>History</Text>
        </View>
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
    gap: 16,
  },
  controlGroup: {
    alignItems: 'center',
    gap: 4,
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
  controlLabel: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
  },
});

export default CameraControls;
export type { CameraControlsProps }; 
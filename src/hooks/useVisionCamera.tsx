import { useState, useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';
import { CapturedMediaItem } from '../screens/AddListingScreen';

export const useVisionCamera = (onMediaCaptured: (media: CapturedMediaItem[]) => void) => {
  const [showCamera, setShowCamera] = useState(false);
  const [initialMedia, setInitialMedia] = useState<CapturedMediaItem[]>([]);
  const { hasPermission: hasCameraPermission, requestPermission: requestCameraPermission } = useCameraPermission();
  const { hasPermission: hasMicrophonePermission, requestPermission: requestMicrophonePermission } = useMicrophonePermission();

  const openCamera = useCallback(async (existingMedia: CapturedMediaItem[] = []) => {
    // Request camera permission if not already granted
    if (!hasCameraPermission) {
      const granted = await requestCameraPermission();
      if (!granted) {
        Alert.alert(
          'Camera Permission Required',
          'To take photos or scan barcodes, please grant camera permission in your device settings.',
          [{ text: 'OK' }]
        );
        return;
      }
    }

    // Request microphone permission if not already granted (for video recording)
    if (!hasMicrophonePermission) {
      const granted = await requestMicrophonePermission();
      if (!granted) {
        Alert.alert(
          'Microphone Permission Required',
          'To record video with audio, please grant microphone permission in your device settings.',
          [{ text: 'OK' }]
        );
        // We can still proceed with camera without microphone (silent videos)
      }
    }

    // Set any existing media
    setInitialMedia(existingMedia);
    
    // Open the camera
    setShowCamera(true);
  }, [hasCameraPermission, requestCameraPermission, hasMicrophonePermission, requestMicrophonePermission]);

  const closeCamera = useCallback(() => {
    setShowCamera(false);
    setInitialMedia([]);
  }, []);

  const handleMediaCaptured = useCallback((media: CapturedMediaItem[]) => {
    closeCamera();
    onMediaCaptured(media);
  }, [onMediaCaptured, closeCamera]);

  return {
    showCamera,
    initialMedia,
    openCamera,
    closeCamera,
    handleMediaCaptured,
  };
};

export default useVisionCamera; 
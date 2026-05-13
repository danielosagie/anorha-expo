import React, { useState, useRef, useCallback, useMemo } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import type { CameraCapturedPicture } from 'expo-camera';
import type { CapturedMediaItem } from '../screens/AddListingScreen';
import { useProductDetection } from './ProductDetectionProcessor';

interface VisionCameraProps {
  onCapture: (media: CapturedMediaItem[]) => void;
  onClose: () => void;
  styles: Record<string, any>;
  initialMedia?: CapturedMediaItem[];
}

const VisionCamera: React.FC<VisionCameraProps> = ({ onCapture, onClose, styles: propStyles, initialMedia = [] }) => {
  const [media, setMedia] = useState<CapturedMediaItem[]>(initialMedia);
  const [flash, setFlash] = useState<'off' | 'on' | 'auto'>('off');
  const [facing, setFacing] = useState<'back' | 'front'>('back');
  const [isActive, setIsActive] = useState(true);
  const [isProcessingCapture, setIsProcessingCapture] = useState(false);
  const [showBarcodeInfo, setShowBarcodeInfo] = useState(false);
  const [barcodeValue, setBarcodeValue] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);

  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice(facing);
  const cameraRef = useRef<Camera>(null);
  
  // Use our product detection frame processor
  const { frameProcessor, productInfo } = useProductDetection();

  // Request permissions on component mount
  useFocusEffect(
    useCallback(() => {
      if (!hasPermission) {
        requestPermission();
      }
      setIsFocused(true);
      
      return () => {
        setIsActive(false);
        setIsFocused(false);
      };
    }, [hasPermission, requestPermission])
  );

  // Barcode scanner implementation
  const codeScanner = useCodeScanner({
    codeTypes: ['qr', 'ean-13', 'ean-8', 'upc-e', 'upc-a', 'code-128', 'code-39', 'code-93'],
    onCodeScanned: (codes) => {
      if (codes.length > 0) {
        const code = codes[0];
        console.log(`Barcode detected: ${code.value} (${code.type})`);
        setBarcodeValue(code.value);
        setShowBarcodeInfo(true);
      }
    }
  });

  // Functions to capture images
  const takePicture = async () => {
    if (cameraRef.current && !isProcessingCapture) {
      try {
        setIsProcessingCapture(true);
        const photo = await cameraRef.current.takePhoto({
          flash: flash === 'on' ? 'on' : flash === 'auto' ? 'auto' : 'off',
          quality: 90,
        });
        
        const newMediaItem: CapturedMediaItem = {
          uri: `file://${photo.path}`,
          width: photo.width,
          height: photo.height,
          type: 'image',
          number: media.length + 1,
          id: `image-${Date.now()}`,
        };
        
        const updatedMedia = [...media, newMediaItem];
        setMedia(updatedMedia);
        
        // Hide barcode info after capturing an image
        setShowBarcodeInfo(false);
      } catch (error) {
        console.error('Error taking picture:', error);
      } finally {
        setIsProcessingCapture(false);
      }
    }
  };

  const toggleFlash = () => setFlash(current => current === 'off' ? 'on' : current === 'on' ? 'auto' : 'off');
  const toggleCameraFacing = () => setFacing(current => current === "back" ? "front" : "back");
  const getFlashIcon = () => flash === 'on' ? 'flash' : flash === 'auto' ? 'flash-auto' : 'flash-off';

  const handleClose = useCallback(() => {
    setIsActive(false);
    setIsFocused(false);
    setTimeout(() => onClose(), 100);
  }, [onClose]);

  const handleSave = useCallback(() => {
    setIsActive(false);
    setIsFocused(false);
    const captured = media;
    setTimeout(() => onCapture(captured), 100);
  }, [onCapture, media]);

  if (!hasPermission) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>Camera permission is required</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionText}>No camera device found</Text>
      </View>
    );
  }

  // Calculate the bounding box for product detection overlay
  const getBoundingBoxStyle = () => {
    if (!productInfo.productDetected || !productInfo.boundingBox) return null;
    
    const { x, y, width, height } = productInfo.boundingBox;
    
    return {
      position: 'absolute',
      left: `${x * 100}%`,
      top: `${y * 100}%`,
      width: `${width * 100}%`,
      height: `${height * 100}%`,
      borderWidth: 2,
      borderColor: productInfo.confidence > 0.7 ? '#4CAF50' : '#FFC107', // Green if high confidence, yellow if lower
      borderRadius: 8,
    };
  };

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={styles.camera}
        device={device}
        isActive={isActive && isFocused}
        photo={true}
        codeScanner={codeScanner}
        frameProcessor={frameProcessor}
        frameProcessorFps={5}
      />

      {/* Product detection overlay */}
      {productInfo.productDetected && productInfo.boundingBox && (
        <View style={[styles.productOverlay, getBoundingBoxStyle()]}>
          <View style={styles.confidenceIndicator}>
            <Text style={styles.confidenceText}>
              {Math.round(productInfo.confidence * 100)}%
            </Text>
          </View>
        </View>
      )}

      {/* Barcode info overlay */}
      {showBarcodeInfo && (
        <View style={styles.barcodeOverlay}>
          <Text style={styles.barcodeText}>Barcode detected: {barcodeValue}</Text>
          <TouchableOpacity 
            style={styles.captureBarcodeButton}
            onPress={() => {
              setShowBarcodeInfo(false);
              // Here you could process the barcode value directly
              // For example, fetching product info using the barcode
            }}>
            <Text style={styles.captureBarcodeButtonText}>Use Barcode</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Camera controls */}
      <View style={styles.controlsContainer}>
        <TouchableOpacity style={styles.controlButton} onPress={toggleFlash}>
          <Ionicons name={getFlashIcon()} size={24} color="white" />
        </TouchableOpacity>

        <TouchableOpacity 
          style={[
            styles.captureButton, 
            productInfo.productDetected && productInfo.confidence > 0.8 && styles.captureButtonHighlight
          ]} 
          onPress={takePicture}
          disabled={isProcessingCapture}>
          {isProcessingCapture ? 
            <ActivityIndicator size="small" color="#fff" /> : 
            <View style={styles.captureButtonInner} />
          }
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={toggleCameraFacing}>
          <Ionicons name="camera-reverse" size={24} color="white" />
        </TouchableOpacity>
      </View>

      {/* Bottom toolbar */}
      <View style={styles.bottomToolbar}>
        <TouchableOpacity style={styles.toolbarButton} onPress={handleClose}>
          <Text style={styles.toolbarButtonText}>Cancel</Text>
        </TouchableOpacity>

        <Text style={styles.mediaCount}>{media.length} Photos</Text>

        <TouchableOpacity 
          style={[styles.toolbarButton, media.length === 0 && styles.disabledButton]} 
          onPress={handleSave}
          disabled={media.length === 0}>
          <Text style={[styles.toolbarButtonText, media.length === 0 && styles.disabledButtonText]}>
            Done
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  camera: {
    flex: 1,
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 80,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButton: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  captureButtonHighlight: {
    backgroundColor: 'rgba(76,175,80,0.3)', // Green highlight when product is detected with high confidence
  },
  captureButtonInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'white',
  },
  bottomToolbar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: 'rgba(0,0,0,0.8)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  toolbarButton: {
    padding: 10,
  },
  toolbarButtonText: {
    color: 'white',
    fontSize: 16,
  },
  mediaCount: {
    color: 'white',
    fontSize: 14,
  },
  disabledButton: {
    opacity: 0.5,
  },
  disabledButtonText: {
    color: 'rgba(255,255,255,0.5)',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
  permissionText: {
    color: 'white',
    fontSize: 16,
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#2196F3',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
  },
  permissionButtonText: {
    color: 'white',
    fontSize: 16,
  },
  barcodeOverlay: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
  },
  barcodeText: {
    color: 'white',
    fontSize: 16,
    marginBottom: 10,
  },
  captureBarcodeButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 5,
  },
  captureBarcodeButtonText: {
    color: 'white',
    fontSize: 14,
  },
  productOverlay: {
    borderWidth: 2,
    borderColor: '#4CAF50',
    position: 'absolute',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  confidenceIndicator: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    position: 'absolute',
    top: -20,
    left: 10,
  },
  confidenceText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
});

export default VisionCamera; 
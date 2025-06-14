import React, { useCallback, useEffect } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Linking, Platform, Alert } from 'react-native';
import { Camera, useCameraDevice, useCodeScanner, Code } from 'react-native-vision-camera';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useIsFocused } from '@react-navigation/native';

interface BarcodeScannerProps {
  onClose: () => void;
  onCodeScanned: (code: string) => void;
}

const BarcodeScanner: React.FC<BarcodeScannerProps> = ({ onClose, onCodeScanned }) => {
  const device = useCameraDevice('back');
  const isFocused = useIsFocused();

  useEffect(() => {
    const checkPermissions = async () => {
      const status = await Camera.getCameraPermissionStatus();
      if (status !== 'granted') {
        const newStatus = await Camera.requestCameraPermission();
        if (newStatus !== 'granted') {
          Alert.alert(
            'Permission Required',
            'Camera permission is required to scan barcodes. Please grant permission in your device settings.',
            [
              { text: 'Cancel', onPress: onClose, style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
        }
      }
    };
    checkPermissions();
  }, [onClose]);

  const handleCodeScanned = useCallback((codes: Code[]) => {
    if (codes.length > 0) {
      let scannedCode = codes[0];
      console.log('Scanned code:', scannedCode);

      let finalValue = scannedCode.value;

      // Handle UPC-A / EAN-13 conversion for iOS
      if (Platform.OS === 'ios' && scannedCode.type === 'ean-13' && finalValue?.startsWith('0')) {
        const upcACode = finalValue.substring(1);
        // Basic validation for UPC-A
        if (upcACode.length === 12 && /^\d+$/.test(upcACode)) {
          console.log(`Converted EAN-13 to UPC-A: ${upcACode}`);
          finalValue = upcACode;
        }
      }
      
      if (finalValue) {
        onCodeScanned(finalValue);
      }
    }
  }, [onCodeScanned]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr', 'ean-13', 'upc-a', 'upc-e', 'code-128'],
    onCodeScanned: handleCodeScanned,
  });

  if (device == null) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>No camera device found.</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Icon name="close" size={30} color="white" />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isFocused}
        codeScanner={codeScanner}
        torch={'off'}
      />
      <View style={styles.overlay}>
        <View style={styles.viewfinder} />
        <Text style={styles.promptText}>Point camera at a barcode</Text>
      </View>
      <TouchableOpacity onPress={onClose} style={styles.closeButton}>
        <Icon name="close" size={30} color="white" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  errorText: {
    color: 'white',
    fontSize: 18,
    textAlign: 'center',
    marginTop: '50%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinder: {
    width: 250,
    height: 250,
    borderColor: 'white',
    borderWidth: 2,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  promptText: {
    color: 'white',
    fontSize: 16,
    marginTop: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
  },
  closeButton: {
    position: 'absolute',
    top: 50,
    right: 20,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 20,
  },
});

export default BarcodeScanner; 
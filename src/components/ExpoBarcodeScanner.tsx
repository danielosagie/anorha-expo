import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Easing } from 'react-native';
import { Camera, CameraView, BarcodeScanningResult } from 'expo-camera';
import Svg, { Circle } from 'react-native-svg';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface ExpoBarcodeScannerProps {
  onClose: () => void;
  onCodeScanned: (code: string) => void;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const CIRCLE_RADIUS = 50;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

const ExpoBarcodeScanner: React.FC<ExpoBarcodeScannerProps> = ({ onClose, onCodeScanned }) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const [active, setActive] = useState(true);
  const animationProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const getCameraPermissions = async () => {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    };

    getCameraPermissions();
  }, []);

  const startAnimation = () => {
    Animated.timing(animationProgress, {
      toValue: 1,
      duration: 700,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start(() => {
      // Animation completes
    });
  };

  const handleBarCodeScanned = (scanningResult: BarcodeScanningResult) => {
    if (!scanned && scanningResult.data) {
      setScanned(true);
      startAnimation();
      setTimeout(() => {
        setActive(false);
        setTimeout(() => onCodeScanned(scanningResult.data), 100);
      }, 800);
    }
  };

  const handleClose = () => {
    setActive(false);
    setTimeout(() => onClose(), 100);
  };

  if (hasPermission === null) {
    return <View style={styles.container}><Text style={styles.infoText}>Requesting for camera permission...</Text></View>;
  }
  if (hasPermission === false) {
    return <View style={styles.container}><Text style={styles.infoText}>No access to camera</Text></View>;
  }

  return (
    <View style={styles.container}>
      <CameraView
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
        style={StyleSheet.absoluteFillObject}
        active={active}
        barcodeScannerSettings={{
            barcodeTypes: ["qr", "ean13", "upc_a", "upc_e", "code128"],
        }}
      />
      <View style={styles.overlay}>
        <View style={styles.viewfinder} />
        {scanned ? (
            <View style={styles.animationContainer}>
                <Svg width={CIRCLE_RADIUS * 2 + 20} height={CIRCLE_RADIUS * 2 + 20}>
                    <AnimatedCircle
                        cx={CIRCLE_RADIUS + 10}
                        cy={CIRCLE_RADIUS + 10}
                        r={CIRCLE_RADIUS}
                        stroke="#4CAF50"
                        strokeWidth={5}
                        fill="transparent"
                        strokeDasharray={CIRCLE_CIRCUMFERENCE}
                        strokeDashoffset={animationProgress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [CIRCLE_CIRCUMFERENCE, 0],
                        })}
                        strokeLinecap="round"
                    />
                </Svg>
                <Icon name="check-bold" size={50} color="#4CAF50" style={styles.checkIcon} />
            </View>
        ) : (
            <Text style={styles.promptText}>Point camera at a barcode</Text>
        )}
      </View>
      <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
        <Icon name="close" size={30} color="white" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
  },
  infoText: {
      color: 'white',
      fontSize: 18,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewfinder: {
    width: 280,
    height: 280,
    borderColor: 'rgba(255, 255, 255, 0.5)',
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
  animationContainer: {
    width: CIRCLE_RADIUS * 2 + 20,
    height: CIRCLE_RADIUS * 2 + 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  checkIcon: {
      position: 'absolute',
  }
});

export default ExpoBarcodeScanner; 
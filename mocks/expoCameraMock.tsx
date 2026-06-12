/** Web mock for expo-camera (native CameraView can't render on web). */
import React from 'react';
import { View, Image, StyleSheet } from 'react-native';

// A stand-in "camera feed" image so the viewfinder looks live on web.
const FAKE_FEED = 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=70';

export const CameraView = React.forwardRef((props: any, _ref: any) => (
  <View style={[styles.cam, props?.style]}>
    <Image source={{ uri: FAKE_FEED }} style={StyleSheet.absoluteFill as any} resizeMode="cover" />
    {props?.children}
  </View>
));

export const Camera = {
  getCameraPermissionsAsync: async () => ({ granted: true, status: 'granted', canAskAgain: false }),
  requestCameraPermissionsAsync: async () => ({ granted: true, status: 'granted', canAskAgain: false }),
};

export const CameraType = { back: 'back', front: 'front' };
export const FlashMode = { off: 'off', on: 'on', auto: 'auto', torch: 'torch' };

export const useCameraPermissions = () => [
  { granted: true, status: 'granted', canAskAgain: false },
  async () => ({ granted: true, status: 'granted', canAskAgain: false }),
];

export type BarcodeScanningResult = { data: string; type: string };

export default { CameraView, Camera, CameraType, FlashMode, useCameraPermissions };

const styles = StyleSheet.create({
  cam: { flex: 1, minHeight: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1F2937' },
  camText: { color: '#9CA3AF', fontSize: 14 },
});

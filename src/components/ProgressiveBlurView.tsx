import React from 'react';
import { StyleProp, StyleSheet, UIManager, View, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';

// The progressive-blur effect needs the native RNCMaskedView view manager. masked-view
// registers through the legacy/interop view-manager path here (even on the New
// Architecture), so UIManager.getViewManagerConfig is a reliable probe: it returns the
// config when the native module is compiled into the build, and null when it isn't.
//
// When it's absent (an old dev client built BEFORE the masked-view dependency was added,
// or Expo Go), mounting MaskedView throws "View config not found for component
// RNCMaskedView" as a fatal redbox that the error boundary below can't swap out in time.
// So we detect availability up front and render the plain uniform BlurView fallback
// instead. A build that includes masked-view passes this check and gets the real blur —
// the fix for a flat blur is to REBUILD/REINSTALL, not to bypass this gate.
const MASKED_VIEW_AVAILABLE = !!(
  (UIManager.getViewManagerConfig && UIManager.getViewManagerConfig('RNCMaskedView')) ||
  (UIManager.hasViewManagerConfig && UIManager.hasViewManagerConfig('RNCMaskedView'))
);

type Props = {
  /** Max blur intensity (at the strong edge). expo-blur scale 0-100. */
  intensity?: number;
  tint?: 'light' | 'dark' | 'default';
  /** 'down' = strongest at the top, fading toward the bottom (header default). */
  direction?: 'down' | 'up';
  style?: StyleProp<ViewStyle>;
};

// iOS-style progressive (variable-radius) blur: a few BlurView layers, each masked
// by a gradient so higher-intensity layers are confined to a narrowing band at the
// strong edge. Overlapping layers compound into a smooth blur that fades to clear,
// instead of expo-blur's single uniform blur. Technique from rit3zh/expo-progressive-blur
// (masked-view + gradient).
function ProgressiveBlurViewInner({ intensity = 48, tint = 'light', direction = 'down', style }: Props) {
  const layers = [
    { intensity: Math.max(2, Math.round(intensity * 0.3)), fadeEnd: 1.0 },
    { intensity: Math.max(3, Math.round(intensity * 0.55)), fadeEnd: 0.62 },
    { intensity: Math.max(4, Math.round(intensity * 0.8)), fadeEnd: 0.38 },
    { intensity, fadeEnd: 0.2 },
  ];

  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {layers.map((layer, i) => {
        // 'down': opaque at the top, fading to transparent at fadeEnd (blur lives up top).
        // 'up': mirror it so the blur lives at the bottom.
        const colors: [string, string, string] = ['#000000', '#000000', 'rgba(0,0,0,0)'];
        const locDown = [0, layer.fadeEnd * 0.6, layer.fadeEnd];
        const locUp = [1 - layer.fadeEnd, 1 - layer.fadeEnd * 0.6, 1];
        return (
          <MaskedView
            key={i}
            style={StyleSheet.absoluteFill}
            maskElement={
              <LinearGradient
                colors={direction === 'up' ? ([...colors].reverse() as [string, string, string]) : colors}
                locations={(direction === 'up' ? locUp : locDown) as [number, number, number]}
                style={StyleSheet.absoluteFill}
              />
            }
          >
            <BlurView intensity={layer.intensity} tint={tint} style={StyleSheet.absoluteFill} />
          </MaskedView>
        );
      })}
    </View>
  );
}

class BlurBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Progressive blur with a safe fallback. If the native masked-view module isn't in
 * the build yet (an un-rebuilt dev client), the masked layers throw on mount and the
 * boundary renders the previous uniform BlurView instead of crashing the screen.
 */
export function ProgressiveBlurView(props: Props) {
  // No native masked-view in this runtime → render a plain uniform blur and never
  // mount MaskedView (avoids the fatal "View config not found" redbox).
  if (!MASKED_VIEW_AVAILABLE) {
    return (
      <BlurView
        intensity={props.intensity ?? 24}
        tint={props.tint ?? 'light'}
        style={[StyleSheet.absoluteFill, props.style]}
        pointerEvents="none"
      />
    );
  }
  return (
    <BlurBoundary
      fallback={
        <BlurView
          intensity={props.intensity ?? 24}
          tint={props.tint ?? 'light'}
          style={[StyleSheet.absoluteFill, props.style]}
          pointerEvents="none"
        />
      }
    >
      <ProgressiveBlurViewInner {...props} />
    </BlurBoundary>
  );
}

export default ProgressiveBlurView;

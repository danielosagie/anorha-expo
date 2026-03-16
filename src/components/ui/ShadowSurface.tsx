import React from 'react';
import { Platform, StyleSheet, StyleProp, View, ViewStyle } from 'react-native';

type ShadowLevel = 'none' | 'xs' | 'sm' | 'md' | 'lg';

type ShadowSurfaceProps = {
  children: React.ReactNode;
  shadow?: ShadowLevel;
  style?: StyleProp<ViewStyle>; // outer container
  innerStyle?: StyleProp<ViewStyle>; // inner (clipped) surface
  radius?: number;
  clip?: boolean;
};

const SHADOW_PRESETS: Record<ShadowLevel, { ios: ViewStyle; android: ViewStyle }> = {
  none: { ios: { shadowColor: 'transparent', shadowOpacity: 0 }, android: { elevation: 0 } },
  xs: {
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 2,
    },
    android: { elevation: 1 },
  },
  sm: {
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    },
    android: { elevation: 2 },
  },
  md: {
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.14,
      shadowRadius: 8,
    },
    android: { elevation: 4 },
  },
  lg: {
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.18,
      shadowRadius: 16,
    },
    android: { elevation: 6 },
  },
};

const ShadowSurface: React.FC<ShadowSurfaceProps> = ({
  children,
  shadow = 'sm',
  style,
  innerStyle,
  radius,
  clip = true,
}) => {
  const flatInner = StyleSheet.flatten(innerStyle) || {};
  const resolvedRadius =
    radius ?? (typeof flatInner.borderRadius === 'number' ? flatInner.borderRadius : 0);
  const platformShadow = Platform.OS === 'ios'
    ? SHADOW_PRESETS[shadow].ios
    : SHADOW_PRESETS[shadow].android;

  return (
    <View style={[platformShadow, { borderRadius: resolvedRadius }, style]}>
      <View
        style={[
          { borderRadius: resolvedRadius, overflow: clip ? 'hidden' : 'visible' },
          innerStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
};

export default ShadowSurface;

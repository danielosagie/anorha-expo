/** Web mock for expo-blur (native BlurView can't render on web). */
import React from 'react';
import { View } from 'react-native';

export const BlurView = ({ children, style, ...rest }: any) => (
  <View style={[{ backgroundColor: 'rgba(255,255,255,0.7)' }, style]} {...rest}>
    {children}
  </View>
);

export default { BlurView };

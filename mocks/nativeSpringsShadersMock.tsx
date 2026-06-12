/** Web mock for @native-springs/shaders (native GL shaders; not available on web). */
import React from 'react';
import { View } from 'react-native';

export const RippleShader = ({ children, style }: any) => <View style={style}>{children}</View>;
export const AuroraOverlay = ({ children, style }: any) => <View style={style}>{children}</View>;

export default { RippleShader, AuroraOverlay };

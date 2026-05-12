import React from 'react';
import { BaseShaderProps, ShaderViewRef } from './BaseShaderView';
import { LiquidDistortionParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Liquid Distortion shader effect.
 * Creates flowing liquid-like distortions with customizable flow patterns.
 */
export interface LiquidDistortionShaderProps extends Omit<BaseShaderProps, 'parameters'> {
    parameters?: LiquidDistortionParameters;
}
export declare const LiquidDistortionShader: React.ForwardRefExoticComponent<LiquidDistortionShaderProps & React.RefAttributes<ShaderViewRef>>;
//# sourceMappingURL=LiquidDistortionShader.d.ts.map
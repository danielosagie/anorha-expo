import React from 'react';
import { BaseShaderProps, ShaderViewRef } from './BaseShaderView';
import { GlitchParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Glitch shader effect.
 * Creates digital glitch artifacts with chromatic aberration and scanlines.
 */
export interface GlitchShaderProps extends Omit<BaseShaderProps, 'parameters'> {
    parameters?: GlitchParameters;
}
export declare const GlitchShader: React.ForwardRefExoticComponent<GlitchShaderProps & React.RefAttributes<ShaderViewRef>>;
//# sourceMappingURL=GlitchShader.d.ts.map
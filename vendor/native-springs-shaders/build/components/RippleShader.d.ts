import React from 'react';
import { BaseShaderProps, ShaderViewRef } from './BaseShaderView';
import { RippleParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Ripple shader effect.
 * Creates interactive water ripple distortions at touch points.
 */
export interface RippleShaderProps extends Omit<BaseShaderProps, 'parameters'> {
    parameters?: RippleParameters;
}
export declare const RippleShader: React.ForwardRefExoticComponent<RippleShaderProps & React.RefAttributes<ShaderViewRef>>;
//# sourceMappingURL=RippleShader.d.ts.map
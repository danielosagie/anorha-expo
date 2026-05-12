import React from 'react';
import { BaseOverlayProps } from './BaseOverlayView';
import { LightRayParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Light Ray overlay effect.
 * Creates volumetric light rays emanating from a source point.
 */
export interface LightRayOverlayProps extends Omit<BaseOverlayProps, 'parameters'> {
    parameters?: LightRayParameters;
}
export declare const LightRayOverlay: React.ForwardRefExoticComponent<LightRayOverlayProps & React.RefAttributes<any>>;
//# sourceMappingURL=LightRayOverlay.d.ts.map
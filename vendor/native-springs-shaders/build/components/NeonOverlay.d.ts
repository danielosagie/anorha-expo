import React from 'react';
import { BaseOverlayProps } from './BaseOverlayView';
import { NeonParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Neon overlay effect.
 * Creates an animated glowing neon border that encapsulates content.
 */
export interface NeonOverlayProps extends Omit<BaseOverlayProps, 'parameters'> {
    parameters?: NeonParameters;
}
export declare const NeonOverlay: React.ForwardRefExoticComponent<NeonOverlayProps & React.RefAttributes<any>>;
//# sourceMappingURL=NeonOverlay.d.ts.map
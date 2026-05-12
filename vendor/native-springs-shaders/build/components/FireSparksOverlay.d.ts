import React from 'react';
import { BaseOverlayProps } from './BaseOverlayView';
import { FireSparksParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Fire Sparks overlay effect.
 * Creates an animated fire particle effect with floating sparks.
 */
export interface FireSparksOverlayProps extends Omit<BaseOverlayProps, 'parameters'> {
    parameters?: FireSparksParameters;
}
export declare const FireSparksOverlay: React.ForwardRefExoticComponent<FireSparksOverlayProps & React.RefAttributes<any>>;
//# sourceMappingURL=FireSparksOverlay.d.ts.map
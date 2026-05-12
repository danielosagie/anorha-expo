import React from 'react';
import { BaseOverlayProps } from './BaseOverlayView';
import { FireworksParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Fireworks overlay effect.
 * Creates animated firework explosions with customizable colors and patterns.
 */
export interface FireworksOverlayProps extends Omit<BaseOverlayProps, 'parameters'> {
    parameters?: FireworksParameters;
}
export declare const FireworksOverlay: React.ForwardRefExoticComponent<FireworksOverlayProps & React.RefAttributes<any>>;
//# sourceMappingURL=FireworksOverlay.d.ts.map
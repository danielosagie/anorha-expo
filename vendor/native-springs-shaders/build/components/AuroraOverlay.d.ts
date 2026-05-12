import React from 'react';
import { BaseOverlayProps } from './BaseOverlayView';
import { AuroraParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Aurora overlay effect.
 * Creates a flowing, colorful aurora borealis animation.
 */
export interface AuroraOverlayProps extends Omit<BaseOverlayProps, 'parameters'> {
    parameters?: AuroraParameters;
}
export declare const AuroraOverlay: React.ForwardRefExoticComponent<AuroraOverlayProps & React.RefAttributes<any>>;
//# sourceMappingURL=AuroraOverlay.d.ts.map
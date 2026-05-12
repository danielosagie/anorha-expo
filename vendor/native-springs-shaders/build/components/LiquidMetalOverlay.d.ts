import React from 'react';
import { BaseOverlayProps } from './BaseOverlayView';
import { LiquidMetalParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Liquid Metal overlay effect.
 * Creates a flowing, chrome-like metallic border effect.
 */
export interface LiquidMetalOverlayProps extends Omit<BaseOverlayProps, 'parameters'> {
    parameters?: LiquidMetalParameters;
}
export declare const LiquidMetalOverlay: React.ForwardRefExoticComponent<LiquidMetalOverlayProps & React.RefAttributes<any>>;
//# sourceMappingURL=LiquidMetalOverlay.d.ts.map
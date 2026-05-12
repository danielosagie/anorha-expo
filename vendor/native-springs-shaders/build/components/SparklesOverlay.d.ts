import React from 'react';
import { BaseOverlayProps } from './BaseOverlayView';
import { SparklesParameters } from '../NativeSpringsShaders.types';
/**
 * Props for the Sparkles overlay effect.
 * Creates twinkling star-like particles across the view.
 */
export interface SparklesOverlayProps extends Omit<BaseOverlayProps, 'parameters'> {
    parameters?: SparklesParameters;
}
export declare const SparklesOverlay: React.ForwardRefExoticComponent<SparklesOverlayProps & React.RefAttributes<any>>;
//# sourceMappingURL=SparklesOverlay.d.ts.map
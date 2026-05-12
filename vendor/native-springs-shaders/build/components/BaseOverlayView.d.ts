import * as React from 'react';
import { ViewProps } from 'react-native';
/**
 * Base props shared by all overlay components.
 */
export interface BaseOverlayProps extends ViewProps {
    /**
     * Parameters object for configuring the overlay effect.
     */
    parameters?: Record<string, any>;
    /**
     * When true, the overlay is completely disabled and only renders children.
     * @default false
     */
    disabled?: boolean;
}
/**
 * Internal props interface for BaseOverlayView.
 */
interface InternalOverlayProps extends BaseOverlayProps {
    overlayName: string;
}
export declare const BaseOverlayView: React.ForwardRefExoticComponent<InternalOverlayProps & React.RefAttributes<any>>;
export {};
//# sourceMappingURL=BaseOverlayView.d.ts.map
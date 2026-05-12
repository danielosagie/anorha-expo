import * as React from 'react';
import { ViewProps } from 'react-native';
import { ShaderErrorEvent } from '../NativeSpringsShaders.types';
export interface ShaderViewRef {
    refreshSnapshot: () => void;
}
export interface BaseShaderProps extends ViewProps {
    /**
     * Parameters object for configuring the shader effect.
     */
    parameters?: Record<string, any>;
    /**
     * When true, the shader is completely disabled and only renders children.
     * @default false
     */
    disabled?: boolean;
    /**
     * Automatically refresh the shader snapshot at regular intervals.
     * @default false
     */
    autoRefreshSnapshot?: boolean;
    /**
     * Interval in milliseconds for automatic snapshot refresh.
     * @default 1000
     */
    snapshotRefreshInterval?: number;
    /**
     * Initial delay in milliseconds before first snapshot.
     * @default 100
     */
    initialSnapshotDelay?: number;
    /**
     * Callback when a shader error occurs.
     */
    onShaderError?: (event: ShaderErrorEvent) => void;
}
interface InternalShaderProps extends BaseShaderProps {
    shaderName: string;
}
export declare const BaseShaderView: React.ForwardRefExoticComponent<InternalShaderProps & React.RefAttributes<ShaderViewRef>>;
export {};
//# sourceMappingURL=BaseShaderView.d.ts.map
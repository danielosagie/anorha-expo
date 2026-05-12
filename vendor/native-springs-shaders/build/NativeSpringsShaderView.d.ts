import * as React from 'react';
export interface ShaderViewRef {
    /**
     * Manually refresh the cached snapshot for animated shaders.
     * Useful when children content changes during animation.
     */
    refreshSnapshot: () => void;
}
declare const ShaderView: React.ForwardRefExoticComponent<import("react-native").ViewProps & {
    shaderName?: string;
    parameters?: Record<string, any>;
    autoRefreshSnapshot?: boolean;
    snapshotRefreshInterval?: number;
    initialSnapshotDelay?: number;
    onShaderError?: (event: import("./NativeSpringsShaders.types").ShaderErrorEvent) => void;
} & React.RefAttributes<ShaderViewRef>>;
export default ShaderView;
//# sourceMappingURL=NativeSpringsShaderView.d.ts.map
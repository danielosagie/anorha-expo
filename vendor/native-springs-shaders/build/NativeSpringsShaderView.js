import { requireNativeView } from 'expo';
import * as React from 'react';
const NativeView = requireNativeView('NativeSpringsShader');
const ShaderView = React.forwardRef((props, ref) => {
    const { shaderName, parameters, ...otherProps } = props;
    const nativeRef = React.useRef(null);
    React.useImperativeHandle(ref, () => ({
        refreshSnapshot: () => {
            // @ts-ignore - AsyncFunction exposed from native module
            nativeRef.current?.refreshSnapshot?.();
        },
    }));
    // @ts-ignore - ref is supported but not in requireNativeView types
    return <NativeView ref={nativeRef} shaderName={shaderName} parameters={parameters} {...otherProps}/>;
});
ShaderView.displayName = 'ShaderView';
export default ShaderView;
//# sourceMappingURL=NativeSpringsShaderView.js.map
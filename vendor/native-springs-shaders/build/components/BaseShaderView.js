import { requireNativeView } from 'expo';
import * as React from 'react';
const NativeView = requireNativeView('NativeSpringsShader');
export const BaseShaderView = React.forwardRef((props, ref) => {
    const { shaderName, parameters, disabled = false, ...otherProps } = props;
    const nativeRef = React.useRef(null);
    React.useImperativeHandle(ref, () => ({
        refreshSnapshot: () => {
            nativeRef.current?.refreshSnapshot?.();
        },
    }));
    if (disabled) {
        return <>{props.children}</>;
    }
    return <NativeView ref={nativeRef} shaderName={shaderName} parameters={parameters} {...otherProps}/>;
});
BaseShaderView.displayName = 'BaseShaderView';
//# sourceMappingURL=BaseShaderView.js.map
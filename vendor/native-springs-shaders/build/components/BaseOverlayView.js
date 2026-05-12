import { requireNativeView } from 'expo';
import * as React from 'react';
const NativeView = requireNativeView('NativeSpringsShaderOverlay');
export const BaseOverlayView = React.forwardRef((props, ref) => {
    const { overlayName, parameters, disabled = false, ...otherProps } = props;
    if (disabled) {
        return <>{props.children}</>;
    }
    return <NativeView ref={ref} overlayName={overlayName} parameters={parameters} {...otherProps}/>;
});
BaseOverlayView.displayName = 'BaseOverlayView';
//# sourceMappingURL=BaseOverlayView.js.map
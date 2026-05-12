import { requireNativeView } from 'expo';
import * as React from 'react';
const NativeView = requireNativeView('NativeSpringsShaderOverlay');
export default function OverlayView(props) {
    const { overlayName, parameters, ...otherProps } = props;
    return <NativeView overlayName={overlayName} parameters={parameters} {...otherProps}/>;
}
//# sourceMappingURL=NativeSpringsShaderOverlayView.js.map
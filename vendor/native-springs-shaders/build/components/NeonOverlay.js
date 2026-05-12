import React, { useMemo } from 'react';
import { BaseOverlayView } from './BaseOverlayView';
import { normalizeColor } from '../utils/color';
export const NeonOverlay = React.forwardRef(({ parameters, ...props }, ref) => {
    const normalizedParameters = useMemo(() => {
        if (!parameters)
            return parameters;
        const { color, secondaryColor, ...rest } = parameters;
        const result = { ...rest };
        if (color !== undefined) {
            result.color = normalizeColor(color);
        }
        if (secondaryColor !== undefined) {
            result.secondaryColor = normalizeColor(secondaryColor);
        }
        return result;
    }, [parameters]);
    return (<BaseOverlayView ref={ref} overlayName="neon" parameters={normalizedParameters} {...props}/>);
});
NeonOverlay.displayName = 'NeonOverlay';
//# sourceMappingURL=NeonOverlay.js.map
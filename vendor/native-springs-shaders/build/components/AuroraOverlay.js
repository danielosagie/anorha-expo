import React, { useMemo } from 'react';
import { BaseOverlayView } from './BaseOverlayView';
import { normalizeColor } from '../utils/color';
export const AuroraOverlay = React.forwardRef(({ parameters, ...props }, ref) => {
    const normalizedParameters = useMemo(() => {
        if (!parameters)
            return parameters;
        const { color, ...rest } = parameters;
        if (color === undefined)
            return parameters;
        return {
            ...rest,
            color: normalizeColor(color),
        };
    }, [parameters]);
    return (<BaseOverlayView ref={ref} overlayName="aurora" parameters={normalizedParameters} {...props}/>);
});
AuroraOverlay.displayName = 'AuroraOverlay';
//# sourceMappingURL=AuroraOverlay.js.map
import React, { useMemo } from 'react';
import { BaseOverlayView } from './BaseOverlayView';
import { normalizeColor } from '../utils/color';
export const FireSparksOverlay = React.forwardRef(({ parameters, ...props }, ref) => {
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
    return (<BaseOverlayView ref={ref} overlayName="fireSparks" parameters={normalizedParameters} {...props}/>);
});
FireSparksOverlay.displayName = 'FireSparksOverlay';
//# sourceMappingURL=FireSparksOverlay.js.map
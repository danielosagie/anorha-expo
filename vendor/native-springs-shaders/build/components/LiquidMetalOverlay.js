import React, { useMemo } from 'react';
import { BaseOverlayView } from './BaseOverlayView';
import { normalizeColor } from '../utils/color';
export const LiquidMetalOverlay = React.forwardRef(({ parameters, ...props }, ref) => {
    const normalizedParameters = useMemo(() => {
        if (!parameters)
            return parameters;
        const { baseColor, highlightColor, stripeCount, flowOffset, flowAngle, specular, ...rest } = parameters;
        const result = { ...rest };
        if (baseColor !== undefined) {
            result.baseColor = normalizeColor(baseColor);
        }
        if (highlightColor !== undefined) {
            result.highlightColor = normalizeColor(highlightColor);
        }
        if (stripeCount !== undefined) {
            result.repetition = stripeCount;
        }
        if (flowOffset !== undefined) {
            result.flowOffsetX = flowOffset[0];
            result.flowOffsetY = flowOffset[1];
        }
        if (flowAngle !== undefined) {
            result.flowAngle = (flowAngle * Math.PI) / 180;
        }
        if (specular !== undefined) {
            if (specular.intensity !== undefined) {
                result.specularIntensity = specular.intensity;
            }
            if (specular.position !== undefined) {
                result.specularPositionX = specular.position[0];
                result.specularPositionY = specular.position[1];
            }
            if (specular.size !== undefined) {
                result.specularSize = specular.size;
            }
        }
        return result;
    }, [parameters]);
    return (<BaseOverlayView ref={ref} overlayName="liquidMetal" parameters={normalizedParameters} {...props}/>);
});
LiquidMetalOverlay.displayName = 'LiquidMetalOverlay';
//# sourceMappingURL=LiquidMetalOverlay.js.map
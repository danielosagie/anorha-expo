import React, { useMemo } from 'react';
import { BaseShaderView } from './BaseShaderView';
import { normalizeColor } from '../utils/color';
export const LiquidDistortionShader = React.forwardRef(({ parameters, ...props }, ref) => {
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
    return (<BaseShaderView ref={ref} shaderName="liquidDistortion" parameters={normalizedParameters} {...props}/>);
});
LiquidDistortionShader.displayName = 'LiquidDistortionShader';
//# sourceMappingURL=LiquidDistortionShader.js.map
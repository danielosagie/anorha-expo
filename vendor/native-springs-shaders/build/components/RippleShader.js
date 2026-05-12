import React, { useMemo } from 'react';
import { BaseShaderView } from './BaseShaderView';
import { normalizeColor } from '../utils/color';
export const RippleShader = React.forwardRef(({ parameters, ...props }, ref) => {
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
    return (<BaseShaderView ref={ref} shaderName="ripple" parameters={normalizedParameters} {...props}/>);
});
RippleShader.displayName = 'RippleShader';
//# sourceMappingURL=RippleShader.js.map
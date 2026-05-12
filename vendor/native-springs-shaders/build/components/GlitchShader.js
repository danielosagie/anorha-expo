import React from 'react';
import { BaseShaderView } from './BaseShaderView';
export const GlitchShader = React.forwardRef((props, ref) => {
    return <BaseShaderView ref={ref} shaderName="glitch" {...props}/>;
});
GlitchShader.displayName = 'GlitchShader';
//# sourceMappingURL=GlitchShader.js.map
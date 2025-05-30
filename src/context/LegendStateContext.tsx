import React, { createContext, useContext, ReactNode } from 'react';
import { ObservableObject } from '@legendapp/state';
import { ProductVariant } from '../utils/SupaLegend'; // Adjust path if ProductVariant moves or is re-exported

// Define the shape of the context value
export interface LegendStateContextType {
    productVariants$?: ObservableObject<Record<string, ProductVariant>>;
    // Add other observables here as they are initialized
    // e.g., platformProductMappings$?: ObservableObject<Record<string, PlatformProductMapping>>;
}

// Create the context
export const LegendStateContext = createContext<LegendStateContextType | null>(null);

// Custom hook to use the Legend-State context
export const useLegendState = () => {
    const context = useContext(LegendStateContext);
    if (!context) {
        // This error means useLegendState was called outside of a LegendStateContext.Provider
        // Ensure your App.tsx or root component wraps the app in the Provider.
        throw new Error('useLegendState must be used within a LegendStateProvider');
    }
    return context;
};

// Optional: If you want to type the Provider props explicitly, though often not needed if App.tsx handles it.
// interface LegendStateProviderProps {
// children: ReactNode;
// value: LegendStateContextType | null;
// }

// export const LegendStateProvider: React.FC<LegendStateProviderProps> = ({ children, value }) => {
// return <LegendStateContext.Provider value={value}>{children}</LegendStateContext.Provider>;
// }; 
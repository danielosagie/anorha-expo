import { ObservableObject } from '@legendapp/state';
import { LegendStateObservables, ProductVariant, PlatformProductMapping, ProductImage, InventoryLevel } from '../utils/SupaLegend'; // Assuming paths
import React, { useContext } from 'react';

export const LegendStateContext = React.createContext<LegendStateObservables | null>(null);

export const useLegendState = (): LegendStateObservables => {
    const context = useContext(LegendStateContext);
    if (!context) {
        throw new Error('useLegendState must be used within a LegendStateProvider, and context should not be null when consumed.');
    }
    if (!context.productVariants$ || !context.userId) {
        throw new Error('LegendStateContext is missing critical observables (productVariants$ or userId). Ensure initialization is complete.');
    }
    return context;
}; 
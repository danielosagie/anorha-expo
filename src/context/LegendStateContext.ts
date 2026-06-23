import { ObservableObject } from '@legendapp/state';
import { LegendStateObservables, ProductVariant, PlatformProductMapping, ProductImage, InventoryLevel, getSignedOutLegendState } from '../utils/SupaLegend'; // Assuming paths
import React, { useContext } from 'react';

export const LegendStateContext = React.createContext<LegendStateObservables | null>(null);

export const useLegendState = (): LegendStateObservables => {
    const context = useContext(LegendStateContext);
    // The provider value goes briefly null/incomplete during the SIGN-OUT transition:
    // App.tsx clears it one commit before React Navigation unmounts the signed-in screens
    // that consume this context, so those screens get one final render against a null
    // provider. Throwing there crashed the whole app (the redbox seen on NewClearoutSheet).
    // Returning a stable, inert fallback keeps that last frame — and degraded-mode boots —
    // from crashing; the real screens unmount a beat later. The fallback is network-free
    // and holds no user data, so this never surfaces another user's state.
    if (!context || !context.productVariants$ || !context.userId) {
        return getSignedOutLegendState();
    }
    return context;
};
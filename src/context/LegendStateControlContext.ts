import { createContext, useContext } from 'react';

export interface LegendStateControlContextType {
  resetLegendState: () => Promise<void>;
}

export const LegendStateControlContext = createContext<LegendStateControlContextType | null>(null);

export const useLegendStateControl = () => {
  const context = useContext(LegendStateControlContext);
  if (!context) {
    throw new Error('useLegendStateControl must be used within a LegendStateControlProvider');
  }
  return context;
}; 
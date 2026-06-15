import { createContext, useContext } from 'react';
import { createLogger } from '../utils/logger';
const log = createLogger('LegendStateControlContext');


export interface LegendStateControlContextType {
  resetLegendState: () => Promise<void>;
}

export const LegendStateControlContext = createContext<LegendStateControlContextType | null>(null);

export const useLegendStateControl = (): LegendStateControlContextType => {
  const context = useContext(LegendStateControlContext);
  if (!context) {
    // Return safe no-op when used outside provider (e.g., during auth transitions)
    log.warn('[useLegendStateControl] Used outside of LegendStateControlProvider, returning no-op');
    return {
      resetLegendState: async () => {
        log.debug('[useLegendStateControl] No-op resetLegendState called (provider not available)');
      },
    };
  }
  return context;
}; 
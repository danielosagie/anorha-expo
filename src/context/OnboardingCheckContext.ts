import React from 'react';

export interface OnboardingCheckContextType {
  retryOnboardingCheck: () => void;
  debugInfo: string;
}

export const OnboardingCheckContext = React.createContext<OnboardingCheckContextType | null>(null);

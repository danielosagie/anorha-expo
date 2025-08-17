// Centralized feature flags for runtime toggles
// Keep simple boolean flags for now; can evolve to remote config later

export const FEATURES = {
  MARKETPLACE_ENABLED: false,
  MARKETPLACE_CHAT_ENABLED: true,
  ORDERS_ENABLED: false,
};

export type FeatureKey = keyof typeof FEATURES;

export const isFeatureEnabled = (key: FeatureKey): boolean => FEATURES[key];




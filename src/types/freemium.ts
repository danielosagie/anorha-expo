export interface FreemiumStatus {
  usageCount: number;
  freeLimit: number;
  remaining: number;
  isFreeTierExhausted: boolean;
  trialDaysRemaining: number;
  isTrialActive: boolean;
  trialEndsAt: string | null;
  hasSubscription: boolean;
  currentPlan: string | null;
  tiers: Array<{
    id: string;
    name: string;
    price: number;
    billingPeriod: string;
    users: number;
    features: string[];
  }>;
}

export const DEFAULT_FREEMIUM_STATUS: FreemiumStatus = {
  usageCount: 0,
  freeLimit: 3,
  remaining: 3,
  isFreeTierExhausted: false,
  trialDaysRemaining: 7,
  isTrialActive: true,
  trialEndsAt: null,
  hasSubscription: false,
  currentPlan: null,
  tiers: [],
};

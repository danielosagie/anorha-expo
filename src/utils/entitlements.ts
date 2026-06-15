import { supabase } from '../../lib/supabase';

export type UserEntitlements = {
  planName: string | null;
  maxConnections: number;
  aiScanLimit: number | null;
  isPaid: boolean;
  // Trial and subscription status
  inTrial: boolean;
  trialEndsAt: string | null;
  trialDaysLeft: number;
  subscriptionStatus: 'active' | 'trialing' | 'expired' | 'none';
  hasAccess: boolean; // True if user has valid subscription OR is in trial
};

// Free trial duration in days
export const FREE_TRIAL_DAYS = 14;

// Simple client-side mapping for connection limits per plan
const CONNECTION_LIMITS: Record<string, number> = {
  free: 1,
  Growth: 2,
  Pro: 3,
  Business: 5,
  Scale: 10,
};

export async function fetchUserEntitlements(): Promise<UserEntitlements> {
  const { data: { user } } = await supabase.auth.getUser();
  const defaultEntitlements: UserEntitlements = {
    planName: null,
    maxConnections: CONNECTION_LIMITS.free,
    aiScanLimit: null,
    isPaid: false,
    inTrial: false,
    trialEndsAt: null,
    trialDaysLeft: 0,
    subscriptionStatus: 'none',
    hasAccess: false,
  };

  if (!user) return defaultEntitlements;

  // Fetch user with subscription in one query
  const { data: usr } = await supabase
    .from('Users')
    .select('Id, CreatedAt')
    .eq('Id', user.id)
    .maybeSingle();

  if (!usr) return defaultEntitlements;

  // Fetch subscription status
  const { data: subscription } = await supabase
    .from('Subscriptions')
    .select('Status, CurrentPlan, CurrentPeriodEnd, TrialEnd, CanceledAt')
    .eq('UserId', user.id)
    .maybeSingle();

  // Calculate trial status based on user creation date if no subscription
  const userCreatedAt = usr.CreatedAt ? new Date(usr.CreatedAt) : new Date();
  const trialEndDate = new Date(userCreatedAt);
  trialEndDate.setDate(trialEndDate.getDate() + FREE_TRIAL_DAYS);
  
  const now = new Date();
  const isInAutoTrial = now < trialEndDate && !subscription;
  const autoTrialDaysLeft = isInAutoTrial 
    ? Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Check explicit trial from subscription
  const explicitTrialEnd = subscription?.TrialEnd ? new Date(subscription.TrialEnd) : null;
  const isInExplicitTrial = explicitTrialEnd && now < explicitTrialEnd;
  const explicitTrialDaysLeft = isInExplicitTrial
    ? Math.ceil((explicitTrialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // Combine trial status (auto trial for new users OR explicit trial from subscription)
  const inTrial = isInAutoTrial || isInExplicitTrial;
  const trialDaysLeft = isInExplicitTrial ? explicitTrialDaysLeft : autoTrialDaysLeft;
  const trialEndsAt = isInExplicitTrial 
    ? subscription?.TrialEnd 
    : (isInAutoTrial ? trialEndDate.toISOString() : null);

  // Determine subscription status
  let subscriptionStatus: UserEntitlements['subscriptionStatus'] = 'none';
  const isSubscriptionActive = subscription?.Status === 'active' && !subscription?.CanceledAt;
  
  if (isSubscriptionActive) {
    subscriptionStatus = 'active';
  } else if (inTrial) {
    subscriptionStatus = 'trialing';
  } else if (subscription && !isSubscriptionActive) {
    subscriptionStatus = 'expired';
  }

  // User has access if they have active subscription OR are in trial
  const hasAccess = isSubscriptionActive || inTrial;

  // Fetch tier data if subscription exists
  let planName: string | null = subscription?.CurrentPlan || null;
  let aiScanLimit: number | null = null;
  
  if (planName) {
    const { data: tier } = await supabase
      .from('SubscriptionTiers')
      .select('Name, AiScans')
      .eq('Name', planName)
      .maybeSingle();

    planName = tier?.Name ?? planName;
    aiScanLimit = tier?.AiScans ?? null;
  }

  const maxConnections = planName && CONNECTION_LIMITS[planName] ? CONNECTION_LIMITS[planName] : CONNECTION_LIMITS.free;
  const isPaid = isSubscriptionActive;

  return { 
    planName, 
    maxConnections, 
    aiScanLimit, 
    isPaid,
    inTrial: inTrial ?? false,
    trialEndsAt,
    trialDaysLeft,
    subscriptionStatus,
    hasAccess: hasAccess ?? false,
  };
}

/**
 * Check if a specific feature is available based on entitlements
 */
export function isFeatureAvailable(
  entitlements: UserEntitlements | null, 
  feature: 'ai_scan' | 'multi_platform' | 'team_members' | 'advanced_sync'
): boolean {
  if (!entitlements) return false;
  
  // If user has no access (no subscription and trial expired), only basic features
  if (!entitlements.hasAccess) {
    return false;
  }

  // During trial or with active subscription, most features are available
  switch (feature) {
    case 'ai_scan':
      // AI scan depends on limit, not just access
      return entitlements.aiScanLimit === null || entitlements.aiScanLimit > 0;
    case 'multi_platform':
      return entitlements.maxConnections > 1;
    case 'team_members':
      return entitlements.isPaid; // Only paid plans get team features
    case 'advanced_sync':
      return entitlements.hasAccess;
    default:
      return entitlements.hasAccess;
  }
}




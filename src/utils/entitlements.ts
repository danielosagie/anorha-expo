import { apiJson } from '../lib/apiClient';
import {
  deriveBillingState,
  type BillingProvider,
  type CheckoutProvider,
} from './billingState';
import { parseBillingSummaryPayload } from './billingPayload';

export type UserEntitlements = {
  planName: string | null;
  maxConnections: number | null;
  aiScanLimit: number | null;
  isPaid: boolean | null;
  inTrial: boolean | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  subscriptionStatus:
    | 'active'
    | 'inactive'
    | 'canceled_paid_through'
    | 'none'
    | 'unknown';
  hasAccess: boolean | null;
  currentPeriodEnd: string | null;
  billingProvider: BillingProvider | 'unknown';
  selectedCheckoutProvider: CheckoutProvider | 'unknown';
  checkoutAllowed: boolean | null;
  checkoutEligibleAt: string | null;
  checkoutAction: 'checkout' | 'schedule_handoff' | 'none';
  handoffState: 'ready' | 'scheduled' | 'schedule_required' | 'unknown' | null;
  handoffEligibleAt: string | null;
  resubscribeOffered: boolean | null;
  resubscribeEligible: boolean | null;
  resubscribeEligibleAt: string | null;
};

export async function fetchUserEntitlements(): Promise<UserEntitlements> {
  const payload = await apiJson<unknown>('/api/billing/summary');
  const parsed = parseBillingSummaryPayload(payload);
  if (!parsed.ok) {
    throw new Error(`Invalid billing summary at ${parsed.field}`);
  }
  const summary = parsed.value;
  const billingState = deriveBillingState(summary, new Date());
  const subscriptionState = billingState.subscription.state;
  const hasAccess = subscriptionState === 'active'
    || subscriptionState === 'canceled_paid_through'
      ? true
      : subscriptionState === 'inactive' || subscriptionState === 'none'
        ? false
        : null;

  return {
    planName: summary.subscription?.CurrentPlan
      ?? summary.subscription?.current_plan
      ?? null,
    maxConnections: null,
    aiScanLimit: null,
    isPaid: hasAccess,
    inTrial: null,
    trialEndsAt: null,
    trialDaysLeft: null,
    subscriptionStatus: subscriptionState,
    hasAccess,
    currentPeriodEnd: billingState.subscription.currentPeriodEnd,
    billingProvider: billingState.entitlementProvider,
    selectedCheckoutProvider: billingState.checkout.provider,
    checkoutAllowed: billingState.checkout.allowed,
    checkoutEligibleAt: billingState.checkout.eligibleAt,
    checkoutAction: billingState.checkout.action,
    handoffState: billingState.handoff?.state ?? null,
    handoffEligibleAt: billingState.handoff?.eligibleAt ?? null,
    resubscribeOffered: billingState.resubscribe.offered,
    resubscribeEligible: billingState.resubscribe.eligible,
    resubscribeEligibleAt: billingState.resubscribe.eligibleAt,
  };
}

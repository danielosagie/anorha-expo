export type BillingProvider = 'polar' | 'shopify' | 'manual';
export type CheckoutProvider = 'polar' | 'shopify';

export interface RawBillingSubscription {
  CurrentPlan?: string | null;
  current_plan?: string | null;
  Status?: 'active' | 'inactive' | string | null;
  status?: 'active' | 'inactive' | string | null;
  CurrentPeriodEnd?: string | null;
  PolarCustomerId?: string | null;
  PolarSubscriptionId?: string | null;
  UserId?: string | null;
  CanceledAt?: string | null;
}

export interface RawBillingHandoff {
  state?: 'ready' | 'scheduled' | 'schedule_required' | string | null;
  from_provider?: 'polar' | string | null;
  to_provider?: 'shopify' | string | null;
  checkout_eligible_at?: string | null;
}

export interface RawBillingResubscribe {
  offered?: boolean;
  provider?: CheckoutProvider | string | null;
  eligible?: boolean;
  eligible_at?: string | null;
  reason_code?: string | null;
}

export interface RawBillingState {
  entitlement_source?: BillingProvider | string | null;
  selected_checkout_provider?: CheckoutProvider | string | null;
  checkout_allowed?: boolean;
  checkout_blocked_until?: string | null;
  reason_code?: string | null;
  handoff?: RawBillingHandoff | null;
  resubscribe?: RawBillingResubscribe | null;
}

export interface RawBillingSummary {
  subscription?: RawBillingSubscription | null;
  payment_provider?: BillingProvider | string | null;
  billing_state?: RawBillingState | null;
}

export interface RawCheckoutConflictHandoff {
  state?: 'scheduled' | string | null;
  fromProvider?: 'polar' | string | null;
  toProvider?: 'shopify' | string | null;
  checkoutEligibleAt?: string | null;
  eventId?: string | null;
  duplicate?: boolean;
}

export interface RawCheckoutConflict {
  statusCode?: number;
  error?: string;
  message?: string;
  provider?: CheckoutProvider | string | null;
  action?: 'blocked' | string | null;
  reasonCode?: string | null;
  lockEnd?: string | null;
  handoff?: RawCheckoutConflictHandoff | null;
  decision?: {
    inputs?: {
      entitlementLock?: {
        source?: BillingProvider | string | null;
      } | null;
    } | null;
  } | null;
}

export type BillingSubscriptionState =
  | 'active'
  | 'inactive'
  | 'canceled_paid_through'
  | 'none'
  | 'unknown';

export type BillingManageDestination =
  | 'provider_portal'
  | 'shopify_admin'
  | 'contact_support'
  | 'unknown';

export interface BillingStateViewModel {
  knowledge: 'known' | 'unknown';
  entitlementProvider: BillingProvider | 'unknown';
  manageDestination: BillingManageDestination;
  subscription: {
    state: BillingSubscriptionState;
    canceledAt: string | null;
    currentPeriodEnd: string | null;
  };
  checkout: {
    state: 'allowed' | 'blocked' | 'unknown';
    allowed: boolean | null;
    action: 'checkout' | 'schedule_handoff' | 'none';
    provider: CheckoutProvider | 'unknown';
    blockedUntil: string | null;
    eligibleAt: string | null;
    reasonCode: string | null;
  };
  handoff: null | {
    state: 'ready' | 'scheduled' | 'schedule_required' | 'unknown';
    scheduled: boolean;
    eligibleAt: string | null;
  };
  resubscribe: {
    offered: boolean | null;
    provider: CheckoutProvider | 'unknown' | null;
    eligible: boolean | null;
    eligibleAt: string | null;
    reasonCode: string | null;
  };
}

export function isCheckoutBlocked(
  checkoutAllowed: BillingStateViewModel['checkout']['allowed'] | undefined,
): boolean {
  return checkoutAllowed === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBillingProvider(value: unknown): value is BillingProvider {
  return value === 'polar' || value === 'shopify' || value === 'manual';
}

function isCheckoutProvider(value: unknown): value is CheckoutProvider {
  return value === 'polar' || value === 'shopify';
}

function validTimestamp(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function nullableReason(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function manageDestinationFor(
  provider: BillingProvider | 'unknown',
): BillingManageDestination {
  if (provider === 'polar') return 'provider_portal';
  if (provider === 'shopify') return 'shopify_admin';
  if (provider === 'manual') return 'contact_support';
  return 'unknown';
}

function unknownBillingState(): BillingStateViewModel {
  return {
    knowledge: 'unknown',
    entitlementProvider: 'unknown',
    manageDestination: 'unknown',
    subscription: {
      state: 'unknown',
      canceledAt: null,
      currentPeriodEnd: null,
    },
    checkout: {
      state: 'unknown',
      allowed: null,
      action: 'none',
      provider: 'unknown',
      blockedUntil: null,
      eligibleAt: null,
      reasonCode: null,
    },
    handoff: null,
    resubscribe: {
      offered: null,
      provider: null,
      eligible: null,
      eligibleAt: null,
      reasonCode: null,
    },
  };
}

function deriveSubscription(
  raw: unknown,
  now: Date,
): BillingStateViewModel['subscription'] {
  if (raw === null) {
    return { state: 'none', canceledAt: null, currentPeriodEnd: null };
  }
  if (!isRecord(raw)) {
    return { state: 'unknown', canceledAt: null, currentPeriodEnd: null };
  }

  const canceledAt = validTimestamp(raw.CanceledAt);
  const currentPeriodEnd = validTimestamp(raw.CurrentPeriodEnd);
  const status = raw.Status ?? raw.status;
  const nowMs = now.getTime();
  const paidThroughMs = currentPeriodEnd ? Date.parse(currentPeriodEnd) : Number.NaN;
  if (canceledAt && Number.isFinite(nowMs) && paidThroughMs > nowMs) {
    return { state: 'canceled_paid_through', canceledAt, currentPeriodEnd };
  }
  if (status === 'active') {
    return { state: 'active', canceledAt, currentPeriodEnd };
  }
  if (status === 'inactive') {
    return { state: 'inactive', canceledAt, currentPeriodEnd };
  }
  return { state: 'unknown', canceledAt, currentPeriodEnd };
}

function deriveSummaryHandoff(
  raw: unknown,
): BillingStateViewModel['handoff'] {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) {
    return { state: 'unknown', scheduled: false, eligibleAt: null };
  }
  const hasExpectedProviders = raw.from_provider === 'polar' && raw.to_provider === 'shopify';
  const state = hasExpectedProviders && (raw.state === 'ready'
    || raw.state === 'scheduled'
    || raw.state === 'schedule_required')
    ? raw.state
    : 'unknown';
  return {
    state,
    scheduled: state === 'scheduled',
    eligibleAt: validTimestamp(raw.checkout_eligible_at),
  };
}

function deriveResubscribe(
  raw: unknown,
): BillingStateViewModel['resubscribe'] {
  if (!isRecord(raw)) {
    return {
      offered: null,
      provider: null,
      eligible: null,
      eligibleAt: null,
      reasonCode: null,
    };
  }
  const provider = raw.provider === null
    ? null
    : isCheckoutProvider(raw.provider)
      ? raw.provider
      : 'unknown';
  return {
    offered: typeof raw.offered === 'boolean' ? raw.offered : null,
    provider,
    eligible: typeof raw.eligible === 'boolean' ? raw.eligible : null,
    eligibleAt: validTimestamp(raw.eligible_at),
    reasonCode: nullableReason(raw.reason_code),
  };
}

export function deriveBillingState(
  summary: RawBillingSummary | null | undefined,
  now: Date,
): BillingStateViewModel {
  if (!isRecord(summary) || !isRecord(summary.billing_state)) {
    return unknownBillingState();
  }

  const rawState = summary.billing_state;
  const hasEntitlementSource = Object.prototype.hasOwnProperty.call(
    rawState,
    'entitlement_source',
  );
  const entitlementProvider = isBillingProvider(rawState.entitlement_source)
    ? rawState.entitlement_source
    : !hasEntitlementSource && isBillingProvider(summary.payment_provider)
      ? summary.payment_provider
      : 'unknown';
  const checkoutProvider = isCheckoutProvider(rawState.selected_checkout_provider)
    ? rawState.selected_checkout_provider
    : 'unknown';
  const checkoutAllowed = typeof rawState.checkout_allowed === 'boolean'
    ? rawState.checkout_allowed
    : null;
  const handoff = deriveSummaryHandoff(rawState.handoff);
  const blockedUntil = validTimestamp(rawState.checkout_blocked_until);
  const eligibleAt = handoff?.eligibleAt ?? blockedUntil;
  const checkoutAction = checkoutAllowed === true
    ? 'checkout'
    : checkoutAllowed === false && handoff?.state === 'schedule_required'
      ? 'schedule_handoff'
      : 'none';

  return {
    knowledge: 'known',
    entitlementProvider,
    manageDestination: manageDestinationFor(entitlementProvider),
    subscription: deriveSubscription(summary.subscription, now),
    checkout: {
      state: checkoutAllowed === true
        ? 'allowed'
        : checkoutAllowed === false
          ? 'blocked'
          : 'unknown',
      allowed: checkoutAllowed,
      action: checkoutAction,
      provider: checkoutProvider,
      blockedUntil,
      eligibleAt,
      reasonCode: nullableReason(rawState.reason_code),
    },
    handoff,
    resubscribe: deriveResubscribe(rawState.resubscribe),
  };
}

function conflictEntitlementProvider(
  response: RawCheckoutConflict,
): BillingProvider | 'unknown' {
  if (isBillingProvider(response.handoff?.fromProvider)) {
    return response.handoff.fromProvider;
  }
  const decisionSource = response.decision?.inputs?.entitlementLock?.source;
  if (isBillingProvider(decisionSource)) return decisionSource;
  if (response.error === 'polar_entitlement_lock_active') return 'polar';
  if (response.error === 'shopify_entitlement_lock_active') return 'shopify';
  return 'unknown';
}

export function deriveBillingStateFromCheckoutConflict(
  response: RawCheckoutConflict | null | undefined,
  _now: Date,
): BillingStateViewModel {
  if (!isRecord(response) || response.action !== 'blocked') {
    return unknownBillingState();
  }

  const entitlementProvider = conflictEntitlementProvider(response);
  const checkoutProvider = isCheckoutProvider(response.provider)
    ? response.provider
    : 'unknown';
  const blockedUntil = validTimestamp(response.lockEnd);
  const rawHandoff: unknown = response.handoff;
  const handoff = rawHandoff === null || rawHandoff === undefined
    ? null
    : isRecord(rawHandoff)
      ? {
        state: rawHandoff.state === 'scheduled'
          && rawHandoff.fromProvider === 'polar'
          && rawHandoff.toProvider === 'shopify'
          ? 'scheduled' as const
          : 'unknown' as const,
        scheduled: rawHandoff.state === 'scheduled'
          && rawHandoff.fromProvider === 'polar'
          && rawHandoff.toProvider === 'shopify',
        eligibleAt: validTimestamp(rawHandoff.checkoutEligibleAt),
      }
      : { state: 'unknown' as const, scheduled: false, eligibleAt: null };

  return {
    knowledge: 'known',
    entitlementProvider,
    manageDestination: manageDestinationFor(entitlementProvider),
    subscription: {
      state: 'unknown',
      canceledAt: null,
      currentPeriodEnd: null,
    },
    checkout: {
      state: 'blocked',
      allowed: false,
      action: 'none',
      provider: checkoutProvider,
      blockedUntil,
      eligibleAt: handoff?.eligibleAt ?? blockedUntil,
      reasonCode: nullableReason(response.reasonCode),
    },
    handoff,
    resubscribe: {
      offered: null,
      provider: null,
      eligible: null,
      eligibleAt: null,
      reasonCode: null,
    },
  };
}

export function formatBillingDate(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatBillingTimestamp(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

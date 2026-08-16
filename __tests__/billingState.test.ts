import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveBillingState,
  deriveBillingStateFromCheckoutConflict,
  isCheckoutBlocked,
  type RawBillingSummary,
} from '../src/utils/billingState.ts';

const NOW = new Date('2026-08-16T12:00:00.000Z');

function summary(overrides: Partial<RawBillingSummary> = {}): RawBillingSummary {
  return {
    subscription: {
      CurrentPlan: 'Growth',
      Status: 'active',
      CurrentPeriodEnd: '2026-09-16T12:00:00.000Z',
      CanceledAt: null,
    },
    payment_provider: 'polar',
    billing_state: {
      entitlement_source: 'polar',
      selected_checkout_provider: 'polar',
      checkout_allowed: false,
      checkout_blocked_until: '2026-09-16T12:00:00.000Z',
      reason_code: 'polar_entitlement_locked',
      handoff: null,
      resubscribe: {
        offered: false,
        provider: null,
        eligible: false,
        eligible_at: null,
        reason_code: null,
      },
    },
    ...overrides,
  };
}

test('derives a Polar-sourced active entitlement', () => {
  const state = deriveBillingState(summary(), NOW);
  assert.equal(state.entitlementProvider, 'polar');
  assert.equal(state.manageDestination, 'provider_portal');
  assert.equal(state.subscription.state, 'active');
});

test('derives a Shopify-sourced active entitlement', () => {
  const state = deriveBillingState(summary({
    payment_provider: 'shopify',
    billing_state: {
      entitlement_source: 'shopify',
      selected_checkout_provider: 'shopify',
      checkout_allowed: false,
    },
  }), NOW);
  assert.equal(state.entitlementProvider, 'shopify');
  assert.equal(state.manageDestination, 'shopify_admin');
  assert.equal(state.subscription.state, 'active');
});

test('derives canceled but paid-through access from exposed dates', () => {
  const state = deriveBillingState(summary({
    subscription: {
      Status: 'active',
      CanceledAt: '2026-08-10T12:00:00.000Z',
      CurrentPeriodEnd: '2026-09-16T12:00:00.000Z',
    },
  }), NOW);
  assert.equal(state.subscription.state, 'canceled_paid_through');
  assert.equal(state.subscription.currentPeriodEnd, '2026-09-16T12:00:00.000Z');
});

test('maps checkout blocked until the server timestamp', () => {
  const state = deriveBillingState(summary(), NOW);
  assert.equal(state.checkout.state, 'blocked');
  assert.equal(state.checkout.allowed, false);
  assert.equal(state.checkout.blockedUntil, '2026-09-16T12:00:00.000Z');
});

test('maps a scheduled Polar to Shopify handoff', () => {
  const state = deriveBillingState(summary({
    billing_state: {
      entitlement_source: 'polar',
      selected_checkout_provider: 'shopify',
      checkout_allowed: false,
      handoff: {
        state: 'scheduled',
        from_provider: 'polar',
        to_provider: 'shopify',
        checkout_eligible_at: '2026-09-16T12:00:00.000Z',
      },
    },
  }), NOW);
  assert.equal(state.handoff?.scheduled, true);
  assert.equal(state.checkout.eligibleAt, '2026-09-16T12:00:00.000Z');
});

test('maps a ready handoff to allowed checkout', () => {
  const state = deriveBillingState(summary({
    billing_state: {
      entitlement_source: 'polar',
      selected_checkout_provider: 'shopify',
      checkout_allowed: true,
      handoff: {
        state: 'ready',
        from_provider: 'polar',
        to_provider: 'shopify',
        checkout_eligible_at: '2026-08-15T12:00:00.000Z',
      },
    },
  }), NOW);
  assert.equal(state.handoff?.state, 'ready');
  assert.equal(state.checkout.action, 'checkout');
});

test('maps a required handoff to a scheduling action, not checkout', () => {
  const state = deriveBillingState(summary({
    billing_state: {
      entitlement_source: 'polar',
      selected_checkout_provider: 'shopify',
      checkout_allowed: false,
      handoff: {
        state: 'schedule_required',
        from_provider: 'polar',
        to_provider: 'shopify',
        checkout_eligible_at: '2026-09-16T12:00:00.000Z',
      },
    },
  }), NOW);
  assert.equal(state.checkout.allowed, false);
  assert.equal(state.checkout.action, 'schedule_handoff');
});

test('keeps an offered re-subscribe action disabled until eligible', () => {
  const state = deriveBillingState(summary({
    billing_state: {
      entitlement_source: 'polar',
      selected_checkout_provider: 'shopify',
      checkout_allowed: false,
      resubscribe: {
        offered: true,
        provider: 'shopify',
        eligible: false,
        eligible_at: '2026-09-16T12:00:00.000Z',
      },
    },
  }), NOW);
  assert.equal(state.resubscribe.offered, true);
  assert.equal(state.resubscribe.eligible, false);
  assert.equal(state.resubscribe.eligibleAt, '2026-09-16T12:00:00.000Z');
});

test('enables re-subscribe only when the server marks it eligible', () => {
  const state = deriveBillingState(summary({
    subscription: { Status: 'inactive' },
    billing_state: {
      entitlement_source: 'shopify',
      selected_checkout_provider: 'polar',
      checkout_allowed: true,
      resubscribe: {
        offered: true,
        provider: 'polar',
        eligible: true,
        eligible_at: null,
        reason_code: 'shopify_to_polar_fallback',
      },
    },
  }), NOW);
  assert.equal(state.resubscribe.eligible, true);
  assert.equal(state.checkout.allowed, true);
});

test('maps manual entitlements to support management', () => {
  const state = deriveBillingState(summary({
    payment_provider: 'manual',
    billing_state: {
      entitlement_source: 'manual',
      selected_checkout_provider: 'polar',
      checkout_allowed: false,
    },
  }), NOW);
  assert.equal(state.entitlementProvider, 'manual');
  assert.equal(state.manageDestination, 'contact_support');
});

test('degrades a summary without billing_state to unknown', () => {
  const state = deriveBillingState({
    payment_provider: 'polar',
    subscription: { Status: 'active' },
  }, NOW);
  assert.equal(state.knowledge, 'unknown');
  assert.equal(state.entitlementProvider, 'unknown');
  assert.equal(state.checkout.allowed, null);
  assert.equal(state.subscription.state, 'unknown');
});

test('maps a checkout 409 handoff into scheduled eligibility', () => {
  const state = deriveBillingStateFromCheckoutConflict({
    statusCode: 409,
    error: 'polar_entitlement_lock_active',
    provider: 'shopify',
    action: 'blocked',
    reasonCode: 'polar_entitlement_locked',
    lockEnd: '2026-09-16T12:00:00.000Z',
    handoff: {
      state: 'scheduled',
      fromProvider: 'polar',
      toProvider: 'shopify',
      checkoutEligibleAt: '2026-09-16T12:00:00.000Z',
      eventId: 'event-1',
      duplicate: false,
    },
  }, NOW);
  assert.equal(state.entitlementProvider, 'polar');
  assert.equal(state.checkout.provider, 'shopify');
  assert.equal(state.handoff?.scheduled, true);
  assert.equal(state.checkout.eligibleAt, '2026-09-16T12:00:00.000Z');
});

test('permits a checkout attempt when billing state is unknown', () => {
  const state = deriveBillingState(null, NOW);
  assert.equal(state.checkout.state, 'unknown');
  assert.equal(isCheckoutBlocked(state.checkout.allowed), false);
});

test('forbids checkout when the summary explicitly disallows it', () => {
  const state = deriveBillingState(summary(), NOW);
  assert.equal(state.checkout.state, 'blocked');
  assert.equal(isCheckoutBlocked(state.checkout.allowed), true);
});

test('forbids checkout after a mapped 409 conflict', () => {
  const state = deriveBillingStateFromCheckoutConflict({
    statusCode: 409,
    action: 'blocked',
  }, NOW);
  assert.equal(state.checkout.state, 'blocked');
  assert.equal(isCheckoutBlocked(state.checkout.allowed), true);
});

test('permits a checkout attempt when billing_state is absent', () => {
  const state = deriveBillingState({
    payment_provider: 'polar',
    subscription: { Status: 'active' },
  }, NOW);
  assert.equal(state.checkout.state, 'unknown');
  assert.equal(isCheckoutBlocked(state.checkout.allowed), false);
});

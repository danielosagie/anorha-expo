import assert from 'node:assert/strict';
import test from 'node:test';

import { billingGateCopy, normalizeBillingGateResponse } from '../src/types/billingGate.ts';

test('preserves a complete free-tier exhaustion decision', () => {
  const gate = normalizeBillingGateResponse({
    code: 'free_tier_exhausted',
    blockingState: 'free_tier_exhausted',
    canProceed: false,
    freeUsageCount: 3,
    freeLimit: 3,
  });

  assert.equal(gate.code, 'free_tier_exhausted');
  assert.equal(gate.canProceed, false);
  assert.equal(gate.freeUsageCount, 3);
  assert.equal(gate.freeLimit, 3);
});

test('preserves invoiceable overage as an explicit continue decision', () => {
  const gate = normalizeBillingGateResponse({
    code: 'credits_exhausted_but_invoiceable',
    blockingState: 'invoiceable_overage',
    canProceed: true,
  });

  assert.equal(gate.code, 'credits_exhausted_but_invoiceable');
  assert.equal(gate.blockingState, 'invoiceable_overage');
  assert.equal(gate.canProceed, true);
});

test('classifies an unknown error code as unavailable instead of exhausted', () => {
  const gate = normalizeBillingGateResponse({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Entitlement query failed.',
    canProceed: false,
  });

  assert.equal(gate.code, 'billing_status_unavailable');
  assert.equal(gate.blockingState, 'billing_status_unavailable');
  assert.equal(gate.canProceed, false);
  assert.equal(gate.message, 'Entitlement query failed.');
});

test('classifies a missing decision as unavailable instead of a paywall', () => {
  const gate = normalizeBillingGateResponse({ code: 'ok' });

  assert.equal(gate.code, 'billing_status_unavailable');
  assert.equal(gate.blockingState, 'billing_status_unavailable');
  assert.equal(gate.canProceed, false);
  assert.equal(gate.message, 'The billing service returned an incomplete status.');
});

test('classifies a contradictory decision as unavailable', () => {
  const gate = normalizeBillingGateResponse({
    code: 'ok',
    blockingState: 'none',
    canProceed: false,
  });

  assert.equal(gate.code, 'billing_status_unavailable');
  assert.equal(gate.blockingState, 'billing_status_unavailable');
  assert.equal(gate.canProceed, false);
});

test('gate copy distinguishes free, paid, invoice, cap, and unavailable states', () => {
  assert.deepEqual(billingGateCopy({
    code: 'free_tier_exhausted',
    freeUsageCount: 3,
    freeLimit: 3,
  }), {
    title: 'Out of free scans',
    body: '3 of 3 free scans used.',
  });
  assert.deepEqual(billingGateCopy({ code: 'hard_cap_blocked' }), {
    title: 'Usage cap reached',
    body: 'Review billing to keep scanning.',
  });
  assert.deepEqual(billingGateCopy({ code: 'invoice_required' }), {
    title: 'Billing needs attention',
    body: 'Review billing to keep scanning.',
  });
  assert.deepEqual(billingGateCopy({ code: 'billing_status_unavailable' }), {
    title: 'Could not verify billing',
    body: 'Try again.',
  });
  assert.deepEqual(billingGateCopy({ code: 'credits_exhausted_but_invoiceable' }), {
    title: 'This scan can continue',
    body: 'Continue or add credits.',
  });
  assert.doesNotMatch(
    JSON.stringify([
      billingGateCopy({ code: 'hard_cap_blocked' }),
      billingGateCopy({ code: 'invoice_required' }),
      billingGateCopy({ code: 'credits_exhausted_but_invoiceable' }),
    ]),
    /free scans/i,
  );
});

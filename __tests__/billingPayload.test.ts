import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getInvoiceReceiptUrl,
  parseBillingInvoicesResponse,
  parseBillingSummaryResponse,
  parsePartnerPaymentMethodResponse,
  parseUpcomingInvoiceResponse,
  type BillingInvoicePayload,
} from '../src/utils/billingPayload.ts';

function billingSummary(overrides: Record<string, unknown> = {}) {
  return {
    subscription: {
      CurrentPlan: 'Growth',
      Status: 'active',
      CurrentPeriodEnd: '2026-09-19T12:00:00.000Z',
      CanceledAt: null,
    },
    usage: {
      ai_quick_scan: {
        totalCost: 24,
        internalCost: 8,
        totalQuantity: 2,
      },
    },
    compute_allowance_cents: 200,
    compute_used_cents: 8,
    ai_overage_cents: 0,
    total_cost_cents: 2000,
    team_members_count: 2,
    team_members_included: 2,
    team_members_extra: 0,
    team_members_cost: 0,
    payment_provider: 'polar',
    billing_state: {
      entitlement_source: 'polar',
      selected_checkout_provider: 'polar',
      checkout_allowed: false,
    },
    ...overrides,
  };
}

function invoice(overrides: Partial<BillingInvoicePayload> = {}): BillingInvoicePayload {
  return {
    id: 'order-1',
    status: 'paid',
    total: 2000,
    currency: 'USD',
    created: 1_776_758_400,
    hosted_invoice_url: 'https://polar.sh/receipt/order-1',
    ...overrides,
  };
}

test('parses the backend invoices wrapper', () => {
  const result = parseBillingInvoicesResponse({
    invoices: [invoice({ currency: 'usd' })],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.length, 1);
  assert.equal(result.value[0].currency, 'USD');
  assert.equal(result.value[0].hosted_invoice_url, 'https://polar.sh/receipt/order-1');
});

test('accepts an honest empty invoices response', () => {
  const result = parseBillingInvoicesResponse({ invoices: [] });

  assert.deepEqual(result, { ok: true, value: [] });
});

test('rejects legacy invoice array and data wrapper shapes', () => {
  assert.deepEqual(parseBillingInvoicesResponse([invoice()]), {
    ok: false,
    field: 'invoices',
  });
  assert.deepEqual(parseBillingInvoicesResponse({ data: [invoice()] }), {
    ok: false,
    field: 'invoices',
  });
});

test('rejects invoices that cannot be rendered faithfully', () => {
  const result = parseBillingInvoicesResponse({
    invoices: [{ ...invoice(), total: '2000' }],
  });

  assert.deepEqual(result, { ok: false, field: 'invoices.0.total' });
});

test('uses only the normalized hosted invoice URL', () => {
  assert.equal(getInvoiceReceiptUrl(invoice()), 'https://polar.sh/receipt/order-1');
  assert.equal(getInvoiceReceiptUrl(invoice({ hosted_invoice_url: null })), null);
  assert.equal(getInvoiceReceiptUrl({
    ...invoice({ hosted_invoice_url: null }),
    hosted_url: 'https://legacy.example/receipt',
    url: 'https://legacy.example/order',
  } as BillingInvoicePayload), null);
  assert.equal(getInvoiceReceiptUrl(invoice({ hosted_invoice_url: 'file:///tmp/receipt' })), null);
});

test('parses the backend upcoming invoice wrapper and due date', () => {
  const result = parseUpcomingInvoiceResponse({
    upcoming: {
      id: 'upcoming-sub-1',
      total: 2000,
      due_date: '2026-09-19T12:00:00.000Z',
      currency: 'USD',
      description: 'Growth renewal',
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value?.due_date, '2026-09-19T12:00:00.000Z');
});

test('accepts no upcoming invoice and rejects unwrapped data', () => {
  assert.deepEqual(parseUpcomingInvoiceResponse({ upcoming: null }), {
    ok: true,
    value: null,
  });
  assert.deepEqual(parseUpcomingInvoiceResponse({
    id: 'upcoming-sub-1',
    total: 2000,
    due_date: '2026-09-19T12:00:00.000Z',
  }), {
    ok: false,
    field: 'upcoming',
  });
});

test('parses the exact billing summary usage and cost contract', () => {
  const result = parseBillingSummaryResponse(billingSummary());

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.usage.ai_quick_scan.totalQuantity, 2);
  assert.equal(result.value.total_cost_cents, 2000);
});

test('rejects guessed usage aliases instead of silently zeroing data', () => {
  const result = parseBillingSummaryResponse(billingSummary({
    usage: {
      ai_quick_scan: {
        total_cost_cents: 24,
        internal_cost_cents: 8,
        total_quantity: 2,
      },
    },
  }));

  assert.deepEqual(result, {
    ok: false,
    field: 'summary.usage.ai_quick_scan.totalCost',
  });
});

test('rejects a wrapped summary instead of rendering fallback zeroes', () => {
  const result = parseBillingSummaryResponse({ data: billingSummary() });

  assert.deepEqual(result, { ok: false, field: 'summary.subscription' });
});

test('parses the direct partner payment method contract', () => {
  assert.deepEqual(parsePartnerPaymentMethodResponse({
    hasPaymentMethod: true,
    lastFour: '4242',
    brand: 'visa',
    expiresAt: '9/2028',
  }), {
    ok: true,
    value: {
      hasPaymentMethod: true,
      lastFour: '4242',
      brand: 'visa',
      expiresAt: '9/2028',
    },
  });
});

test('rejects a wrapped partner payment response', () => {
  assert.deepEqual(parsePartnerPaymentMethodResponse({
    data: { hasPaymentMethod: false },
  }), {
    ok: false,
    field: 'partnerPaymentMethod.hasPaymentMethod',
  });
});

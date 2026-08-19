export type BillingGateCode =
  | 'ok'
  | 'free_tier_exhausted'
  | 'credits_exhausted_but_invoiceable'
  | 'invoice_required'
  | 'hard_cap_blocked'
  | 'billing_status_unavailable';

export type BillingBlockingState =
  | 'none'
  | 'free_tier_exhausted'
  | 'invoiceable_overage'
  | 'invoice_required'
  | 'hard_cap_blocked'
  | 'billing_status_unavailable';

export interface BillingGateResponse {
  code: BillingGateCode;
  message: string;
  featureKey: string;
  blockingState: BillingBlockingState;
  estimatedCostCents: number;
  currentUsageCents: number;
  allowanceCents: number;
  canProceed: boolean;
  pendingInvoiceCount: number;
  invoiceStatus: string | null;
  freeUsageCount?: number;
  freeLimit?: number;
  resumeToken?: string | null;
}

const BILLING_GATE_CODES: ReadonlySet<BillingGateCode> = new Set([
  'ok',
  'free_tier_exhausted',
  'credits_exhausted_but_invoiceable',
  'invoice_required',
  'hard_cap_blocked',
  'billing_status_unavailable',
]);

function isBillingGateCode(value: unknown): value is BillingGateCode {
  return typeof value === 'string' && BILLING_GATE_CODES.has(value as BillingGateCode);
}

export function normalizeBillingGateResponse(
  payload: any,
  featureKey = 'ai_quick_scan',
): BillingGateResponse {
  const candidateCode: BillingGateCode = isBillingGateCode(payload?.code)
    ? payload.code
    : payload?.error === 'FREE_TIER_EXHAUSTED'
      ? 'free_tier_exhausted'
      : 'billing_status_unavailable';
  const hasDecision = typeof payload?.canProceed === 'boolean';
  const decisionMatchesCode = candidateCode === 'ok' || candidateCode === 'credits_exhausted_but_invoiceable'
    ? payload?.canProceed === true
    : payload?.canProceed === false;
  const resolvedCode: BillingGateCode = hasDecision && decisionMatchesCode
    ? candidateCode
    : 'billing_status_unavailable';
  const resolvedBlockingState: BillingBlockingState = payload?.blockingState
    && resolvedCode !== 'billing_status_unavailable'
    ? payload.blockingState
    : (resolvedCode === 'ok'
      ? 'none'
      : resolvedCode === 'credits_exhausted_but_invoiceable'
        ? 'invoiceable_overage'
        : resolvedCode);

  return {
    code: resolvedCode,
    message: typeof payload?.message === 'string' && payload.message.trim()
      ? payload.message
      : (resolvedCode === 'billing_status_unavailable'
        ? 'The billing service returned an incomplete status.'
        : 'Billing needs attention before continuing.'),
    featureKey: payload?.featureKey || featureKey,
    blockingState: resolvedBlockingState,
    estimatedCostCents: Number(payload?.estimatedCostCents) || 0,
    currentUsageCents: Number(payload?.currentUsageCents) || 0,
    allowanceCents: Number(payload?.allowanceCents) || 0,
    canProceed: resolvedCode === 'billing_status_unavailable' ? false : payload.canProceed,
    pendingInvoiceCount: Number(payload?.pendingInvoiceCount) || 0,
    invoiceStatus: payload?.invoiceStatus || null,
    freeUsageCount: Number.isFinite(Number(payload?.freeUsageCount ?? payload?.usageCount))
      ? Number(payload?.freeUsageCount ?? payload?.usageCount)
      : undefined,
    freeLimit: Number.isFinite(Number(payload?.freeLimit)) ? Number(payload?.freeLimit) : undefined,
    resumeToken: payload?.resumeToken || null,
  };
}

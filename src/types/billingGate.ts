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

export function normalizeBillingGateResponse(
  payload: any,
  featureKey = 'ai_quick_scan',
): BillingGateResponse {
  const resolvedCode: BillingGateCode = payload?.code
    ? (payload.code as BillingGateCode)
    : payload?.error === 'FREE_TIER_EXHAUSTED'
      ? 'free_tier_exhausted'
      : 'billing_status_unavailable';
  const resolvedBlockingState: BillingBlockingState = payload?.blockingState
    || (resolvedCode === 'ok'
      ? 'none'
      : resolvedCode === 'credits_exhausted_but_invoiceable'
        ? 'invoiceable_overage'
        : resolvedCode);

  return {
    code: resolvedCode,
    message: payload?.message || 'Billing needs attention before continuing.',
    featureKey: payload?.featureKey || featureKey,
    blockingState: resolvedBlockingState,
    estimatedCostCents: Number(payload?.estimatedCostCents) || 0,
    currentUsageCents: Number(payload?.currentUsageCents) || 0,
    allowanceCents: Number(payload?.allowanceCents) || 0,
    canProceed: Boolean(payload?.canProceed),
    pendingInvoiceCount: Number(payload?.pendingInvoiceCount) || 0,
    invoiceStatus: payload?.invoiceStatus || null,
    freeUsageCount: Number.isFinite(Number(payload?.freeUsageCount ?? payload?.usageCount))
      ? Number(payload?.freeUsageCount ?? payload?.usageCount)
      : undefined,
    freeLimit: Number.isFinite(Number(payload?.freeLimit)) ? Number(payload?.freeLimit) : undefined,
    resumeToken: payload?.resumeToken || null,
  };
}

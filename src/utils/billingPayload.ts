import type {
  RawBillingState,
  RawBillingSubscription,
  RawBillingSummary,
} from './billingState';

export type BillingPayloadResult<T> =
  | { ok: true; value: T }
  | { ok: false; field: string };

export interface BillingUsagePayload {
  totalCost: number;
  internalCost: number;
  totalQuantity: number;
}

export interface BillingSummaryPayload extends RawBillingSummary {
  subscription: RawBillingSubscription | null;
  usage: Record<string, BillingUsagePayload>;
  compute_allowance_cents: number;
  compute_used_cents: number;
  ai_credits_cents?: number;
  ai_allowance_cents?: number;
  ai_used_cents?: number;
  ai_remaining_cents?: number;
  ai_topup_remaining_cents?: number;
  ai_topup_total_cents?: number;
  last_topup_cents?: number;
  last_topup_at?: string | null;
  ai_overage_cents: number;
  total_cost_cents: number;
  team_members_count: number;
  team_members_included: number;
  team_members_extra: number;
  team_members_cost: number;
  billing_state: RawBillingState;
}

export interface BillingInvoicePayload {
  id: string;
  status: string;
  total: number;
  currency: string;
  created: number;
  hosted_invoice_url: string | null;
}

export interface UpcomingInvoicePayload {
  id: string;
  total: number;
  due_date: string;
  currency: string;
  description: string;
}

export interface PartnerPaymentMethodPayload {
  hasPaymentMethod: boolean;
  lastFour?: string;
  brand?: string;
  expiresAt?: string;
}

function invalid<T>(field: string): BillingPayloadResult<T> {
  return { ok: false, field };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function parseBillingSummaryPayload(
  payload: unknown,
): BillingPayloadResult<BillingSummaryPayload> {
  if (!isRecord(payload)) return invalid('summary');
  if (payload.subscription !== null && !isRecord(payload.subscription)) {
    return invalid('summary.subscription');
  }
  if (!isRecord(payload.usage)) return invalid('summary.usage');
  if (!isRecord(payload.billing_state)) return invalid('summary.billing_state');
  if (payload.payment_provider !== null && typeof payload.payment_provider !== 'string') {
    return invalid('summary.payment_provider');
  }

  if (isRecord(payload.subscription)) {
    const currentPlan = payload.subscription.CurrentPlan
      ?? payload.subscription.current_plan;
    if (typeof currentPlan !== 'string') {
      return invalid('summary.subscription.CurrentPlan');
    }
    if (typeof payload.subscription.Status !== 'string') {
      return invalid('summary.subscription.Status');
    }
    if (!isNullableString(payload.subscription.CurrentPeriodEnd)) {
      return invalid('summary.subscription.CurrentPeriodEnd');
    }
    if (!isNullableString(payload.subscription.CanceledAt)) {
      return invalid('summary.subscription.CanceledAt');
    }
  }

  const numericFields = [
    'compute_allowance_cents',
    'compute_used_cents',
    'ai_overage_cents',
    'total_cost_cents',
    'team_members_count',
    'team_members_included',
    'team_members_extra',
    'team_members_cost',
  ] as const;

  for (const field of numericFields) {
    if (!isFiniteNumber(payload[field])) return invalid(`summary.${field}`);
  }

  const optionalNumericFields = [
    'ai_credits_cents',
    'ai_allowance_cents',
    'ai_used_cents',
    'ai_remaining_cents',
    'ai_topup_remaining_cents',
    'ai_topup_total_cents',
    'last_topup_cents',
  ] as const;

  for (const field of optionalNumericFields) {
    if (payload[field] !== undefined && !isFiniteNumber(payload[field])) {
      return invalid(`summary.${field}`);
    }
  }
  if (payload.last_topup_at !== undefined && !isNullableString(payload.last_topup_at)) {
    return invalid('summary.last_topup_at');
  }

  const usage: Record<string, BillingUsagePayload> = {};
  for (const [key, rawEntry] of Object.entries(payload.usage)) {
    if (!isRecord(rawEntry)) return invalid(`summary.usage.${key}`);
    if (!isFiniteNumber(rawEntry.totalCost)) {
      return invalid(`summary.usage.${key}.totalCost`);
    }
    if (!isFiniteNumber(rawEntry.internalCost)) {
      return invalid(`summary.usage.${key}.internalCost`);
    }
    if (!isFiniteNumber(rawEntry.totalQuantity)) {
      return invalid(`summary.usage.${key}.totalQuantity`);
    }
    usage[key] = {
      totalCost: rawEntry.totalCost,
      internalCost: rawEntry.internalCost,
      totalQuantity: rawEntry.totalQuantity,
    };
  }

  return {
    ok: true,
    value: {
      ...(payload as RawBillingSummary),
      subscription: payload.subscription as RawBillingSubscription | null,
      usage,
      compute_allowance_cents: payload.compute_allowance_cents as number,
      compute_used_cents: payload.compute_used_cents as number,
      ...(payload.ai_credits_cents === undefined
        ? {}
        : { ai_credits_cents: payload.ai_credits_cents as number }),
      ...(payload.ai_allowance_cents === undefined
        ? {}
        : { ai_allowance_cents: payload.ai_allowance_cents as number }),
      ...(payload.ai_used_cents === undefined
        ? {}
        : { ai_used_cents: payload.ai_used_cents as number }),
      ...(payload.ai_remaining_cents === undefined
        ? {}
        : { ai_remaining_cents: payload.ai_remaining_cents as number }),
      ...(payload.ai_topup_remaining_cents === undefined
        ? {}
        : { ai_topup_remaining_cents: payload.ai_topup_remaining_cents as number }),
      ...(payload.ai_topup_total_cents === undefined
        ? {}
        : { ai_topup_total_cents: payload.ai_topup_total_cents as number }),
      ...(payload.last_topup_cents === undefined
        ? {}
        : { last_topup_cents: payload.last_topup_cents as number }),
      ...(payload.last_topup_at === undefined
        ? {}
        : { last_topup_at: payload.last_topup_at as string | null }),
      ai_overage_cents: payload.ai_overage_cents as number,
      total_cost_cents: payload.total_cost_cents as number,
      team_members_count: payload.team_members_count as number,
      team_members_included: payload.team_members_included as number,
      team_members_extra: payload.team_members_extra as number,
      team_members_cost: payload.team_members_cost as number,
      billing_state: payload.billing_state as RawBillingState,
    },
  };
}

export function parseBillingSummaryResponse(
  payload: unknown,
): BillingPayloadResult<BillingSummaryPayload> {
  return parseBillingSummaryPayload(payload);
}

export function parseBillingInvoicesResponse(
  payload: unknown,
): BillingPayloadResult<BillingInvoicePayload[]> {
  if (!isRecord(payload) || !Array.isArray(payload.invoices)) {
    return invalid('invoices');
  }

  const invoices: BillingInvoicePayload[] = [];
  for (const [index, rawInvoice] of payload.invoices.entries()) {
    const prefix = `invoices.${index}`;
    if (!isRecord(rawInvoice)) return invalid(prefix);
    if (typeof rawInvoice.id !== 'string' || rawInvoice.id.length === 0) {
      return invalid(`${prefix}.id`);
    }
    if (typeof rawInvoice.status !== 'string' || rawInvoice.status.length === 0) {
      return invalid(`${prefix}.status`);
    }
    if (!isFiniteNumber(rawInvoice.total)) return invalid(`${prefix}.total`);
    if (typeof rawInvoice.currency !== 'string' || !/^[A-Za-z]{3}$/.test(rawInvoice.currency)) {
      return invalid(`${prefix}.currency`);
    }
    if (!isFiniteNumber(rawInvoice.created)) return invalid(`${prefix}.created`);
    if (rawInvoice.hosted_invoice_url !== null && typeof rawInvoice.hosted_invoice_url !== 'string') {
      return invalid(`${prefix}.hosted_invoice_url`);
    }
    invoices.push({
      id: rawInvoice.id,
      status: rawInvoice.status,
      total: rawInvoice.total,
      currency: rawInvoice.currency.toUpperCase(),
      created: rawInvoice.created,
      hosted_invoice_url: rawInvoice.hosted_invoice_url,
    });
  }

  return { ok: true, value: invoices };
}

export function parseUpcomingInvoiceResponse(
  payload: unknown,
): BillingPayloadResult<UpcomingInvoicePayload | null> {
  if (!isRecord(payload) || !Object.prototype.hasOwnProperty.call(payload, 'upcoming')) {
    return invalid('upcoming');
  }
  if (payload.upcoming === null) return { ok: true, value: null };
  if (!isRecord(payload.upcoming)) return invalid('upcoming');

  const upcoming = payload.upcoming;
  if (typeof upcoming.id !== 'string' || upcoming.id.length === 0) {
    return invalid('upcoming.id');
  }
  if (!isFiniteNumber(upcoming.total)) return invalid('upcoming.total');
  if (typeof upcoming.due_date !== 'string' || !Number.isFinite(Date.parse(upcoming.due_date))) {
    return invalid('upcoming.due_date');
  }
  if (typeof upcoming.currency !== 'string' || !/^[A-Z]{3}$/.test(upcoming.currency)) {
    return invalid('upcoming.currency');
  }
  if (typeof upcoming.description !== 'string') return invalid('upcoming.description');

  return {
    ok: true,
    value: {
      id: upcoming.id,
      total: upcoming.total,
      due_date: upcoming.due_date,
      currency: upcoming.currency,
      description: upcoming.description,
    },
  };
}

export function parsePartnerPaymentMethodResponse(
  payload: unknown,
): BillingPayloadResult<PartnerPaymentMethodPayload> {
  if (!isRecord(payload) || typeof payload.hasPaymentMethod !== 'boolean') {
    return invalid('partnerPaymentMethod.hasPaymentMethod');
  }
  if (!isOptionalString(payload.lastFour)) return invalid('partnerPaymentMethod.lastFour');
  if (!isOptionalString(payload.brand)) return invalid('partnerPaymentMethod.brand');
  if (!isOptionalString(payload.expiresAt)) return invalid('partnerPaymentMethod.expiresAt');

  return {
    ok: true,
    value: {
      hasPaymentMethod: payload.hasPaymentMethod,
      ...(payload.lastFour === undefined ? {} : { lastFour: payload.lastFour }),
      ...(payload.brand === undefined ? {} : { brand: payload.brand }),
      ...(payload.expiresAt === undefined ? {} : { expiresAt: payload.expiresAt }),
    },
  };
}

export function getInvoiceReceiptUrl(invoice: BillingInvoicePayload): string | null {
  const url = invoice.hosted_invoice_url;
  return typeof url === 'string' && /^https?:\/\/\S+$/i.test(url) ? url : null;
}

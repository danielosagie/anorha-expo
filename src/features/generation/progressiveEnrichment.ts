export type EnrichmentStatus = 'pending' | 'completed' | 'partial' | 'failed';

export interface ProgressiveEnrichment {
  status: EnrichmentStatus;
  taxonomy?: Record<string, {
    categoryId?: string;
    path?: string;
    confidence?: number;
    source?: string;
  }>;
  shipping?: {
    estimate?: Record<string, unknown>;
    platformOptions?: Record<string, Array<{
      id?: string;
      name: string;
      deliveryMethod?: 'in_person' | 'shipping' | 'both';
      shippingCost?: number | string;
      currency?: string;
      scope?: 'listing_profile' | 'delivery_profile' | 'payment_link' | 'order_type' | 'seller_default';
      isDefault?: boolean;
      manageable?: boolean;
      source: 'connected_platform' | 'seller_preference' | 'estimated';
    }>>;
    platformDefaults?: Record<string, {
      deliveryMethod?: 'in_person' | 'shipping' | 'both';
      shippingCost?: number | string;
      fulfillmentPolicyId?: string;
      fulfillmentPolicyName?: string;
      currency?: string;
      scope?: 'listing_profile' | 'delivery_profile' | 'payment_link' | 'order_type' | 'seller_default';
      source: 'connected_platform' | 'seller_preference' | 'estimated';
      confidence?: number;
    }>;
  };
  errors?: string[];
  completedAt?: string;
}

export interface ProgressiveGenerateResult {
  productIndex: number;
  productId?: string;
  variantId?: string;
  platforms: Record<string, any>;
  sourceImageUrl?: string;
  processingTimeMs?: number;
  source?: string;
  draftReady?: boolean;
  draftReadyAt?: string;
  enrichment?: ProgressiveEnrichment;
  [key: string]: any;
}

const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const TAXONOMY_FIELDS = [
  'categoryId',
  'category',
  'categoryPath',
  'productCategoryId',
  'productCategory',
  'taxonomyConfidence',
  'taxonomySource',
] as const;

const SHIPPING_FIELDS = [
  'deliveryMethod',
  'shippingCost',
  'fulfillmentPolicyId',
  'fulfillmentPolicyName',
  'shippingCurrency',
  'shippingScope',
] as const;

const ESTIMATE_FIELDS = [
  'estimatedDimensions',
  'estimatedWeight',
  'shippingTier',
  'shippingTierReason',
  'weight',
  'weightUnit',
] as const;

function groupWasEdited(
  baseline: Record<string, any>,
  current: Record<string, any>,
  fields: readonly string[],
): boolean {
  return fields.some((field) => !equal(baseline?.[field], current?.[field]));
}

function platformKeyOf(platforms: Record<string, any>, requested: string): string {
  return Object.keys(platforms).find((key) => key.toLowerCase() === requested.toLowerCase()) ?? requested.toLowerCase();
}

/**
 * Merge late taxonomy/shipping defaults into a usable listing draft.
 *
 * The baseline is the platform payload received when draftReady first became true.
 * If any field in a related group differs from that baseline, the seller (or a local
 * helper they invoked) has already changed the group, so the entire server default group
 * stays underneath it. This avoids mismatched category ids/paths and shipping policies.
 */
export function applyProgressiveEnrichment(
  baselinePlatforms: Record<string, any>,
  currentPlatforms: Record<string, any>,
  enrichment?: ProgressiveEnrichment,
): Record<string, any> {
  if (!enrichment) return currentPlatforms;
  const next: Record<string, any> = { ...currentPlatforms };

  for (const [requestedKey, taxonomy] of Object.entries(enrichment.taxonomy ?? {})) {
    const key = platformKeyOf(next, requestedKey);
    const baseline = baselinePlatforms[key] ?? baselinePlatforms[requestedKey] ?? {};
    const current = next[key] ?? {};
    if (groupWasEdited(baseline, current, TAXONOMY_FIELDS)) continue;

    const isShopify = key.toLowerCase() === 'shopify';
    next[key] = {
      ...current,
      ...(taxonomy.categoryId
        ? (isShopify ? { productCategoryId: taxonomy.categoryId } : { categoryId: taxonomy.categoryId })
        : {}),
      ...(taxonomy.path
        ? (isShopify
          ? { productCategory: taxonomy.path, categoryPath: taxonomy.path }
          : { category: taxonomy.path, categoryPath: taxonomy.path })
        : {}),
      ...(typeof taxonomy.confidence === 'number' ? { taxonomyConfidence: taxonomy.confidence } : {}),
      ...(taxonomy.source ? { taxonomySource: taxonomy.source } : {}),
    };
  }

  for (const [requestedKey, defaults] of Object.entries(enrichment.shipping?.platformDefaults ?? {})) {
    const key = platformKeyOf(next, requestedKey);
    const baseline = baselinePlatforms[key] ?? baselinePlatforms[requestedKey] ?? {};
    const current = next[key] ?? {};
    if (groupWasEdited(baseline, current, SHIPPING_FIELDS)) continue;
    next[key] = {
      ...current,
      ...(defaults.deliveryMethod ? { deliveryMethod: defaults.deliveryMethod } : {}),
      ...(defaults.shippingCost !== undefined ? { shippingCost: defaults.shippingCost } : {}),
      ...(defaults.fulfillmentPolicyId ? { fulfillmentPolicyId: defaults.fulfillmentPolicyId } : {}),
      ...(defaults.fulfillmentPolicyName ? { fulfillmentPolicyName: defaults.fulfillmentPolicyName } : {}),
      ...(defaults.currency ? { shippingCurrency: defaults.currency } : {}),
      ...(defaults.scope ? { shippingScope: defaults.scope } : {}),
    };
  }

  // Retain all server-ranked options for future pickers/debugging. This metadata never
  // replaces a seller field; only the separately selected platformDefault can do that.
  for (const [requestedKey, options] of Object.entries(enrichment.shipping?.platformOptions ?? {})) {
    const key = platformKeyOf(next, requestedKey);
    next[key] = { ...(next[key] ?? {}), shippingOptions: options };
  }

  const estimate = enrichment.shipping?.estimate;
  if (estimate) {
    for (const key of Object.keys(next)) {
      const baseline = baselinePlatforms[key] ?? {};
      const current = next[key] ?? {};
      if (groupWasEdited(baseline, current, ESTIMATE_FIELDS)) continue;
      const estimateDefaults = Object.fromEntries(
        ESTIMATE_FIELDS
          .filter((field) => estimate[field] !== undefined)
          .map((field) => [field, estimate[field]]),
      );
      if (Object.keys(estimateDefaults).length > 0) next[key] = { ...current, ...estimateDefaults };
    }
  }

  return next;
}

export function enrichmentLabel(status?: EnrichmentStatus): string | null {
  if (status === 'pending') return 'Draft ready · Finishing category & shipping…';
  if (status === 'partial' || status === 'failed') return 'Draft ready · Some defaults unavailable';
  return null;
}

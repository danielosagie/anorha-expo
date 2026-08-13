import type {
  GenerationPhoto,
  ItemIdentity,
  PricingSample,
  PricingSnapshot,
  SubmitGenerateJobRequest,
} from '../../contracts';

type GenerateProduct = SubmitGenerateJobRequest['products'][number];

const clean = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

export const canonicalIdentityKey = (input: {
  sellerCorrection?: string;
  brand?: string;
  productType?: string;
  model?: string;
  displayName?: string;
}): string => {
  const corrected = clean(input.sellerCorrection);
  const parts = corrected
    ? [corrected]
    : [input.brand, input.productType, input.model, input.displayName].map(clean).filter(Boolean);
  return Array.from(new Set(parts.join(' ').toLowerCase().match(/[a-z0-9]+/g) || []))
    .join('-') || 'unknown-item';
};

export const candidatePrice = (candidate: any): number | undefined => {
  const raw = candidate?.price?.value
    ?? candidate?.price?.extracted_value
    ?? candidate?.price?.amount
    ?? candidate?.price;
  const value = Number(String(raw ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

function buildItemIdentity(input: {
  identityTitle: string;
  candidate: any;
  sellerConfirmed: boolean;
}): ItemIdentity {
  const { candidate, sellerConfirmed } = input;
  const displayName = clean(input.identityTitle || candidate?.identityTitle || candidate?.title) || 'Item';
  const sellerCorrection = sellerConfirmed ? displayName : undefined;
  const correctionParts = sellerCorrection?.match(/[A-Za-z0-9][A-Za-z0-9+.-]*/g) || [];
  const brand = sellerCorrection
    ? correctionParts[0]
    : clean(candidate?.brand) || undefined;
  const productType = sellerCorrection
    ? (correctionParts.length > 1 ? correctionParts[correctionParts.length - 1] : 'item')
    : clean(candidate?.productType || candidate?.type || displayName) || 'item';
  const model = sellerCorrection
    ? (correctionParts.length > 2 ? correctionParts.slice(1, -1).join(' ') : undefined)
    : clean(candidate?.model) || undefined;
  const specs = Object.fromEntries(
    Object.entries(candidate?.specs || {})
      .map(([key, value]) => [clean(key), clean(value)] as const)
      .filter(([key, value]) => key && value),
  );
  const confidence = sellerCorrection
    ? 1
    : Math.max(0, Math.min(1, Number(candidate?.confidence ?? candidate?.score) || 0.5));
  const reference = clean(candidate?.url || candidate?.link || candidate?.productUrl) || undefined;

  return {
    displayName,
    brand,
    productType,
    model,
    specs,
    condition: clean(candidate?.condition) || undefined,
    sellerCorrection,
    confidence,
    evidence: sellerCorrection
      ? [{ source: 'seller', field: 'identity', value: sellerCorrection, confidence: 1 }]
      : [{ source: 'marketplace', field: 'identity', value: displayName, reference, confidence }],
    canonicalKey: canonicalIdentityKey({ sellerCorrection, brand, productType, model, displayName }),
    cachePolicy: sellerCorrection ? 'bypass_after_correction' : 'allow',
  };
}

function pricingSample(candidate: any): PricingSample[] {
  const price = candidatePrice(candidate);
  if (price === undefined) return [];
  return [{
    title: clean(candidate?.title) || undefined,
    price,
    url: clean(candidate?.url || candidate?.link || candidate?.productUrl) || undefined,
    imageUrl: clean(candidate?.imageUrl || candidate?.image || candidate?.thumbnail) || undefined,
    marketplace: clean(candidate?.marketplace || candidate?.source) || undefined,
    kind: candidate?.kind === 'similar' || candidate?.pricingResearch?.isSimilar ? 'similar' : 'exact',
  }];
}

function buildPricingSnapshot(identity: ItemIdentity, candidate: any): PricingSnapshot | undefined {
  const research = candidate?.pricingResearch || {};
  const visiblePrice = candidatePrice(candidate);
  const recommended = Number(research.recommended ?? research.median ?? visiblePrice);
  const low = Number(research.low ?? recommended);
  const median = Number(research.median ?? recommended);
  const high = Number(research.high ?? recommended);
  if (![low, median, high, recommended].every((value) => Number.isFinite(value) && value >= 0)) {
    return undefined;
  }

  const rawSamples = Array.isArray(research.samples) && research.samples.length
    ? research.samples
    : [candidate];
  const samples: PricingSample[] = rawSamples.flatMap((sample: any) => pricingSample(sample));
  const kinds = new Set<PricingSample['kind']>(samples.map((sample) => sample.kind));

  return {
    identityCanonicalKey: identity.canonicalKey,
    low,
    median,
    high,
    recommended,
    currency: clean(research.currency || candidate?.price?.currency) || 'USD',
    sampleCount: Number.isFinite(Number(research.sampleCount))
      ? Number(research.sampleCount)
      : samples.length,
    samples,
    compKind: kinds.size > 1
      ? 'mixed'
      : kinds.has('similar')
        ? 'similar'
        : kinds.has('exact')
          ? 'exact'
          : research.isSimilar ? 'similar' : 'estimate',
    capturedAt: clean(research.capturedAt) || new Date().toISOString(),
    fromCache: research.fromCache === true || undefined,
  };
}

export function buildGenerateProduct(input: {
  productIndex: number;
  productId: string;
  variantId?: string;
  identityTitle: string;
  candidate: any;
  sellerConfirmed: boolean;
  photos: GenerationPhoto[];
  quantity?: number;
}): GenerateProduct {
  const itemIdentity = buildItemIdentity(input);
  return {
    productIndex: input.productIndex,
    productId: input.productId,
    variantId: input.variantId,
    itemIdentity,
    pricingSnapshot: buildPricingSnapshot(itemIdentity, input.candidate),
    photos: input.photos,
    quantity: input.quantity,
  };
}

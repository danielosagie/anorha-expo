type PriceSample = { price?: number };

export type PricingDataLike = {
  low?: number | null;
  high?: number | null;
  median?: number | null;
  average?: number | null;
  recommended?: number | null;
  samples?: PriceSample[] | null;
  livePricing?: {
    low?: number | null;
    median?: number | null;
    high?: number | null;
  } | null;
};

export const usablePrice = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

export const hasUsablePricingData = (pricing?: PricingDataLike | null): boolean => {
  if (!pricing) return false;

  const hasRange = usablePrice(pricing.low) !== undefined
    && usablePrice(pricing.high) !== undefined;
  const hasLiveRange = usablePrice(pricing.livePricing?.low) !== undefined
    && usablePrice(pricing.livePricing?.high) !== undefined;
  const hasMedian = usablePrice(pricing.median) !== undefined
    || usablePrice(pricing.livePricing?.median) !== undefined;
  const hasPricedSample = Boolean(
    pricing.samples?.some((sample) => usablePrice(sample.price) !== undefined),
  );

  return hasRange || hasLiveRange || hasMedian || hasPricedSample;
};

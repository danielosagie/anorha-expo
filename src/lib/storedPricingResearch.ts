export type StoredPricingSummary = {
  average?: number;
  median?: number;
};

export type StoredPricingSample = {
  title?: string;
  price: number;
  marketplace?: string;
  condition?: string;
  imageUrl?: string;
  url?: string;
  estimatedDaysToSell?: number;
};

/**
 * The render-safe subset shared by Match's frozen pricingSnapshot and older
 * pricingResearch payloads still present in local carts.
 */
export type StoredPricingResearch = StoredPricingSummary & {
  low?: number;
  high?: number;
  recommended?: number;
  sampleCount?: number;
  cachedAt?: string;
  isSimilar?: boolean;
  samples: StoredPricingSample[];
};

const positiveNumber = (value: unknown): number | undefined => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
};

const optionalString = (value: unknown): string | undefined => (
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
);

const medianOf = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

/**
 * Normalize persisted pricing without inventing evidence. Invalid and zero
 * values are removed; range and aggregate fallbacks come only from sold samples.
 */
export function normalizeStoredPricingResearch(value: unknown): StoredPricingResearch | null {
  if (!value || typeof value !== 'object') return null;
  const research = value as Record<string, unknown>;
  const rawSamples = Array.isArray(research.samples) ? research.samples : [];
  const samples = rawSamples.flatMap((sample): StoredPricingSample[] => {
    if (!sample || typeof sample !== 'object') return [];
    const record = sample as Record<string, unknown>;
    const price = positiveNumber(record.price);
    if (price === undefined) return [];
    const estimatedDaysToSell = positiveNumber(record.estimatedDaysToSell);
    return [{
      price,
      title: optionalString(record.title),
      marketplace: optionalString(record.marketplace) ?? optionalString(record.source),
      condition: optionalString(record.condition),
      imageUrl: optionalString(record.imageUrl),
      url: optionalString(record.url),
      estimatedDaysToSell,
    }];
  });
  const samplePrices = samples.map((sample) => sample.price);
  const average = positiveNumber(research.average)
    ?? (samplePrices.length > 0
      ? samplePrices.reduce((total, price) => total + price, 0) / samplePrices.length
      : undefined);
  const median = positiveNumber(research.median) ?? medianOf(samplePrices);
  const low = positiveNumber(research.low)
    ?? (samplePrices.length > 0 ? Math.min(...samplePrices) : undefined);
  const high = positiveNumber(research.high)
    ?? (samplePrices.length > 0 ? Math.max(...samplePrices) : undefined);
  const recommended = positiveNumber(research.recommended) ?? median;

  if (!average && !median && !low && !high && samples.length === 0) return null;

  const rawSampleCount = Number(research.sampleCount);
  const sampleCount = Number.isInteger(rawSampleCount) && rawSampleCount > 0
    ? rawSampleCount
    : samples.length || undefined;
  const compKind = optionalString(research.compKind);

  return {
    average,
    median,
    low,
    high,
    recommended,
    sampleCount,
    cachedAt: optionalString(research.cachedAt) ?? optionalString(research.capturedAt),
    isSimilar: compKind === 'similar',
    samples,
  };
}

export function summarizeStoredPricingResearch(value: unknown): StoredPricingSummary | null {
  const research = normalizeStoredPricingResearch(value);
  return research ? { average: research.average, median: research.median } : null;
}

export function selectStoredPricingResearch(candidates: unknown[]): unknown | null {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const possibleResearch = [
      candidate,
      record.pricingResearch,
      record.pricingSnapshot,
      record.aiPricingResearch,
      record.pricing,
    ];
    for (const value of possibleResearch) {
      if (normalizeStoredPricingResearch(value)) return value;
    }
  }
  return null;
}

const formatCurrency = (value: number): string => (
  `$${value.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
);

export function formatStoredPricingSummary(value: unknown): string | null {
  const summary = summarizeStoredPricingResearch(value);
  if (!summary) return null;
  if (summary.average && summary.median) {
    return `Sold avg ${formatCurrency(summary.average)} · median ${formatCurrency(summary.median)}`;
  }
  if (summary.average) return `Sold avg ${formatCurrency(summary.average)}`;
  return summary.median ? `Sold median ${formatCurrency(summary.median)}` : null;
}

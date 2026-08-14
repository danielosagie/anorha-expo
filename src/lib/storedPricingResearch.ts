export type StoredPricingSummary = {
  average?: number;
  median?: number;
};

const positiveNumber = (value: unknown): number | undefined => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
};

export function summarizeStoredPricingResearch(value: unknown): StoredPricingSummary | null {
  if (!value || typeof value !== 'object') return null;
  const research = value as Record<string, unknown>;
  const samples = Array.isArray(research.samples) ? research.samples : [];
  const samplePrices = samples
    .map((sample) => positiveNumber((sample as Record<string, unknown> | null)?.price))
    .filter((price): price is number => price !== undefined);
  const average = positiveNumber(research.average)
    ?? (samplePrices.length > 0
      ? samplePrices.reduce((total, price) => total + price, 0) / samplePrices.length
      : undefined);
  const median = positiveNumber(research.median);

  return average || median ? { average, median } : null;
}

export function selectStoredPricingResearch(candidates: unknown[]): unknown | null {
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Record<string, unknown>;
    const possibleResearch = [candidate, record.pricingResearch, record.pricingSnapshot, record.pricing];
    for (const value of possibleResearch) {
      if (summarizeStoredPricingResearch(value)) return value;
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

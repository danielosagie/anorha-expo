export interface PackageDimensionsInches {
  length?: number;
  width?: number;
  height?: number;
  unit: 'in';
}

export interface ItemShippingDetails {
  weight?: number;
  weightUnit?: string;
  dimensions?: PackageDimensionsInches;
}

export interface SizeWeightInputs {
  pounds?: string | number | null;
  ounces?: string | number | null;
  length?: string | number | null;
  width?: string | number | null;
  height?: string | number | null;
}

export type ShippingVerdict = 'ships_fine' | 'pickup_better';

const round = (value: number, places = 4): number => {
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};

const positiveNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const nonNegativeNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

export function normalizeLbOz(
  poundsInput: SizeWeightInputs['pounds'],
  ouncesInput: SizeWeightInputs['ounces'],
): { pounds: number; ounces: number; totalPounds: number } | undefined {
  const pounds = nonNegativeNumber(poundsInput);
  const ounces = nonNegativeNumber(ouncesInput);
  if (pounds === undefined && ounces === undefined) return undefined;

  const totalOunces = round((pounds ?? 0) * 16 + (ounces ?? 0));
  if (totalOunces <= 0) return undefined;

  const normalizedPounds = Math.floor(totalOunces / 16);
  const normalizedOunces = round(totalOunces - normalizedPounds * 16, 2);
  return {
    pounds: normalizedPounds,
    ounces: normalizedOunces,
    totalPounds: round(totalOunces / 16),
  };
}

export function normalizePackageDimensions(value: unknown): PackageDimensionsInches | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const length = positiveNumber(input.length);
  const width = positiveNumber(input.width);
  const height = positiveNumber(input.height);
  if (length === undefined && width === undefined && height === undefined) return undefined;

  return {
    ...(length !== undefined ? { length: round(length, 2) } : {}),
    ...(width !== undefined ? { width: round(width, 2) } : {}),
    ...(height !== undefined ? { height: round(height, 2) } : {}),
    unit: 'in',
  };
}

export function buildSizeWeightDraftPatch(input: SizeWeightInputs): ItemShippingDetails {
  const normalizedWeight = normalizeLbOz(input.pounds, input.ounces);
  const dimensions = normalizePackageDimensions({
    length: input.length,
    width: input.width,
    height: input.height,
  });

  return {
    weight: normalizedWeight?.totalPounds,
    weightUnit: normalizedWeight ? 'lb' : undefined,
    dimensions,
  };
}

const weightInPounds = (weight?: number, unit?: string): number | undefined => {
  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) return undefined;
  switch (String(unit ?? 'lb').trim().toLowerCase()) {
    case 'oz': return weight / 16;
    case 'kg': return weight * 2.2046226218;
    case 'g': return weight / 453.59237;
    default: return weight;
  }
};

export function buildShippingPlatformPatch(details: ItemShippingDetails): {
  weight?: number;
  weightUnit?: string;
  estimatedDimensions?: { length: number; width: number; height: number; unit: 'in' };
} {
  const weight = positiveNumber(details.weight);
  const dimensions = normalizePackageDimensions(details.dimensions);
  const completeDimensions = dimensions?.length !== undefined
    && dimensions.width !== undefined
    && dimensions.height !== undefined
    ? {
        length: dimensions.length,
        width: dimensions.width,
        height: dimensions.height,
        unit: 'in' as const,
      }
    : undefined;

  return {
    ...(weight !== undefined ? { weight, weightUnit: details.weightUnit || 'lb' } : {}),
    ...(completeDimensions ? { estimatedDimensions: completeDimensions } : {}),
  };
}

/**
 * Carrier receipt, checked 2026-08-21: USPS DMM 201.7.3 caps ordinary parcels at
 * 70 lb and normally 108 in for length plus girth, and eBay Labels repeats those
 * limits. Sources: https://pe.usps.com/cpim/ftp/manuals/dmm300/Full/MailingStandards.pdf
 * and https://www.ebay.com/sellercenter/shipping/choosing-a-carrier-and-service/usps-and-ebay-labels
 * The product recommendation is intentionally more conservative at 50 lb or a
 * 48 in longest side, while retaining the documented 108 in length-plus-girth cap.
 */
export function getShippingVerdict(details: ItemShippingDetails): ShippingVerdict | undefined {
  const pounds = weightInPounds(details.weight, details.weightUnit);
  const dimensions = normalizePackageDimensions(details.dimensions);
  const sides = [dimensions?.length, dimensions?.width, dimensions?.height]
    .filter((side): side is number => typeof side === 'number')
    .sort((a, b) => b - a);
  if (pounds === undefined && sides.length === 0) return undefined;

  const longestSide = sides[0];
  const lengthPlusGirth = sides.length === 3
    ? sides[0] + 2 * (sides[1] + sides[2])
    : undefined;
  return (pounds !== undefined && pounds > 50)
    || (longestSide !== undefined && longestSide > 48)
    || (lengthPlusGirth !== undefined && lengthPlusGirth > 108)
    ? 'pickup_better'
    : 'ships_fine';
}

const displayNumber = (value: number): string => Number.isInteger(value)
  ? String(value)
  : String(round(value, 2));

export function splitWeightForInputs(details: ItemShippingDetails): { pounds: string; ounces: string } {
  const pounds = weightInPounds(details.weight, details.weightUnit);
  if (pounds === undefined) return { pounds: '', ounces: '' };
  const normalized = normalizeLbOz(pounds, 0);
  if (!normalized) return { pounds: '', ounces: '' };
  return {
    pounds: normalized.pounds > 0 ? displayNumber(normalized.pounds) : '',
    ounces: normalized.ounces > 0 ? displayNumber(normalized.ounces) : '',
  };
}

export function formatSizeWeight(details: ItemShippingDetails): string | undefined {
  const weight = splitWeightForInputs(details);
  const weightParts = [
    weight.pounds ? `${weight.pounds} lb` : null,
    weight.ounces ? `${weight.ounces} oz` : null,
  ].filter(Boolean);
  const dimensions = normalizePackageDimensions(details.dimensions);
  const dimensionParts = dimensions
    ? [dimensions.length, dimensions.width, dimensions.height]
        .map((side) => side === undefined ? '?' : displayNumber(side))
    : [];

  const parts = [
    weightParts.length ? weightParts.join(' ') : null,
    dimensionParts.length ? `${dimensionParts.join('x')} in` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

export const ALL_CHANNELS_SCOPE = 'all';
export const BASE_PRICE_TARGET = 'base';

export type PriceScope = typeof ALL_CHANNELS_SCOPE | string;

export type ScopedPriceBook = {
  all: Record<string, string>;
  channelOverrides: Record<string, Record<string, string>>;
};

const own = (record: Record<string, string> | undefined, key: string): boolean => (
  !!record && Object.prototype.hasOwnProperty.call(record, key)
);

export function priceText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return '';
  return String(value);
}

export function normalizePriceInput(value: string): string | null {
  const normalized = value.replace(',', '.').replace(/[^0-9.]/g, '');
  const firstDot = normalized.indexOf('.');
  if (firstDot >= 0 && normalized.indexOf('.', firstDot + 1) >= 0) return null;
  if (!/^\d*(?:\.\d{0,2})?$/.test(normalized)) return null;
  return normalized;
}

export function isPositivePrice(value: unknown): boolean {
  const numberValue = Number(value);
  return String(value ?? '').trim().length > 0
    && Number.isFinite(numberValue)
    && numberValue > 0;
}

export function createScopedPriceBook(
  all: Record<string, unknown>,
  channelOverrides: Record<string, Record<string, unknown>> = {},
): ScopedPriceBook {
  const normalizedAll = Object.fromEntries(
    Object.entries(all).map(([target, value]) => [target, priceText(value)]),
  );
  const normalizedOverrides = Object.fromEntries(
    Object.entries(channelOverrides).map(([channel, values]) => [
      channel,
      Object.fromEntries(
        Object.entries(values)
          .map(([target, value]) => [target, priceText(value)])
          .filter(([, value]) => value.length > 0),
      ),
    ]),
  );
  return { all: normalizedAll, channelOverrides: normalizedOverrides };
}

export function getScopedPrice(
  book: ScopedPriceBook,
  scope: PriceScope,
  target: string,
): string {
  if (scope !== ALL_CHANNELS_SCOPE && own(book.channelOverrides[scope], target)) {
    return book.channelOverrides[scope][target];
  }
  return book.all[target] ?? '';
}

export function setScopedPrice(
  book: ScopedPriceBook,
  scope: PriceScope,
  target: string,
  value: string,
): ScopedPriceBook {
  if (scope === ALL_CHANNELS_SCOPE) {
    return {
      ...book,
      all: { ...book.all, [target]: value },
    };
  }

  const nextChannel = { ...(book.channelOverrides[scope] || {}) };
  if (value.trim().length > 0) nextChannel[target] = value;
  else delete nextChannel[target];

  const nextOverrides = { ...book.channelOverrides };
  if (Object.keys(nextChannel).length > 0) nextOverrides[scope] = nextChannel;
  else delete nextOverrides[scope];

  return { ...book, channelOverrides: nextOverrides };
}

export function copyVariantPriceToAll(
  book: ScopedPriceBook,
  scope: PriceScope,
  sourceTarget: string,
  variantTargets: string[],
): ScopedPriceBook {
  const sourcePrice = getScopedPrice(book, scope, sourceTarget);
  if (!isPositivePrice(sourcePrice)) return book;
  return variantTargets.reduce(
    (next, target) => setScopedPrice(next, scope, target, sourcePrice),
    book,
  );
}
